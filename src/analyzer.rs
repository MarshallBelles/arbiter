use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};
use std::time::Instant;

use crate::{Language, Result};

// Tree-sitter imports
use tree_sitter::{Parser, Query, QueryCursor};

#[derive(Debug, Clone)]
pub struct QueryMatch {
    pub captures: Vec<Capture>,
}

#[derive(Debug, Clone)]
pub struct Capture {
    pub name: String,
    pub node_text: String,
    pub range: crate::TextRange,
}

pub struct CodeAnalyzer {
    parsers: Arc<RwLock<HashMap<Language, TreeSitterParser>>>,
    queries: Arc<RwLock<HashMap<Language, Vec<PatternQuery>>>>,
    cache: Arc<RwLock<ParseCache>>,
}

pub struct TreeSitterParser {
    parser: Parser,
    language: Language,
}

#[derive(Clone)]
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
    pub content: String,
    pub language: Language,
    last_modified: Instant,
}

impl CodeAnalyzer {
    pub fn new() -> Self {
        let mut analyzer = Self {
            parsers: Arc::new(RwLock::new(HashMap::new())),
            queries: Arc::new(RwLock::new(HashMap::new())),
            cache: Arc::new(RwLock::new(ParseCache {
                trees: HashMap::new(),
                last_accessed: HashMap::new(),
                max_size: 100,
            })),
        };
        
        // Initialize common queries
        analyzer.init_common_queries();
        
        analyzer
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
            
            // Evict old entries if needed
            if cache.trees.len() > cache.max_size {
                self.evict_cache_entries(&mut cache);
            }
        }
        
