// Core modules
pub mod types;
pub mod analyzer;
pub mod repository;
pub mod context;
pub mod ai_providers;

#[cfg(test)]
mod tests;

// Re-exports for convenience
pub use types::*;
pub use analyzer::*;
pub use repository::*;
pub use context::*;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use async_trait::async_trait;

// ==================== Main Code Agent Implementation ====================

pub struct RustCodeAgent {
    analyzer: Arc<CodeAnalyzer>,
    repository_mapper: RepositoryMapper,
    context_manager: ContextManager,
    lsp_manager: Arc<LspManager>,
    ai_provider: Box<dyn AiProvider + Send + Sync>,
}

impl RustCodeAgent {
    pub fn new(ai_provider: Box<dyn AiProvider + Send + Sync>, window_size: usize) -> Self {
        let analyzer = Arc::new(CodeAnalyzer::new());
        
        Self {
            analyzer: analyzer.clone(),
            repository_mapper: RepositoryMapper::new(analyzer.clone(), 1024),
            context_manager: ContextManager::new(window_size),
            lsp_manager: Arc::new(LspManager::new()),
            ai_provider,
        }
    }
}

#[async_trait]
impl CodeAgent for RustCodeAgent {
    async fn analyze_context(&self, request: ContextRequest) -> Result<ContextResponse> {
        // Build repository map
        let repo_map = self.repository_mapper.build_map(Path::new(".")).await?;
        
        // Find relevant files
        let relevant_files = self.find_relevant_files(&request, &repo_map).await?;
        
        // Get symbols if requested
        let symbols = if request.include_symbols {
            repo_map.symbols.values().cloned().collect()
        } else {
            Vec::new()
        };
        
        // Get diagnostics if requested
        let diagnostics = if request.include_diagnostics {
            self.lsp_manager.get_diagnostics().await?
        } else {
            Vec::new()
        };
        
        // Build compressed repository map representation
        let repository_map_str = self.repository_mapper.compress_for_context(&repo_map, &request.query);
        
        Ok(ContextResponse {
            repository_map: repository_map_str,
            relevant_files,
            symbols,
            diagnostics,
            token_usage: TokenUsage {
                used: 0, // Would calculate actual usage
                total: request.max_tokens,
                percentage: 0.0,
            },
        })
    }

    async fn generate_changes(&self, context: &ContextResponse) -> Result<Vec<FileEdit>> {
        // Create prompt from context
        let prompt = self.build_prompt(context).await?;
        
        // Generate response from AI
        let response = self.ai_provider.generate(&prompt).await?;
        
        // Parse SEARCH/REPLACE blocks
        let edits = self.parse_search_replace_blocks(&response)?;
        
        Ok(edits)
    }

    async fn apply_changes(&self, edits: Vec<FileEdit>) -> Result<ApplyResult> {
        let mut succeeded = Vec::new();
        let mut failed = HashMap::new();
        
        // Create backup
        let backup = self.create_backup(&edits).await?;
        
        for edit in &edits {
            match self.apply_single_edit(edit).await {
                Ok(_) => succeeded.push(edit.path.clone()),
                Err(e) => {
                    failed.insert(edit.path.clone(), e.to_string());
                    // Rollback on failure
                    let _ = self.rollback_edit(edit, &backup).await;
                }
            }
        }
        
        Ok(ApplyResult { succeeded, failed })
    }
}

impl RustCodeAgent {
    async fn find_relevant_files(&self, _request: &ContextRequest, _repo_map: &RepositoryMap) -> Result<Vec<FileContent>> {
        // Implementation would filter files based on relevance
        Ok(Vec::new())
    }

    async fn build_prompt(&self, context: &ContextResponse) -> Result<String> {
        let mut prompt = String::new();
        
        prompt.push_str("You are an expert code assistant. Analyze the following codebase context:\n\n");
        prompt.push_str("Repository Map:\n");
        prompt.push_str(&context.repository_map);
        prompt.push('\n');
        
        if !context.relevant_files.is_empty() {
            prompt.push_str("\nRelevant Files:\n");
            for file in &context.relevant_files {
                prompt.push_str(&format!("{}:\n{}\n\n", file.path.display(), file.content));
            }
        }
        
        if !context.diagnostics.is_empty() {
            prompt.push_str("\nDiagnostics:\n");
            for diagnostic in &context.diagnostics {
                prompt.push_str(&format!("{:?}: {}\n", diagnostic.severity, diagnostic.message));
            }
        }
        
        prompt.push_str("\nProvide code changes using SEARCH/REPLACE blocks.");
        
        Ok(prompt)
    }

