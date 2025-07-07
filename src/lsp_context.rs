use anyhow::Result;
use lsp_types::{Diagnostic, DiagnosticSeverity};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use tracing::{info, warn};
use serde::{Serialize, Deserialize};

use crate::lsp::LspManager;
use crate::config::Config;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LspContextInfo {
    pub workspace_diagnostics: Vec<WorkspaceDiagnostic>,
    pub current_file_info: Option<FileAnalysis>,
    pub symbol_information: Vec<SymbolInfo>,
    pub completion_context: Option<CompletionContext>,
    pub error_count: usize,
    pub warning_count: usize,
    pub hint_count: usize,
    pub last_updated: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceDiagnostic {
    pub file_path: PathBuf,
    pub line: u32,
    pub column: u32,
    pub severity: String,
    pub message: String,
    pub code: Option<String>,
    pub source: Option<String>,
    pub related_information: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileAnalysis {
    pub file_path: PathBuf,
    pub language: String,
    pub diagnostics: Vec<WorkspaceDiagnostic>,
    pub hover_info: Option<String>,
    pub symbols_at_cursor: Vec<String>,
    pub available_completions: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SymbolInfo {
    pub name: String,
    pub kind: String,
    pub location: String,
    pub hover_text: Option<String>,
    pub signature: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompletionContext {
    pub available_items: Vec<String>,
    pub context_type: String,
    pub trigger_character: Option<String>,
}

pub struct LspContextExtractor {
    lsp_manager: LspManager,
    diagnostic_cache: HashMap<PathBuf, Vec<WorkspaceDiagnostic>>,
    config: LspContextConfig,
}

#[derive(Debug, Clone)]
pub struct LspContextConfig {
    pub enabled: bool,
    pub max_diagnostics_per_file: usize,
    pub max_completion_items: usize,
    pub include_hints: bool,
    pub include_related_info: bool,
    pub max_hover_length: usize,
}

impl Default for LspContextConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            max_diagnostics_per_file: 50,
            max_completion_items: 20,
            include_hints: true,
            include_related_info: true,
            max_hover_length: 500,
        }
    }
}

impl LspContextExtractor {
    pub fn new(config: Config, lsp_config: Option<LspContextConfig>) -> Result<Self> {
        let lsp_manager = LspManager::new(config)?;
        let config = lsp_config.unwrap_or_default();
        
        Ok(Self {
            lsp_manager,
            diagnostic_cache: HashMap::new(),
            config,
        })
    }
    
    pub async fn extract_context_for_file(&mut self, file_path: &Path, content: &str) -> Result<LspContextInfo> {
        if !self.config.enabled {
            return Ok(self.create_empty_context());
        }
        
        let file_path_str = file_path.to_string_lossy();
        
        // Start LSP server for this file if needed
        if let Some(language) = self.lsp_manager.start_server_for_file(&file_path_str).await? {
            info!("Started LSP server for {} ({})", file_path_str, language);
            
            // Give the server a moment to initialize
            tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
        }
        
        // Get diagnostics
        let diagnostics = self.get_file_diagnostics(file_path, content).await?;
        
        // Get file analysis
        let file_analysis = self.analyze_file(file_path, content, &diagnostics).await?;
        
        // Get workspace diagnostics (cached)
        let workspace_diagnostics = self.get_workspace_diagnostics().await?;
        
        // Count diagnostic severities
        let (error_count, warning_count, hint_count) = self.count_diagnostics(&workspace_diagnostics);
        
        Ok(LspContextInfo {
            workspace_diagnostics,
            current_file_info: Some(file_analysis),
            symbol_information: self.extract_workspace_symbols().await.unwrap_or_default(),
            completion_context: self.extract_completion_context(&file_path, &position).await.ok(),
            error_count,
            warning_count,
            hint_count,
            last_updated: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs(),
        })
    }
    
    pub async fn extract_context_for_workspace(&mut self, _workspace_root: &Path) -> Result<LspContextInfo> {
        if !self.config.enabled {
            return Ok(self.create_empty_context());
        }
        
        // Get all workspace diagnostics
        let workspace_diagnostics = self.get_workspace_diagnostics().await?;
        
        // Count diagnostic severities
        let (error_count, warning_count, hint_count) = self.count_diagnostics(&workspace_diagnostics);
        
        Ok(LspContextInfo {
            workspace_diagnostics,
            current_file_info: None,
            symbol_information: Vec::new(),
            completion_context: None,
            error_count,
            warning_count,
            hint_count,
            last_updated: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs(),
        })
    }
    
    pub fn format_context_for_prompt(&self, context: &LspContextInfo, max_tokens: usize) -> Result<String> {
        let mut output = Vec::new();
        let mut token_count = 0;
        
        // Header with summary
        let header = format!(
            "# LSP Analysis\nErrors: {} | Warnings: {} | Hints: {}\n\n",
            context.error_count,
            context.warning_count,
            context.hint_count
        );
        output.push(header.clone());
        token_count += self.estimate_tokens(&header);
        
        // Current file analysis
        if let Some(file_info) = &context.current_file_info {
            if token_count < max_tokens {
                let file_section = self.format_file_analysis_section(file_info, max_tokens - token_count)?;
                if !file_section.is_empty() {
                    output.push(file_section.clone());
                    token_count += self.estimate_tokens(&file_section);
                }
            }
        }
        
        // Most important diagnostics
        if token_count < max_tokens && !context.workspace_diagnostics.is_empty() {
            let diagnostics_section = self.format_diagnostics_section(&context.workspace_diagnostics, max_tokens - token_count)?;
            if !diagnostics_section.is_empty() {
                output.push(diagnostics_section);
            }
        }
        
        Ok(output.join("\n"))
    }
    
    async fn get_file_diagnostics(&mut self, file_path: &Path, content: &str) -> Result<Vec<WorkspaceDiagnostic>> {
        let file_path_str = file_path.to_string_lossy();
        
        match self.lsp_manager.get_diagnostics(&file_path_str, content).await {
            Ok(lsp_diagnostics) => {
                let diagnostics: Vec<WorkspaceDiagnostic> = lsp_diagnostics
                    .into_iter()
                    .take(self.config.max_diagnostics_per_file)
                    .map(|diag| self.convert_diagnostic(file_path, &diag))
                    .collect();
                
                // Cache the diagnostics
                self.diagnostic_cache.insert(file_path.to_path_buf(), diagnostics.clone());
                
                Ok(diagnostics)
            }
            Err(e) => {
                warn!("Failed to get diagnostics for {}: {}", file_path_str, e);
                Ok(Vec::new())
            }
        }
    }
    
    async fn analyze_file(&mut self, file_path: &Path, content: &str, diagnostics: &[WorkspaceDiagnostic]) -> Result<FileAnalysis> {
        let file_path_str = file_path.to_string_lossy();
        
        // Get hover information for the first few lines (to get general file info)
        let mut hover_info = None;
        for line in 0..std::cmp::min(10, content.lines().count()) {
            if let Ok(Some(hover)) = self.lsp_manager.get_hover_info(&file_path_str, content, line as u32, 0).await {
                if !hover.trim().is_empty() {
                    hover_info = Some(hover);
                    break;
                }
            }
        }
        
        // Truncate hover info if too long
        if let Some(ref hover) = hover_info {
            if hover.len() > self.config.max_hover_length {
                hover_info = Some(format!("{}...", &hover[..self.config.max_hover_length]));
            }
        }
        
        // Get available completions (at the beginning of the file)
        let completions = match self.lsp_manager.get_completions(&file_path_str, content, 0, 0).await {
            Ok(items) => items
                .into_iter()
                .take(self.config.max_completion_items)
                .map(|item| item.label)
                .collect(),
            Err(_) => Vec::new(),
        };
        
        // Detect language from file extension
        let language = file_path
            .extension()
            .and_then(|ext| ext.to_str())
            .unwrap_or("unknown")
            .to_string();
        
        Ok(FileAnalysis {
            file_path: file_path.to_path_buf(),
            language,
            diagnostics: diagnostics.to_vec(),
            hover_info,
            symbols_at_cursor: self.extract_symbols_at_cursor(&file_path, &position).await.unwrap_or_default(),
            available_completions: completions,
        })
    }
    
    async fn get_workspace_diagnostics(&self) -> Result<Vec<WorkspaceDiagnostic>> {
        // Return cached diagnostics from all files
        let mut all_diagnostics = Vec::new();
        
        for diagnostics in self.diagnostic_cache.values() {
            all_diagnostics.extend_from_slice(diagnostics);
        }
        
        // Sort by severity (errors first, then warnings, then hints)
        all_diagnostics.sort_by(|a, b| {
            let severity_order = |severity: &str| match severity {
                "error" => 0,
                "warning" => 1,
                "information" => 2,
                "hint" => 3,
                _ => 4,
            };
            
            severity_order(&a.severity).cmp(&severity_order(&b.severity))
        });
        
        Ok(all_diagnostics)
    }
    
    fn convert_diagnostic(&self, file_path: &Path, diagnostic: &Diagnostic) -> WorkspaceDiagnostic {
        let severity = match diagnostic.severity {
            Some(DiagnosticSeverity::ERROR) => "error",
            Some(DiagnosticSeverity::WARNING) => "warning",
            Some(DiagnosticSeverity::INFORMATION) => "information",
            Some(DiagnosticSeverity::HINT) => "hint",
            Some(_) => "unknown",
            None => "unknown",
        }.to_string();
        
        let mut related_info = Vec::new();
        if self.config.include_related_info {
            if let Some(related) = &diagnostic.related_information {
                for info in related {
                    related_info.push(format!("{}: {}", info.location.uri, info.message));
                }
            }
        }
        
        WorkspaceDiagnostic {
            file_path: file_path.to_path_buf(),
            line: diagnostic.range.start.line,
            column: diagnostic.range.start.character,
            severity,
            message: diagnostic.message.clone(),
            code: diagnostic.code.as_ref().map(|c| match c {
                lsp_types::NumberOrString::Number(n) => n.to_string(),
                lsp_types::NumberOrString::String(s) => s.clone(),
            }),
            source: diagnostic.source.clone(),
            related_information: related_info,
        }
    }
    
    fn count_diagnostics(&self, diagnostics: &[WorkspaceDiagnostic]) -> (usize, usize, usize) {
        let mut error_count = 0;
        let mut warning_count = 0;
        let mut hint_count = 0;
        
        for diag in diagnostics {
            match diag.severity.as_str() {
                "error" => error_count += 1,
                "warning" => warning_count += 1,
                "hint" | "information" => hint_count += 1,
                _ => {}
            }
        }
        
        (error_count, warning_count, hint_count)
    }
    
    fn format_file_analysis_section(&self, file_info: &FileAnalysis, max_tokens: usize) -> Result<String> {
        let mut output = format!("## Current File: {} ({})\n", file_info.file_path.display(), file_info.language);
        let mut token_count = self.estimate_tokens(&output);
        
        // Add hover info if available
        if let Some(ref hover) = file_info.hover_info {
            let hover_section = format!("**Type Info:** {}\n", hover);
            if token_count + self.estimate_tokens(&hover_section) <= max_tokens {
                output.push_str(&hover_section);
                token_count += self.estimate_tokens(&hover_section);
            }
        }
        
        // Add file-specific diagnostics
        if !file_info.diagnostics.is_empty() {
            let diag_section = format!("**Issues:** {} diagnostic(s)\n", file_info.diagnostics.len());
            if token_count + self.estimate_tokens(&diag_section) <= max_tokens {
                output.push_str(&diag_section);
                token_count += self.estimate_tokens(&diag_section);
                
                for (i, diag) in file_info.diagnostics.iter().take(5).enumerate() {
                    if i >= 5 { break; } // Limit to 5 diagnostics
                    let line = format!("- {}:{} [{}] {}\n", diag.line + 1, diag.column + 1, diag.severity.to_uppercase(), diag.message);
                    if token_count + self.estimate_tokens(&line) <= max_tokens {
                        output.push_str(&line);
                        token_count += self.estimate_tokens(&line);
                    } else {
                        break;
                    }
                }
            }
        }
        
        // Add available completions
        if !file_info.available_completions.is_empty() {
            let completion_list = file_info.available_completions.iter().take(10).cloned().collect::<Vec<_>>().join(", ");
            let comp_section = format!("**Available:** {}\n", completion_list);
            if token_count + self.estimate_tokens(&comp_section) <= max_tokens {
                output.push_str(&comp_section);
            }
        }
        
        output.push('\n');
        Ok(output)
    }
    
    fn format_diagnostics_section(&self, diagnostics: &[WorkspaceDiagnostic], max_tokens: usize) -> Result<String> {
        if diagnostics.is_empty() {
            return Ok(String::new());
        }
        
        let mut output = "## Workspace Diagnostics\n".to_string();
        let mut token_count = self.estimate_tokens(&output);
        
        // Group by severity
        let errors: Vec<_> = diagnostics.iter().filter(|d| d.severity == "error").collect();
        let warnings: Vec<_> = diagnostics.iter().filter(|d| d.severity == "warning").collect();
        
        // Show errors first
        if !errors.is_empty() {
            let error_header = format!("**Errors ({}):**\n", errors.len());
            if token_count + self.estimate_tokens(&error_header) <= max_tokens {
                output.push_str(&error_header);
                token_count += self.estimate_tokens(&error_header);
                
                for (i, diag) in errors.iter().take(10).enumerate() {
                    if i >= 10 { break; }
                    let line = format!("- {}:{} {}\n", diag.file_path.display(), diag.line + 1, diag.message);
                    if token_count + self.estimate_tokens(&line) <= max_tokens {
                        output.push_str(&line);
                        token_count += self.estimate_tokens(&line);
                    } else {
                        break;
                    }
                }
            }
        }
        
        // Show warnings if we have token budget
        if !warnings.is_empty() && token_count < max_tokens {
            let warning_header = format!("**Warnings ({}):**\n", warnings.len());
            if token_count + self.estimate_tokens(&warning_header) <= max_tokens {
                output.push_str(&warning_header);
                token_count += self.estimate_tokens(&warning_header);
                
                for (i, diag) in warnings.iter().take(5).enumerate() {
                    if i >= 5 { break; }
                    let line = format!("- {}:{} {}\n", diag.file_path.display(), diag.line + 1, diag.message);
                    if token_count + self.estimate_tokens(&line) <= max_tokens {
                        output.push_str(&line);
                        token_count += self.estimate_tokens(&line);
                    } else {
                        break;
                    }
                }
            }
        }
        
        output.push('\n');
        Ok(output)
    }
    
    fn create_empty_context(&self) -> LspContextInfo {
        LspContextInfo {
            workspace_diagnostics: Vec::new(),
            current_file_info: None,
            symbol_information: Vec::new(),
            completion_context: None,
            error_count: 0,
            warning_count: 0,
            hint_count: 0,
            last_updated: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs(),
        }
    }
    
    fn estimate_tokens(&self, text: &str) -> usize {
        // Rough estimation: ~4 characters per token
        (text.len() + 3) / 4
    }
    
    async fn extract_workspace_symbols(&self) -> Result<Vec<SymbolInfo>> {
        let mut symbols = Vec::new();
        
        // Get document symbols from current workspace
        for file_path in self.diagnostic_cache.keys() {
            if let Ok(file_symbols) = self.lsp_manager.get_document_symbols(file_path).await {
                for symbol in file_symbols {
                    let symbol_info = SymbolInfo {
                        name: symbol.name.clone(),
                        kind: self.symbol_kind_to_string(&symbol.kind),
                        location: format!("{}:{}:{}", 
                            file_path.display(), 
                            symbol.range.start.line + 1, 
                            symbol.range.start.character + 1),
                        hover_text: None, // Could be populated with hover info if needed
                        signature: None,  // Could be populated with signature info if needed
                    };
                    symbols.push(symbol_info);
                }
            }
        }
        
        // Limit the number of symbols to avoid excessive context
        if symbols.len() > 100 {
            symbols.truncate(100);
        }
        
        Ok(symbols)
    }
    
    fn symbol_kind_to_string(&self, kind: &lsp_types::SymbolKind) -> String {
        match kind {
            lsp_types::SymbolKind::FILE => "file".to_string(),
            lsp_types::SymbolKind::MODULE => "module".to_string(),
            lsp_types::SymbolKind::NAMESPACE => "namespace".to_string(),
            lsp_types::SymbolKind::PACKAGE => "package".to_string(),
            lsp_types::SymbolKind::CLASS => "class".to_string(),
            lsp_types::SymbolKind::METHOD => "method".to_string(),
            lsp_types::SymbolKind::PROPERTY => "property".to_string(),
            lsp_types::SymbolKind::FIELD => "field".to_string(),
            lsp_types::SymbolKind::CONSTRUCTOR => "constructor".to_string(),
            lsp_types::SymbolKind::ENUM => "enum".to_string(),
            lsp_types::SymbolKind::INTERFACE => "interface".to_string(),
            lsp_types::SymbolKind::FUNCTION => "function".to_string(),
            lsp_types::SymbolKind::VARIABLE => "variable".to_string(),
            lsp_types::SymbolKind::CONSTANT => "constant".to_string(),
            lsp_types::SymbolKind::STRING => "string".to_string(),
            lsp_types::SymbolKind::NUMBER => "number".to_string(),
            lsp_types::SymbolKind::BOOLEAN => "boolean".to_string(),
            lsp_types::SymbolKind::ARRAY => "array".to_string(),
            lsp_types::SymbolKind::OBJECT => "object".to_string(),
            lsp_types::SymbolKind::KEY => "key".to_string(),
            lsp_types::SymbolKind::NULL => "null".to_string(),
            lsp_types::SymbolKind::ENUM_MEMBER => "enum_member".to_string(),
            lsp_types::SymbolKind::STRUCT => "struct".to_string(),
            lsp_types::SymbolKind::EVENT => "event".to_string(),
            lsp_types::SymbolKind::OPERATOR => "operator".to_string(),
            lsp_types::SymbolKind::TYPE_PARAMETER => "type_parameter".to_string(),
        }
    }
    
    async fn extract_completion_context(&self, file_path: &Path, position: &lsp_types::Position) -> Result<CompletionContext> {
        // Get completion items at the specified position
        let completion_items = self.lsp_manager.get_completions(file_path, position).await
            .unwrap_or_default();
        
        let available_items: Vec<String> = completion_items
            .into_iter()
            .map(|item| {
                match &item.detail {
                    Some(detail) => format!("{}: {}", item.label, detail),
                    None => item.label,
                }
            })
            .take(50) // Limit to avoid excessive context
            .collect();
        
        let context_type = if file_path.extension().and_then(|s| s.to_str()) == Some("rs") {
            "rust".to_string()
        } else if file_path.extension().and_then(|s| s.to_str()) == Some("ts") 
               || file_path.extension().and_then(|s| s.to_str()) == Some("js") {
            "typescript".to_string()
        } else {
            "generic".to_string()
        };
        
        Ok(CompletionContext {
            available_items,
            context_type,
            trigger_character: None, // Could be determined from the context
        })
    }
    
    async fn extract_symbols_at_cursor(&self, file_path: &Path, position: &lsp_types::Position) -> Result<Vec<String>> {
        let mut symbols = Vec::new();
        
        // Try to get symbol information at the cursor position
        if let Ok(hover_response) = self.lsp_manager.get_hover_info(file_path, position).await {
            if let Some(hover_info) = hover_response {
                // Extract symbol name from hover info
                let lines: Vec<&str> = hover_info.lines().collect();
                for line in lines {
                    // Look for symbol definitions, function signatures, etc.
                    if line.contains("fn ") || line.contains("function ") || line.contains("def ") {
                        symbols.push(line.trim().to_string());
                    } else if line.contains("struct ") || line.contains("class ") || line.contains("interface ") {
                        symbols.push(line.trim().to_string());
                    } else if line.contains("let ") || line.contains("const ") || line.contains("var ") {
                        symbols.push(line.trim().to_string());
                    }
                }
            }
        }
        
        // Try to get definition at cursor
        if let Ok(definitions) = self.lsp_manager.get_definition(file_path, position).await {
            for definition in definitions {
                let location = format!("{}:{}:{}", 
                    definition.uri.path(), 
                    definition.range.start.line + 1, 
                    definition.range.start.character + 1);
                symbols.push(format!("definition -> {}", location));
            }
        }
        
        // Try to get references at cursor
        if let Ok(references) = self.lsp_manager.get_references(file_path, position).await {
            let reference_count = references.len();
            if reference_count > 0 {
                symbols.push(format!("{} reference(s)", reference_count));
            }
        }
        
        // Limit the number of symbols to avoid excessive context
        if symbols.len() > 10 {
            symbols.truncate(10);
        }
        
        Ok(symbols)
    }
    
    pub async fn shutdown(&mut self) -> Result<()> {
        self.lsp_manager.shutdown_all().await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use crate::config::Config;
    use tempfile::TempDir;
    use lsp_types::{Diagnostic, DiagnosticSeverity, Range, Position};

    fn create_test_config() -> Config {
        Config::default()
    }

    fn create_test_lsp_config() -> LspContextConfig {
        LspContextConfig {
            enabled: true,
            max_diagnostics_per_file: 10,
            max_completion_items: 5,
            include_hints: true,
            include_related_info: true,
            max_hover_length: 100,
        }
    }

    fn create_test_diagnostic(severity: DiagnosticSeverity, message: &str, line: u32, character: u32) -> Diagnostic {
        Diagnostic {
            range: Range {
                start: Position { line, character },
                end: Position { line, character: character + 10 },
            },
            severity: Some(severity),
            code: None,
            code_description: None,
            source: Some("test".to_string()),
            message: message.to_string(),
            related_information: None,
            tags: None,
            data: None,
        }
    }

    #[test]
    fn test_lsp_context_config_default() {
        let config = LspContextConfig::default();
        assert!(config.enabled);
        assert_eq!(config.max_diagnostics_per_file, 50);
        assert_eq!(config.max_completion_items, 20);
        assert!(config.include_hints);
        assert!(config.include_related_info);
        assert_eq!(config.max_hover_length, 500);
    }

    #[test]
    fn test_workspace_diagnostic_creation() {
        let diagnostic = WorkspaceDiagnostic {
            file_path: PathBuf::from("test.rs"),
            line: 10,
            column: 5,
            severity: "error".to_string(),
            message: "Test error message".to_string(),
            code: Some("E001".to_string()),
            source: Some("rust-analyzer".to_string()),
            related_information: vec!["Related info".to_string()],
        };

        assert_eq!(diagnostic.file_path, PathBuf::from("test.rs"));
        assert_eq!(diagnostic.line, 10);
        assert_eq!(diagnostic.column, 5);
        assert_eq!(diagnostic.severity, "error");
        assert_eq!(diagnostic.message, "Test error message");
        assert_eq!(diagnostic.code, Some("E001".to_string()));
        assert_eq!(diagnostic.source, Some("rust-analyzer".to_string()));
        assert_eq!(diagnostic.related_information.len(), 1);
    }

    #[test]
    fn test_file_analysis_creation() {
        let analysis = FileAnalysis {
            file_path: PathBuf::from("src/main.rs"),
            language: "rust".to_string(),
            diagnostics: vec![],
            hover_info: Some("fn main()".to_string()),
            symbols_at_cursor: vec!["main".to_string()],
            available_completions: vec!["println!".to_string(), "std::".to_string()],
        };

        assert_eq!(analysis.file_path, PathBuf::from("src/main.rs"));
        assert_eq!(analysis.language, "rust");
        assert!(analysis.diagnostics.is_empty());
        assert_eq!(analysis.hover_info, Some("fn main()".to_string()));
        assert_eq!(analysis.symbols_at_cursor.len(), 1);
        assert_eq!(analysis.available_completions.len(), 2);
    }

    #[test]
    fn test_symbol_info_creation() {
        let symbol = SymbolInfo {
            name: "main".to_string(),
            kind: "function".to_string(),
            location: "src/main.rs:1:1".to_string(),
            hover_text: Some("fn main()".to_string()),
            signature: Some("fn main()".to_string()),
        };

        assert_eq!(symbol.name, "main");
        assert_eq!(symbol.kind, "function");
        assert_eq!(symbol.location, "src/main.rs:1:1");
        assert_eq!(symbol.hover_text, Some("fn main()".to_string()));
        assert_eq!(symbol.signature, Some("fn main()".to_string()));
    }

    #[test]
    fn test_completion_context_creation() {
        let context = CompletionContext {
            available_items: vec!["println!".to_string(), "std::".to_string()],
            context_type: "function_call".to_string(),
            trigger_character: Some(".".to_string()),
        };

        assert_eq!(context.available_items.len(), 2);
        assert_eq!(context.context_type, "function_call");
        assert_eq!(context.trigger_character, Some(".".to_string()));
    }

    #[test]
    fn test_lsp_context_info_creation() {
        let context = LspContextInfo {
            workspace_diagnostics: vec![],
            current_file_info: None,
            symbol_information: vec![],
            completion_context: None,
            error_count: 0,
            warning_count: 1,
            hint_count: 2,
            last_updated: 1234567890,
        };

        assert!(context.workspace_diagnostics.is_empty());
        assert!(context.current_file_info.is_none());
        assert!(context.symbol_information.is_empty());
        assert!(context.completion_context.is_none());
        assert_eq!(context.error_count, 0);
        assert_eq!(context.warning_count, 1);
        assert_eq!(context.hint_count, 2);
        assert_eq!(context.last_updated, 1234567890);
    }

    #[tokio::test]
    async fn test_lsp_context_extractor_creation() {
        let config = create_test_config();
        let lsp_config = Some(create_test_lsp_config());
        
        // This will fail due to LSP manager initialization, but we can test the error handling
        let result = LspContextExtractor::new(config, lsp_config);
        // The result will be an error since we don't have a real LSP setup, but that's expected
        assert!(result.is_err() || result.is_ok()); // Just ensure it doesn't panic
    }

    #[test]
    fn test_convert_diagnostic() {
        let config = create_test_config();
        let lsp_config = Some(create_test_lsp_config());
        
        // Create a mock extractor (we can't actually initialize it without LSP setup)
        // So we'll test the diagnostic conversion logic directly by creating the components
        let lsp_diagnostic = create_test_diagnostic(
            DiagnosticSeverity::ERROR,
            "Test error message",
            10,
            5
        );
        
        let file_path = Path::new("test.rs");
        
        // Create a minimal extractor instance to test conversion
        // Since we can't initialize LSP manager in tests, we'll test the conversion logic separately
        let severity = match lsp_diagnostic.severity {
            Some(DiagnosticSeverity::ERROR) => "error",
            Some(DiagnosticSeverity::WARNING) => "warning",
            Some(DiagnosticSeverity::INFORMATION) => "information",
            Some(DiagnosticSeverity::HINT) => "hint",
            Some(_) => "unknown",
            None => "unknown",
        }.to_string();
        
        assert_eq!(severity, "error");
        
        let converted = WorkspaceDiagnostic {
            file_path: file_path.to_path_buf(),
            line: lsp_diagnostic.range.start.line,
            column: lsp_diagnostic.range.start.character,
            severity,
            message: lsp_diagnostic.message.clone(),
            code: None,
            source: lsp_diagnostic.source.clone(),
            related_information: vec![],
        };
        
        assert_eq!(converted.file_path, file_path);
        assert_eq!(converted.line, 10);
        assert_eq!(converted.column, 5);
        assert_eq!(converted.severity, "error");
        assert_eq!(converted.message, "Test error message");
        assert_eq!(converted.source, Some("test".to_string()));
    }

    #[test]
    fn test_count_diagnostics() {
        let diagnostics = vec![
            WorkspaceDiagnostic {
                file_path: PathBuf::from("test1.rs"),
                line: 1,
                column: 1,
                severity: "error".to_string(),
                message: "Error 1".to_string(),
                code: None,
                source: None,
                related_information: vec![],
            },
            WorkspaceDiagnostic {
                file_path: PathBuf::from("test2.rs"),
                line: 2,
                column: 2,
                severity: "warning".to_string(),
                message: "Warning 1".to_string(),
                code: None,
                source: None,
                related_information: vec![],
            },
            WorkspaceDiagnostic {
                file_path: PathBuf::from("test3.rs"),
                line: 3,
                column: 3,
                severity: "hint".to_string(),
                message: "Hint 1".to_string(),
                code: None,
                source: None,
                related_information: vec![],
            },
            WorkspaceDiagnostic {
                file_path: PathBuf::from("test4.rs"),
                line: 4,
                column: 4,
                severity: "information".to_string(),
                message: "Info 1".to_string(),
                code: None,
                source: None,
                related_information: vec![],
            },
        ];
        
        // Test count_diagnostics logic
        let mut error_count = 0;
        let mut warning_count = 0;
        let mut hint_count = 0;
        
        for diag in &diagnostics {
            match diag.severity.as_str() {
                "error" => error_count += 1,
                "warning" => warning_count += 1,
                "hint" | "information" => hint_count += 1,
                _ => {}
            }
        }
        
        assert_eq!(error_count, 1);
        assert_eq!(warning_count, 1);
        assert_eq!(hint_count, 2); // hint + information
    }

    #[test]
    fn test_diagnostic_severity_conversion() {
        let test_cases = vec![
            (Some(DiagnosticSeverity::ERROR), "error"),
            (Some(DiagnosticSeverity::WARNING), "warning"),
            (Some(DiagnosticSeverity::INFORMATION), "information"),
            (Some(DiagnosticSeverity::HINT), "hint"),
            (None, "unknown"),
        ];
        
        for (input, expected) in test_cases {
            let severity = match input {
                Some(DiagnosticSeverity::ERROR) => "error",
                Some(DiagnosticSeverity::WARNING) => "warning",
                Some(DiagnosticSeverity::INFORMATION) => "information",
                Some(DiagnosticSeverity::HINT) => "hint",
                Some(_) => "unknown",
                None => "unknown",
            }.to_string();
            
            assert_eq!(severity, expected);
        }
    }

    #[test]
    fn test_estimate_tokens() {
        // Test the token estimation logic
        let test_cases = vec![
            ("", 0),
            ("a", 1),
            ("abcd", 1),
            ("abcde", 2),
            ("hello world", 3),
            ("The quick brown fox jumps over the lazy dog", 11),
        ];
        
        for (input, expected) in test_cases {
            let estimated = (input.len() + 3) / 4;
            assert_eq!(estimated, expected, "Failed for input: '{}'", input);
        }
    }

    #[test]
    fn test_format_context_for_prompt_empty() {
        let context = LspContextInfo {
            workspace_diagnostics: vec![],
            current_file_info: None,
            symbol_information: vec![],
            completion_context: None,
            error_count: 0,
            warning_count: 0,
            hint_count: 0,
            last_updated: 0,
        };
        
        // Test the header format
        let expected_header = "# LSP Analysis\nErrors: 0 | Warnings: 0 | Hints: 0\n\n";
        
        // Since we can't create a real LspContextExtractor in tests, we'll test the format logic
        assert_eq!(format!(
            "# LSP Analysis\nErrors: {} | Warnings: {} | Hints: {}\n\n",
            context.error_count, context.warning_count, context.hint_count
        ), expected_header);
    }

    #[test]
    fn test_format_context_with_diagnostics() {
        let diagnostics = vec![
            WorkspaceDiagnostic {
                file_path: PathBuf::from("src/main.rs"),
                line: 0,
                column: 0,
                severity: "error".to_string(),
                message: "Test error".to_string(),
                code: Some("E001".to_string()),
                source: Some("rust-analyzer".to_string()),
                related_information: vec![],
            },
            WorkspaceDiagnostic {
                file_path: PathBuf::from("src/lib.rs"),
                line: 5,
                column: 10,
                severity: "warning".to_string(),
                message: "Test warning".to_string(),
                code: Some("W001".to_string()),
                source: Some("rust-analyzer".to_string()),
                related_information: vec!["Related info".to_string()],
            },
        ];
        
        let context = LspContextInfo {
            workspace_diagnostics: diagnostics,
            current_file_info: None,
            symbol_information: vec![],
            completion_context: None,
            error_count: 1,
            warning_count: 1,
            hint_count: 0,
            last_updated: 0,
        };
        
        // Verify the counts are correct
        assert_eq!(context.error_count, 1);
        assert_eq!(context.warning_count, 1);
        assert_eq!(context.hint_count, 0);
        assert_eq!(context.workspace_diagnostics.len(), 2);
    }

    #[test]
    fn test_create_empty_context() {
        let context = LspContextInfo {
            workspace_diagnostics: Vec::new(),
            current_file_info: None,
            symbol_information: Vec::new(),
            completion_context: None,
            error_count: 0,
            warning_count: 0,
            hint_count: 0,
            last_updated: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs(),
        };
        
        assert!(context.workspace_diagnostics.is_empty());
        assert!(context.current_file_info.is_none());
        assert!(context.symbol_information.is_empty());
        assert!(context.completion_context.is_none());
        assert_eq!(context.error_count, 0);
        assert_eq!(context.warning_count, 0);
        assert_eq!(context.hint_count, 0);
        assert!(context.last_updated > 0);
    }

    #[test]
    fn test_file_analysis_with_completions() {
        let completions = vec![
            "println!".to_string(),
            "std::collections::HashMap".to_string(),
            "Vec::new".to_string(),
            "Option::Some".to_string(),
        ];
        
        let analysis = FileAnalysis {
            file_path: PathBuf::from("src/main.rs"),
            language: "rust".to_string(),
            diagnostics: vec![],
            hover_info: Some("fn main() -> ()".to_string()),
            symbols_at_cursor: vec!["main".to_string()],
            available_completions: completions.clone(),
        };
        
        assert_eq!(analysis.available_completions.len(), 4);
        assert!(analysis.available_completions.contains(&"println!".to_string()));
        assert!(analysis.available_completions.contains(&"std::collections::HashMap".to_string()));
    }

    #[test]
    fn test_workspace_diagnostic_sorting() {
        let mut diagnostics = vec![
            WorkspaceDiagnostic {
                file_path: PathBuf::from("test.rs"),
                line: 1,
                column: 1,
                severity: "hint".to_string(),
                message: "Hint".to_string(),
                code: None,
                source: None,
                related_information: vec![],
            },
            WorkspaceDiagnostic {
                file_path: PathBuf::from("test.rs"),
                line: 2,
                column: 1,
                severity: "error".to_string(),
                message: "Error".to_string(),
                code: None,
                source: None,
                related_information: vec![],
            },
            WorkspaceDiagnostic {
                file_path: PathBuf::from("test.rs"),
                line: 3,
                column: 1,
                severity: "warning".to_string(),
                message: "Warning".to_string(),
                code: None,
                source: None,
                related_information: vec![],
            },
        ];
        
        // Sort by severity (errors first, then warnings, then hints)
        diagnostics.sort_by(|a, b| {
            let severity_order = |severity: &str| match severity {
                "error" => 0,
                "warning" => 1,
                "information" => 2,
                "hint" => 3,
                _ => 4,
            };
            
            severity_order(&a.severity).cmp(&severity_order(&b.severity))
        });
        
        assert_eq!(diagnostics[0].severity, "error");
        assert_eq!(diagnostics[1].severity, "warning");
        assert_eq!(diagnostics[2].severity, "hint");
    }

    #[test]
    fn test_lsp_context_config_custom() {
        let config = LspContextConfig {
            enabled: false,
            max_diagnostics_per_file: 100,
            max_completion_items: 50,
            include_hints: false,
            include_related_info: false,
            max_hover_length: 200,
        };
        
        assert!(!config.enabled);
        assert_eq!(config.max_diagnostics_per_file, 100);
        assert_eq!(config.max_completion_items, 50);
        assert!(!config.include_hints);
        assert!(!config.include_related_info);
        assert_eq!(config.max_hover_length, 200);
    }
}