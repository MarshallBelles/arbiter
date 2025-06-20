use anyhow::{Result, Context};
use futures::stream::StreamExt;
use reqwest::Client;
use roxmltree::Document;
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;
use tracing::{debug, error, warn, info};

use crate::config::Config;
use crate::repository_context::RepositoryContext;
use crate::lsp_context::LspContextInfo;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ModelType {
    // Reasoning Models
    Arbiter,    // DeepSeek-R1, 128K context (default reasoning)
    Templar,    // Qwen3-30B-A3B, 128K context (>32GB RAM)
    
    // Execution Models  
    Dragoon,    // Qwen2.5-Coder-14B-Instruct-128K, 32K context (default execution)
    Immortal,   // Devstral-Small-2505, 128K context (>32GB RAM)
    
    // Utility Models
    Observer,   // gemma-3-4b-it, 128K context (summarization)
    
    Custom(String), // Custom model by name
}

impl ModelType {
    pub fn model_name(&self) -> String {
        match self {
            ModelType::Arbiter => "arbiter".to_string(),
            ModelType::Templar => "templar".to_string(),
            ModelType::Dragoon => "dragoon".to_string(),
            ModelType::Immortal => "immortal".to_string(),
            ModelType::Observer => "observer".to_string(),
            ModelType::Custom(name) => name.clone(),
        }
    }
    
    // description method removed - was unused
    
    pub fn from_name(name: &str) -> Self {
        match name.to_lowercase().as_str() {
            "arbiter" => ModelType::Arbiter,
            "templar" => ModelType::Templar,
            "dragoon" => ModelType::Dragoon,
            "immortal" => ModelType::Immortal,
            "observer" => ModelType::Observer,
            _ => ModelType::Custom(name.to_string()),
        }
    }
    
    pub fn calculate_dynamic_context(&self, estimated_tokens: usize) -> usize {
        // Apply safety margin (use 75% of context for conversation)
        let needed_context = (estimated_tokens as f64 / 0.75) as usize;
        
        // Determine model characteristics for context scaling
        let is_observer_like = match self {
            ModelType::Observer => true,
            ModelType::Custom(name) => name.starts_with("observer"),
            _ => false,
        };
        
        let context_size = if is_observer_like {
            // Observer model uses more conservative scaling due to smaller size
            match needed_context {
                0..=3072 => 4096,      // 4K (75% = 3K usable) - conservative start
                3073..=6144 => 8192,   // 8K (75% = 6K usable)
                6145..=12288 => 16384, // 16K (75% = 12K usable)
                12289..=24576 => 32768, // 32K (75% = 24K usable)
                _ => 65536,            // 64K max for observer (75% = 48K usable)
            }
        } else {
            // Standard scaling for larger models
            match needed_context {
                0..=6144 => 8192,      // 8K (75% = 6K usable)
                6145..=12288 => 16384,  // 16K (75% = 12K usable) 
                12289..=24576 => 32768, // 32K (75% = 24K usable)
                24577..=49152 => 65536, // 64K (75% = 48K usable)
                _ => 131072,           // 128K max (75% = 96K usable)
            }
        };
        
        context_size
    }
    
    // requires_high_ram method removed - was unused
    
    // is_reasoning_model method removed - was unused
    
    // is_execution_model method removed - was unused
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TaskPhase {
    Planning,   // Complex reasoning, task decomposition
    Execution,  // Tool calls, code generation
    Evaluation, // Result analysis, next step planning
    Completion, // Final summary and termination
}

impl TaskPhase {
    pub fn preferred_model(&self) -> ModelType {
        match self {
            TaskPhase::Planning => ModelType::Arbiter,
            TaskPhase::Execution => ModelType::Dragoon,
            TaskPhase::Evaluation => ModelType::Arbiter,
            TaskPhase::Completion => ModelType::Arbiter,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OperationMode {
    Arbiter,  // Full intelligence (reasoning + execution)
    Plan,     // Planning only (reasoning model)
    Act,      // Execution only (execution model)
}

impl OperationMode {
    pub fn cycle_next(&self) -> Self {
        match self {
            OperationMode::Arbiter => OperationMode::Plan,
            OperationMode::Plan => OperationMode::Act,
            OperationMode::Act => OperationMode::Arbiter,
        }
    }
    
    pub fn display_name(&self) -> &'static str {
        match self {
            OperationMode::Arbiter => "Arbiter",
            OperationMode::Plan => "Plan",
            OperationMode::Act => "Act",
        }
    }
    
    // display_color method removed - was unused
}

#[derive(Debug, Clone)]
pub struct ModelState {
    pub current_model: ModelType,
    pub current_phase: TaskPhase,
    pub switch_count: usize,
    pub last_switch_time: std::time::Instant,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Serialize)]
struct OllamaRequest {
    model: String,
    messages: Vec<Message>,
    stream: bool,
    options: OllamaOptions,
}

#[derive(Debug, Serialize)]
struct OllamaOptions {
    temperature: f32,
    num_ctx: usize,
    num_predict: usize,
}

#[derive(Debug, Deserialize)]
struct OllamaResponse {
    message: Message,
    done: bool,
}

#[derive(Debug, Deserialize)]
struct OllamaStreamResponse {
    message: Message,
    done: bool,
}

#[derive(Debug, Clone)]
pub enum StreamEvent {
    Text(String),
    Think(String),
    ThinkStart,           // Start of thinking block
    ThinkPartial(String), // For streaming thinking content
    ThinkEnd,            // End of thinking block
    ToolCall(ToolCall),
    Error(String),
    Done,
}

#[derive(Debug, Clone)]
pub struct ToolCall {
    pub name: String,
    pub args: String,
}

#[derive(Debug, Clone)]
pub struct ParsedResponse {
    pub text_content: String,
    pub thinking: Vec<String>,
    pub tool_calls: Vec<ToolCall>,
}

#[derive(Debug)]
pub struct AiClient {
    client: Client,
    config: Config,
    conversation_history: Vec<Message>,
    model_state: ModelState,
    repository_context: Option<RepositoryContext>,
    lsp_context: Option<LspContextInfo>,
    context_token_budget: usize,
}

impl AiClient {
    pub fn new(config: Config) -> Result<Self> {
        // Validate that we have essential models available
        let has_arbiter = config.orchestration.models.iter().any(|m| m.name == "arbiter");
        let has_dragoon = config.orchestration.models.iter().any(|m| m.name == "dragoon");
        
        if !has_arbiter && !has_dragoon {
            warn!("Neither reasoning (arbiter) nor execution (dragoon) models are configured. At least one should be available.");
        }
        
        // Choose initial model based on user configuration, with fallbacks
        // Use the exact configured model name and map to proper ModelType
        let configured_model = &config.user_model_selection.reasoning_model;
        
        let initial_model = if config.orchestration.models.iter().any(|m| m.name == *configured_model) {
            // Model exists in config, map to proper ModelType
            ModelType::from_name(configured_model)
        } else {
            // Fallback logic if configured model isn't available
            warn!("Configured reasoning model '{}' is not available. Falling back to default.", configured_model);
            if has_arbiter {
                ModelType::Arbiter
            } else if has_dragoon {
                ModelType::Dragoon
            } else {
                ModelType::Arbiter // Final fallback
            }
        };
        
        info!("Selected initial model: {:?} for reasoning_model config: '{}'", initial_model, configured_model);
        
        let ai_client = Self {
            client: Self::create_secure_client()?,
            config,
            conversation_history: Vec::new(),
            model_state: ModelState {
                current_model: initial_model,
                current_phase: TaskPhase::Planning,
                switch_count: 0,
                last_switch_time: std::time::Instant::now(),
            },
            repository_context: None,
            lsp_context: None,
            context_token_budget: 2048, // Default 2K tokens for context
        };
        
        info!("Initializing AI client with {} model ({})", 
              ai_client.model_state.current_model.model_name(),
              ai_client.get_current_model_server());
        
        Ok(ai_client)
    }
    
