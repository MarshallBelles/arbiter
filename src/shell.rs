use anyhow::Result;
use crossterm::{
    event::{self, DisableMouseCapture, EnableMouseCapture, Event, KeyCode, KeyEvent, KeyModifiers, MouseEvent, MouseEventKind, MouseButton},
    execute,
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
};
use ratatui::{
    backend::{Backend, CrosstermBackend},
    layout::{Constraint, Direction, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Paragraph, Wrap},
    Frame, Terminal,
};
use std::io;
use tracing::{debug, error, info};

use crate::ai::{AiClient, StreamEvent, ToolCall, TaskPhase, ModelType};
use crate::config::Config;
use crate::tools::ToolExecutor;

#[derive(Debug, Clone)]
pub struct TaskState {
    pub phase: TaskPhase,
    pub iteration_count: usize,
    pub max_iterations: usize,
    pub task_summary: String,
    pub tools_executed_this_iteration: usize,
    pub total_tools_executed: usize,
    pub last_phase_change: std::time::Instant,
}

impl TaskState {
    pub fn new(initial_task: &str) -> Self {
        Self {
            phase: TaskPhase::Planning,
            iteration_count: 0,
            max_iterations: 10, // Prevent infinite loops
            task_summary: initial_task.to_string(),
            tools_executed_this_iteration: 0,
            total_tools_executed: 0,
            last_phase_change: std::time::Instant::now(),
        }
    }
    
    pub fn should_continue(&self) -> bool {
        self.iteration_count < self.max_iterations
    }
    
    pub fn advance_iteration(&mut self) {
        self.iteration_count += 1;
        self.tools_executed_this_iteration = 0;
    }
    
    pub fn change_phase(&mut self, new_phase: TaskPhase) {
        if self.phase != new_phase {
            info!("Task phase transition: {:?} -> {:?}", self.phase, new_phase);
            self.phase = new_phase;
            self.last_phase_change = std::time::Instant::now();
        }
    }
    
    pub fn record_tool_execution(&mut self) {
        self.tools_executed_this_iteration += 1;
        self.total_tools_executed += 1;
    }
    
    pub fn determine_next_phase(&self, had_tool_calls: bool, had_errors: bool) -> TaskPhase {
        match self.phase {
            TaskPhase::Planning => {
                if had_tool_calls {
                    TaskPhase::Execution // Move to execution after planning
                } else {
                    TaskPhase::Completion // No tools needed, just complete
                }
            }
            TaskPhase::Execution => {
                if had_errors {
                    TaskPhase::Evaluation // Evaluate errors
                } else if self.tools_executed_this_iteration > 0 {
                    TaskPhase::Evaluation // Evaluate results
                } else {
                    TaskPhase::Completion // Nothing executed, we're done
                }
            }
            TaskPhase::Evaluation => {
                if had_errors {
                    TaskPhase::Planning // Replan to fix errors
                } else {
                    TaskPhase::Completion // Success, complete the task
                }
            }
            TaskPhase::Completion => TaskPhase::Completion, // Stay in completion
        }
    }
}

pub struct Shell {
    ai_client: AiClient,
    tool_executor: ToolExecutor,
    config: Config,
    task_state: Option<TaskState>,
}

