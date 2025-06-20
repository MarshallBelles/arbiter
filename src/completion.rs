use anyhow::{Result, Context};
use std::collections::{HashMap, VecDeque};
use std::env;
use std::path::{Path, PathBuf};
use std::fs;
use tracing::debug;

#[derive(Debug, Clone)]
pub struct Completion {
    pub text: String,
    pub description: String,
    pub completion_type: CompletionType,
}

#[derive(Debug, Clone, PartialEq)]
pub enum CompletionType {
    File,
    Directory,
    Command,
    History,
}

#[derive(Debug)]
pub struct ValidationResult {
    pub is_valid: bool,
    pub error_message: Option<String>,
    pub suggestions: Vec<String>,
}

pub struct CompletionEngine {
    command_cache: HashMap<String, bool>,
    history: VecDeque<String>,
    current_dir: PathBuf,
    max_history_size: usize,
    max_completions: usize,
}

impl CompletionEngine {
    pub fn new() -> Result<Self> {
        let current_dir = env::current_dir()
            .context("Failed to get current working directory")?;
        
        let mut engine = Self {
            command_cache: HashMap::new(),
            history: VecDeque::new(),
            current_dir,
            max_history_size: 1000,
            max_completions: 50,
        };
        
        // Initialize command cache on startup
        engine.refresh_command_cache()?;
        
        Ok(engine)
    }
    
    /// Update the current working directory for context-aware completion
    pub fn set_working_directory(&mut self, path: PathBuf) {
        self.current_dir = path;
    }
    
    /// Add a command to the history
    pub fn add_to_history(&mut self, command: String) {
        // Remove if already exists to avoid duplicates
        if let Some(pos) = self.history.iter().position(|x| x == &command) {
            self.history.remove(pos);
        }
        
        // Add to front
        self.history.push_front(command);
        
        // Maintain size limit
        if self.history.len() > self.max_history_size {
            self.history.pop_back();
        }
    }
    
    /// Get completions for the current input at cursor position
    pub fn get_completions(&self, input: &str, cursor_pos: usize) -> Vec<Completion> {
        let mut completions = Vec::new();
        
        // Extract the word being completed
        let (word_start, partial_word) = self.extract_completion_word(input, cursor_pos);
        
        debug!("Getting completions for '{}' at position {}", partial_word, cursor_pos);
        
        // Determine completion context
        let chars: Vec<char> = input.chars().collect();
        let prefix_chars: String = chars[..word_start].iter().collect();
        let words: Vec<&str> = prefix_chars.split_whitespace().collect();
        let context = if words.is_empty() {
            CompletionContext::Command
        } else {
            self.determine_context(&words)
        };
        
        match context {
            CompletionContext::Command => {
                completions.extend(self.complete_commands(&partial_word));
            }
            CompletionContext::File => {
                completions.extend(self.complete_files(&partial_word));
            }
            CompletionContext::Directory => {
                completions.extend(self.complete_directories(&partial_word));
            }
            CompletionContext::Any => {
                completions.extend(self.complete_files(&partial_word));
                completions.extend(self.complete_commands(&partial_word));
            }
        }
        
        // Add history-based completions if partial matches
        completions.extend(self.complete_from_history(&partial_word));
        
        // Sort by relevance and limit results
        completions.sort_by(|a, b| {
            // Prioritize exact prefix matches
            let a_exact = a.text.starts_with(&partial_word);
            let b_exact = b.text.starts_with(&partial_word);
            
            match (a_exact, b_exact) {
                (true, false) => std::cmp::Ordering::Less,
                (false, true) => std::cmp::Ordering::Greater,
                _ => a.text.len().cmp(&b.text.len())
            }
        });
        
        // Limit completions, with higher limit for directory listings
        let limit = if completions.iter().any(|c| c.text.contains('/')) { 25 } else { self.max_completions };
        completions.truncate(limit);
        completions
    }
    
