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
use tracing::{error, info};

use crate::ai::{AiClient, StreamEvent, ToolCall};
use crate::config::Config;
use crate::tools::ToolExecutor;

pub struct Shell {
    ai_client: AiClient,
    tool_executor: ToolExecutor,
    config: Config,
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

Always be helpful, professional, and focused on empowering the user's development workflow. You are their intelligent terminal companion."
        );
        
        Ok(Self {
            ai_client,
            tool_executor: ToolExecutor::new(),
            config,
        })
    }
    
    pub async fn process_prompt(&self, prompt: &str) -> Result<()> {
        info!("Processing prompt: {}", prompt);
        
        // For non-interactive mode, just print the response
        let mut ai_client = self.ai_client.clone();
        let mut tool_executor = self.tool_executor.clone();
        
        let mut stream = ai_client.chat_stream(prompt).await?;
        
        while let Some(event) = stream.recv().await {
            match event {
                StreamEvent::Text(text) => {
                    print!("{}", text);
                    io::Write::flush(&mut io::stdout())?;
                }
                StreamEvent::Think(thinking) => {
                    println!("\n{}", thinking);
                }
                StreamEvent::ThinkStart => {
                    print!("\n");
                    io::Write::flush(&mut io::stdout())?;
                }
                StreamEvent::ThinkPartial(partial) => {
                    print!("{}", partial);
                    io::Write::flush(&mut io::stdout())?;
                }
                StreamEvent::ThinkEnd => {
                    print!("\n");
                    io::Write::flush(&mut io::stdout())?;
                }
                StreamEvent::ToolCall(tool_call) => {
                    println!("\n[Executing: {} with args: {}]", tool_call.name, tool_call.args);
                    
                    // Execute the tool
                    let args = serde_json::json!({
                        "command": tool_call.args,
                        "path": tool_call.args,
                        "content": tool_call.args
                    });
                    
                    match tool_executor.execute_tool(&tool_call.name, &args).await {
                        Ok(result) => {
                            println!("Tool result: {}", result);
                            ai_client.add_tool_result(&tool_call.name, &result);
                            
                            // Continue the conversation with the tool result
                            let mut continue_stream = ai_client.chat_stream("").await?;
                            while let Some(continue_event) = continue_stream.recv().await {
                                match continue_event {
                                    StreamEvent::Text(text) => {
                                        print!("{}", text);
                                        io::Write::flush(&mut io::stdout())?;
                                    }
                                    StreamEvent::Think(thinking) => {
                                        println!("\n{}", thinking);
                                    }
                                    StreamEvent::ThinkStart => {
                                        print!("\n\x1b[2;37m");
                                        io::Write::flush(&mut io::stdout())?;
                                    }
                                    StreamEvent::ThinkPartial(partial) => {
                                        print!("\x1b[2;37m{}", partial);
                                        io::Write::flush(&mut io::stdout())?;
                                    }
                                    StreamEvent::ThinkEnd => {
                                        print!("\x1b[0m\n");
                                        io::Write::flush(&mut io::stdout())?;
                                    }
                                    StreamEvent::ToolCall(tool_call) => {
                                        println!("\n[Executing: {} with args: {}]", tool_call.name, tool_call.args);
                                    }
                                    StreamEvent::Error(error) => {
                                        println!("\nError: {}", error);
                                    }
                                    StreamEvent::Done => break,
                                }
                            }
                        }
                        Err(e) => {
                            println!("Tool execution failed: {}", e);
                        }
                    }
                }
                StreamEvent::Error(error) => {
                    println!("\nError: {}", error);
                }
                StreamEvent::Done => {
                    println!();
                    break;
                }
            }
        }
        
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
        
        // Handle special commands first
        if input.trim().eq_ignore_ascii_case("edit config") {
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
        if self.is_shell_command(input) {
            // Execute directly as shell command
            let args = serde_json::json!({
                "command": input
            });
            
            match self.tool_executor.execute_tool("shell_command", &args).await {
                Ok(result) => {
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
                    eprintln!("\x1b[1;31mShell command failed:\x1b[0m {}", e);
                }
            }
        } else {
            // Process with AI
            let mut stream = self.ai_client.chat_stream(input).await?;
            
            while let Some(event) = stream.recv().await {
                match event {
                    crate::ai::StreamEvent::Text(text) => {
                        print!("{}", text);
                        io::stdout().flush()?;
                    }
                    crate::ai::StreamEvent::Think(thinking) => {
                        println!("\n\x1b[2;37m{}\x1b[0m", thinking);
                        io::stdout().flush()?;
                    }
                    crate::ai::StreamEvent::ThinkStart => {
                        print!("\n\x1b[2;37m");
                        io::stdout().flush()?;
                    }
                    crate::ai::StreamEvent::ThinkPartial(partial) => {
                        print!("\x1b[2;37m{}", partial);
                        io::stdout().flush()?;
                    }
                    crate::ai::StreamEvent::ThinkEnd => {
                        print!("\x1b[0m\n");
                        io::stdout().flush()?;
                    }
                    crate::ai::StreamEvent::ToolCall(tool_call) => {
                        println!("\n\x1b[33mExecuting\x1b[0m \x1b[1;36m{}\x1b[0m \x1b[90mwith args:\x1b[0m \x1b[37m{}\x1b[0m", tool_call.name, tool_call.args);
                        
                        // Execute the tool
                        let args = self.prepare_tool_args(&tool_call);
                        
                        match self.tool_executor.execute_tool(&tool_call.name, &args).await {
                            Ok(result) => {
                                let cleaned_result = Self::strip_ansi_codes(&result);
                                self.display_tool_output(&cleaned_result);
                                self.ai_client.add_tool_result(&tool_call.name, &result);
                                
                                // Continue the conversation with the tool result
                                let mut continue_stream = self.ai_client.chat_stream("").await?;
                                while let Some(continue_event) = continue_stream.recv().await {
                                    match continue_event {
                                        crate::ai::StreamEvent::Text(text) => {
                                            print!("{}", text);
                                            io::stdout().flush()?;
                                        }
                                        crate::ai::StreamEvent::Think(thinking) => {
                                            println!("\n\x1b[2;37m{}\x1b[0m", thinking);
                                            io::stdout().flush()?;
                                        }
                                        crate::ai::StreamEvent::ThinkStart => {
                                            print!("\n\x1b[2;37m");
                                            io::stdout().flush()?;
                                        }
                                        crate::ai::StreamEvent::ThinkPartial(partial) => {
                                            print!("\x1b[2;37m{}", partial);
                                            io::stdout().flush()?;
                                        }
                                        crate::ai::StreamEvent::ThinkEnd => {
                                            print!("\x1b[0m\n");
                                            io::stdout().flush()?;
                                        }
                                        crate::ai::StreamEvent::ToolCall(tool_call) => {
                                            // Handle nested tool calls if needed
                                            println!("\n\x1b[33mExecuting\x1b[0m \x1b[1;36m{}\x1b[0m \x1b[90mwith args:\x1b[0m \x1b[37m{}\x1b[0m", tool_call.name, tool_call.args);
                                        }
                                        crate::ai::StreamEvent::Done => break,
                                        crate::ai::StreamEvent::Error(error) => {
                                            eprintln!("\n\x1b[1;31mError:\x1b[0m {}", error);
                                        }
                                    }
                                }
                            }
                            Err(e) => {
                                eprintln!("\x1b[1;31mTool execution failed:\x1b[0m {}", e);
                            }
                        }
                    }
                    crate::ai::StreamEvent::Error(error) => {
                        eprintln!("\n\x1b[1;31mError:\x1b[0m {}", error);
                    }
                    crate::ai::StreamEvent::Done => {
                        break;
                    }
                }
            }
        }
        
        Ok(())
    }
    
    fn prepare_tool_args(&self, tool_call: &crate::ai::ToolCall) -> serde_json::Value {
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
    
    fn is_shell_command(&self, input: &str) -> bool {
        let shell_commands = [
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
        shell_commands.contains(&first_word) || first_word.starts_with("./") || first_word.starts_with("/")
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
        // Simple regex to remove ANSI escape codes
        let ansi_regex = regex::Regex::new(r"\x1b\[[0-9;]*[mGKH]").unwrap_or_else(|_| {
            // Fallback: remove common ANSI sequences manually
            regex::Regex::new(r"\x1b\[[0-9;]*m").unwrap()
        });
        ansi_regex.replace_all(text, "").to_string()
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
                    self.messages.push(DisplayMessage::ToolResult("shell".to_string(), result));
                    self.scroll_to_bottom();
                }
                Err(e) => {
                    self.messages.push(DisplayMessage::Error(format!("Shell command failed: {}", e)));
                    self.scroll_to_bottom();
                }
            }
        } else {
            // Process with AI
            match self.ai_client.chat_stream(input).await {
                Ok(mut stream) => {
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
                                // This is for the unused TUI mode, main interactive mode handles it differently
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
                                        
                                        // Continue with AI response after tool execution
                                        if let Ok(mut continue_stream) = self.ai_client.chat_stream("").await {
                                            while let Some(continue_event) = continue_stream.recv().await {
                                                match continue_event {
                                                    StreamEvent::Text(text) => {
                                                        self.current_response.push_str(&text);
                                                    }
                                                    StreamEvent::Think(thinking) => {
                                                        self.messages.push(DisplayMessage::Thinking(thinking));
                                                    }
                                                    StreamEvent::ThinkStart => {
                                                        // Start of thinking block - for TUI mode
                                                    }
                                                    StreamEvent::ThinkPartial(_partial) => {
                                                        // For TUI mode - could accumulate or display later
                                                    }
                                                    StreamEvent::ThinkEnd => {
                                                        // End of thinking block - for TUI mode
                                                    }
                                                    StreamEvent::ToolCall(nested_tool_call) => {
                                                        // Handle nested tool calls if needed
                                                        self.messages.push(DisplayMessage::ToolCall(
                                                            nested_tool_call.name.clone(),
                                                            nested_tool_call.args.clone()
                                                        ));
                                                    }
                                                    StreamEvent::Error(error) => {
                                                        self.messages.push(DisplayMessage::Error(error));
                                                    }
                                                    StreamEvent::Done => break,
                                                }
                                            }
                                        }
                                    }
                                    Err(e) => {
                                        self.messages.push(DisplayMessage::Error(
                                            format!("Tool execution failed: {}", e)
                                        ));
                                        self.scroll_to_bottom();
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
                                    self.current_response.clear();
                                }
                                self.scroll_to_bottom();
                                break;
                            }
                        }
                    }
                }
                Err(e) => {
                    self.messages.push(DisplayMessage::Error(format!("AI request failed: {}", e)));
                }
            }
        }
        
        self.processing = false;
        Ok(())
    }
    
    fn is_shell_command(&self, input: &str) -> bool {
        let shell_commands = [
            "ls", "cd", "pwd", "mkdir", "rmdir", "rm", "cp", "mv", "cat", "less", "more",
            "grep", "find", "which", "whereis", "ps", "top", "kill", "killall", "jobs",
            "git", "npm", "cargo", "python", "node", "java", "gcc", "make", "cmake",
            "docker", "kubectl", "curl", "wget", "ssh", "scp", "rsync", "tar", "gzip",
            "echo", "printf", "date", "whoami", "id", "uname", "df", "du", "free",
            "history", "alias", "export", "env", "printenv", "set", "unset",
        ];
        
        let first_word = input.split_whitespace().next().unwrap_or("");
        shell_commands.contains(&first_word) || first_word.starts_with("./") || first_word.starts_with("/")
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