impl Shell {
    pub async fn new(config: Config) -> Result<Self> {
        let mut ai_client = AiClient::new(config.clone());
        
        // Initialize with system message
        ai_client.add_system_message(
            "You are Arbiter, an ULTRA-lightweight AI-powered command-line assistant and peer-programmer. You operate directly within the user's terminal environment and are designed to be their intelligent coding companion.

IDENTITY & CAPABILITIES:
• You are Arbiter - a next-generation AI assistant built for developers
• You run locally using Ollama with the arbiter1.0 model (based on Xiaomi's MiMo)
• You operate in a beautiful, professional terminal interface with natural command-line integration
• You have direct access to the user's file system, git repositories, and development tools

CORE CAPABILITIES:
• Execute shell commands directly (ls, git, cargo, npm, etc.)
• Read, write, and analyze code files across all major programming languages
• Perform git operations and repository management
• Analyze code structure and provide debugging assistance
• Support development workflows for Rust, JavaScript/TypeScript, Python, Java, C++, Go, C#, and Zig
• Integrate with language servers and development tools

INTERACTION STYLE:
• You respond naturally and conversationally while being concise and helpful
• Use your thinking process to reason through problems step by step
• Execute appropriate tools when needed (shell commands, file operations, etc.)
• Provide practical, actionable solutions focused on the user's immediate needs
• Be proactive in suggesting improvements and best practices

TECHNICAL CONTEXT:
• You have Tree-sitter integration for advanced code parsing
• You support Language Server Protocol (LSP) integration
• You use XML-structured responses with <think> tags for reasoning and <tool_call> tags for tool execution
• You operate in an agentic loop, executing tools and providing feedback
• Interactive/streaming commands are not yet supported but are coming in future releases

TOOL EXECUTION PROTOCOL:
• Execute only ONE tool per response - never batch multiple tool calls
• Wait for tool results before making decisions about next steps
• Analyze each tool's output carefully before proceeding
• Use the agentic loop: think → execute → analyze result → think → execute next tool if needed

Always be helpful, professional, and focused on empowering the user's development workflow. You are their intelligent terminal companion."
        );
        
        Ok(Self {
            ai_client,
            tool_executor: ToolExecutor::new(),
            config,
            task_state: None,
        })
    }
    
    pub async fn process_prompt(&mut self, prompt: &str) -> Result<()> {
        info!("Processing prompt: {}", prompt);
        
        // Initialize task state
        let mut task_state = TaskState::new(prompt);
        
        // Classify initial request complexity
        let initial_phase = self.ai_client.classify_request_complexity(prompt);
        task_state.change_phase(initial_phase);
        
        // Set appropriate model for initial phase
        self.ai_client.set_task_phase(initial_phase).await?;
        
        // Orchestrated agent loop
        while task_state.should_continue() {
            info!("Starting iteration {} in {:?} phase using {:?} model", 
                  task_state.iteration_count + 1, 
                  task_state.phase,
                  self.ai_client.get_model_state().current_model);
            
            let input = if task_state.iteration_count == 0 {
                prompt
            } else {
                "" // Continue conversation
            };
            
            let mut stream = self.ai_client.chat_stream(input).await?;
            let mut ai_response = String::new();
            let mut thinking_display_buffer = String::new();
            let mut had_tool_calls = false;
            let mut had_errors = false;
            
            // Process streaming response
            while let Some(event) = stream.recv().await {
                match event {
                    StreamEvent::Text(text) => {
                        print!("{}", text);
                        ai_response.push_str(&text);
                        io::Write::flush(&mut io::stdout())?;
                    }
                    StreamEvent::Think(thinking) => {
                        println!("\n\x1b[2;37m{}\x1b[0m", thinking);
                    }
                    StreamEvent::ThinkStart => {
                        thinking_display_buffer.clear();
                        print!("\n\x1b[2;37m");
                        io::Write::flush(&mut io::stdout())?;
                    }
                    StreamEvent::ThinkPartial(partial) => {
                        thinking_display_buffer.push_str(&partial);
                        
                        // Lookahead buffer approach for safe streaming
                        const LOOKAHEAD_SIZE: usize = 20;
                        if thinking_display_buffer.len() > LOOKAHEAD_SIZE {
                            let target_len = thinking_display_buffer.len() - LOOKAHEAD_SIZE;
                            let safe_len = thinking_display_buffer.char_indices()
                                .map(|(i, _)| i)
                                .take_while(|&i| i <= target_len)
                                .last()
                                .unwrap_or(0);
                            
                            if safe_len > 0 {
                                let safe_content = &thinking_display_buffer[..safe_len];
                                let lookahead_content = &thinking_display_buffer[safe_len..];
                                
                                let is_safe = if safe_content.contains('<') {
                                    safe_content.rfind('<').map_or(true, |pos| {
                                        safe_content[pos..].contains('>')
                                    })
                                } else {
                                    true
                                };
                                
                                let no_partial_closing_tag = !lookahead_content.starts_with("</") || 
                                    lookahead_content.contains(">");
                                
                                if is_safe && no_partial_closing_tag {
                                    print!("\x1b[2;37m{}", safe_content);
                                    io::Write::flush(&mut io::stdout())?;
                                    thinking_display_buffer.drain(..safe_len);
                                }
                            }
                        }
                    }
                    StreamEvent::ThinkEnd => {
                        if !thinking_display_buffer.is_empty() {
                            let clean_content = thinking_display_buffer.replace("</think>", "");
                            if !clean_content.is_empty() {
                                print!("\x1b[2;37m{}", clean_content);
                            }
                        }
                        print!("\x1b[0m\n");
                        thinking_display_buffer.clear();
                        io::Write::flush(&mut io::stdout())?;
                    }
                    StreamEvent::ToolCall(tool_call) => {
                        println!("\n\x1b[33mExecuting\x1b[0m \x1b[1;36m{}\x1b[0m \x1b[90m({}:{})\x1b[0m \x1b[37m{}\x1b[0m", 
                                tool_call.name, 
                                self.ai_client.get_model_state().current_model.model_name(),
                                task_state.phase as u8,
                                tool_call.args);
                        
                        let args = self.prepare_tool_args(&tool_call);
                        
                        match self.tool_executor.execute_tool(&tool_call.name, &args).await {
                            Ok(result) => {
                                let cleaned_result = Self::strip_ansi_codes(&result);
                                self.display_tool_output(&cleaned_result);
                                self.ai_client.add_tool_result(&tool_call.name, &result);
                                task_state.record_tool_execution();
                                had_tool_calls = true;
                            }
                            Err(e) => {
                                eprintln!("\x1b[1;31mTool execution failed:\x1b[0m {}", e);
                                self.ai_client.add_tool_result(&tool_call.name, &format!("Tool execution failed: {}", e));
                                had_errors = true;
                            }
                        }
                    }
                    StreamEvent::Error(error) => {
                        eprintln!("\n\x1b[1;31mError:\x1b[0m {}", error);
                        had_errors = true;
                    }
                    StreamEvent::Done => {
                        if !ai_response.trim().is_empty() {
                            self.ai_client.add_assistant_message(&ai_response);
                        }
                        break;
                    }
                }
            }
            
            // Determine next phase based on results
            let next_phase = task_state.determine_next_phase(had_tool_calls, had_errors);
            
            // Check if we're done
            if next_phase == TaskPhase::Completion && task_state.phase == TaskPhase::Completion {
                info!("Task completed after {} iterations with {} tools executed", 
                      task_state.iteration_count + 1, task_state.total_tools_executed);
                break;
            }
            
            // Switch model if phase changed
            if next_phase != task_state.phase {
                task_state.change_phase(next_phase);
                self.ai_client.set_task_phase(next_phase).await?;
            }
            
            task_state.advance_iteration();
            
            // If no tools were executed and no errors, we're likely done
            if !had_tool_calls && !had_errors && task_state.tools_executed_this_iteration == 0 {
                break;
            }
        }
        
        if !task_state.should_continue() {
            println!("\n\x1b[1;33mTask terminated after maximum iterations ({})\x1b[0m", task_state.max_iterations);
        }
        
        println!();
        Ok(())
    }
    
    pub async fn run_interactive(&mut self) -> Result<()> {
        use std::io::{self, Write};
        use rustyline::Editor;
        
        println!("\x1b[1;36mArbiter v1.0.0\x1b[0m - AI-powered peer-programmer");
        println!("\x1b[90mType 'exit' or press Ctrl+C twice to quit\x1b[0m");
        println!("\x1b[90mSpecial commands: 'edit config' to modify configuration\x1b[0m");
        println!();
        
        let mut rl = Editor::<(), rustyline::history::DefaultHistory>::new()?;
        
        loop {
            // Create the prompt with (Arbiter) prefix using professional colors
            let prompt = if let Ok(user) = std::env::var("USER") {
                if let Ok(hostname) = std::env::var("HOSTNAME") {
                    format!("\x1b[90m(\x1b[1;34mArbiter\x1b[0;90m)\x1b[0m \x1b[1;32m{}@{}\x1b[0m\x1b[1;37m$\x1b[0m ", user, hostname)
                } else {
                    format!("\x1b[90m(\x1b[1;34mArbiter\x1b[0;90m)\x1b[0m \x1b[1;32m{}\x1b[0m\x1b[1;37m$\x1b[0m ", user)
                }
            } else {
                "\x1b[90m(\x1b[1;34mArbiter\x1b[0;90m)\x1b[0m \x1b[1;37m$\x1b[0m ".to_string()
            };
            
            match rl.readline(&prompt) {
                Ok(line) => {
                    let input = line.trim();
                    if input.is_empty() {
                        continue;
                    }
                    
                    if input == "exit" || input == "quit" {
                        break;
                    }
                    
                    // Add to history
                    let _ = rl.add_history_entry(&line);
                    
                    // Process the input
                    if let Err(e) = self.process_console_input(input).await {
                        eprintln!("\x1b[1;31mError:\x1b[0m {}", e);
                    }
                    
                    println!(); // Add spacing after output
                }
                Err(rustyline::error::ReadlineError::Interrupted) => {
                    println!("^C");
                    break;
                }
                Err(rustyline::error::ReadlineError::Eof) => {
                    println!("exit");
                    break;
                }
                Err(err) => {
                    eprintln!("\x1b[1;31mError:\x1b[0m {:?}", err);
                    break;
                }
            }
        }
        
        println!("\x1b[2;37mGoodbye!\x1b[0m");
        Ok(())
    }
    
    async fn process_console_input(&mut self, input: &str) -> Result<()> {
        use std::io::{self, Write};
        
        // Input validation and sanitization
        let sanitized_input = self.sanitize_input(input)?;
        
        // Handle special commands first
        if sanitized_input.trim().eq_ignore_ascii_case("edit config") {
            match crate::config::Config::edit_existing_config(None) {
                Ok(()) => {
                    println!("\x1b[1;32mConfig editing completed\x1b[0m");
                }
                Err(e) => {
                    eprintln!("\x1b[1;31mError editing config:\x1b[0m {}", e);
                }
            }
            return Ok(());
        }
        
        // Check if this is a shell command
        if self.is_shell_command(&sanitized_input) {
            // Execute directly as shell command
            let args = serde_json::json!({
                "command": sanitized_input
            });
            
            match self.tool_executor.execute_tool("shell_command", &args).await {
                Ok(result) => {
                    // Add the shell command and result to AI conversation context
                    self.ai_client.add_user_message(&format!("$ {}", sanitized_input));
                    self.ai_client.add_tool_result("shell_command", &result);
                    
                    // Clean the result and print directly
                    let cleaned_result = Self::strip_ansi_codes(&result);
                    // Remove the "Command executed successfully:" prefix
                    if let Some(output) = cleaned_result.strip_prefix("Command executed successfully:\n") {
                        print!("{}", output);
                    } else {
                        print!("{}", cleaned_result);
                    }
                    io::stdout().flush()?;
                }
                Err(e) => {
                    // Add failed command to AI conversation context
                    self.ai_client.add_user_message(&format!("$ {}", sanitized_input));
                    self.ai_client.add_tool_result("shell_command", &format!("Command failed: {}", e));
                    
                    eprintln!("\x1b[1;31mShell command failed:\x1b[0m {}", e);
                }
            }
        } else {
            // Process with AI using orchestrated agent loop
            self.process_orchestrated_interaction(&sanitized_input).await?;
        }
        
        Ok(())
    }
    
    async fn process_orchestrated_interaction(&mut self, input: &str) -> Result<()> {
        use std::io::{self, Write};
        
        // Initialize task state for this interaction
        let mut task_state = TaskState::new(input);
        
        // Classify initial request complexity  
        let initial_phase = self.ai_client.classify_request_complexity(input);
        task_state.change_phase(initial_phase);
        
        // Set appropriate model for initial phase
        self.ai_client.set_task_phase(initial_phase).await?;
        
        // Orchestrated agent loop for interactive mode
        while task_state.should_continue() {
            debug!("Interactive iteration {} in {:?} phase using {:?} model", 
                   task_state.iteration_count + 1, 
                   task_state.phase,
                   self.ai_client.get_model_state().current_model);
            
            let prompt = if task_state.iteration_count == 0 {
                input
            } else {
                "" // Continue conversation
            };
            
            let mut stream = self.ai_client.chat_stream(prompt).await?;
            let mut ai_response = String::new();
            let mut thinking_display_buffer = String::new();
            let mut had_tool_calls = false;
            let mut had_errors = false;
            
            // Process streaming response
            while let Some(event) = stream.recv().await {
                match event {
                    StreamEvent::Text(text) => {
                        print!("{}", text);
                        ai_response.push_str(&text);
                        io::stdout().flush()?;
                    }
                    StreamEvent::Think(thinking) => {
                        println!("\n\x1b[2;37m{}\x1b[0m", thinking);
                    }
                    StreamEvent::ThinkStart => {
                        thinking_display_buffer.clear();
                        print!("\n\x1b[2;37m");
                        io::stdout().flush()?;
                    }
                    StreamEvent::ThinkPartial(partial) => {
                        thinking_display_buffer.push_str(&partial);
                        
                        // Lookahead buffer approach for safe streaming
                        const LOOKAHEAD_SIZE: usize = 20;
                        if thinking_display_buffer.len() > LOOKAHEAD_SIZE {
                            let target_len = thinking_display_buffer.len() - LOOKAHEAD_SIZE;
                            let safe_len = thinking_display_buffer.char_indices()
                                .map(|(i, _)| i)
                                .take_while(|&i| i <= target_len)
                                .last()
                                .unwrap_or(0);
                            
                            if safe_len > 0 {
                                let safe_content = &thinking_display_buffer[..safe_len];
                                let lookahead_content = &thinking_display_buffer[safe_len..];
                                
                                let is_safe = if safe_content.contains('<') {
                                    safe_content.rfind('<').map_or(true, |pos| {
                                        safe_content[pos..].contains('>')
                                    })
                                } else {
                                    true
                                };
                                
                                let no_partial_closing_tag = !lookahead_content.starts_with("</") || 
                                    lookahead_content.contains(">");
                                
                                if is_safe && no_partial_closing_tag {
                                    print!("\x1b[2;37m{}", safe_content);
                                    io::stdout().flush()?;
                                    thinking_display_buffer.drain(..safe_len);
                                }
                            }
                        }
                    }
                    StreamEvent::ThinkEnd => {
                        if !thinking_display_buffer.is_empty() {
                            let clean_content = thinking_display_buffer.replace("</think>", "");
                            if !clean_content.is_empty() {
                                print!("\x1b[2;37m{}", clean_content);
                            }
                        }
                        print!("\x1b[0m\n");
                        thinking_display_buffer.clear();
                        io::stdout().flush()?;
                    }
                    StreamEvent::ToolCall(tool_call) => {
                        println!("\n\x1b[33mExecuting\x1b[0m \x1b[1;36m{}\x1b[0m \x1b[90m({}:{}):\x1b[0m \x1b[37m{}\x1b[0m", 
                                tool_call.name, 
                                self.ai_client.get_model_state().current_model.model_name(),
                                task_state.phase as u8,
                                tool_call.args);
                        
                        let args = self.prepare_tool_args(&tool_call);
                        
                        match self.tool_executor.execute_tool(&tool_call.name, &args).await {
                            Ok(result) => {
                                let cleaned_result = Self::strip_ansi_codes(&result);
                                self.display_tool_output(&cleaned_result);
                                self.ai_client.add_tool_result(&tool_call.name, &result);
                                task_state.record_tool_execution();
                                had_tool_calls = true;
                            }
                            Err(e) => {
                                eprintln!("\x1b[1;31mTool execution failed:\x1b[0m {}", e);
                                self.ai_client.add_tool_result(&tool_call.name, &format!("Tool execution failed: {}", e));
                                had_errors = true;
                            }
                        }
                    }
                    StreamEvent::Error(error) => {
                        eprintln!("\n\x1b[1;31mError:\x1b[0m {}", error);
                        had_errors = true;
                    }
                    StreamEvent::Done => {
                        if !ai_response.trim().is_empty() {
                            self.ai_client.add_assistant_message(&ai_response);
                        }
                        break;
                    }
                }
            }
            
            // Determine next phase based on results
            let next_phase = task_state.determine_next_phase(had_tool_calls, had_errors);
            
            // Check if we're done
            if next_phase == TaskPhase::Completion && task_state.phase == TaskPhase::Completion {
                debug!("Interactive task completed after {} iterations with {} tools executed", 
                       task_state.iteration_count + 1, task_state.total_tools_executed);
                break;
            }
            
            // Switch model if phase changed
            if next_phase != task_state.phase {
                task_state.change_phase(next_phase);
                self.ai_client.set_task_phase(next_phase).await?;
            }
            
            task_state.advance_iteration();
            
            // If no tools were executed and no errors, we're likely done
            if !had_tool_calls && !had_errors && task_state.tools_executed_this_iteration == 0 {
                break;
            }
        }
        
        if !task_state.should_continue() {
            println!("\n\x1b[1;33mTask terminated after maximum iterations ({})\x1b[0m", task_state.max_iterations);
        }
        
        Ok(())
    }
    
    fn prepare_tool_args(&self, tool_call: &crate::ai::ToolCall) -> serde_json::Value {
        // First, try to parse the args as JSON
        if let Ok(parsed_json) = serde_json::from_str::<serde_json::Value>(&tool_call.args) {
            // If it's already valid JSON, check if it has the expected structure for this tool
            match tool_call.name.as_str() {
                "shell_command" => {
                    if parsed_json.get("command").is_some() {
                        return parsed_json;
                    }
                }
                "write_file" => {
                    if parsed_json.get("path").is_some() && parsed_json.get("content").is_some() {
                        return parsed_json;
                    }
                }
                "read_file" => {
                    if parsed_json.get("path").is_some() {
                        return parsed_json;
                    }
                }
                "git_command" => {
                    if parsed_json.get("command").is_some() {
                        return parsed_json;
                    }
                }
                "code_analysis" => {
                    if parsed_json.get("path").is_some() {
                        return parsed_json;
                    }
                }
                _ => {
                    // For unknown tools, accept any valid JSON
                    return parsed_json;
                }
            }
        }

        // Fallback to legacy string-based parsing for backward compatibility
        match tool_call.name.as_str() {
            "shell_command" => {
                serde_json::json!({
                    "command": tool_call.args
                })
            }
            "write_file" => {
                // Parse args for file writing
                let parts: Vec<&str> = tool_call.args.splitn(2, '\n').collect();
                if parts.len() >= 2 {
                    serde_json::json!({
                        "path": parts[0],
                        "content": parts[1]
                    })
                } else {
                    serde_json::json!({
                        "path": tool_call.args,
                        "content": ""
                    })
                }
            }
            "read_file" => {
                serde_json::json!({
                    "path": tool_call.args
                })
            }
            "git_command" => {
                serde_json::json!({
                    "command": tool_call.args
                })
            }
            "code_analysis" => {
                serde_json::json!({
                    "path": tool_call.args
                })
            }
            _ => {
                serde_json::json!({
                    "args": tool_call.args
                })
            }
        }
    }

    fn display_tool_output(&self, output: &str) {
        let lines: Vec<&str> = output.lines().collect();
        
        if lines.len() <= 3 {
            // Short output - display normally with better colors
            println!("\x1b[2;36m┌─ Tool output:\x1b[0m");
            for line in lines {
                println!("\x1b[2;36m│\x1b[0m \x1b[0;37m{}\x1b[0m", line);
            }
            println!("\x1b[2;36m└─\x1b[0m");
        } else {
            // Long output - show collapsed with preview
            println!("\x1b[2;36m┌─ Tool output\x1b[0m \x1b[2;33m({} lines)\x1b[0m \x1b[2;90m[showing first 3 lines]\x1b[0m", lines.len());
            
            // Show first 3 lines as preview
            for line in &lines[0..3.min(lines.len())] {
                println!("\x1b[2;36m│\x1b[0m \x1b[0;37m{}\x1b[0m", line);
            }
            
            if lines.len() > 3 {
                println!("\x1b[2;36m│\x1b[0m \x1b[2;90m... and {} more lines (use 'expand' command to see full output)\x1b[0m", lines.len() - 3);
            }
            
            println!("\x1b[2;36m└─\x1b[0m");
        }
    }
    
    fn sanitize_input(&self, input: &str) -> Result<String> {
        // Input validation
        const MAX_INPUT_LENGTH: usize = 10_000;
        if input.len() > MAX_INPUT_LENGTH {
            return Err(anyhow::anyhow!("Input too long (max {} characters)", MAX_INPUT_LENGTH));
        }
        
        // Basic sanitization - remove control characters except newlines and tabs
        let sanitized = input.chars()
            .filter(|&c| c == '\n' || c == '\t' || !c.is_control())
            .collect::<String>();
        
        // Trim excessive whitespace
        let trimmed = sanitized.trim();
        if trimmed.is_empty() {
            return Err(anyhow::anyhow!("Empty input after sanitization"));
        }
        
        Ok(trimmed.to_string())
    }
    
    fn is_shell_command(&self, input: &str) -> bool {
        Self::is_shell_command_static(input)
    }
    
    fn is_shell_command_static(input: &str) -> bool {
        const SHELL_COMMANDS: &[&str] = &[
            "ls", "cd", "pwd", "mkdir", "rmdir", "rm", "cp", "mv", "cat", "less", "more",
            "grep", "find", "which", "whereis", "ps", "top", "kill", "killall", "jobs",
            "git", "npm", "cargo", "python", "node", "java", "gcc", "make", "cmake",
            "docker", "kubectl", "curl", "wget", "ssh", "scp", "rsync", "tar", "gzip",
            "echo", "printf", "date", "whoami", "id", "uname", "df", "du", "free",
            "history", "alias", "export", "env", "printenv", "set", "unset",
            "head", "tail", "wc", "sort", "uniq", "cut", "awk", "sed", "tr", "xargs",
            "ln", "chmod", "chown", "chgrp", "touch", "file", "stat", "lsof", "netstat",
            "ping", "traceroute", "nslookup", "dig", "ifconfig", "ip", "mount", "umount",
            "vim", "vi", "nano", "emacs", "code", "subl", "open", "xdg-open",
        ];
        
        let first_word = input.split_whitespace().next().unwrap_or("");
        SHELL_COMMANDS.contains(&first_word) || first_word.starts_with("./") || first_word.starts_with("/")
    }
    
    async fn run_app<B: Backend>(&mut self, terminal: &mut Terminal<B>, app: &mut ShellApp) -> Result<()> {
        let mut ctrl_c_count = 0;
        let mut last_ctrl_c = std::time::Instant::now();
        
        loop {
            terminal.draw(|f| self.ui(f, app))?;
            
            if let Ok(event) = event::read() {
                match event {
                    Event::Key(key) => {
                        match key {
                            KeyEvent {
                                code: KeyCode::Char('c'),
                                modifiers: KeyModifiers::CONTROL,
                                ..
                            } => {
                                // If text is selected, copy it to clipboard
                                if app.selection_start.is_some() && app.selection_end.is_some() {
                                    if let Some(selected_text) = app.get_selected_text() {
                                        app.copy_to_clipboard(&selected_text);
                                        app.clear_selection();
                                    }
                                } else {
                                    // Normal Ctrl+C behavior for interrupting/exiting
                                    let now = std::time::Instant::now();
                                    if now.duration_since(last_ctrl_c).as_millis() < 1000 {
                                        ctrl_c_count += 1;
                                    } else {
                                        ctrl_c_count = 1;
                                    }
                                    last_ctrl_c = now;
                                    
                                    if ctrl_c_count == 1 {
                                        // First Ctrl+C - interrupt current operation
                                        app.interrupt_current_operation();
                                        app.show_ctrl_c_message = true;
                                    } else if ctrl_c_count >= 2 {
                                        // Second Ctrl+C - exit
                                        break;
                                    }
                                }
                            }
                            KeyEvent {
                                code: KeyCode::Enter,
                                ..
                            } => {
                                if !app.input.is_empty() {
                                    let input = app.input.clone();
                                    app.input.clear();
                                    app.input_cursor = 0;
                                    app.show_ctrl_c_message = false;
                                    
                                    // Process the input
                                    if let Err(e) = app.process_input(&input).await {
                                        error!("Error processing input: {}", e);
                                    }
                                }
                            }
                            KeyEvent {
                                code: KeyCode::Char(c),
                                ..
                            } => {
                                app.input.insert(app.input_cursor, c);
                                app.input_cursor += 1;
                                app.show_ctrl_c_message = false;
                            }
                            KeyEvent {
                                code: KeyCode::Backspace,
                                ..
                            } => {
                                if app.input_cursor > 0 {
                                    app.input_cursor -= 1;
                                    app.input.remove(app.input_cursor);
                                }
                                app.show_ctrl_c_message = false;
                            }
                            KeyEvent {
                                code: KeyCode::Delete,
                                ..
                            } => {
                                if app.input_cursor < app.input.len() {
                                    app.input.remove(app.input_cursor);
                                }
                            }
                            KeyEvent {
                                code: KeyCode::Left,
                                ..
                            } => {
                                if app.input_cursor > 0 {
                                    app.input_cursor -= 1;
                                }
                            }
                            KeyEvent {
                                code: KeyCode::Right,
                                ..
                            } => {
                                if app.input_cursor < app.input.len() {
                                    app.input_cursor += 1;
                                }
                            }
                            KeyEvent {
                                code: KeyCode::Up,
                                ..
                            } => {
                                app.scroll_up();
                            }
                            KeyEvent {
                                code: KeyCode::Down,
                                ..
                            } => {
                                app.scroll_down();
                            }
                            KeyEvent {
                                code: KeyCode::Tab,
                                ..
                            } => {
                                // Toggle expanded view of thinking sections
                                app.toggle_expanded();
                            }
                            KeyEvent {
                                code: KeyCode::Esc,
                                ..
                            } => {
                                // Clear current input or exit
                                if app.input.is_empty() {
                                    break;
                                } else {
                                    app.input.clear();
                                    app.input_cursor = 0;
                                }
                            }
                            _ => {}
                        }
                    }
                    Event::Mouse(mouse_event) => {
                        match mouse_event {
                            MouseEvent {
                                kind: MouseEventKind::ScrollUp,
                                ..
                            } => {
                                app.scroll_down(); // ScrollUp means scroll content down (show earlier content)
                            }
                            MouseEvent {
                                kind: MouseEventKind::ScrollDown,
                                ..
                            } => {
                                app.scroll_up(); // ScrollDown means scroll content up (show later content)
                            }
                            MouseEvent {
                                kind: MouseEventKind::Down(MouseButton::Left),
                                column,
                                row,
                                ..
                            } => {
                                app.start_selection(column, row);
                            }
                            MouseEvent {
                                kind: MouseEventKind::Drag(MouseButton::Left),
                                column,
                                row,
                                ..
                            } => {
                                app.update_selection(column, row);
                            }
                            MouseEvent {
                                kind: MouseEventKind::Up(MouseButton::Left),
                                column,
                                row,
                                ..
                            } => {
                                app.end_selection(column, row);
                            }
                            _ => {}
                        }
                    }
                    Event::Resize(_, _) => {
                        // Handle terminal resize
                    }
                    _ => {}
                }
            }
        }
        
        Ok(())
    }
    
    fn ui(&self, f: &mut Frame, app: &ShellApp) {
        let chunks = Layout::default()
            .direction(Direction::Vertical)
            .constraints([
                Constraint::Min(1),    // Chat area (most space)
                Constraint::Length(1), // Input area (single line)
            ])
            .split(f.size());
        
        // Chat area (no borders, natural scrolling)
        self.render_chat_area(f, chunks[0], app);
        
        // Input area (simple prompt line)
        self.render_input_area(f, chunks[1], app);
    }
    
    fn render_chat_area(&self, f: &mut Frame, area: Rect, app: &ShellApp) {
        let mut lines: Vec<Line> = Vec::new();
        
        for message in &app.messages {
            match message {
                DisplayMessage::User(text) => {
                    // Terminal-like format: (Arbiter) user@hostname:current_dir$ command
                    let prompt = if let Ok(user) = std::env::var("USER") {
                        if let Ok(hostname) = std::env::var("HOSTNAME") {
                            format!("(Arbiter) {}@{}$ ", user, hostname)
                        } else {
                            format!("(Arbiter) {}$ ", user)
                        }
                    } else {
                        "(Arbiter) $ ".to_string()
                    };
                    
                    lines.push(Line::from(vec![
                        Span::styled(prompt, Style::default().fg(Color::Green)),
                        Span::raw(text),
                    ]));
                }
                DisplayMessage::Assistant(text) => {
                    // Split text into multiple lines if needed
                    for line in text.lines() {
                        lines.push(Line::from(Span::raw(line)));
                    }
                    if !text.is_empty() {
                        lines.push(Line::from("")); // Add empty line after AI response
                    }
                }
                DisplayMessage::Thinking(text) => {
                    if app.show_thinking_expanded {
                        lines.push(Line::from(vec![
                            Span::styled("# ", Style::default().fg(Color::DarkGray)),
                            Span::styled(text, Style::default().fg(Color::DarkGray).add_modifier(Modifier::ITALIC)),
                        ]));
                    } else {
                        lines.push(Line::from(vec![
                            Span::styled("# ", Style::default().fg(Color::DarkGray)),
                            Span::styled("[thinking...] ", Style::default().fg(Color::DarkGray).add_modifier(Modifier::ITALIC)),
                            Span::styled("(Tab to expand)", Style::default().fg(Color::DarkGray)),
                        ]));
                    }
                }
                DisplayMessage::ToolCall(name, args) => {
                    lines.push(Line::from(vec![
                        Span::styled("> ", Style::default().fg(Color::Cyan)),
                        Span::styled(format!("{} {}", name, args), Style::default().fg(Color::Cyan)),
                    ]));
                }
                DisplayMessage::ToolResult(_name, result) => {
                    let cleaned_result = Self::strip_ansi_codes(result);
                    let display_text = if cleaned_result.len() > 500 && !app.show_tool_results_expanded {
                        format!("{}... (Tab to expand)", &cleaned_result[..500])
                    } else {
                        cleaned_result
                    };
                    
                    // Show tool output like terminal output
                    for line in display_text.lines() {
                        lines.push(Line::from(Span::raw(line.to_string())));
                    }
                    lines.push(Line::from("")); // Add empty line after tool output
                }
                DisplayMessage::Error(error) => {
                    lines.push(Line::from(vec![
                        Span::styled("Error: ", Style::default().fg(Color::Red).add_modifier(Modifier::BOLD)),
                        Span::styled(error, Style::default().fg(Color::Red)),
                    ]));
                }
            }
        }
        
        // Render as a simple paragraph without borders
        let paragraph = Paragraph::new(lines)
            .wrap(Wrap { trim: false })
            .scroll((app.scroll_offset, 0));
        
        f.render_widget(paragraph, area);
    }
    
    fn render_input_area(&self, f: &mut Frame, area: Rect, app: &ShellApp) {
        // Create a natural terminal prompt
        let prompt_prefix = if let Ok(user) = std::env::var("USER") {
            if let Ok(hostname) = std::env::var("HOSTNAME") {
                format!("{}@{}$ ", user, hostname)
            } else {
                format!("{}$ ", user)
            }
        } else {
            "$ ".to_string()
        };
        
        let prompt_text = if app.show_ctrl_c_message {
            format!("{}{} (Ctrl+C again to exit)", prompt_prefix, app.input)
        } else {
            format!("{}{}", prompt_prefix, app.input)
        };
        
        let input = Paragraph::new(prompt_text.as_str())
            .style(Style::default().fg(Color::White));
        
        f.render_widget(input, area);
        
        // Set cursor position (accounting for prompt prefix)
        f.set_cursor(
            area.x + app.input_cursor as u16 + prompt_prefix.len() as u16,
            area.y,
        );
    }
    
    fn strip_ansi_codes(text: &str) -> String {
        use std::sync::OnceLock;
        
        static ANSI_REGEX: OnceLock<regex::Regex> = OnceLock::new();
        
        let regex = ANSI_REGEX.get_or_init(|| {
            regex::Regex::new(r"\x1b\[[0-9;]*[mGKH]").unwrap_or_else(|_| {
                // Fallback: remove common ANSI sequences manually
                regex::Regex::new(r"\x1b\[[0-9;]*m").unwrap()
            })
        });
        
        regex.replace_all(text, "").to_string()
    }
}

#[derive(Debug, Clone)]
enum DisplayMessage {
    User(String),
    Assistant(String),
    Thinking(String),
    ToolCall(String, String), // name, args
    ToolResult(String, String), // name, result
    Error(String),
}

struct ShellApp {
    ai_client: AiClient,
    tool_executor: ToolExecutor,
    messages: Vec<DisplayMessage>,
    input: String,
    input_cursor: usize,
    show_ctrl_c_message: bool,
    show_thinking_expanded: bool,
    show_tool_results_expanded: bool,
    current_response: String,
    processing: bool,
    scroll_offset: u16,
    selection_start: Option<(u16, u16)>,
    selection_end: Option<(u16, u16)>,
    is_selecting: bool,
}

impl ShellApp {
    async fn new(ai_client: AiClient, tool_executor: ToolExecutor) -> Result<Self> {
        Ok(Self {
            ai_client,
            tool_executor,
            messages: Vec::new(),
            input: String::new(),
            input_cursor: 0,
            show_ctrl_c_message: false,
            show_thinking_expanded: false,
            show_tool_results_expanded: false,
            current_response: String::new(),
            processing: false,
            scroll_offset: 0,
            selection_start: None,
            selection_end: None,
            is_selecting: false,
        })
    }
    
