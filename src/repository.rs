use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::Instant;
use std::sync::Arc;

use crate::{Language, FileInfo, SymbolInfo, RelevanceGraph, Result};
use crate::analyzer::CodeAnalyzer;

#[derive(Debug, Clone)]
pub struct RepositoryMap {
    pub files: HashMap<PathBuf, FileInfo>,
    pub symbols: HashMap<String, SymbolInfo>,
    pub dependencies: HashMap<PathBuf, Vec<PathBuf>>,
    pub relevance_graph: RelevanceGraph,
}

pub struct RepositoryMapper {
    analyzer: Arc<CodeAnalyzer>,
    graph_builder: GraphBuilder,
    token_budget: usize,
}

pub struct GraphBuilder {
    // Graph building logic
}

impl GraphBuilder {
    pub fn new() -> Self {
        Self {}
    }

    pub fn build(&self, _symbols: &HashMap<String, SymbolInfo>, _dependencies: &HashMap<PathBuf, Vec<PathBuf>>) -> Result<RelevanceGraph> {
        // Build relevance graph from symbols and dependencies
        Ok(RelevanceGraph {
            nodes: HashMap::new(),
            edges: Vec::new(),
        })
    }
}

impl RepositoryMapper {
    pub fn new(analyzer: Arc<CodeAnalyzer>, token_budget: usize) -> Self {
        Self {
            analyzer,
            graph_builder: GraphBuilder::new(),
            token_budget,
        }
    }

    pub async fn build_map(&self, root: &Path) -> Result<RepositoryMap> {
        let files = self.scan_directory(root).await?;
        let symbols = self.extract_symbols(&files).await?;
        let dependencies = self.analyze_dependencies(&files).await?;
        let relevance_graph = self.graph_builder.build(&symbols, &dependencies)?;
        
        Ok(RepositoryMap {
            files,
            symbols,
            dependencies,
            relevance_graph,
        })
    }

    pub async fn scan_directory(&self, root: &Path) -> Result<HashMap<PathBuf, FileInfo>> {
        let mut files = HashMap::new();
        
        // Basic directory scanning - in practice would use walkdir or similar
        let entries = std::fs::read_dir(root)?;
        
        for entry in entries {
            let entry = entry?;
            let path = entry.path();
            
            if path.is_file() {
                let language = self.detect_language_from_path(&path)?;
                let metadata = entry.metadata()?;
                
                // Extract basic info
                let content = match tokio::fs::read_to_string(&path).await {
                    Ok(content) => content,
                    Err(_) => continue, // Skip unreadable files
                };
                
                let (symbols, imports) = self.extract_basic_info(&content, &language).await;
                
                let file_info = FileInfo {
                    path: path.clone(),
                    language,
                    size: metadata.len() as usize,
                    last_modified: Instant::now(),
                    symbols,
                    imports,
                };
                
                files.insert(path, file_info);
            }
        }
        
        Ok(files)
    }

    async fn extract_symbols(&self, files: &HashMap<PathBuf, FileInfo>) -> Result<HashMap<String, SymbolInfo>> {
        // Use Tree-sitter to extract symbols from each file
        let mut symbols = HashMap::new();
        
        for (path, file_info) in files {
            // Skip non-supported languages
            if matches!(file_info.language, Language::Other(_)) {
                continue;
            }
            
            // Read file content
            let content = match tokio::fs::read_to_string(path).await {
                Ok(content) => content,
                Err(_) => continue, // Skip unreadable files
            };
            
            // Parse file with Tree-sitter
            let parsed_tree = self.analyzer.parse_file(path, &content).await?;
            
            // Extract symbols based on language
            match file_info.language {
                Language::Rust => {
                    self.extract_rust_symbols(&parsed_tree, path, &content, &mut symbols).await?;
                }
                Language::Python => {
                    self.extract_python_symbols(&parsed_tree, path, &content, &mut symbols).await?;
                }
                Language::JavaScript | Language::TypeScript => {
                    self.extract_js_symbols(&parsed_tree, path, &content, &mut symbols).await?;
                }
                Language::Go => {
                    self.extract_go_symbols(&parsed_tree, path, &content, &mut symbols).await?;
                }
                Language::Java => {
                    self.extract_java_symbols(&parsed_tree, path, &content, &mut symbols).await?;
                }
                Language::CSharp => {
                    self.extract_csharp_symbols(&parsed_tree, path, &content, &mut symbols).await?;
                }
                Language::Other(_) => {
                    // Already handled above
                    continue;
                }
            }
        }
        
        // Calculate relevance scores based on reference frequency
        self.calculate_relevance_scores(&mut symbols);
        
        Ok(symbols)
    }

