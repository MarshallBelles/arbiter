use anyhow::{Result, Context};
use std::collections::HashMap;
use tree_sitter::{Language, Parser, Query, QueryCursor, Tree};

pub struct TreeSitterManager {
    parsers: HashMap<String, Parser>,
    languages: HashMap<String, Language>,
}

impl TreeSitterManager {
    pub fn new() -> Result<Self> {
        let mut manager = Self {
            parsers: HashMap::new(),
            languages: HashMap::new(),
        };
        
        // Tree-sitter languages would be initialized here if available
        // For now, we'll provide basic text parsing without syntax trees
        
        Ok(manager)
    }
    
    fn register_language(&mut self, name: &str, language: Language) -> Result<()> {
        let mut parser = Parser::new();
        parser.set_language(language)
            .context(format!("Failed to set language for {}", name))?;
        
        self.parsers.insert(name.to_string(), parser);
        self.languages.insert(name.to_string(), language);
        
        Ok(())
    }
    
    pub fn detect_language(&self, file_path: &str) -> Option<String> {
        let extension = std::path::Path::new(file_path)
            .extension()?
            .to_str()?;
        
        match extension {
            "rs" => Some("rust".to_string()),
            "js" | "mjs" => Some("javascript".to_string()),
            "py" => Some("python".to_string()),
            "go" => Some("go".to_string()),
            "ts" | "tsx" => Some("typescript".to_string()),
            "java" => Some("java".to_string()),
            "c" | "h" => Some("c".to_string()),
            "cpp" | "cc" | "cxx" | "hpp" => Some("cpp".to_string()),
            "cs" => Some("csharp".to_string()),
            "zig" => Some("zig".to_string()),
            _ => None,
        }
    }
    
    pub fn parse(&mut self, _language: &str, _source_code: &str) -> Result<Option<Tree>> {
        // Tree-sitter parsing would be implemented here if parsers were available
        // For now, return None to indicate no parse tree available
        Ok(None)
    }
    
    pub fn get_symbols(&mut self, language: &str, source_code: &str) -> Result<Vec<Symbol>> {
        // Provide basic symbol extraction without Tree-sitter parsing
        let mut symbols = Vec::new();
        
        match language {
            "rust" => {
                for (line_no, line) in source_code.lines().enumerate() {
                    let trimmed = line.trim();
                    if trimmed.starts_with("fn ") {
                        if let Some(name) = extract_rust_fn_name(trimmed) {
                            symbols.push(Symbol {
                                name,
                                symbol_type: "function".to_string(),
                                start_line: line_no,
                                end_line: line_no,
                                start_column: 0,
                                end_column: line.len(),
                            });
                        }
                    } else if trimmed.starts_with("struct ") || trimmed.starts_with("pub struct ") {
                        if let Some(name) = extract_rust_struct_name(trimmed) {
                            symbols.push(Symbol {
                                name,
                                symbol_type: "struct".to_string(),
                                start_line: line_no,
                                end_line: line_no,
                                start_column: 0,
                                end_column: line.len(),
                            });
                        }
                    }
                }
            }
            "python" => {
                for (line_no, line) in source_code.lines().enumerate() {
                    let trimmed = line.trim();
                    if trimmed.starts_with("def ") {
                        if let Some(name) = extract_python_def_name(trimmed) {
                            symbols.push(Symbol {
                                name,
                                symbol_type: "function".to_string(),
                                start_line: line_no,
                                end_line: line_no,
                                start_column: 0,
                                end_column: line.len(),
                            });
                        }
                    } else if trimmed.starts_with("class ") {
                        if let Some(name) = extract_python_class_name(trimmed) {
                            symbols.push(Symbol {
                                name,
                                symbol_type: "class".to_string(),
                                start_line: line_no,
                                end_line: line_no,
                                start_column: 0,
                                end_column: line.len(),
                            });
                        }
                    }
                }
            }
            "javascript" | "typescript" => {
                for (line_no, line) in source_code.lines().enumerate() {
                    let trimmed = line.trim();
                    if trimmed.starts_with("function ") {
                        if let Some(name) = extract_js_function_name(trimmed) {
                            symbols.push(Symbol {
                                name,
                                symbol_type: "function".to_string(),
                                start_line: line_no,
                                end_line: line_no,
                                start_column: 0,
                                end_column: line.len(),
                            });
                        }
                    } else if trimmed.starts_with("class ") {
                        if let Some(name) = extract_js_class_name(trimmed) {
                            symbols.push(Symbol {
                                name,
                                symbol_type: "class".to_string(),
                                start_line: line_no,
                                end_line: line_no,
                                start_column: 0,
                                end_column: line.len(),
                            });
                        }
                    }
                }
            }
            _ => {
                // Basic line-by-line analysis for other languages
                // Look for common patterns like function definitions
            }
        }
        
        Ok(symbols)
    }
    