    /// Complete file and directory names
    pub fn complete_files(&self, partial_path: &str) -> Vec<Completion> {
        let mut completions = Vec::new();
        
        let (dir_path, filename_prefix) = if partial_path.ends_with('/') {
            // Path ends with slash - it's a completed directory, show its contents
            (Path::new(partial_path).to_path_buf(), "")
        } else if partial_path.contains('/') {
            // Path contains slash but doesn't end with one - complete the filename
            let path = Path::new(partial_path);
            let dir = path.parent().unwrap_or(Path::new("."));
            let filename = path.file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("");
            (dir.to_path_buf(), filename)
        } else {
            // No slash - complete in current directory
            (self.current_dir.clone(), partial_path)
        };
        
        match fs::read_dir(&dir_path) {
            Ok(entries) => {
                for entry in entries.flatten() {
                    if let Some(name) = entry.file_name().to_str() {
                        let show_hidden = filename_prefix.starts_with('.');
                        let should_include = name.starts_with(filename_prefix) && 
                                           (show_hidden || !name.starts_with('.'));
                        
                        if should_include {
                            let completion_type = if entry.path().is_dir() {
                                CompletionType::Directory
                            } else {
                                CompletionType::File
                            };
                            
                            let display_name = if partial_path.ends_with('/') {
                                // Directory listing - show path relative to the directory
                                let relative_path = if completion_type == CompletionType::Directory {
                                    format!("{}{}/", partial_path, name)
                                } else {
                                    format!("{}{}", partial_path, name)
                                };
                                relative_path
                            } else if partial_path.contains('/') {
                                // Path completion - show full path from the root
                                let parent_path = Path::new(partial_path).parent().unwrap_or(Path::new(""));
                                if completion_type == CompletionType::Directory {
                                    format!("{}/{}/", parent_path.display(), name)
                                } else {
                                    format!("{}/{}", parent_path.display(), name)
                                }
                            } else {
                                // Simple filename completion
                                if completion_type == CompletionType::Directory {
                                    format!("{}/", name)
                                } else {
                                    name.to_string()
                                }
                            };
                            
                            completions.push(Completion {
                                text: display_name,
                                description: format!("{}", if completion_type == CompletionType::Directory { "directory" } else { "file" }),
                                completion_type,
                            });
                        }
                    }
                }
            }
            Err(e) => {
                debug!("Error reading directory {}: {}", dir_path.display(), e);
            }
        }
        
        completions
    }
    
    /// Complete only directory names
    pub fn complete_directories(&self, partial_path: &str) -> Vec<Completion> {
        self.complete_files(partial_path)
            .into_iter()
            .filter(|c| c.completion_type == CompletionType::Directory)
            .collect()
    }
    
    /// Complete command names from PATH
    pub fn complete_commands(&self, partial_cmd: &str) -> Vec<Completion> {
        let mut completions = Vec::new();
        
        for command in self.command_cache.keys() {
            if command.starts_with(partial_cmd) {
                completions.push(Completion {
                    text: command.clone(),
                    description: "command".to_string(),
                    completion_type: CompletionType::Command,
                });
            }
        }
        
        completions
    }
    
    /// Complete from command history
    pub fn complete_from_history(&self, partial: &str) -> Vec<Completion> {
        let mut completions = Vec::new();
        
        for cmd in &self.history {
            if cmd.starts_with(partial) && !completions.iter().any(|c: &Completion| c.text == *cmd) {
                completions.push(Completion {
                    text: cmd.clone(),
                    description: "from history".to_string(),
                    completion_type: CompletionType::History,
                });
            }
        }
        
        completions
    }
    
    /// Validate if a command exists and can be executed
    pub fn validate_command(&self, cmd: &str) -> ValidationResult {
        let first_word = cmd.split_whitespace().next().unwrap_or("");
        
        // Check if it's a known command
        if self.command_cache.contains_key(first_word) {
            return ValidationResult {
                is_valid: true,
                error_message: None,
                suggestions: Vec::new(),
            };
        }
        
        // Check if it's an executable path
        if first_word.starts_with("./") || first_word.starts_with("/") {
            let path = Path::new(first_word);
            if path.exists() && path.is_file() {
                return ValidationResult {
                    is_valid: true,
                    error_message: None,
                    suggestions: Vec::new(),
                };
            }
        }
        
        // Generate suggestions for unknown commands
        let suggestions = self.generate_command_suggestions(first_word);
        
        ValidationResult {
            is_valid: false,
            error_message: Some(format!("Command '{}' not found", first_word)),
            suggestions,
        }
    }
    
