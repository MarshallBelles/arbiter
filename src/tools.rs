use anyhow::{Result, Context};
use serde_json::Value;
use tokio::process::Command as TokioCommand;
use tracing::{debug, info};
// std::path::Path import removed - unused
use crate::tool_args::*;
use crate::config::Config;
use crate::lsp_context::{LspContextExtractor, LspContextConfig};
use crate::repository_context::{RepositoryContextManager, RepositoryContextConfig};

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
            "lsp_analysis" => {
                let parsed_args = LspAnalysisArgs::parse(raw_args)
                    .with_context(|| format!("Failed to parse lsp_analysis arguments: {}", raw_args))?;
                self.lsp_analysis_typed(parsed_args).await
            }
            "repository_analysis" => {
                let parsed_args = RepositoryAnalysisArgs::parse(raw_args)
                    .with_context(|| format!("Failed to parse repository_analysis arguments: {}", raw_args))?;
                self.repository_analysis_typed(parsed_args).await
            }
            "symbol_lookup" => {
                let parsed_args = SymbolLookupArgs::parse(raw_args)
                    .with_context(|| format!("Failed to parse symbol_lookup arguments: {}", raw_args))?;
                self.symbol_lookup_typed(parsed_args).await
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
        
        debug!("Executing shell command: {}", command);
        
        // Handle cd commands specially to maintain working directory state
        if let Some(cd_path) = self.parse_cd_command(command) {
            return self.handle_cd_command(&cd_path).await;
        }
        
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

        // Parse and validate command to prevent injection attacks
        let parsed_command = self.parse_and_validate_command(command)?;
        
        // Execute with proper shell for complex command support
        let mut cmd = TokioCommand::new(&shell);
        cmd.args(&shell_args)
           .arg(&parsed_command)
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
        
        // Validate and secure the file path
        let full_path = self.validate_and_secure_path(path)?;
        
        // Create parent directories if they don't exist
        if let Some(parent) = full_path.parent() {
            tokio::fs::create_dir_all(parent).await
                .context("Failed to create parent directories")?;
        }
        
        tokio::fs::write(&full_path, content).await
            .context("Failed to write file")?;
        
        debug!("Written file: {}", full_path.display());
        Ok(format!("Successfully wrote {} bytes to {}", content.len(), path))
    }
    
    async fn read_file_typed(&mut self, args: ReadFileArgs) -> Result<String> {
        let path = &args.path;
        
        // Validate and secure the file path
        let full_path = self.validate_and_secure_path(path)?;
        
        debug!("Attempting to read file: {} (full path: {})", path, full_path.display());
        debug!("Working directory: {}", self.working_directory.display());
        
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
        
        debug!("Successfully read file: {} ({} bytes)", full_path.display(), content.len());
        Ok(format!("File content of {}:\n{}", path, content))
    }
    
    async fn execute_git_command_typed(&mut self, args: GitCommandArgs) -> Result<String> {
        let command = &args.command;
        
        debug!("Executing git command: git {}", command);
        
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
        
        debug!("Analyzed code file: {}", full_path.display());
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
    
    async fn lsp_analysis_typed(&mut self, args: LspAnalysisArgs) -> Result<String> {
        debug!("Running LSP analysis with args: {:?}", args);
        
        // Load default config for LSP analysis
        let config = Config::load(None)?;
        let mut lsp_extractor = LspContextExtractor::new(config, Some(LspContextConfig::default()))?;
        
        let analysis_type = args.analysis_type.as_deref().unwrap_or("all");
        
        let context_info = if let Some(ref file_path) = args.path {
            // Analyze specific file
            let full_path = self.validate_and_secure_path(file_path)?;
            
            if !full_path.exists() {
                return Err(anyhow::anyhow!("File does not exist: {}", file_path));
            }
            
            let content = tokio::fs::read_to_string(&full_path).await
                .context("Failed to read file for LSP analysis")?;
            
            info!("Analyzing file: {}", full_path.display());
            lsp_extractor.extract_context_for_file(&full_path, &content).await?
        } else {
            // Analyze entire workspace
            info!("Analyzing workspace: {}", self.working_directory.display());
            lsp_extractor.extract_context_for_workspace(&self.working_directory).await?
        };
        
        // Format the results based on analysis type
        let mut result = String::new();
        
        match analysis_type {
            "diagnostics" => {
                result.push_str(&format!("# LSP Diagnostics Analysis\n"));
                result.push_str(&format!("Errors: {} | Warnings: {} | Hints: {}\n\n", 
                    context_info.error_count, context_info.warning_count, context_info.hint_count));
                
                if !context_info.workspace_diagnostics.is_empty() {
                    result.push_str("## Workspace Diagnostics:\n");
                    for (i, diagnostic) in context_info.workspace_diagnostics.iter().take(20).enumerate() {
                        result.push_str(&format!("{}. {}:{} [{}] {}\n", 
                            i + 1, diagnostic.file_path.display(), diagnostic.line + 1, 
                            diagnostic.severity.to_uppercase(), diagnostic.message));
                    }
                    
                    if context_info.workspace_diagnostics.len() > 20 {
                        result.push_str(&format!("... and {} more diagnostics\n", 
                            context_info.workspace_diagnostics.len() - 20));
                    }
                }
            }
            "hover" => {
                result.push_str("# LSP Hover Information\n");
                if let Some(ref file_info) = context_info.current_file_info {
                    if let Some(ref hover) = file_info.hover_info {
                        result.push_str(&format!("**File:** {}\n", file_info.file_path.display()));
                        result.push_str(&format!("**Hover Info:** {}\n", hover));
                    } else {
                        result.push_str("No hover information available for this file.\n");
                    }
                } else {
                    result.push_str("No file specified for hover analysis.\n");
                }
            }
            "completions" => {
                result.push_str("# LSP Completions\n");
                if let Some(ref file_info) = context_info.current_file_info {
                    if !file_info.available_completions.is_empty() {
                        result.push_str(&format!("**File:** {}\n", file_info.file_path.display()));
                        result.push_str(&format!("**Available Completions ({}):**\n", 
                            file_info.available_completions.len()));
                        for completion in &file_info.available_completions {
                            result.push_str(&format!("- {}\n", completion));
                        }
                    } else {
                        result.push_str("No completions available for this file.\n");
                    }
                } else {
                    result.push_str("No file specified for completion analysis.\n");
                }
            }
            _ => {
                // "all" or any other value - show comprehensive analysis
                result.push_str(&lsp_extractor.format_context_for_prompt(&context_info, 4096)?);
            }
        }
        
        // Shutdown LSP connections
        lsp_extractor.shutdown().await?;
        
        debug!("LSP analysis completed");
        Ok(result)
    }
    
    async fn repository_analysis_typed(&mut self, args: RepositoryAnalysisArgs) -> Result<String> {
        debug!("Running repository analysis with args: {:?}", args);
        
        let scope = args.scope.as_deref().unwrap_or("summary");
        let max_tokens = args.max_tokens.unwrap_or(2048);
        
        let mut repo_manager = RepositoryContextManager::new(Some(RepositoryContextConfig {
            max_tokens,
            ..Default::default()
        }))?;
        
        info!("Analyzing repository: {}", self.working_directory.display());
        let context = repo_manager.get_repository_context(&self.working_directory).await?;
        
        let mut result = String::new();
        
        match scope {
            "workspace" => {
                // Comprehensive workspace analysis
                result.push_str(&format!("# Repository Analysis: {}\n", context.project_name));
                result.push_str(&format!("**Path:** {}\n", context.root_path.display()));
                result.push_str(&format!("**Languages:** {}\n", context.languages.join(", ")));
                result.push_str(&format!("**Files Analyzed:** {}\n", context.file_count));
                result.push_str(&format!("**Total Symbols:** {}\n\n", context.total_symbols));
                
                // Show detailed symbol breakdown
                result.push_str("## Symbol Breakdown:\n");
                result.push_str(&format!("- Functions: {}\n", context.symbol_summary.functions.len()));
                result.push_str(&format!("- Structs: {}\n", context.symbol_summary.structs.len()));
                result.push_str(&format!("- Classes: {}\n", context.symbol_summary.classes.len()));
                result.push_str(&format!("- Enums: {}\n", context.symbol_summary.enums.len()));
                result.push_str(&format!("- Traits: {}\n", context.symbol_summary.traits.len()));
                result.push_str(&format!("- Modules: {}\n", context.symbol_summary.modules.len()));
                result.push_str(&format!("- Imports: {}\n\n", context.symbol_summary.imports.len()));
                
                // Show key files
                if !context.key_files.is_empty() {
                    result.push_str("## Key Files:\n");
                    for file in &context.key_files {
                        result.push_str(&format!("- {} ({} symbols)\n", 
                            file.path.display(), file.symbols.len()));
                    }
                }
            }
            "files" => {
                // File-focused analysis
                result.push_str(&format!("# File Analysis: {}\n", context.project_name));
                result.push_str(&format!("**Total Files:** {}\n\n", context.file_count));
                
                if !context.key_files.is_empty() {
                    result.push_str("## Key Files:\n");
                    for file in &context.key_files {
                        result.push_str(&format!("**{}**\n", file.path.display()));
                        result.push_str(&format!("- Language: {}\n", file.language));
                        result.push_str(&format!("- Symbols: {}\n", file.symbols.len()));
                        result.push_str(&format!("- Size: {} bytes\n\n", file.size_bytes));
                    }
                }
            }
            _ => {
                // "summary" - use the smart context formatter
                result = repo_manager.get_context_for_token_limit(&context, max_tokens)?;
            }
        }
        
        debug!("Repository analysis completed");
        Ok(result)
    }
    
    async fn symbol_lookup_typed(&mut self, args: SymbolLookupArgs) -> Result<String> {
        debug!("Running symbol lookup with args: {:?}", args);
        
        let mut repo_manager = RepositoryContextManager::new(Some(RepositoryContextConfig::default()))?;
        
        info!("Looking up symbol '{}' in repository: {}", args.symbol_name, self.working_directory.display());
        let context = repo_manager.get_repository_context(&self.working_directory).await?;
        
        let mut result = String::new();
        result.push_str(&format!("# Symbol Lookup: '{}'\n", args.symbol_name));
        
        let mut found_symbols = Vec::new();
        
        // Search through all symbol types
        let symbol_collections = [
            (&context.symbol_summary.functions, "function"),
            (&context.symbol_summary.structs, "struct"),
            (&context.symbol_summary.classes, "class"),
            (&context.symbol_summary.enums, "enum"),
            (&context.symbol_summary.traits, "trait"),
            (&context.symbol_summary.modules, "module"),
            (&context.symbol_summary.imports, "import"),
        ];
        
        for (symbols, symbol_type) in &symbol_collections {
            // Filter by symbol type if specified
            if let Some(ref filter_type) = args.symbol_type {
                if filter_type != symbol_type {
                    continue;
                }
            }
            
            for symbol in symbols.iter() {
                // Check if symbol name matches (case-insensitive partial match)
                if symbol.name.to_lowercase().contains(&args.symbol_name.to_lowercase()) {
                    // Filter by file pattern if specified
                    if let Some(ref pattern) = args.file_pattern {
                        let file_name = symbol.file_path.file_name()
                            .and_then(|n| n.to_str())
                            .unwrap_or("");
                        if !file_name.contains(pattern) {
                            continue;
                        }
                    }
                    
                    found_symbols.push((symbol, *symbol_type));
                }
            }
        }
        
        if found_symbols.is_empty() {
            result.push_str(&format!("No symbols found matching '{}'\n", args.symbol_name));
            
            if let Some(ref symbol_type) = args.symbol_type {
                result.push_str(&format!("(searched in {} symbols only)\n", symbol_type));
            }
            if let Some(ref pattern) = args.file_pattern {
                result.push_str(&format!("(filtered by file pattern: {})\n", pattern));
            }
        } else {
            result.push_str(&format!("Found {} symbol(s):\n\n", found_symbols.len()));
            
            // Group by symbol type
            let mut current_type = "";
            for (symbol, symbol_type) in &found_symbols {
                if *symbol_type != current_type {
                    result.push_str(&format!("## {}\n", symbol_type.to_uppercase()));
                    current_type = symbol_type;
                }
                
                result.push_str(&format!("- **{}** ({}:{})\n", 
                    symbol.name, symbol.file_path.display(), symbol.line + 1));
            }
            
            // Add summary
            result.push_str(&format!("\n**Summary:** {} matches across {} file(s)\n", 
                found_symbols.len(),
                found_symbols.iter()
                    .map(|(s, _)| &s.file_path)
                    .collect::<std::collections::HashSet<_>>()
                    .len()));
        }
        
        debug!("Symbol lookup completed");
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
        
        debug!("Written file: {}", full_path.display());
        Ok(format!("Successfully wrote {} bytes to {}", content.len(), path))
    }
    
    async fn read_file(&mut self, args: &Value) -> Result<String> {
        let path = args.get("path")
            .and_then(|v| v.as_str())
            .context("Missing 'path' argument")?;
        
        let full_path = self.working_directory.join(path);
        
        debug!("Attempting to read file: {} (full path: {})", path, full_path.display());
        debug!("Working directory: {}", self.working_directory.display());
        
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
        
        debug!("Successfully read file: {} ({} bytes)", full_path.display(), content.len());
        Ok(format!("File content of {}:\n{}", path, content))
    }
    
    async fn execute_git_command(&mut self, args: &Value) -> Result<String> {
        let command = args.get("command")
            .and_then(|v| v.as_str())
            .context("Missing 'command' argument")?;
        
        debug!("Executing git command: git {}", command);
        
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
        
        debug!("Analyzed code file: {}", full_path.display());
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
        debug!("Changed working directory to: {}", self.working_directory.display());
    }
    
    pub fn get_working_directory(&self) -> &std::path::Path {
        &self.working_directory
    }
    
    /// Parse cd command and extract the target path
    fn parse_cd_command(&self, command: &str) -> Option<String> {
        let trimmed = command.trim();
        
        // Handle various cd command formats
        if trimmed == "cd" {
            // cd with no arguments goes to home directory
            Some("~".to_string())
        } else if let Some(path) = trimmed.strip_prefix("cd ") {
            // cd with path argument
            Some(path.trim().to_string())
        } else {
            None
        }
    }
    
    /// Handle cd command by updating working directory
    async fn handle_cd_command(&mut self, path: &str) -> Result<String> {
        
        
        let target_path = if path == "~" {
            // Handle home directory
            std::env::var("HOME")
                .or_else(|_| std::env::var("USERPROFILE")) // Windows fallback
                .map(std::path::PathBuf::from)
                .unwrap_or_else(|_| std::path::PathBuf::from("/"))
        } else if path.starts_with("~/") {
            // Handle ~/path
            let home = std::env::var("HOME")
                .or_else(|_| std::env::var("USERPROFILE"))
                .unwrap_or_else(|_| "/".to_string());
            std::path::PathBuf::from(home).join(&path[2..])
        } else if path.starts_with('/') {
            // Absolute path
            std::path::PathBuf::from(path)
        } else {
            // Relative path
            self.working_directory.join(path)
        };
        
        // Resolve to canonical path and verify it exists
        match target_path.canonicalize() {
            Ok(canonical_path) => {
                if canonical_path.is_dir() {
                    let old_dir = self.working_directory.display().to_string();
                    self.set_working_directory(canonical_path.clone());
                    Ok(format!("Changed directory from {} to {}", old_dir, canonical_path.display()))
                } else {
                    Err(anyhow::anyhow!("cd: {}: Not a directory", path))
                }
            }
            Err(e) => {
                Err(anyhow::anyhow!("cd: {}: {}", path, e))
            }
        }
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
    
    /// Validate and secure file path to prevent directory traversal attacks
    fn validate_and_secure_path(&self, path: &str) -> Result<std::path::PathBuf> {
        // Basic validation checks
        if path.trim().is_empty() {
            return Err(anyhow::anyhow!("File path cannot be empty"));
        }
        
        // Check for null bytes which could cause issues
        if path.contains('\0') {
            return Err(anyhow::anyhow!("File path cannot contain null bytes"));
        }
        
        // Check for length limits
        if path.len() > 4096 {
            return Err(anyhow::anyhow!("File path too long (max 4096 characters)"));
        }
        
        // Check for dangerous patterns that could indicate traversal attempts
        let dangerous_patterns = [
            "..", "~/../", "\\..\\", "/../../", "/..", "\\..\\",
            "../", "..\\", ".../", "...\\", "....", "..;",
        ];
        
        for pattern in &dangerous_patterns {
            if path.contains(pattern) {
                return Err(anyhow::anyhow!(
                    "File path contains dangerous pattern '{}' which could be used for directory traversal",
                    pattern
                ));
            }
        }
        
        // Check for absolute paths outside the working directory
        let input_path = std::path::Path::new(path);
        let full_path = if input_path.is_absolute() {
            // For absolute paths, ensure they're within a safe directory
            // For now, we'll be restrictive and only allow relative paths
            return Err(anyhow::anyhow!(
                "Absolute paths are not allowed for security reasons. Use relative paths only."
            ));
        } else {
            self.working_directory.join(path)
        };
        
        // Canonicalize the path to resolve any remaining .. or . components
        match full_path.canonicalize() {
            Ok(canonical_path) => {
                // Ensure the canonical path is still within our working directory
                let canonical_working_dir = self.working_directory.canonicalize()
                    .context("Failed to canonicalize working directory")?;
                
                if !canonical_path.starts_with(&canonical_working_dir) {
                    return Err(anyhow::anyhow!(
                        "File path resolves outside of working directory (potential directory traversal attack)"
                    ));
                }
                
                Ok(canonical_path)
            }
            Err(_) => {
                // If canonicalization fails, the path might not exist yet (for write operations)
                // In this case, validate the components manually
                let mut components = Vec::new();
                for component in input_path.components() {
                    match component {
                        std::path::Component::Normal(comp) => {
                            components.push(comp.to_string_lossy().to_string());
                        }
                        std::path::Component::CurDir => {
                            // Ignore current directory references
                        }
                        std::path::Component::ParentDir => {
                            return Err(anyhow::anyhow!(
                                "Parent directory references (..) are not allowed"
                            ));
                        }
                        _ => {
                            return Err(anyhow::anyhow!(
                                "Invalid path component detected"
                            ));
                        }
                    }
                }
                
                // Reconstruct the path without dangerous components
                let safe_path = components.join("/");
                Ok(self.working_directory.join(safe_path))
            }
        }
    }
    
    /// Parse and validate command to prevent injection attacks
    fn parse_and_validate_command(&self, command: &str) -> Result<String> {
        // Basic validation checks
        if command.trim().is_empty() {
            return Err(anyhow::anyhow!("Command cannot be empty"));
        }
        
        // Check for length limits to prevent extremely long commands
        if command.len() > 10000 {
            return Err(anyhow::anyhow!("Command too long (max 10000 characters)"));
        }
        
        // Check for null bytes which could cause issues
        if command.contains('\0') {
            return Err(anyhow::anyhow!("Command cannot contain null bytes"));
        }
        
        // Check for dangerous command injection patterns
        let dangerous_patterns = [
            ";", "&&", "||", "|", "`", "$(",
            "$(", "${", ")", ">>", "<<", "&",
            "\n", "\r"
        ];
        
        for pattern in &dangerous_patterns {
            if command.contains(pattern) {
                return Err(anyhow::anyhow!(
                    "Command contains potentially dangerous pattern '{}'. Use individual commands instead of chaining.",
                    pattern
                ));
            }
        }
        
        // Additional validation for specific dangerous commands
        let cmd_lower = command.to_lowercase();
        let dangerous_commands = [
            "rm -rf /", "dd if=", ":(){ :|:& };:", 
            "chmod 777", "chown", "sudo", "su ",
            "/dev/", "mkfs", "fdisk", "format"
        ];
        
        for dangerous_cmd in &dangerous_commands {
            if cmd_lower.contains(dangerous_cmd) {
                return Err(anyhow::anyhow!(
                    "Command contains dangerous operation '{}' which is not allowed",
                    dangerous_cmd
                ));
            }
        }
        
        // Return the sanitized command - for now just trim whitespace
        Ok(command.trim().to_string())
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

    // ========================================
    // NEW ANALYSIS TOOLS TESTS - Phase 1
    // ========================================

    #[tokio::test]
    async fn test_lsp_analysis_json_format() {
        let (mut executor, temp_dir) = create_test_executor().await;
        
        // Create a Rust file for LSP analysis
        let rust_content = r#"
fn main() {
    println!("Hello, world!");
}

struct TestStruct {
    field: i32,
}
"#;
        let file_path = temp_dir.path().join("test.rs");
        std::fs::write(&file_path, rust_content).unwrap();
        
        let args = json!({
            "path": "test.rs",
            "analysis_type": "all"
        });
        
        let result = executor.execute_tool("lsp_analysis", &args).await;
        assert!(result.is_ok());
        let output = result.unwrap();
        assert!(output.contains("LSP Analysis") || output.contains("Errors:") || output.contains("Warnings:"));
    }

    #[tokio::test]
    async fn test_lsp_analysis_text_format() {
        let (mut executor, temp_dir) = create_test_executor().await;
        
        // Create a Rust file
        let rust_content = "fn test() { println!(\"test\"); }";
        let file_path = temp_dir.path().join("test.rs");
        std::fs::write(&file_path, rust_content).unwrap();
        
        // Test text format: "path analysis_type"
        let result = executor.execute_tool_with_raw_args("lsp_analysis", "test.rs diagnostics").await;
        assert!(result.is_ok());
        let output = result.unwrap();
        assert!(output.contains("LSP Diagnostics") || output.contains("Errors:"));
    }

    #[tokio::test]
    async fn test_lsp_analysis_workspace_mode() {
        let (mut executor, _temp_dir) = create_test_executor().await;
        
        // Test workspace analysis (no args)
        let result = executor.execute_tool_with_raw_args("lsp_analysis", "").await;
        assert!(result.is_ok());
        let output = result.unwrap();
        assert!(output.contains("LSP Analysis") || output.contains("workspace") || output.contains("Errors:"));
    }

    #[tokio::test]
    async fn test_lsp_analysis_different_types() {
        let (mut executor, temp_dir) = create_test_executor().await;
        
        // Create a test file
        let file_path = temp_dir.path().join("test.py");
        std::fs::write(&file_path, "def hello(): print('hello')").unwrap();
        
        // Test different analysis types
        let analysis_types = ["diagnostics", "hover", "completions", "all"];
        
        for analysis_type in &analysis_types {
            let args = json!({
                "path": "test.py",
                "analysis_type": analysis_type
            });
            
            let result = executor.execute_tool("lsp_analysis", &args).await;
            assert!(result.is_ok(), "Failed for analysis_type: {}", analysis_type);
            let output = result.unwrap();
            
            match *analysis_type {
                "diagnostics" => assert!(output.contains("LSP Diagnostics") || output.contains("Errors:")),
                "hover" => assert!(output.contains("LSP Hover") || output.contains("Hover Info")),
                "completions" => assert!(output.contains("LSP Completions") || output.contains("Completions")),
                "all" => assert!(output.contains("LSP Analysis") || output.contains("Errors:")),
                _ => {}
            }
        }
    }

    #[tokio::test]
    async fn test_lsp_analysis_invalid_path() {
        let (mut executor, _temp_dir) = create_test_executor().await;
        
        let args = json!({
            "path": "nonexistent_file.rs",
            "analysis_type": "diagnostics"
        });
        
        let result = executor.execute_tool("lsp_analysis", &args).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("File does not exist"));
    }

    #[tokio::test]
    async fn test_lsp_analysis_invalid_analysis_type() {
        let (mut executor, _temp_dir) = create_test_executor().await;
        
        // Test invalid analysis type through raw args
        let result = executor.execute_tool_with_raw_args("lsp_analysis", "test.rs invalid_type").await;
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("Invalid analysis type"));
    }

    #[tokio::test]
    async fn test_repository_analysis_json_format() {
        let (mut executor, _temp_dir) = create_test_executor().await;
        
        let args = json!({
            "scope": "summary",
            "max_tokens": 1024
        });
        
        let result = executor.execute_tool("repository_analysis", &args).await;
        assert!(result.is_ok());
        let output = result.unwrap();
        assert!(output.contains("Repository") || output.contains("Files") || output.contains("Languages"));
    }

    #[tokio::test]
    async fn test_repository_analysis_text_format() {
        let (mut executor, _temp_dir) = create_test_executor().await;
        
        // Test "scope max_tokens" format
        let result = executor.execute_tool_with_raw_args("repository_analysis", "workspace 2048").await;
        assert!(result.is_ok());
        let output = result.unwrap();
        assert!(output.contains("Repository Analysis") || output.contains("workspace"));
        
        // Test just scope
        let result = executor.execute_tool_with_raw_args("repository_analysis", "files").await;
        assert!(result.is_ok());
        let output = result.unwrap();
        assert!(output.contains("File Analysis") || output.contains("Files"));
        
        // Test just number (interpreted as max_tokens)
        let result = executor.execute_tool_with_raw_args("repository_analysis", "512").await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_repository_analysis_all_scopes() {
        let (mut executor, temp_dir) = create_test_executor().await;
        
        // Create some test files to analyze
        std::fs::write(temp_dir.path().join("main.rs"), "fn main() {}").unwrap();
        std::fs::write(temp_dir.path().join("lib.rs"), "pub fn test() {}").unwrap();
        
        let scopes = ["workspace", "summary", "files"];
        
        for scope in &scopes {
            let args = json!({
                "scope": scope,
                "max_tokens": 1024
            });
            
            let result = executor.execute_tool("repository_analysis", &args).await;
            assert!(result.is_ok(), "Failed for scope: {}", scope);
            let output = result.unwrap();
            
            match *scope {
                "workspace" => assert!(output.contains("Repository Analysis") && output.contains("Symbol Breakdown")),
                "files" => assert!(output.contains("File Analysis")),
                "summary" => assert!(output.contains("Repository Context") || output.contains("Languages") || output.contains("Files")),
                _ => {}
            }
        }
    }

    #[tokio::test]
    async fn test_repository_analysis_default_behavior() {
        let (mut executor, _temp_dir) = create_test_executor().await;
        
        // Test empty args (should default to summary)
        let result = executor.execute_tool_with_raw_args("repository_analysis", "").await;
        assert!(result.is_ok());
        let output = result.unwrap();
        assert!(output.contains("Repository Context") || output.contains("Languages") || output.contains("Files"));
    }

    #[tokio::test]
    async fn test_repository_analysis_token_validation() {
        let (mut executor, _temp_dir) = create_test_executor().await;
        
        // Test invalid token limits
        let invalid_tokens = ["0", "50001"];
        
        for tokens in &invalid_tokens {
            let result = executor.execute_tool_with_raw_args("repository_analysis", &format!("summary {}", tokens)).await;
            assert!(result.is_err(), "Should fail for tokens: {}", tokens);
            let error = result.unwrap_err().to_string();
            assert!(error.contains("Max tokens") || error.contains("greater than 0") || error.contains("cannot exceed"));
        }
    }

    #[tokio::test]
    async fn test_repository_analysis_invalid_scope() {
        let (mut executor, _temp_dir) = create_test_executor().await;
        
        let result = executor.execute_tool_with_raw_args("repository_analysis", "invalid_scope 1024").await;
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("Invalid scope"));
    }

    #[tokio::test]
    async fn test_symbol_lookup_json_format() {
        let (mut executor, temp_dir) = create_test_executor().await;
        
        // Create a test file with symbols
        let rust_content = r#"
fn main() {
    println!("Hello, world!");
}

struct TestStruct {
    field: i32,
}

enum TestEnum {
    Variant1,
    Variant2,
}
"#;
        std::fs::write(temp_dir.path().join("test.rs"), rust_content).unwrap();
        
        let args = json!({
            "symbol_name": "Test",
            "symbol_type": "struct"
        });
        
        let result = executor.execute_tool("symbol_lookup", &args).await;
        assert!(result.is_ok());
        let output = result.unwrap();
        assert!(output.contains("Symbol Lookup: 'Test'"));
    }

    #[tokio::test]
    async fn test_symbol_lookup_text_format() {
        let (mut executor, temp_dir) = create_test_executor().await;
        
        // Create test files
        std::fs::write(temp_dir.path().join("main.rs"), "fn main() {}").unwrap();
        std::fs::write(temp_dir.path().join("lib.rs"), "fn helper() {}").unwrap();
        
        // Test different text formats
        let formats = [
            "main",                    // Just symbol name
            "main function",           // Symbol name + type
            "main function *.rs",      // Symbol name + type + file pattern
        ];
        
        for format in &formats {
            let result = executor.execute_tool_with_raw_args("symbol_lookup", format).await;
            assert!(result.is_ok(), "Failed for format: {}", format);
            let output = result.unwrap();
            assert!(output.contains("Symbol Lookup:"));
        }
    }

    #[tokio::test]
    async fn test_symbol_lookup_by_type() {
        let (mut executor, temp_dir) = create_test_executor().await;
        
        // Create a comprehensive test file
        let rust_content = r#"
fn main() {}
fn helper() {}
struct MyStruct {}
enum MyEnum {}
trait MyTrait {}
mod my_module {}
"#;
        std::fs::write(temp_dir.path().join("test.rs"), rust_content).unwrap();
        
        let symbol_types = ["function", "struct", "enum", "trait", "module"];
        
        for symbol_type in &symbol_types {
            let args = json!({
                "symbol_name": "my",  // Should match multiple symbols
                "symbol_type": symbol_type
            });
            
            let result = executor.execute_tool("symbol_lookup", &args).await;
            assert!(result.is_ok(), "Failed for symbol_type: {}", symbol_type);
            let output = result.unwrap();
            assert!(output.contains("Symbol Lookup: 'my'"));
        }
    }

    #[tokio::test]
    async fn test_symbol_lookup_file_pattern_filtering() {
        let (mut executor, temp_dir) = create_test_executor().await;
        
        // Create multiple files
        std::fs::write(temp_dir.path().join("main.rs"), "fn main() {}").unwrap();
        std::fs::write(temp_dir.path().join("lib.rs"), "fn main() {}").unwrap();
        std::fs::write(temp_dir.path().join("helper.py"), "def main(): pass").unwrap();
        
        // Search with file pattern
        let args = json!({
            "symbol_name": "main",
            "file_pattern": "main.rs"
        });
        
        let result = executor.execute_tool("symbol_lookup", &args).await;
        assert!(result.is_ok());
        let output = result.unwrap();
        assert!(output.contains("Symbol Lookup: 'main'"));
        // Should find results since we have main() in main.rs
    }

    #[tokio::test]
    async fn test_symbol_lookup_case_insensitive() {
        let (mut executor, temp_dir) = create_test_executor().await;
        
        std::fs::write(temp_dir.path().join("test.rs"), "fn TestFunction() {}").unwrap();
        
        // Test case-insensitive search
        let args = json!({
            "symbol_name": "testfunction"  // lowercase
        });
        
        let result = executor.execute_tool("symbol_lookup", &args).await;
        assert!(result.is_ok());
        let output = result.unwrap();
        assert!(output.contains("Symbol Lookup: 'testfunction'"));
    }

    #[tokio::test]
    async fn test_symbol_lookup_no_results() {
        let (mut executor, temp_dir) = create_test_executor().await;
        
        std::fs::write(temp_dir.path().join("test.rs"), "fn main() {}").unwrap();
        
        // Search for non-existent symbol
        let args = json!({
            "symbol_name": "nonexistent_symbol"
        });
        
        let result = executor.execute_tool("symbol_lookup", &args).await;
        assert!(result.is_ok());
        let output = result.unwrap();
        assert!(output.contains("No symbols found matching"));
    }

    #[tokio::test]
    async fn test_symbol_lookup_empty_symbol_name() {
        let (mut executor, _temp_dir) = create_test_executor().await;
        
        // Test empty symbol name
        let result = executor.execute_tool_with_raw_args("symbol_lookup", "").await;
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("Symbol name is required"));
    }

    #[tokio::test]
    async fn test_symbol_lookup_invalid_symbol_type() {
        let (mut executor, _temp_dir) = create_test_executor().await;
        
        let result = executor.execute_tool_with_raw_args("symbol_lookup", "test invalid_type").await;
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("Invalid symbol type"));
    }

    #[tokio::test]
    async fn test_new_tools_unknown_tool_error() {
        let (mut executor, _temp_dir) = create_test_executor().await;
        
        // Test that unknown tools still return proper errors
        let result = executor.execute_tool("unknown_analysis_tool", &json!({})).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("Unknown tool: unknown_analysis_tool"));
    }
}