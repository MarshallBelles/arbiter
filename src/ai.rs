use anyhow::{Result, Context};
use futures::stream::StreamExt;
use reqwest::Client;
use roxmltree::Document;
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;
use tracing::{debug, error, warn};

use crate::config::Config;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Serialize)]
struct OllamaRequest {
    model: String,
    messages: Vec<Message>,
    stream: bool,
    options: OllamaOptions,
}

#[derive(Debug, Serialize)]
struct OllamaOptions {
    temperature: f32,
    num_ctx: usize,
    num_predict: usize,
}

#[derive(Debug, Deserialize)]
struct OllamaResponse {
    message: Message,
    done: bool,
}

#[derive(Debug, Deserialize)]
struct OllamaStreamResponse {
    message: Message,
    done: bool,
}

#[derive(Debug, Clone)]
pub enum StreamEvent {
    Text(String),
    Think(String),
    ThinkStart,           // Start of thinking block
    ThinkPartial(String), // For streaming thinking content
    ThinkEnd,            // End of thinking block
    ToolCall(ToolCall),
    Error(String),
    Done,
}

#[derive(Debug, Clone)]
pub struct ToolCall {
    pub name: String,
    pub args: String,
}

#[derive(Debug, Clone)]
pub struct ParsedResponse {
    pub text_content: String,
    pub thinking: Vec<String>,
    pub tool_calls: Vec<ToolCall>,
}

#[derive(Clone)]
pub struct AiClient {
    client: Client,
    config: Config,
    conversation_history: Vec<Message>,
}

impl AiClient {
    pub fn new(config: Config) -> Self {
        Self {
            client: Client::new(),
            config,
            conversation_history: Vec::new(),
        }
    }
    
    pub fn add_system_message(&mut self, content: &str) {
        // Add system prompt that instructs the model to use XML format
        let system_content = format!(
            r#"{}

IMPORTANT: Structure your responses using XML tags:
- Wrap your reasoning in <think></think> tags
- Use <tool_call name="tool_name">arguments</tool_call> for tool usage
- Regular text should be outside any tags
- You can use multiple tool calls in sequence
- Always think before using tools

Available tools:
- shell_command: Execute shell commands
- write_file: Write content to files
- read_file: Read file contents  
- git_command: Execute git operations
- code_analysis: Analyze code structure

Example response:
<think>
The user wants me to list files, I should use the shell_command tool.
</think>

I'll list the files in the current directory for you.

<tool_call name="shell_command">ls -la</tool_call>"#,
            content
        );
        
        self.conversation_history.push(Message {
            role: "system".to_string(),
            content: system_content,
        });
    }
    
    pub fn add_user_message(&mut self, content: &str) {
        self.conversation_history.push(Message {
            role: "user".to_string(),
            content: content.to_string(),
        });
    }
    
    pub fn add_assistant_message(&mut self, content: &str) {
        self.conversation_history.push(Message {
            role: "assistant".to_string(),
            content: content.to_string(),
        });
    }
    
    pub fn add_tool_result(&mut self, tool_name: &str, result: &str) {
        let content = format!("Tool '{}' executed with result:\n```\n{}\n```", tool_name, result);
        self.conversation_history.push(Message {
            role: "user".to_string(),
            content,
        });
    }
    
