use anyhow::{Result, Context, anyhow};
use serde::{Deserialize, de::DeserializeOwned};

/// Trait for parsing tool arguments from both JSON and text formats
pub trait ToolArgumentParser: Sized + DeserializeOwned {
    /// Parse arguments from JSON format (preferred)
    fn parse_json(args: &str) -> Result<Self> {
        serde_json::from_str(args)
            .with_context(|| format!("Failed to parse JSON arguments: {}", args))
    }
    
    /// Parse arguments from text format (legacy/XML compatibility)
    fn parse_text(args: &str) -> Result<Self>;
    
    /// Validate the parsed arguments
    fn validate(&self) -> Result<()> {
        Ok(()) // Default implementation - override if validation needed
    }
    
    /// Parse arguments from either JSON or text format with automatic detection
    fn parse(args: &str) -> Result<Self> {
        let trimmed = args.trim();
        
        // Try JSON format first (preferred)
        if let Ok(parsed) = Self::parse_json(trimmed) {
            parsed.validate()?;
            return Ok(parsed);
        }
        
        // Fall back to text format
        let parsed = Self::parse_text(trimmed)
            .with_context(|| format!(
                "Failed to parse arguments in both JSON and text formats. Input: {}", 
                trimmed
            ))?;
        
        parsed.validate()?;
        Ok(parsed)
    }
}

/// Arguments for shell_command tool
#[derive(Debug, Deserialize, Clone)]
pub struct ShellCommandArgs {
    pub command: String,
}

impl ToolArgumentParser for ShellCommandArgs {
    fn parse_text(args: &str) -> Result<Self> {
        Ok(ShellCommandArgs {
            command: args.trim().to_string(),
        })
    }
    
    fn validate(&self) -> Result<()> {
        if self.command.trim().is_empty() {
            return Err(anyhow!("Shell command cannot be empty"));
        }
        Ok(())
    }
}

/// Arguments for write_file tool
#[derive(Debug, Deserialize, Clone)]
pub struct WriteFileArgs {
    pub path: String,
    #[serde(default)]
    pub content: String,
}

impl ToolArgumentParser for WriteFileArgs {
    fn parse_text(args: &str) -> Result<Self> {
        let args = args.trim();
        
        // Try multiple text formats
        if let Some(newline_pos) = args.find('\n') {
            // Format 1: "path\ncontent" (newline-separated)
            let (path, content) = args.split_at(newline_pos);
            Ok(WriteFileArgs {
                path: path.trim().to_string(),
                content: content[1..].to_string(), // Skip the newline
            })
        } else if let Some(pipe_pos) = args.find('|') {
            // Format 2: "path|content" (pipe-separated)
            let (path, content) = args.split_at(pipe_pos);
            Ok(WriteFileArgs {
                path: path.trim().to_string(),
                content: content[1..].trim().to_string(), // Skip the pipe
            })
        } else if let Some(space_pos) = args.find(' ') {
            // Format 3: "path content" (space-separated, content is rest)
            let (path, content) = args.split_at(space_pos);
            Ok(WriteFileArgs {
                path: path.trim().to_string(),
                content: content.trim_start().to_string(), // Remove leading whitespace
            })
        } else {
            // Just a path, empty content
            Ok(WriteFileArgs {
                path: args.to_string(),
                content: String::new(),
            })
        }
    }
    
    fn validate(&self) -> Result<()> {
        if self.path.trim().is_empty() {
            return Err(anyhow!("File path cannot be empty"));
        }
        
        // Basic path validation
        if self.path.contains('\0') {
            return Err(anyhow!("File path cannot contain null bytes"));
        }
        
        Ok(())
    }
}

/// Arguments for read_file tool
#[derive(Debug, Deserialize, Clone)]
pub struct ReadFileArgs {
    pub path: String,
}

impl ToolArgumentParser for ReadFileArgs {
    fn parse_text(args: &str) -> Result<Self> {
        Ok(ReadFileArgs {
            path: args.trim().to_string(),
        })
    }
    
    fn validate(&self) -> Result<()> {
        if self.path.trim().is_empty() {
            return Err(anyhow!("File path cannot be empty"));
        }
        
        if self.path.contains('\0') {
            return Err(anyhow!("File path cannot contain null bytes"));
        }
        
        Ok(())
    }
}

