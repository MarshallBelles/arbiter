use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, RwLock, atomic::{AtomicUsize, Ordering}};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
use async_trait::async_trait;
use tokio::sync::{Mutex, mpsc};
use serde::{Deserialize, Serialize};

// Re-export commonly used types
pub type Result<T> = std::result::Result<T, Box<dyn std::error::Error + Send + Sync>>;

// ==================== Core Types ====================

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum Language {
    Rust,
    Python,
    JavaScript,
    TypeScript,
    Go,
    Java,
    CSharp,
    Other(String),
}

#[derive(Debug, Clone)]
pub struct FileEdit {
    pub path: PathBuf,
    pub edits: Vec<TextEdit>,
    pub original_content: String,
}

#[derive(Debug, Clone)]
pub struct TextEdit {
    pub range: TextRange,
    pub new_text: String,
    pub edit_type: EditType,
}

#[derive(Debug, Clone, Copy)]
pub struct TextRange {
    pub start: Position,
    pub end: Position,
}

#[derive(Debug, Clone, Copy)]
pub struct Position {
    pub line: usize,
    pub character: usize,
}

#[derive(Debug, Clone)]
pub enum EditType {
    SearchReplace { search_pattern: String },
    WholeFile,
    UnifiedDiff,
    LineRange,
}

// ==================== Context Management (Claude Code inspired) ====================

#[derive(Debug)]
pub struct ContextWindow {
    pub total_tokens: usize,
    pub used_tokens: AtomicUsize,
    pub layers: Vec<ContextLayer>,
}

#[derive(Debug, Clone)]
pub struct ContextLayer {
    pub name: String,
    pub priority: u8,
    pub content: Arc<str>,
    pub token_count: usize,
    pub compressible: bool,
}

#[derive(Debug, Clone)]
pub struct ProjectContext {
    pub claude_md_files: HashMap<PathBuf, String>,
    pub coding_conventions: Vec<String>,
    pub architectural_decisions: Vec<String>,
    pub active_features: Vec<String>,
}

pub struct ContextManager {
    window: Arc<RwLock<ContextWindow>>,
    compactor: Box<dyn ContextCompactor + Send + Sync>,
    visualizer: ContextVisualizer,
}

impl ContextManager {
    pub fn new(window_size: usize) -> Self {
        Self {
            window: Arc::new(RwLock::new(ContextWindow {
                total_tokens: window_size,
                used_tokens: AtomicUsize::new(0),
                layers: Vec::new(),
            })),
            compactor: Box::new(IntelligentCompactor::new()),
            visualizer: ContextVisualizer::new(),
        }
    }

    pub fn add_layer(&self, layer: ContextLayer) -> Result<()> {
        let mut window = self.window.write().unwrap();
        let current_usage = window.used_tokens.load(Ordering::Relaxed);
        
        if current_usage + layer.token_count > window.total_tokens {
            // Trigger compaction
            self.compact()?;
        }
        
        window.used_tokens.fetch_add(layer.token_count, Ordering::Relaxed);
        window.layers.push(layer);
        Ok(())
    }

    pub fn compact(&self) -> Result<()> {
        let mut window = self.window.write().unwrap();
        let compacted_layers = futures::executor::block_on(self.compactor.compact(&window.layers))?;
        
        let new_usage: usize = compacted_layers.iter().map(|l| l.token_count).sum();
        window.used_tokens.store(new_usage, Ordering::Relaxed);
        window.layers = compacted_layers;
        
        Ok(())
    }

    pub fn get_usage_percentage(&self) -> f32 {
        let window = self.window.read().unwrap();
        let used = window.used_tokens.load(Ordering::Relaxed) as f32;
        let total = window.total_tokens as f32;
        (used / total) * 100.0
    }

    pub fn visualize(&self) -> String {
        let window = self.window.read().unwrap();
        self.visualizer.render(&window)
    }
}

#[async_trait]
pub trait ContextCompactor {
    async fn compact(&self, layers: &[ContextLayer]) -> Result<Vec<ContextLayer>>;
}

pub struct IntelligentCompactor {
    summarizer: Box<dyn TextSummarizer + Send + Sync>,
}

impl IntelligentCompactor {
    pub fn new() -> Self {
        Self {
            summarizer: Box::new(DefaultSummarizer),
        }
    }
}

#[async_trait]
impl ContextCompactor for IntelligentCompactor {
    async fn compact(&self, layers: &[ContextLayer]) -> Result<Vec<ContextLayer>> {
        let mut result = Vec::new();
        
        for layer in layers {
            if layer.compressible && layer.token_count > 1000 {
                let summary = self.summarizer.summarize(&layer.content).await?;
                result.push(ContextLayer {
                    name: format!("{} (compressed)", layer.name),
                    content: Arc::from(summary),
                    token_count: layer.token_count / 3, // Approximate compression
                    ..*layer
                });
            } else {
                result.push(layer.clone());
            }
        }
        
        Ok(result)
    }
}

// ==================== Repository Mapping (Aider inspired) ====================

#[derive(Debug, Clone)]
pub struct RepositoryMap {
    pub files: HashMap<PathBuf, FileInfo>,
    pub symbols: HashMap<String, SymbolInfo>,
    pub dependencies: HashMap<PathBuf, Vec<PathBuf>>,
    pub relevance_graph: RelevanceGraph,
}

