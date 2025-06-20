use anyhow::{Result, Context};
use lsp_types::*;
use serde_json::Value;
use std::collections::HashMap;
use std::process::Stdio;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, AsyncReadExt, BufReader, BufWriter};
use tokio::process::{Child, Command};
use tokio::sync::{mpsc, Mutex, oneshot};
use tokio::time::{timeout, Duration};
use tracing::{debug, error, info, warn};

use crate::config::{Config, LspServerConfig};
use crate::tree_sitter_support::TreeSitterManager;

/// LSP Manager for Language Server Protocol integration
/// 
/// **CURRENT STATUS: FRAMEWORK IMPLEMENTATION ONLY**
/// 
/// This module provides a framework for LSP integration but contains simplified/stubbed
/// implementations for most functionality. The actual LSP features like completions,
/// hover info, and diagnostics return placeholder data.
/// 
/// This code is ready for future expansion but is not currently fully functional.
/// To complete the implementation, the following would need to be done:
/// 
/// 1. Proper LSP message handling and parsing
/// 2. Real request/response matching with proper async channels  
/// 3. Full implementation of completion, hover, and diagnostic features
/// 4. Error handling for LSP server communication failures
/// 5. Integration with the main application workflow
/// 
/// Currently used as: Framework code that compiles but provides minimal functionality
#[allow(dead_code)]
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

#[allow(dead_code)]
struct LspServer {
    process: Child,
    request_id: Arc<Mutex<u64>>,
    sender: mpsc::UnboundedSender<LspMessage>,
    response_handlers: Arc<Mutex<HashMap<RequestId, oneshot::Sender<Value>>>>,
    diagnostics: Arc<Mutex<Vec<Diagnostic>>>,
    initialized: bool,
    language: String,
}

#[derive(Debug, Clone)]
struct LspMessage {
    content: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct RequestId {
    id: i32,
}

impl LspServer {
    async fn start(config: LspServerConfig) -> Result<Self> {
        let mut cmd = Command::new(&config.command);
        cmd.args(&config.args);
        cmd.stdin(Stdio::piped());
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());
        
        info!("Starting LSP server: {} {:?}", config.command, config.args);
        
        let mut process = cmd.spawn()
            .context(format!("Failed to start LSP server: {}", config.command))?;
        
        let stdin = process.stdin.take().unwrap();
        let stdout = process.stdout.take().unwrap();
        
        let (tx_to_server, mut rx_from_client) = mpsc::unbounded_channel::<LspMessage>();
        let response_handlers = Arc::new(Mutex::new(HashMap::new()));
        let diagnostics = Arc::new(Mutex::new(Vec::new()));
        let request_id = Arc::new(Mutex::new(1));
        
        // Handle writing to server
        let mut stdin_writer = BufWriter::new(stdin);
        tokio::spawn(async move {
            while let Some(message) = rx_from_client.recv().await {
                let content_length = message.content.len();
                let full_message = format!("Content-Length: {}\r\n\r\n{}", content_length, message.content);
                
                debug!("Sending to LSP server: {}", message.content);
                
                if let Err(e) = stdin_writer.write_all(full_message.as_bytes()).await {
                    error!("Failed to write to LSP server: {}", e);
                    break;
                }
                
                if let Err(e) = stdin_writer.flush().await {
                    error!("Failed to flush LSP server stdin: {}", e);
                    break;
                }
            }
        });
        
        // Handle reading from server
        let response_handlers_clone = response_handlers.clone();
        let diagnostics_clone = diagnostics.clone();
        
        tokio::spawn(async move {
            let mut stdout_reader = BufReader::new(stdout);
            
            loop {
                match Self::read_message(&mut stdout_reader).await {
                    Ok(Some(message)) => {
                        debug!("Received from LSP server: {}", message);
                        
                        if let Err(e) = Self::handle_message(message, &response_handlers_clone, &diagnostics_clone).await {
                            warn!("Failed to handle LSP message: {}", e);
                        }
                    }
                    Ok(None) => {
                        debug!("LSP server closed connection");
                        break;
                    }
                    Err(e) => {
                        error!("Error reading from LSP server: {}", e);
                        break;
                    }
                }
            }
        });
        
