use async_trait::async_trait;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::Duration;
use tokio::sync::mpsc;

use crate::{AiProvider, Result};

// ==================== OpenAI Provider ====================

pub struct OpenAiProvider {
    client: Client,
    api_key: String,
    model: String,
    base_url: String,
}

#[derive(Serialize)]
struct OpenAiRequest {
    model: String,
    messages: Vec<OpenAiMessage>,
    max_tokens: Option<u32>,
    temperature: Option<f32>,
}

#[derive(Serialize, Deserialize)]
struct OpenAiMessage {
    role: String,
    content: String,
}

#[derive(Deserialize)]
struct OpenAiResponse {
    choices: Vec<OpenAiChoice>,
}

#[derive(Deserialize)]
struct OpenAiChoice {
    message: OpenAiMessage,
}

impl OpenAiProvider {
    pub fn new(api_key: String, model: Option<String>) -> Self {
        Self {
            client: Client::builder()
                .timeout(Duration::from_secs(120))
                .build()
                .unwrap_or_else(|_| Client::new()),
            api_key,
            model: model.unwrap_or_else(|| "gpt-4".to_string()),
            base_url: "https://api.openai.com/v1".to_string(),
        }
    }

    pub fn with_base_url(mut self, base_url: String) -> Self {
        self.base_url = base_url;
        self
    }
}

#[async_trait]
impl AiProvider for OpenAiProvider {
    async fn generate(&self, prompt: &str) -> Result<String> {
        let request = OpenAiRequest {
            model: self.model.clone(),
            messages: vec![OpenAiMessage {
                role: "user".to_string(),
                content: prompt.to_string(),
            }],
            max_tokens: Some(4096),
            temperature: Some(0.1),
        };

        let response = self.client
            .post(&format!("{}/chat/completions", self.base_url))
            .header("Authorization", format!("Bearer {}", self.api_key))
            .header("Content-Type", "application/json")
            .json(&request)
            .send()
            .await
            .map_err(|e| format!("OpenAI API request failed: {}", e))?;

        if !response.status().is_success() {
            let error_text = response.text().await.unwrap_or_else(|_| "Unknown error".to_string());
            return Err(format!("OpenAI API error: {}", error_text).into());
        }

        let openai_response: OpenAiResponse = response.json().await
            .map_err(|e| format!("Failed to parse OpenAI response: {}", e))?;

        openai_response.choices
            .first()
            .map(|choice| choice.message.content.clone())
            .ok_or_else(|| "No response from OpenAI".into())
    }

    async fn stream_generate(&self, prompt: &str) -> Result<mpsc::Receiver<String>> {
        let (tx, rx) = mpsc::channel(100);
        
        // For simplicity, just send the non-streaming response word by word
        let response = self.generate(prompt).await?;
        
        tokio::spawn(async move {
            for word in response.split_whitespace() {
                let _ = tx.send(word.to_string()).await;
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
        });

        Ok(rx)
    }
}

// ==================== Anthropic Claude Provider ====================

pub struct AnthropicProvider {
    client: Client,
    api_key: String,
    model: String,
}

#[derive(Serialize)]
struct AnthropicRequest {
    model: String,
    max_tokens: u32,
    messages: Vec<AnthropicMessage>,
    temperature: Option<f32>,
}

#[derive(Serialize)]
struct AnthropicMessage {
    role: String,
    content: String,
}

#[derive(Deserialize)]
struct AnthropicResponse {
    content: Vec<AnthropicContent>,
}

#[derive(Deserialize)]
struct AnthropicContent {
    text: String,
}

impl AnthropicProvider {
    pub fn new(api_key: String, model: Option<String>) -> Self {
        Self {
            client: Client::builder()
                .timeout(Duration::from_secs(120))
                .build()
                .unwrap_or_else(|_| Client::new()),
            api_key,
            model: model.unwrap_or_else(|| "claude-3-5-sonnet-20241022".to_string()),
        }
    }
}

#[async_trait]
impl AiProvider for AnthropicProvider {
    async fn generate(&self, prompt: &str) -> Result<String> {
        let request = AnthropicRequest {
            model: self.model.clone(),
            max_tokens: 4096,
            messages: vec![AnthropicMessage {
                role: "user".to_string(),
                content: prompt.to_string(),
            }],
            temperature: Some(0.1),
        };

        let response = self.client
            .post("https://api.anthropic.com/v1/messages")
            .header("Authorization", format!("Bearer {}", self.api_key))
            .header("Content-Type", "application/json")
            .header("anthropic-version", "2023-06-01")
            .json(&request)
            .send()
            .await
            .map_err(|e| format!("Anthropic API request failed: {}", e))?;

        if !response.status().is_success() {
            let error_text = response.text().await.unwrap_or_else(|_| "Unknown error".to_string());
            return Err(format!("Anthropic API error: {}", error_text).into());
        }

        let anthropic_response: AnthropicResponse = response.json().await
            .map_err(|e| format!("Failed to parse Anthropic response: {}", e))?;

        anthropic_response.content
            .first()
            .map(|content| content.text.clone())
            .ok_or_else(|| "No response from Anthropic".into())
    }