        Ok(tree)
    }

    pub async fn query_pattern(&self, tree: &ParsedTree, pattern: &str) -> Result<Vec<QueryMatch>> {
        // Initialize parser for the language if not exists
        self.init_parser_for_language(tree.language.clone()).await?;
        
        // Create a new parser (Tree-sitter parsers can't be cloned)
        let tree_sitter_language = self.get_tree_sitter_language(tree.language.clone())?;
        let mut parser = Parser::new();
        parser.set_language(tree_sitter_language)
            .map_err(|e| format!("Failed to set language: {}", e))?;
        
        // Parse the content
        let tree_sitter_tree = parser.parse(&tree.content, None)
            .ok_or("Failed to parse content")?;
        
        // Create and run query
        let language = self.get_tree_sitter_language(tree.language.clone())?;
        let query = Query::new(language, pattern)
            .map_err(|e| format!("Query error: {}", e))?;
        
        let mut cursor = QueryCursor::new();
        let matches = cursor.matches(&query, tree_sitter_tree.root_node(), tree.content.as_bytes());
        
        let mut result = Vec::new();
        for m in matches {
            let mut captures = Vec::new();
            for capture in m.captures {
                let node = capture.node;
                let text = node.utf8_text(tree.content.as_bytes())
                    .unwrap_or("<invalid>")
                    .to_string();
                
                captures.push(Capture {
                    name: query.capture_names()[capture.index as usize].clone(),
                    node_text: text,
                    range: crate::TextRange {
                        start: crate::Position {
                            line: node.start_position().row,
                            column: node.start_position().column,
                        },
                        end: crate::Position {
                            line: node.end_position().row,
                            column: node.end_position().column,
                        },
                    },
                });
            }
            result.push(QueryMatch { captures });
        }
        
        Ok(result)
    }

    pub async fn parse_with_tree_sitter(&self, content: &str, language: Language) -> Result<ParsedTree> {
        // Initialize parser for the language if not exists
        self.init_parser_for_language(language.clone()).await?;
        
        // Create a new parser (Tree-sitter parsers can't be cloned)
        let tree_sitter_language = self.get_tree_sitter_language(language.clone())?;
        let mut parser = Parser::new();
        parser.set_language(tree_sitter_language)
            .map_err(|e| format!("Failed to set language: {}", e))?;
        
        // Parse the content with Tree-sitter
        let _tree = parser.parse(content, None)
            .ok_or("Failed to parse content with Tree-sitter")?;
        
        Ok(ParsedTree {
            content: content.to_string(),
            language,
            last_modified: Instant::now(),
        })
    }

    pub async fn incremental_parse(&self, path: &Path, _edits: &[crate::TextEdit]) -> Result<ParsedTree> {
        // Use Tree-sitter's incremental parsing
        // For now, just re-parse the whole file
        let content = tokio::fs::read_to_string(path).await?;
        self.parse_file(path, &content).await
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

    async fn init_parser_for_language(&self, language: Language) -> Result<()> {
        // Check if parser already exists
        {
            let parsers = self.parsers.read().unwrap();
            if parsers.contains_key(&language) {
                return Ok(());
            }
        }
        
        // Create new parser
        let mut parser = Parser::new();
        let tree_sitter_language = self.get_tree_sitter_language(language.clone())?;
        parser.set_language(tree_sitter_language)
            .map_err(|e| format!("Failed to set language: {}", e))?;
        
        // Store parser
        let ts_parser = TreeSitterParser {
            parser,
            language: language.clone(),
        };
        
        let mut parsers = self.parsers.write().unwrap();
        parsers.insert(language, ts_parser);
        
        Ok(())
    }

    fn get_tree_sitter_language(&self, language: Language) -> Result<tree_sitter::Language> {
        match language {
            Language::Rust => Ok(tree_sitter_rust::language()),
            Language::Python => Ok(tree_sitter_python::language()),
            Language::JavaScript => Ok(tree_sitter_javascript::language()),
            Language::TypeScript => Ok(tree_sitter_typescript::language_typescript()),
            Language::Go => Ok(tree_sitter_go::language()),
            Language::Java => Ok(tree_sitter_java::language()),
            Language::CSharp => Ok(tree_sitter_c_sharp::language()),
            Language::Other(_) => Err("Unsupported language for Tree-sitter".into()),
        }
    }

    fn init_common_queries(&mut self) {
        let mut queries = self.queries.write().unwrap();
        
        // Rust queries
        queries.insert(Language::Rust, vec![
            PatternQuery {
                name: "functions".to_string(),
                pattern: "(function_item name: (identifier) @function)".to_string(),
            },
            PatternQuery {
                name: "structs".to_string(),
                pattern: "(struct_item name: (type_identifier) @struct)".to_string(),
            },
            PatternQuery {
                name: "use_declarations".to_string(),
                pattern: "(use_declaration) @import".to_string(),
            },
        ]);
        
        // Python queries
        queries.insert(Language::Python, vec![
            PatternQuery {
                name: "functions".to_string(),
                pattern: "(function_definition name: (identifier) @function)".to_string(),
            },
            PatternQuery {
                name: "classes".to_string(),
                pattern: "(class_definition name: (identifier) @class)".to_string(),
            },
            PatternQuery {
                name: "imports".to_string(),
                pattern: "(import_statement name: (dotted_name) @import)".to_string(),
            },
        ]);
        
        // JavaScript/TypeScript queries
        let js_queries = vec![
            PatternQuery {
                name: "functions".to_string(),
                pattern: "(function_declaration name: (identifier) @function)".to_string(),
            },
            PatternQuery {
                name: "classes".to_string(),
                pattern: "(class_declaration name: (identifier) @class)".to_string(),
            },
            PatternQuery {
                name: "imports".to_string(),
                pattern: "(import_statement source: (string) @import)".to_string(),
            },
        ];
        queries.insert(Language::JavaScript, js_queries.clone());
        queries.insert(Language::TypeScript, js_queries);
        
        // Go queries
        queries.insert(Language::Go, vec![
            PatternQuery {
                name: "functions".to_string(),
                pattern: "(function_declaration name: (identifier) @function)".to_string(),
            },
            PatternQuery {
                name: "types".to_string(),
                pattern: "(type_declaration (type_spec name: (type_identifier) @type))".to_string(),
            },
            PatternQuery {
                name: "imports".to_string(),
                pattern: "(import_spec path: (interpreted_string_literal) @import)".to_string(),
            },
        ]);
        
        // Java queries
        queries.insert(Language::Java, vec![
            PatternQuery {
                name: "methods".to_string(),
                pattern: "(method_declaration name: (identifier) @method)".to_string(),
            },
            PatternQuery {
                name: "classes".to_string(),
                pattern: "(class_declaration name: (identifier) @class)".to_string(),
            },
            PatternQuery {
                name: "imports".to_string(),
                pattern: "(import_declaration (scoped_identifier) @import)".to_string(),
            },
        ]);
        
        // C# queries
        queries.insert(Language::CSharp, vec![
            PatternQuery {
                name: "methods".to_string(),
                pattern: "(method_declaration name: (identifier) @method)".to_string(),
            },
            PatternQuery {
                name: "classes".to_string(),
                pattern: "(class_declaration name: (identifier) @class)".to_string(),
            },
            PatternQuery {
                name: "usings".to_string(),
                pattern: "(using_directive name: (qualified_name) @import)".to_string(),
            },
        ]);
    }
}