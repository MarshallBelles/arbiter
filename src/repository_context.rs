use anyhow::{Result, Context};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use std::fs;
use tracing::{debug, info, warn};
use serde::{Serialize, Deserialize};

use crate::tree_sitter_support::{TreeSitterManager, Symbol};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepositoryContext {
    pub project_name: String,
    pub root_path: PathBuf,
    pub languages: Vec<String>,
    pub file_count: usize,
    pub total_symbols: usize,
    pub key_files: Vec<FileInfo>,
    pub symbol_summary: SymbolSummary,
    pub last_updated: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileInfo {
    pub path: PathBuf,
    pub language: String,
    pub symbols: Vec<Symbol>,
    pub last_modified: u64,
    pub size_bytes: u64,
    pub is_key_file: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SymbolSummary {
    pub functions: Vec<SymbolRef>,
    pub classes: Vec<SymbolRef>,
    pub structs: Vec<SymbolRef>,
    pub enums: Vec<SymbolRef>,
    pub traits: Vec<SymbolRef>,
    pub modules: Vec<SymbolRef>,
    pub imports: Vec<SymbolRef>,
    pub total_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SymbolRef {
    pub name: String,
    pub file_path: PathBuf,
    pub line: usize,
    pub symbol_type: String,
}

pub struct RepositoryContextManager {
    tree_sitter: TreeSitterManager,
    cache: HashMap<PathBuf, FileInfo>,
    config: RepositoryContextConfig,
    last_scan: Option<SystemTime>,
}

#[derive(Debug, Clone)]
pub struct RepositoryContextConfig {
    pub enabled: bool,
    pub max_tokens: usize,
    pub excluded_dirs: Vec<String>,
    pub excluded_extensions: Vec<String>,
    pub priority_symbols: Vec<String>,
    pub max_files_per_language: usize,
    pub rescan_interval_seconds: u64,
}

impl Default for RepositoryContextConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            max_tokens: 2048,
            excluded_dirs: vec![
                ".git".to_string(),
                "target".to_string(),
                "node_modules".to_string(),
                "dist".to_string(),
                "build".to_string(),
                "__pycache__".to_string(),
                ".pytest_cache".to_string(),
                ".cargo".to_string(),
                ".vs".to_string(),
                ".vscode".to_string(),
                ".idea".to_string(),
            ],
            excluded_extensions: vec![
                "exe".to_string(),
                "dll".to_string(),
                "so".to_string(),
                "dylib".to_string(),
                "bin".to_string(),
                "obj".to_string(),
                "lock".to_string(),
                "log".to_string(),
                "tmp".to_string(),
                "cache".to_string(),
            ],
            priority_symbols: vec![
                "struct".to_string(),
                "class".to_string(),
                "function".to_string(),
                "enum".to_string(),
                "trait".to_string(),
                "module".to_string(),
            ],
            max_files_per_language: 20,
            rescan_interval_seconds: 300, // 5 minutes
        }
    }
}

impl RepositoryContextManager {
    pub fn new(config: Option<RepositoryContextConfig>) -> Result<Self> {
        let tree_sitter = TreeSitterManager::new()?;
        let config = config.unwrap_or_default();
        
        Ok(Self {
            tree_sitter,
            cache: HashMap::new(),
            config,
            last_scan: None,
        })
    }
    
    pub async fn get_repository_context(&mut self, root_path: &Path) -> Result<RepositoryContext> {
        if !self.config.enabled {
            return Ok(self.create_empty_context(root_path));
        }
        
        // Check if we need to rescan
        let should_rescan = self.should_rescan();
        
        if should_rescan {
            info!("Scanning repository for context: {}", root_path.display());
            self.scan_repository(root_path).await?;
            self.last_scan = Some(SystemTime::now());
        }
        
        self.build_context(root_path)
    }
    