    /// Create a secure HTTP client with proper timeout and security settings
    fn create_secure_client() -> Result<Client> {
        use std::time::Duration;
        
        Client::builder()
            // Set reasonable timeouts to prevent hanging
            .timeout(Duration::from_secs(120)) // 2 minutes total timeout
            .connect_timeout(Duration::from_secs(30)) // 30 seconds to connect
            
            // Security settings - reqwest validates TLS by default
            // .danger_accept_invalid_certs(false) is the default (secure) behavior
            
            // Size limits to prevent memory exhaustion
            .redirect(reqwest::redirect::Policy::limited(10)) // Limit redirects
            
            // User agent for identification
            .user_agent("Arbiter/1.0")
            
            .build()
            .context("Failed to create secure HTTP client")
    }
    
    /// Switch to a different model if needed
    pub async fn switch_model_if_needed(&mut self, target_model: ModelType) -> Result<bool> {
        if self.model_state.current_model == target_model {
            return Ok(false); // No switch needed
        }
        
        // Check if target model is available (if it's in the list, it's enabled)
        let target_entry = match self.get_model_entry(&target_model) {
            Some(entry) => entry,
            None => {
                warn!("Model not found in configuration: {:?}. Staying with current model.", target_model);
                return Ok(false);
            }
        };
        
        let current_entry = self.get_model_entry(&self.model_state.current_model)
            .expect("Current model should always have valid entry");
        
        debug!("Switching from {} ({}) to {} ({})", 
               current_entry.name,
               current_entry.server,
               target_entry.name,
               target_entry.server);
        
        // Load the target model
        self.load_model(target_model.clone()).await?;
        
        // Update state
        self.model_state.current_model = target_model;
        self.model_state.switch_count += 1;
        self.model_state.last_switch_time = std::time::Instant::now();
        
        Ok(true)
    }
    
    /// Load a specific model in Ollama
    async fn load_model(&self, model_type: ModelType) -> Result<()> {
        let model_entry = match self.get_model_entry(&model_type) {
            Some(entry) => entry,
            None => {
                return Err(anyhow::anyhow!("Model not found in configuration: {:?}", model_type));
            }
        };
        
        // First, try to pull/load the model to ensure it's available
        let pull_response = self.client
            .post(&format!("{}/api/pull", model_entry.server))
            .json(&serde_json::json!({
                "name": model_entry.name,
                "stream": false
            }))
            .send()
            .await
            .context("Failed to load model")?;
            
        if !pull_response.status().is_success() {
            let error_text = pull_response.text().await.unwrap_or_default();
            warn!("Model load returned non-success status: {}", error_text);
            // Continue anyway - model might already be loaded
        }
        
        debug!("Successfully loaded model: {} from {}", model_entry.name, model_entry.server);
        Ok(())
    }
    
    /// Get current model information
    pub fn get_model_state(&self) -> &ModelState {
        &self.model_state
    }
    
    /// Get the current model configuration
    fn get_model_entry(&self, model_type: &ModelType) -> Option<&crate::config::ModelEntry> {
        let model_name = match model_type {
            ModelType::Custom(name) => name.as_str(),
            _ => &model_type.model_name(),
        };
        
        self.config.orchestration.models
            .iter()
            .find(|model| model.name == model_name)
    }
    
    /// Get the current model name from config
    fn get_current_model_name(&self) -> String {
        self.get_model_entry(&self.model_state.current_model)
            .map(|entry| entry.name.clone())
            .unwrap_or_else(|| self.model_state.current_model.model_name())
    }
    
    /// Get the current model temperature (from modelfile, use default for now)
    fn get_current_model_temperature(&self) -> f32 {
        // Temperature is now configured in modelfiles, use reasonable defaults
        match &self.model_state.current_model {
            ModelType::Arbiter | ModelType::Templar => 0.7,           // Reasoning models - more creative
            ModelType::Dragoon | ModelType::Immortal => 0.15,         // Execution models - more precise  
            ModelType::Observer => 0.3,                               // Observer - balanced
            ModelType::Custom(name) => {
                // Determine temperature based on model name patterns
                if name.starts_with("observer") {
                    0.3  // Observer-like models - balanced
                } else if name.starts_with("dragoon") {
                    0.15 // Execution-like models - more precise
                } else if name.starts_with("arbiter") || name.starts_with("templar") || name.starts_with("immortal") {
                    0.7  // Reasoning-like models - more creative
                } else {
                    0.7  // Default for unknown custom models
                }
            }
        }
    }
    
    /// Get the current model server endpoint
    fn get_current_model_server(&self) -> String {
        self.get_model_entry(&self.model_state.current_model)
            .map(|entry| entry.server.clone())
            .unwrap_or_else(|| "http://localhost:11434".to_string()) // Default server
    }
    
    /// Get the current model context limit (dynamically calculated)
    fn get_current_model_context_limit(&self) -> usize {
        let current_tokens = self.estimate_token_count();
        let dynamic_context = self.model_state.current_model.calculate_dynamic_context(current_tokens);
        
        // Log context size decisions for debugging
        debug!("Dynamic context calculation: {} estimated tokens → {} context size", 
               current_tokens, dynamic_context);
        
        dynamic_context
    }
    
    /// Set task phase and switch model if needed
    pub async fn set_task_phase(&mut self, phase: TaskPhase) -> Result<bool> {
        self.model_state.current_phase = phase;
        let preferred_model = phase.preferred_model();
        self.switch_model_if_needed(preferred_model).await
    }
    
    /// Get all available models (if it's in the config, it's available)
    pub fn get_available_models(&self) -> Vec<(ModelType, &crate::config::ModelEntry)> {
        self.config.orchestration.models
            .iter()
            .map(|entry| {
                let model_type = ModelType::from_name(&entry.name);
                (model_type, entry)
            })
            .collect()
    }
    
    /// Force switch to a specific model by name
    pub async fn switch_to_model_by_name(&mut self, model_name: &str) -> Result<bool> {
        if !self.config.orchestration.allow_model_override {
            return Err(anyhow::anyhow!("Model override is disabled in configuration"));
        }
        
        let target_model = ModelType::from_name(model_name);
        
        // Check if the model is available (if it's in the list, it's enabled)
        match self.get_model_entry(&target_model) {
            Some(entry) => {
                info!("Manual model switch requested to: {} ({})", entry.name, entry.server);
                self.switch_model_if_needed(target_model).await
            }
            None => {
                Err(anyhow::anyhow!("Model '{}' not found in configuration", model_name))
            }
        }
    }
    
    /// Classify request complexity to determine if planning is needed
    pub fn classify_request_complexity(&self, input: &str) -> TaskPhase {
        let input_lower = input.to_lowercase();
        
        // Direct execution indicators
        let direct_execution_patterns = [
            "ls", "pwd", "cat", "echo", "git status", "git log",
            "read file", "show me", "what is in", "list",
        ];
        
        // Complex planning indicators  
        let complex_planning_patterns = [
            "create", "build", "implement", "design", "refactor", "optimize",
            "how do i", "help me", "i need to", "can you", "debug", "fix",
            "analyze", "review", "improve", "add feature", "modify",
        ];
        
        // Check for direct execution patterns
        for pattern in &direct_execution_patterns {
            if input_lower.contains(pattern) {
                return TaskPhase::Execution;
            }
        }
        
        // Check for complex planning patterns
        for pattern in &complex_planning_patterns {
            if input_lower.contains(pattern) {
                return TaskPhase::Planning;
            }
        }
        
        // Default to planning for ambiguous requests
        TaskPhase::Planning
    }
    
    /// Set repository context for enhanced AI understanding
    pub fn set_repository_context(&mut self, context: RepositoryContext) {
        debug!("Setting repository context: {} files, {} symbols", context.file_count, context.total_symbols);
        self.repository_context = Some(context);
    }
    
    /// Set LSP context for real-time language analysis
    pub fn set_lsp_context(&mut self, context: LspContextInfo) {
        debug!("Setting LSP context: {} errors, {} warnings", context.error_count, context.warning_count);
        self.lsp_context = Some(context);
    }
    
    /// Set the token budget for repository and LSP context
    pub fn set_context_token_budget(&mut self, budget: usize) {
        debug!("Setting context token budget: {}", budget);
        self.context_token_budget = budget;
    }
    
