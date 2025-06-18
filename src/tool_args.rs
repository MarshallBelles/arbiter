use anyhow::{Result, Context, anyhow};
use serde::{Deserialize, de::DeserializeOwned};
use serde_json::Value;

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
}