#[derive(Debug, Clone)]
pub struct FileInfo {
    pub path: PathBuf,
    pub language: Language,
    pub size: usize,
    pub last_modified: Instant,
    pub symbols: Vec<String>,
    pub imports: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct SymbolInfo {
    pub name: String,
    pub kind: SymbolKind,
    pub file: PathBuf,
    pub range: TextRange,
    pub references: Vec<PathBuf>,
    pub relevance_score: f32,
}

#[derive(Debug, Clone)]
pub enum SymbolKind {
    Function,
    Class,
    Interface,
    Enum,
    Constant,
    Variable,
    Type,
}

#[derive(Debug, Clone)]
pub struct RelevanceGraph {
    nodes: HashMap<String, RelevanceNode>,
    edges: Vec<(String, String, f32)>, // (from, to, weight)
}

#[derive(Debug, Clone)]
pub struct RelevanceNode {
    pub identifier: String,
    pub access_count: usize,
    pub last_accessed: Instant,
    pub importance: f32,
}

pub struct RepositoryMapper {
    analyzer: Arc<CodeAnalyzer>,
    graph_builder: GraphBuilder,
    token_budget: usize,
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

    async fn scan_directory(&self, root: &Path) -> Result<HashMap<PathBuf, FileInfo>> {
        use tokio::fs;
        use walkdir::WalkDir;
        use ignore::WalkBuilder;
        
        let mut files = HashMap::new();
        
        // Use ignore crate to respect .gitignore and other ignore files
        let walker = WalkBuilder::new(root)
            .hidden(false) // Include hidden files like .github
            .git_ignore(true)
            .git_exclude(true)
            .git_global(true)
            .build();
        
        for entry in walker {
            let entry = entry.map_err(|e| format!("Walk error: {}", e))?;
            let path = entry.path();
            
            // Skip directories
            if !path.is_file() {
                continue;
            }
            
            // Skip very large files (>10MB) to avoid memory issues
            if let Ok(metadata) = entry.metadata() {
                if metadata.len() > 10 * 1024 * 1024 {
                    continue;
                }
            }
            
            // Detect language from file extension
            let language = self.detect_language_from_path(path)?;
            
            // Skip files we can't process
            if matches!(language, Language::Other(_)) {
                // Only process known code file extensions
                if let Some(ext) = path.extension().and_then(|s| s.to_str()) {
                    match ext {
                        "md" | "txt" | "json" | "toml" | "yaml" | "yml" | "xml" | "html" | "css" | "sql" => {
                            // Include common text files
                        }
                        _ => continue,
                    }
                }
            }
            
            // Get file metadata
            let metadata = fs::metadata(path).await
                .map_err(|e| format!("Failed to read metadata for {}: {}", path.display(), e))?;
            
            let last_modified = metadata.modified()
                .map_err(|e| format!("Failed to get modification time for {}: {}", path.display(), e))?
                .duration_since(std::time::UNIX_EPOCH)
                .map_err(|e| format!("Invalid modification time for {}: {}", path.display(), e))?;
            
            let last_modified = Instant::now() - Duration::from_secs(
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_secs() - last_modified.as_secs()
            );
            
            // Read file content to extract basic information
            let (symbols, imports) = match fs::read_to_string(path).await {
                Ok(content) => {
                    // Extract basic symbols and imports without full parsing
                    self.extract_basic_info(&content, &language).await
                }
                Err(_) => {
                    // Skip binary files or files we can't read
                    continue;
                }
            };
            
            let file_info = FileInfo {
                path: path.to_path_buf(),
                language,
                size: metadata.len() as usize,
                last_modified,
                symbols,
                imports,
            };
            
            files.insert(path.to_path_buf(), file_info);
        }
        
        Ok(files)
    }

    async fn extract_symbols(&self, files: &HashMap<PathBuf, FileInfo>) -> Result<HashMap<String, SymbolInfo>> {
        // Use Tree-sitter to extract symbols from each file
        todo!("Implement symbol extraction")
    }

    async fn analyze_dependencies(&self, files: &HashMap<PathBuf, FileInfo>) -> Result<HashMap<PathBuf, Vec<PathBuf>>> {
        // Analyze import statements and references
        todo!("Implement dependency analysis")
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
        format!("{:?} {} in {}", symbol.kind, symbol.name, symbol.file.display())
    }

    fn estimate_tokens(&self, text: &str) -> usize {
        // Rough approximation: 1 token per 4 characters
        text.len() / 4
    }
    