    /// Add system message with optional repository and LSP context integration
    pub fn add_system_message(&mut self, content: &str) {
        self.add_system_message_with_context(content, true);
    }
    
    /// Add system message with control over context inclusion
    pub fn add_system_message_with_context(&mut self, content: &str, include_context: bool) {
        // Build enhanced system prompt with repository and LSP context
        let mut system_parts = Vec::new();
        
        // Add repository context if available and requested
        if include_context {
            if let Some(ref repo_context) = self.repository_context {
                if let Ok(repo_section) = self.build_repository_context_section(repo_context) {
                    if !repo_section.is_empty() {
                        system_parts.push(repo_section);
                        debug!("Added repository context to system prompt");
                    }
                }
            }
            
            // Add LSP context if available and requested
            if let Some(ref lsp_context) = self.lsp_context {
                if let Ok(lsp_section) = self.build_lsp_context_section(lsp_context) {
                    if !lsp_section.is_empty() {
                        system_parts.push(lsp_section);
                        debug!("Added LSP context to system prompt");
                    }
                }
            }
        }
        
        // Add the main content
        system_parts.push(content.to_string());
        
        // Combine all parts
        let enhanced_content = system_parts.join("\n\n");
        
        // Add system prompt that instructs the model to use XML format
        let system_content = format!(
            r#"{}

IMPORTANT: Structure your responses using XML tags:
- Wrap your reasoning in <think></think> tags
- Use <tool_call name="tool_name">arguments</tool_call> for tool usage
- Regular text should be outside any tags
- CRITICAL: Make only ONE tool call per response - wait for results before proceeding
- Always think before using tools and analyze results after each tool execution

## AVAILABLE TOOLS

### 1. shell_command
**Purpose**: Execute shell commands directly in the user's environment
**Arguments**: JSON with "command" key containing the shell command
**Usage**: For file operations, process management, system info, etc.
**Examples**:
- List files: {{"command": "ls -la"}}
- Check disk space: {{"command": "df -h"}}
- Find files: {{"command": "find . -name '*.rs'"}}
- Run tests: {{"command": "cargo test"}}
- View processes: {{"command": "ps aux"}}

### 2. write_file
**Purpose**: Create or overwrite files with specified content
**Arguments**: JSON with "path" and "content" keys
**Usage**: Creating new files, saving code, writing documentation
**Examples**:
- Create config: {{"path": "config.toml", "content": "debug = true\\nport = 8080"}}
- Write code: {{"path": "src/lib.rs", "content": "pub fn hello() {{\\n    println!(\\\"Hello, world!\\\");\\n}}"}}
- Save data: {{"path": "data.json", "content": "{{\\\"users\\\": [], \\\"settings\\\": {{}}}}"}} 

### 3. read_file
**Purpose**: Read and display file contents
**Arguments**: JSON with "path" key containing the file path
**Usage**: Examining code, config files, logs, documentation
**Examples**:
- Read source: {{"path": "src/main.rs"}}
- Check config: {{"path": "Cargo.toml"}}
- View logs: {{"path": "app.log"}}

### 4. git_command
**Purpose**: Execute git operations
**Arguments**: JSON with "command" key containing git subcommand and args
**Usage**: Version control operations, repository management
**Examples**:
- Check status: {{"command": "status"}}
- View history: {{"command": "log --oneline -10"}}
- Show changes: {{"command": "diff"}}
- Add files: {{"command": "add ."}}
- Commit: {{"command": "commit -m 'feat: add new feature'"}}

### 5. code_analysis
**Purpose**: Analyze code structure and extract symbols
**Arguments**: JSON with "path" key containing the file path
**Usage**: Understanding codebases, finding functions/classes, code review
**Examples**:
- Analyze Rust: {{"path": "src/lib.rs"}}
- Check Python: {{"path": "main.py"}}
- Review JS: {{"path": "app.js"}}

## TOOL USAGE PATTERNS

**Single Tool Execution**: Always execute ONE tool per response, analyze results, then proceed.

**Error Handling**: If a tool fails, explain the error and suggest alternatives.

**File Paths**: Use relative paths from the current working directory unless absolute paths are needed.

**Command Safety**: Avoid destructive commands without explicit user confirmation.

## EXAMPLE INTERACTIONS

**Example 1 - File Listing**:
<think>
The user wants to see what files are in the current directory. I'll use shell_command to list files with detailed information.
</think>

I'll show you what files are in the current directory.

<tool_call name="shell_command">ls -la</tool_call>

**Example 2 - Code Creation**:
<think>
The user wants me to create a new Rust function. I should write this to a file using write_file with proper Rust syntax.
</think>

I'll create a new Rust file with the function you requested.

<tool_call name="write_file">{{"path": "src/utils.rs", "content": "/// Calculate the factorial of a number\\npub fn factorial(n: u64) -> u64 {{\\n    match n {{\\n        0 | 1 => 1,\\n        _ => n * factorial(n - 1),\\n    }}\\n}}\\n\\n#[cfg(test)]\\nmod tests {{\\n    use super::*;\\n\\n    #[test]\\n    fn test_factorial() {{\\n        assert_eq!(factorial(0), 1);\\n        assert_eq!(factorial(5), 120);\\n    }}\\n}}"}}</tool_call>

**Example 3 - Git Operations**:
<think>
The user wants to check the git status. I'll use git_command to see what changes are present in the repository.
</think>

Let me check the current git status of your repository.

<tool_call name="git_command">status</tool_call>"#,
            enhanced_content
        );
        
        self.conversation_history.push(Message {
            role: "system".to_string(),
            content: system_content,
        });
    }
    
    /// Build repository context section for system prompt
    fn build_repository_context_section(&self, repo_context: &RepositoryContext) -> anyhow::Result<String> {
        use crate::repository_context::RepositoryContextManager;
        
        // Calculate available tokens (reserve some for LSP context)
        let available_tokens = if self.lsp_context.is_some() {
            self.context_token_budget / 2  // Split between repo and LSP
        } else {
            self.context_token_budget      // Use all for repository
        };
        
        // Create a temporary manager to format the context
        // Note: This is a simplified approach - in production we'd pass the manager instance
        let temp_manager = RepositoryContextManager::new(None)?;
        let formatted_context = temp_manager.get_context_for_token_limit(repo_context, available_tokens)?;
        
        if formatted_context.trim().is_empty() {
            return Ok(String::new());
        }
        
        Ok(format!(
            "# REPOSITORY CONTEXT\n{}\n---\n",
            formatted_context
        ))
    }
    
    /// Build LSP context section for system prompt
    fn build_lsp_context_section(&self, lsp_context: &LspContextInfo) -> anyhow::Result<String> {
        use crate::lsp_context::LspContextExtractor;
        
        // Calculate available tokens (reserve some for repository context)
        let available_tokens = if self.repository_context.is_some() {
            self.context_token_budget / 2  // Split between repo and LSP
        } else {
            self.context_token_budget      // Use all for LSP
        };
        
        // Create a temporary extractor to format the context
        // Note: This is a simplified approach - in production we'd pass the extractor instance
        let temp_extractor = LspContextExtractor::new(self.config.clone(), None)?;
        let formatted_context = temp_extractor.format_context_for_prompt(lsp_context, available_tokens)?;
        
        if formatted_context.trim().is_empty() {
            return Ok(String::new());
        }
        
        Ok(format!(
            "# LANGUAGE SERVER ANALYSIS\n{}\n---\n",
            formatted_context
        ))
    }
    
    pub fn add_user_message(&mut self, content: &str) {
        self.conversation_history.push(Message {
            role: "user".to_string(),
            content: content.to_string(),
        });
    }
    
    pub fn add_assistant_message(&mut self, content: &str) {
        self.conversation_history.push(Message {
            role: "assistant".to_string(),
            content: content.to_string(),
        });
    }
    
    pub fn add_tool_result(&mut self, tool_name: &str, result: &str) {
        let content = format!("TOOL EXECUTION COMPLETED:\nTool: {}\nResult:\n```\n{}\n```\n\nIMPORTANT: Do not repeat this same command. Analyze the result above and determine the next logical step to complete the user's request. If this was a directory listing, look for specific files. If this was a file read, process the content. Always move forward in your task.", tool_name, result);
        self.conversation_history.push(Message {
            role: "user".to_string(),
            content,
        });
    }
    
