use anyhow::{Result, Context};
use lsp_types::*;
use lsp_types::request::Request as LspRequest;
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::mpsc;
use tracing::{debug, error, info, warn};

use crate::config::{Config, LspServerConfig};
use crate::tree_sitter_support::TreeSitterManager;

pub struct LspManager {
    servers: HashMap<String, LspServer>,
    config: Config,
    tree_sitter: TreeSitterManager,
}

impl LspManager {
    pub fn new(config: Config) -> Result<Self> {
        Ok(Self {
            servers: HashMap::new(),
            config,
            tree_sitter: TreeSitterManager::new()?,
        })
    }
    
    pub async fn start_server_for_file(&mut self, file_path: &str) -> Result<Option<String>> {
        if let Some(language) = self.tree_sitter.detect_language(file_path) {
            if !self.servers.contains_key(&language) {
                if let Some(server_config) = self.config.lsp_servers.iter()
                    .find(|s| s.language == language) {
                    
                    info!("Starting LSP server for {}: {}", language, server_config.command);
                    
                    match LspServer::start(server_config.clone()).await {
                        Ok(server) => {
                            self.servers.insert(language.clone(), server);
                            return Ok(Some(language));
                        }
                        Err(e) => {
                            warn!("Failed to start LSP server for {}: {}", language, e);
                            return Ok(None);
                        }
                    }
                }
            }
            Ok(Some(language))
        } else {
            Ok(None)
        }
    }
    
    pub async fn get_completions(&mut self, file_path: &str, content: &str, line: u32, character: u32) -> Result<Vec<CompletionItem>> {
        if let Some(language) = self.tree_sitter.detect_language(file_path) {
            if let Some(server) = self.servers.get_mut(&language) {
                return server.get_completions(file_path, content, line, character).await;
            }
        }
        Ok(Vec::new())
    }
    
    pub async fn get_hover_info(&mut self, file_path: &str, content: &str, line: u32, character: u32) -> Result<Option<String>> {
        if let Some(language) = self.tree_sitter.detect_language(file_path) {
            if let Some(server) = self.servers.get_mut(&language) {
                return server.get_hover_info(file_path, content, line, character).await;
            }
        }
        Ok(None)
    }
    
    pub async fn get_diagnostics(&mut self, file_path: &str, content: &str) -> Result<Vec<Diagnostic>> {
        if let Some(language) = self.tree_sitter.detect_language(file_path) {
            if let Some(server) = self.servers.get_mut(&language) {
                return server.get_diagnostics(file_path, content).await;
            }
        }
        Ok(Vec::new())
    }
    
    pub async fn shutdown_all(&mut self) -> Result<()> {
        for (language, mut server) in self.servers.drain() {
            info!("Shutting down LSP server for {}", language);
            if let Err(e) = server.shutdown().await {
                warn!("Error shutting down LSP server for {}: {}", language, e);
            }
        }
        Ok(())
    }
}

struct LspServer {
    process: Child,
    request_id: u64,
    sender: mpsc::UnboundedSender<String>,
    receiver: mpsc::UnboundedReceiver<String>,
    initialized: bool,
}

impl LspServer {
    async fn start(config: LspServerConfig) -> Result<Self> {
        let mut cmd = Command::new(&config.command);
        cmd.args(&config.args);
        cmd.stdin(Stdio::piped());
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());
        
        let mut process = cmd.spawn()
            .context(format!("Failed to start LSP server: {}", config.command))?;
        
        let stdin = process.stdin.take().unwrap();
        let stdout = process.stdout.take().unwrap();
        
        let (tx_to_server, mut rx_from_client) = mpsc::unbounded_channel::<String>();
        let (tx_to_client, rx_from_server) = mpsc::unbounded_channel::<String>();
        
        // Handle writing to server
        let mut stdin_writer = stdin;
        tokio::spawn(async move {
            while let Some(message) = rx_from_client.recv().await {
                let content_length = message.len();
                let full_message = format!("Content-Length: {}\r\n\r\n{}", content_length, message);
                
                if let Err(e) = stdin_writer.write_all(full_message.as_bytes()).await {
                    error!("Failed to write to LSP server: {}", e);
                    break;
                }
            }
        });
        
