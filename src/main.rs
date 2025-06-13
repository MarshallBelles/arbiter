use arbiter::{CodeAgentBuilder, AiProvider, ContextRequest, Result, CodeAgent};
use arbiter::ai_providers::AiProviderFactory;
use async_trait::async_trait;
use clap::{Parser, Subcommand};
use serde::Deserialize;
use std::collections::HashMap;
use std::path::PathBuf;
use tokio::io::{self, AsyncWriteExt};
use tokio::sync::mpsc;
use tracing::{info, warn, error};

#[derive(Parser)]
#[command(name = "arbiter")]
#[command(about = "A next-generation Rust code agent leveraging modern AI and code analysis")]
#[command(version = "0.1.0")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
    
    #[arg(short, long, global = true)]
    verbose: bool,
    
    #[arg(short, long, global = true, default_value = "100000")]
    context_size: usize,

    #[arg(short = 'C', long, global = true, default_value = "config.toml")]
    config_file: PathBuf,
}

#[derive(Deserialize)]
struct Config {
    ai_provider: AiProviderConfig,
    context: Option<ContextConfig>,
    repository: Option<RepositoryConfig>,
    logging: Option<LoggingConfig>,
}

#[derive(Deserialize)]
struct AiProviderConfig {
    provider: String,
    model: Option<String>,
    base_url: Option<String>,
    api_key: Option<String>,
    custom: Option<HashMap<String, toml::Value>>,
}

#[derive(Deserialize)]
struct ContextConfig {
    total_tokens: Option<usize>,
    repository_map_tokens: Option<usize>,
    compression_threshold: Option<usize>,
}

#[derive(Deserialize)]
struct RepositoryConfig {
    include_patterns: Option<Vec<String>>,
    exclude_patterns: Option<Vec<String>>,
    max_file_size: Option<usize>,
}

#[derive(Deserialize)]
struct LoggingConfig {
    level: Option<String>,
    file: Option<String>,
}

#[derive(Subcommand)]
enum Commands {
    /// Analyze code context and provide insights
    Analyze {
        /// Query to analyze
        query: String,
        /// Files to include in analysis
        #[arg(short, long)]
        files: Vec<PathBuf>,
        /// Include symbol information
        #[arg(long)]
        symbols: bool,
        /// Include diagnostic information
        #[arg(long)]
        diagnostics: bool,
    },
    /// Generate code changes based on a request
    Generate {
        /// Description of changes to generate
        request: String,
        /// Files to modify
        #[arg(short, long)]
        files: Vec<PathBuf>,
        /// Apply changes automatically
        #[arg(long)]
        apply: bool,
    },
    /// Interactive mode for conversational coding
    Interactive,
    /// Show context visualization
    Context,
}

// Mock AI Provider for demonstration
struct MockAiProvider {
    model: String,
}

impl MockAiProvider {
    fn new(model: String) -> Self {
        Self { model }
    }
}

#[async_trait]
impl AiProvider for MockAiProvider {
    async fn generate(&self, prompt: &str) -> Result<String> {
        info!("Generating response using model: {}", self.model);
        
        // Simple mock response based on prompt analysis
        let response = if prompt.contains("error handling") {
            r#"
Here's a suggested improvement with error handling:

<<<<<<< SEARCH
fn main() {
    let result = some_operation();
    println!("Result: {}", result);
}
=======
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let result = some_operation()?;
    println!("Result: {}", result);
    Ok(())
}
>>>>>>> REPLACE
"#
        } else if prompt.contains("documentation") {
            "Added comprehensive documentation with examples and usage patterns."
        } else {
            "I understand your request. Here's a suggested approach based on the codebase analysis."
        };
        