    fn detect_language_from_path(&self, path: &Path) -> Result<Language> {
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
    
    async fn extract_basic_info(&self, content: &str, language: &Language) -> (Vec<String>, Vec<String>) {
        let mut symbols = Vec::new();
        let mut imports = Vec::new();
        
        // Basic pattern matching for common symbols and imports
        // This is a simplified version - in practice would use Tree-sitter
        match language {
            Language::Rust => {
                for line in content.lines() {
                    let trimmed = line.trim();
                    
                    // Extract basic function definitions
                    if trimmed.starts_with("pub fn ") || trimmed.starts_with("fn ") {
                        if let Some(name) = self.extract_rust_function_name(trimmed) {
                            symbols.push(name);
                        }
                    }
                    
                    // Extract struct/enum definitions
                    if trimmed.starts_with("pub struct ") || trimmed.starts_with("struct ") {
                        if let Some(name) = self.extract_rust_type_name(trimmed, "struct") {
                            symbols.push(name);
                        }
                    }
                    if trimmed.starts_with("pub enum ") || trimmed.starts_with("enum ") {
                        if let Some(name) = self.extract_rust_type_name(trimmed, "enum") {
                            symbols.push(name);
                        }
                    }
                    
                    // Extract use statements
                    if trimmed.starts_with("use ") {
                        if let Some(import) = self.extract_rust_import(trimmed) {
                            imports.push(import);
                        }
                    }
                }
            }
            Language::Python => {
                for line in content.lines() {
                    let trimmed = line.trim();
                    
                    // Extract function definitions
                    if trimmed.starts_with("def ") {
                        if let Some(name) = self.extract_python_function_name(trimmed) {
                            symbols.push(name);
                        }
                    }
                    
                    // Extract class definitions
                    if trimmed.starts_with("class ") {
                        if let Some(name) = self.extract_python_class_name(trimmed) {
                            symbols.push(name);
                        }
                    }
                    
                    // Extract imports
                    if trimmed.starts_with("import ") || trimmed.starts_with("from ") {
                        imports.push(trimmed.to_string());
                    }
                }
            }
            Language::JavaScript | Language::TypeScript => {
                for line in content.lines() {
                    let trimmed = line.trim();
                    
                    // Extract function definitions
                    if trimmed.contains("function ") {
                        if let Some(name) = self.extract_js_function_name(trimmed) {
                            symbols.push(name);
                        }
                    }
                    
                    // Extract class definitions
                    if trimmed.starts_with("class ") {
                        if let Some(name) = self.extract_js_class_name(trimmed) {
                            symbols.push(name);
                        }
                    }
                    
                    // Extract imports
                    if trimmed.starts_with("import ") {
                        imports.push(trimmed.to_string());
                    }
                }
            }
            _ => {
                // For other languages, just extract simple patterns
                for line in content.lines() {
                    let trimmed = line.trim();
                    if trimmed.contains("function") || trimmed.contains("def") || trimmed.contains("class") {
                        // Extract any word that follows these keywords
                        let words: Vec<&str> = trimmed.split_whitespace().collect();
                        for (i, word) in words.iter().enumerate() {
                            if matches!(*word, "function" | "def" | "class") && i + 1 < words.len() {
                                let name = words[i + 1].trim_end_matches(['(', ':', '{', ';']);
                                if !name.is_empty() {
                                    symbols.push(name.to_string());
                                }
                                break;
                            }
                        }
                    }
                }
            }
        }
        
        (symbols, imports)
    }
    
    fn extract_rust_function_name(&self, line: &str) -> Option<String> {
        // Extract function name from "fn name(" or "pub fn name("
        let line = line.trim();
        if let Some(fn_pos) = line.find("fn ") {
            let after_fn = &line[fn_pos + 3..];
            if let Some(paren_pos) = after_fn.find('(') {
                let name = after_fn[..paren_pos].trim();
                if !name.is_empty() && name.chars().all(|c| c.is_alphanumeric() || c == '_') {
                    return Some(name.to_string());
                }
            }
        }
        None
    }
    
    fn extract_rust_type_name(&self, line: &str, keyword: &str) -> Option<String> {
        // Extract type name from "struct Name" or "enum Name"
        let line = line.trim();
        if let Some(pos) = line.find(&format!("{} ", keyword)) {
            let after_keyword = &line[pos + keyword.len() + 1..];
            let name = after_keyword.split_whitespace().next()?;
            let name = name.trim_end_matches(['{', '<', '(']);
            if !name.is_empty() && name.chars().next()?.is_alphabetic() {
                return Some(name.to_string());
            }
        }
        None
    }
    
    fn extract_rust_import(&self, line: &str) -> Option<String> {
        // Extract import from "use path::to::item;"
        let line = line.trim();
        if line.starts_with("use ") {
            let import = &line[4..];
            let import = import.trim_end_matches(';').trim();
            if !import.is_empty() {
                return Some(import.to_string());
            }
        }
        None
    }
    
    fn extract_python_function_name(&self, line: &str) -> Option<String> {
        // Extract function name from "def name("
        let line = line.trim();
        if line.starts_with("def ") {
            let after_def = &line[4..];
            if let Some(paren_pos) = after_def.find('(') {
                let name = after_def[..paren_pos].trim();
                if !name.is_empty() && name.chars().all(|c| c.is_alphanumeric() || c == '_') {
                    return Some(name.to_string());
                }
            }
        }
        None
    }
    
    fn extract_python_class_name(&self, line: &str) -> Option<String> {
        // Extract class name from "class Name:"
        let line = line.trim();
        if line.starts_with("class ") {
            let after_class = &line[6..];
            let name = after_class.split([':', '(', ' ']).next()?;
            if !name.is_empty() && name.chars().next()?.is_alphabetic() {
                return Some(name.to_string());
            }
        }
        None
    }
    
    fn extract_js_function_name(&self, line: &str) -> Option<String> {
        // Extract function name from various JS function declarations
        let line = line.trim();
        
        // "function name(" pattern
        if let Some(fn_pos) = line.find("function ") {
            let after_fn = &line[fn_pos + 9..];
            if let Some(paren_pos) = after_fn.find('(') {
                let name = after_fn[..paren_pos].trim();
                if !name.is_empty() && name.chars().all(|c| c.is_alphanumeric() || c == '_' || c == '$') {
                    return Some(name.to_string());
                }
            }
        }
        
        // "const name = function" or "const name = (" pattern
        if line.contains(" = function") || line.contains(" = (") {
            if let Some(equals_pos) = line.find(" = ") {
                let before_equals = &line[..equals_pos];
                if let Some(name) = before_equals.split_whitespace().last() {
                    if name.chars().all(|c| c.is_alphanumeric() || c == '_' || c == '$') {
                        return Some(name.to_string());
                    }
                }
            }
        }
        
        None
    }
    
    fn extract_js_class_name(&self, line: &str) -> Option<String> {
        // Extract class name from "class Name"
        let line = line.trim();
        if line.starts_with("class ") {
            let after_class = &line[6..];
            let name = after_class.split([' ', '{', '(']).next()?;
            if !name.is_empty() && name.chars().next()?.is_alphabetic() {
                return Some(name.to_string());
            }
        }
        None
    }
}

// ==================== Tree-sitter Integration ====================

pub struct CodeAnalyzer {
    parsers: Arc<RwLock<HashMap<Language, TreeSitterParser>>>,
    queries: Arc<RwLock<HashMap<Language, Vec<PatternQuery>>>>,
    cache: Arc<RwLock<ParseCache>>,
}

pub struct TreeSitterParser {
    // In practice, would wrap tree_sitter::Parser
    language: Language,
}

pub struct PatternQuery {
    name: String,
    pattern: String, // S-expression query
}

pub struct ParseCache {
    trees: HashMap<PathBuf, ParsedTree>,
    last_accessed: HashMap<PathBuf, Instant>,
    max_size: usize,
}

#[derive(Clone)]
pub struct ParsedTree {
    // In practice, would wrap tree_sitter::Tree
    content: String,
    language: Language,
    last_modified: Instant,
}

impl CodeAnalyzer {
    pub fn new() -> Self {
        Self {
            parsers: Arc::new(RwLock::new(HashMap::new())),
            queries: Arc::new(RwLock::new(HashMap::new())),
            cache: Arc::new(RwLock::new(ParseCache {
                trees: HashMap::new(),
                last_accessed: HashMap::new(),
                max_size: 100,
            })),
        }
    }