    fn parse_search_replace_blocks(&self, response: &str) -> Result<Vec<FileEdit>> {
        let mut edits = Vec::new();
        let lines: Vec<&str> = response.lines().collect();
        let mut i = 0;
        
        while i < lines.len() {
            // Look for file path marker
            if lines[i].starts_with("```") && lines[i].contains(".rs") ||
               lines[i].starts_with("```") && lines[i].contains(".py") ||
               lines[i].starts_with("```") && lines[i].contains(".js") ||
               lines[i].starts_with("```") && lines[i].contains(".ts") ||
               lines[i].starts_with("```") && lines[i].contains(".go") ||
               lines[i].starts_with("```") && lines[i].contains(".java") ||
               lines[i].starts_with("```") && lines[i].contains(".cs") {
                
                // Extract file path
                let file_path = lines[i].trim_start_matches("```")
                    .trim()
                    .split_whitespace()
                    .find(|s| s.contains("."))
                    .unwrap_or("")
                    .to_string();
                
                i += 1;
                let mut search_content = String::new();
                let mut replace_content = String::new();
                let mut in_search = false;
                let mut in_replace = false;
                
                // Parse SEARCH/REPLACE block
                while i < lines.len() && !lines[i].starts_with("```") {
                    let line = lines[i];
                    
                    if line.trim() == "<<<<<<< SEARCH" {
                        in_search = true;
                        in_replace = false;
                    } else if line.trim() == "=======" {
                        in_search = false;
                        in_replace = true;
                    } else if line.trim() == ">>>>>>> REPLACE" {
                        in_search = false;
                        in_replace = false;
                        
                        // Create edit
                        if !file_path.is_empty() && !search_content.trim().is_empty() {
                            edits.push(FileEdit {
                                path: PathBuf::from(file_path.clone()),
                                search: search_content.trim().to_string(),
                                replace: replace_content.trim().to_string(),
                                edit_type: EditType::Replace,
                            });
                        }
                        
                        search_content.clear();
                        replace_content.clear();
                    } else if in_search {
                        if !search_content.is_empty() {
                            search_content.push('\n');
                        }
                        search_content.push_str(line);
                    } else if in_replace {
                        if !replace_content.is_empty() {
                            replace_content.push('\n');
                        }
                        replace_content.push_str(line);
                    }
                    
                    i += 1;
                }
                
                // Skip closing ```
                if i < lines.len() && lines[i].starts_with("```") {
                    i += 1;
                }
            } else {
                i += 1;
            }
        }
        
        Ok(edits)
    }

    async fn apply_single_edit(&self, edit: &FileEdit) -> Result<()> {
        // Read current file content
        let current_content = tokio::fs::read_to_string(&edit.path).await
            .map_err(|e| format!("Failed to read file {}: {}", edit.path.display(), e))?;
        
        match edit.edit_type {
            EditType::Replace => {
                // Find and replace the search text
                if !current_content.contains(&edit.search) {
                    return Err(format!("Search text not found in file {}", edit.path.display()).into());
                }
                
                let new_content = current_content.replace(&edit.search, &edit.replace);
                
                // Write the modified content back
                tokio::fs::write(&edit.path, new_content).await
                    .map_err(|e| format!("Failed to write file {}: {}", edit.path.display(), e))?;
            },
            EditType::Insert => {
                // Insert content at the beginning of the file
                let new_content = format!("{}{}", edit.replace, current_content);
                tokio::fs::write(&edit.path, new_content).await
                    .map_err(|e| format!("Failed to write file {}: {}", edit.path.display(), e))?;
            },
            EditType::Append => {
                // Append content to the end of the file
                let new_content = format!("{}{}", current_content, edit.replace);
                tokio::fs::write(&edit.path, new_content).await
                    .map_err(|e| format!("Failed to write file {}: {}", edit.path.display(), e))?;
            },
            _ => {
                return Err("Unsupported edit type".into());
            }
        }
        
        Ok(())
    }