    /// Refresh the command cache by scanning PATH
    pub fn refresh_command_cache(&mut self) -> Result<()> {
        self.command_cache.clear();
        
        if let Ok(path_var) = env::var("PATH") {
            for path_dir in path_var.split(':') {
                if let Ok(entries) = fs::read_dir(path_dir) {
                    for entry in entries.flatten() {
                        if let Some(name) = entry.file_name().to_str() {
                            // Check if file is executable
                            if entry.path().is_file() {
                                self.command_cache.insert(name.to_string(), true);
                            }
                        }
                    }
                }
            }
        }
        
        debug!("Loaded {} commands from PATH", self.command_cache.len());
        Ok(())
    }
    
    /// Extract the word being completed and its start position (character-based)
    fn extract_completion_word(&self, input: &str, cursor_pos: usize) -> (usize, String) {
        let chars: Vec<char> = input.chars().collect();
        let safe_pos = std::cmp::min(cursor_pos, chars.len());
        
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
    
    /// Determine completion context based on previous words
    fn determine_context(&self, words: &[&str]) -> CompletionContext {
        if words.is_empty() {
            return CompletionContext::Command;
        }
        
        let last_word = words[words.len() - 1];
        
        match last_word {
            "cd" | "rmdir" | "mkdir" => CompletionContext::Directory,
            "cat" | "less" | "more" | "head" | "tail" | "vim" | "vi" | "nano" | "code" => CompletionContext::File,
            "rm" | "cp" | "mv" | "chmod" | "chown" => CompletionContext::File,
            _ => CompletionContext::Any,
        }
    }
    
    /// Generate suggestions for unknown commands using fuzzy matching
    fn generate_command_suggestions(&self, partial: &str) -> Vec<String> {
        let mut suggestions = Vec::new();
        
        // Simple fuzzy matching - commands that contain the letters in order
        for command in self.command_cache.keys() {
            if self.fuzzy_match(command, partial) {
                suggestions.push(command.clone());
            }
        }
        
        // Sort by similarity and take top 5
        suggestions.sort_by_key(|cmd| self.levenshtein_distance(cmd, partial));
        suggestions.truncate(5);
        
        suggestions
    }
    
    /// Simple fuzzy matching - check if all characters appear in order
    fn fuzzy_match(&self, haystack: &str, needle: &str) -> bool {
        let mut needle_chars = needle.chars();
        let mut current_needle_char = needle_chars.next();
        
        for haystack_char in haystack.chars() {
            if let Some(needle_char) = current_needle_char {
                if haystack_char.to_lowercase().eq(needle_char.to_lowercase()) {
                    current_needle_char = needle_chars.next();
                }
            }
        }
        
        current_needle_char.is_none()
    }
    
    /// Calculate Levenshtein distance for similarity scoring
    fn levenshtein_distance(&self, s1: &str, s2: &str) -> usize {
        let len1 = s1.len();
        let len2 = s2.len();
        let mut matrix = vec![vec![0; len2 + 1]; len1 + 1];
        
        for i in 0..=len1 {
            matrix[i][0] = i;
        }
        for j in 0..=len2 {
            matrix[0][j] = j;
        }
        
        for (i, c1) in s1.chars().enumerate() {
            for (j, c2) in s2.chars().enumerate() {
                let cost = if c1 == c2 { 0 } else { 1 };
                matrix[i + 1][j + 1] = std::cmp::min(
                    std::cmp::min(
                        matrix[i][j + 1] + 1,     // deletion
                        matrix[i + 1][j] + 1,     // insertion
                    ),
                    matrix[i][j] + cost,          // substitution
                );
            }
        }
        
        matrix[len1][len2]
    }
}

#[derive(Debug)]
enum CompletionContext {
    Command,
    File,
    Directory,
    Any,
}