    pub async fn parse_file(&self, path: &Path, content: &str) -> Result<ParsedTree> {
        let language = self.detect_language(path)?;
        
        // Check cache first
        {
            let cache = self.cache.read().unwrap();
            if let Some(tree) = cache.trees.get(path) {
                return Ok(tree.clone());
            }
        }
        
        // Parse with Tree-sitter
        let tree = self.parse_with_tree_sitter(content, language).await?;
        
        // Update cache
        {
            let mut cache = self.cache.write().unwrap();
            cache.trees.insert(path.to_path_buf(), tree.clone());
            cache.last_accessed.insert(path.to_path_buf(), Instant::now());
            
            // Evict old entries if cache is full
            if cache.trees.len() > cache.max_size {
                self.evict_cache_entries(&mut cache);
            }
        }
        
        Ok(tree)
    }

    pub async fn query_pattern(&self, tree: &ParsedTree, pattern: &str) -> Result<Vec<QueryMatch>> {
        // Execute Tree-sitter query
        todo!("Implement Tree-sitter query execution")
    }

    pub async fn incremental_parse(&self, path: &Path, edits: &[TextEdit]) -> Result<ParsedTree> {
        // Use Tree-sitter's incremental parsing
        todo!("Implement incremental parsing")
    }

    fn detect_language(&self, path: &Path) -> Result<Language> {
        match path.extension().and_then(|s| s.to_str()) {
            Some("rs") => Ok(Language::Rust),
            Some("py") => Ok(Language::Python),
            Some("js") => Ok(Language::JavaScript),
            Some("ts") => Ok(Language::TypeScript),
            Some("go") => Ok(Language::Go),
            Some("java") => Ok(Language::Java),
            Some("cs") => Ok(Language::CSharp),
            Some(ext) => Ok(Language::Other(ext.to_string())),
            None => Err("Unknown file type".into()),
        }
    }

    async fn parse_with_tree_sitter(&self, content: &str, language: Language) -> Result<ParsedTree> {
        // In practice, would use actual tree_sitter parsing
        Ok(ParsedTree {
            content: content.to_string(),
            language,
            last_modified: Instant::now(),
        })
    }

    fn evict_cache_entries(&self, cache: &mut ParseCache) {
        // LRU eviction
        let mut entries: Vec<_> = cache.last_accessed.iter().map(|(k, v)| (k.clone(), *v)).collect();
        entries.sort_by_key(|(_, time)| *time);
        
        let to_remove = entries.len() - cache.max_size + 10; // Remove 10 extra
        for (path, _) in entries.into_iter().take(to_remove) {
            cache.trees.remove(&path);
            cache.last_accessed.remove(&path);
        }
    }
}

#[derive(Debug, Clone)]
pub struct QueryMatch {
    pub captures: Vec<Capture>,
    pub pattern_index: usize,
}

#[derive(Debug, Clone)]
pub struct Capture {
    pub name: String,
    pub node_text: String,
    pub range: TextRange,
}

// ==================== LSP Integration ====================

pub struct LspManager {
    servers: Arc<RwLock<HashMap<Language, LspClient>>>,
    symbol_cache: Arc<SymbolCache>,
    diagnostic_aggregator: DiagnosticAggregator,
}

pub struct LspClient {
    language: Language,
    // In practice, would use tower_lsp::Client
    sender: mpsc::Sender<LspRequest>,
}

pub struct SymbolCache {
    symbols: RwLock<HashMap<PathBuf, Vec<LspSymbol>>>,
    type_info: RwLock<HashMap<String, TypeInfo>>,
}

#[derive(Debug, Clone)]
pub struct LspSymbol {
    pub name: String,
    pub kind: lsp_types::SymbolKind,
    pub location: Location,
    pub container_name: Option<String>,
}

#[derive(Debug, Clone)]
pub struct Location {
    pub file: PathBuf,
    pub range: TextRange,
}

#[derive(Debug, Clone)]
pub struct TypeInfo {
    pub type_name: String,
    pub members: Vec<String>,
    pub methods: Vec<String>,
    pub implements: Vec<String>,
}

pub struct DiagnosticAggregator {
    diagnostics: Arc<RwLock<HashMap<PathBuf, Vec<Diagnostic>>>>,
}

#[derive(Debug, Clone)]
pub struct Diagnostic {
    pub severity: DiagnosticSeverity,
    pub message: String,
    pub range: TextRange,
    pub source: String,
}

#[derive(Debug, Clone, Copy)]
pub enum DiagnosticSeverity {
    Error,
    Warning,
    Information,
    Hint,
}

#[derive(Debug)]
pub enum LspRequest {
    Initialize,
    DocumentSymbols(PathBuf),
    Completion(PathBuf, Position),
    Hover(PathBuf, Position),
    Definition(PathBuf, Position),
    References(PathBuf, Position),
    Rename(PathBuf, Position, String),
}

impl LspManager {
    pub fn new() -> Self {
        Self {
            servers: Arc::new(RwLock::new(HashMap::new())),
            symbol_cache: Arc::new(SymbolCache {
                symbols: RwLock::new(HashMap::new()),
                type_info: RwLock::new(HashMap::new()),
            }),
            diagnostic_aggregator: DiagnosticAggregator {
                diagnostics: Arc::new(RwLock::new(HashMap::new())),
            },
        }
    }