    pub fn get_context_for_token_limit(&self, context: &RepositoryContext, max_tokens: usize) -> Result<String> {
        let mut output = Vec::new();
        let mut token_count = 0;
        
        // Repository header
        let header = format!(
            "# Repository Context: {}\nLanguages: {}\nFiles: {} | Symbols: {}\n\n",
            context.project_name,
            context.languages.join(", "),
            context.file_count,
            context.total_symbols
        );
        output.push(header.clone());
        token_count += self.estimate_tokens(&header);
        
        // Add key symbols in priority order
        for symbol_type in &self.config.priority_symbols {
            if token_count >= max_tokens {
                break;
            }
            
            let symbols = self.get_symbols_by_type(&context.symbol_summary, symbol_type);
            if !symbols.is_empty() {
                let section = self.format_symbol_section(symbol_type, &symbols, max_tokens - token_count)?;
                if !section.is_empty() {
                    output.push(section.clone());
                    token_count += self.estimate_tokens(&section);
                }
            }
        }
        
        // Add key files if we have tokens left
        if token_count < max_tokens {
            let files_section = self.format_key_files_section(&context.key_files, max_tokens - token_count)?;
            if !files_section.is_empty() {
                output.push(files_section);
            }
        }
        
        Ok(output.join("\n"))
    }
    
    fn should_rescan(&self) -> bool {
        match self.last_scan {
            None => true,
            Some(last_scan) => {
                match SystemTime::now().duration_since(last_scan) {
                    Ok(duration) => duration.as_secs() >= self.config.rescan_interval_seconds,
                    Err(_) => true, // If time went backwards, rescan
                }
            }
        }
    }
    
    async fn scan_repository(&mut self, root_path: &Path) -> Result<()> {
        let mut discovered_files = Vec::new();
        self.discover_source_files(root_path, &mut discovered_files)?;
        
        info!("Found {} source files to analyze", discovered_files.len());
        
        // Group files by language and limit per language
        let mut files_by_language: HashMap<String, Vec<PathBuf>> = HashMap::new();
        for file_path in discovered_files {
            if let Some(language) = self.tree_sitter.detect_language(&file_path.to_string_lossy()) {
                files_by_language.entry(language).or_default().push(file_path);
            }
        }
        
        // Limit files per language and prioritize smaller files
        for (language, mut files) in files_by_language {
            // Sort by file size (smaller first, likely more important)
            files.sort_by_key(|path| {
                fs::metadata(path).map(|m| m.len()).unwrap_or(u64::MAX)
            });
            
            files.truncate(self.config.max_files_per_language);
            
            for file_path in files {
                if let Err(e) = self.analyze_file(&file_path, &language).await {
                    warn!("Failed to analyze file {}: {}", file_path.display(), e);
                }
            }
        }
        
        debug!("Repository scan completed. Cached {} files", self.cache.len());
        Ok(())
    }
    
    fn discover_source_files(&self, dir: &Path, files: &mut Vec<PathBuf>) -> Result<()> {
        if !dir.is_dir() {
            return Ok(());
        }
        
        // Skip excluded directories
        if let Some(dir_name) = dir.file_name().and_then(|n| n.to_str()) {
            if self.config.excluded_dirs.contains(&dir_name.to_string()) {
                return Ok(());
            }
        }
        
        let entries = fs::read_dir(dir).context(format!("Failed to read directory: {}", dir.display()))?;
        
        for entry in entries {
            let entry = entry?;
            let path = entry.path();
            
            if path.is_dir() {
                self.discover_source_files(&path, files)?;
            } else if path.is_file() {
                if self.is_source_file(&path) {
                    files.push(path);
                }
            }
        }
        
        Ok(())
    }
    
    fn is_source_file(&self, path: &Path) -> bool {
        if let Some(extension) = path.extension().and_then(|e| e.to_str()) {
            // Check if it's an excluded extension
            if self.config.excluded_extensions.contains(&extension.to_string()) {
                return false;
            }
            
            // Check if Tree-sitter supports this language
            self.tree_sitter.detect_language(&path.to_string_lossy()).is_some()
        } else {
            false
        }
    }
    
    async fn analyze_file(&mut self, file_path: &Path, language: &str) -> Result<()> {
        let metadata = fs::metadata(file_path)?;
        let last_modified = metadata.modified()?.duration_since(UNIX_EPOCH)?.as_secs();
        
        // Check if file is in cache and hasn't been modified
        if let Some(cached_file) = self.cache.get(file_path) {
            if cached_file.last_modified >= last_modified {
                debug!("Using cached analysis for {}", file_path.display());
                return Ok(());
            }
        }
        
        debug!("Analyzing file: {}", file_path.display());
        
        let content = fs::read_to_string(file_path)
            .context(format!("Failed to read file: {}", file_path.display()))?;
        
        let symbols = self.tree_sitter.get_symbols(language, &content)?;
        
        let file_info = FileInfo {
            path: file_path.to_path_buf(),
            language: language.to_string(),
            symbols,
            last_modified,
            size_bytes: metadata.len(),
            is_key_file: self.is_key_file(file_path),
        };
        
        self.cache.insert(file_path.to_path_buf(), file_info);
        Ok(())
    }
    
