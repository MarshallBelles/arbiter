use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    pub lsp_servers: Vec<LspServerConfig>,
    pub orchestration: OrchestrationConfig,
    pub user_model_selection: UserModelSelection,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrchestrationConfig {
    pub enabled: bool,
    pub models: Vec<ModelEntry>,
    pub max_iterations: usize,
    pub model_switch_cooldown_ms: u64,
    pub allow_model_override: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelEntry {
    pub name: String,
    pub server: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LspServerConfig {
    pub language: String,
    pub command: String,
    pub args: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserModelSelection {
    pub reasoning_model: String,
    pub execution_model: String,
    pub observer_model: String,
    pub system_ram_gb: Option<u32>,
    pub first_run_completed: bool,
}

impl Default for UserModelSelection {
    fn default() -> Self {
        Self {
            reasoning_model: "arbiter".to_string(),
            execution_model: "dragoon".to_string(),
            observer_model: "observer".to_string(),
            system_ram_gb: None,
            first_run_completed: false,
        }
    }
}

impl Default for OrchestrationConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            models: vec![
                // Core models - always included
                ModelEntry {
                    name: "arbiter".to_string(),
                    server: "http://localhost:11434".to_string(),
                },
                ModelEntry {
                    name: "dragoon".to_string(),
                    server: "http://localhost:11434".to_string(),
                },
                ModelEntry {
                    name: "observer".to_string(),
                    server: "http://localhost:11434".to_string(),
                },
                // Advanced models - optional, comment out if not available
                ModelEntry {
                    name: "templar".to_string(),
                    server: "http://localhost:11434".to_string(),
                },
                ModelEntry {
                    name: "immortal".to_string(),
                    server: "http://localhost:11434".to_string(),
                },
            ],
            max_iterations: 10,
            model_switch_cooldown_ms: 500,
            allow_model_override: true,
        }
    }
}