/// Arguments for git_command tool
#[derive(Debug, Deserialize, Clone)]
pub struct GitCommandArgs {
    pub command: String,
}

impl ToolArgumentParser for GitCommandArgs {
    fn parse_text(args: &str) -> Result<Self> {
        Ok(GitCommandArgs {
            command: args.trim().to_string(),
        })
    }
    
    fn validate(&self) -> Result<()> {
        if self.command.trim().is_empty() {
            return Err(anyhow!("Git command cannot be empty"));
        }
        Ok(())
    }
}

/// Arguments for code_analysis tool
#[derive(Debug, Deserialize, Clone)]
pub struct CodeAnalysisArgs {
    pub path: String,
}

impl ToolArgumentParser for CodeAnalysisArgs {
    fn parse_text(args: &str) -> Result<Self> {
        Ok(CodeAnalysisArgs {
            path: args.trim().to_string(),
        })
    }
    
    fn validate(&self) -> Result<()> {
        if self.path.trim().is_empty() {
            return Err(anyhow!("File path cannot be empty"));
        }
        
        if self.path.contains('\0') {
            return Err(anyhow!("File path cannot contain null bytes"));
        }
        
        Ok(())
    }
}

/// Arguments for debug_directory tool (no arguments needed)
#[derive(Debug, Deserialize, Clone)]
pub struct DebugDirectoryArgs {
    // No fields needed, but we keep the struct for consistency
}

impl ToolArgumentParser for DebugDirectoryArgs {
    fn parse_text(_args: &str) -> Result<Self> {
        // debug_directory doesn't need arguments
        Ok(DebugDirectoryArgs {})
    }
    
    fn validate(&self) -> Result<()> {
        Ok(())
    }
}

/// Arguments for lsp_analysis tool
#[derive(Debug, Deserialize, Clone)]
pub struct LspAnalysisArgs {
    #[serde(default)]
    pub path: Option<String>,
    #[serde(default)]
    pub analysis_type: Option<String>, // "diagnostics", "hover", "completions", "all"
}

impl ToolArgumentParser for LspAnalysisArgs {
    fn parse_text(args: &str) -> Result<Self> {
        let args = args.trim();
        
        if args.is_empty() {
            // No arguments - analyze workspace
            return Ok(LspAnalysisArgs {
                path: None,
                analysis_type: None,
            });
        }
        
        // Try to parse as "path [analysis_type]"
        if let Some(space_pos) = args.find(' ') {
            let (path, analysis_type) = args.split_at(space_pos);
            Ok(LspAnalysisArgs {
                path: Some(path.trim().to_string()),
                analysis_type: Some(analysis_type.trim().to_string()),
            })
        } else {
            // Just path
            Ok(LspAnalysisArgs {
                path: Some(args.to_string()),
                analysis_type: None,
            })
        }
    }
    
    fn validate(&self) -> Result<()> {
        // Path validation if provided
        if let Some(ref path) = self.path {
            if path.contains('\0') {
                return Err(anyhow!("File path cannot contain null bytes"));
            }
        }
        
        // Analysis type validation if provided
        if let Some(ref analysis_type) = self.analysis_type {
            match analysis_type.as_str() {
                "diagnostics" | "hover" | "completions" | "all" | "" => {},
                _ => return Err(anyhow!("Invalid analysis type. Use: diagnostics, hover, completions, or all")),
            }
        }
        
        Ok(())
    }
}

/// Arguments for repository_analysis tool
#[derive(Debug, Deserialize, Clone)]
pub struct RepositoryAnalysisArgs {
    #[serde(default)]
    pub scope: Option<String>, // "workspace", "summary", "files"
    #[serde(default)]
    pub max_tokens: Option<usize>,
}