    async fn stream_generate(&self, prompt: &str) -> Result<mpsc::Receiver<String>> {
        let (tx, rx) = mpsc::channel(100);
        
        // For simplicity, just send the non-streaming response word by word
        let response = self.generate(prompt).await?;
        
        tokio::spawn(async move {
            for word in response.split_whitespace() {
                let _ = tx.send(word.to_string()).await;
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
        });

        Ok(rx)
    }
}

// ==================== Local/Ollama Provider ====================

pub struct OllamaProvider {
    client: Client,
    base_url: String,
    model: String,
}

#[derive(Serialize)]
struct OllamaRequest {
    model: String,
    prompt: String,
    stream: Option<bool>,
    options: Option<HashMap<String, serde_json::Value>>,
}

#[derive(Deserialize)]
struct OllamaResponse {
    response: String,
    done: bool,
}

impl OllamaProvider {
    pub fn new(model: String, base_url: Option<String>) -> Self {
        Self {
            client: Client::builder()
                .timeout(Duration::from_secs(300)) // Longer timeout for local models
                .build()
                .unwrap_or_else(|_| Client::new()),
            base_url: base_url.unwrap_or_else(|| "http://localhost:11434".to_string()),
            model,
        }
    }
}

#[async_trait]
impl AiProvider for OllamaProvider {
    async fn generate(&self, prompt: &str) -> Result<String> {
        let mut options = HashMap::new();
        options.insert("temperature".to_string(), serde_json::Value::Number(serde_json::Number::from_f64(0.1).unwrap()));
        
        let request = OllamaRequest {
            model: self.model.clone(),
            prompt: prompt.to_string(),
            stream: Some(false),
            options: Some(options),
        };

        let response = self.client
            .post(&format!("{}/api/generate", self.base_url))
            .header("Content-Type", "application/json")
            .json(&request)
            .send()
            .await
            .map_err(|e| format!("Ollama API request failed: {}", e))?;

        if !response.status().is_success() {
            let error_text = response.text().await.unwrap_or_else(|_| "Unknown error".to_string());
            return Err(format!("Ollama API error: {}", error_text).into());
        }

        let ollama_response: OllamaResponse = response.json().await
            .map_err(|e| format!("Failed to parse Ollama response: {}", e))?;

        Ok(ollama_response.response)
    }

