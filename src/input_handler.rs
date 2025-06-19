use anyhow::Result;
use crossterm::{
    cursor::{self, MoveLeft, MoveRight, MoveToColumn},
    event::{self, Event, KeyCode, KeyEvent, KeyModifiers},
    style::{Color, Print, ResetColor, SetForegroundColor},
    terminal::{self, Clear, ClearType},
    ExecutableCommand, QueueableCommand,
};
use std::io::{self, Write};
use std::collections::VecDeque;
use std::time::Duration;
use tracing::debug;

use crate::completion::{Completion, CompletionEngine};

#[derive(Debug)]
pub enum InputResult {
    Input(String),
    Exit,
    CycleMode,
}

/// Calculate the visual width of a string with ANSI escape codes
fn visual_width(text: &str) -> usize {
    let mut result = String::new();
    let mut chars = text.chars().peekable();
    
    while let Some(ch) = chars.next() {
        if ch == '\x1b' {
            // Skip ANSI escape sequence
            if chars.peek() == Some(&'[') {
                chars.next(); // consume '['
                // Skip until we find a letter (end of escape sequence)
                while let Some(next_ch) = chars.next() {
                    if next_ch.is_ascii_alphabetic() {
                        break;
                    }
                }
            }
        } else {
            result.push(ch);
        }
    }
    
    result.chars().count()
}

/// Character classification for word boundary detection (BASH-compatible)
fn is_word_char(c: char) -> bool {
    c.is_alphanumeric() || c == '_'
}

fn is_separator(c: char) -> bool {
    !is_word_char(c)
}

/// Find the start position of the previous word (BASH-compatible behavior)
fn find_previous_word_start(chars: &[char], cursor_pos: usize) -> usize {
    if cursor_pos == 0 || chars.is_empty() {
        return 0;
    }
    
    let mut pos = cursor_pos;
    
    // If we're at the end of the line or in the middle of a word,
    // first move to the beginning of the current word or skip separators
    if pos > 0 {
        // If cursor is right after a word character, and we're not at a word boundary,
        // move to the start of the current word first
        if pos < chars.len() && is_word_char(chars[pos]) {
            // We're in the middle of a word, find its start
            while pos > 0 && is_word_char(chars[pos - 1]) {
                pos -= 1;
            }
            // If we moved to the start of the current word and it's not the beginning,
            // continue to find the previous word
            if pos > 0 {
                pos -= 1;
            } else {
                return pos;
            }
        } else if pos < chars.len() && !is_word_char(chars[pos]) && pos > 0 && is_word_char(chars[pos - 1]) {
            // We're right after a word, move to its start
            while pos > 0 && is_word_char(chars[pos - 1]) {
                pos -= 1;
            }
            return pos;
        } else {
            // We're in separators or at the start, move backward
            pos -= 1;
        }
    }
    
    // Skip any separators
    while pos > 0 && is_separator(chars[pos]) {
        pos -= 1;
    }
    
    // Find the start of the word we're now in
    while pos > 0 && is_word_char(chars[pos - 1]) {
        pos -= 1;
    }
    
    pos
}

/// Find the start position of the next word (BASH-compatible behavior)
fn find_next_word_start(chars: &[char], cursor_pos: usize) -> usize {
    if chars.is_empty() {
        return 0;
    }
    
    let mut pos = cursor_pos;
    
    // Skip to the end of the current word if we're in one
    while pos < chars.len() && is_word_char(chars[pos]) {
        pos += 1;
    }
    
    // Skip any separators
    while pos < chars.len() && is_separator(chars[pos]) {
        pos += 1;
    }
    
    pos
}

/// Find the start of the current word that the cursor is in or at the end of
fn find_current_word_start(chars: &[char], cursor_pos: usize) -> usize {
    if chars.is_empty() || cursor_pos == 0 {
        return 0;
    }
    
    let mut pos = cursor_pos;
    
    // If we're right after a word character, we need to find the start of that word
    if pos > 0 && pos <= chars.len() && 
       (pos == chars.len() || !is_word_char(chars[pos])) && 
       is_word_char(chars[pos - 1]) {
        pos -= 1;
    }
    
    // If we're in a word, find its start
    if pos < chars.len() && is_word_char(chars[pos]) {
        while pos > 0 && is_word_char(chars[pos - 1]) {
            pos -= 1;
        }
    }
    
    pos
}