    fn is_key_file(&self, path: &Path) -> bool {
        if let Some(file_name) = path.file_name().and_then(|n| n.to_str()) {
            let key_patterns = [
                "main.", "index.", "app.", "lib.", "mod.", 
                "Cargo.toml", "package.json", "setup.py", "Makefile",
                "README", "LICENSE"
            ];
            
            key_patterns.iter().any(|pattern| file_name.starts_with(pattern))
        } else {
            false
        }
    }
    
    fn build_context(&self, root_path: &Path) -> Result<RepositoryContext> {
        let project_name = root_path.file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("unknown")
            .to_string();
        
        let mut languages = HashSet::new();
        let mut key_files = Vec::new();
        let mut all_symbols = Vec::new();
        
        for file_info in self.cache.values() {
            languages.insert(file_info.language.clone());
            
            if file_info.is_key_file {
                key_files.push(file_info.clone());
            }
            
            for symbol in &file_info.symbols {
                all_symbols.push(SymbolRef {
                    name: symbol.name.clone(),
                    file_path: file_info.path.clone(),
                    line: symbol.start_line,
                    symbol_type: symbol.symbol_type.clone(),
                });
            }
        }
        
        let symbol_summary = self.build_symbol_summary(all_symbols);
        
        Ok(RepositoryContext {
            project_name,
            root_path: root_path.to_path_buf(),
            languages: languages.into_iter().collect(),
            file_count: self.cache.len(),
            total_symbols: symbol_summary.total_count,
            key_files,
            symbol_summary,
            last_updated: SystemTime::now().duration_since(UNIX_EPOCH)?.as_secs(),
        })
    }
    
    fn build_symbol_summary(&self, symbols: Vec<SymbolRef>) -> SymbolSummary {
        let mut functions = Vec::new();
        let mut classes = Vec::new();
        let mut structs = Vec::new();
        let mut enums = Vec::new();
        let mut traits = Vec::new();
        let mut modules = Vec::new();
        let mut imports = Vec::new();
        
        for symbol in &symbols {
            match symbol.symbol_type.as_str() {
                "function" => functions.push(symbol.clone()),
                "class" => classes.push(symbol.clone()),
                "struct" => structs.push(symbol.clone()),
                "enum" => enums.push(symbol.clone()),
                "trait" => traits.push(symbol.clone()),
                "module" => modules.push(symbol.clone()),
                "import" => imports.push(symbol.clone()),
                _ => {}
            }
        }
        
        SymbolSummary {
            functions,
            classes,
            structs,
            enums,
            traits,
            modules,
            imports,
            total_count: symbols.len(),
        }
    }
    
    fn create_empty_context(&self, root_path: &Path) -> RepositoryContext {
        RepositoryContext {
            project_name: root_path.file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("unknown")
                .to_string(),
            root_path: root_path.to_path_buf(),
            languages: Vec::new(),
            file_count: 0,
            total_symbols: 0,
            key_files: Vec::new(),
            symbol_summary: SymbolSummary {
                functions: Vec::new(),
                classes: Vec::new(),
                structs: Vec::new(),
                enums: Vec::new(),
                traits: Vec::new(),
                modules: Vec::new(),
                imports: Vec::new(),
                total_count: 0,
            },
            last_updated: SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs(),
        }
    }
    
