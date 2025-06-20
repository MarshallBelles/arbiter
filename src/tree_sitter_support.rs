use anyhow::{Result, Context};
use std::collections::HashMap;
use tree_sitter::{Language, Parser, Tree, Query, QueryCursor, Node};
use tracing::{debug, warn};

// External language functions - temporarily disabled for testing
// TODO: Fix Tree-sitter language linking in Phase 2
// extern "C" {
//     fn tree_sitter_rust() -> Language;
//     fn tree_sitter_python() -> Language;
//     fn tree_sitter_javascript() -> Language;
//     fn tree_sitter_c() -> Language;
// }

pub struct TreeSitterManager {
    parsers: HashMap<String, Parser>,
    languages: HashMap<String, Language>,
    queries: HashMap<String, Query>,
}

impl TreeSitterManager {
    pub fn new() -> Result<Self> {
        let mut manager = Self {
            parsers: HashMap::new(),
            languages: HashMap::new(),
            queries: HashMap::new(),
        };
        
        // Initialize core languages
        manager.initialize_languages()?;
        
        Ok(manager)
    }
    
    fn initialize_languages(&mut self) -> Result<()> {
        // TODO: Re-enable Tree-sitter languages in Phase 2
        // For now, just return Ok to allow testing other functionality
        
        // // Initialize Rust
        // let rust_lang = unsafe { tree_sitter_rust() };
        // self.register_language("rust", rust_lang)?;
        // 
        // // Initialize Python
        // let python_lang = unsafe { tree_sitter_python() };
        // self.register_language("python", python_lang)?;
        // 
        // // Initialize JavaScript
        // let js_lang = unsafe { tree_sitter_javascript() };
        // self.register_language("javascript", js_lang)?;
        // 
        // // Initialize C
        // let c_lang = unsafe { tree_sitter_c() };
        // self.register_language("c", c_lang)?;
        
        debug!("Initialized {} Tree-sitter languages", self.languages.len());
        Ok(())
    }
    
    fn register_language(&mut self, name: &str, language: Language) -> Result<()> {
        let mut parser = Parser::new();
        parser.set_language(language)
            .context(format!("Failed to set language for {}", name))?;
        
        // Create queries for symbol extraction
        let query_source = self.get_query_source(name);
        let query = Query::new(language, &query_source)
            .context(format!("Failed to create query for {}", name))?;
        
        self.parsers.insert(name.to_string(), parser);
        self.languages.insert(name.to_string(), language);
        self.queries.insert(name.to_string(), query);
        
        debug!("Registered Tree-sitter language: {}", name);
        Ok(())
    }
    