    pub async fn analyze_dependencies(&self, files: &HashMap<PathBuf, FileInfo>) -> Result<HashMap<PathBuf, Vec<PathBuf>>> {
        let mut dependencies: HashMap<PathBuf, Vec<PathBuf>> = HashMap::new();
        
        for (file_path, file_info) in files {
            let mut file_dependencies = Vec::new();
            
            // Extract additional imports using Tree-sitter for accuracy
            let content = match tokio::fs::read_to_string(file_path).await {
                Ok(content) => content,
                Err(_) => {
                    // Use existing imports from FileInfo if file can't be read
                    for import in &file_info.imports {
                        if let Some(resolved_path) = self.resolve_import_path(import, file_path, &file_info.language, files) {
                            if files.contains_key(&resolved_path) {
                                file_dependencies.push(resolved_path);
                            }
                        }
                    }
                    dependencies.insert(file_path.clone(), file_dependencies);
                    continue;
                }
            };
            
            // Parse file with Tree-sitter for more accurate import extraction
            let parsed_tree = self.analyzer.parse_file(file_path, &content).await?;
            let mut imports = self.extract_imports_for_language(&parsed_tree, &file_info.language, &content).await?;
            
            // Merge with existing imports from FileInfo
            for import in &file_info.imports {
                if !imports.contains(import) {
                    imports.push(import.clone());
                }
            }
            
            // Resolve import paths to actual file paths
            for import in &imports {
                if let Some(resolved_path) = self.resolve_import_path(import, file_path, &file_info.language, files) {
                    // Only include dependencies that exist in our file set
                    if files.contains_key(&resolved_path) && resolved_path != *file_path {
                        file_dependencies.push(resolved_path);
                    }
                }
            }
            
            // Remove duplicates
            file_dependencies.sort();
            file_dependencies.dedup();
            
            dependencies.insert(file_path.clone(), file_dependencies);
        }
        
        Ok(dependencies)
    }

    // Helper method implementations would go here...
    // For brevity, I'll add just the signatures for now

    pub fn detect_language_from_path(&self, path: &Path) -> Result<Language> {
        match path.extension().and_then(|s| s.to_str()) {
            Some("rs") => Ok(Language::Rust),
            Some("py") => Ok(Language::Python),
            Some("js") => Ok(Language::JavaScript),
            Some("ts") => Ok(Language::TypeScript),
            Some("go") => Ok(Language::Go),
            Some("java") => Ok(Language::Java),
            Some("cs") => Ok(Language::CSharp),
            Some(ext) => Ok(Language::Other(ext.to_string())),
            None => Ok(Language::Other("unknown".to_string())),
        }
    }

    async fn extract_basic_info(&self, _content: &str, _language: &Language) -> (Vec<String>, Vec<String>) {
        // Basic symbol and import extraction
        (Vec::new(), Vec::new())
    }

    async fn extract_rust_symbols(&self, _tree: &crate::analyzer::ParsedTree, _path: &Path, _content: &str, _symbols: &mut HashMap<String, SymbolInfo>) -> Result<()> {
        // Implementation would go here
        Ok(())
    }

    async fn extract_python_symbols(&self, _tree: &crate::analyzer::ParsedTree, _path: &Path, _content: &str, _symbols: &mut HashMap<String, SymbolInfo>) -> Result<()> {
        Ok(())
    }

    async fn extract_js_symbols(&self, _tree: &crate::analyzer::ParsedTree, _path: &Path, _content: &str, _symbols: &mut HashMap<String, SymbolInfo>) -> Result<()> {
        Ok(())
    }

    async fn extract_go_symbols(&self, _tree: &crate::analyzer::ParsedTree, _path: &Path, _content: &str, _symbols: &mut HashMap<String, SymbolInfo>) -> Result<()> {
        Ok(())
    }