    fn interrupt_current_operation(&mut self) {
        if self.processing {
            self.processing = false;
            self.messages.push(DisplayMessage::Error("Operation interrupted by user".to_string()));
        }
    }
    
    fn toggle_expanded(&mut self) {
        self.show_thinking_expanded = !self.show_thinking_expanded;
        self.show_tool_results_expanded = !self.show_tool_results_expanded;
    }
    
    fn scroll_up(&mut self) {
        // Scroll up by 3 lines for better responsiveness
        self.scroll_offset = self.scroll_offset.saturating_add(3);
    }
    
    fn scroll_down(&mut self) {
        // Scroll down by 3 lines, but don't go past the bottom
        if self.scroll_offset >= 3 {
            self.scroll_offset -= 3;
        } else {
            self.scroll_offset = 0;
        }
    }
    
    fn scroll_to_bottom(&mut self) {
        self.scroll_offset = 0; // Reset to auto-scroll to bottom
    }
    
    fn start_selection(&mut self, column: u16, row: u16) {
        self.selection_start = Some((column, row));
        self.selection_end = Some((column, row));
        self.is_selecting = true;
    }
    
    fn update_selection(&mut self, column: u16, row: u16) {
        if self.is_selecting {
            self.selection_end = Some((column, row));
        }
    }
    
