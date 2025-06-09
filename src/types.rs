use std::collections::HashMap;
use std::path::PathBuf;
use std::time::Instant;
use async_trait::async_trait;
use tokio::sync::mpsc;

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
    pub search: String,
    pub replace: String,
    pub edit_type: EditType,
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
    pub column: usize,
}

impl From<tree_sitter::Range> for TextRange {
    fn from(range: tree_sitter::Range) -> Self {
        Self {
            start: Position {
                line: range.start_point.row,
                column: range.start_point.column,
            },
            end: Position {
                line: range.end_point.row,
                column: range.end_point.column,
            },
        }
    }
}

impl From<tree_sitter::Point> for Position {
    fn from(point: tree_sitter::Point) -> Self {
        Self {
            line: point.row,
            column: point.column,
        }
    }
}

#[derive(Debug, Clone)]
pub enum EditType {
    Replace,
    Insert,
    Append,
    SearchReplace { search_pattern: String },
    WholeFile,
    UnifiedDiff,
    LineRange,
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
    pub nodes: HashMap<String, RelevanceNode>,
    pub edges: Vec<(String, String, f32)>, // (from, to, weight)
}

#[derive(Debug, Clone)]
pub struct RelevanceNode {
    pub identifier: String,
    pub access_count: usize,
    pub last_accessed: Instant,
    pub importance: f32,
}

// ==================== AI Provider Interface ====================

#[async_trait]
pub trait AiProvider: Send + Sync {
    async fn generate(&self, prompt: &str) -> Result<String>;
    async fn stream_generate(&self, prompt: &str) -> Result<mpsc::Receiver<String>>;
}

// ==================== Context Types ====================

#[derive(Debug)]
pub struct ContextRequest {
    pub query: String,
    pub files: Vec<PathBuf>,
    pub include_symbols: bool,
    pub include_diagnostics: bool,
    pub max_tokens: usize,
}

#[derive(Debug)]
pub struct ContextResponse {
    pub repository_map: String,
    pub relevant_files: Vec<FileContent>,
    pub symbols: Vec<SymbolInfo>,
    pub diagnostics: Vec<Diagnostic>,
    pub token_usage: TokenUsage,
}

#[derive(Debug)]
pub struct FileContent {
    pub path: PathBuf,
    pub language: Language,
    pub content: String,
    pub symbols: Vec<SymbolInfo>,
}

#[derive(Debug)]
pub struct Diagnostic {
    pub file: PathBuf,
    pub range: TextRange,
    pub message: String,
    pub severity: DiagnosticSeverity,
}

#[derive(Debug)]
pub enum DiagnosticSeverity {
    Error,
    Warning,
    Info,
    Hint,
}

#[derive(Debug)]
pub struct TokenUsage {
    pub used: usize,
    pub total: usize,
    pub percentage: f32,
}

// ==================== Code Agent Interface ====================

#[async_trait]
pub trait CodeAgent: Send + Sync {
    async fn analyze_context(&self, request: ContextRequest) -> Result<ContextResponse>;
    async fn generate_changes(&self, context: &ContextResponse) -> Result<Vec<FileEdit>>;
    async fn apply_changes(&self, edits: Vec<FileEdit>) -> Result<ApplyResult>;
}

#[derive(Debug)]
pub struct ApplyResult {
    pub succeeded: Vec<PathBuf>,
    pub failed: HashMap<PathBuf, String>,
}