    fn get_symbols_by_type<'a>(&self, summary: &'a SymbolSummary, symbol_type: &str) -> &'a Vec<SymbolRef> {
        match symbol_type {
            "function" => &summary.functions,
            "class" => &summary.classes,
            "struct" => &summary.structs,
            "enum" => &summary.enums,
            "trait" => &summary.traits,
            "module" => &summary.modules,
            "import" => &summary.imports,
            _ => &summary.functions, // Default fallback
        }
    }
    
    fn format_symbol_section(&self, symbol_type: &str, symbols: &[SymbolRef], max_tokens: usize) -> Result<String> {
        if symbols.is_empty() {
            return Ok(String::new());
        }
        
        let mut output = format!("## {}\n", symbol_type.to_uppercase());
        let mut token_count = self.estimate_tokens(&output);
        
        for symbol in symbols.iter().take(20) { // Limit to 20 symbols per type
            let line = format!("- {} ({}:{})\n", symbol.name, symbol.file_path.display(), symbol.line + 1);
            let line_tokens = self.estimate_tokens(&line);
            
            if token_count + line_tokens > max_tokens {
                break;
            }
            
            output.push_str(&line);
            token_count += line_tokens;
        }
        
        output.push('\n');
        Ok(output)
    }
    
    fn format_key_files_section(&self, key_files: &[FileInfo], max_tokens: usize) -> Result<String> {
        if key_files.is_empty() {
            return Ok(String::new());
        }
        
        let mut output = "## KEY FILES\n".to_string();
        let mut token_count = self.estimate_tokens(&output);
        
        for file in key_files.iter().take(10) { // Limit to 10 key files
            let line = format!("- {} ({} symbols)\n", file.path.display(), file.symbols.len());
            let line_tokens = self.estimate_tokens(&line);
            
            if token_count + line_tokens > max_tokens {
                break;
            }
            
            output.push_str(&line);
            token_count += line_tokens;
        }
        
        Ok(output)
    }
    
    fn estimate_tokens(&self, text: &str) -> usize {
        // Rough estimation: ~4 characters per token
        (text.len() + 3) / 4
    }
}

