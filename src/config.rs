use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    pub model: String,
    pub server: String,
    pub context_size: usize,
    pub temperature: f32,
    pub max_tokens: usize,
    pub lsp_servers: Vec<LspServerConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LspServerConfig {
    pub language: String,
    pub command: String,
    pub args: Vec<String>,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            model: "arbiter1.0".to_string(),
            server: "http://localhost:11434".to_string(),
            context_size: 31000,
            temperature: 0.7,
            max_tokens: 4096,
            lsp_servers: vec![
                LspServerConfig {
                    language: "rust".to_string(),
                    command: "rust-analyzer".to_string(),
                    args: vec![],
                },
                LspServerConfig {
                    language: "python".to_string(),
                    command: "pylsp".to_string(),
                    args: vec![],
                },
                LspServerConfig {
                    language: "javascript".to_string(),
                    command: "typescript-language-server".to_string(),
                    args: vec!["--stdio".to_string()],
                },
                LspServerConfig {
                    language: "typescript".to_string(),
                    command: "typescript-language-server".to_string(),
                    args: vec!["--stdio".to_string()],
                },
                LspServerConfig {
                    language: "go".to_string(),
                    command: "gopls".to_string(),
                    args: vec![],
                },
                LspServerConfig {
                    language: "java".to_string(),
                    command: "jdtls".to_string(),
                    args: vec![],
                },
                LspServerConfig {
                    language: "c".to_string(),
                    command: "clangd".to_string(),
                    args: vec![],
                },
                LspServerConfig {
                    language: "cpp".to_string(),
                    command: "clangd".to_string(),
                    args: vec![],
                },
                LspServerConfig {
                    language: "csharp".to_string(),
                    command: "omnisharp".to_string(),
                    args: vec!["--languageserver".to_string()],
                },
                LspServerConfig {
                    language: "zig".to_string(),
                    command: "zls".to_string(),
                    args: vec![],
                },
            ],
        }
    }
}

impl Config {
    pub fn load(config_path: Option<&str>) -> Result<Self> {
        let config_path = match config_path {
            Some(path) => PathBuf::from(path),
            None => {
                let config_dir = dirs::config_dir()
                    .context("Could not find config directory")?
                    .join("arbiter");

                std::fs::create_dir_all(&config_dir)
                    .context("Could not create config directory")?;

                config_dir.join("config.toml")
            }
        };

        if config_path.exists() {
            let config_str =
                std::fs::read_to_string(&config_path).context("Could not read config file")?;

            toml::from_str(&config_str).context("Could not parse config file")
        } else {
            // Create default config
            let default_config = Self::default();
            let config_str = toml::to_string_pretty(&default_config)
                .context("Could not serialize default config")?;

            std::fs::write(&config_path, config_str)
                .context("Could not write default config file")?;

            // Try to open config file in editor
            Self::open_config_in_editor(&config_path)?;

            Ok(default_config)
        }
    }

    fn open_config_in_editor(config_path: &PathBuf) -> Result<()> {
        let editors = ["vim", "nano", "vi"];
        
        for editor in &editors {
            if Self::command_exists(editor) {
                println!("Opening config file in {}...", editor);
                let status = Command::new(editor)
                    .arg(config_path)
                    .status()
                    .context(format!("Failed to start {}", editor))?;
                
                if !status.success() {
                    println!("Editor {} exited with non-zero status", editor);
                }
                return Ok(());
            }
        }
        
        // No editor found, print instructions
        println!("No suitable editor (vim, nano, vi) found.");
        println!("Please edit the config file manually at: {}", config_path.display());
        println!("After editing, run arbiter again to use your configuration.");
        std::process::exit(0);
    }

    fn command_exists(command: &str) -> bool {
        Command::new("which")
            .arg(command)
            .output()
            .map(|output| output.status.success())
            .unwrap_or(false)
    }

    pub fn edit_existing_config(config_path: Option<&str>) -> Result<()> {
        let config_path = match config_path {
            Some(path) => PathBuf::from(path),
            None => {
                let config_dir = dirs::config_dir()
                    .context("Could not find config directory")?
                    .join("arbiter");

                std::fs::create_dir_all(&config_dir)
                    .context("Could not create config directory")?;

                config_dir.join("config.toml")
            }
        };

        if !config_path.exists() {
            // Create default config file first
            let default_config = Self::default();
            let config_str = toml::to_string_pretty(&default_config)
                .context("Could not serialize default config")?;

            std::fs::write(&config_path, config_str)
                .context("Could not write default config file")?;
                
            println!("Created new config file at: {}", config_path.display());
        }

        Self::open_config_in_editor(&config_path)
    }
}