    async fn extract_java_symbols(&self, _tree: &crate::analyzer::ParsedTree, _path: &Path, _content: &str, _symbols: &mut HashMap<String, SymbolInfo>) -> Result<()> {
        Ok(())
    }

    async fn extract_csharp_symbols(&self, _tree: &crate::analyzer::ParsedTree, _path: &Path, _content: &str, _symbols: &mut HashMap<String, SymbolInfo>) -> Result<()> {
        Ok(())
    }

    fn calculate_relevance_scores(&self, _symbols: &mut HashMap<String, SymbolInfo>) {
        // Implementation would go here
    }

    async fn extract_imports_for_language(&self, tree: &crate::analyzer::ParsedTree, language: &Language, content: &str) -> Result<Vec<String>> {
        let mut imports = Vec::new();
        
        match language {
            Language::Rust => {
                // Query for use declarations
                let matches = self.analyzer.query_pattern(tree, "(use_declaration) @import").await?;
                for m in matches {
                    for capture in m.captures {
                        if capture.name == "import" {
                            imports.push(capture.node_text);
                        }
                    }
                }
                
                // Also parse extern crate declarations
                let extern_matches = self.analyzer.query_pattern(tree, "(extern_crate_declaration name: (identifier) @crate)").await?;
                for m in extern_matches {
                    for capture in m.captures {
                        if capture.name == "crate" {
                            imports.push(format!("extern crate {}", capture.node_text));
                        }
                    }
                }
            },
            Language::Python => {
                // Query for import statements
                let import_matches = self.analyzer.query_pattern(tree, "(import_statement name: (dotted_name) @import)").await?;
                for m in import_matches {
                    for capture in m.captures {
                        if capture.name == "import" {
                            imports.push(capture.node_text);
                        }
                    }
                }
                
                // Query for from imports
                let from_matches = self.analyzer.query_pattern(tree, "(import_from_statement module_name: (dotted_name) @module)").await?;
                for m in from_matches {
                    for capture in m.captures {
                        if capture.name == "module" {
                            imports.push(capture.node_text);
                        }
                    }
                }
            },
            Language::JavaScript | Language::TypeScript => {
                // Query for import statements
                let matches = self.analyzer.query_pattern(tree, "(import_statement source: (string) @import)").await?;
                for m in matches {
                    for capture in m.captures {
                        if capture.name == "import" {
                            // Remove quotes from string
                            let import_path = capture.node_text.trim_matches('"').trim_matches('\'');
                            imports.push(import_path.to_string());
                        }
                    }
                }
                
                // Query for require() calls
                let require_matches = self.analyzer.query_pattern(tree, "(call_expression function: (identifier) @func arguments: (arguments (string) @path)) (#eq? @func \"require\")").await?;
                for m in require_matches {
                    for capture in m.captures {
                        if capture.name == "path" {
                            let import_path = capture.node_text.trim_matches('"').trim_matches('\'');
                            imports.push(import_path.to_string());
                        }
                    }
                }
            },
            Language::Go => {
                // Query for import specs
                let matches = self.analyzer.query_pattern(tree, "(import_spec path: (interpreted_string_literal) @import)").await?;
                for m in matches {
                    for capture in m.captures {
                        if capture.name == "import" {
                            let import_path = capture.node_text.trim_matches('"');
                            imports.push(import_path.to_string());
                        }
                    }
                }
            },
            Language::Java => {
                // Query for import declarations
                let matches = self.analyzer.query_pattern(tree, "(import_declaration (scoped_identifier) @import)").await?;
                for m in matches {
                    for capture in m.captures {
                        if capture.name == "import" {
                            imports.push(capture.node_text);
                        }
                    }
                }
            },
            Language::CSharp => {
                // Query for using directives
                let matches = self.analyzer.query_pattern(tree, "(using_directive name: (qualified_name) @import)").await?;
                for m in matches {
                    for capture in m.captures {
                        if capture.name == "import" {
                            imports.push(capture.node_text);
                        }
                    }
                }
            },
            Language::Other(_) => {
                // Fallback to regex-based parsing
                imports.extend(self.extract_imports_with_regex(content, language));
            }
        }
        
        // Deduplicate imports
        imports.sort();
        imports.dedup();
        
        Ok(imports)
    }