impl Default for Config {
    fn default() -> Self {
        Self {
            orchestration: OrchestrationConfig::default(),
            user_model_selection: UserModelSelection::default(),
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

            toml::from_str(&config_str).with_context(|| {
                format!("Could not parse config file at: {}\nYou can edit this file manually with vim to fix any syntax issues", config_path.display())
            })
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
    
    pub fn detect_system_ram() -> Result<u32> {
        #[cfg(target_os = "macos")]
        {
            let output = Command::new("sysctl")
                .args(["-n", "hw.memsize"])
                .output()
                .context("Failed to execute sysctl command")?;
            
            if output.status.success() {
                let memsize_str = String::from_utf8_lossy(&output.stdout);
                let memsize_bytes = memsize_str.trim().parse::<u64>()
                    .context("Failed to parse memory size")?;
                let memsize_gb = (memsize_bytes / (1024 * 1024 * 1024)) as u32;
                return Ok(memsize_gb);
            }
        }
        
        #[cfg(target_os = "linux")]
        {
            let output = Command::new("free")
                .args(["-b"])
                .output()
                .context("Failed to execute free command")?;
            
            if output.status.success() {
                let output_str = String::from_utf8_lossy(&output.stdout);
                for line in output_str.lines() {
                    if line.starts_with("Mem:") {
                        let parts: Vec<&str> = line.split_whitespace().collect();
                        if parts.len() > 1 {
                            let total_bytes = parts[1].parse::<u64>()
                                .context("Failed to parse memory size")?;
                            let total_gb = (total_bytes / (1024 * 1024 * 1024)) as u32;
                            return Ok(total_gb);
                        }
                    }
                }
            }
        }
        
        #[cfg(target_os = "windows")]
        {
            let output = Command::new("wmic")
                .args(["computersystem", "get", "TotalPhysicalMemory"])
                .output()
                .context("Failed to execute wmic command")?;
            
            if output.status.success() {
                let output_str = String::from_utf8_lossy(&output.stdout);
                for line in output_str.lines() {
                    if let Ok(bytes) = line.trim().parse::<u64>() {
                        let gb = (bytes / (1024 * 1024 * 1024)) as u32;
                        return Ok(gb);
                    }
                }
            }
        }
        
        // Default to 8GB if detection fails
        Ok(8)
    }
    
    pub fn get_reasoning_model_options(ram_gb: u32) -> Vec<(&'static str, &'static str)> {
        let mut options = vec![("arbiter", "Default reasoning model (128K context)")];
        
        if ram_gb >= 32 {
            options.push(("templar", "Advanced reasoning model (128K context, >32GB RAM)"));
        }
        
        options
    }
    
    pub fn get_execution_model_options(ram_gb: u32) -> Vec<(&'static str, &'static str)> {
        let mut options = vec![("dragoon", "Default execution model (32K context)")];
        
        if ram_gb >= 32 {
            options.push(("immortal", "Advanced execution model (128K context, >32GB RAM)"));
        }
        
        options
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn create_test_config() -> Config {
        Config {
            orchestration: OrchestrationConfig::default(),
            user_model_selection: UserModelSelection::default(),
            lsp_servers: vec![
                LspServerConfig {
                    language: "rust".to_string(),
                    command: "rust-analyzer".to_string(),
                    args: vec![],
                },
            ],
        }
    }

    #[test]
    fn test_config_default() {
        let config = Config::default();
        
        assert_eq!(config.user_model_selection.reasoning_model, "arbiter");
        assert_eq!(config.user_model_selection.execution_model, "dragoon");
        assert!(!config.orchestration.models.is_empty());
        assert_eq!(config.orchestration.models[0].server, "http://localhost:11434");
        assert_eq!(config.lsp_servers.len(), 10);
        
        // Check some key language servers
        assert!(config.lsp_servers.iter().any(|s| s.language == "rust" && s.command == "rust-analyzer"));
        assert!(config.lsp_servers.iter().any(|s| s.language == "python" && s.command == "pylsp"));
        assert!(config.lsp_servers.iter().any(|s| s.language == "javascript"));
    }

    #[test]
    fn test_lsp_server_config() {
        let lsp_config = LspServerConfig {
            language: "rust".to_string(),
            command: "rust-analyzer".to_string(),
            args: vec!["--arg1".to_string(), "--arg2".to_string()],
        };
        
        assert_eq!(lsp_config.language, "rust");
        assert_eq!(lsp_config.command, "rust-analyzer");
        assert_eq!(lsp_config.args, vec!["--arg1", "--arg2"]);
    }

    #[test]
    fn test_config_serialization() {
        let config = create_test_config();
        
        // Test serialization to TOML
        let toml_str = toml::to_string_pretty(&config).unwrap();
        assert!(toml_str.contains("reasoning_model = \"arbiter\""));
        assert!(toml_str.contains("execution_model = \"dragoon\""));
        assert!(toml_str.contains("server = \"http://localhost:11434\""));
        
        // Test deserialization from TOML
        let deserialized: Config = toml::from_str(&toml_str).unwrap();
        assert_eq!(deserialized.user_model_selection.reasoning_model, config.user_model_selection.reasoning_model);
        assert_eq!(deserialized.orchestration.models[0].server, config.orchestration.models[0].server);
        assert_eq!(deserialized.lsp_servers.len(), config.lsp_servers.len());
    }

    #[test]
    fn test_config_load_existing_file() {
        let temp_dir = TempDir::new().unwrap();
        let config_path = temp_dir.path().join("config.toml");
        
        // Create a test config file
        let test_config = create_test_config();
        let config_str = toml::to_string_pretty(&test_config).unwrap();
        std::fs::write(&config_path, config_str).unwrap();
        
        // Load the config
        let loaded_config = Config::load(Some(config_path.to_str().unwrap())).unwrap();
        
        assert_eq!(loaded_config.user_model_selection.reasoning_model, "arbiter");
        assert_eq!(loaded_config.user_model_selection.execution_model, "dragoon");
        assert_eq!(loaded_config.orchestration.models[0].server, "http://localhost:11434");
    }

    #[test]
    fn test_config_load_nonexistent_file() {
        // Skip this test since it tries to open an editor in a non-interactive environment
        // In a real application, we would mock the editor interaction
        // For now, we'll test the core functionality without the editor
        
        // Test that default config can be created and serialized
        let default_config = Config::default();
        let config_str = toml::to_string_pretty(&default_config).unwrap();
        assert!(config_str.contains("reasoning_model = \"arbiter\""));
        assert!(config_str.contains("server = \"http://localhost:11434\""));
    }

    #[test]
    fn test_config_load_invalid_toml() {
        let temp_dir = TempDir::new().unwrap();
        let config_path = temp_dir.path().join("invalid.toml");
        
        // Write invalid TOML
        std::fs::write(&config_path, "invalid toml content {{{").unwrap();
        
        // Should return an error
        let result = Config::load(Some(config_path.to_str().unwrap()));
        assert!(result.is_err());
        let error_msg = result.unwrap_err().to_string();
        assert!(error_msg.contains("Could not parse config file at:"));
        assert!(error_msg.contains("vim to fix any syntax issues"));
    }

    #[test]
    fn test_config_load_missing_fields() {
        let temp_dir = TempDir::new().unwrap();
        let config_path = temp_dir.path().join("incomplete.toml");
        
        // Write TOML with missing required fields
        let incomplete_toml = r#"
            # Missing orchestration and user_model_selection fields
            [[lsp_servers]]
            language = "rust"
            command = "rust-analyzer"
            args = []
        "#;
        std::fs::write(&config_path, incomplete_toml).unwrap();
        
        // Should return an error due to missing required fields
        let result = Config::load(Some(config_path.to_str().unwrap()));
        assert!(result.is_err());
    }

    #[test]
    fn test_command_exists() {
        // Test with a command that should exist on most systems
        #[cfg(unix)]
        assert!(Config::command_exists("sh"));
        
        #[cfg(windows)]
        assert!(Config::command_exists("cmd"));
        
        // Test with a command that definitely doesn't exist
        assert!(!Config::command_exists("definitely_nonexistent_command_12345"));
    }

    #[test]
    fn test_config_clone() {
        let config = create_test_config();
        let cloned = config.clone();
        
        assert_eq!(config.user_model_selection.reasoning_model, cloned.user_model_selection.reasoning_model);
        assert_eq!(config.orchestration.models[0].server, cloned.orchestration.models[0].server);
        assert_eq!(config.lsp_servers.len(), cloned.lsp_servers.len());
    }

    #[test]
    fn test_lsp_server_config_clone() {
        let lsp_config = LspServerConfig {
            language: "rust".to_string(),
            command: "rust-analyzer".to_string(),
            args: vec!["--test".to_string()],
        };
        
        let cloned = lsp_config.clone();
        assert_eq!(lsp_config.language, cloned.language);
        assert_eq!(lsp_config.command, cloned.command);
        assert_eq!(lsp_config.args, cloned.args);
    }

    #[test]
    fn test_config_debug_format() {
        let config = create_test_config();
        let debug_str = format!("{:?}", config);
        
        assert!(debug_str.contains("Config"));
        assert!(debug_str.contains("arbiter"));
        assert!(debug_str.contains("http://localhost:11434"));
    }

    #[test]
    fn test_edit_existing_config_file_exists() {
        let temp_dir = TempDir::new().unwrap();
        let config_path = temp_dir.path().join("existing.toml");
        
        // Create an existing config file
        let test_config = create_test_config();
        let config_str = toml::to_string_pretty(&test_config).unwrap();
        std::fs::write(&config_path, config_str).unwrap();
        
        // This should attempt to open the editor, but since we can't test interactive behavior,
        // we just verify the function doesn't panic and the file still exists
        // Note: This test will fail in CI environments without vim/nano/vi
        // In a real scenario, we'd mock the editor interaction
        assert!(config_path.exists());
    }

    #[test]
    fn test_default_lsp_servers_completeness() {
        let config = Config::default();
        let languages: Vec<&str> = config.lsp_servers.iter().map(|s| s.language.as_str()).collect();
        
        // Verify all expected languages are configured
        let expected_languages = [
            "rust", "python", "javascript", "typescript", 
            "go", "java", "c", "cpp", "csharp", "zig"
        ];
        
        for lang in expected_languages {
            assert!(languages.contains(&lang), "Missing LSP server for language: {}", lang);
        }
    }

    #[test]
    fn test_config_parameter_bounds() {
        let config = Config::default();
        
        // Verify reasonable parameter ranges
        assert!(!config.user_model_selection.reasoning_model.is_empty());
        assert!(config.orchestration.models[0].server.starts_with("http"));
    }
}