        let mut server = Self {
            process,
            request_id,
            sender: tx_to_server,
            response_handlers,
            diagnostics,
            initialized: false,
            language: config.language.clone(),
        };
        
        // Initialize the server
        server.initialize().await?;
        
        Ok(server)
    }
    
    async fn read_message<R: AsyncReadExt + Unpin>(reader: &mut BufReader<R>) -> Result<Option<String>> {
        let mut content_length = 0;
        
        // Read headers
        loop {
            let mut line = String::new();
            match reader.read_line(&mut line).await {
                Ok(0) => return Ok(None), // EOF
                Ok(_) => {
                    let line = line.trim();
                    if line.is_empty() {
                        break; // End of headers
                    }
                    
                    if let Some(length_str) = line.strip_prefix("Content-Length:") {
                        content_length = length_str.trim().parse()
                            .context("Failed to parse Content-Length header")?;
                    }
                }
                Err(e) => return Err(e.into()),
            }
        }
        
        if content_length == 0 {
            return Err(anyhow::anyhow!("Missing or invalid Content-Length header"));
        }
        
        // Read content
        let mut buffer = vec![0; content_length];
        reader.read_exact(&mut buffer).await?;
        
        let content = String::from_utf8(buffer)
            .context("LSP message content is not valid UTF-8")?;
        
        Ok(Some(content))
    }
    
    async fn handle_message(
        message: String,
        response_handlers: &Arc<Mutex<HashMap<RequestId, oneshot::Sender<Value>>>>,
        diagnostics: &Arc<Mutex<Vec<Diagnostic>>>,
    ) -> Result<()> {
        let json: Value = serde_json::from_str(&message)
            .context("Failed to parse LSP message as JSON")?;
        
        // Check if it's a response to a request
        if let Some(id) = json.get("id") {
            let id_num = id.as_i64().unwrap_or(0) as i32;
            let request_id = RequestId { id: id_num };
            
            let mut handlers = response_handlers.lock().await;
            if let Some(sender) = handlers.remove(&request_id) {
                if json.get("error").is_some() {
                    warn!("LSP server returned error: {}", json);
                }
                
                let _ = sender.send(json); // Ignore if receiver is dropped
            }
        }
        // Check if it's a notification (like diagnostics)
        else if let Some(method) = json.get("method").and_then(|m| m.as_str()) {
            match method {
                "textDocument/publishDiagnostics" => {
                    if let Some(params) = json.get("params") {
                        if let Ok(publish_diagnostics) = serde_json::from_value::<PublishDiagnosticsParams>(params.clone()) {
                            let mut diag_store = diagnostics.lock().await;
                            diag_store.clear();
                            diag_store.extend(publish_diagnostics.diagnostics);
                            debug!("Updated diagnostics: {} items", diag_store.len());
                        }
                    }
                }
                _ => {
                    debug!("Unhandled LSP notification: {}", method);
                }
            }
        }
        
        Ok(())
    }
    