    pub fn get_context_at_position(&mut self, _language: &str, source_code: &str, line: usize, column: usize) -> Result<CodeContext> {
        // Basic context extraction without Tree-sitter
        let lines: Vec<&str> = source_code.lines().collect();
        
        if line >= lines.len() {
            return Err(anyhow::anyhow!("Line {} is out of bounds", line));
        }
        
        let current_line = lines[line];
        let node_text = if column < current_line.len() {
            // Extract word at cursor position
            let start = current_line[..column].rfind(char::is_whitespace).map(|i| i + 1).unwrap_or(0);
            let end = current_line[column..].find(char::is_whitespace).map(|i| column + i).unwrap_or(current_line.len());
            current_line[start..end].to_string()
        } else {
            current_line.to_string()
        };
        
        // Look for context by scanning backwards for function/class definitions
        let mut context_name = None;
        for i in (0..=line).rev() {
            let line_content = lines[i].trim();
            if line_content.starts_with("fn ") || line_content.starts_with("pub fn ") {
                context_name = extract_rust_fn_name(line_content);
                break;
            } else if line_content.starts_with("def ") {
                context_name = extract_python_def_name(line_content);
                break;
            } else if line_content.starts_with("function ") {
                context_name = extract_js_function_name(line_content);
                break;
            }
        }
        
        Ok(CodeContext {
            node_type: "identifier".to_string(),
            node_text,
            context_name,
            line,
            column,
        })
    }
}

#[derive(Debug, Clone)]
pub struct Symbol {
    pub name: String,
    pub symbol_type: String,
    pub start_line: usize,
    pub end_line: usize,
    pub start_column: usize,
    pub end_column: usize,
}

#[derive(Debug, Clone)]
pub struct CodeContext {
    pub node_type: String,
    pub node_text: String,
    pub context_name: Option<String>,
    pub line: usize,
    pub column: usize,
}

// Helper functions for basic symbol extraction
fn extract_rust_fn_name(line: &str) -> Option<String> {
    let line = line.trim();
    if let Some(start) = line.find("fn ") {
        let after_fn = &line[start + 3..];
        if let Some(paren_pos) = after_fn.find('(') {
            let name = after_fn[..paren_pos].trim();
            if !name.is_empty() {
                return Some(name.to_string());
            }
        }
    }
    None
}

fn extract_rust_struct_name(line: &str) -> Option<String> {
    let line = line.trim();
    if let Some(start) = line.find("struct ") {
        let after_struct = &line[start + 7..];
        if let Some(space_or_brace) = after_struct.find(&[' ', '<', '{'][..]) {
            let name = after_struct[..space_or_brace].trim();
            if !name.is_empty() {
                return Some(name.to_string());
            }
        }
    }
    None
}

fn extract_python_def_name(line: &str) -> Option<String> {
    let line = line.trim();
    if let Some(start) = line.find("def ") {
        let after_def = &line[start + 4..];
        if let Some(paren_pos) = after_def.find('(') {
            let name = after_def[..paren_pos].trim();
            if !name.is_empty() {
                return Some(name.to_string());
            }
        }
    }
    None
}

fn extract_python_class_name(line: &str) -> Option<String> {
    let line = line.trim();
    if let Some(start) = line.find("class ") {
        let after_class = &line[start + 6..];
        if let Some(colon_or_paren) = after_class.find(&[':', '('][..]) {
            let name = after_class[..colon_or_paren].trim();
            if !name.is_empty() {
                return Some(name.to_string());
            }
        }
    }
    None
}

fn extract_js_function_name(line: &str) -> Option<String> {
    let line = line.trim();
    if let Some(start) = line.find("function ") {
        let after_function = &line[start + 9..];
        if let Some(paren_pos) = after_function.find('(') {
            let name = after_function[..paren_pos].trim();
            if !name.is_empty() {
                return Some(name.to_string());
            }
        }
    }
    None
}

fn extract_js_class_name(line: &str) -> Option<String> {
    let line = line.trim();
    if let Some(start) = line.find("class ") {
        let after_class = &line[start + 6..];
        if let Some(space_or_brace) = after_class.find(&[' ', '{'][..]) {
            let name = after_class[..space_or_brace].trim();
            if !name.is_empty() {
                return Some(name.to_string());
            }
        }
    }
    None
}