    fn resolve_import_path(&self, import: &str, current_file: &Path, language: &Language, files: &HashMap<PathBuf, FileInfo>) -> Option<PathBuf> {
        match language {
            Language::Rust => self.resolve_rust_import(import, current_file, files),
            Language::Python => self.resolve_python_import(import, current_file, files),
            Language::JavaScript | Language::TypeScript => self.resolve_js_import(import, current_file, files),
            Language::Go => self.resolve_go_import(import, current_file, files),
            Language::Java => self.resolve_java_import(import, current_file, files),
            Language::CSharp => self.resolve_csharp_import(import, current_file, files),
            Language::Other(_) => None,
        }
    }

    pub fn compress_for_context(&self, map: &RepositoryMap, query: &str) -> String {
        // Rank symbols by relevance to query
        let ranked_symbols = self.rank_symbols(map, query);
        
        // Build compressed representation within token budget
        let mut result = String::new();
        let mut token_count = 0;
        
        for symbol in ranked_symbols {
            let symbol_repr = self.format_symbol(&symbol);
            let symbol_tokens = self.estimate_tokens(&symbol_repr);
            
            if token_count + symbol_tokens > self.token_budget {
                break;
            }
            
            result.push_str(&symbol_repr);
            result.push('\n');
            token_count += symbol_tokens;
        }
        
        result
    }