    pub async fn connect_server(&self, language: Language) -> Result<()> {
        let (tx, mut rx) = mpsc::channel(100);
        
        // Spawn server handler
        tokio::spawn(async move {
            while let Some(request) = rx.recv().await {
                // Handle LSP requests
                match request {
                    LspRequest::DocumentSymbols(path) => {
                        // Query language server for symbols
                    }
                    // Handle other requests...
                    _ => {}
                }
            }
        });
        
        let client = LspClient {
            language: language.clone(),
            sender: tx,
        };
        
        self.servers.write().unwrap().insert(language, client);
        Ok(())
    }

    pub async fn get_symbols(&self, path: &Path) -> Result<Vec<LspSymbol>> {
        // Check cache first
        {
            let cache = self.symbol_cache.symbols.read().unwrap();
            if let Some(symbols) = cache.get(path) {
                return Ok(symbols.clone());
            }
        }
        
        // Query LSP server
        let language = self.detect_language(path)?;
        let sender = {
            let servers = self.servers.read().unwrap();
            servers.get(&language).map(|client| client.sender.clone())
        };
        
        if let Some(sender) = sender {
            sender.send(LspRequest::DocumentSymbols(path.to_path_buf())).await?;
            // In practice, would await response
        }
        
        Ok(Vec::new())
    }

    pub async fn get_diagnostics(&self, path: &Path) -> Result<Vec<Diagnostic>> {
        let diagnostics = self.diagnostic_aggregator.diagnostics.read().unwrap();
        Ok(diagnostics.get(path).cloned().unwrap_or_default())
    }

    pub async fn validate_edit(&self, edit: &FileEdit) -> Result<Vec<Diagnostic>> {
        // Apply edit temporarily and get diagnostics
        todo!("Implement edit validation")
    }

    fn detect_language(&self, path: &Path) -> Result<Language> {
        match path.extension().and_then(|s| s.to_str()) {
            Some("rs") => Ok(Language::Rust),
            Some("py") => Ok(Language::Python),
            Some("js") => Ok(Language::JavaScript),
            Some("ts") => Ok(Language::TypeScript),
            Some("go") => Ok(Language::Go),
            Some("java") => Ok(Language::Java),
            Some("cs") => Ok(Language::CSharp),
            Some(ext) => Ok(Language::Other(ext.to_string())),
            None => Err("Unknown file type".into()),
        }
    }
}

// ==================== AI Integration ====================

#[async_trait]
pub trait CodeAgent {
    async fn analyze_context(&self, request: ContextRequest) -> Result<CodeContext>;
    async fn generate_changes(&self, context: &CodeContext) -> Result<Vec<FileEdit>>;
    async fn apply_changes(&self, edits: Vec<FileEdit>) -> Result<ApplyResult>;
}

#[derive(Debug, Clone)]
pub struct ContextRequest {
    pub query: String,
    pub files: Vec<PathBuf>,
    pub include_symbols: bool,
    pub include_diagnostics: bool,
    pub max_tokens: usize,
}

#[derive(Debug, Clone)]
pub struct CodeContext {
    pub repository_map: String,
    pub relevant_files: Vec<FileContent>,
    pub symbols: Vec<SymbolInfo>,
    pub diagnostics: Vec<Diagnostic>,
    pub project_context: ProjectContext,
}

#[derive(Debug, Clone)]
pub struct FileContent {
    pub path: PathBuf,
    pub content: String,
    pub language: Language,
}

#[derive(Debug, Clone)]
pub struct ApplyResult {
    pub succeeded: Vec<PathBuf>,
    pub failed: Vec<(PathBuf, String)>,
    pub rollback_available: bool,
}

pub struct RustCodeAgent {
    context_manager: Arc<ContextManager>,
    analyzer: Arc<CodeAnalyzer>,
    lsp_manager: Arc<LspManager>,
    repository_mapper: Arc<RepositoryMapper>,
    ai_provider: Box<dyn AiProvider + Send + Sync>,
    edit_validator: EditValidator,
}

#[async_trait]
impl CodeAgent for RustCodeAgent {
    async fn analyze_context(&self, request: ContextRequest) -> Result<CodeContext> {
        // Build repository map
        let repo_map = self.repository_mapper.build_map(Path::new(".")).await?;
        let compressed_map = self.repository_mapper.compress_for_context(&repo_map, &request.query);
        
        // Add to context manager
        self.context_manager.add_layer(ContextLayer {
            name: "Repository Map".to_string(),
            priority: 1,
            content: Arc::from(compressed_map.clone()),
            token_count: compressed_map.len() / 4,
            compressible: true,
        })?;
        
        // Gather relevant files
        let relevant_files = self.find_relevant_files(&request, &repo_map).await?;
        
        // Get symbols if requested
        let symbols = if request.include_symbols {
            self.gather_symbols(&relevant_files).await?
        } else {
            Vec::new()
        };
        
        // Get diagnostics if requested
        let diagnostics = if request.include_diagnostics {
            self.gather_diagnostics(&relevant_files).await?
        } else {
            Vec::new()
        };
        
        // Load project context
        let project_context = self.load_project_context().await?;
        
        Ok(CodeContext {
            repository_map: compressed_map,
            relevant_files,
            symbols,
            diagnostics,
            project_context,
        })
    }