impl ToolArgumentParser for RepositoryAnalysisArgs {
    fn parse_text(args: &str) -> Result<Self> {
        let args = args.trim();
        
        if args.is_empty() {
            // Default to summary scope
            return Ok(RepositoryAnalysisArgs {
                scope: Some("summary".to_string()),
                max_tokens: None,
            });
        }
        
        // Try to parse as "scope [max_tokens]"
        if let Some(space_pos) = args.find(' ') {
            let (scope, tokens_str) = args.split_at(space_pos);
            let max_tokens = tokens_str.trim().parse::<usize>().ok();
            Ok(RepositoryAnalysisArgs {
                scope: Some(scope.trim().to_string()),
                max_tokens,
            })
        } else {
            // Check if it's a number (max_tokens) or scope
            if args.chars().all(|c| c.is_ascii_digit()) {
                Ok(RepositoryAnalysisArgs {
                    scope: Some("summary".to_string()),
                    max_tokens: args.parse::<usize>().ok(),
                })
            } else {
                Ok(RepositoryAnalysisArgs {
                    scope: Some(args.to_string()),
                    max_tokens: None,
                })
            }
        }
    }
    
    fn validate(&self) -> Result<()> {
        // Scope validation if provided
        if let Some(ref scope) = self.scope {
            match scope.as_str() {
                "workspace" | "summary" | "files" | "" => {},
                _ => return Err(anyhow!("Invalid scope. Use: workspace, summary, or files")),
            }
        }
        
        // Token limit validation if provided
        if let Some(max_tokens) = self.max_tokens {
            if max_tokens == 0 {
                return Err(anyhow!("Max tokens must be greater than 0"));
            }
            if max_tokens > 50000 {
                return Err(anyhow!("Max tokens cannot exceed 50000"));
            }
        }
        
        Ok(())
    }
}

/// Arguments for symbol_lookup tool
#[derive(Debug, Deserialize, Clone)]
pub struct SymbolLookupArgs {
    pub symbol_name: String,
    #[serde(default)]
    pub symbol_type: Option<String>, // "function", "struct", "class", "enum", etc.
    #[serde(default)]
    pub file_pattern: Option<String>, // file pattern to filter results
}

impl ToolArgumentParser for SymbolLookupArgs {
    fn parse_text(args: &str) -> Result<Self> {
        let args = args.trim();
        
        if args.is_empty() {
            return Err(anyhow!("Symbol name is required"));
        }
        
        let parts: Vec<&str> = args.split_whitespace().collect();
        
        match parts.len() {
            1 => Ok(SymbolLookupArgs {
                symbol_name: parts[0].to_string(),
                symbol_type: None,
                file_pattern: None,
            }),
            2 => Ok(SymbolLookupArgs {
                symbol_name: parts[0].to_string(),
                symbol_type: Some(parts[1].to_string()),
                file_pattern: None,
            }),
            3 => Ok(SymbolLookupArgs {
                symbol_name: parts[0].to_string(),
                symbol_type: Some(parts[1].to_string()),
                file_pattern: Some(parts[2].to_string()),
            }),
            _ => {
                // More than 3 parts - join the rest into symbol name
                Ok(SymbolLookupArgs {
                    symbol_name: parts[0..parts.len()-2].join(" "),
                    symbol_type: Some(parts[parts.len()-2].to_string()),
                    file_pattern: Some(parts[parts.len()-1].to_string()),
                })
            }
        }
    }
    