    fn rank_symbols<'a>(&self, map: &'a RepositoryMap, query: &str) -> Vec<&'a SymbolInfo> {
        let mut symbols: Vec<_> = map.symbols.values().collect();
        
        // Sort by relevance score and query similarity
        symbols.sort_by(|a, b| {
            let a_score = a.relevance_score + self.query_similarity(query, &a.name);
            let b_score = b.relevance_score + self.query_similarity(query, &b.name);
            b_score.partial_cmp(&a_score).unwrap()
        });
        
        symbols
    }

    fn query_similarity(&self, query: &str, name: &str) -> f32 {
        // Simple similarity metric - in practice would use more sophisticated approach
        if name.contains(query) { 1.0 } else { 0.0 }
    }

    fn format_symbol(&self, symbol: &SymbolInfo) -> String {
        format!("{:?} {}: {}", symbol.kind, symbol.name, symbol.file.display())
    }

    fn estimate_tokens(&self, text: &str) -> usize {
        // Simple token estimation
        text.len() / 4
    }

    fn extract_imports_with_regex(&self, content: &str, language: &Language) -> Vec<String> {
        let mut imports = Vec::new();
        
        match language {
            Language::Other(ext) if ext == "py" => {
                // Python regex fallback
                for line in content.lines() {
                    let line = line.trim();
                    if line.starts_with("import ") {
                        if let Some(module) = line.strip_prefix("import ") {
                            imports.push(module.split_whitespace().next().unwrap_or("").to_string());
                        }
                    } else if line.starts_with("from ") && line.contains(" import ") {
                        if let Some(module) = line.strip_prefix("from ").and_then(|s| s.split(" import ").next()) {
                            imports.push(module.trim().to_string());
                        }
                    }
                }
            },
            Language::Other(ext) if ext == "js" || ext == "ts" => {
                // JavaScript/TypeScript regex fallback
                for line in content.lines() {
                    let line = line.trim();
                    if line.starts_with("import ") && line.contains(" from ") {
                        if let Some(module) = line.split(" from ").last() {
                            let module = module.trim_end_matches(';').trim_matches(|c| c == '\"' || c == '\'');
                            imports.push(module.to_string());
                        }
                    }
                }
            },
            _ => {} // No regex fallback for other languages
        }
        
        imports
    }

    fn resolve_rust_import(&self, import: &str, current_file: &Path, files: &HashMap<PathBuf, FileInfo>) -> Option<PathBuf> {
        // Handle crate-relative imports
        if import.starts_with("crate::") {
            let module_path = import.strip_prefix("crate::")?.replace("::", "/");
            
            // Try to find the corresponding .rs file
            let candidates = vec![
                format!("{}.rs", module_path),
                format!("{}/mod.rs", module_path),
                format!("src/{}.rs", module_path),
                format!("src/{}/mod.rs", module_path),
            ];
            
            for candidate in candidates {
                let path = PathBuf::from(candidate);
                if files.contains_key(&path) {
                    return Some(path);
                }
            }
        }
        
        // Handle relative imports
        if import.starts_with("super::") || import.starts_with("self::") {
            let current_dir = current_file.parent()?;
            let module_path = if import.starts_with("super::") {
                let parent_dir = current_dir.parent()?;
                let rest = import.strip_prefix("super::")?;
                parent_dir.join(rest.replace("::", "/"))
            } else {
                let rest = import.strip_prefix("self::")?;
                current_dir.join(rest.replace("::", "/"))
            };
            
            let candidates = vec![
                module_path.with_extension("rs"),
                module_path.join("mod.rs"),
            ];
            
            for candidate in candidates {
                if files.contains_key(&candidate) {
                    return Some(candidate);
                }
            }
        }
        
        None
    }

    fn resolve_python_import(&self, import: &str, current_file: &Path, files: &HashMap<PathBuf, FileInfo>) -> Option<PathBuf> {
        let module_path = import.replace(".", "/");
        let current_dir = current_file.parent()?;
        
        // Try relative to current file
        let candidates = vec![
            current_dir.join(format!("{}.py", module_path)),
            current_dir.join(format!("{}/__init__.py", module_path)),
            PathBuf::from(format!("{}.py", module_path)),
            PathBuf::from(format!("{}/__init__.py", module_path)),
        ];
        
        for candidate in candidates {
            if files.contains_key(&candidate) {
                return Some(candidate);
            }
        }
        
        None
    }

    fn resolve_js_import(&self, import: &str, current_file: &Path, files: &HashMap<PathBuf, FileInfo>) -> Option<PathBuf> {
        let current_dir = current_file.parent()?;
        
        // Handle relative imports
        if import.starts_with("./") || import.starts_with("../") {
            let import_path = current_dir.join(import);
            
            let candidates = vec![
                import_path.with_extension("js"),
                import_path.with_extension("ts"),
                import_path.with_extension("jsx"),
                import_path.with_extension("tsx"),
                import_path.join("index.js"),
                import_path.join("index.ts"),
            ];
            
            for candidate in candidates {
                if files.contains_key(&candidate) {
                    return Some(candidate);
                }
            }
        }
        
        None
    }

    fn resolve_go_import(&self, import: &str, _current_file: &Path, files: &HashMap<PathBuf, FileInfo>) -> Option<PathBuf> {
        // For Go, imports are typically package paths
        // This is a simplified resolution
        
        // Try to find any .go file in a directory matching the last part of the import
        if let Some(package_name) = import.split('/').last() {
            for (path, file_info) in files {
                if matches!(file_info.language, Language::Go) {
                    if let Some(parent) = path.parent() {
                        if parent.file_name().and_then(|n| n.to_str()) == Some(package_name) {
                            return Some(path.clone());
                        }
                    }
                }
            }
        }
        
        None
    }

    fn resolve_java_import(&self, import: &str, _current_file: &Path, files: &HashMap<PathBuf, FileInfo>) -> Option<PathBuf> {
        // Convert Java package notation to file path
        let file_path = import.replace(".", "/") + ".java";
        
        // Try common Java source directories
        let candidates = vec![
            PathBuf::from(&file_path),
            PathBuf::from(format!("src/{}", file_path)),
            PathBuf::from(format!("src/main/java/{}", file_path)),
        ];
        
        for candidate in candidates {
            if files.contains_key(&candidate) {
                return Some(candidate);
            }
        }
        
        None
    }

    fn resolve_csharp_import(&self, import: &str, _current_file: &Path, files: &HashMap<PathBuf, FileInfo>) -> Option<PathBuf> {
        // Convert C# namespace notation to file path
        let file_path = import.replace(".", "/") + ".cs";
        
        // Try common C# source directories
        let candidates = vec![
            PathBuf::from(&file_path),
            PathBuf::from(format!("src/{}", file_path)),
        ];
        
        for candidate in candidates {
            if files.contains_key(&candidate) {
                return Some(candidate);
            }
        }
        
        None
    }
}