        Ok(response.to_string())
    }

    async fn stream_generate(&self, prompt: &str) -> Result<mpsc::Receiver<String>> {
        let (tx, rx) = mpsc::channel(10);
        let response = self.generate(prompt).await?;
        
        tokio::spawn(async move {
            // Simulate streaming by sending words with small delays
            for word in response.split_whitespace() {
                if tx.send(format!("{} ", word)).await.is_err() {
                    break;
                }
                tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;
            }
        });
        
        Ok(rx)
    }
}

fn load_config(config_path: &PathBuf) -> Result<Config> {
    let config_content = std::fs::read_to_string(config_path)
        .map_err(|e| format!("Failed to read config file {}: {}", config_path.display(), e))?;
    
    let config: Config = toml::from_str(&config_content)
        .map_err(|e| format!("Failed to parse config file: {}", e))?;
    
    Ok(config)
}

fn create_ai_provider_from_config(config: &AiProviderConfig) -> Result<Box<dyn AiProvider + Send + Sync>> {
    let mut provider_config = HashMap::new();
    
    if let Some(ref model) = config.model {
        provider_config.insert("model".to_string(), model.clone());
    }
    
    if let Some(ref base_url) = config.base_url {
        provider_config.insert("base_url".to_string(), base_url.clone());
    }
    
    if let Some(ref api_key) = config.api_key {
        provider_config.insert("api_key".to_string(), api_key.clone());
    }
    
    AiProviderFactory::from_config(&config.provider, provider_config)
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();
    
    // Load configuration
    let config = load_config(&cli.config_file)?;
    
    // Initialize tracing
    let log_level = if cli.verbose { 
        "debug" 
    } else if let Some(ref logging) = config.logging {
        logging.level.as_deref().unwrap_or("info")
    } else { 
        "info" 
    };
    tracing_subscriber::fmt()
        .with_env_filter(log_level)
        .init();

    info!("Starting Arbiter v0.1.0");
    info!("Using AI provider: {} at {}", 
          config.ai_provider.provider, 
          config.ai_provider.base_url.as_deref().unwrap_or("default"));

    // Create AI provider from configuration
    let ai_provider = create_ai_provider_from_config(&config.ai_provider)?;
    
    // Get context size from config or CLI
    let context_size = if let Some(ref context_config) = config.context {
        context_config.total_tokens.unwrap_or(cli.context_size)
    } else {
        cli.context_size
    };
    
    // Build the code agent
    let agent = CodeAgentBuilder::new()
        .window_size(context_size)
        .ai_provider(ai_provider)
        .build()
        .await?;

    match cli.command {
        Commands::Analyze { query, files, symbols, diagnostics } => {
            info!("Analyzing context for query: {}", query);
            
            let request = ContextRequest {
                query,
                files,
                include_symbols: symbols,
                include_diagnostics: diagnostics,
                max_tokens: cli.context_size,
            };
            
            match agent.analyze_context(request).await {
                Ok(context) => {
                    println!("Repository Map:");
                    println!("{}", context.repository_map);
                    
                    if !context.relevant_files.is_empty() {
                        println!("\nRelevant Files:");
                        for file in &context.relevant_files {
                            println!("  - {} ({})", file.path.display(), format!("{:?}", file.language));
                        }
                    }
                    
                    if !context.symbols.is_empty() {
                        println!("\nSymbols Found: {}", context.symbols.len());
                    }
                    
                    if !context.diagnostics.is_empty() {
                        println!("\nDiagnostics Found: {}", context.diagnostics.len());
                        for diagnostic in &context.diagnostics {
                            println!("  {:?}: {}", diagnostic.severity, diagnostic.message);
                        }
                    }
                }
                Err(e) => {
                    error!("Failed to analyze context: {}", e);
                    std::process::exit(1);
                }
            }
        }
        
        Commands::Generate { request, files, apply } => {
            info!("Generating changes for: {}", request);
            
            let context_request = ContextRequest {
                query: request,
                files,
                include_symbols: true,
                include_diagnostics: true,
                max_tokens: cli.context_size,
            };
            
            match agent.analyze_context(context_request).await {
                Ok(context) => {
                    match agent.generate_changes(&context).await {
                        Ok(edits) => {
                            println!("Generated {} file edits:", edits.len());
                            for edit in &edits {
                                println!("  - {}", edit.path.display());
                                println!("    Search/Replace edit: {} -> {}", edit.search.len(), edit.replace.len());
                            }
                            
                            if apply {
                                println!("\nApplying changes...");
                                match agent.apply_changes(edits).await {
                                    Ok(result) => {
                                        println!("Successfully applied changes to {} files", result.succeeded.len());
                                        if !result.failed.is_empty() {
                                            warn!("Failed to apply changes to {} files:", result.failed.len());
                                            for (path, error) in result.failed {
                                                println!("  - {}: {}", path.display(), error);
                                            }
                                        }
                                    }
                                    Err(e) => {
                                        error!("Failed to apply changes: {}", e);
                                        std::process::exit(1);
                                    }
                                }
                            } else {
                                println!("\nUse --apply to apply these changes automatically.");
                            }
                        }
                        Err(e) => {
                            error!("Failed to generate changes: {}", e);
                            std::process::exit(1);
                        }
                    }
                }
                Err(e) => {
                    error!("Failed to analyze context: {}", e);
                    std::process::exit(1);
                }
            }
        }
        
        Commands::Interactive => {
            println!("🤖 Arbiter Interactive Mode");
            println!("Type 'help' for commands, 'quit' to exit");
            
            let mut stdout = io::stdout();
            
            loop {
                print!("arbiter> ");
                stdout.flush().await?;
                
                match tokio::task::spawn_blocking(|| {
                        let mut input = String::new();
                        std::io::stdin().read_line(&mut input).map(|_| input)
                    }).await {
                    Ok(Ok(input)) => {
                        let input = input.trim();
                        
                        if input.is_empty() {
                            continue;
                        }
                        
                        match input {
                            "quit" | "exit" => {
                                println!("Goodbye! 👋");
                                break;
                            }
                            "help" => {
                                println!("Commands:");
                                println!("  analyze <query> - Analyze code context");
                                println!("  generate <request> - Generate code changes");
                                println!("  context - Show current context");
                                println!("  quit - Exit interactive mode");
                            }
                            "context" => {
                                // Show context visualization
                                println!("Context visualization would be shown here");
                            }
                            cmd if cmd.starts_with("analyze ") => {
                                let query = cmd.strip_prefix("analyze ").unwrap();
                                println!("Analyzing: {}", query);
                                // Perform analysis...
                            }
                            cmd if cmd.starts_with("generate ") => {
                                let request = cmd.strip_prefix("generate ").unwrap();
                                println!("Generating changes for: {}", request);
                                // Perform generation...
                            }
                            _ => {
                                println!("Unknown command. Type 'help' for available commands.");
                            }
                        }
                    }
                    Ok(Err(e)) => {
                        error!("Error reading input: {}", e);
                        break;
                    }
                    Err(e) => {
                        error!("Task panicked: {}", e);
                        break;
                    }
                }
            }
        }
        
        Commands::Context => {
            println!("Context Visualization:");
            // In a real implementation, this would show the current context state
            println!("Context window size: {} tokens", cli.context_size);
            println!("Current usage: 0% (0 tokens)");
            println!("\nLayers:");
            println!("  No layers currently loaded");
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_mock_ai_provider() {
        let provider = MockAiProvider::new("test-model".to_string());
        let response = provider.generate("test prompt").await.unwrap();
        assert!(!response.is_empty());
    }

    #[tokio::test]
    async fn test_streaming_generation() {
        let provider = MockAiProvider::new("test-model".to_string());
        let mut rx = provider.stream_generate("test prompt").await.unwrap();
        
        let mut received = Vec::new();
        while let Some(chunk) = rx.recv().await {
            received.push(chunk);
        }
        
        assert!(!received.is_empty());
    }
}