#[derive(Debug)]
pub struct InputState {
    pub line: String,
    pub cursor_pos: usize, // Character position, not byte position
    pub history: VecDeque<String>,
    pub history_index: Option<usize>,
    pub completion_candidates: Vec<Completion>,
    pub completion_index: Option<usize>,
    pub show_completions: bool,
}

impl InputState {
    pub fn new() -> Self {
        Self {
            line: String::new(),
            cursor_pos: 0,
            history: VecDeque::new(),
            history_index: None,
            completion_candidates: Vec::new(),
            completion_index: None,
            show_completions: false,
        }
    }
    
    pub fn add_to_history(&mut self, line: String) {
        if !line.trim().is_empty() {
            // Remove duplicate if exists
            if let Some(pos) = self.history.iter().position(|x| x == &line) {
                self.history.remove(pos);
            }
            
            // Add to front
            self.history.push_front(line);
            
            // Limit history size
            if self.history.len() > 1000 {
                self.history.pop_back();
            }
        }
        
        self.reset_history_navigation();
    }
    
    pub fn reset_history_navigation(&mut self) {
        self.history_index = None;
    }
    
    pub fn clear_completions(&mut self) {
        self.completion_candidates.clear();
        self.completion_index = None;
        self.show_completions = false;
    }
    
    pub fn reset_line(&mut self) {
        self.line.clear();
        self.cursor_pos = 0;
        self.clear_completions();
        self.reset_history_navigation();
    }
}

pub struct InputHandler {
    state: InputState,
}

impl InputHandler {
    pub fn new() -> Self {
        Self {
            state: InputState::new(),
        }
    }
    
    /// Read a line of input with completion support
    pub async fn readline(&mut self, prompt: &str, completion_engine: &CompletionEngine) -> Result<InputResult> {
        let mut stdout = io::stdout();
        
        // Enable raw mode for character-by-character input
        terminal::enable_raw_mode()?;
        
        // Print initial prompt
        stdout.execute(Print(prompt))?;
        stdout.flush()?;
        
        self.state.reset_line();
        
        loop {
            match event::read()? {
                Event::Key(key_event) => {
                    match self.handle_key_event(key_event, prompt, completion_engine, &mut stdout).await? {
                        InputAction::Continue => continue,
                        InputAction::Submit(line) => {
                            terminal::disable_raw_mode()?;
                            stdout.execute(Print("\r\n"))?;
                            stdout.flush()?;
                            
                            if !line.trim().is_empty() {
                                self.state.add_to_history(line.clone());
                            }
                            
                            return Ok(InputResult::Input(line));
                        }
                        InputAction::Exit => {
                            terminal::disable_raw_mode()?;
                            stdout.execute(Print("\r\n"))?;
                            stdout.flush()?;
                            return Ok(InputResult::Exit);
                        }
                        InputAction::CycleMode => {
                            terminal::disable_raw_mode()?;
                            return Ok(InputResult::CycleMode);
                        }
                        InputAction::Interrupt => {
                            terminal::disable_raw_mode()?;
                            stdout.execute(Print("^C\r\n"))?;
                            stdout.flush()?;
                            return Ok(InputResult::Exit);
                        }
                    }
                }
                _ => continue,
            }
        }
    }
    