    fn end_selection(&mut self, column: u16, row: u16) {
        if self.is_selecting {
            self.selection_end = Some((column, row));
            // Copy selected text to clipboard if available
            if let Some(selected_text) = self.get_selected_text() {
                self.copy_to_clipboard(&selected_text);
            }
        }
        self.is_selecting = false;
    }
    
    fn get_selected_text(&self) -> Option<String> {
        if let (Some(start), Some(end)) = (self.selection_start, self.selection_end) {
            // For now, return a placeholder - we'd need to implement proper text extraction
            // from the rendered content based on coordinates
            Some(format!("Selected text from ({},{}) to ({},{})", start.0, start.1, end.0, end.1))
        } else {
            None
        }
    }
    
    fn copy_to_clipboard(&self, text: &str) {
        // Try to copy to system clipboard
        use std::process::Command;
        
        #[cfg(target_os = "macos")]
        {
            let _ = Command::new("pbcopy")
                .arg(text)
                .output();
        }
        
        #[cfg(target_os = "linux")]
        {
            let _ = Command::new("xclip")
                .args(&["-selection", "clipboard"])
                .arg(text)
                .output();
        }
        
        #[cfg(target_os = "windows")]
        {
            let _ = Command::new("clip")
                .arg(text)
                .output();
        }
    }
    