    async fn create_backup(&self, edits: &[FileEdit]) -> Result<HashMap<PathBuf, String>> {
        let mut backups = HashMap::new();
        
        for edit in edits {
            if let Ok(content) = tokio::fs::read_to_string(&edit.path).await {
                backups.insert(edit.path.clone(), content);
            }
        }
        
        Ok(backups)
    }

    async fn rollback_edit(&self, edit: &FileEdit, backup: &HashMap<PathBuf, String>) -> Result<()> {
        if let Some(original_content) = backup.get(&edit.path) {
            tokio::fs::write(&edit.path, original_content).await
                .map_err(|e| format!("Failed to rollback file {}: {}", edit.path.display(), e))?;
        }
        Ok(())
    }
}

// ==================== LSP Integration ====================

pub struct LspManager {
    clients: HashMap<Language, LspClient>,
}

pub struct LspClient {
    language: Language,
}

impl LspManager {
    pub fn new() -> Self {
        Self {
            clients: HashMap::new(),
        }
    }

    pub async fn get_diagnostics(&self) -> Result<Vec<Diagnostic>> {
        // Get diagnostics from LSP servers
        Ok(Vec::new())
    }
}

// ==================== Plugin System ====================

#[async_trait]
pub trait Plugin: Send + Sync {
    async fn initialize(&mut self, context: &PluginContext) -> Result<()>;
    async fn on_file_change(&self, path: &Path) -> Result<()>;
    async fn on_edit_request(&self, request: &str) -> Result<Option<String>>;
}

pub struct PluginContext {
    pub analyzer: Arc<CodeAnalyzer>,
    pub lsp_manager: Arc<LspManager>,
    pub context_manager: Arc<ContextManager>,
}

pub struct PluginManager {
    plugins: Vec<Box<dyn Plugin>>,
    context: PluginContext,
}

impl PluginManager {
    pub fn new(context: PluginContext) -> Self {
        Self {
            plugins: Vec::new(),
            context,
        }
    }

    pub async fn load_plugin(&mut self, mut plugin: Box<dyn Plugin>) -> Result<()> {
        plugin.initialize(&self.context).await?;
        self.plugins.push(plugin);
        Ok(())
    }
}

// ==================== Builder Pattern ====================

pub struct CodeAgentBuilder {
    window_size: usize,
    ai_provider: Option<Box<dyn AiProvider + Send + Sync>>,
    plugins: Vec<Box<dyn Plugin>>,
}

impl CodeAgentBuilder {
    pub fn new() -> Self {
        Self {
            window_size: 100_000, // Default 100k tokens
            ai_provider: None,
            plugins: Vec::new(),
        }
    }

    pub fn window_size(mut self, size: usize) -> Self {
        self.window_size = size;
        self
    }

    pub fn ai_provider(mut self, provider: Box<dyn AiProvider + Send + Sync>) -> Self {
        self.ai_provider = Some(provider);
        self
    }

    pub fn plugin(mut self, plugin: Box<dyn Plugin>) -> Self {
        self.plugins.push(plugin);
        self
    }

    pub async fn build(self) -> Result<RustCodeAgent> {
        let ai_provider = self.ai_provider.ok_or("AI provider required")?;
        let agent = RustCodeAgent::new(ai_provider, self.window_size);
        
        // Initialize plugin manager
        let plugin_context = PluginContext {
            analyzer: agent.analyzer.clone(),
            lsp_manager: agent.lsp_manager.clone(),
            context_manager: Arc::new(ContextManager::new(self.window_size)),
        };
        
        let mut plugin_manager = PluginManager::new(plugin_context);
        for plugin in self.plugins {
            plugin_manager.load_plugin(plugin).await?;
        }
        
        Ok(agent)
    }
}

impl Default for CodeAgentBuilder {
    fn default() -> Self {
        Self::new()
    }
}