    async fn handle_key_event(
        &mut self,
        key_event: KeyEvent,
        prompt: &str,
        completion_engine: &CompletionEngine,
        stdout: &mut io::Stdout,
    ) -> Result<InputAction> {
        match (key_event.code, key_event.modifiers) {
            // Submit line
            (KeyCode::Enter, _) => {
                self.state.clear_completions();
                
                // Check for exit command
                let trimmed = self.state.line.trim();
                if trimmed.eq_ignore_ascii_case("exit") {
                    return Ok(InputAction::Exit);
                }
                
                return Ok(InputAction::Submit(self.state.line.clone()));
            }
            
            // Ctrl+C to clear current line
            (KeyCode::Char('c'), KeyModifiers::CONTROL) => {
                stdout.execute(Print("^C\r\n"))?;
                self.state.reset_line();
                stdout.execute(Print(prompt))?;
                stdout.flush()?;
                
                return Ok(InputAction::Continue);
            }
            
            // Tab completion and mode cycling
            (KeyCode::Tab, KeyModifiers::SHIFT) => {
                return Ok(InputAction::CycleMode);
            }
            (KeyCode::Tab, _) => {
                self.handle_tab_completion(completion_engine, prompt, stdout).await?;
            }
            
            // Character input
            (KeyCode::Char(c), _) => {
                self.state.clear_completions();
                self.insert_char(c, prompt, stdout)?;
            }
            
            // Backspace
            (KeyCode::Backspace, KeyModifiers::ALT) => {
                self.state.clear_completions();
                self.delete_previous_word(prompt, stdout)?;
            }
            (KeyCode::Backspace, _) => {
                self.state.clear_completions();
                self.handle_backspace(prompt, stdout)?;
            }
            
            // Delete
            (KeyCode::Delete, _) => {
                self.state.clear_completions();
                self.handle_delete(prompt, stdout)?;
            }
            
            // Left arrow
            (KeyCode::Left, KeyModifiers::ALT) => {
                self.state.clear_completions();
                self.move_to_previous_word(prompt, stdout)?;
            }
            (KeyCode::Left, _) => {
                self.state.clear_completions();
                self.move_cursor_left(stdout)?;
            }
            
            // Right arrow
            (KeyCode::Right, KeyModifiers::ALT) => {
                self.state.clear_completions();
                self.move_to_next_word(prompt, stdout)?;
            }
            (KeyCode::Right, _) => {
                self.state.clear_completions();
                self.move_cursor_right(stdout)?;
            }
            
            // Up arrow - history navigation
            (KeyCode::Up, _) => {
                self.state.clear_completions();
                self.navigate_history_up(prompt, stdout)?;
            }
            
            // Down arrow - history navigation
            (KeyCode::Down, _) => {
                self.state.clear_completions();
                self.navigate_history_down(prompt, stdout)?;
            }
            
            // Home
            (KeyCode::Home, _) => {
                self.state.clear_completions();
                self.move_cursor_to_start(prompt, stdout)?;
            }
            
            // End
            (KeyCode::End, _) => {
                self.state.clear_completions();
                self.move_cursor_to_end(prompt, stdout)?;
            }
            
            _ => {
                // Clear completions for any unhandled key
                self.state.clear_completions();
            }
        }
        
        Ok(InputAction::Continue)
    }
    
    async fn handle_tab_completion(
        &mut self,
        completion_engine: &CompletionEngine,
        prompt: &str,
        stdout: &mut io::Stdout,
    ) -> Result<()> {
        if !self.state.show_completions {
            // First tab: get completions and try to complete common prefix
            self.state.completion_candidates = completion_engine.get_completions(&self.state.line, self.state.cursor_pos);
            
            if self.state.completion_candidates.is_empty() {
                // No completions available
                return Ok(());
            }
            
            if self.state.completion_candidates.len() == 1 {
                // Single completion: apply it directly
                self.state.completion_index = Some(0);
                self.apply_completion(prompt, stdout)?;
                self.state.clear_completions();
            } else {
                // Multiple completions: try to complete common prefix
                if let Some(common_prefix) = self.find_common_prefix() {
                    let (word_start, current_word) = self.extract_completion_word();
                    
                    if common_prefix.len() > current_word.len() {
                        // We can extend the current word with common prefix
                        self.complete_with_prefix(&common_prefix, word_start, prompt, stdout)?;
                        self.state.clear_completions();
                    } else {
                        // No common prefix extension possible, show candidates on next tab
                        self.state.show_completions = true;
                    }
                } else {
                    // No common prefix, show candidates on next tab
                    self.state.show_completions = true;
                }
            }
        } else {
            // Second tab: show completion candidates
            self.display_completion_candidates(prompt, stdout)?;
        }
        
        Ok(())
    }
    