    fn clear_selection(&mut self) {
        self.selection_start = None;
        self.selection_end = None;
        self.is_selecting = false;
    }
    
    async fn process_input(&mut self, input: &str) -> Result<()> {
        self.processing = true;
        self.messages.push(DisplayMessage::User(input.to_string()));
        self.scroll_to_bottom();
        
        // Check if this is a shell command
        if self.is_shell_command(input) {
            // Execute directly as shell command
            let args = serde_json::json!({
                "command": input
            });
            
            match self.tool_executor.execute_tool("shell_command", &args).await {
                Ok(result) => {
                    // Add the shell command and result to AI conversation context
                    self.ai_client.add_user_message(&format!("$ {}", input));
                    self.ai_client.add_tool_result("shell_command", &result);
                    
                    self.messages.push(DisplayMessage::ToolResult("shell".to_string(), result));
                    self.scroll_to_bottom();
                }
                Err(e) => {
                    // Add failed command to AI conversation context
                    self.ai_client.add_user_message(&format!("$ {}", input));
                    self.ai_client.add_tool_result("shell_command", &format!("Command failed: {}", e));
                    
                    self.messages.push(DisplayMessage::Error(format!("Shell command failed: {}", e)));
                    self.scroll_to_bottom();
                }
            }
        } else {
            // Process with AI - implement agentic loop for TUI mode
            let mut first_iteration = true;
            
            loop {
                let stream_result = if first_iteration {
                    first_iteration = false;
                    self.ai_client.chat_stream(input).await
                } else {
                    // Continue conversation after tool execution
                    self.ai_client.chat_stream("").await
                };
                
                match stream_result {
                    Ok(mut stream) => {
                        let mut tools_executed = false;
                        
                        while let Some(event) = stream.recv().await {
                            if !self.processing {
                                break; // Interrupted
                            }
                            
                            match event {
                                StreamEvent::Text(text) => {
                                    self.current_response.push_str(&text);
                                }
                                StreamEvent::Think(thinking) => {
                                    self.messages.push(DisplayMessage::Thinking(thinking));
                                }
                                StreamEvent::ThinkStart => {
                                    // Start of thinking block - for TUI mode
                                }
                                StreamEvent::ThinkPartial(partial) => {
                                    // For now, just accumulate partial thinking - could implement streaming display later
                                    // This is for the TUI mode, main interactive mode handles it differently
                                }
                                StreamEvent::ThinkEnd => {
                                    // End of thinking block - for TUI mode
                                }
                                StreamEvent::ToolCall(tool_call) => {
                                    self.messages.push(DisplayMessage::ToolCall(
                                        tool_call.name.clone(),
                                        tool_call.args.clone()
                                    ));
                                    
                                    // Execute the tool
                                    let result = self.execute_tool_call(&tool_call).await;
                                    match result {
                                        Ok(result) => {
                                            self.messages.push(DisplayMessage::ToolResult(
                                                tool_call.name.clone(),
                                                result.clone()
                                            ));
                                            self.scroll_to_bottom();
                                            self.ai_client.add_tool_result(&tool_call.name, &result);
                                            
                                            // Set flag to continue agentic loop
                                            tools_executed = true;
                                        }
                                        Err(e) => {
                                            self.messages.push(DisplayMessage::Error(
                                                format!("Tool execution failed: {}", e)
                                            ));
                                            self.scroll_to_bottom();
                                            self.ai_client.add_tool_result(&tool_call.name, &format!("Tool execution failed: {}", e));
                                        }
                                    }
                                }
                                StreamEvent::Error(error) => {
                                    self.messages.push(DisplayMessage::Error(error));
                                    self.scroll_to_bottom();
                                }
                                StreamEvent::Done => {
                                    if !self.current_response.trim().is_empty() {
                                        self.messages.push(DisplayMessage::Assistant(self.current_response.clone()));
                                        self.ai_client.add_assistant_message(&self.current_response);
                                        self.current_response.clear();
                                    }
                                    self.scroll_to_bottom();
                                    break;
                                }
                            }
                        }
                        
                        // Continue agentic loop if tools were executed
                        if !tools_executed {
                            break; // No tools executed, exit the loop
                        }
                        // If tools were executed, continue the loop to call AI again
                    }
                    Err(e) => {
                        self.messages.push(DisplayMessage::Error(format!("AI request failed: {}", e)));
                        break;
                    }
                }
            }
        }
        
        self.processing = false;
        Ok(())
    }
    