    pub async fn chat_stream(&mut self, user_input: &str) -> Result<mpsc::Receiver<StreamEvent>> {
        self.add_user_message(user_input);
        
        let request = OllamaRequest {
            model: self.config.model.clone(),
            messages: self.conversation_history.clone(),
            stream: true,
            options: OllamaOptions {
                temperature: self.config.temperature,
                num_ctx: self.config.context_size,
                num_predict: self.config.max_tokens,
            },
        };
        
        debug!("Sending streaming request to Ollama: {:?}", request);
        
        let response = self
            .client
            .post(&format!("{}/api/chat", self.config.server))
            .json(&request)
            .send()
            .await
            .context("Failed to send request to Ollama")?;
        
        if !response.status().is_success() {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            error!("Ollama request failed: {} - {}", status, text);
            return Err(anyhow::anyhow!("Ollama request failed: {} - {}", status, text));
        }
        
        let (tx, rx) = mpsc::channel(100);
        let mut stream = response.bytes_stream();
        let tx_clone = tx.clone();
        
        tokio::spawn(async move {
            let mut buffer = String::new();
            let mut xml_parser = XmlStreamParser::new();
            
            while let Some(chunk_result) = stream.next().await {
                match chunk_result {
                    Ok(chunk) => {
                        if let Ok(text) = String::from_utf8(chunk.to_vec()) {
                            // Parse each line as potential JSON
                            for line in text.lines() {
                                if line.trim().is_empty() {
                                    continue;
                                }
                                
                                match serde_json::from_str::<OllamaStreamResponse>(line) {
                                    Ok(response) => {
                                        buffer.push_str(&response.message.content);
                                        
                                        // Debug: log the raw content we're receiving
                                        if !response.message.content.trim().is_empty() {
                                            debug!("Raw AI content: {:?}", response.message.content);
                                        }
                                        
                                        // Process the new chunk for XML parsing  
                                        let events = xml_parser.process_chunk(&response.message.content);
                                        for event in events {
                                            if tx_clone.send(event).await.is_err() {
                                                return;
                                            }
                                        }
                                        
                                        if response.done {
                                            // Final parse of any remaining content
                                            let final_events = xml_parser.finalize();
                                            for event in final_events {
                                                if tx_clone.send(event).await.is_err() {
                                                    return;
                                                }
                                            }
                                            
                                            if tx_clone.send(StreamEvent::Done).await.is_err() {
                                                return;
                                            }
                                            break;
                                        }
                                    }
                                    Err(e) => {
                                        warn!("Failed to parse streaming response: {} - Line: {}", e, line);
                                    }
                                }
                            }
                        }
                    }
                    Err(e) => {
                        let _ = tx_clone.send(StreamEvent::Error(format!("Stream error: {}", e))).await;
                        break;
                    }
                }
            }
        });
        
        Ok(rx)
    }
    
    pub fn parse_xml_response(&self, content: &str) -> ParsedResponse {
        let mut text_content = String::new();
        let mut thinking = Vec::new();
        let mut tool_calls = Vec::new();
        
        // Try to parse as XML, but handle partial/malformed XML gracefully
        if let Ok(doc) = Document::parse(content) {
            for node in doc.descendants() {
                match node.tag_name().name() {
                    "think" => {
                        if let Some(text) = node.text() {
                            thinking.push(text.to_string());
                        }
                    }
                    "tool_call" => {
                        if let Some(name) = node.attribute("name") {
                            let args = node.text().unwrap_or("").to_string();
                            tool_calls.push(ToolCall {
                                name: name.to_string(),
                                args,
                            });
                        }
                    }
                    _ => {
                        if let Some(text) = node.text() {
                            if !text.trim().is_empty() {
                                text_content.push_str(text);
                            }
                        }
                    }
                }
            }
        } else {
            // Fallback: manual parsing for streaming/partial content
            let (extracted_text, extracted_thinking, extracted_tools) = self.manual_xml_parse(content);
            text_content = extracted_text;
            thinking = extracted_thinking;
            tool_calls = extracted_tools;
        }
        
        ParsedResponse {
            text_content,
            thinking,
            tool_calls,
        }
    }
    