    async fn stream_generate(&self, prompt: &str) -> Result<mpsc::Receiver<String>> {
        let (tx, rx) = mpsc::channel(100);
        
        // For simplicity, just send the non-streaming response word by word
        let response = self.generate(prompt).await?;
        
        tokio::spawn(async move {
            for word in response.split_whitespace() {
                let _ = tx.send(word.to_string()).await;
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
        });

        Ok(rx)
    }
}

// ==================== Custom/Generic Provider ====================

pub struct CustomProvider {
    client: Client,
    base_url: String,
    model: String,
    api_key: Option<String>,
}

#[derive(Serialize)]
struct CustomRequest {
    model: String,
    messages: Vec<CustomMessage>,
    max_tokens: Option<u32>,
    temperature: Option<f32>,
    stream: Option<bool>,
}

#[derive(Serialize, Deserialize)]
struct CustomMessage {
    role: String,
    content: String,
}

#[derive(Deserialize)]
struct CustomResponse {
    choices: Vec<CustomChoice>,
}

#[derive(Deserialize)]
struct CustomChoice {
    message: CustomMessage,
}

impl CustomProvider {
    pub fn new(base_url: String, model: String, api_key: Option<String>) -> Self {
        Self {
            client: Client::builder()
                .timeout(Duration::from_secs(300))
                .build()
                .unwrap_or_else(|_| Client::new()),
            base_url,
            model,
            api_key,
        }
    }
}

#[async_trait]
impl AiProvider for CustomProvider {
    async fn generate(&self, prompt: &str) -> Result<String> {
        // Format prompt to encourage markdown code blocks
        let formatted_prompt = format!(
            "Please provide your response as plain markdown. When writing code, use markdown code blocks with appropriate language tags (```rust, ```python, etc.). Here's the request:\n\n{}",
            prompt
        );

        let request = CustomRequest {
            model: self.model.clone(),
            messages: vec![CustomMessage {
                role: "user".to_string(),
                content: formatted_prompt,
            }],
            max_tokens: Some(4096),
            temperature: Some(0.1),
            stream: Some(false),
        };

        let mut request_builder = self.client
            .post(&format!("{}/v1/chat/completions", self.base_url))
            .header("Content-Type", "application/json");

        if let Some(ref api_key) = self.api_key {
            request_builder = request_builder.header("Authorization", format!("Bearer {}", api_key));
        }

        let response = request_builder
            .json(&request)
            .send()
            .await
            .map_err(|e| format!("Custom provider request failed: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let error_text = response.text().await.unwrap_or_else(|_| "Unknown error".to_string());
            return Err(format!("Custom provider error ({}): {}", status, error_text).into());
        }

        let custom_response: CustomResponse = response.json().await
            .map_err(|e| format!("Failed to parse custom provider response: {}", e))?;

        custom_response.choices
            .first()
            .map(|choice| choice.message.content.clone())
            .ok_or_else(|| "No response from custom provider".into())
    }

    async fn stream_generate(&self, prompt: &str) -> Result<mpsc::Receiver<String>> {
        let (tx, rx) = mpsc::channel(100);
        
        // For simplicity, just send the non-streaming response word by word
        let response = self.generate(prompt).await?;
        
        tokio::spawn(async move {
            for word in response.split_whitespace() {
                let _ = tx.send(word.to_string()).await;
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
        });

        Ok(rx)
    }
}

// ==================== Provider Factory ====================

pub struct AiProviderFactory;

impl AiProviderFactory {
    pub fn create_openai(api_key: String, model: Option<String>) -> Box<dyn AiProvider + Send + Sync> {
        Box::new(OpenAiProvider::new(api_key, model))
    }
    
    pub fn create_anthropic(api_key: String, model: Option<String>) -> Box<dyn AiProvider + Send + Sync> {
        Box::new(AnthropicProvider::new(api_key, model))
    }
    
    pub fn create_ollama(model: String, base_url: Option<String>) -> Box<dyn AiProvider + Send + Sync> {
        Box::new(OllamaProvider::new(model, base_url))
    }

    pub fn create_custom(base_url: String, model: String, api_key: Option<String>) -> Box<dyn AiProvider + Send + Sync> {
        Box::new(CustomProvider::new(base_url, model, api_key))
    }
    
    pub fn from_config(provider: &str, config: HashMap<String, String>) -> Result<Box<dyn AiProvider + Send + Sync>> {
        match provider.to_lowercase().as_str() {
            "openai" => {
                let api_key = config.get("api_key")
                    .ok_or("OpenAI API key required")?
                    .clone();
                let model = config.get("model").cloned();
                Ok(Self::create_openai(api_key, model))
            },
            "anthropic" | "claude" => {
                let api_key = config.get("api_key")
                    .ok_or("Anthropic API key required")?
                    .clone();
                let model = config.get("model").cloned();
                Ok(Self::create_anthropic(api_key, model))
            },
            "ollama" => {
                let model = config.get("model")
                    .ok_or("Model name required for Ollama")?
                    .clone();
                let base_url = config.get("base_url").cloned();
                Ok(Self::create_ollama(model, base_url))
            },
            "custom" => {
                let base_url = config.get("base_url")
                    .ok_or("Base URL required for custom provider")?
                    .clone();
                let model = config.get("model")
                    .unwrap_or(&"default".to_string())
                    .clone();
                let api_key = config.get("api_key").cloned();
                Ok(Self::create_custom(base_url, model, api_key))
            },
            _ => Err(format!("Unknown AI provider: {}", provider).into()),
        }
    }
}