    fn is_shell_command(&self, input: &str) -> bool {
        Shell::is_shell_command_static(input)
    }
    
    async fn execute_tool_call(&mut self, tool_call: &ToolCall) -> Result<String> {
        let args = match tool_call.name.as_str() {
            "shell_command" => {
                serde_json::json!({
                    "command": tool_call.args
                })
            }
            "write_file" => {
                // Parse args for file writing
                let parts: Vec<&str> = tool_call.args.splitn(2, '\n').collect();
                if parts.len() >= 2 {
                    serde_json::json!({
                        "path": parts[0],
                        "content": parts[1]
                    })
                } else {
                    serde_json::json!({
                        "path": tool_call.args,
                        "content": ""
                    })
                }
            }
            "read_file" => {
                serde_json::json!({
                    "path": tool_call.args
                })
            }
            "git_command" => {
                serde_json::json!({
                    "command": tool_call.args
                })
            }
            "code_analysis" => {
                serde_json::json!({
                    "path": tool_call.args
                })
            }
            _ => {
                serde_json::json!({
                    "args": tool_call.args
                })
            }
        };
        
        self.tool_executor.execute_tool(&tool_call.name, &args).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::Config;
    use crate::ai::ToolCall;
    use serde_json::json;

    async fn create_test_shell() -> Shell {
        let config = Config::default();
        Shell::new(config).await.unwrap()
    }

    #[tokio::test]
    async fn test_shell_new() {
        let config = Config::default();
        let shell = Shell::new(config.clone()).await;
        
        assert!(shell.is_ok());
        let shell = shell.unwrap();
        // Shell should be properly initialized with config
        // We can't directly access private fields, but we can test that it was created
    }

    #[test]
    fn test_strip_ansi_codes() {
        // Test removing ANSI color codes
        let input = "\x1b[1;31mError:\x1b[0m This is a test";
        let expected = "Error: This is a test";
        assert_eq!(Shell::strip_ansi_codes(input), expected);
        
        // Test with multiple ANSI codes
        let input = "\x1b[1;32mSuccess\x1b[0m: \x1b[33mWarning\x1b[0m message";
        let expected = "Success: Warning message";
        assert_eq!(Shell::strip_ansi_codes(input), expected);
        
        // Test with no ANSI codes
        let input = "Plain text";
        let expected = "Plain text";
        assert_eq!(Shell::strip_ansi_codes(input), expected);
        
        // Test with complex ANSI sequences
        let input = "\x1b[2;37mThinking...\x1b[0m\n\x1b[1;36mCommand\x1b[0m output";
        let expected = "Thinking...\nCommand output";
        assert_eq!(Shell::strip_ansi_codes(input), expected);
        
        // Test empty string
        assert_eq!(Shell::strip_ansi_codes(""), "");
    }

    #[tokio::test]
    async fn test_sanitize_input() {
        let shell = create_test_shell().await;
        
        // Test normal input
        let result = shell.sanitize_input("ls -la");
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), "ls -la");
        
