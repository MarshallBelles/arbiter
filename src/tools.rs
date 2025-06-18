use anyhow::{Result, Context};
use serde_json::Value;
use std::process::{Command, Stdio};
use std::io::Write;
use tokio::process::Command as TokioCommand;
use tracing::{debug, error, info};
use crate::tool_args::*;

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
    
    /// Execute a tool with raw string arguments (supports both JSON and text formats)
    pub async fn execute_tool_with_raw_args(&mut self, tool_name: &str, raw_args: &str) -> Result<String> {
        match tool_name {
            "shell_command" => {
                let parsed_args = ShellCommandArgs::parse(raw_args)
                    .with_context(|| format!("Failed to parse shell_command arguments: {}", raw_args))?;
                self.execute_shell_command_typed(parsed_args).await
            }
            "write_file" => {
                let parsed_args = WriteFileArgs::parse(raw_args)
                    .with_context(|| format!("Failed to parse write_file arguments: {}", raw_args))?;
                self.write_file_typed(parsed_args).await
            }
            "read_file" => {
                let parsed_args = ReadFileArgs::parse(raw_args)
                    .with_context(|| format!("Failed to parse read_file arguments: {}", raw_args))?;
                self.read_file_typed(parsed_args).await
            }
            "git_command" => {
                let parsed_args = GitCommandArgs::parse(raw_args)
                    .with_context(|| format!("Failed to parse git_command arguments: {}", raw_args))?;
                self.execute_git_command_typed(parsed_args).await
            }
            "code_analysis" => {
                let parsed_args = CodeAnalysisArgs::parse(raw_args)
                    .with_context(|| format!("Failed to parse code_analysis arguments: {}", raw_args))?;
                self.analyze_code_typed(parsed_args).await
            }
            "debug_directory" => {
                let parsed_args = DebugDirectoryArgs::parse(raw_args)
                    .with_context(|| format!("Failed to parse debug_directory arguments: {}", raw_args))?;
                self.debug_directory_typed(parsed_args).await
            }
            _ => Err(anyhow::anyhow!("Unknown tool: {}", tool_name)),
        }
    }

    /// Legacy method for backward compatibility with Value arguments
    pub async fn execute_tool(&mut self, tool_name: &str, args: &Value) -> Result<String> {
        // For backward compatibility, we still receive Value but extract the raw string
        let raw_args = if let Some(args_str) = args.as_str() {
            args_str
        } else {
            // If it's already a JSON object, serialize it back to string for parsing
            &args.to_string()
        };

        self.execute_tool_with_raw_args(tool_name, raw_args).await
    }
    
    async fn execute_shell_command_typed(&mut self, args: ShellCommandArgs) -> Result<String> {
        let command = &args.command;
        
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
    
    async fn write_file_typed(&mut self, args: WriteFileArgs) -> Result<String> {
        let path = &args.path;
        let content = &args.content;
        
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
    
    async fn read_file_typed(&mut self, args: ReadFileArgs) -> Result<String> {
        let path = &args.path;
        
        let full_path = self.working_directory.join(path);
        
        info!("Attempting to read file: {} (full path: {})", path, full_path.display());
        info!("Working directory: {}", self.working_directory.display());
        
        // Check if file exists first
        if !full_path.exists() {
            return Err(anyhow::anyhow!(
                "File does not exist: {} (full path: {})", 
                path, full_path.display()
            ));
        }
        
        // Check if it's actually a file
        if !full_path.is_file() {
            return Err(anyhow::anyhow!(
                "Path exists but is not a file: {} (full path: {})", 
                path, full_path.display()
            ));
        }
        
        // Try to read the file with detailed error information
        let content = tokio::fs::read_to_string(&full_path).await
            .with_context(|| format!(
                "Failed to read file: {} (full path: {}). Check file permissions and encoding.", 
                path, full_path.display()
            ))?;
        
        info!("Successfully read file: {} ({} bytes)", full_path.display(), content.len());
        Ok(format!("File content of {}:\n{}", path, content))
    }
    
    async fn execute_git_command_typed(&mut self, args: GitCommandArgs) -> Result<String> {
        let command = &args.command;
        
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
    
    async fn analyze_code_typed(&mut self, args: CodeAnalysisArgs) -> Result<String> {
        let path = &args.path;
        
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
    
    async fn debug_directory_typed(&mut self, _args: DebugDirectoryArgs) -> Result<String> {
        let mut debug_info = format!("Debug Directory Information:\n");
        debug_info.push_str(&format!("Working Directory: {}\n", self.working_directory.display()));
        debug_info.push_str(&format!("Working Directory Exists: {}\n", self.working_directory.exists()));
        debug_info.push_str(&format!("Working Directory Is Dir: {}\n", self.working_directory.is_dir()));
        
        // Get the actual current working directory from the system
        match std::env::current_dir() {
            Ok(current) => {
                debug_info.push_str(&format!("System Current Dir: {}\n", current.display()));
                debug_info.push_str(&format!("Directories Match: {}\n", current == self.working_directory));
            }
            Err(e) => {
                debug_info.push_str(&format!("Failed to get system current dir: {}\n", e));
            }
        }
        
        // List files in the working directory
        debug_info.push_str("\nFiles in working directory:\n");
        match tokio::fs::read_dir(&self.working_directory).await {
            Ok(mut entries) => {
                while let Ok(Some(entry)) = entries.next_entry().await {
                    let metadata = entry.metadata().await;
                    let file_type = match metadata {
                        Ok(meta) => {
                            if meta.is_file() { "file" }
                            else if meta.is_dir() { "dir" }
                            else { "other" }
                        }
                        Err(_) => "unknown"
                    };
                    debug_info.push_str(&format!("  {} ({})\n", entry.file_name().to_string_lossy(), file_type));
                }
            }
            Err(e) => {
                debug_info.push_str(&format!("Failed to read directory: {}\n", e));
            }
        }
        
        Ok(debug_info)
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
        
        info!("Attempting to read file: {} (full path: {})", path, full_path.display());
        info!("Working directory: {}", self.working_directory.display());
        
        // Check if file exists first
        if !full_path.exists() {
            return Err(anyhow::anyhow!(
                "File does not exist: {} (full path: {})", 
                path, full_path.display()
            ));
        }
        
        // Check if it's actually a file
        if !full_path.is_file() {
            return Err(anyhow::anyhow!(
                "Path exists but is not a file: {} (full path: {})", 
                path, full_path.display()
            ));
        }
        
        // Try to read the file with detailed error information
        let content = tokio::fs::read_to_string(&full_path).await
            .with_context(|| format!(
                "Failed to read file: {} (full path: {}). Check file permissions and encoding.", 
                path, full_path.display()
            ))?;
        
        info!("Successfully read file: {} ({} bytes)", full_path.display(), content.len());
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
    
    async fn debug_directory(&mut self, _args: &Value) -> Result<String> {
        let mut debug_info = format!("Debug Directory Information:\n");
        debug_info.push_str(&format!("Working Directory: {}\n", self.working_directory.display()));
        debug_info.push_str(&format!("Working Directory Exists: {}\n", self.working_directory.exists()));
        debug_info.push_str(&format!("Working Directory Is Dir: {}\n", self.working_directory.is_dir()));
        
        // Get the actual current working directory from the system
        match std::env::current_dir() {
            Ok(current) => {
                debug_info.push_str(&format!("System Current Dir: {}\n", current.display()));
                debug_info.push_str(&format!("Directories Match: {}\n", current == self.working_directory));
            }
            Err(e) => {
                debug_info.push_str(&format!("Failed to get system current dir: {}\n", e));
            }
        }
        
        // List files in the working directory
        debug_info.push_str("\nFiles in working directory:\n");
        match tokio::fs::read_dir(&self.working_directory).await {
            Ok(mut entries) => {
                while let Ok(Some(entry)) = entries.next_entry().await {
                    let metadata = entry.metadata().await;
                    let file_type = match metadata {
                        Ok(meta) => {
                            if meta.is_file() { "file" }
                            else if meta.is_dir() { "dir" }
                            else { "other" }
                        }
                        Err(_) => "unknown"
                    };
                    debug_info.push_str(&format!("  {} ({})\n", entry.file_name().to_string_lossy(), file_type));
                }
            }
            Err(e) => {
                debug_info.push_str(&format!("Failed to read directory: {}\n", e));
            }
        }
        
        Ok(debug_info)
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
        // Note: Rust regex crate doesn't support lookahead, so we use simpler patterns
        
        // Check for specific interactive patterns first
        let simple_interactive_patterns = [
            // Text editors
            r"\b(vim|vi|nano|emacs|code)\b",
            // Interactive shells
            r"\b(bash|zsh|fish|sh)\s*$",
            // Interactive utilities
            r"\b(top|htop|less|more|man)\b",
            // Streaming commands
            r"\btail\s+.*-f\b",
            r"\bwatch\b",
            // Docker interactive
            r"\bdocker\s+run\b.*-i",
        ];
        
        for pattern in &simple_interactive_patterns {
            if regex::Regex::new(pattern)
                .map(|re| re.is_match(command))
                .unwrap_or(false) {
                return true;
            }
        }
        
        // Handle special cases that require negative conditions
        // Check for ping without -c flag
        if command.contains("ping") && !command.contains("-c") {
            return true;
        }
        
        // Check for git commit without -m flag
        if let Ok(re) = regex::Regex::new(r"\bgit\s+commit\b") {
            if re.is_match(command) && !command.contains("-m") && !command.contains("--message") {
                return true;
            }
        }
        
        // Check for git rebase -i (interactive rebase)
        if let Ok(re) = regex::Regex::new(r"\bgit\s+rebase\s+.*-i\b") {
            if re.is_match(command) {
                return true;
            }
        }
        
        // Check for ssh without -c flag
        if let Ok(re) = regex::Regex::new(r"\bssh\b") {
            if re.is_match(command) && !command.contains("-c") {
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

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::{TempDir, NamedTempFile};
    use serde_json::json;
    use std::io::Write as StdWrite;

    async fn create_test_executor() -> (ToolExecutor, TempDir) {
        let temp_dir = TempDir::new().unwrap();
        let mut executor = ToolExecutor::new();
        executor.set_working_directory(temp_dir.path().to_path_buf());
        (executor, temp_dir)
    }

    #[tokio::test]
    async fn test_shell_command_success() {
        let (mut executor, _temp_dir) = create_test_executor().await;
        
        let args = json!({
            "command": "echo 'Hello, World!'"
        });
        
        let result = executor.execute_tool("shell_command", &args).await;
        assert!(result.is_ok());
        let output = result.unwrap();
        assert!(output.contains("Hello, World!"));
        assert!(output.contains("Command executed successfully"));
    }

    #[tokio::test]
    async fn test_shell_command_failure() {
        let (mut executor, _temp_dir) = create_test_executor().await;
        
        let args = json!({
            "command": "nonexistent_command_12345"
        });
        
        let result = executor.execute_tool("shell_command", &args).await;
        assert!(result.is_ok()); // Command execution succeeds, but the command itself fails
        let output = result.unwrap();
        assert!(output.contains("Command failed"));
    }

    #[tokio::test]
    async fn test_shell_command_missing_args() {
        let (mut executor, _temp_dir) = create_test_executor().await;
        
        // Test with empty string - should fail validation
        let result = executor.execute_tool_with_raw_args("shell_command", "").await;
        assert!(result.is_err());
        let error_msg = result.unwrap_err().to_string();
        println!("Error message: {}", error_msg);
        assert!(error_msg.contains("Failed to parse shell_command arguments"));
        
        // Test with just whitespace - should fail validation
        let result = executor.execute_tool_with_raw_args("shell_command", "   ").await;
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("Failed to parse shell_command arguments"));
    }

    #[tokio::test]
    async fn test_shell_command_interactive_detection() {
        let (mut executor, _temp_dir) = create_test_executor().await;
        
        let args = json!({
            "command": "vim test.txt"
        });
        
        let result = executor.execute_tool("shell_command", &args).await;
        assert!(result.is_ok());
        let output = result.unwrap();
        assert!(output.contains("Interactive command detected"));
        assert!(output.contains("cat <file>"));
    }

    #[tokio::test]
    async fn test_write_file_success() {
        let (mut executor, _temp_dir) = create_test_executor().await;
        
        let args = json!({
            "path": "test.txt",
            "content": "Hello, World!\nThis is a test file."
        });
        
        let result = executor.execute_tool("write_file", &args).await;
        assert!(result.is_ok());
        let output = result.unwrap();
        assert!(output.contains("Successfully wrote"));
        assert!(output.contains("test.txt"));
        
        // Verify file was actually written
        let file_path = executor.get_working_directory().join("test.txt");
        assert!(file_path.exists());
        let content = std::fs::read_to_string(file_path).unwrap();
        assert_eq!(content, "Hello, World!\nThis is a test file.");
    }

    #[tokio::test]
    async fn test_write_file_with_directories() {
        let (mut executor, _temp_dir) = create_test_executor().await;
        
        let args = json!({
            "path": "nested/dir/test.txt",
            "content": "File in nested directory"
        });
        
        let result = executor.execute_tool("write_file", &args).await;
        assert!(result.is_ok());
        
        // Verify file and directories were created
        let file_path = executor.get_working_directory().join("nested/dir/test.txt");
        assert!(file_path.exists());
        let content = std::fs::read_to_string(file_path).unwrap();
        assert_eq!(content, "File in nested directory");
    }

    #[tokio::test]
    async fn test_write_file_missing_args() {
        let (mut executor, _temp_dir) = create_test_executor().await;
        
        // Test with empty string - should fail validation (empty path)
        let result = executor.execute_tool_with_raw_args("write_file", "").await;
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("Failed to parse write_file arguments"));
        
        // Test with just whitespace - should fail validation (empty path)
        let result = executor.execute_tool_with_raw_args("write_file", "   ").await;
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("Failed to parse write_file arguments"));
    }

    #[tokio::test]
    async fn test_read_file_success() {
        let (mut executor, temp_dir) = create_test_executor().await;
        
        // First write a file
        let file_path = temp_dir.path().join("test.txt");
        std::fs::write(&file_path, "Hello, World!\nThis is a test.").unwrap();
        
        let args = json!({
            "path": "test.txt"
        });
        
        let result = executor.execute_tool("read_file", &args).await;
        assert!(result.is_ok());
        let output = result.unwrap();
        assert!(output.contains("File content of test.txt"));
        assert!(output.contains("Hello, World!"));
        assert!(output.contains("This is a test."));
    }

    #[tokio::test]
    async fn test_read_file_not_found() {
        let (mut executor, _temp_dir) = create_test_executor().await;
        
        let result = executor.execute_tool_with_raw_args("read_file", "nonexistent.txt").await;
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("File does not exist"));
    }

    #[tokio::test]
    async fn test_read_file_missing_args() {
        let (mut executor, _temp_dir) = create_test_executor().await;
        
        // Test with empty string - should fail validation
        let result = executor.execute_tool_with_raw_args("read_file", "").await;
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("Failed to parse read_file arguments"));
        
        // Test with just whitespace - should fail validation
        let result = executor.execute_tool_with_raw_args("read_file", "   ").await;
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("Failed to parse read_file arguments"));
    }

    #[tokio::test]
    async fn test_git_command_success() {
        let (mut executor, _temp_dir) = create_test_executor().await;
        
        // Initialize a git repository first
        let init_result = executor.execute_tool("git_command", &json!({"command": "init"})).await;
        assert!(init_result.is_ok());
        
        let args = json!({
            "command": "status"
        });
        
        let result = executor.execute_tool("git_command", &args).await;
        assert!(result.is_ok());
        let output = result.unwrap();
        assert!(output.contains("Git command executed successfully") || output.contains("Git command failed"));
    }

    #[tokio::test]
    async fn test_git_command_complex() {
        let (mut executor, _temp_dir) = create_test_executor().await;
        
        let args = json!({
            "command": "log --oneline -n 5"
        });
        
        let result = executor.execute_tool("git_command", &args).await;
        // This should work even if it fails (no commits), as long as parsing works
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_git_command_missing_args() {
        let (mut executor, _temp_dir) = create_test_executor().await;
        
        // Test with empty string - should fail validation
        let result = executor.execute_tool_with_raw_args("git_command", "").await;
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("Failed to parse git_command arguments"));
        
        // Test with just whitespace - should fail validation
        let result = executor.execute_tool_with_raw_args("git_command", "   ").await;
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("Failed to parse git_command arguments"));
    }

    #[tokio::test]
    async fn test_code_analysis_rust_file() {
        let (mut executor, temp_dir) = create_test_executor().await;
        
        // Create a Rust file
        let rust_content = r#"
fn main() {
    println!("Hello, world!");
}

struct TestStruct {
    field: i32,
}

impl TestStruct {
    fn new(value: i32) -> Self {
        Self { field: value }
    }
}
"#;
        let file_path = temp_dir.path().join("test.rs");
        std::fs::write(&file_path, rust_content).unwrap();
        
        let args = json!({
            "path": "test.rs"
        });
        
        let result = executor.execute_tool("code_analysis", &args).await;
        assert!(result.is_ok());
        let output = result.unwrap();
        assert!(output.contains("Code analysis for test.rs"));
        assert!(output.contains("Lines:"));
        assert!(output.contains("Characters:"));
        assert!(output.contains("Words:"));
        assert!(output.contains("Detected language:"));
    }

    #[tokio::test]
    async fn test_code_analysis_missing_file() {
        let (mut executor, _temp_dir) = create_test_executor().await;
        
        let args = json!({
            "path": "nonexistent.rs"
        });
        
        let result = executor.execute_tool("code_analysis", &args).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("Failed to read file for analysis"));
    }

    #[tokio::test]
    async fn test_code_analysis_missing_args() {
        let (mut executor, _temp_dir) = create_test_executor().await;
        
        // Test with empty string - should fail validation
        let result = executor.execute_tool_with_raw_args("code_analysis", "").await;
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("Failed to parse code_analysis arguments"));
        
        // Test with just whitespace - should fail validation
        let result = executor.execute_tool_with_raw_args("code_analysis", "   ").await;
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("Failed to parse code_analysis arguments"));
    }

    #[tokio::test]
    async fn test_unknown_tool() {
        let (mut executor, _temp_dir) = create_test_executor().await;
        
        let args = json!({
            "some": "args"
        });
        
        let result = executor.execute_tool("unknown_tool", &args).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("Unknown tool: unknown_tool"));
    }

    #[test]
    fn test_detect_shell() {
        let executor = ToolExecutor::new();
        let shell = executor.detect_shell();
        
        // Should detect a valid shell
        assert!(!shell.is_empty());
        assert!(shell.contains("sh") || shell.contains("bash") || shell.contains("cmd"));
    }

    #[test]
    fn test_get_shell_args() {
        let executor = ToolExecutor::new();
        
        assert_eq!(executor.get_shell_args("bash"), vec!["-c"]);
        assert_eq!(executor.get_shell_args("zsh"), vec!["-c"]);
        assert_eq!(executor.get_shell_args("sh"), vec!["-c"]);
        assert_eq!(executor.get_shell_args("cmd"), vec!["/C"]);
        assert_eq!(executor.get_shell_args("powershell"), vec!["-Command"]);
    }

    #[test]
    fn test_is_complex_interactive_command() {
        let executor = ToolExecutor::new();
        
        // Interactive commands
        assert!(executor.is_complex_interactive_command("vim test.txt"));
        assert!(executor.is_complex_interactive_command("nano file.txt"));
        assert!(executor.is_complex_interactive_command("top"));
        assert!(executor.is_complex_interactive_command("tail -f log.txt"));
        assert!(executor.is_complex_interactive_command("watch ls"));
        assert!(executor.is_complex_interactive_command("git commit"));
        assert!(executor.is_complex_interactive_command("docker run -it ubuntu"));
        assert!(executor.is_complex_interactive_command("ping example.com"));
        assert!(executor.is_complex_interactive_command("ssh user@host"));
        
        // Non-interactive commands
        assert!(!executor.is_complex_interactive_command("ls -la"));
        assert!(!executor.is_complex_interactive_command("cat file.txt"));
        assert!(!executor.is_complex_interactive_command("git status"));
        assert!(!executor.is_complex_interactive_command("git commit -m 'message'"));
        assert!(!executor.is_complex_interactive_command("git commit --message 'test'"));
        assert!(!executor.is_complex_interactive_command("ping -c 4 example.com"));
        assert!(!executor.is_complex_interactive_command("ssh -c 'ls' user@host"));
    }

    #[test]
    fn test_working_directory() {
        let mut executor = ToolExecutor::new();
        let original_dir = executor.get_working_directory().to_path_buf();
        
        let temp_dir = TempDir::new().unwrap();
        executor.set_working_directory(temp_dir.path().to_path_buf());
        
        assert_eq!(executor.get_working_directory(), temp_dir.path());
        assert_ne!(executor.get_working_directory(), original_dir);
    }

    #[tokio::test]
    async fn test_file_operations_integration() {
        let (mut executor, _temp_dir) = create_test_executor().await;
        
        // Write a file
        let write_result = executor.execute_tool("write_file", &json!({
            "path": "integration_test.txt",
            "content": "Integration test content\nLine 2\nLine 3"
        })).await;
        assert!(write_result.is_ok());
        
        // Read the file back
        let read_result = executor.execute_tool("read_file", &json!({
            "path": "integration_test.txt"
        })).await;
        assert!(read_result.is_ok());
        let read_output = read_result.unwrap();
        assert!(read_output.contains("Integration test content"));
        assert!(read_output.contains("Line 2"));
        assert!(read_output.contains("Line 3"));
        
        // Analyze the file
        let analysis_result = executor.execute_tool("code_analysis", &json!({
            "path": "integration_test.txt"
        })).await;
        assert!(analysis_result.is_ok());
        let analysis_output = analysis_result.unwrap();
        assert!(analysis_output.contains("Lines: 3"));
    }
}