    /// Add tool result with Observer summarization for large outputs
    pub async fn add_tool_result_with_observer(&mut self, tool_name: &str, result: &str) -> Result<()> {
        // Check if result is large enough to warrant Observer processing
        if result.len() > 2000 {
            match self.summarize_with_observer(tool_name, result).await {
                Ok(summary) => {
                    let content = format!("TOOL EXECUTION COMPLETED:\nTool: {}\nResult (summarized by Observer):\n```\n{}\n```\n\nIMPORTANT: Do not repeat this same command. Analyze the result above and determine the next logical step to complete the user's request. If this was a directory listing, look for specific files. If this was a file read, process the content. Always move forward in your task.", tool_name, summary);
                    self.conversation_history.push(Message {
                        role: "user".to_string(),
                        content,
                    });
                }
                Err(e) => {
                    warn!("Observer summarization failed, using original result: {}", e);
                    self.add_tool_result(tool_name, result);
                }
            }
        } else {
            // Use original result for smaller outputs
            self.add_tool_result(tool_name, result);
        }
        Ok(())
    }
    
    /// Summarize content using Observer model
    async fn summarize_with_observer(&self, tool_name: &str, content: &str) -> Result<String> {
        let observer_entry = self.get_model_entry(&ModelType::Observer)
            .context("Observer model not found in configuration")?;
        
        let prompt = format!(
            "You are Observer, an AI assistant specialized in intelligent context summarization.\n\
            \n\
            Please summarize the following {} output, focusing on:\n\
            • Key findings and important results\n\
            • Any errors, warnings, or critical status information\n\
            • Relevant file paths, line numbers, and specific details\n\
            • Command success/failure status and exit codes\n\
            • Technical information needed for debugging and troubleshooting\n\
            \n\
            Provide a concise summary that preserves essential information while reducing verbosity:\n\
            \n\
            {}\n\
            \n\
            Please provide a brief but comprehensive summary that maintains technical accuracy:",
            tool_name, content
        );
        
        let messages = vec![Message {
            role: "user".to_string(),
            content: prompt,
        }];
        
        let request = OllamaRequest {
            model: observer_entry.name.clone(),
            messages,
            stream: false,
            options: OllamaOptions {
                temperature: 0.3, // Observer model temperature
                num_ctx: ModelType::Observer.calculate_dynamic_context(0), // Start with minimal context for quick response
                num_predict: 2048,
            },
        };
        
        let response = self.client
            .post(&format!("{}/api/chat", observer_entry.server))
            .json(&request)
            .send()
            .await
            .context("Failed to send Observer request")?;
        
        if !response.status().is_success() {
            let status = response.status();
            let error_text = response.text().await.unwrap_or_default();
            return Err(anyhow::anyhow!("Observer request failed with status {}: {}", status, error_text));
        }
        
        let ollama_response: OllamaResponse = response
            .json()
            .await
            .context("Failed to parse Observer response")?;
        
        Ok(ollama_response.message.content)
    }
    
    pub async fn chat_stream(&mut self, user_input: &str) -> Result<mpsc::Receiver<StreamEvent>> {
        // Only add user message if it's not empty (for continuation calls)
        if !user_input.is_empty() {
            self.add_user_message(user_input);
        }
        
        // Compress context if we're approaching limits (use 75% of dynamic context)
        let dynamic_context = self.get_current_model_context_limit();
        let compression_threshold = (dynamic_context as f64 * 0.75) as usize;
        let current_tokens = self.estimate_token_count();
        
        if current_tokens > compression_threshold {
            info!("Compressing conversation: {} tokens exceeds {}% of {} context limit", 
                  current_tokens, 75, dynamic_context);
            self.compress_conversation_context();
        }
        
        let dynamic_context = self.get_current_model_context_limit();
        let request = OllamaRequest {
            model: self.get_current_model_name(),
            messages: self.conversation_history.clone(),
            stream: true,
            options: OllamaOptions {
                temperature: self.get_current_model_temperature(),
                num_ctx: dynamic_context,
                num_predict: 4096, // Standard token limit for generation
            },
        };
        
        info!("Sending request with dynamic context size: {} tokens for {} estimated conversation tokens", 
              dynamic_context, self.estimate_token_count());
        
        let server_endpoint = self.get_current_model_server();
        debug!("Sending streaming request to {} using {} model: {:?}", 
               server_endpoint, self.get_current_model_name(), request);
        
        let response = self
            .client
            .post(&format!("{}/api/chat", server_endpoint))
            .json(&request)
            .send()
            .await
            .context("Failed to send request to Ollama")?;
        
        if !response.status().is_success() {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            error!("Ollama request failed: {} - {}", status, text);
            return Err(anyhow::anyhow!("Ollama request failed: {} - {}", status, text));
        }
        
        let (tx, rx) = mpsc::channel(100);
        let mut stream = response.bytes_stream();
        let tx_clone = tx.clone();
        
        tokio::spawn(async move {
            let mut buffer = String::new();
            let mut xml_parser = XmlStreamParser::new();
            
            while let Some(chunk_result) = stream.next().await {
                match chunk_result {
                    Ok(chunk) => {
                        if let Ok(text) = String::from_utf8(chunk.to_vec()) {
                            // Parse each line as potential JSON
                            for line in text.lines() {
                                if line.trim().is_empty() {
                                    continue;
                                }
                                
                                match serde_json::from_str::<OllamaStreamResponse>(line) {
                                    Ok(response) => {
                                        buffer.push_str(&response.message.content);
                                        
                                        // Debug: log the raw content we're receiving
                                        if !response.message.content.trim().is_empty() {
                                            debug!("Raw AI content: {:?}", response.message.content);
                                        }
                                        
                                        // Process the new chunk for XML parsing  
                                        let events = xml_parser.process_chunk(&response.message.content);
                                        for event in events {
                                            if tx_clone.send(event).await.is_err() {
                                                return;
                                            }
                                        }
                                        
                                        if response.done {
                                            // Final parse of any remaining content
                                            let final_events = xml_parser.finalize();
                                            for event in final_events {
                                                if tx_clone.send(event).await.is_err() {
                                                    return;
                                                }
                                            }
                                            
                                            if tx_clone.send(StreamEvent::Done).await.is_err() {
                                                return;
                                            }
                                            break;
                                        }
                                    }
                                    Err(e) => {
                                        warn!("Failed to parse streaming response: {} - Line: {}", e, line);
                                    }
                                }
                            }
                        }
                    }
                    Err(e) => {
                        let _ = tx_clone.send(StreamEvent::Error(format!("Stream error: {}", e))).await;
                        break;
                    }
                }
            }
        });
        
        Ok(rx)
    }
    
    /// Estimate token count for conversation history
    fn estimate_token_count(&self) -> usize {
        // More accurate token estimation based on text analysis
        let mut total_tokens = 0;
        
        for msg in &self.conversation_history {
            total_tokens += Self::estimate_text_tokens(&msg.content);
            // Add overhead for message structure (role, formatting, etc.)
            total_tokens += 10; // JSON structure overhead per message
        }
        
        total_tokens
    }
    
    /// Estimate tokens for a piece of text using linguistic analysis
    fn estimate_text_tokens(text: &str) -> usize {
        let mut tokens = 0;
        let mut chars = text.chars().peekable();
        
        while let Some(ch) = chars.next() {
            if ch.is_whitespace() {
                // Skip whitespace, but count word boundaries
                continue;
            } else if ch.is_alphabetic() {
                // Count words (sequences of alphabetic characters)
                tokens += 1;
                while let Some(&next_ch) = chars.peek() {
                    if next_ch.is_alphabetic() || next_ch == '\'' {
                        chars.next(); // consume character
                    } else {
                        break;
                    }
                }
            } else if ch.is_numeric() {
                // Count numbers
                tokens += 1;
                while let Some(&next_ch) = chars.peek() {
                    if next_ch.is_numeric() || next_ch == '.' {
                        chars.next();
                    } else {
                        break;
                    }
                }
            } else if ch.is_ascii_punctuation() {
                // Most punctuation is its own token
                tokens += 1;
                
                // Handle multi-character operators/symbols
                if ch == '=' || ch == '!' || ch == '<' || ch == '>' || ch == ':' {
                    if let Some(&next_ch) = chars.peek() {
                        if next_ch == '=' {
                            chars.next(); // consume the second '='
                        }
                    }
                }
            } else {
                // Unicode, emojis, special characters - often 1-2 tokens each
                tokens += if ch.len_utf8() > 1 { 2 } else { 1 };
            }
        }
        
        // Ensure minimum of 1 token for non-empty text
        if tokens == 0 && !text.is_empty() {
            tokens = 1;
        }
        
        tokens
    }
    