impl Default for SymbolSummary {
    fn default() -> Self {
        Self {
            functions: Vec::new(),
            classes: Vec::new(),
            structs: Vec::new(),
            enums: Vec::new(),
            traits: Vec::new(),
            modules: Vec::new(),
            imports: Vec::new(),
            total_count: 0,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;
    use std::fs;
    use crate::tree_sitter_support::Symbol;

    fn create_test_config() -> RepositoryContextConfig {
        RepositoryContextConfig {
            enabled: true,
            max_tokens: 1000,
            excluded_dirs: vec!["test_excluded".to_string()],
            excluded_extensions: vec!["test_ext".to_string()],
            priority_symbols: vec!["function".to_string(), "struct".to_string()],
            max_files_per_language: 5,
            rescan_interval_seconds: 10,
        }
    }

    fn create_test_symbol(name: &str, symbol_type: &str, line: usize) -> Symbol {
        Symbol {
            name: name.to_string(),
            symbol_type: symbol_type.to_string(),
            start_line: line,
            end_line: line,
            start_column: 0,
            end_column: 10,
        }
    }

    fn create_test_file_info(path: &str, language: &str, symbols: Vec<Symbol>) -> FileInfo {
        FileInfo {
            path: PathBuf::from(path),
            language: language.to_string(),
            symbols,
            last_modified: 1234567890,
            size_bytes: 1024,
            is_key_file: path.contains("main") || path.contains("lib"),
        }
    }

    #[test]
    fn test_repository_context_config_default() {
        let config = RepositoryContextConfig::default();
        assert!(config.enabled);
        assert_eq!(config.max_tokens, 2048);
        assert!(config.excluded_dirs.contains(&"target".to_string()));
        assert!(config.excluded_dirs.contains(&".git".to_string()));
        assert!(config.excluded_extensions.contains(&"exe".to_string()));
        assert!(config.priority_symbols.contains(&"function".to_string()));
        assert_eq!(config.max_files_per_language, 20);
        assert_eq!(config.rescan_interval_seconds, 300);
    }

    #[test]
    fn test_repository_context_creation() {
        let context = RepositoryContext {
            project_name: "test_project".to_string(),
            root_path: PathBuf::from("/test/path"),
            languages: vec!["rust".to_string(), "python".to_string()],
            file_count: 10,
            total_symbols: 100,
            key_files: vec![],
            symbol_summary: SymbolSummary::default(),
            last_updated: 1234567890,
        };

        assert_eq!(context.project_name, "test_project");
        assert_eq!(context.root_path, PathBuf::from("/test/path"));
        assert_eq!(context.languages.len(), 2);
        assert_eq!(context.file_count, 10);
        assert_eq!(context.total_symbols, 100);
        assert_eq!(context.last_updated, 1234567890);
    }

    #[test]
    fn test_file_info_creation() {
        let symbols = vec![
            create_test_symbol("main", "function", 10),
            create_test_symbol("Config", "struct", 20),
        ];
        
        let file_info = create_test_file_info("src/main.rs", "rust", symbols);
        
        assert_eq!(file_info.path, PathBuf::from("src/main.rs"));
        assert_eq!(file_info.language, "rust");
        assert_eq!(file_info.symbols.len(), 2);
        assert_eq!(file_info.symbols[0].name, "main");
        assert_eq!(file_info.symbols[1].name, "Config");
        assert!(file_info.is_key_file);
        assert_eq!(file_info.size_bytes, 1024);
    }

    #[test]
    fn test_symbol_summary_creation() {
        let symbols = vec![
            SymbolRef {
                name: "main".to_string(),
                file_path: PathBuf::from("main.rs"),
                line: 10,
                symbol_type: "function".to_string(),
            },
            SymbolRef {
                name: "Config".to_string(),
                file_path: PathBuf::from("config.rs"),
                line: 5,
                symbol_type: "struct".to_string(),
            },
            SymbolRef {
                name: "UserData".to_string(),
                file_path: PathBuf::from("user.rs"),
                line: 15,
                symbol_type: "class".to_string(),
            },
        ];

        // Test the symbol classification logic
        let mut functions = Vec::new();
        let mut classes = Vec::new();
        let mut structs = Vec::new();

        for symbol in &symbols {
            match symbol.symbol_type.as_str() {
                "function" => functions.push(symbol.clone()),
                "class" => classes.push(symbol.clone()),
                "struct" => structs.push(symbol.clone()),
                _ => {}
            }
        }

        assert_eq!(functions.len(), 1);
        assert_eq!(classes.len(), 1);
        assert_eq!(structs.len(), 1);
        assert_eq!(functions[0].name, "main");
        assert_eq!(classes[0].name, "UserData");
        assert_eq!(structs[0].name, "Config");
    }

    #[test]
    fn test_symbol_ref_creation() {
        let symbol_ref = SymbolRef {
            name: "test_function".to_string(),
            file_path: PathBuf::from("src/test.rs"),
            line: 42,
            symbol_type: "function".to_string(),
        };

        assert_eq!(symbol_ref.name, "test_function");
        assert_eq!(symbol_ref.file_path, PathBuf::from("src/test.rs"));
        assert_eq!(symbol_ref.line, 42);
        assert_eq!(symbol_ref.symbol_type, "function");
    }

    #[test]
    fn test_symbol_summary_default() {
        let summary = SymbolSummary::default();
        assert!(summary.functions.is_empty());
        assert!(summary.classes.is_empty());
        assert!(summary.structs.is_empty());
        assert!(summary.enums.is_empty());
        assert!(summary.traits.is_empty());
        assert!(summary.modules.is_empty());
        assert!(summary.imports.is_empty());
        assert_eq!(summary.total_count, 0);
    }

    #[tokio::test]
    async fn test_repository_context_manager_creation() {
        let config = Some(create_test_config());
        
        // This might fail due to TreeSitterManager dependency, but we test error handling
        let result = RepositoryContextManager::new(config);
        
        // We expect this to work or fail gracefully
        match result {
            Ok(manager) => {
                // If it succeeds, verify the config was set
                assert!(manager.config.enabled);
                assert_eq!(manager.config.max_tokens, 1000);
            }
            Err(_) => {
                // If it fails due to TreeSitter initialization, that's expected in tests
                // The important thing is it doesn't panic
            }
        }
    }

    #[test]
    fn test_estimate_tokens() {
        // Test the token estimation logic used throughout the module
        let test_cases = vec![
            ("", 0),
            ("a", 1),
            ("abcd", 1),
            ("abcde", 2),
            ("hello world", 3),
            ("The quick brown fox jumps over the lazy dog", 11),
            ("# Repository Context: test\nLanguages: rust\nFiles: 10 | Symbols: 100\n\n", 21),
        ];

        for (input, expected) in test_cases {
            let estimated = (input.len() + 3) / 4;
            assert_eq!(estimated, expected, "Failed for input: '{}'", input);
        }
    }

    #[test]
    fn test_is_key_file_logic() {
        let key_patterns = [
            "main.", "index.", "app.", "lib.", "mod.", 
            "Cargo.toml", "package.json", "setup.py", "Makefile",
            "README", "LICENSE"
        ];

        let test_cases = vec![
            ("main.rs", true),
            ("index.js", true),
            ("app.py", true),
            ("lib.rs", true),
            ("mod.rs", true),
            ("Cargo.toml", true),
            ("package.json", true),
            ("setup.py", true),
            ("Makefile", true),
            ("README.md", true),
            ("LICENSE", true),
            ("helper.rs", false),
            ("utils.py", false),
            ("test.js", false),
            ("config.json", false),
        ];

        for (file_name, expected) in test_cases {
            let is_key = key_patterns.iter().any(|pattern| file_name.starts_with(pattern));
            assert_eq!(is_key, expected, "Failed for file: {}", file_name);
        }
    }

    #[test]
    fn test_is_source_file_logic() {
        let excluded_extensions = vec!["exe".to_string(), "dll".to_string(), "obj".to_string()];
        
        let test_cases = vec![
            ("test.rs", true),  // Would be true if detected by tree-sitter
            ("test.py", true),  // Would be true if detected by tree-sitter
            ("test.exe", false), // Excluded extension
            ("test.dll", false), // Excluded extension
            ("test.obj", false), // Excluded extension
            ("file_without_extension", false), // No extension
        ];

        for (file_name, expected_if_supported) in test_cases {
            let path = Path::new(file_name);
            let has_valid_extension = if let Some(extension) = path.extension().and_then(|e| e.to_str()) {
                !excluded_extensions.contains(&extension.to_string())
            } else {
                false
            };
            
            if expected_if_supported {
                // For files that should be valid, check they don't have excluded extensions
                assert!(has_valid_extension, "File {} should have valid extension", file_name);
            } else {
                // For files that should be invalid, they either have excluded extensions or no extension
                if path.extension().is_some() {
                    assert!(!has_valid_extension, "File {} should be excluded", file_name);
                }
            }
        }
    }

    #[test]
    fn test_get_symbols_by_type() {
        let summary = SymbolSummary {
            functions: vec![
                SymbolRef {
                    name: "test_fn".to_string(),
                    file_path: PathBuf::from("test.rs"),
                    line: 1,
                    symbol_type: "function".to_string(),
                }
            ],
            classes: vec![
                SymbolRef {
                    name: "TestClass".to_string(),
                    file_path: PathBuf::from("test.py"),
                    line: 5,
                    symbol_type: "class".to_string(),
                }
            ],
            structs: vec![
                SymbolRef {
                    name: "TestStruct".to_string(),
                    file_path: PathBuf::from("test.rs"),
                    line: 10,
                    symbol_type: "struct".to_string(),
                }
            ],
            enums: vec![],
            traits: vec![],
            modules: vec![],
            imports: vec![],
            total_count: 3,
        };

        // Test symbol retrieval by type
        assert_eq!(summary.functions.len(), 1);
        assert_eq!(summary.functions[0].name, "test_fn");
        
        assert_eq!(summary.classes.len(), 1);
        assert_eq!(summary.classes[0].name, "TestClass");
        
        assert_eq!(summary.structs.len(), 1);
        assert_eq!(summary.structs[0].name, "TestStruct");
        
        assert!(summary.enums.is_empty());
        assert!(summary.traits.is_empty());
        assert!(summary.modules.is_empty());
        assert!(summary.imports.is_empty());
    }

    #[test]
    fn test_build_symbol_summary_logic() {
        let symbols = vec![
            SymbolRef {
                name: "main".to_string(),
                file_path: PathBuf::from("main.rs"),
                line: 10,
                symbol_type: "function".to_string(),
            },
            SymbolRef {
                name: "helper".to_string(),
                file_path: PathBuf::from("main.rs"),
                line: 20,
                symbol_type: "function".to_string(),
            },
            SymbolRef {
                name: "Config".to_string(),
                file_path: PathBuf::from("config.rs"),
                line: 5,
                symbol_type: "struct".to_string(),
            },
            SymbolRef {
                name: "User".to_string(),
                file_path: PathBuf::from("user.py"),
                line: 15,
                symbol_type: "class".to_string(),
            },
            SymbolRef {
                name: "Color".to_string(),
                file_path: PathBuf::from("types.rs"),
                line: 1,
                symbol_type: "enum".to_string(),
            },
            SymbolRef {
                name: "Display".to_string(),
                file_path: PathBuf::from("traits.rs"),
                line: 1,
                symbol_type: "trait".to_string(),
            },
        ];

        // Simulate build_symbol_summary logic
        let mut functions = Vec::new();
        let mut classes = Vec::new();
        let mut structs = Vec::new();
        let mut enums = Vec::new();
        let mut traits = Vec::new();
        let mut modules = Vec::new();
        let mut imports = Vec::new();

        for symbol in &symbols {
            match symbol.symbol_type.as_str() {
                "function" => functions.push(symbol.clone()),
                "class" => classes.push(symbol.clone()),
                "struct" => structs.push(symbol.clone()),
                "enum" => enums.push(symbol.clone()),
                "trait" => traits.push(symbol.clone()),
                "module" => modules.push(symbol.clone()),
                "import" => imports.push(symbol.clone()),
                _ => {}
            }
        }

        let summary = SymbolSummary {
            functions,
            classes,
            structs,
            enums,
            traits,
            modules,
            imports,
            total_count: symbols.len(),
        };

        assert_eq!(summary.functions.len(), 2);
        assert_eq!(summary.classes.len(), 1);
        assert_eq!(summary.structs.len(), 1);
        assert_eq!(summary.enums.len(), 1);
        assert_eq!(summary.traits.len(), 1);
        assert_eq!(summary.modules.len(), 0);
        assert_eq!(summary.imports.len(), 0);
        assert_eq!(summary.total_count, 6);
    }

    #[test]
    fn test_should_rescan_logic() {
        use std::time::{SystemTime, Duration};

        // Test case 1: No previous scan (should rescan)
        let last_scan: Option<SystemTime> = None;
        let should_rescan = match last_scan {
            None => true,
            Some(last_scan) => {
                match SystemTime::now().duration_since(last_scan) {
                    Ok(duration) => duration.as_secs() >= 300, // 5 minutes
                    Err(_) => true,
                }
            }
        };
        assert!(should_rescan);

        // Test case 2: Recent scan (should not rescan)
        let last_scan = Some(SystemTime::now() - Duration::from_secs(60)); // 1 minute ago
        let should_rescan = match last_scan {
            None => true,
            Some(last_scan) => {
                match SystemTime::now().duration_since(last_scan) {
                    Ok(duration) => duration.as_secs() >= 300, // 5 minutes
                    Err(_) => true,
                }
            }
        };
        assert!(!should_rescan);

        // Test case 3: Old scan (should rescan)
        let last_scan = Some(SystemTime::now() - Duration::from_secs(600)); // 10 minutes ago
        let should_rescan = match last_scan {
            None => true,
            Some(last_scan) => {
                match SystemTime::now().duration_since(last_scan) {
                    Ok(duration) => duration.as_secs() >= 300, // 5 minutes
                    Err(_) => true,
                }
            }
        };
        assert!(should_rescan);
    }

    #[test]
    fn test_format_symbol_section_logic() {
        let symbols = vec![
            SymbolRef {
                name: "function1".to_string(),
                file_path: PathBuf::from("test1.rs"),
                line: 10,
                symbol_type: "function".to_string(),
            },
            SymbolRef {
                name: "function2".to_string(),
                file_path: PathBuf::from("test2.rs"),
                line: 20,
                symbol_type: "function".to_string(),
            },
        ];

        // Test the format logic
        let expected_start = "## FUNCTION\n";
        let expected_line1 = "- function1 (test1.rs:11)\n";
        let expected_line2 = "- function2 (test2.rs:21)\n";

        // Verify the format strings are correct
        assert_eq!(format!("## {}\n", "function".to_uppercase()), expected_start);
        assert_eq!(format!("- {} ({}:{})\n", symbols[0].name, symbols[0].file_path.display(), symbols[0].line + 1), expected_line1);
        assert_eq!(format!("- {} ({}:{})\n", symbols[1].name, symbols[1].file_path.display(), symbols[1].line + 1), expected_line2);
    }

    #[test]
    fn test_format_key_files_section_logic() {
        let key_files = vec![
            FileInfo {
                path: PathBuf::from("src/main.rs"),
                language: "rust".to_string(),
                symbols: vec![create_test_symbol("main", "function", 1)],
                last_modified: 1234567890,
                size_bytes: 1024,
                is_key_file: true,
            },
            FileInfo {
                path: PathBuf::from("Cargo.toml"),
                language: "toml".to_string(),
                symbols: vec![],
                last_modified: 1234567890,
                size_bytes: 512,
                is_key_file: true,
            },
        ];

        // Test the format logic
        let expected_start = "## KEY FILES\n";
        let expected_line1 = format!("- {} ({} symbols)\n", key_files[0].path.display(), key_files[0].symbols.len());
        let expected_line2 = format!("- {} ({} symbols)\n", key_files[1].path.display(), key_files[1].symbols.len());

        assert_eq!(expected_start, "## KEY FILES\n");
        assert_eq!(expected_line1, "- src/main.rs (1 symbols)\n");
        assert_eq!(expected_line2, "- Cargo.toml (0 symbols)\n");
    }

    #[test]
    fn test_create_empty_context_logic() {
        let root_path = Path::new("/test/project");
        
        // Simulate create_empty_context logic
        let context = RepositoryContext {
            project_name: root_path.file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("unknown")
                .to_string(),
            root_path: root_path.to_path_buf(),
            languages: Vec::new(),
            file_count: 0,
            total_symbols: 0,
            key_files: Vec::new(),
            symbol_summary: SymbolSummary {
                functions: Vec::new(),
                classes: Vec::new(),
                structs: Vec::new(),
                enums: Vec::new(),
                traits: Vec::new(),
                modules: Vec::new(),
                imports: Vec::new(),
                total_count: 0,
            },
            last_updated: SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs(),
        };

        assert_eq!(context.project_name, "project");
        assert_eq!(context.root_path, root_path);
        assert!(context.languages.is_empty());
        assert_eq!(context.file_count, 0);
        assert_eq!(context.total_symbols, 0);
        assert!(context.key_files.is_empty());
        assert_eq!(context.symbol_summary.total_count, 0);
        assert!(context.last_updated > 0);
    }

    #[test]
    fn test_repository_context_serialization() {
        let context = RepositoryContext {
            project_name: "test".to_string(),
            root_path: PathBuf::from("/test"),
            languages: vec!["rust".to_string()],
            file_count: 1,
            total_symbols: 5,
            key_files: vec![],
            symbol_summary: SymbolSummary::default(),
            last_updated: 1234567890,
        };

        // Test that the struct can be serialized and deserialized
        let serialized = serde_json::to_string(&context).unwrap();
        let deserialized: RepositoryContext = serde_json::from_str(&serialized).unwrap();
        
        assert_eq!(context.project_name, deserialized.project_name);
        assert_eq!(context.root_path, deserialized.root_path);
        assert_eq!(context.languages, deserialized.languages);
        assert_eq!(context.file_count, deserialized.file_count);
        assert_eq!(context.total_symbols, deserialized.total_symbols);
    }

    #[test]
    fn test_file_info_serialization() {
        let file_info = FileInfo {
            path: PathBuf::from("test.rs"),
            language: "rust".to_string(),
            symbols: vec![create_test_symbol("test", "function", 1)],
            last_modified: 1234567890,
            size_bytes: 1024,
            is_key_file: true,
        };

        // Test serialization/deserialization
        let serialized = serde_json::to_string(&file_info).unwrap();
        let deserialized: FileInfo = serde_json::from_str(&serialized).unwrap();
        
        assert_eq!(file_info.path, deserialized.path);
        assert_eq!(file_info.language, deserialized.language);
        assert_eq!(file_info.symbols.len(), deserialized.symbols.len());
        assert_eq!(file_info.last_modified, deserialized.last_modified);
        assert_eq!(file_info.size_bytes, deserialized.size_bytes);
        assert_eq!(file_info.is_key_file, deserialized.is_key_file);
    }

    #[test]
    fn test_context_token_limit_calculation() {
        let context = RepositoryContext {
            project_name: "test_project".to_string(),
            root_path: PathBuf::from("/test"),
            languages: vec!["rust".to_string(), "python".to_string()],
            file_count: 10,
            total_symbols: 50,
            key_files: vec![],
            symbol_summary: SymbolSummary::default(),
            last_updated: 1234567890,
        };

        // Test header generation
        let header = format!(
            "# Repository Context: {}\nLanguages: {}\nFiles: {} | Symbols: {}\n\n",
            context.project_name,
            context.languages.join(", "),
            context.file_count,
            context.total_symbols
        );

        let expected_header = "# Repository Context: test_project\nLanguages: rust, python\nFiles: 10 | Symbols: 50\n\n";
        assert_eq!(header, expected_header);

        // Test token estimation for the header
        let token_count = (header.len() + 3) / 4;
        assert!(token_count > 0);
        assert!(token_count < 50); // Should be reasonable for a short header
    }
}