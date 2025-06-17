# Arbiter - AI-Powered Command-Line Assistant

Arbiter is an ULTRA-lightweight AI-powered command-line assistant and peer-programmer that runs locally using Ollama. Designed as your intelligent terminal companion, Arbiter provides seamless integration with your development workflow through natural command-line interaction, professional terminal styling, and direct access to your file system and development tools.

## Features

🤖 **Local AI Model Support**: Runs the fine-tuned `arbiter1.0` model based on Xiaomi's MiMo-VL-7B-RL  
🖥️ **Professional Console Interface**: Beautiful console-based interaction with native terminal text selection  
🌈 **Professional ANSI Colors**: Clean, readable terminal output with optimized color schemes  
🌳 **Tree-sitter Integration**: Built-in code parsing framework for Rust, Java, JS/TS, C#, C++, Go, Python, Zig  
📡 **Language Server Protocol**: Embedded LSP support for intelligent code completion and analysis  
⚡ **Real-time Streaming**: XML-based streaming responses with live tool execution feedback  
🔧 **Smart Command Detection**: Automatic detection of shell vs AI commands with helpful guidance  
📝 **Multiple Input Modes**: Interactive console, direct prompts, or stdin pipes  
🖱️ **Native Terminal Features**: Full mouse support for text selection, copy/paste, and scrolling  
⚠️ **Interactive Command Guidance**: Smart detection and alternatives for unsupported interactive/streaming commands  
🔄 **Agentic Loop**: Continuous tool execution with result analysis and follow-up actions  
⚙️ **Auto-Configuration**: Automatic config file creation with sensible defaults  

## Quick Start

### Prerequisites