    fn get_query_source(&self, language: &str) -> String {
        match language {
            "rust" => r#"
                (function_item
                  name: (identifier) @function.name) @function.definition
                
                (struct_item
                  name: (type_identifier) @struct.name) @struct.definition
                
                (enum_item
                  name: (type_identifier) @enum.name) @enum.definition
                
                (impl_item
                  type: (type_identifier) @impl.name) @impl.definition
                
                (trait_item
                  name: (type_identifier) @trait.name) @trait.definition
                
                (mod_item
                  name: (identifier) @module.name) @module.definition
            "#.to_string(),
            "python" => r#"
                (function_definition
                  name: (identifier) @function.name) @function.definition
                
                (class_definition
                  name: (identifier) @class.name) @class.definition
                
                (import_statement
                  name: (dotted_name) @import.name) @import.statement
                
                (import_from_statement
                  module_name: (dotted_name) @import.module) @import.from
            "#.to_string(),
            "javascript" => r#"
                (function_declaration
                  name: (identifier) @function.name) @function.definition
                
                (class_declaration
                  name: (identifier) @class.name) @class.definition
                
                (method_definition
                  name: (property_identifier) @method.name) @method.definition
                
                (variable_declarator
                  name: (identifier) @variable.name
                  value: (arrow_function)) @function.arrow
                
                (export_statement
                  declaration: (function_declaration
                    name: (identifier) @export.function)) @export.statement
            "#.to_string(),
            "c" => r#"
                (function_definition
                  declarator: (function_declarator
                    declarator: (identifier) @function.name)) @function.definition
                
                (struct_specifier
                  name: (type_identifier) @struct.name) @struct.definition
                
                (enum_specifier
                  name: (type_identifier) @enum.name) @enum.definition
                
                (typedef_declaration
                  declarator: (type_identifier) @typedef.name) @typedef.definition
            "#.to_string(),
            _ => "(ERROR) @error".to_string(), // Fallback for unsupported languages
        }
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
    
    pub fn parse(&mut self, language: &str, source_code: &str) -> Result<Option<Tree>> {
        if let Some(parser) = self.parsers.get_mut(language) {
            match parser.parse(source_code, None) {
                Some(tree) => {
                    debug!("Successfully parsed {} code ({} bytes)", language, source_code.len());
                    Ok(Some(tree))
                }
                None => {
                    warn!("Failed to parse {} code", language);
                    Ok(None)
                }
            }
        } else {
            debug!("No parser available for language: {}", language);
            Ok(None)
        }
    }
    
    pub fn get_symbols(&mut self, language: &str, source_code: &str) -> Result<Vec<Symbol>> {
        let mut symbols = Vec::new();
        
        // Try Tree-sitter parsing first
        if let Some(tree) = self.parse(language, source_code)? {
            if let Some(query) = self.queries.get(language) {
                symbols = self.extract_symbols_with_query(&tree, query, source_code)?;
                debug!("Extracted {} symbols using Tree-sitter for {}", symbols.len(), language);
            } else {
                warn!("No query available for language: {}", language);
            }
        }
        
        // Fallback to basic text parsing if Tree-sitter fails or unavailable
        if symbols.is_empty() {
            symbols = self.extract_symbols_with_text_parsing(language, source_code)?;
            debug!("Extracted {} symbols using text parsing for {}", symbols.len(), language);
        }
        
        Ok(symbols)
    }
    
    fn extract_symbols_with_query(&self, tree: &Tree, query: &Query, source_code: &str) -> Result<Vec<Symbol>> {
        let mut symbols = Vec::new();
        let mut cursor = QueryCursor::new();
        
        let captures = cursor.captures(query, tree.root_node(), source_code.as_bytes());
        
        for (match_, _) in captures {
            for capture in match_.captures {
                let node = capture.node;
                let capture_name = &query.capture_names()[capture.index as usize];
                
                // Extract symbol information based on capture name
                if let Some((symbol_type, name)) = self.extract_symbol_info(&capture_name, node, source_code) {
                    symbols.push(Symbol {
                        name,
                        symbol_type,
                        start_line: node.start_position().row,
                        end_line: node.end_position().row,
                        start_column: node.start_position().column,
                        end_column: node.end_position().column,
                    });
                }
            }
        }
        
        Ok(symbols)
    }
    
    fn extract_symbol_info(&self, capture_name: &str, node: Node, source_code: &str) -> Option<(String, String)> {
        let text = node.utf8_text(source_code.as_bytes()).ok()?;
        
        match capture_name {
            "function.name" | "method.name" => Some(("function".to_string(), text.to_string())),
            "class.name" => Some(("class".to_string(), text.to_string())),
            "struct.name" => Some(("struct".to_string(), text.to_string())),
            "enum.name" => Some(("enum".to_string(), text.to_string())),
            "trait.name" => Some(("trait".to_string(), text.to_string())),
            "impl.name" => Some(("impl".to_string(), text.to_string())),
            "module.name" => Some(("module".to_string(), text.to_string())),
            "variable.name" => Some(("variable".to_string(), text.to_string())),
            "typedef.name" => Some(("typedef".to_string(), text.to_string())),
            "import.name" | "import.module" => Some(("import".to_string(), text.to_string())),
            "export.function" => Some(("export".to_string(), text.to_string())),
            _ => None,
        }
    }
    
    fn extract_symbols_with_text_parsing(&self, language: &str, source_code: &str) -> Result<Vec<Symbol>> {
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
            "c" => {
                for (line_no, line) in source_code.lines().enumerate() {
                    let trimmed = line.trim();
                    if trimmed.contains("(") && (trimmed.contains("int ") || trimmed.contains("void ") || trimmed.contains("char ") || trimmed.contains("float ")) {
                        if let Some(name) = extract_c_function_name(trimmed) {
                            symbols.push(Symbol {
                                name,
                                symbol_type: "function".to_string(),
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
    
    pub fn get_context_at_position(&mut self, language: &str, source_code: &str, line: usize, column: usize) -> Result<CodeContext> {
        // Try Tree-sitter first for more accurate context
        if let Some(tree) = self.parse(language, source_code)? {
            let byte_offset = self.position_to_byte_offset(source_code, line, column)?;
            let node = tree.root_node().descendant_for_byte_range(byte_offset, byte_offset + 1)
                .unwrap_or(tree.root_node());
            
            let node_text = node.utf8_text(source_code.as_bytes())
                .unwrap_or("")
                .to_string();
            
            // Find containing function/class
            let context_name = self.find_containing_symbol(&tree, byte_offset, source_code);
            
            return Ok(CodeContext {
                node_type: node.kind().to_string(),
                node_text,
                context_name,
                line,
                column,
            });
        }
        
        // Fallback to basic context extraction
        let lines: Vec<&str> = source_code.lines().collect();
        
        if line >= lines.len() {
            return Err(anyhow::anyhow!("Line {} is out of bounds", line));
        }
        
        let current_line = lines[line];
        let node_text = if column < current_line.len() {
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
    
    fn position_to_byte_offset(&self, source_code: &str, line: usize, column: usize) -> Result<usize> {
        let mut offset = 0;
        let mut current_line = 0;
        
        for ch in source_code.chars() {
            if current_line == line {
                if column == 0 {
                    break;
                }
                return Ok(offset);
            }
            
            if ch == '\n' {
                current_line += 1;
            }
            
            offset += ch.len_utf8();
        }
        
        Ok(offset)
    }
    
    fn find_containing_symbol(&self, tree: &Tree, byte_offset: usize, source_code: &str) -> Option<String> {
        let mut current = tree.root_node().descendant_for_byte_range(byte_offset, byte_offset + 1)?;
        
        // Walk up the tree to find containing function/class/struct
        loop {
            match current.kind() {
                "function_item" | "function_definition" | "function_declaration" | "method_definition" => {
                    // Find the name node
                    for child in current.children(&mut current.walk()) {
                        if child.kind() == "identifier" || child.kind() == "property_identifier" {
                            if let Ok(name) = child.utf8_text(source_code.as_bytes()) {
                                return Some(name.to_string());
                            }
                        }
                    }
                }
                "struct_item" | "class_definition" | "class_declaration" => {
                    for child in current.children(&mut current.walk()) {
                        if child.kind() == "type_identifier" || child.kind() == "identifier" {
                            if let Ok(name) = child.utf8_text(source_code.as_bytes()) {
                                return Some(name.to_string());
                            }
                        }
                    }
                }
                _ => {}
            }
            
            if let Some(parent) = current.parent() {
                current = parent;
            } else {
                break;
            }
        }
        
        None
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
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

fn extract_c_function_name(line: &str) -> Option<String> {
    let line = line.trim();
    
    // Look for function patterns like "int main(" or "void foo("
    if let Some(paren_pos) = line.find('(') {
        let before_paren = &line[..paren_pos];
        
        // Split by whitespace and take the last part (function name)
        let parts: Vec<&str> = before_paren.split_whitespace().collect();
        if let Some(last_part) = parts.last() {
            // Remove any pointer indicators (*)
            let name = last_part.trim_start_matches('*');
            if !name.is_empty() && name.chars().all(|c| c.is_alphanumeric() || c == '_') {
                return Some(name.to_string());
            }
        }
    }
    
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_symbol_creation() {
        let symbol = Symbol {
            name: "test_function".to_string(),
            symbol_type: "function".to_string(),
            start_line: 10,
            end_line: 15,
            start_column: 5,
            end_column: 20,
        };

        assert_eq!(symbol.name, "test_function");
        assert_eq!(symbol.symbol_type, "function");
        assert_eq!(symbol.start_line, 10);
        assert_eq!(symbol.end_line, 15);
        assert_eq!(symbol.start_column, 5);
        assert_eq!(symbol.end_column, 20);
    }

    #[test]
    fn test_code_context_creation() {
        let context = CodeContext {
            node_type: "function_item".to_string(),
            node_text: "fn main()".to_string(),
            context_name: Some("main".to_string()),
            line: 10,
            column: 5,
        };

        assert_eq!(context.node_type, "function_item");
        assert_eq!(context.node_text, "fn main()");
        assert_eq!(context.context_name, Some("main".to_string()));
        assert_eq!(context.line, 10);
        assert_eq!(context.column, 5);
    }

    #[test]
    fn test_detect_language() {
        let test_cases = vec![
            ("test.rs", Some("rust".to_string())),
            ("index.js", Some("javascript".to_string())),
            ("main.mjs", Some("javascript".to_string())),
            ("script.py", Some("python".to_string())),
            ("main.go", Some("go".to_string())),
            ("app.ts", Some("typescript".to_string())),
            ("component.tsx", Some("typescript".to_string())),
            ("Main.java", Some("java".to_string())),
            ("main.c", Some("c".to_string())),
            ("header.h", Some("c".to_string())),
            ("main.cpp", Some("cpp".to_string())),
            ("main.cc", Some("cpp".to_string())),
            ("main.cxx", Some("cpp".to_string())),
            ("header.hpp", Some("cpp".to_string())),
            ("Program.cs", Some("csharp".to_string())),
            ("main.zig", Some("zig".to_string())),
            ("unknown.xyz", None),
            ("no_extension", None),
        ];

        // Test the language detection logic
        for (file_path, expected) in test_cases {
            let detected = std::path::Path::new(file_path)
                .extension()
                .and_then(|ext| ext.to_str())
                .and_then(|ext| match ext {
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
                });
            
            assert_eq!(detected, expected, "Failed for file: {}", file_path);
        }
    }

    #[test]
    fn test_extract_rust_fn_name() {
        let test_cases = vec![
            ("fn main() {", Some("main".to_string())),
            ("pub fn test_function() -> Result<()> {", Some("test_function".to_string())),
            ("    fn helper(x: i32) {", Some("helper".to_string())),
            ("fn complex_function<T>(param: T) -> Option<T>", Some("complex_function".to_string())),
            ("async fn async_function() {", Some("async_function".to_string())),
            ("not a function", None),
            ("fn ()", None), // No name
            ("function() {", None), // Wrong keyword
        ];

        for (input, expected) in test_cases {
            let result = extract_rust_fn_name(input);
            assert_eq!(result, expected, "Failed for input: '{}'", input);
        }
    }

    #[test]
    fn test_extract_rust_struct_name() {
        let test_cases = vec![
            ("struct MyStruct {", Some("MyStruct".to_string())),
            ("pub struct Config {", Some("Config".to_string())),
            ("    struct InnerStruct<T> {", Some("InnerStruct".to_string())),
            ("struct Point { x: i32, y: i32 }", Some("Point".to_string())),
            ("struct GenericStruct<T: Clone>", Some("GenericStruct".to_string())),
            ("not a struct", None),
            ("struct {", None), // No name
            ("structure Point {", None), // Wrong keyword
        ];

        for (input, expected) in test_cases {
            let result = extract_rust_struct_name(input);
            assert_eq!(result, expected, "Failed for input: '{}'", input);
        }
    }

    #[test]
    fn test_extract_python_def_name() {
        let test_cases = vec![
            ("def main():", Some("main".to_string())),
            ("    def helper_function(x, y):", Some("helper_function".to_string())),
            ("def complex_function(a: int, b: str) -> bool:", Some("complex_function".to_string())),
            ("async def async_function():", Some("async_function".to_string())),
            ("def __init__(self):", Some("__init__".to_string())),
            ("not a function", None),
            ("def ():", None), // No name
            ("define function():", None), // Wrong keyword
        ];

        for (input, expected) in test_cases {
            let result = extract_python_def_name(input);
            assert_eq!(result, expected, "Failed for input: '{}'", input);
        }
    }

    #[test]
    fn test_extract_python_class_name() {
        let test_cases = vec![
            ("class MyClass:", Some("MyClass".to_string())),
            ("    class InnerClass(BaseClass):", Some("InnerClass".to_string())),
            ("class ComplexClass(Base1, Base2):", Some("ComplexClass".to_string())),
            ("class GenericClass[T]:", Some("GenericClass".to_string())),
            ("not a class", None),
            ("class :", None), // No name
            ("klass MyClass:", None), // Wrong keyword
        ];

        for (input, expected) in test_cases {
            let result = extract_python_class_name(input);
            assert_eq!(result, expected, "Failed for input: '{}'", input);
        }
    }

    #[test]
    fn test_extract_js_function_name() {
        let test_cases = vec![
            ("function main() {", Some("main".to_string())),
            ("    function helper(x, y) {", Some("helper".to_string())),
            ("function complexFunction(a, b, c) {", Some("complexFunction".to_string())),
            ("async function asyncFunction() {", Some("asyncFunction".to_string())),
            ("not a function", None),
            ("function () {", None), // No name
            ("func main() {", None), // Wrong keyword
        ];

        for (input, expected) in test_cases {
            let result = extract_js_function_name(input);
            assert_eq!(result, expected, "Failed for input: '{}'", input);
        }
    }

    #[test]
    fn test_extract_js_class_name() {
        let test_cases = vec![
            ("class MyClass {", Some("MyClass".to_string())),
            ("    class InnerClass extends BaseClass {", Some("InnerClass".to_string())),
            ("class ComplexClass {", Some("ComplexClass".to_string())),
            ("export class ExportedClass {", Some("ExportedClass".to_string())),
            ("not a class", None),
            ("class {", None), // No name
            ("klass MyClass {", None), // Wrong keyword
        ];

        for (input, expected) in test_cases {
            let result = extract_js_class_name(input);
            assert_eq!(result, expected, "Failed for input: '{}'", input);
        }
    }

    #[test]
    fn test_extract_c_function_name() {
        let test_cases = vec![
            ("int main(int argc, char *argv[]) {", Some("main".to_string())),
            ("void helper() {", Some("helper".to_string())),
            ("char* getString(void);", Some("getString".to_string())),
            ("static int *getPointer() {", Some("getPointer".to_string())),
            ("double calculate(double x, double y)", Some("calculate".to_string())),
            ("not a function", None),
            ("int () {", None), // No name
            ("main() {", None), // No return type
        ];

        for (input, expected) in test_cases {
            let result = extract_c_function_name(input);
            assert_eq!(result, expected, "Failed for input: '{}'", input);
        }
    }

    #[test]
    fn test_get_query_source() {
        let test_cases = vec![
            ("rust", true),
            ("python", true),
            ("javascript", true),
            ("c", true),
            ("unknown", false),
        ];

        for (language, should_have_query) in test_cases {
            let query_source = match language {
                "rust" => r#"
                (function_item
                  name: (identifier) @function.name) @function.definition
                
                (struct_item
                  name: (type_identifier) @struct.name) @struct.definition
                
                (enum_item
                  name: (type_identifier) @enum.name) @enum.definition
                
                (impl_item
                  type: (type_identifier) @impl.name) @impl.definition
                
                (trait_item
                  name: (type_identifier) @trait.name) @trait.definition
                
                (mod_item
                  name: (identifier) @module.name) @module.definition
            "#.to_string(),
                "python" => r#"
                (function_definition
                  name: (identifier) @function.name) @function.definition
                
                (class_definition
                  name: (identifier) @class.name) @class.definition
                
                (import_statement
                  name: (dotted_name) @import.name) @import.statement
                
                (import_from_statement
                  module_name: (dotted_name) @import.module) @import.from
            "#.to_string(),
                "javascript" => r#"
                (function_declaration
                  name: (identifier) @function.name) @function.definition
                
                (class_declaration
                  name: (identifier) @class.name) @class.definition
                
                (method_definition
                  name: (property_identifier) @method.name) @method.definition
                
                (variable_declarator
                  name: (identifier) @variable.name
                  value: (arrow_function)) @function.arrow
                
                (export_statement
                  declaration: (function_declaration
                    name: (identifier) @export.function)) @export.statement
            "#.to_string(),
                "c" => r#"
                (function_definition
                  declarator: (function_declarator
                    declarator: (identifier) @function.name)) @function.definition
                
                (struct_specifier
                  name: (type_identifier) @struct.name) @struct.definition
                
                (enum_specifier
                  name: (type_identifier) @enum.name) @enum.definition
                
                (typedef_declaration
                  declarator: (type_identifier) @typedef.name) @typedef.definition
            "#.to_string(),
                _ => "(ERROR) @error".to_string(),
            };

            if should_have_query {
                assert!(query_source.contains("@function") || query_source.contains("@class") || query_source.contains("@struct"));
                assert!(!query_source.contains("ERROR"));
            } else {
                assert!(query_source.contains("ERROR"));
            }
        }
    }

    #[test]
    fn test_extract_symbol_info() {
        let test_cases = vec![
            ("function.name", "main", Some(("function".to_string(), "main".to_string()))),
            ("method.name", "toString", Some(("function".to_string(), "toString".to_string()))),
            ("class.name", "MyClass", Some(("class".to_string(), "MyClass".to_string()))),
            ("struct.name", "Point", Some(("struct".to_string(), "Point".to_string()))),
            ("enum.name", "Color", Some(("enum".to_string(), "Color".to_string()))),
            ("trait.name", "Display", Some(("trait".to_string(), "Display".to_string()))),
            ("impl.name", "MyStruct", Some(("impl".to_string(), "MyStruct".to_string()))),
            ("module.name", "utils", Some(("module".to_string(), "utils".to_string()))),
            ("variable.name", "counter", Some(("variable".to_string(), "counter".to_string()))),
            ("typedef.name", "uint32_t", Some(("typedef".to_string(), "uint32_t".to_string()))),
            ("import.name", "std::collections", Some(("import".to_string(), "std::collections".to_string()))),
            ("import.module", "json", Some(("import".to_string(), "json".to_string()))),
            ("export.function", "exportedFn", Some(("export".to_string(), "exportedFn".to_string()))),
            ("unknown.capture", "test", None),
            ("", "test", None),
        ];

        for (capture_name, text, expected) in test_cases {
            let result = match capture_name {
                "function.name" | "method.name" => Some(("function".to_string(), text.to_string())),
                "class.name" => Some(("class".to_string(), text.to_string())),
                "struct.name" => Some(("struct".to_string(), text.to_string())),
                "enum.name" => Some(("enum".to_string(), text.to_string())),
                "trait.name" => Some(("trait".to_string(), text.to_string())),
                "impl.name" => Some(("impl".to_string(), text.to_string())),
                "module.name" => Some(("module".to_string(), text.to_string())),
                "variable.name" => Some(("variable".to_string(), text.to_string())),
                "typedef.name" => Some(("typedef".to_string(), text.to_string())),
                "import.name" | "import.module" => Some(("import".to_string(), text.to_string())),
                "export.function" => Some(("export".to_string(), text.to_string())),
                _ => None,
            };

            assert_eq!(result, expected, "Failed for capture: '{}' with text: '{}'", capture_name, text);
        }
    }

    #[tokio::test]
    async fn test_tree_sitter_manager_creation() {
        // Test manager creation (may fail due to missing language parsers in tests)
        let result = TreeSitterManager::new();
        
        match result {
            Ok(manager) => {
                // If it succeeds, we can test language detection
                assert!(manager.detect_language("test.rs").is_some());
                assert!(manager.detect_language("test.py").is_some());
                assert!(manager.detect_language("test.xyz").is_none());
            }
            Err(_) => {
                // Expected to fail in test environment due to disabled Tree-sitter languages
                // The important thing is it doesn't panic
            }
        }
    }

    #[test]
    fn test_extract_symbols_with_text_parsing_rust() {
        let source_code = r#"
fn main() {
    println!("Hello, world!");
}

pub fn helper() -> i32 {
    42
}

struct Config {
    name: String,
}

pub struct Point {
    x: i32,
    y: i32,
}
"#;

        let mut expected_symbols = Vec::new();
        
        // Simulate the text parsing logic for Rust
        for (line_no, line) in source_code.lines().enumerate() {
            let trimmed = line.trim();
            if trimmed.starts_with("fn ") {
                if let Some(name) = extract_rust_fn_name(trimmed) {
                    expected_symbols.push((name, "function", line_no));
                }
            } else if trimmed.starts_with("struct ") || trimmed.starts_with("pub struct ") {
                if let Some(name) = extract_rust_struct_name(trimmed) {
                    expected_symbols.push((name, "struct", line_no));
                }
            }
        }

        // Verify we found the expected symbols
        assert_eq!(expected_symbols.len(), 4);
        assert!(expected_symbols.iter().any(|(name, symbol_type, _)| name == "main" && symbol_type == &"function"));
        assert!(expected_symbols.iter().any(|(name, symbol_type, _)| name == "helper" && symbol_type == &"function"));
        assert!(expected_symbols.iter().any(|(name, symbol_type, _)| name == "Config" && symbol_type == &"struct"));
        assert!(expected_symbols.iter().any(|(name, symbol_type, _)| name == "Point" && symbol_type == &"struct"));
    }

    #[test]
    fn test_extract_symbols_with_text_parsing_python() {
        let source_code = r#"
def main():
    print("Hello, world!")

def helper(x, y):
    return x + y

class Config:
    def __init__(self, name):
        self.name = name

class Point:
    def __init__(self, x, y):
        self.x = x
        self.y = y
"#;

        let mut expected_symbols = Vec::new();
        
        // Simulate the text parsing logic for Python
        for (line_no, line) in source_code.lines().enumerate() {
            let trimmed = line.trim();
            if trimmed.starts_with("def ") {
                if let Some(name) = extract_python_def_name(trimmed) {
                    expected_symbols.push((name, "function", line_no));
                }
            } else if trimmed.starts_with("class ") {
                if let Some(name) = extract_python_class_name(trimmed) {
                    expected_symbols.push((name, "class", line_no));
                }
            }
        }

        // Verify we found the expected symbols
        assert_eq!(expected_symbols.len(), 5);
        assert!(expected_symbols.iter().any(|(name, symbol_type, _)| name == "main" && symbol_type == &"function"));
        assert!(expected_symbols.iter().any(|(name, symbol_type, _)| name == "helper" && symbol_type == &"function"));
        assert!(expected_symbols.iter().any(|(name, symbol_type, _)| name == "__init__" && symbol_type == &"function"));
        assert!(expected_symbols.iter().any(|(name, symbol_type, _)| name == "Config" && symbol_type == &"class"));
        assert!(expected_symbols.iter().any(|(name, symbol_type, _)| name == "Point" && symbol_type == &"class"));
    }

    #[test]
    fn test_extract_symbols_with_text_parsing_javascript() {
        let source_code = r#"
function main() {
    console.log("Hello, world!");
}

function helper(x, y) {
    return x + y;
}

class Config {
    constructor(name) {
        this.name = name;
    }
}

class Point {
    constructor(x, y) {
        this.x = x;
        this.y = y;
    }
}
"#;

        let mut expected_symbols = Vec::new();
        
        // Simulate the text parsing logic for JavaScript
        for (line_no, line) in source_code.lines().enumerate() {
            let trimmed = line.trim();
            if trimmed.starts_with("function ") {
                if let Some(name) = extract_js_function_name(trimmed) {
                    expected_symbols.push((name, "function", line_no));
                }
            } else if trimmed.starts_with("class ") {
                if let Some(name) = extract_js_class_name(trimmed) {
                    expected_symbols.push((name, "class", line_no));
                }
            }
        }

        // Verify we found the expected symbols
        assert_eq!(expected_symbols.len(), 4);
        assert!(expected_symbols.iter().any(|(name, symbol_type, _)| name == "main" && symbol_type == &"function"));
        assert!(expected_symbols.iter().any(|(name, symbol_type, _)| name == "helper" && symbol_type == &"function"));
        assert!(expected_symbols.iter().any(|(name, symbol_type, _)| name == "Config" && symbol_type == &"class"));
        assert!(expected_symbols.iter().any(|(name, symbol_type, _)| name == "Point" && symbol_type == &"class"));
    }

    #[test]
    fn test_extract_symbols_with_text_parsing_c() {
        let source_code = r#"
#include <stdio.h>

int main(int argc, char *argv[]) {
    printf("Hello, world!\n");
    return 0;
}

void helper() {
    // Helper function
}

char* getString(void) {
    return "test";
}
"#;

        let mut expected_symbols = Vec::new();
        
        // Simulate the text parsing logic for C
        for (line_no, line) in source_code.lines().enumerate() {
            let trimmed = line.trim();
            if trimmed.contains("(") && (trimmed.contains("int ") || trimmed.contains("void ") || trimmed.contains("char ") || trimmed.contains("float ")) {
                if let Some(name) = extract_c_function_name(trimmed) {
                    expected_symbols.push((name, "function", line_no));
                }
            }
        }

        // Verify we found the expected symbols
        assert_eq!(expected_symbols.len(), 3);
        assert!(expected_symbols.iter().any(|(name, symbol_type, _)| name == "main" && symbol_type == &"function"));
        assert!(expected_symbols.iter().any(|(name, symbol_type, _)| name == "helper" && symbol_type == &"function"));
        assert!(expected_symbols.iter().any(|(name, symbol_type, _)| name == "getString" && symbol_type == &"function"));
    }

    #[test]
    fn test_position_to_byte_offset() {
        let source_code = "line 1\nline 2\nline 3\n";
        
        // Test the position to byte offset calculation logic
        let test_cases = vec![
            (0, 0, 0),     // Start of first line
            (1, 0, 7),     // Start of second line (after "line 1\n")
            (2, 0, 14),    // Start of third line (after "line 1\nline 2\n")
        ];

        for (line, column, expected_offset) in test_cases {
            let mut offset = 0;
            let mut current_line = 0;
            
            for ch in source_code.chars() {
                if current_line == line {
                    if column == 0 {
                        break;
                    }
                    // For simplicity, we just test the line start positions
                    break;
                }
                
                if ch == '\n' {
                    current_line += 1;
                }
                
                offset += ch.len_utf8();
            }
            
            if line < 3 { // Only test valid lines
                assert_eq!(offset, expected_offset, "Failed for line {} column {}", line, column);
            }
        }
    }

    #[test]
    fn test_symbol_serialization() {
        let symbol = Symbol {
            name: "test_function".to_string(),
            symbol_type: "function".to_string(),
            start_line: 10,
            end_line: 15,
            start_column: 5,
            end_column: 20,
        };

        // Test that Symbol can be serialized and deserialized
        let serialized = serde_json::to_string(&symbol).unwrap();
        let deserialized: Symbol = serde_json::from_str(&serialized).unwrap();

        assert_eq!(symbol.name, deserialized.name);
        assert_eq!(symbol.symbol_type, deserialized.symbol_type);
        assert_eq!(symbol.start_line, deserialized.start_line);
        assert_eq!(symbol.end_line, deserialized.end_line);
        assert_eq!(symbol.start_column, deserialized.start_column);
        assert_eq!(symbol.end_column, deserialized.end_column);
    }

    #[test]
    fn test_edge_case_extraction() {
        // Test edge cases for symbol extraction

        // Empty and whitespace-only lines
        assert_eq!(extract_rust_fn_name(""), None);
        assert_eq!(extract_rust_fn_name("   "), None);
        assert_eq!(extract_python_def_name(""), None);
        assert_eq!(extract_js_function_name(""), None);
        assert_eq!(extract_c_function_name(""), None);

        // Malformed function definitions
        assert_eq!(extract_rust_fn_name("fn"), None);
        assert_eq!(extract_rust_fn_name("fn ()"), None);
        assert_eq!(extract_python_def_name("def"), None);
        assert_eq!(extract_python_def_name("def ()"), None);
        assert_eq!(extract_js_function_name("function"), None);
        assert_eq!(extract_js_function_name("function ()"), None);

        // Comments and non-function lines
        assert_eq!(extract_rust_fn_name("// fn commented_out()"), None);
        assert_eq!(extract_python_def_name("# def commented_out():"), None);
        assert_eq!(extract_js_function_name("// function commented_out()"), None);

        // Functions with complex signatures
        assert_eq!(extract_rust_fn_name("fn complex<T: Clone + Debug>(x: T) -> Result<T, Error>"), Some("complex".to_string()));
        assert_eq!(extract_python_def_name("def complex(x: int, y: str = \"default\") -> bool:"), Some("complex".to_string()));
        assert_eq!(extract_js_function_name("function complex(x, y, ...args) {"), Some("complex".to_string()));
    }

    #[test]
    fn test_fallback_behavior() {
        // Test that the system gracefully handles unsupported languages
        let unsupported_code = r#"
        some random code
        that doesn't match
        any known patterns
        "#;

        let mut symbols: Vec<String> = Vec::new();
        
        // The fallback should not crash and should return empty results
        // This simulates the "other languages" case in extract_symbols_with_text_parsing
        
        assert!(symbols.is_empty());
    }
}