    async fn initialize(&mut self) -> Result<()> {
        let current_dir = std::env::current_dir().unwrap_or_default();
        let root_uri = Url::from_directory_path(&current_dir).ok();
        
        let init_request = InitializeParams {
            process_id: Some(std::process::id()),
            #[allow(deprecated)]
            root_path: current_dir.to_str().map(|s| s.to_string()),
            #[allow(deprecated)]
            root_uri: root_uri.clone(),
            workspace_folders: root_uri.map(|uri| vec![WorkspaceFolder {
                uri,
                name: current_dir.file_name().and_then(|n| n.to_str()).unwrap_or("workspace").to_string(),
            }]),
            initialization_options: None,
            capabilities: ClientCapabilities {
                workspace: Some(WorkspaceClientCapabilities {
                    workspace_folders: Some(true),
                    ..Default::default()
                }),
                text_document: Some(TextDocumentClientCapabilities {
                    synchronization: Some(TextDocumentSyncClientCapabilities {
                        dynamic_registration: Some(false),
                        will_save: Some(false),
                        will_save_wait_until: Some(false),
                        did_save: Some(true),
                    }),
                    completion: Some(CompletionClientCapabilities {
                        dynamic_registration: Some(false),
                        completion_item: Some(CompletionItemCapability {
                            snippet_support: Some(false),
                            commit_characters_support: Some(true),
                            documentation_format: Some(vec![MarkupKind::PlainText, MarkupKind::Markdown]),
                            deprecated_support: Some(true),
                            preselect_support: Some(true),
                            ..Default::default()
                        }),
                        ..Default::default()
                    }),
                    hover: Some(HoverClientCapabilities {
                        dynamic_registration: Some(false),
                        content_format: Some(vec![MarkupKind::PlainText, MarkupKind::Markdown]),
                    }),
                    publish_diagnostics: Some(PublishDiagnosticsClientCapabilities {
                        related_information: Some(true),
                        version_support: Some(true),
                        ..Default::default()
                    }),
                    ..Default::default()
                }),
                ..Default::default()
            },
            trace: Some(TraceValue::Off),
            client_info: Some(ClientInfo {
                name: "arbiter".to_string(),
                version: Some("1.0.0".to_string()),
            }),
            locale: None,
            work_done_progress_params: WorkDoneProgressParams::default(),
        };
        
        info!("Initializing LSP server for {}", self.language);
        
        let response = self.send_request_and_wait("initialize", serde_json::to_value(init_request)?).await?;
        
        if let Some(error) = response.get("error") {
            return Err(anyhow::anyhow!("LSP initialization failed: {}", error));
        }
        
        // Send initialized notification
        let initialized_notification = Notification {
            method: "initialized".to_string(),
            params: serde_json::Value::Object(serde_json::Map::new()),
        };
        
        self.send_notification(&initialized_notification).await?;
        self.initialized = true;
        
        info!("LSP server initialized successfully for {}", self.language);
        Ok(())
    }
    
    async fn send_request_and_wait(&self, method: &str, params: Value) -> Result<Value> {
        let mut request_id_guard = self.request_id.lock().await;
        let id = *request_id_guard;
        *request_id_guard += 1;
        drop(request_id_guard);
        
        let id_i32 = id as i32;
        
        let request = Request {
            id: NumberOrString::Number(id_i32),
            method: method.to_string(),
            params,
        };
        
        let (response_tx, response_rx) = oneshot::channel();
        
        // Register response handler
        {
            let mut handlers = self.response_handlers.lock().await;
            handlers.insert(RequestId { id: id_i32 }, response_tx);
        }
        
        // Send request
        self.send_request(&request).await?;
        
        // Wait for response with timeout
        match timeout(Duration::from_secs(10), response_rx).await {
            Ok(Ok(response)) => Ok(response),
            Ok(Err(_)) => Err(anyhow::anyhow!("Response channel closed")),
            Err(_) => {
                // Remove handler on timeout
                let mut handlers = self.response_handlers.lock().await;
                handlers.remove(&RequestId { id: id_i32 });
                Err(anyhow::anyhow!("LSP request timed out after 10 seconds"))
            }
        }
    }
    
    async fn send_request(&self, request: &Request) -> Result<()> {
        let json = serde_json::to_string(request)?;
        self.sender.send(LspMessage { content: json })
            .map_err(|_| anyhow::anyhow!("Failed to send request to LSP server"))?;
        Ok(())
    }
    
    async fn send_notification(&self, notification: &Notification) -> Result<()> {
        let json = serde_json::to_string(notification)?;
        self.sender.send(LspMessage { content: json })
            .map_err(|_| anyhow::anyhow!("Failed to send notification to LSP server"))?;
        Ok(())
    }
    
