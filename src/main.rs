use anyhow::Result;
use clap::Parser;
use std::io::{self, IsTerminal, Read};
use tracing::info;

mod config;
mod shell;
mod ai;
mod tree_sitter_support;
mod lsp;
mod tools;
mod tool_args;

use config::Config;
use shell::Shell;

#[derive(Parser)]
#[command(name = "arbiter")]
#[command(about = "ULTRA-lightweight AI-powered peer-programmer")]
struct Cli {
    /// Direct prompt to process
    prompt: Option<String>,
    
    /// Configuration file path
    #[arg(short, long)]
    config: Option<String>,
    
    /// Model to use
    #[arg(short, long)]
    model: Option<String>,
    
    /// Server endpoint
    #[arg(short, long)]
    server: Option<String>,
}

#[tokio::main]
async fn main() -> Result<()> {
    // Initialize tracing
    tracing_subscriber::fmt::init();
    
    let cli = Cli::parse();
    
    // Handle special commands before loading config
    if let Some(ref prompt) = cli.prompt {
        if prompt.trim().eq_ignore_ascii_case("edit config") {
            return Config::edit_existing_config(cli.config.as_deref());
        }
    }

    // Load configuration
    let config = Config::load(cli.config.as_deref())?;
    
    // Override config with CLI args
    let mut config = config;
    if let Some(model) = cli.model {
        config.model = model;
    }
    if let Some(server) = cli.server {
        config.server = server;
    }
    
    info!("Starting Arbiter v1.0.0");
    info!("Using model: {}", config.model);
    info!("Server: {}", config.server);
    
    // Handle different input modes
    match (cli.prompt, io::stdin().is_terminal()) {
        // Direct prompt provided
        (Some(prompt), _) => {
            let mut shell = Shell::new(config).await?;
            shell.process_prompt(&prompt).await?;
        }
        
        // Stdin input (pipe)
        (None, false) => {
            let mut input = String::new();
            io::stdin().read_to_string(&mut input)?;
            let mut shell = Shell::new(config).await?;
            shell.process_prompt(&input.trim()).await?;
        }
        
        // Interactive mode
        (None, true) => {
            let mut shell = Shell::new(config).await?;
            shell.run_interactive().await?;
        }
    }
    
    Ok(())
}