use anyhow::{Result, Context};
use serde_json::Value;
use std::process::{Command, Stdio};
use std::io::Write;
use tokio::process::Command as TokioCommand;
use tracing::{debug, error, info};

#[derive(Clone)]
pub struct ToolExecutor {
    working_directory: std::path::PathBuf,
}

impl ToolExecutor {
    pub fn new() -> Self {
        Self {
            working_directory: std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("/")),
        }
    }
    
    pub async fn execute_tool(&mut self, tool_name: &str, args: &Value) -> Result<String> {
        match tool_name {
            "shell_command" => self.execute_shell_command(args).await,
            "write_file" => self.write_file(args).await,
            "read_file" => self.read_file(args).await,
            "git_command" => self.execute_git_command(args).await,
            "code_analysis" => self.analyze_code(args).await,
            _ => Err(anyhow::anyhow!("Unknown tool: {}", tool_name)),
        }
    }
    
    async fn execute_shell_command(&mut self, args: &Value) -> Result<String> {
        let command = args.get("command")
            .and_then(|v| v.as_str())
            .context("Missing 'command' argument")?;
        
        info!("Executing shell command: {}", command);
        
        // Enhanced shell execution for complex commands
        // Use the system shell directly to handle pipes, redirects, complex syntax
        let shell = self.detect_shell();
        let shell_args = self.get_shell_args(&shell);
        
        // Check for interactive commands before execution
        if self.is_complex_interactive_command(command) {
            let (command_type, alternatives) = self.get_complex_command_guidance(command);
            return Ok(format!(
                "{} command detected: '{}'\n\n\x1b[1;33mInteractive/streaming commands are coming soon!\x1b[0m We're working to overcome these challenges in a future release.\n\n{}", 
                command_type,
                command.chars().take(100).collect::<String>(),
                alternatives
            ));
        }

        // Execute with proper shell for complex command support
        let mut cmd = TokioCommand::new(&shell);
        cmd.args(&shell_args)
           .arg(command)
           .current_dir(&self.working_directory)
           .stdout(std::process::Stdio::piped())
           .stderr(std::process::Stdio::piped());

        // Set environment for better shell execution
        cmd.env("TERM", "xterm-256color")
           .env("COLUMNS", "120")
           .env("LINES", "30");

        let output = cmd.output()
            .await
            .context("Failed to execute shell command")?;
        
        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        
        // Enhanced output formatting with better error context
        let result = if output.status.success() {
            if stdout.trim().is_empty() && stderr.trim().is_empty() {
                "Command executed successfully (no output)".to_string()
            } else if stderr.trim().is_empty() {
                format!("Command executed successfully:\n{}", stdout)
            } else {
                // Some commands write to stderr even on success
                format!("Command executed successfully:\nSTDOUT:\n{}\nSTDERR:\n{}", stdout, stderr)
            }
        } else {
            let exit_code = output.status.code().unwrap_or(-1);
            format!("Command failed (exit code {}):\nSTDOUT:\n{}\nSTDERR:\n{}", 
                   exit_code, stdout, stderr)
        };
        
        debug!("Shell command result: {}", result);
        Ok(result)
    }
    
    async fn write_file(&mut self, args: &Value) -> Result<String> {
        let path = args.get("path")
            .and_then(|v| v.as_str())
            .context("Missing 'path' argument")?;
        
        let content = args.get("content")
            .and_then(|v| v.as_str())
            .context("Missing 'content' argument")?;
        
        let full_path = self.working_directory.join(path);
        
        // Create parent directories if they don't exist
        if let Some(parent) = full_path.parent() {
            tokio::fs::create_dir_all(parent).await
                .context("Failed to create parent directories")?;
        }
        
        tokio::fs::write(&full_path, content).await
            .context("Failed to write file")?;
        
        info!("Written file: {}", full_path.display());
        Ok(format!("Successfully wrote {} bytes to {}", content.len(), path))
    }
    
    async fn read_file(&mut self, args: &Value) -> Result<String> {
        let path = args.get("path")
            .and_then(|v| v.as_str())
            .context("Missing 'path' argument")?;
        
        let full_path = self.working_directory.join(path);
        
        let content = tokio::fs::read_to_string(&full_path).await
            .context("Failed to read file")?;
        
        info!("Read file: {}", full_path.display());
        Ok(format!("File content of {}:\n{}", path, content))
    }
    
    async fn execute_git_command(&mut self, args: &Value) -> Result<String> {
        let command = args.get("command")
            .and_then(|v| v.as_str())
            .context("Missing 'command' argument")?;
        
        info!("Executing git command: git {}", command);
        
        let parts = shellwords::split(command)
            .context("Failed to parse git command")?;
        
        let output = TokioCommand::new("git")
            .args(&parts)
            .current_dir(&self.working_directory)
            .output()
            .await
            .context("Failed to execute git command")?;
        
        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        
        let result = if output.status.success() {
            format!("Git command executed successfully:\n{}", stdout)
        } else {
            format!("Git command failed (exit code {}):\nSTDOUT:\n{}\nSTDERR:\n{}", 
                   output.status.code().unwrap_or(-1), stdout, stderr)
        };
        
        debug!("Git command result: {}", result);
        Ok(result)
    }
    
    async fn analyze_code(&mut self, args: &Value) -> Result<String> {
        let path = args.get("path")
            .and_then(|v| v.as_str())
            .context("Missing 'path' argument")?;
        
        let full_path = self.working_directory.join(path);
        
        let content = tokio::fs::read_to_string(&full_path).await
            .context("Failed to read file for analysis")?;
        
        // Basic code analysis
        let lines = content.lines().count();
        let chars = content.chars().count();
        let words = content.split_whitespace().count();
        
        // Detect language
        let language = crate::tree_sitter_support::TreeSitterManager::new()?
            .detect_language(path);
        
        let mut analysis = format!(
            "Code analysis for {}:\n- Lines: {}\n- Characters: {}\n- Words: {}\n- Detected language: {}\n",
            path, lines, chars, words, 
            language.as_deref().unwrap_or("unknown")
        );
        
        // If we can detect the language, get symbols
        if let Some(lang) = language {
            let mut ts_manager = crate::tree_sitter_support::TreeSitterManager::new()?;
            if let Ok(symbols) = ts_manager.get_symbols(&lang, &content) {
                analysis.push_str(&format!("\nSymbols found ({}):\n", symbols.len()));
                for symbol in symbols.iter().take(20) { // Limit to first 20 symbols
                    analysis.push_str(&format!("- {} ({}): line {}\n", 
                                             symbol.name, symbol.symbol_type, symbol.start_line + 1));
                }
                if symbols.len() > 20 {
                    analysis.push_str(&format!("... and {} more symbols\n", symbols.len() - 20));
                }
            }
        }
        
        info!("Analyzed code file: {}", full_path.display());
        Ok(analysis)
    }
    
    pub fn set_working_directory(&mut self, path: std::path::PathBuf) {
        self.working_directory = path;
        info!("Changed working directory to: {}", self.working_directory.display());
    }
    
    pub fn get_working_directory(&self) -> &std::path::Path {
        &self.working_directory
    }
    
    fn is_interactive_command(&self, cmd: &str, args: &[String]) -> bool {
        match cmd {
            "git" => {
                // git commit without -m flag is interactive
                if args.len() > 0 && args[0] == "commit" {
                    // Check if -m or --message flag is present
                    !args.iter().any(|arg| arg == "-m" || arg == "--message" || arg.starts_with("-m=") || arg.starts_with("--message="))
                } else {
                    false
                }
            }
            // Interactive editors
            "vim" | "vi" | "nano" | "emacs" | "code" => true,
            // Interactive utilities and streaming commands
            "top" | "htop" | "less" | "more" => true,
            // Streaming/watching commands that run indefinitely
            "tail" => args.iter().any(|arg| arg == "-f" || arg == "--follow"),
            "watch" => true,
            "ping" => !args.iter().any(|arg| arg == "-c" || arg.starts_with("-c")),
            // SSH is often interactive
            "ssh" => !args.iter().any(|arg| arg == "-c" || arg == "--command"),
            // Docker interactive commands
            "docker" => args.len() > 0 && (args[0] == "run" && args.iter().any(|arg| arg == "-it" || arg == "-i")),
            _ => false
        }
    }
    
    fn detect_shell(&self) -> String {
        // Detect the best shell for command execution
        std::env::var("SHELL").unwrap_or_else(|_| {
            // Fall back to common shells based on OS
            if cfg!(target_os = "windows") {
                "cmd".to_string()
            } else {
                // Try to find bash, then sh
                if std::process::Command::new("bash").arg("--version").output().is_ok() {
                    "bash".to_string()
                } else {
                    "sh".to_string()
                }
            }
        })
    }
    
    fn get_shell_args(&self, shell: &str) -> Vec<String> {
        // Get appropriate arguments for different shells
        match shell.split('/').last().unwrap_or(shell) {
            "bash" => vec!["-c".to_string()],
            "zsh" => vec!["-c".to_string()],
            "fish" => vec!["-c".to_string()],
            "sh" => vec!["-c".to_string()],
            "cmd" => vec!["/C".to_string()],
            "powershell" | "pwsh" => vec!["-Command".to_string()],
            _ => vec!["-c".to_string()], // Default to POSIX shell behavior
        }
    }
    
    fn is_complex_interactive_command(&self, command: &str) -> bool {
        // Enhanced detection for complex interactive commands
        let interactive_patterns = [
            // Text editors
            r"\b(vim|vi|nano|emacs|code)\b",
            // Interactive shells
            r"\b(bash|zsh|fish|sh)\s*$",
            // Interactive utilities
            r"\b(top|htop|less|more|man)\b",
            // Streaming commands
            r"\btail\s+.*-f\b",
            r"\bwatch\b",
            r"\bping\b(?!.*-c\s+\d+)",
            // Interactive git
            r"\bgit\s+(commit|rebase|add)\b(?!.*(-m|--message))",
            // SSH without command
            r"\bssh\b(?!.*-c)",
            // Docker interactive
            r"\bdocker\s+run\b.*-i",
        ];
        
        for pattern in &interactive_patterns {
            if regex::Regex::new(pattern)
                .map(|re| re.is_match(command))
                .unwrap_or(false) {
                return true;
            }
        }
        false
    }
    
    fn get_complex_command_guidance(&self, command: &str) -> (&'static str, String) {
        // Provide guidance for complex commands
        if command.contains("tail") && command.contains("-f") {
            ("Streaming", "Use **tail -n 20 <file>** for static output instead".to_string())
        } else if command.contains("watch") {
            ("Streaming", "Run the command **once** instead of watching".to_string())
        } else if command.contains("vim") || command.contains("nano") || command.contains("emacs") {
            ("Interactive", "Use **cat <file>** to view or ask Arbiter to edit files".to_string())
        } else if command.contains("git commit") && !command.contains("-m") {
            ("Interactive", "Use **git commit -m \"message\"** for non-interactive commits".to_string())
        } else {
            ("Interactive", "Consider using non-interactive alternatives".to_string())
        }
    }

    fn get_command_guidance(&self, cmd: &str, args: &[String]) -> (&'static str, String) {
        match cmd {
            "tail" if args.iter().any(|arg| arg == "-f" || arg == "--follow") => {
                ("Streaming", format!(
                    "For now, please use non-streaming alternatives:\n  \x1b[1;36mtail -n 20\x1b[0m <filename> (show last 20 lines)\n  \x1b[1;36mcat\x1b[0m <filename> (show entire file)\n  \x1b[1;36mless\x1b[0m <filename> (browse file content)"
                ))
            }
            "watch" => {
                ("Streaming", format!(
                    "For now, please run commands directly:\n  Run the command \x1b[1;33monce\x1b[0m instead of watching\n  Use a simple loop in your terminal if needed"
                ))
            }
            "ping" => {
                ("Streaming", format!(
                    "For now, please use:\n  \x1b[1;36mping -c 4\x1b[0m <hostname> (send 4 packets)\n  \x1b[1;36mping -c 1\x1b[0m <hostname> (single ping test)"
                ))
            }
            "git" => {
                ("Interactive", format!(
                    "For now, please use non-interactive alternatives:\n  \x1b[1;36mgit commit -m\x1b[0m \"your message\"\n  \x1b[1;36mgit commit --amend --no-edit\x1b[0m\n  Use \x1b[1;33mEDITOR=nano\x1b[0m for simpler workflows"
                ))
            }
            "vim" | "vi" | "nano" | "emacs" | "code" => {
                ("Interactive", format!(
                    "For now, please use:\n  \x1b[1;36mcat\x1b[0m <filename> (to view files)\n  Ask \x1b[1;33mArbiter\x1b[0m to edit files for you\n  Use command-line tools like \x1b[1;36msed\x1b[0m or \x1b[1;36mawk\x1b[0m"
                ))
            }
            "ssh" => {
                ("Interactive", format!(
                    "For now, please use:\n  \x1b[1;36mssh -c\x1b[0m \"command\" <host> (run single command)\n  Use your \x1b[1;33mregular terminal\x1b[0m for SSH sessions"
                ))
            }
            "docker" => {
                ("Interactive", format!(
                    "For now, please use:\n  \x1b[1;36mdocker run\x1b[0m <image> <command> (non-interactive)\n  \x1b[1;36mdocker exec\x1b[0m <container> <command> (single command)\n  Use your \x1b[1;33mregular terminal\x1b[0m for interactive Docker"
                ))
            }
            _ => {
                ("Interactive", format!(
                    "For now, please use non-interactive alternatives or run this command in your regular terminal."
                ))
            }
        }
    }
}