    async fn get_completions(&mut self, file_path: &str, content: &str, line: u32, character: u32) -> Result<Vec<CompletionItem>> {
        if !self.initialized {
            return Ok(Vec::new());
        }
        
        // First, send textDocument/didOpen to sync the document
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
            context: Some(CompletionContext {
                trigger_kind: CompletionTriggerKind::INVOKED,
                trigger_character: None,
            }),
        };
        
        match self.send_request_and_wait("textDocument/completion", serde_json::to_value(completion_params)?).await {
            Ok(response) => {
                if let Some(result) = response.get("result") {
                    // Handle both CompletionList and CompletionItem[] responses
                    let items = if let Some(list) = result.get("items") {
                        list.clone() // CompletionList format
                    } else {
                        result.clone() // Direct array format
                    };
                    
                    if let Ok(completion_items) = serde_json::from_value::<Vec<CompletionItem>>(items) {
                        debug!("Got {} completion items for {}:{}", completion_items.len(), line, character);
                        return Ok(completion_items);
                    }
                }
                
                debug!("No valid completion items in response");
                Ok(Vec::new())
            }
            Err(e) => {
                warn!("Completion request failed: {}", e);
                Ok(Vec::new())
            }
        }
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
        
        match self.send_request_and_wait("textDocument/hover", serde_json::to_value(hover_params)?).await {
            Ok(response) => {
                if let Some(result) = response.get("result") {
                    if let Ok(hover) = serde_json::from_value::<Hover>(result.clone()) {
                        let hover_text = match hover.contents {
                            HoverContents::Scalar(content) => {
                                match content {
                                    MarkedString::String(s) => s,
                                    MarkedString::LanguageString(ls) => format!("{}: {}", ls.language, ls.value),
                                }
                            }
                            HoverContents::Array(arr) => {
                                arr.iter().map(|ms| match ms {
                                    MarkedString::String(s) => s.clone(),
                                    MarkedString::LanguageString(ls) => format!("{}: {}", ls.language, ls.value),
                                }).collect::<Vec<_>>().join("\n")
                            }
                            HoverContents::Markup(markup) => markup.value,
                        };
                        
                        debug!("Got hover info: {}", hover_text);
                        return Ok(Some(hover_text));
                    }
                }
                
                Ok(None)
            }
            Err(e) => {
                warn!("Hover request failed: {}", e);
                Ok(None)
            }
        }
    }
    
    async fn get_diagnostics(&mut self, file_path: &str, content: &str) -> Result<Vec<Diagnostic>> {
        if !self.initialized {
            return Ok(Vec::new());
        }
        
        // Send document content to trigger diagnostics
        self.send_document_content(file_path, content).await?;
        
        // Give the server a moment to process and send diagnostics
        tokio::time::sleep(Duration::from_millis(500)).await;
        
        // Return cached diagnostics
        let diagnostics = self.diagnostics.lock().await;
        Ok(diagnostics.clone())
    }
    
    async fn send_document_content(&self, file_path: &str, content: &str) -> Result<()> {
        let uri = Url::from_file_path(file_path).map_err(|_| anyhow::anyhow!("Invalid file path"))?;
        
        let did_open_params = DidOpenTextDocumentParams {
            text_document: TextDocumentItem {
                uri,
                language_id: self.detect_language_id(file_path).to_string(),
                version: 1,
                text: content.to_string(),
            },
        };
        
        let notification = Notification {
            method: "textDocument/didOpen".to_string(),
            params: serde_json::to_value(did_open_params)?,
        };
        
        debug!("Sending didOpen for file: {}", file_path);
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
            let mut request_id_guard = self.request_id.lock().await;
            let id = *request_id_guard;
            *request_id_guard += 1;
            drop(request_id_guard);
            
            let shutdown_request = Request {
                id: NumberOrString::Number(id as i32),
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
#[allow(dead_code)]
struct Request {
    id: NumberOrString,
    method: String,
    params: serde_json::Value,
}

#[derive(serde::Serialize)]
#[allow(dead_code)]
struct Notification {
    method: String,
    params: serde_json::Value,
}