    fn cycle_completion_forward(&mut self, prompt: &str, stdout: &mut io::Stdout) -> Result<()> {
        if let Some(current_index) = self.state.completion_index {
            let next_index = (current_index + 1) % self.state.completion_candidates.len();
            self.state.completion_index = Some(next_index);
            self.apply_completion(prompt, stdout)?;
            self.display_completion_candidates(prompt, stdout)?;
        }
        Ok(())
    }
    
    fn cycle_completion_backward(&mut self, prompt: &str, stdout: &mut io::Stdout) -> Result<()> {
        if let Some(current_index) = self.state.completion_index {
            let next_index = if current_index == 0 {
                self.state.completion_candidates.len() - 1
            } else {
                current_index - 1
            };
            self.state.completion_index = Some(next_index);
            self.apply_completion(prompt, stdout)?;
            self.display_completion_candidates(prompt, stdout)?;
        }
        Ok(())
    }
    
    fn apply_completion(&mut self, prompt: &str, stdout: &mut io::Stdout) -> Result<()> {
        if let Some(index) = self.state.completion_index {
            if let Some(completion) = self.state.completion_candidates.get(index) {
                // Extract the word being completed
                let (word_start, _) = self.extract_completion_word();
                
                // Replace the partial word with the completion
                let new_line = format!(
                    "{}{}{}",
                    &self.state.line[..word_start],
                    &completion.text,
                    &self.state.line[self.state.cursor_pos..]
                );
                
                let new_cursor_pos = word_start + completion.text.len();
                
                self.state.line = new_line;
                self.state.cursor_pos = new_cursor_pos;
                
                self.redraw_line(prompt, stdout)?;
            }
        }
        Ok(())
    }
    
    fn find_common_prefix(&self) -> Option<String> {
        if self.state.completion_candidates.is_empty() {
            return None;
        }
        
        let first = &self.state.completion_candidates[0].text;
        let mut common_len = first.len();
        
        for completion in &self.state.completion_candidates[1..] {
            let mut chars1 = first.chars();
            let mut chars2 = completion.text.chars();
            let mut current_len = 0;
            
            while let (Some(c1), Some(c2)) = (chars1.next(), chars2.next()) {
                if c1 == c2 {
                    current_len += c1.len_utf8();
                } else {
                    break;
                }
            }
            
            common_len = common_len.min(current_len);
        }
        
        if common_len > 0 {
            Some(first[..common_len].to_string())
        } else {
            None
        }
    }
    
    fn complete_with_prefix(
        &mut self,
        prefix: &str,
        word_start: usize,
        prompt: &str,
        stdout: &mut io::Stdout,
    ) -> Result<()> {
        // Replace the current word with the prefix
        let new_line = format!(
            "{}{}{}",
            &self.state.line[..word_start],
            prefix,
            &self.state.line[self.state.cursor_pos..]
        );
        
        let new_cursor_pos = word_start + prefix.len();
        
        self.state.line = new_line;
        self.state.cursor_pos = new_cursor_pos;
        
        self.redraw_line(prompt, stdout)?;
        Ok(())
    }
    
    fn display_completion_candidates(&self, _prompt: &str, stdout: &mut io::Stdout) -> Result<()> {
        // Save cursor position
        let (_current_col, current_row) = cursor::position()?;
        
        // Move to next line and display completions in a more bash-like format
        stdout.execute(cursor::MoveTo(0, current_row + 1))?;
        stdout.execute(SetForegroundColor(Color::DarkGrey))?;
        
        // Show completions in columns like bash
        let max_width = 80; // Assume 80-character terminal width
        let mut current_width = 0;
        
        for (_i, completion) in self.state.completion_candidates.iter().enumerate().take(20) {
            let type_indicator = match completion.completion_type {
                crate::completion::CompletionType::Directory => "/",
                crate::completion::CompletionType::File => "",
                crate::completion::CompletionType::Command => "",
                crate::completion::CompletionType::History => "",
            };
            
            let display_text = format!("{}{}", completion.text, type_indicator);
            let text_width = display_text.len() + 2; // +2 for spacing
            
            if current_width + text_width > max_width && current_width > 0 {
                // Start new line
                stdout.execute(Print("\r\n"))?;
                current_width = 0;
            }
            
            stdout.execute(Print(format!("{}  ", display_text)))?;
            current_width += text_width;
        }
        
        if self.state.completion_candidates.len() > 20 {
            stdout.execute(Print(format!("\r\n... and {} more", self.state.completion_candidates.len() - 20)))?;
        }
        
        stdout.execute(ResetColor)?;
        stdout.execute(Print("\r\n"))?;
        
        // Redraw the prompt and current line
        stdout.execute(Print(_prompt))?;
        stdout.execute(Print(&self.state.line))?;
        
        // Position cursor correctly
        let prompt_len = visual_width(_prompt);
        stdout.execute(cursor::MoveTo((prompt_len + self.state.cursor_pos) as u16, current_row + 2))?;
        
        stdout.flush()?;
        
        Ok(())
    }
    