    fn manual_xml_parse(&self, content: &str) -> (String, Vec<String>, Vec<ToolCall>) {
        let mut text_content = String::new();
        let mut thinking = Vec::new();
        let mut tool_calls = Vec::new();
        
        let mut current_pos = 0;
        let content_chars: Vec<char> = content.chars().collect();
        
        while current_pos < content_chars.len() {
            if content_chars[current_pos] == '<' {
                // Try to parse a tag
                if let Some((tag_name, tag_content, end_pos)) = self.extract_xml_tag(&content_chars, current_pos) {
                    match tag_name.as_str() {
                        "think" => thinking.push(tag_content),
                        tag if tag.starts_with("tool_call") => {
                            // Extract tool name from attributes
                            if let Some(name_start) = tag.find("name=\"") {
                                let name_start = name_start + 6;
                                if let Some(name_end) = tag[name_start..].find('"') {
                                    let tool_name = tag[name_start..name_start + name_end].to_string();
                                    tool_calls.push(ToolCall {
                                        name: tool_name,
                                        args: tag_content,
                                    });
                                }
                            }
                        }
                        _ => {
                            // Regular text content
                            text_content.push_str(&tag_content);
                        }
                    }
                    current_pos = end_pos;
                } else {
                    // Not a valid tag, treat as regular text
                    text_content.push(content_chars[current_pos]);
                    current_pos += 1;
                }
            } else {
                text_content.push(content_chars[current_pos]);
                current_pos += 1;
            }
        }
        
        (text_content.trim().to_string(), thinking, tool_calls)
    }
    
    fn extract_xml_tag(&self, chars: &[char], start_pos: usize) -> Option<(String, String, usize)> {
        if start_pos >= chars.len() || chars[start_pos] != '<' {
            return None;
        }
        
        // Find the end of the opening tag
        let mut tag_end = start_pos + 1;
        while tag_end < chars.len() && chars[tag_end] != '>' {
            tag_end += 1;
        }
        
        if tag_end >= chars.len() {
            return None; // Incomplete tag
        }
        
        let opening_tag: String = chars[start_pos + 1..tag_end].iter().collect();
        let tag_name = opening_tag.split_whitespace().next()?.to_string();
        
        // Find the closing tag
        let closing_tag = format!("</{}>", tag_name);
        let content_start = tag_end + 1;
        
        let remaining: String = chars[content_start..].iter().collect();
        if let Some(closing_pos) = remaining.find(&closing_tag) {
            let content = remaining[..closing_pos].to_string();
            let end_pos = content_start + closing_pos + closing_tag.len();
            Some((tag_name, content, end_pos))
        } else {
            None // No closing tag found
        }
    }
}

#[derive(Debug, Clone)]
enum ParserState {
    Text,
    InThink,
    InToolCall(String), // tool name
    LookingForTag,
}

struct XmlStreamParser {
    buffer: String,
    state: ParserState,
    current_content: String,
    tag_buffer: String, // For accumulating partial tags
}

impl XmlStreamParser {
    fn new() -> Self {
        Self {
            buffer: String::new(),
            state: ParserState::Text,
            current_content: String::new(),
            tag_buffer: String::new(),
        }
    }
    