    /// Intelligently compress conversation context when approaching limits
    fn compress_conversation_context(&mut self) {
        if self.conversation_history.len() <= 4 {
            return; // Keep minimum context
        }
        
        let target_token_limit = (self.get_current_model_context_limit() as f64 * 0.6) as usize; // Use 60% after compression to leave room for response
        let current_tokens = self.estimate_token_count();
        
        info!("Compressing conversation context from {} messages ({} tokens) to fit within {} tokens", 
              self.conversation_history.len(), current_tokens, target_token_limit);
        
        // Always preserve system message
        let mut preserved = Vec::new();
        let mut preserved_tokens = 0;
        
        if let Some(system_msg) = self.conversation_history.first() {
            if system_msg.role == "system" {
                preserved_tokens += system_msg.content.len() / 4; // Rough token estimate
                preserved.push(system_msg.clone());
            }
        }
        
        // Work backwards from the most recent messages, keeping as many as fit
        let mut messages_to_keep = Vec::new();
        for msg in self.conversation_history.iter().rev() {
            if msg.role == "system" {
                continue; // Already handled system message
            }
            
            let msg_tokens = msg.content.len() / 4;
            if preserved_tokens + msg_tokens < target_token_limit {
                preserved_tokens += msg_tokens;
                messages_to_keep.push(msg.clone());
            } else {
                break; // Would exceed limit
            }
        }
        
        // Reverse to restore chronological order
        messages_to_keep.reverse();
        
        // Add all preserved messages
        preserved.extend(messages_to_keep);
        
        // Add compression notice if we removed messages
        if preserved.len() < self.conversation_history.len() {
            let removed_count = self.conversation_history.len() - preserved.len();
            let compression_msg = Message {
                role: "system".to_string(),
                content: format!("[Context management: Preserved {} recent messages ({} tokens) for optimal performance. {} earlier messages compressed.]", 
                                preserved.len() - 1, preserved_tokens, removed_count),
            };
            
            // Insert after system message
            if preserved.len() > 1 {
                preserved.insert(1, compression_msg);
            } else {
                preserved.push(compression_msg);
            }
        }
        
        self.conversation_history = preserved;
        debug!("Compressed conversation to {} messages (~{} tokens)", 
               self.conversation_history.len(), preserved_tokens);
    }
    
    /// Create a task-focused context for model handoff
    pub fn create_handoff_context(&self, task_summary: &str, current_phase: TaskPhase) -> Vec<Message> {
        let mut handoff_context = Vec::new();
        
        // Create phase-specific system message
        let phase_instruction = match current_phase {
            TaskPhase::Planning => {
                "You are in PLANNING phase. Focus on breaking down the task, understanding requirements, and creating a clear execution strategy."
            }
            TaskPhase::Execution => {
                "You are in EXECUTION phase. Focus on implementing the plan using available tools. Be precise and systematic."
            }
            TaskPhase::Evaluation => {
                "You are in EVALUATION phase. Analyze the results, check for errors, and determine next steps."
            }
            TaskPhase::Completion => {
                "You are in COMPLETION phase. Provide a final summary and ensure all requirements are met."
            }
        };
        
        handoff_context.push(Message {
            role: "system".to_string(),
            content: format!("{}\n\nCurrent task: {}", phase_instruction, task_summary),
        });
        
        // Include recent relevant context
        let relevant_messages: Vec<_> = self.conversation_history
            .iter()
            .rev()
            .take(3) // Last 3 messages for immediate context
            .filter(|msg| msg.role != "system") // Skip system messages except our phase instruction
            .cloned()
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect();
            
        handoff_context.extend(relevant_messages);
        
        handoff_context
    }
    
    pub fn parse_xml_response(&self, content: &str) -> ParsedResponse {
        let mut text_content = String::new();
        let mut thinking = Vec::new();
        let mut tool_calls = Vec::new();
        
        // Try to parse as XML, but handle partial/malformed XML gracefully
        if let Ok(doc) = Document::parse(content) {
            for node in doc.descendants() {
                match node.tag_name().name() {
                    "think" => {
                        if let Some(text) = node.text() {
                            thinking.push(text.to_string());
                        }
                    }
                    "tool_call" => {
                        if let Some(name) = node.attribute("name") {
                            let args = node.text().unwrap_or("").to_string();
                            tool_calls.push(ToolCall {
                                name: name.to_string(),
                                args,
                            });
                        }
                    }
                    _ => {
                        if let Some(text) = node.text() {
                            if !text.trim().is_empty() {
                                text_content.push_str(text);
                            }
                        }
                    }
                }
            }
        } else {
            // Fallback: manual parsing for streaming/partial content
            let (extracted_text, extracted_thinking, extracted_tools) = self.manual_xml_parse(content);
            text_content = extracted_text;
            thinking = extracted_thinking;
            tool_calls = extracted_tools;
        }
        
        ParsedResponse {
            text_content,
            thinking,
            tool_calls,
        }
    }
    
    fn manual_xml_parse(&self, content: &str) -> (String, Vec<String>, Vec<ToolCall>) {
        let mut text_content = String::new();
        let mut thinking = Vec::new();
        let mut tool_calls = Vec::new();
        
        let mut current_pos = 0;
        let content_chars: Vec<char> = content.chars().collect();
        
        while current_pos < content_chars.len() {
            if content_chars[current_pos] == '<' {
                // Try to parse a tag
                if let Some((tag_name, tag_content, end_pos)) = self.extract_xml_tag(&content_chars, current_pos) {
                    match tag_name.as_str() {
                        "think" => thinking.push(tag_content),
                        tag if tag.starts_with("tool_call") => {
                            // Extract tool name from attributes
                            if let Some(name_start) = tag.find("name=\"") {
                                let name_start = name_start + 6;
                                if let Some(name_end) = tag[name_start..].find('"') {
                                    let tool_name = tag[name_start..name_start + name_end].to_string();
                                    tool_calls.push(ToolCall {
                                        name: tool_name,
                                        args: tag_content,
                                    });
                                }
                            }
                        }
                        _ => {
                            // Regular text content
                            text_content.push_str(&tag_content);
                        }
                    }
                    current_pos = end_pos;
                } else {
                    // Not a valid tag, treat as regular text
                    text_content.push(content_chars[current_pos]);
                    current_pos += 1;
                }
            } else {
                text_content.push(content_chars[current_pos]);
                current_pos += 1;
            }
        }
        
        (text_content.trim().to_string(), thinking, tool_calls)
    }
    