    fn extract_completion_word(&self) -> (usize, String) {
        let chars: Vec<char> = self.state.line.chars().collect();
        let safe_pos = std::cmp::min(self.state.cursor_pos, chars.len());
        
        // Find word boundaries (character-based)
        let mut word_start = safe_pos;
        while word_start > 0 {
            if let Some(ch) = chars.get(word_start - 1) {
                if ch.is_whitespace() {
                    break;
                }
            }
            word_start -= 1;
        }
        
        let word: String = chars[word_start..safe_pos].iter().collect();
        (word_start, word)
    }
    
    fn insert_char(&mut self, c: char, prompt: &str, stdout: &mut io::Stdout) -> Result<()> {
        // cursor_pos is now character position, so we can use it directly
        let mut chars: Vec<char> = self.state.line.chars().collect();
        chars.insert(self.state.cursor_pos, c);
        self.state.line = chars.into_iter().collect();
        
        // Update cursor position by one character
        self.state.cursor_pos += 1;
        self.redraw_line(prompt, stdout)?;
        Ok(())
    }
    
    fn handle_backspace(&mut self, prompt: &str, stdout: &mut io::Stdout) -> Result<()> {
        if self.state.cursor_pos > 0 {
            // Remove character at cursor_pos - 1 (character position)
            let mut chars: Vec<char> = self.state.line.chars().collect();
            chars.remove(self.state.cursor_pos - 1);
            self.state.line = chars.into_iter().collect();
            
            // Move cursor back by one character
            self.state.cursor_pos -= 1;
            self.redraw_line(prompt, stdout)?;
        }
        Ok(())
    }
    
    fn handle_delete(&mut self, prompt: &str, stdout: &mut io::Stdout) -> Result<()> {
        let char_count = self.state.line.chars().count();
        if self.state.cursor_pos < char_count {
            // Remove character at cursor_pos (character position)
            let mut chars: Vec<char> = self.state.line.chars().collect();
            chars.remove(self.state.cursor_pos);
            self.state.line = chars.into_iter().collect();
            
            self.redraw_line(prompt, stdout)?;
        }
        Ok(())
    }
    
    fn move_cursor_left(&mut self, stdout: &mut io::Stdout) -> Result<()> {
        if self.state.cursor_pos > 0 {
            self.state.cursor_pos -= 1;
            stdout.execute(MoveLeft(1))?;
            stdout.flush()?;
        }
        Ok(())
    }
    
    fn move_cursor_right(&mut self, stdout: &mut io::Stdout) -> Result<()> {
        let char_count = self.state.line.chars().count();
        if self.state.cursor_pos < char_count {
            self.state.cursor_pos += 1;
            stdout.execute(MoveRight(1))?;
            stdout.flush()?;
        }
        Ok(())
    }
    
    fn move_to_previous_word(&mut self, prompt: &str, stdout: &mut io::Stdout) -> Result<()> {
        let chars: Vec<char> = self.state.line.chars().collect();
        let new_pos = find_previous_word_start(&chars, self.state.cursor_pos);
        
        if new_pos != self.state.cursor_pos {
            self.state.cursor_pos = new_pos;
            self.redraw_line(prompt, stdout)?;
        }
        
        Ok(())
    }
    
    fn move_to_next_word(&mut self, prompt: &str, stdout: &mut io::Stdout) -> Result<()> {
        let chars: Vec<char> = self.state.line.chars().collect();
        let new_pos = find_next_word_start(&chars, self.state.cursor_pos);
        
        if new_pos != self.state.cursor_pos {
            self.state.cursor_pos = new_pos;
            self.redraw_line(prompt, stdout)?;
        }
        
        Ok(())
    }
    