    fn validate(&self) -> Result<()> {
        if self.symbol_name.trim().is_empty() {
            return Err(anyhow!("Symbol name cannot be empty"));
        }
        
        if self.symbol_name.contains('\0') {
            return Err(anyhow!("Symbol name cannot contain null bytes"));
        }
        
        // Symbol type validation if provided
        if let Some(ref symbol_type) = self.symbol_type {
            let valid_types = ["function", "struct", "class", "enum", "trait", "module", "import", "variable"];
            if !valid_types.contains(&symbol_type.as_str()) {
                return Err(anyhow!("Invalid symbol type. Use: {}", valid_types.join(", ")));
            }
        }
        
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_shell_command_args_json() {
        let json_args = r#"{"command": "ls -la"}"#;
        let args = ShellCommandArgs::parse(json_args).unwrap();
        assert_eq!(args.command, "ls -la");
    }

    #[test]
    fn test_shell_command_args_text() {
        let text_args = "ls -la";
        let args = ShellCommandArgs::parse(text_args).unwrap();
        assert_eq!(args.command, "ls -la");
    }

    #[test]
    fn test_write_file_args_json() {
        let json_args = r#"{"path": "test.txt", "content": "Hello World"}"#;
        let args = WriteFileArgs::parse(json_args).unwrap();
        assert_eq!(args.path, "test.txt");
        assert_eq!(args.content, "Hello World");
    }

    #[test]
    fn test_write_file_args_text_formats() {
        // Newline format
        let args = WriteFileArgs::parse("test.txt\nHello World").unwrap();
        assert_eq!(args.path, "test.txt");
        assert_eq!(args.content, "Hello World");

        // Pipe format
        let args = WriteFileArgs::parse("test.txt|Hello World").unwrap();
        assert_eq!(args.path, "test.txt");
        assert_eq!(args.content, "Hello World");

        // Space format
        let args = WriteFileArgs::parse("test.txt Hello World").unwrap();
        assert_eq!(args.path, "test.txt");
        assert_eq!(args.content, "Hello World");

        // Path only
        let args = WriteFileArgs::parse("test.txt").unwrap();
        assert_eq!(args.path, "test.txt");
        assert_eq!(args.content, "");
    }

    #[test]
    fn test_read_file_args() {
        let json_args = r#"{"path": "src/main.rs"}"#;
        let args = ReadFileArgs::parse(json_args).unwrap();
        assert_eq!(args.path, "src/main.rs");

        let text_args = "src/main.rs";
        let args = ReadFileArgs::parse(text_args).unwrap();
        assert_eq!(args.path, "src/main.rs");
    }

    #[test]
    fn test_validation_errors() {
        // Empty command should fail
        assert!(ShellCommandArgs::parse("").is_err());
        assert!(ShellCommandArgs::parse(r#"{"command": ""}"#).is_err());

        // Empty path should fail
        assert!(ReadFileArgs::parse("").is_err());
        assert!(WriteFileArgs::parse("").is_err());

        // Path with null bytes should fail
        assert!(ReadFileArgs::parse("test\0file").is_err());
    }

    #[test]
    fn test_debug_directory_args() {
        let args = DebugDirectoryArgs::parse("").unwrap();
        // Should parse successfully even with empty input

        let args = DebugDirectoryArgs::parse("{}").unwrap();
        // Should parse JSON format too
    }

    #[test]
    fn test_git_command_args() {
        let json_args = r#"{"command": "status"}"#;
        let args = GitCommandArgs::parse(json_args).unwrap();
        assert_eq!(args.command, "status");

        let text_args = "status";
        let args = GitCommandArgs::parse(text_args).unwrap();
        assert_eq!(args.command, "status");
    }

    #[test]
    fn test_code_analysis_args() {
        let json_args = r#"{"path": "src/lib.rs"}"#;
        let args = CodeAnalysisArgs::parse(json_args).unwrap();
        assert_eq!(args.path, "src/lib.rs");

        let text_args = "src/lib.rs";
        let args = CodeAnalysisArgs::parse(text_args).unwrap();
        assert_eq!(args.path, "src/lib.rs");
    }

    // ========================================
    // NEW ANALYSIS TOOLS ARGUMENT TESTS
    // ========================================

    #[test]
    fn test_lsp_analysis_args_json() {
        let json_args = r#"{"path": "src/main.rs", "analysis_type": "diagnostics"}"#;
        let args = LspAnalysisArgs::parse(json_args).unwrap();
        assert_eq!(args.path, Some("src/main.rs".to_string()));
        assert_eq!(args.analysis_type, Some("diagnostics".to_string()));
    }

    #[test]
    fn test_lsp_analysis_args_text_formats() {
        // Path and analysis type
        let args = LspAnalysisArgs::parse("src/main.rs diagnostics").unwrap();
        assert_eq!(args.path, Some("src/main.rs".to_string()));
        assert_eq!(args.analysis_type, Some("diagnostics".to_string()));

        // Just path
        let args = LspAnalysisArgs::parse("src/main.rs").unwrap();
        assert_eq!(args.path, Some("src/main.rs".to_string()));
        assert_eq!(args.analysis_type, None);

        // Empty (workspace mode)
        let args = LspAnalysisArgs::parse("").unwrap();
        assert_eq!(args.path, None);
        assert_eq!(args.analysis_type, None);
    }

    #[test]
    fn test_lsp_analysis_args_validation() {
        // Valid analysis types
        let valid_types = ["diagnostics", "hover", "completions", "all", ""];
        for analysis_type in &valid_types {
            let args = LspAnalysisArgs {
                path: Some("test.rs".to_string()),
                analysis_type: Some(analysis_type.to_string()),
            };
            assert!(args.validate().is_ok(), "Failed for type: {}", analysis_type);
        }

        // Invalid analysis type
        let args = LspAnalysisArgs {
            path: Some("test.rs".to_string()),
            analysis_type: Some("invalid_type".to_string()),
        };
        assert!(args.validate().is_err());

        // Path with null bytes
        let args = LspAnalysisArgs {
            path: Some("test\0.rs".to_string()),
            analysis_type: None,
        };
        assert!(args.validate().is_err());
    }

    #[test]
    fn test_repository_analysis_args_json() {
        let json_args = r#"{"scope": "workspace", "max_tokens": 2048}"#;
        let args = RepositoryAnalysisArgs::parse(json_args).unwrap();
        assert_eq!(args.scope, Some("workspace".to_string()));
        assert_eq!(args.max_tokens, Some(2048));
    }

    #[test]
    fn test_repository_analysis_args_text_formats() {
        // Scope and max_tokens
        let args = RepositoryAnalysisArgs::parse("workspace 1024").unwrap();
        assert_eq!(args.scope, Some("workspace".to_string()));
        assert_eq!(args.max_tokens, Some(1024));

        // Just scope
        let args = RepositoryAnalysisArgs::parse("files").unwrap();
        assert_eq!(args.scope, Some("files".to_string()));
        assert_eq!(args.max_tokens, None);

        // Just number (interpreted as max_tokens)
        let args = RepositoryAnalysisArgs::parse("512").unwrap();
        assert_eq!(args.scope, Some("summary".to_string()));
        assert_eq!(args.max_tokens, Some(512));

        // Empty (default to summary)
        let args = RepositoryAnalysisArgs::parse("").unwrap();
        assert_eq!(args.scope, Some("summary".to_string()));
        assert_eq!(args.max_tokens, None);
    }

    #[test]
    fn test_repository_analysis_args_validation() {
        // Valid scopes
        let valid_scopes = ["workspace", "summary", "files", ""];
        for scope in &valid_scopes {
            let args = RepositoryAnalysisArgs {
                scope: Some(scope.to_string()),
                max_tokens: Some(1024),
            };
            assert!(args.validate().is_ok(), "Failed for scope: {}", scope);
        }

        // Invalid scope
        let args = RepositoryAnalysisArgs {
            scope: Some("invalid_scope".to_string()),
            max_tokens: Some(1024),
        };
        assert!(args.validate().is_err());

        // Invalid token limits
        let invalid_tokens = [0, 50001];
        for tokens in &invalid_tokens {
            let args = RepositoryAnalysisArgs {
                scope: Some("summary".to_string()),
                max_tokens: Some(*tokens),
            };
            assert!(args.validate().is_err(), "Should fail for tokens: {}", tokens);
        }

        // Valid token limits
        let valid_tokens = [1, 1024, 50000];
        for tokens in &valid_tokens {
            let args = RepositoryAnalysisArgs {
                scope: Some("summary".to_string()),
                max_tokens: Some(*tokens),
            };
            assert!(args.validate().is_ok(), "Should pass for tokens: {}", tokens);
        }
    }

    #[test]
    fn test_symbol_lookup_args_json() {
        let json_args = r#"{"symbol_name": "main", "symbol_type": "function", "file_pattern": "*.rs"}"#;
        let args = SymbolLookupArgs::parse(json_args).unwrap();
        assert_eq!(args.symbol_name, "main");
        assert_eq!(args.symbol_type, Some("function".to_string()));
        assert_eq!(args.file_pattern, Some("*.rs".to_string()));
    }

    #[test]
    fn test_symbol_lookup_args_text_formats() {
        // Just symbol name
        let args = SymbolLookupArgs::parse("main").unwrap();
        assert_eq!(args.symbol_name, "main");
        assert_eq!(args.symbol_type, None);
        assert_eq!(args.file_pattern, None);

        // Symbol name and type
        let args = SymbolLookupArgs::parse("main function").unwrap();
        assert_eq!(args.symbol_name, "main");
        assert_eq!(args.symbol_type, Some("function".to_string()));
        assert_eq!(args.file_pattern, None);

        // Symbol name, type, and file pattern
        let args = SymbolLookupArgs::parse("main function *.rs").unwrap();
        assert_eq!(args.symbol_name, "main");
        assert_eq!(args.symbol_type, Some("function".to_string()));
        assert_eq!(args.file_pattern, Some("*.rs".to_string()));

        // Complex symbol name with multiple words
        let args = SymbolLookupArgs::parse("MyComplexSymbol Name function *.rs").unwrap();
        assert_eq!(args.symbol_name, "MyComplexSymbol Name");
        assert_eq!(args.symbol_type, Some("function".to_string()));
        assert_eq!(args.file_pattern, Some("*.rs".to_string()));
    }

    #[test]
    fn test_symbol_lookup_args_validation() {
        // Valid symbol types
        let valid_types = ["function", "struct", "class", "enum", "trait", "module", "import", "variable"];
        for symbol_type in &valid_types {
            let args = SymbolLookupArgs {
                symbol_name: "test".to_string(),
                symbol_type: Some(symbol_type.to_string()),
                file_pattern: None,
            };
            assert!(args.validate().is_ok(), "Failed for type: {}", symbol_type);
        }

        // Invalid symbol type
        let args = SymbolLookupArgs {
            symbol_name: "test".to_string(),
            symbol_type: Some("invalid_type".to_string()),
            file_pattern: None,
        };
        assert!(args.validate().is_err());

        // Empty symbol name
        let args = SymbolLookupArgs {
            symbol_name: "".to_string(),
            symbol_type: None,
            file_pattern: None,
        };
        assert!(args.validate().is_err());

        // Symbol name with null bytes
        let args = SymbolLookupArgs {
            symbol_name: "test\0symbol".to_string(),
            symbol_type: None,
            file_pattern: None,
        };
        assert!(args.validate().is_err());
    }

    #[test]
    fn test_symbol_lookup_args_empty_name_error() {
        // Empty string should fail
        assert!(SymbolLookupArgs::parse("").is_err());
        
        // Whitespace-only should fail
        assert!(SymbolLookupArgs::parse("   ").is_err());
    }

    #[test]
    fn test_new_args_mixed_formats() {
        // Test that all new args support both JSON and text formats
        
        // LspAnalysisArgs
        let json_result = LspAnalysisArgs::parse(r#"{"path": "test.rs"}"#);
        let text_result = LspAnalysisArgs::parse("test.rs");
        assert!(json_result.is_ok());
        assert!(text_result.is_ok());

        // RepositoryAnalysisArgs  
        let json_result = RepositoryAnalysisArgs::parse(r#"{"scope": "summary"}"#);
        let text_result = RepositoryAnalysisArgs::parse("summary");
        assert!(json_result.is_ok());
        assert!(text_result.is_ok());

        // SymbolLookupArgs
        let json_result = SymbolLookupArgs::parse(r#"{"symbol_name": "test"}"#);
        let text_result = SymbolLookupArgs::parse("test");
        assert!(json_result.is_ok());
        assert!(text_result.is_ok());
    }

    #[test]
    fn test_new_args_edge_cases() {
        // LspAnalysisArgs with special characters in path
        let args = LspAnalysisArgs::parse("src/my-file_test.rs").unwrap();
        assert_eq!(args.path, Some("src/my-file_test.rs".to_string()));

        // RepositoryAnalysisArgs with malformed numbers
        let result = RepositoryAnalysisArgs::parse("summary abc");
        assert!(result.is_ok()); // Should parse 'abc' as None for max_tokens

        // SymbolLookupArgs with symbols containing special characters
        let args = SymbolLookupArgs::parse("snake_case_symbol").unwrap();
        assert_eq!(args.symbol_name, "snake_case_symbol");

        let args = SymbolLookupArgs::parse("CamelCaseSymbol").unwrap();
        assert_eq!(args.symbol_name, "CamelCaseSymbol");
    }
}