1. **Rust**: Install from [rustup.rs](https://rustup.rs/)
2. **Ollama**: Install from [ollama.ai](https://ollama.ai/)
3. **Language Servers** (optional but recommended):
   - `rust-analyzer` for Rust
   - `typescript-language-server` for JavaScript
   - `pylsp` for Python  
   - `gopls` for Go

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd arbiter
```

2. Build the project:
```bash
cargo build --release
```

3. Set up the model:
```bash
# Download the model file (MiMo-VL-7B-RL GGUF)
wget https://huggingface.co/unsloth/MiMo-VL-7B-RL-GGUF/resolve/main/MiMo-VL-7B-RL-UD-Q4_K_XL.gguf -O ARBITER10.gguf

# Create the model in Ollama
ollama create arbiter1.0 -f Modelfile.arbiter1.0

# Verify model installation
ollama list | grep arbiter1.0
```

4. Install the binary (optional):
```bash
cargo install --path .
```

5. Configure (optional):
```bash
# Edit configuration directly
arbiter "edit config"
```

## Usage

### Interactive Mode

Launch Arbiter in interactive mode for a full AI-powered terminal experience:

```bash
arbiter
```

You'll see a professional console interface with natural terminal integration.

Features in interactive mode:
- **Natural command history**: Use up/down arrows to navigate previous commands
- **Shell command passthrough**: Commands like `ls`, `git`, `cargo` execute directly
- **Intelligent AI interaction**: Ask questions or request help naturally
- **Professional ANSI colors**: Clean, readable output optimized for terminals
- **Native text selection**: Select any text with mouse using your terminal's native capabilities
- **Smart command detection**: Automatic routing between shell commands and AI processing
- **Interactive command guidance**: Helpful alternatives for unsupported streaming commands
- **Agentic tool execution**: Continuous loop of tool execution and result analysis
- **Mouse support**: Full mouse integration for text selection and interaction
- **Ctrl+C behavior**: Copy selected text, interrupt operations, or exit cleanly

### Direct Prompts

Run Arbiter with a direct prompt:

```bash
arbiter "List the files in the current directory"
arbiter "Create a Python script that calculates fibonacci numbers"
arbiter "Review my code and suggest improvements"
```

### Pipe Input

Use Arbiter in Unix pipelines:

```bash
echo "Debug this Python error" | arbiter
cat error.log | arbiter "Analyze this error log"
git diff | arbiter "Review these changes"
```

## Configuration

Arbiter automatically creates a configuration file at `~/.config/arbiter/config.toml` with optimized defaults:

```toml
model = "arbiter1.0"
server = "http://localhost:11434"
context_size = 31000
temperature = 0.7
max_tokens = 4096

[[lsp_servers]]
language = "rust"
command = "rust-analyzer"
args = []

[[lsp_servers]]
language = "python" 
command = "pylsp"
args = []

[[lsp_servers]]
language = "javascript"
command = "typescript-language-server"
args = ["--stdio"]

[[lsp_servers]]
language = "typescript"
command = "typescript-language-server"
args = ["--stdio"]

[[lsp_servers]]
language = "go"
command = "gopls"
args = []

[[lsp_servers]]
language = "java"
command = "jdtls"
args = []

[[lsp_servers]]
language = "cpp"
command = "clangd"
args = []
```

**Edit Configuration:**
```bash
# Direct config editing
arbiter "edit config"
```

### Command Line Options

```bash
arbiter [OPTIONS] [PROMPT]

Options:
  -c, --config <FILE>    Configuration file path
  -m, --model <MODEL>    AI model to use (overrides config)
  -s, --server <URL>     Ollama server URL (overrides config)
  -h, --help             Print help information
```

## How Arbiter Works

Arbiter provides a seamless terminal experience that intelligently distinguishes between shell commands and AI requests:

### Shell Commands
Common commands execute directly with clean output:
```bash
(Arbiter) user@host$ ls -la
drwxr-xr-x  12 user  staff   384 Jun 17 05:30 .
-rw-r--r--   1 user  staff  1234 Jun 17 05:25 README.md
-rw-r--r--   1 user  staff   567 Jun 17 05:20 main.rs

(Arbiter) user@host$ git status
On branch main
Your branch is up to date with 'origin/main'.
```

### AI Interactions
Natural language requests are processed by the AI:
```bash
(Arbiter) user@host$ create a python script for fibonacci numbers
[thinking: I need to create a Python file with a fibonacci function]

▶ Executing write_file with args: fibonacci.py
┌─ Tool output:
File 'fibonacci.py' created successfully
└─

I've created a Python script that calculates Fibonacci numbers...
```

### Interactive Command Guidance
Arbiter provides helpful guidance for interactive commands:
```bash
(Arbiter) user@host$ tail -f logfile.txt
Streaming command detected: 'tail -f logfile.txt'

Interactive/streaming commands are coming soon! We're working to overcome these challenges in a future release.

For now, please use non-streaming alternatives:
  • tail -n 20 <filename> (show last 20 lines)
  • cat <filename> (show entire file)
  • less <filename> (browse file content)
```

## Available Tools

- **shell_command**: Execute shell commands with enhanced interactive command detection
- **write_file**: Create or modify files with automatic directory creation
- **read_file**: Read file contents with encoding detection and error handling
- **git_command**: Execute Git operations with proper repository context
- **code_analysis**: Analyze code structure with Tree-sitter integration (framework ready)

**Enhanced Features:**
- Interactive command detection and guidance (tail -f, watch, top, etc.)
- System shell detection for optimal command execution
- Comprehensive error handling and user feedback
- Working directory context preservation

## Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│ Console Shell   │◄──►│   AI Client     │◄──►│     Ollama      │
│ (Ratatui/Mouse) │    │ (XML Stream +   │    │   (arbiter1.0)  │
│                 │    │  Agentic Loop)  │    │                 │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │
         ▼                       ▼
┌─────────────────┐    ┌─────────────────┐
│ Tool Executor   │    │ Tree-sitter +   │
│ (Enhanced Shell │    │ LSP Manager     │
│  + Interactive  │    │ (Multi-language)│
│   Detection)    │    │                 │
└─────────────────┘    └─────────────────┘
         │                       │
         ▼                       ▼
┌─────────────────┐    ┌─────────────────┐
│ Configuration   │    │ Model Config    │
│ Management      │    │ (31K context +  │
│ (Auto-create)   │    │  Tool Docs)     │
└─────────────────┘    └─────────────────┘
```

Key architectural improvements:
- **Professional console interface**: Native terminal text selection with mouse support
- **Agentic execution loop**: Continuous tool execution with result analysis
- **Enhanced tool detection**: Smart routing with interactive command guidance
- **Professional ANSI colors**: Optimized terminal output for readability
- **Streaming responses**: Real-time AI responses with live tool execution feedback
- **Comprehensive configuration**: Auto-generated config with hierarchical overrides

## Development

### Building from Source

```bash
# Debug build
cargo build

# Release build  
cargo build --release

# Run tests
cargo test

# Check for issues
cargo check
```

### Adding New Language Support

1. Add tree-sitter dependency to `Cargo.toml`
2. Update `tree_sitter_support.rs` with language integration
3. Add LSP server configuration to default config
4. Update language detection logic

### Model Customization

The `Modelfile.arbiter1.0` contains the model configuration. Modify it to:
- Adjust system prompts
- Change model parameters  
- Update response templates

## Examples

### Interactive Development Workflow
```bash
# Start Arbiter
arbiter

# Check project status
(Arbiter) user@host$ git status
On branch main
Changes not staged for commit:
  modified: src/main.rs

# Ask for help with code review
(Arbiter) user@host$ review my changes and suggest improvements
[thinking: I should look at the git diff to see what changed]

▶ Executing git_command with args: git diff src/main.rs
┌─ Tool output:
+fn new_feature() {
+    println!("Hello, world!");
+}
└─

I can see you've added a new function. Here are some suggestions...

# Run tests
(Arbiter) user@host$ cargo test
   Compiling project v1.0.0
    Finished test [unoptimized + debuginfo] target(s) in 2.34s

# Commit changes with AI assistance
(Arbiter) user@host$ help me write a good commit message for these changes
Based on the changes, I suggest:
"feat: add new_feature function with hello world output"

(Arbiter) user@host$ git commit -m "feat: add new_feature function with hello world output"
[main abc1234] feat: add new_feature function with hello world output
```

### Quick Tasks
```bash
# Direct prompts for one-off tasks
arbiter "Create a Python script that reads a CSV and calculates averages"
arbiter "Review this error log and suggest fixes"
arbiter "Set up a new Rust project with proper dependencies"

# Pipe integration
git diff | arbiter "Explain what these changes do"
cat error.log | arbiter "Help me understand this error"
```

## Troubleshooting

### Model Not Found
```bash
# Verify model exists
ollama list

# Recreate model if needed
ollama create arbiter1.0 -f Modelfile.arbiter1.0
```

### Interactive Commands Not Working
Interactive and streaming commands are intentionally disabled for stability. Arbiter provides helpful alternatives:

```bash
# Instead of: tail -f logfile.txt
(Arbiter) user@host$ tail -n 50 logfile.txt

# Instead of: git commit (opens editor)
(Arbiter) user@host$ git commit -m "your commit message"

# Instead of: watch df -h
(Arbiter) user@host$ df -h
```

### Language Server Issues
```bash
# Check if language servers are installed
which rust-analyzer
which pylsp
which typescript-language-server
which gopls

# Install missing servers as needed
```

### Connection Issues
```bash
# Verify Ollama is running
curl http://localhost:11434/api/tags

# Start Ollama if needed
ollama serve
```

### Text Selection/Copy
Arbiter uses your terminal's native text selection capabilities:
- **Select text**: Click and drag with mouse (native terminal selection)
- **Copy**: Use your terminal's copy shortcut (usually Cmd+C on macOS, Ctrl+Shift+C on Linux)
- **Paste**: Use your terminal's paste shortcut
- **Mouse support**: Full mouse integration for improved text interaction

### Performance Issues
```bash
# Check if model is loaded properly
ollama ps

# Restart Ollama service if needed
ollama serve

# Verify model configuration
ollama show arbiter1.0
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

- Built with [Ollama](https://ollama.ai/) for local AI inference
- [Tree-sitter](https://tree-sitter.github.io/) for code parsing
- [Ratatui](https://ratatui.rs/) for the terminal interface
- Based on Xiaomi's MiMo model architecture