    fn process_chunk(&mut self, chunk: &str) -> Vec<StreamEvent> {
        let mut events = Vec::new();
        
        for ch in chunk.chars() {
            match self.state {
                ParserState::Text => {
                    if ch == '<' {
                        // Emit any accumulated text before processing tag
                        if !self.current_content.is_empty() {
                            events.push(StreamEvent::Text(self.current_content.clone()));
                            self.current_content.clear();
                        }
                        self.state = ParserState::LookingForTag;
                        self.tag_buffer.clear();
                        self.tag_buffer.push(ch);
                    } else {
                        self.current_content.push(ch);
                        // Emit text frequently for streaming
                        if ch == ' ' || ch == '\n' || ch == '.' || ch == '!' || ch == '?' ||
                           self.current_content.len() >= 3 || ch == ',' || ch == ';' || ch == ':' {
                            events.push(StreamEvent::Text(self.current_content.clone()));
                            self.current_content.clear();
                        }
                    }
                }
                
                ParserState::LookingForTag => {
                    self.tag_buffer.push(ch);
                    
                    if ch == '>' {
                        // Complete tag found
                        if self.tag_buffer == "<think>" {
                            self.state = ParserState::InThink;
                            self.current_content.clear();
                            events.push(StreamEvent::ThinkStart);
                        } else if self.tag_buffer.starts_with("<tool_call") {
                            if let Some(tool_name) = self.extract_tool_name(&self.tag_buffer) {
                                self.state = ParserState::InToolCall(tool_name);
                                self.current_content.clear();
                            } else {
                                // Treat as regular text
                                self.state = ParserState::Text;
                                self.current_content.push_str(&self.tag_buffer);
                            }
                        } else {
                            // Not a special tag, treat as text
                            self.state = ParserState::Text;
                            self.current_content.push_str(&self.tag_buffer);
                        }
                        self.tag_buffer.clear();
                    } else if self.tag_buffer.len() > 50 {
                        // Tag too long, treat as text
                        self.state = ParserState::Text;
                        self.current_content.push_str(&self.tag_buffer);
                        self.tag_buffer.clear();
                    }
                }
                
                ParserState::InThink => {
                    self.buffer.push(ch);
                    
                    // Check for closing tag
                    if self.buffer.ends_with("</think>") {
                        // We're done with thinking - emit end event and transition back to text
                        events.push(StreamEvent::ThinkEnd);
                        self.buffer.clear();
                        self.state = ParserState::Text;
                        self.current_content.clear();
                    } else if ch != '\r' { // Skip carriage returns
                        // Always emit thinking content - we'll clean up at ThinkEnd
                        events.push(StreamEvent::ThinkPartial(ch.to_string()));
                    }
                }
                
                ParserState::InToolCall(ref tool_name) => {
                    self.buffer.push(ch);
                    
                    // Check for closing tag
                    if self.buffer.ends_with("</tool_call>") {
                        // Remove the closing tag from content
                        let content_end = self.buffer.len() - 12; // "</tool_call>" is 12 chars
                        let tool_args = self.buffer[..content_end].to_string();
                        
                        events.push(StreamEvent::ToolCall(ToolCall {
                            name: tool_name.clone(),
                            args: tool_args,
                        }));
                        
                        self.buffer.clear();
                        self.state = ParserState::Text;
                        self.current_content.clear();
                    }
                }
            }
        }
        
        events
    }
    
    fn extract_tool_name(&self, tag: &str) -> Option<String> {
        if let Some(name_start) = tag.find("name=\"") {
            let name_start = name_start + 6;
            if let Some(name_end) = tag[name_start..].find('"') {
                return Some(tag[name_start..name_start + name_end].to_string());
            }
        }
        None
    }
    
    
    fn finalize(&mut self) -> Vec<StreamEvent> {
        let mut events = Vec::new();
        
        // Emit any remaining content based on current state
        match &self.state {
            ParserState::InThink => {
                // If we're still in thinking, force close it
                events.push(StreamEvent::ThinkEnd);
                // Don't emit additional Think event - content was already streamed
                // via ThinkPartial events during processing
            }
            ParserState::InToolCall(_tool_name) => {
                // Incomplete tool call - treat remaining content as text
                // Only emit complete tool calls during normal processing
                if !self.buffer.is_empty() {
                    events.push(StreamEvent::Text(self.buffer.clone()));
                }
            }
            ParserState::LookingForTag => {
                // Incomplete tag, treat as text
                if !self.tag_buffer.is_empty() {
                    events.push(StreamEvent::Text(self.tag_buffer.clone()));
                }
                if !self.current_content.is_empty() {
                    events.push(StreamEvent::Text(self.current_content.clone()));
                }
            }
            ParserState::Text => {
                if !self.current_content.trim().is_empty() {
                    events.push(StreamEvent::Text(self.current_content.clone()));
                }
            }
        }
        
        events
    }
}