    async fn generate_changes(&self, context: &CodeContext) -> Result<Vec<FileEdit>> {
        // Format context for AI
        let prompt = self.format_prompt(context)?;
        
        // Add to context manager
        self.context_manager.add_layer(ContextLayer {
            name: "Current Context".to_string(),
            priority: 2,
            content: Arc::from(prompt.clone()),
            token_count: prompt.len() / 4,
            compressible: false,
        })?;
        
        // Check context usage
        let usage = self.context_manager.get_usage_percentage();
        if usage > 90.0 {
            self.context_manager.compact()?;
        }
        
        // Generate changes with AI
        let response = self.ai_provider.generate(&prompt).await?;
        
        // Parse response into edits
        let edits = self.parse_ai_response(&response)?;
        
        // Validate edits
        for edit in &edits {
            self.edit_validator.validate(edit).await?;
        }
        
        Ok(edits)
    }

    async fn apply_changes(&self, edits: Vec<FileEdit>) -> Result<ApplyResult> {
        let mut succeeded = Vec::new();
        let mut failed = Vec::new();
        
        // Create backup for rollback
        let backup = self.create_backup(&edits).await?;
        
        for edit in edits {
            match self.apply_single_edit(&edit).await {
                Ok(_) => {
                    // Verify with LSP
                    let diagnostics = self.lsp_manager.validate_edit(&edit).await?;
                    if diagnostics.iter().any(|d| matches!(d.severity, DiagnosticSeverity::Error)) {
                        // Rollback this edit
                        self.rollback_edit(&edit, &backup).await?;
                        failed.push((edit.path, "Validation failed".to_string()));
                    } else {
                        succeeded.push(edit.path);
                    }
                }
                Err(e) => {
                    failed.push((edit.path, e.to_string()));
                }
            }
        }
        
        Ok(ApplyResult {
            succeeded,
            failed,
            rollback_available: true,
        })
    }
}

impl RustCodeAgent {
    pub fn new(
        ai_provider: Box<dyn AiProvider + Send + Sync>,
        window_size: usize,
    ) -> Self {
        let analyzer = Arc::new(CodeAnalyzer::new());
        let context_manager = Arc::new(ContextManager::new(window_size));
        let lsp_manager = Arc::new(LspManager::new());
        let repository_mapper = Arc::new(RepositoryMapper::new(analyzer.clone(), 1024));
        
        Self {
            context_manager,
            analyzer,
            lsp_manager,
            repository_mapper,
            ai_provider,
            edit_validator: EditValidator::new(),
        }
    }

    async fn find_relevant_files(&self, request: &ContextRequest, repo_map: &RepositoryMap) -> Result<Vec<FileContent>> {
        // Implementation would use repository map to find relevant files
        todo!("Implement file relevance scoring")
    }

    async fn gather_symbols(&self, files: &[FileContent]) -> Result<Vec<SymbolInfo>> {
        let mut symbols = Vec::new();
        
        for file in files {
            let file_symbols = self.lsp_manager.get_symbols(&file.path).await?;
            // Convert LSP symbols to our format
            for lsp_symbol in file_symbols {
                symbols.push(SymbolInfo {
                    name: lsp_symbol.name,
                    kind: self.convert_symbol_kind(lsp_symbol.kind),
                    file: file.path.clone(),
                    range: lsp_symbol.location.range,
                    references: Vec::new(),
                    relevance_score: 0.0,
                });
            }
        }
        
        Ok(symbols)
    }

    async fn gather_diagnostics(&self, files: &[FileContent]) -> Result<Vec<Diagnostic>> {
        let mut diagnostics = Vec::new();
        
        for file in files {
            let file_diagnostics = self.lsp_manager.get_diagnostics(&file.path).await?;
            diagnostics.extend(file_diagnostics);
        }
        
        Ok(diagnostics)
    }

    async fn load_project_context(&self) -> Result<ProjectContext> {
        // Look for CLAUDE.md files
        let claude_md_files = self.find_claude_md_files().await?;
        
        // Parse conventions and decisions
        let mut conventions = Vec::new();
        let mut decisions = Vec::new();
        
        for (path, content) in &claude_md_files {
            // Simple parsing - in practice would be more sophisticated
            if content.contains("# Conventions") {
                conventions.push(content.clone());
            }
            if content.contains("# Architecture") {
                decisions.push(content.clone());
            }
        }
        
        Ok(ProjectContext {
            claude_md_files,
            coding_conventions: conventions,
            architectural_decisions: decisions,
            active_features: Vec::new(),
        })
    }

    async fn find_claude_md_files(&self) -> Result<HashMap<PathBuf, String>> {
        // Walk directory tree looking for CLAUDE.md files
        todo!("Implement CLAUDE.md discovery")
    }

    fn format_prompt(&self, context: &CodeContext) -> Result<String> {
        // Format context into prompt following Aider's approach
        let mut prompt = String::new();
        
        // Add repository map
        prompt.push_str("Repository structure:\n");
        prompt.push_str(&context.repository_map);
        prompt.push_str("\n\n");
        
        // Add file contents
        prompt.push_str("Relevant files:\n");
        for file in &context.relevant_files {
            prompt.push_str(&format!("=== {} ===\n", file.path.display()));
            prompt.push_str(&file.content);
            prompt.push_str("\n\n");
        }
        
        // Add diagnostics
        if !context.diagnostics.is_empty() {
            prompt.push_str("Current issues:\n");
            for diagnostic in &context.diagnostics {
                prompt.push_str(&format!("- {:?}: {}\n", diagnostic.severity, diagnostic.message));
            }
            prompt.push_str("\n");
        }
        
        // Add instructions
        prompt.push_str("Instructions: Use SEARCH/REPLACE blocks for all changes.\n");
        prompt.push_str("Format:\n");
        prompt.push_str("<<<<<<< SEARCH\n");
        prompt.push_str("old code\n");
        prompt.push_str("=======\n");
        prompt.push_str("new code\n");
        prompt.push_str(">>>>>>> REPLACE\n");
        
        Ok(prompt)
    }

