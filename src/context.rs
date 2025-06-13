use std::sync::{Arc, RwLock, atomic::{AtomicUsize, Ordering}};
use async_trait::async_trait;

use crate::Result;

// ==================== Context Management (Claude Code inspired) ====================

pub struct ContextWindow {
    pub total_tokens: usize,
    pub used_tokens: AtomicUsize,
    pub layers: Vec<ContextLayer>,
}

#[derive(Debug, Clone)]
pub struct ContextLayer {
    pub name: String,
    pub priority: u8,
    pub content: Arc<str>,
    pub token_count: usize,
    pub compressible: bool,
}

pub struct ContextManager {
    window: Arc<RwLock<ContextWindow>>,
    summarizer: Box<dyn ContextSummarizer>,
}

#[async_trait]
pub trait ContextSummarizer: Send + Sync {
    async fn summarize(&self, content: &str) -> Result<String>;
}

pub struct BasicSummarizer;

#[async_trait]
impl ContextSummarizer for BasicSummarizer {
    async fn summarize(&self, content: &str) -> Result<String> {
        // Basic summarization - take first and last parts
        let lines: Vec<&str> = content.lines().collect();
        if lines.len() <= 10 {
            return Ok(content.to_string());
        }
        
        let summary = format!(
            "{}\n... [truncated {} lines] ...\n{}",
            lines[..3].join("\n"),
            lines.len() - 6,
            lines[lines.len()-3..].join("\n")
        );
        
        Ok(summary)
    }
}

impl ContextManager {
    pub fn new(total_tokens: usize) -> Self {
        Self {
            window: Arc::new(RwLock::new(ContextWindow {
                total_tokens,
                used_tokens: AtomicUsize::new(0),
                layers: Vec::new(),
            })),
            summarizer: Box::new(BasicSummarizer),
        }
    }

    pub fn add_layer(&self, layer: ContextLayer) -> Result<()> {
        let mut window = self.window.write().unwrap();
        let current_usage = window.used_tokens.load(Ordering::Relaxed);
        
        if current_usage + layer.token_count > window.total_tokens {
            return Err("Context window overflow".into());
        }
        
        window.used_tokens.fetch_add(layer.token_count, Ordering::Relaxed);
        window.layers.push(layer);
        
        Ok(())
    }

    pub fn remove_layer(&self, name: &str) -> Result<()> {
        let mut window = self.window.write().unwrap();
        
        if let Some(pos) = window.layers.iter().position(|layer| layer.name == name) {
            let removed_layer = window.layers.remove(pos);
            window.used_tokens.fetch_sub(removed_layer.token_count, Ordering::Relaxed);
        }
        
        Ok(())
    }

    pub fn get_available_tokens(&self) -> usize {
        let window = self.window.read().unwrap();
        let used = window.used_tokens.load(Ordering::Relaxed);
        window.total_tokens.saturating_sub(used)
    }

    pub fn visualize(&self) -> String {
        let window = self.window.read().unwrap();
        let used = window.used_tokens.load(Ordering::Relaxed);
        let usage_percent = (used * 100) / window.total_tokens;
        
        format!(
            "Context Usage: {}% ({}/{} tokens)\nLayers: {}\nAvailable: {} tokens",
            usage_percent,
            used,
            window.total_tokens,
            window.layers.len(),
            self.get_available_tokens()
        )
    }

    pub async fn compress_if_needed(&self) -> Result<Vec<ContextLayer>> {
        let window = self.window.read().unwrap();
        let mut result = Vec::new();
        
        for layer in &window.layers {
            if layer.compressible && layer.token_count > 1000 {
                let summary = self.summarizer.summarize(&layer.content).await?;
                result.push(ContextLayer {
                    name: format!("{} (compressed)", layer.name),
                    content: Arc::from(summary),
                    token_count: layer.token_count / 3, // Approximate compression
                    ..*layer
                });
            } else {
                result.push(layer.clone());
            }
        }
        
        Ok(result)
    }
}