    fn delete_previous_word(&mut self, prompt: &str, stdout: &mut io::Stdout) -> Result<()> {
        if self.state.cursor_pos == 0 {
            return Ok(());
        }
        
        let chars: Vec<char> = self.state.line.chars().collect();
        let delete_start = find_current_word_start(&chars, self.state.cursor_pos);
        
        // If we're at the start of a word, find the previous word
        let delete_start = if delete_start == self.state.cursor_pos && self.state.cursor_pos > 0 {
            find_previous_word_start(&chars, self.state.cursor_pos)
        } else {
            delete_start
        };
        
        if delete_start < self.state.cursor_pos {
            // Remove characters from delete_start to cursor_pos
            let mut new_chars = chars;
            new_chars.drain(delete_start..self.state.cursor_pos);
            self.state.line = new_chars.into_iter().collect();
            self.state.cursor_pos = delete_start;
            self.redraw_line(prompt, stdout)?;
        }
        
        Ok(())
    }
    
    fn move_cursor_to_start(&mut self, prompt: &str, stdout: &mut io::Stdout) -> Result<()> {
        self.state.cursor_pos = 0;
        let prompt_len = visual_width(prompt);
        stdout.execute(MoveToColumn(prompt_len as u16))?;
        stdout.flush()?;
        Ok(())
    }
    
    fn move_cursor_to_end(&mut self, prompt: &str, stdout: &mut io::Stdout) -> Result<()> {
        let prompt_len = visual_width(prompt);
        let line_len = self.state.line.chars().count();
        self.state.cursor_pos = line_len; // Character position, not byte position
        stdout.execute(MoveToColumn((prompt_len + line_len) as u16))?;
        stdout.flush()?;
        Ok(())
    }
    
    fn navigate_history_up(&mut self, prompt: &str, stdout: &mut io::Stdout) -> Result<()> {
        if self.state.history.is_empty() {
            return Ok(());
        }
        
        let new_index = match self.state.history_index {
            None => 0,
            Some(idx) => std::cmp::min(idx + 1, self.state.history.len() - 1),
        };
        
        if let Some(history_line) = self.state.history.get(new_index) {
            self.state.history_index = Some(new_index);
            self.state.line = history_line.clone();
            self.state.cursor_pos = self.state.line.chars().count(); // Character position
            self.redraw_line(prompt, stdout)?;
        }
        
        Ok(())
    }
    
    fn navigate_history_down(&mut self, prompt: &str, stdout: &mut io::Stdout) -> Result<()> {
        match self.state.history_index {
            None => Ok(()),
            Some(0) => {
                // Back to current line
                self.state.history_index = None;
                self.state.line.clear();
                self.state.cursor_pos = 0;
                self.redraw_line(prompt, stdout)?;
                Ok(())
            }
            Some(idx) => {
                let new_index = idx - 1;
                if let Some(history_line) = self.state.history.get(new_index) {
                    self.state.history_index = Some(new_index);
                    self.state.line = history_line.clone();
                    self.state.cursor_pos = self.state.line.chars().count(); // Character position
                    self.redraw_line(prompt, stdout)?;
                }
                Ok(())
            }
        }
    }
    
    fn redraw_line(&self, prompt: &str, stdout: &mut io::Stdout) -> Result<()> {
        // Clear current line
        stdout.execute(MoveToColumn(0))?;
        stdout.execute(Clear(ClearType::CurrentLine))?;
        
        // Redraw prompt and line
        stdout.execute(Print(prompt))?;
        stdout.execute(Print(&self.state.line))?;
        
        // Position cursor correctly - cursor_pos is now character position
        let prompt_len = visual_width(prompt);
        stdout.execute(MoveToColumn((prompt_len + self.state.cursor_pos) as u16))?;
        
        stdout.flush()?;
        Ok(())
    }
}

#[derive(Debug)]
enum InputAction {
    Continue,
    Submit(String),
    Exit,
    Interrupt,
    CycleMode,
}