    fn parse_ai_response(&self, _response: &str) -> Result<Vec<FileEdit>> {
        // Parse SEARCH/REPLACE blocks from AI response
        todo!("Implement response parsing")
    }

    async fn apply_single_edit(&self, edit: &FileEdit) -> Result<()> {
        // Apply edit to file
        todo!("Implement file editing")
    }

    async fn create_backup(&self, edits: &[FileEdit]) -> Result<HashMap<PathBuf, String>> {
        // Create backup of files to be edited
        todo!("Implement backup creation")
    }

    async fn rollback_edit(&self, edit: &FileEdit, backup: &HashMap<PathBuf, String>) -> Result<()> {
        // Restore from backup
        todo!("Implement rollback")
    }

    fn convert_symbol_kind(&self, lsp_kind: lsp_types::SymbolKind) -> SymbolKind {
        use lsp_types::SymbolKind as Lsp;
        match lsp_kind {
            Lsp::FUNCTION | Lsp::METHOD => SymbolKind::Function,
            Lsp::CLASS => SymbolKind::Class,
            Lsp::INTERFACE => SymbolKind::Interface,
            Lsp::ENUM => SymbolKind::Enum,
            Lsp::CONSTANT => SymbolKind::Constant,
            Lsp::VARIABLE => SymbolKind::Variable,
            _ => SymbolKind::Type,
        }
    }
}

// ==================== Supporting Components ====================

#[async_trait]
pub trait AiProvider {
    async fn generate(&self, prompt: &str) -> Result<String>;
    async fn stream_generate(&self, prompt: &str) -> Result<mpsc::Receiver<String>>;
}

pub trait TextSummarizer: Send + Sync {
    fn summarize<'a>(&self, text: &'a str) -> futures::future::BoxFuture<'a, Result<String>>;
}

pub struct DefaultSummarizer;

impl TextSummarizer for DefaultSummarizer {
    fn summarize<'a>(&self, text: &'a str) -> futures::future::BoxFuture<'a, Result<String>> {
        Box::pin(async move {
            // Simple summarization - take first and last parts
            let lines: Vec<&str> = text.lines().collect();
            let summary = if lines.len() > 10 {
                format!("{}\n...\n{}", 
                    lines[..5].join("\n"),
                    lines[lines.len()-5..].join("\n")
                )
            } else {
                text.to_string()
            };
            Ok(summary)
        })
    }
}

pub struct ContextVisualizer {
    bar_width: usize,
}

impl ContextVisualizer {
    pub fn new() -> Self {
        Self { bar_width: 50 }
    }

    pub fn render(&self, window: &ContextWindow) -> String {
        let usage = window.used_tokens.load(Ordering::Relaxed);
        let percentage = (usage as f32 / window.total_tokens as f32 * 100.0) as u32;
        let filled = (self.bar_width as f32 * (percentage as f32 / 100.0)) as usize;
        
        let mut visualization = String::new();
        visualization.push_str(&format!("Context Usage: {}% ({}/{})\n", percentage, usage, window.total_tokens));
        visualization.push('[');
        visualization.push_str(&"█".repeat(filled));
        visualization.push_str(&"░".repeat(self.bar_width - filled));
        visualization.push(']');
        visualization.push('\n');
        
        // Show layers
        visualization.push_str("\nLayers:\n");
        for layer in &window.layers {
            visualization.push_str(&format!("  {} ({}): {} tokens\n", 
                layer.name, layer.priority, layer.token_count));
        }
        
        visualization
    }
}

pub struct EditValidator {
    syntax_validator: SyntaxValidator,
    semantic_validator: SemanticValidator,
}

impl EditValidator {
    pub fn new() -> Self {
        Self {
            syntax_validator: SyntaxValidator::new(),
            semantic_validator: SemanticValidator::new(),
        }
    }

    pub async fn validate(&self, edit: &FileEdit) -> Result<()> {
        // Validate syntax
        self.syntax_validator.validate(edit)?;
        
        // Validate semantics
        self.semantic_validator.validate(edit).await?;
        
        Ok(())
    }
}

pub struct SyntaxValidator;

impl SyntaxValidator {
    pub fn new() -> Self {
        Self
    }

    pub fn validate(&self, _edit: &FileEdit) -> Result<()> {
        // Use Tree-sitter to validate syntax
        todo!("Implement syntax validation")
    }
}

pub struct SemanticValidator;

impl SemanticValidator {
    pub fn new() -> Self {
        Self
    }

    pub async fn validate(&self, edit: &FileEdit) -> Result<()> {
        // Use LSP to validate semantics
        todo!("Implement semantic validation")
    }
}

pub struct GraphBuilder;

impl GraphBuilder {
    pub fn new() -> Self {
        Self
    }

    pub fn build(&self, _symbols: &HashMap<String, SymbolInfo>, _dependencies: &HashMap<PathBuf, Vec<PathBuf>>) -> Result<RelevanceGraph> {
        // Build relevance graph from symbols and dependencies
        todo!("Implement graph building")
    }
}

// ==================== Plugin System ====================