        // Handle reading from server
        let stdout_reader = BufReader::new(stdout);
        let tx_to_client_clone = tx_to_client.clone();
        tokio::spawn(async move {
            let mut lines = stdout_reader.lines();
            let mut content_length = 0;
            
            while let Ok(Some(line)) = lines.next_line().await {
                if line.starts_with("Content-Length:") {
                    if let Some(length_str) = line.strip_prefix("Content-Length:").map(|s| s.trim()) {
                        content_length = length_str.parse::<usize>().unwrap_or(0);
                    }
                } else if line.is_empty() && content_length > 0 {
                    // Read the JSON content
                    let buffer = vec![0; content_length];
                    // Note: This is simplified - in a real implementation, we'd need to handle partial reads
                    if let Ok(json_content) = String::from_utf8(buffer) {
                        if tx_to_client_clone.send(json_content).is_err() {
                            break;
                        }
                    }
                    content_length = 0;
                }
            }
        });
        
        let mut server = Self {
            process,
            request_id: 1,
            sender: tx_to_server,
            receiver: rx_from_server,
            initialized: false,
        };
        
        // Initialize the server
        server.initialize().await?;
        
        Ok(server)
    }
    
    async fn initialize(&mut self) -> Result<()> {
        let init_request = InitializeParams {
            process_id: Some(std::process::id()),
            root_path: None,
            root_uri: None,
            initialization_options: None,
            capabilities: ClientCapabilities {
                text_document: Some(TextDocumentClientCapabilities {
                    completion: Some(CompletionClientCapabilities {
                        completion_item: Some(CompletionItemCapability {
                            snippet_support: Some(false),
                            ..Default::default()
                        }),
                        ..Default::default()
                    }),
                    hover: Some(HoverClientCapabilities {
                        content_format: Some(vec![MarkupKind::PlainText]),
                        ..Default::default()
                    }),
                    ..Default::default()
                }),
                ..Default::default()
            },
            trace: Some(TraceValue::Off),
            workspace_folders: None,
            client_info: Some(ClientInfo {
                name: "arbiter".to_string(),
                version: Some("1.0.0".to_string()),
            }),
            locale: None,
            work_done_progress_params: WorkDoneProgressParams::default(),
        };
        
        let request = Request {
            id: NumberOrString::Number(self.request_id as i32),
            method: "initialize".to_string(),
            params: serde_json::to_value(init_request)?,
        };
        
        self.send_request(&request).await?;
        self.request_id += 1;
        
        // Send initialized notification
        let initialized_notification = Notification {
            method: "initialized".to_string(),
            params: serde_json::Value::Object(serde_json::Map::new()),
        };
        
        self.send_notification(&initialized_notification).await?;
        self.initialized = true;
        
        Ok(())
    }
    
    async fn send_request(&self, request: &Request) -> Result<()> {
        let json = serde_json::to_string(request)?;
        self.sender.send(json)
            .map_err(|_| anyhow::anyhow!("Failed to send request to LSP server"))?;
        Ok(())
    }
    
    async fn send_notification(&self, notification: &Notification) -> Result<()> {
        let json = serde_json::to_string(notification)?;
        self.sender.send(json)
            .map_err(|_| anyhow::anyhow!("Failed to send notification to LSP server"))?;
        Ok(())
    }
    
    async fn get_completions(&mut self, file_path: &str, content: &str, line: u32, character: u32) -> Result<Vec<CompletionItem>> {
        if !self.initialized {
            return Ok(Vec::new());
        }
        
        // First, send textDocument/didOpen or textDocument/didChange
        self.send_document_content(file_path, content).await?;
        
        let completion_params = CompletionParams {
            text_document_position: TextDocumentPositionParams {
                text_document: TextDocumentIdentifier {
                    uri: Url::from_file_path(file_path).map_err(|_| anyhow::anyhow!("Invalid file path"))?,
                },
                position: Position {
                    line,
                    character,
                },
            },
            work_done_progress_params: WorkDoneProgressParams::default(),
            partial_result_params: PartialResultParams::default(),
            context: None,
        };
        
        let request = Request {
            id: NumberOrString::Number(self.request_id as i32),
            method: "textDocument/completion".to_string(),
            params: serde_json::to_value(completion_params)?,
        };
        
        self.send_request(&request).await?;
        self.request_id += 1;
        
        // Wait for response (simplified)
        // In a real implementation, we'd properly match request IDs with responses
        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
        
        Ok(Vec::new()) // Simplified for now
    }
    
    async fn get_hover_info(&mut self, file_path: &str, content: &str, line: u32, character: u32) -> Result<Option<String>> {
        if !self.initialized {
            return Ok(None);
        }
        
        self.send_document_content(file_path, content).await?;
        
        let hover_params = HoverParams {
            text_document_position_params: TextDocumentPositionParams {
                text_document: TextDocumentIdentifier {
                    uri: Url::from_file_path(file_path).map_err(|_| anyhow::anyhow!("Invalid file path"))?,
                },
                position: Position {
                    line,
                    character,
                },
            },
            work_done_progress_params: WorkDoneProgressParams::default(),
        };
        
        let request = Request {
            id: NumberOrString::Number(self.request_id as i32),
            method: "textDocument/hover".to_string(),
            params: serde_json::to_value(hover_params)?,
        };
        
        self.send_request(&request).await?;
        self.request_id += 1;
        
        Ok(None) // Simplified for now
    }
    
    async fn get_diagnostics(&mut self, file_path: &str, content: &str) -> Result<Vec<Diagnostic>> {
        if !self.initialized {
            return Ok(Vec::new());
        }
        
        self.send_document_content(file_path, content).await?;
        
        // Diagnostics are usually sent as notifications from the server
        // We'd need to listen for publishDiagnostics notifications
        
        Ok(Vec::new()) // Simplified for now
    }
    
    async fn send_document_content(&self, file_path: &str, content: &str) -> Result<()> {
        let did_open_params = DidOpenTextDocumentParams {
            text_document: TextDocumentItem {
                uri: Url::from_file_path(file_path).map_err(|_| anyhow::anyhow!("Invalid file path"))?,
                language_id: self.detect_language_id(file_path).to_string(),
                version: 1,
                text: content.to_string(),
            },
        };
        
        let notification = Notification {
            method: "textDocument/didOpen".to_string(),
            params: serde_json::to_value(did_open_params)?,
        };
        
        self.send_notification(&notification).await?;
        Ok(())
    }
    
    fn detect_language_id(&self, file_path: &str) -> &str {
        let extension = std::path::Path::new(file_path)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("");
        
        match extension {
            "rs" => "rust",
            "js" | "mjs" => "javascript",
            "ts" | "tsx" => "typescript",
            "py" => "python",
            "go" => "go",
            "java" => "java",
            "c" | "h" => "c",
            "cpp" | "cc" | "cxx" | "hpp" => "cpp",
            "cs" => "csharp",
            "zig" => "zig",
            _ => "plaintext",
        }
    }
    
    async fn shutdown(&mut self) -> Result<()> {
        if self.initialized {
            let shutdown_request = Request {
                id: NumberOrString::Number(self.request_id as i32),
                method: "shutdown".to_string(),
                params: serde_json::Value::Null,
            };
            
            self.send_request(&shutdown_request).await?;
            
            let exit_notification = Notification {
                method: "exit".to_string(),
                params: serde_json::Value::Null,
            };
            
            self.send_notification(&exit_notification).await?;
        }
        
        // Kill the process if it's still running
        if let Err(e) = self.process.kill().await {
            warn!("Failed to kill LSP server process: {}", e);
        }
        
        Ok(())
    }
}

// LSP types that aren't in lsp-types crate
#[derive(serde::Serialize)]
struct Request {
    id: NumberOrString,
    method: String,
    params: serde_json::Value,
}

#[derive(serde::Serialize)]
struct Notification {
    method: String,
    params: serde_json::Value,
}