        // Test input with whitespace
        let result = shell.sanitize_input("  git status  ");
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), "git status");
        
        // Test empty input (should be rejected after sanitization)
        let result = shell.sanitize_input("");
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("Empty input after sanitization"));
        
        // Test input with special characters (should be preserved)
        let result = shell.sanitize_input("echo \"Hello $USER\"");
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), "echo \"Hello $USER\"");
        
        // Test very long input (should be rejected)
        let long_input = "a".repeat(10001);
        let result = shell.sanitize_input(&long_input);
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("Input too long"));
    }

    #[test]
    fn test_is_shell_command_static() {
        // Test common shell commands
        assert!(Shell::is_shell_command_static("ls"));
        assert!(Shell::is_shell_command_static("ls -la"));
        assert!(Shell::is_shell_command_static("git status"));
        assert!(Shell::is_shell_command_static("npm install"));
        assert!(Shell::is_shell_command_static("cargo build"));
        assert!(Shell::is_shell_command_static("python script.py"));
        assert!(Shell::is_shell_command_static("node app.js"));
        assert!(Shell::is_shell_command_static("docker ps"));
        assert!(Shell::is_shell_command_static("kubectl get pods"));
        
        // Test with cd command
        assert!(Shell::is_shell_command_static("cd /home"));
        assert!(Shell::is_shell_command_static("cd .."));
        
        // Test non-shell commands (conversational)
        assert!(!Shell::is_shell_command_static("how do I use git?"));
        assert!(!Shell::is_shell_command_static("explain this code"));
        assert!(!Shell::is_shell_command_static("help me debug"));
        assert!(!Shell::is_shell_command_static("what is rust?"));
        assert!(!Shell::is_shell_command_static(""));
        
        // Test edge cases
        assert!(!Shell::is_shell_command_static("this is a long sentence that doesn't look like a command"));
        assert!(Shell::is_shell_command_static("./script.sh"));
        assert!(!Shell::is_shell_command_static("~/bin/my_script")); // ~ expansion not supported
        
        // Test commands with complex arguments
        assert!(Shell::is_shell_command_static("find . -name '*.rs' -type f"));
        assert!(Shell::is_shell_command_static("grep -r 'pattern' src/"));
    }

    #[tokio::test]
    async fn test_is_shell_command() {
        let shell = create_test_shell().await;
        
        // Test that instance method delegates to static method
        assert!(shell.is_shell_command("ls -la"));
        assert!(!shell.is_shell_command("how do I use git?"));
        assert!(shell.is_shell_command("cargo test"));
        assert!(!shell.is_shell_command("explain this function"));
    }

    #[tokio::test]
    async fn test_prepare_tool_args() {
        let shell = create_test_shell().await;
        
        // Test shell_command tool
        let tool_call = ToolCall {
            name: "shell_command".to_string(),
            args: "ls -la".to_string(),
        };
        let args = shell.prepare_tool_args(&tool_call);
        let expected = json!({"command": "ls -la"});
        assert_eq!(args, expected);
        
        // Test write_file tool with newline-separated format
        let tool_call = ToolCall {
            name: "write_file".to_string(),
            args: "test.txt\nHello, world!".to_string(),
        };
        let args = shell.prepare_tool_args(&tool_call);
        let expected = json!({"path": "test.txt", "content": "Hello, world!"});
        assert_eq!(args, expected);
        
        // Test write_file tool with single argument (no content)
        let tool_call = ToolCall {
            name: "write_file".to_string(),
            args: "test.txt".to_string(),
        };
        let args = shell.prepare_tool_args(&tool_call);
        let expected = json!({"path": "test.txt", "content": ""});
        assert_eq!(args, expected);
        
        // Test read_file tool
        let tool_call = ToolCall {
            name: "read_file".to_string(),
            args: "test.txt".to_string(),
        };
        let args = shell.prepare_tool_args(&tool_call);
        let expected = json!({"path": "test.txt"});
        assert_eq!(args, expected);
        
        // Test git_command tool
        let tool_call = ToolCall {
            name: "git_command".to_string(),
            args: "status".to_string(),
        };
        let args = shell.prepare_tool_args(&tool_call);
        let expected = json!({"command": "status"});
        assert_eq!(args, expected);
        
        // Test code_analysis tool
        let tool_call = ToolCall {
            name: "code_analysis".to_string(),
            args: "src/main.rs".to_string(),
        };
        let args = shell.prepare_tool_args(&tool_call);
        let expected = json!({"path": "src/main.rs"});
        assert_eq!(args, expected);
        
        // Test unknown tool (should use args format)
        let tool_call = ToolCall {
            name: "unknown_tool".to_string(),
            args: "some args".to_string(),
        };
        let args = shell.prepare_tool_args(&tool_call);
        let expected = json!({"args": "some args"});
        assert_eq!(args, expected);
    }

    #[tokio::test]
    async fn test_display_tool_output() {
        let shell = create_test_shell().await;
        
        // This function outputs to stdout, so we can't easily test it
        // without capturing stdout. For now, we just verify it doesn't panic
        shell.display_tool_output("Test output");
        shell.display_tool_output("Multi\nline\noutput");
        shell.display_tool_output("");
        
        // Test with long output
        let long_output = "x".repeat(1000);
        shell.display_tool_output(&long_output);
    }

    #[test]
    fn test_shell_command_detection_edge_cases() {
        // Test commands that start with common shell tools
        assert!(Shell::is_shell_command_static("ls"));
        assert!(Shell::is_shell_command_static("cat file.txt"));
        assert!(Shell::is_shell_command_static("grep pattern file"));
        assert!(Shell::is_shell_command_static("find . -name '*.rs'"));
        assert!(Shell::is_shell_command_static("awk '{print $1}' file"));
        assert!(Shell::is_shell_command_static("sed 's/old/new/g' file"));
        
        // Test path-based commands
        assert!(Shell::is_shell_command_static("./build.sh"));
        assert!(Shell::is_shell_command_static("/usr/bin/python3"));
        assert!(!Shell::is_shell_command_static("~/scripts/deploy.sh")); // ~ expansion not supported
        
        // Test commands with pipes and redirects (only first word matters)
        assert!(Shell::is_shell_command_static("ls | grep test"));
        assert!(Shell::is_shell_command_static("cat file > output.txt"));
        assert!(Shell::is_shell_command_static("echo hello >> log.txt"));
        
        // Test questions vs commands
        assert!(!Shell::is_shell_command_static("how do I list files?"));
        assert!(!Shell::is_shell_command_static("what does ls do?"));
        assert!(!Shell::is_shell_command_static("can you explain git?"));
        
        // Test ambiguous cases
        assert!(!Shell::is_shell_command_static("show me the files"));
        assert!(!Shell::is_shell_command_static("list all processes"));
        assert!(Shell::is_shell_command_static("ps aux"));
        assert!(!Shell::is_shell_command_static("check if the server is running"));
        assert!(Shell::is_shell_command_static("curl http://example.com"));
    }

    #[test]
    fn test_sanitize_input_edge_cases() {
        // We need to create a shell instance for this test
        tokio::runtime::Runtime::new().unwrap().block_on(async {
            let shell = create_test_shell().await;
            
            // Test Unicode input
            let result = shell.sanitize_input("echo 'Hello 世界'");
            assert!(result.is_ok());
            assert_eq!(result.unwrap(), "echo 'Hello 世界'");
            
            // Test input with tabs and newlines
            let result = shell.sanitize_input("echo\t'hello'\nworld");
            assert!(result.is_ok());
            assert_eq!(result.unwrap(), "echo\t'hello'\nworld");
            
            // Test input with null bytes (should be filtered out)
            let result = shell.sanitize_input("echo\0hello");
            assert!(result.is_ok());
            assert_eq!(result.unwrap(), "echohello");
            
            // Test input with control characters (should be filtered out)
            let result = shell.sanitize_input("echo\x01hello");
            assert!(result.is_ok());
            assert_eq!(result.unwrap(), "echohello");
        });
    }

    #[tokio::test]
    async fn test_shell_creation_with_custom_config() {
        let mut config = Config::default();
        config.model = "custom-model".to_string();
        config.server = "http://custom:8080".to_string();
        config.temperature = 0.5;
        
        let shell = Shell::new(config).await;
        assert!(shell.is_ok());
        
        // Shell should be created successfully with custom config
        let _shell = shell.unwrap();
    }

    #[test]
    fn test_tool_args_preparation_comprehensive() {
        tokio::runtime::Runtime::new().unwrap().block_on(async {
            let shell = create_test_shell().await;
            
            // Test all supported tools with simple string args (the actual format used)
            let test_cases = vec![
                (
                    "shell_command",
                    "echo hello",
                    json!({"command": "echo hello"})
                ),
                (
                    "write_file", 
                    "test.txt\ncontent",
                    json!({"path": "test.txt", "content": "content"})
                ),
                (
                    "read_file",
                    "test.txt",
                    json!({"path": "test.txt"})
                ),
                (
                    "git_command",
                    "status",
                    json!({"command": "status"})
                ),
                (
                    "code_analysis",
                    "src/main.rs",
                    json!({"path": "src/main.rs"})
                ),
            ];
            
            for (tool_name, args_str, expected) in test_cases {
                let tool_call = ToolCall {
                    name: tool_name.to_string(),
                    args: args_str.to_string(),
                };
                let result = shell.prepare_tool_args(&tool_call);
                assert_eq!(result, expected, "Failed for tool: {}", tool_name);
            }
            
            // Test fallback behavior for unknown tools
            let fallback_cases = vec![
                ("shell_command", "plain text", json!({"command": "plain text"})),
                ("git_command", "commit -m message", json!({"command": "commit -m message"})),
                ("unknown_tool", "some args", json!({"args": "some args"})),
            ];
            
            for (tool_name, args_str, expected) in fallback_cases {
                let tool_call = ToolCall {
                    name: tool_name.to_string(),
                    args: args_str.to_string(),
                };
                let result = shell.prepare_tool_args(&tool_call);
                assert_eq!(result, expected, "Failed fallback for tool: {}", tool_name);
            }
        });
    }

    #[test]
    fn test_ansi_code_stripping_comprehensive() {
        // Test various ANSI escape sequences based on the actual regex pattern
        let test_cases = vec![
            // Basic color codes (these should work)
            ("\x1b[31mred\x1b[0m", "red"),
            ("\x1b[1;32mgreen\x1b[0m", "green"),
            ("\x1b[2;37mgray\x1b[0m", "gray"),
            
            // Multiple codes in sequence
            ("\x1b[1m\x1b[31mbold red\x1b[0m", "bold red"),
            ("\x1b[33m\x1b[1myellow bold\x1b[0m", "yellow bold"),
            
            // Cursor movement codes (H is supported by regex)
            ("\x1b[2J\x1b[Hclear screen", "\x1b[2Jclear screen"), // J not in regex, H is
            ("\x1b[1Amove up", "\x1b[1Amove up"), // A not in regex
            
            // Mixed content
            ("normal \x1b[31mred\x1b[0m normal", "normal red normal"),
            
            // No ANSI codes
            ("plain text", "plain text"),
            
            // Empty string
            ("", ""),
            
            // Only ANSI codes that match the regex
            ("\x1b[31m\x1b[0m", ""),
        ];
        
        for (input, expected) in test_cases {
            let result = Shell::strip_ansi_codes(input);
            assert_eq!(result, expected, "Failed for input: {:?}", input);
        }
    }
}