#[async_trait]
pub trait Plugin: Send + Sync {
    fn name(&self) -> &str;
    fn version(&self) -> &str;
    async fn initialize(&mut self, context: PluginContext) -> Result<()>;
    async fn on_file_change(&mut self, path: &Path) -> Result<()>;
    async fn on_edit_request(&mut self, edit: &FileEdit) -> Result<Option<FileEdit>>;
}

#[derive(Clone)]
pub struct PluginContext {
    pub analyzer: Arc<CodeAnalyzer>,
    pub lsp_manager: Arc<LspManager>,
    pub context_manager: Arc<ContextManager>,
}

pub struct PluginManager {
    plugins: Vec<Box<dyn Plugin>>,
    context: PluginContext,
}

impl PluginManager {
    pub fn new(context: PluginContext) -> Self {
        Self {
            plugins: Vec::new(),
            context,
        }
    }

    pub async fn load_plugin(&mut self, mut plugin: Box<dyn Plugin>) -> Result<()> {
        plugin.initialize(self.context.clone()).await?;
        self.plugins.push(plugin);
        Ok(())
    }

    pub async fn notify_file_change(&mut self, path: &Path) -> Result<()> {
        for plugin in &mut self.plugins {
            plugin.on_file_change(path).await?;
        }
        Ok(())
    }

    pub async fn process_edit(&mut self, edit: &FileEdit) -> Result<FileEdit> {
        let mut current_edit = edit.clone();
        
        for plugin in &mut self.plugins {
            if let Some(modified) = plugin.on_edit_request(&current_edit).await? {
                current_edit = modified;
            }
        }
        
        Ok(current_edit)
    }
}

// ==================== Main Entry Point ====================

pub struct CodeAgentBuilder {
    window_size: usize,
    ai_provider: Option<Box<dyn AiProvider + Send + Sync>>,
    plugins: Vec<Box<dyn Plugin>>,
}

impl CodeAgentBuilder {
    pub fn new() -> Self {
        Self {
            window_size: 100_000, // Default 100k tokens
            ai_provider: None,
            plugins: Vec::new(),
        }
    }

    pub fn window_size(mut self, size: usize) -> Self {
        self.window_size = size;
        self
    }

    pub fn ai_provider(mut self, provider: Box<dyn AiProvider + Send + Sync>) -> Self {
        self.ai_provider = Some(provider);
        self
    }

    pub fn plugin(mut self, plugin: Box<dyn Plugin>) -> Self {
        self.plugins.push(plugin);
        self
    }

    pub async fn build(self) -> Result<RustCodeAgent> {
        let ai_provider = self.ai_provider.ok_or("AI provider required")?;
        let agent = RustCodeAgent::new(ai_provider, self.window_size);
        
        // Initialize plugin manager
        let plugin_context = PluginContext {
            analyzer: agent.analyzer.clone(),
            lsp_manager: agent.lsp_manager.clone(),
            context_manager: agent.context_manager.clone(),
        };
        
        let mut plugin_manager = PluginManager::new(plugin_context);
        for plugin in self.plugins {
            plugin_manager.load_plugin(plugin).await?;
        }
        
        Ok(agent)
    }
}

// ==================== Example Usage ====================

#[cfg(test)]
mod tests {
    use super::*;

    struct MockAiProvider;

    #[async_trait]
    impl AiProvider for MockAiProvider {
        async fn generate(&self, prompt: &str) -> Result<String> {
            Ok(format!("Generated response for: {}", prompt))
        }

        async fn stream_generate(&self, prompt: &str) -> Result<mpsc::Receiver<String>> {
            let (tx, rx) = mpsc::channel(10);
            let prompt = prompt.to_string();
            
            tokio::spawn(async move {
                for word in prompt.split_whitespace() {
                    let _ = tx.send(word.to_string()).await;
                    tokio::time::sleep(Duration::from_millis(100)).await;
                }
            });
            
            Ok(rx)
        }
    }

    #[tokio::test]
    async fn test_scan_directory() {
        let analyzer = Arc::new(CodeAnalyzer::new());
        let repository_mapper = RepositoryMapper::new(analyzer, 1024);
        
        // Test scanning the current project directory
        let result = repository_mapper.scan_directory(Path::new(".")).await;
        assert!(result.is_ok());
        
        let files = result.unwrap();
        assert!(!files.is_empty());
        
        // Should find at least our Rust source files
        let rust_files: Vec<_> = files.values()
            .filter(|f| matches!(f.language, Language::Rust))
            .collect();
        assert!(!rust_files.is_empty());
        
        // Print summary for debugging
        println!("Found {} files, {} Rust files", files.len(), rust_files.len());
        
        // Should find Rust files (check by filename ending, not exact path)
        let lib_rs = files.iter()
            .find(|(path, _)| path.file_name().and_then(|n| n.to_str()) == Some("lib.rs"));
        assert!(lib_rs.is_some());
        
        let main_rs = files.iter()
            .find(|(path, _)| path.file_name().and_then(|n| n.to_str()) == Some("main.rs"));
        assert!(main_rs.is_some());
        
        // Verify file info structure
        if let Some((_, lib_info)) = lib_rs {
            assert_eq!(lib_info.language, Language::Rust);
            assert!(lib_info.size > 0);
            assert!(!lib_info.symbols.is_empty()); // Should extract some symbols
            println!("lib.rs has {} symbols and {} imports", lib_info.symbols.len(), lib_info.imports.len());
        }
    }

    #[test]
    fn test_context_visualization() {
        let context_manager = ContextManager::new(10_000);
        
        context_manager.add_layer(ContextLayer {
            name: "Repository Map".to_string(),
            priority: 1,
            content: Arc::from("test content"),
            token_count: 1000,
            compressible: true,
        }).unwrap();

        let visualization = context_manager.visualize();
        assert!(visualization.contains("Context Usage: 10%"));
        assert!(visualization.contains("Repository Map"));
    }
}