    fn extract_xml_tag(&self, chars: &[char], start_pos: usize) -> Option<(String, String, usize)> {
        if start_pos >= chars.len() || chars[start_pos] != '<' {
            return None;
        }
        
        // Find the end of the opening tag
        let mut tag_end = start_pos + 1;
        while tag_end < chars.len() && chars[tag_end] != '>' {
            tag_end += 1;
        }
        
        if tag_end >= chars.len() {
            return None; // Incomplete tag
        }
        
        let opening_tag: String = chars[start_pos + 1..tag_end].iter().collect();
        let tag_name = opening_tag.split_whitespace().next()?.to_string();
        
        // Find the closing tag
        let closing_tag = format!("</{}>", tag_name);
        let content_start = tag_end + 1;
        
        let remaining: String = chars[content_start..].iter().collect();
        if let Some(closing_pos) = remaining.find(&closing_tag) {
            let content = remaining[..closing_pos].to_string();
            let end_pos = content_start + closing_pos + closing_tag.len();
            Some((tag_name, content, end_pos))
        } else {
            None // No closing tag found
        }
    }
}

#[derive(Debug, Clone)]
enum ParserState {
    Text,
    InThink,
    InToolCall(String), // tool name
    LookingForTag,
}

struct XmlStreamParser {
    buffer: String,
    state: ParserState,
    min_buffer_size: usize, // Buffer 4-6 tokens (~32-48 chars) before parsing
    thinking_depth: usize, // Track nested thinking tags to prevent tool execution inside thinking
}

impl XmlStreamParser {
    fn new() -> Self {
        Self {
            buffer: String::new(),
            state: ParserState::Text,
            min_buffer_size: 40, // ~5-6 tokens
            thinking_depth: 0,
        }
    }
    
    fn process_chunk(&mut self, chunk: &str) -> Vec<StreamEvent> {
        // Add chunk to buffer
        self.buffer.push_str(chunk);
        
        // Process buffer recursively if we have enough content
        if self.buffer.len() >= self.min_buffer_size {
            self.parse_buffer_recursive()
        } else {
            Vec::new() // Wait for more content
        }
    }
    
    fn parse_buffer_recursive(&mut self) -> Vec<StreamEvent> {
        let mut events = Vec::new();
        
        loop {
            let initial_buffer_len = self.buffer.len();
            
            match self.state {
                ParserState::Text => {
                    events.extend(self.parse_text_content());
                }
                ParserState::InThink => {
                    events.extend(self.parse_thinking_content());
                }
                ParserState::InToolCall(ref tool_name) => {
                    let tool_name = tool_name.clone(); // Clone to avoid borrow issues
                    events.extend(self.parse_tool_call_content(&tool_name));
                }
                ParserState::LookingForTag => {
                    events.extend(self.parse_looking_for_tag());
                }
            }
            
            // If buffer didn't change, we need more content
            if self.buffer.len() == initial_buffer_len {
                break;
            }
        }
        
        events
    }
    
    fn parse_text_content(&mut self) -> Vec<StreamEvent> {
        let mut events = Vec::new();
        
        if let Some(tag_start) = self.buffer.find('<') {
            // Emit text before the tag
            if tag_start > 0 {
                let text_content = self.buffer[..tag_start].to_string();
                events.push(StreamEvent::Text(text_content));
                self.buffer.drain(..tag_start);
            }
            let debug_len = std::cmp::min(50, self.buffer.len());
            let debug_boundary = self.buffer.char_indices()
                .map(|(i, _)| i)
                .take_while(|&i| i <= debug_len)
                .last()
                .unwrap_or(0);
            debug!("Found '<' character in text, transitioning to LookingForTag. Remaining buffer: {:?}", &self.buffer[..debug_boundary]);
            self.state = ParserState::LookingForTag;
        } else {
            // No tags found - emit safe portion of buffer as text
            let safe_emit_len = if self.buffer.len() > self.min_buffer_size {
                self.buffer.len() - (self.min_buffer_size / 2) // Keep some buffer for potential tags
            } else {
                0
            };
            
            if safe_emit_len > 0 {
                // Find the nearest valid UTF-8 character boundary at or before safe_emit_len
                let safe_boundary = self.buffer.char_indices()
                    .map(|(i, _)| i)
                    .take_while(|&i| i <= safe_emit_len)
                    .last()
                    .unwrap_or(0);
                
                if safe_boundary > 0 {
                    let text_content = self.buffer[..safe_boundary].to_string();
                    events.push(StreamEvent::Text(text_content));
                    self.buffer.drain(..safe_boundary);
                }
            }
        }
        
        events
    }
    
    fn parse_looking_for_tag(&mut self) -> Vec<StreamEvent> {
        let mut events = Vec::new();
        
        if let Some(tag_end) = self.buffer.find('>') {
            let tag = &self.buffer[..tag_end + 1];
            debug!("Looking for tag, found: {:?}", tag);
            
            if tag == "<think>" {
                self.thinking_depth += 1;
                self.state = ParserState::InThink;
                events.push(StreamEvent::ThinkStart);
                self.buffer.drain(..tag_end + 1);
            } else if tag == "</think>" {
                if self.thinking_depth > 0 {
                    self.thinking_depth -= 1;
                }
                // This shouldn't happen in normal parsing, but handle it gracefully
                self.state = ParserState::Text;
                events.push(StreamEvent::ThinkEnd);
                self.buffer.drain(..tag_end + 1);
            } else if tag.starts_with("<tool_call") && tag.contains("name=") {
                debug!("Detected potential tool_call tag: {:?}, thinking_depth: {}", tag, self.thinking_depth);
                // CRITICAL: Ignore tool calls if we're inside thinking content
                if self.thinking_depth > 0 {
                    debug!("Ignoring tool call inside thinking content");
                    // Treat as regular text when inside thinking
                    self.state = ParserState::Text;
                    let thinking_text = self.buffer[..tag_end + 1].to_string();
                    events.push(StreamEvent::Text(thinking_text));
                    self.buffer.drain(..tag_end + 1);
                } else {
                    // Normal tool call processing when not in thinking
                    if let Some(tool_name) = self.extract_tool_name(tag) {
                        debug!("Processing tool call: {}", tool_name);
                        self.state = ParserState::InToolCall(tool_name);
                        self.buffer.drain(..tag_end + 1);
                    } else {
                        debug!("Invalid tool_call tag, treating as text: {:?}", tag);
                        // Invalid tool_call, treat as text
                        self.state = ParserState::Text;
                        let invalid_tag = self.buffer[..tag_end + 1].to_string();
                        events.push(StreamEvent::Text(invalid_tag));
                        self.buffer.drain(..tag_end + 1);
                    }
                }
            } else {
                // Not a special tag, treat as regular text
                debug!("Non-special tag treated as text: {:?}", tag);
                self.state = ParserState::Text;
                let regular_tag = self.buffer[..tag_end + 1].to_string();
                events.push(StreamEvent::Text(regular_tag));
                self.buffer.drain(..tag_end + 1);
            }
        } else if self.buffer.len() > 100 {
            // Tag too long or incomplete, treat as text
            self.state = ParserState::Text;
            let invalid_content = self.buffer.clone();
            events.push(StreamEvent::Text(invalid_content));
            self.buffer.clear();
        }
        
        events
    }
    
    fn parse_thinking_content(&mut self) -> Vec<StreamEvent> {
        let mut events = Vec::new();
        
        if let Some(end_pos) = self.buffer.find("</think>") {
            // Found closing tag - emit thinking content and transition to text
            let thinking_content = self.buffer[..end_pos].to_string();
            if !thinking_content.trim().is_empty() {
                // Emit thinking content in chunks for streaming effect
                // IMPORTANT: Treat ALL content as thinking text, ignoring any nested tags
                for chunk in thinking_content.chars().collect::<Vec<_>>().chunks(3) {
                    let chunk_str: String = chunk.iter().collect();
                    events.push(StreamEvent::ThinkPartial(chunk_str));
                }
            }
            events.push(StreamEvent::ThinkEnd);
            
            // Decrement thinking depth and transition to text
            if self.thinking_depth > 0 {
                self.thinking_depth -= 1;
            }
            self.buffer.drain(..end_pos + 8); // Remove content + "</think>"
            self.state = ParserState::Text;
        } else {
            // No closing tag yet - emit safe portion of content
            // Be more conservative to avoid cutting off "</think>" tag
            let safe_emit_len = if self.buffer.len() > 25 {
                // Find safe position that doesn't cut off potential closing tag
                let target_len = self.buffer.len() - 15; // Keep buffer for "</think>"
                
                // Find a safe character boundary near target_len
                let safe_pos = self.buffer.char_indices()
                    .map(|(i, _)| i)
                    .take_while(|&i| i <= target_len)
                    .last()
                    .unwrap_or(0);
                
                // Look for the last safe position that doesn't start with '<'
                let mut adjusted_pos = safe_pos;
                while adjusted_pos > 0 && self.buffer.chars().nth(adjusted_pos - 1) == Some('<') {
                    adjusted_pos = self.buffer.char_indices()
                        .map(|(i, _)| i)
                        .take_while(|&i| i < adjusted_pos)
                        .last()
                        .unwrap_or(0);
                }
                
                // Also check if we might be cutting off a closing tag pattern
                if adjusted_pos < self.buffer.len() {
                    let remaining = &self.buffer[adjusted_pos..];
                    if remaining.starts_with("</") || remaining.starts_with("<") {
                        // Don't emit anything that might interfere with closing tag detection
                        0
                    } else {
                        adjusted_pos
                    }
                } else {
                    adjusted_pos
                }
            } else {
                0
            };
            
            if safe_emit_len > 0 {
                // Find the nearest valid UTF-8 character boundary at or before safe_emit_len
                let safe_boundary = self.buffer.char_indices()
                    .map(|(i, _)| i)
                    .take_while(|&i| i <= safe_emit_len)
                    .last()
                    .unwrap_or(0);
                
                if safe_boundary > 0 {
                    let safe_content = self.buffer[..safe_boundary].to_string();
                    // Emit in small chunks for streaming - ALL content is thinking text
                    for chunk in safe_content.chars().collect::<Vec<_>>().chunks(3) {
                        let chunk_str: String = chunk.iter().collect();
                        events.push(StreamEvent::ThinkPartial(chunk_str));
                    }
                    self.buffer.drain(..safe_boundary);
                }
            }
        }
        
        events
    }
    
    fn parse_tool_call_content(&mut self, tool_name: &str) -> Vec<StreamEvent> {
        let mut events = Vec::new();
        
        if let Some(end_pos) = self.buffer.find("</tool_call>") {
            // Found closing tag - emit tool call and transition to text
            let tool_args = self.buffer[..end_pos].to_string();
            let tool_call = ToolCall {
                name: tool_name.to_string(),
                args: tool_args,
            };
            debug!("XML parser detected tool call: {} with args: {}", tool_call.name, tool_call.args);
            events.push(StreamEvent::ToolCall(tool_call));
            self.buffer.drain(..end_pos + 12); // Remove content + "</tool_call>"
            self.state = ParserState::Text;
        }
        // If no closing tag, wait for more content (don't emit partial tool calls)
        
        events
    }
    
    fn extract_tool_name(&self, tag: &str) -> Option<String> {
        if let Some(name_start) = tag.find("name=\"") {
            let name_start = name_start + 6;
            if let Some(name_end) = tag[name_start..].find('"') {
                return Some(tag[name_start..name_start + name_end].to_string());
            }
        }
        None
    }
    
    
    fn finalize(&mut self) -> Vec<StreamEvent> {
        let mut events = Vec::new();
        
        // Process any remaining content in buffer regardless of size
        if !self.buffer.is_empty() {
            // Temporarily reduce buffer size requirement to process remaining content
            let original_min_size = self.min_buffer_size;
            self.min_buffer_size = 0;
            
            // Process remaining content
            events.extend(self.parse_buffer_recursive());
            
            // Handle any remaining content based on current state
            match &self.state {
                ParserState::InThink => {
                    // If we're still in thinking, emit remaining content and force close
                    if !self.buffer.is_empty() {
                        for chunk in self.buffer.chars().collect::<Vec<_>>().chunks(3) {
                            let chunk_str: String = chunk.iter().collect();
                            events.push(StreamEvent::ThinkPartial(chunk_str));
                        }
                    }
                    events.push(StreamEvent::ThinkEnd);
                }
                ParserState::InToolCall(_) => {
                    // Incomplete tool call - treat remaining content as text
                    if !self.buffer.is_empty() {
                        events.push(StreamEvent::Text(self.buffer.clone()));
                    }
                }
                ParserState::LookingForTag => {
                    // Incomplete tag, treat as text
                    if !self.buffer.is_empty() {
                        events.push(StreamEvent::Text(self.buffer.clone()));
                    }
                }
                ParserState::Text => {
                    // Emit any remaining text
                    if !self.buffer.trim().is_empty() {
                        events.push(StreamEvent::Text(self.buffer.clone()));
                    }
                }
            }
            
            self.min_buffer_size = original_min_size;
        }
        
        events
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Helper function to create a test parser
    fn create_test_parser() -> XmlStreamParser {
        XmlStreamParser::new()
    }

    // Helper function to process multiple chunks and collect all events
    fn process_chunks(parser: &mut XmlStreamParser, chunks: &[&str]) -> Vec<StreamEvent> {
        let mut all_events = Vec::new();
        for chunk in chunks {
            all_events.extend(parser.process_chunk(chunk));
        }
        all_events.extend(parser.finalize());
        all_events
    }

    #[test]
    fn test_parser_initialization() {
        let parser = create_test_parser();
        assert!(matches!(parser.state, ParserState::Text));
        assert_eq!(parser.buffer, "");
        assert_eq!(parser.thinking_depth, 0);
        assert_eq!(parser.min_buffer_size, 40);
    }

    #[test]
    fn test_simple_text_processing() {
        let mut parser = create_test_parser();
        
        // Send a chunk that's large enough to process
        let events = parser.process_chunk("Hello, this is a simple text message that is long enough to be processed immediately!");
        
        assert_eq!(events.len(), 1);
        if let StreamEvent::Text(text) = &events[0] {
            assert!(text.contains("Hello"));
        } else {
            panic!("Expected Text event");
        }
    }

    #[test]
    fn test_buffering_small_chunks() {
        let mut parser = create_test_parser();
        
        // Send small chunks that shouldn't be processed immediately
        let events1 = parser.process_chunk("Hello");
        let events2 = parser.process_chunk(" world");
        
        // Should be empty because we're waiting for more content
        assert!(events1.is_empty());
        assert!(events2.is_empty());
        
        // Send more content to trigger processing
        let events3 = parser.process_chunk(" and this makes it long enough to process");
        assert!(!events3.is_empty());
    }

    #[test]
    fn test_think_tag_parsing() {
        let mut parser = create_test_parser();
        
        let chunks = [
            "<think>I need to think about this problem carefully. This is my reasoning process.</think>"
        ];
        
        let events = process_chunks(&mut parser, &chunks);
        
        // Should have ThinkStart, multiple ThinkPartial events, and ThinkEnd
        assert!(events.iter().any(|e| matches!(e, StreamEvent::ThinkStart)));
        assert!(events.iter().any(|e| matches!(e, StreamEvent::ThinkEnd)));
        assert!(events.iter().any(|e| matches!(e, StreamEvent::ThinkPartial(_))));
        
        // Collect all thinking content
        let thinking_content: String = events.iter()
            .filter_map(|e| match e {
                StreamEvent::ThinkPartial(content) => Some(content.as_str()),
                _ => None,
            })
            .collect();
        
        assert!(thinking_content.contains("I need to think"));
        assert!(thinking_content.contains("reasoning process"));
    }

    #[test]
    fn test_tool_call_parsing() {
        let mut parser = create_test_parser();
        
        let chunks = [
            "<tool_call name=\"shell_command\">ls -la</tool_call>"
        ];
        
        let events = process_chunks(&mut parser, &chunks);
        
        // Should have exactly one ToolCall event
        let tool_calls: Vec<&ToolCall> = events.iter()
            .filter_map(|e| match e {
                StreamEvent::ToolCall(tc) => Some(tc),
                _ => None,
            })
            .collect();
        
        assert_eq!(tool_calls.len(), 1);
        assert_eq!(tool_calls[0].name, "shell_command");
        assert_eq!(tool_calls[0].args, "ls -la");
    }

    #[test]
    fn test_mixed_content_parsing() {
        let mut parser = create_test_parser();
        
        let chunks = [
            "Let me help you with that. ",
            "<think>I should list the files first to see what's there.</think>",
            "I'll check what files are in the directory.",
            "<tool_call name=\"shell_command\">ls -la</tool_call>"
        ];
        
        let events = process_chunks(&mut parser, &chunks);
        
        // Should have text, thinking, and tool call events
        assert!(events.iter().any(|e| matches!(e, StreamEvent::Text(_))));
        assert!(events.iter().any(|e| matches!(e, StreamEvent::ThinkStart)));
        assert!(events.iter().any(|e| matches!(e, StreamEvent::ThinkEnd)));
        assert!(events.iter().any(|e| matches!(e, StreamEvent::ToolCall(_))));
        
        // Check that we got the tool call correctly
        let tool_calls: Vec<&ToolCall> = events.iter()
            .filter_map(|e| match e {
                StreamEvent::ToolCall(tc) => Some(tc),
                _ => None,
            })
            .collect();
        
        assert_eq!(tool_calls.len(), 1);
        assert_eq!(tool_calls[0].name, "shell_command");
    }

    #[test]
    fn test_unicode_boundary_handling() {
        let mut parser = create_test_parser();
        
        // Create a string with multi-byte Unicode characters
        let _unicode_text = "Hello 世界! This is a test with émojis 🚀 and åccénts";
        
        // Split at potential problematic boundaries
        let chunks = [
            "Hello 世",  // Split in middle of multi-byte character
            "界! This is a test with émojis 🚀 and ",
            "åccénts and more content to make it long enough"
        ];
        
        let events = process_chunks(&mut parser, &chunks);
        
        // Should not panic and should produce valid text events
        assert!(!events.is_empty());
        
        // Collect all text content
        let text_content: String = events.iter()
            .filter_map(|e| match e {
                StreamEvent::Text(text) => Some(text.as_str()),
                _ => None,
            })
            .collect();
        
        // Should contain the Unicode characters properly
        assert!(text_content.contains("世界"));
        assert!(text_content.contains("🚀"));
        assert!(text_content.contains("åccénts"));
    }

    #[test]
    fn test_thinking_prevents_tool_execution() {
        let mut parser = create_test_parser();
        
        let chunks = [
            "<think>I should use <tool_call name=\"shell_command\">rm -rf /</tool_call> but that would be dangerous!</think>"
        ];
        
        let events = process_chunks(&mut parser, &chunks);
        
        // Should have thinking events but NO tool call events
        assert!(events.iter().any(|e| matches!(e, StreamEvent::ThinkStart)));
        assert!(events.iter().any(|e| matches!(e, StreamEvent::ThinkEnd)));
        assert!(!events.iter().any(|e| matches!(e, StreamEvent::ToolCall(_))));
        
        // The tool call should be treated as thinking text
        let thinking_content: String = events.iter()
            .filter_map(|e| match e {
                StreamEvent::ThinkPartial(content) => Some(content.as_str()),
                _ => None,
            })
            .collect();
        
        assert!(thinking_content.contains("tool_call"));
        assert!(thinking_content.contains("dangerous"));
    }

    #[test]
    fn test_incomplete_tag_handling() {
        let mut parser = create_test_parser();
        
        let chunks = [
            "This is some text with an incomplete <tool_call name=\"shell_com"
        ];
        
        let events = process_chunks(&mut parser, &chunks);
        
        // Should treat the incomplete tag as regular text
        assert!(events.iter().any(|e| matches!(e, StreamEvent::Text(_))));
        assert!(!events.iter().any(|e| matches!(e, StreamEvent::ToolCall(_))));
        
        let text_content: String = events.iter()
            .filter_map(|e| match e {
                StreamEvent::Text(text) => Some(text.as_str()),
                _ => None,
            })
            .collect();
        
        assert!(text_content.contains("<tool_call"));
    }

    #[test]
    fn test_malformed_xml_handling() {
        let mut parser = create_test_parser();
        
        let chunks = [
            "Normal text <think>Good thinking</think> <tool_call>Missing name attribute</tool_call> more text"
        ];
        
        let events = process_chunks(&mut parser, &chunks);
        
        // Should handle the good think tag
        assert!(events.iter().any(|e| matches!(e, StreamEvent::ThinkStart)));
        assert!(events.iter().any(|e| matches!(e, StreamEvent::ThinkEnd)));
        
        // Should treat malformed tool_call as text
        let text_events: Vec<&String> = events.iter()
            .filter_map(|e| match e {
                StreamEvent::Text(text) => Some(text),
                _ => None,
            })
            .collect();
        
        let all_text: String = text_events.iter().map(|s| s.as_str()).collect::<Vec<_>>().join("");
        assert!(all_text.contains("more text"));
    }

    #[test]
    fn test_chunked_tag_parsing() {
        let mut parser = create_test_parser();
        
        // Split a tool call across multiple chunks
        let chunks = [
            "<tool_call nam",
            "e=\"shell_command\">ls ",
            "-la</tool_call>"
        ];
        
        let events = process_chunks(&mut parser, &chunks);
        
        // Should successfully parse the tool call despite being chunked
        let tool_calls: Vec<&ToolCall> = events.iter()
            .filter_map(|e| match e {
                StreamEvent::ToolCall(tc) => Some(tc),
                _ => None,
            })
            .collect();
        
        assert_eq!(tool_calls.len(), 1);
        assert_eq!(tool_calls[0].name, "shell_command");
        assert_eq!(tool_calls[0].args, "ls -la");
    }

    #[test]
    fn test_finalize_with_incomplete_content() {
        let mut parser = create_test_parser();
        
        // Add some content that's long enough to trigger initial processing
        parser.process_chunk("<think>This thinking is never closed but is long enough to be processed partially");
        let events = parser.finalize();
        
        // Should emit ThinkPartial events and then ThinkEnd
        assert!(events.iter().any(|e| matches!(e, StreamEvent::ThinkPartial(_))));
        assert!(events.iter().any(|e| matches!(e, StreamEvent::ThinkEnd)));
        
        let thinking_content: String = events.iter()
            .filter_map(|e| match e {
                StreamEvent::ThinkPartial(content) => Some(content.as_str()),
                _ => None,
            })
            .collect();
        
        assert!(thinking_content.contains("This thinking"));
    }

    #[test]
    fn test_state_transitions() {
        let mut parser = create_test_parser();
        
        // Start in Text state
        assert!(matches!(parser.state, ParserState::Text));
        
        // Process start of thinking tag with enough content to trigger processing
        parser.process_chunk("Some text that is long enough to trigger processing <think>");
        // Should transition to InThink state
        assert!(matches!(parser.state, ParserState::InThink));
        
        // Add thinking content and close
        parser.process_chunk("thinking content that is also long enough</think>");
        // Should transition back to Text state
        assert!(matches!(parser.state, ParserState::Text));
    }

    #[test]
    fn test_multiple_tool_calls_in_sequence() {
        let mut parser = create_test_parser();
        
        let chunks = [
            "<tool_call name=\"read_file\">config.txt</tool_call>",
            "After reading, I'll list files: ",
            "<tool_call name=\"shell_command\">ls -la</tool_call>"
        ];
        
        let events = process_chunks(&mut parser, &chunks);
        
        // Should have two tool calls
        let tool_calls: Vec<&ToolCall> = events.iter()
            .filter_map(|e| match e {
                StreamEvent::ToolCall(tc) => Some(tc),
                _ => None,
            })
            .collect();
        
        assert_eq!(tool_calls.len(), 2);
        assert_eq!(tool_calls[0].name, "read_file");
        assert_eq!(tool_calls[0].args, "config.txt");
        assert_eq!(tool_calls[1].name, "shell_command");
        assert_eq!(tool_calls[1].args, "ls -la");
    }

    #[test]
    fn test_nested_thinking_depth_tracking() {
        let mut parser = create_test_parser();
        
        // Test that thinking depth prevents tool execution even with nested scenarios
        let chunks = [
            "<think>Outer thinking <think>Inner thinking with <tool_call name=\"dangerous\">rm -rf /</tool_call></think> back to outer</think>"
        ];
        
        let events = process_chunks(&mut parser, &chunks);
        
        // Should only have thinking events, no tool calls
        assert!(events.iter().any(|e| matches!(e, StreamEvent::ThinkStart)));
        assert!(events.iter().any(|e| matches!(e, StreamEvent::ThinkEnd)));
        assert!(!events.iter().any(|e| matches!(e, StreamEvent::ToolCall(_))));
    }
}