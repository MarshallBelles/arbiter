# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

**Build and Test:**
```bash
# Check compilation without building
cargo check

# Debug build
cargo build

# Release build
cargo build --release

# Run tests
cargo test
```

**Model Setup:**
```bash
# Download the model file
wget https://huggingface.co/unsloth/MiMo-VL-7B-RL-GGUF/resolve/main/MiMo-VL-7B-RL-UD-Q4_K_XL.gguf -O ARBITER10.gguf

# Create model in Ollama
ollama create arbiter1.0 -f Modelfile.arbiter1.0

# Test model
ollama list
```

**Running the Application:**
```bash
# Interactive mode (terminal shell)
cargo run

# Direct prompt
cargo run -- "List files in current directory"

# Pipe input
echo "debug this error" | cargo run

# With configuration override
cargo run -- -m different-model -s http://localhost:11434 "prompt"

# Install binary
cargo install --path .
```

## Architecture Overview

Arbiter is an AI-powered terminal application with a modular architecture centered around XML-based streaming responses and tool execution:

**Core Data Flow:**
1. **Input Processing** (`main.rs`): CLI parsing, configuration loading, and routing to appropriate execution mode (interactive shell, direct prompt, or pipe input)
2. **AI Communication** (`ai.rs`): Streaming HTTP client with XML parser that processes real-time responses, extracting `<think>` tags and `<tool_call>` elements
3. **Tool Execution** (`tools.rs`): Enhanced tool system handling shell commands, file operations, git commands, and code analysis with interactive command detection
4. **Interactive Interface** (`shell.rs`): Professional console-based interface using Ratatui with mouse support, text selection, and streaming response display

**Key Architectural Patterns:**

**XML Streaming Parser:**
The streaming parser in `ai.rs` processes partial XML chunks in real-time, handling incomplete tags and maintaining state across streaming responses. It emits `StreamEvent` variants for different content types including thinking, tool calls, and regular text.

**Agentic Loop:**
Implements a sophisticated agentic loop where tool execution results are fed back into the conversation history, allowing the AI to continue processing and potentially call additional tools based on the results. The loop continues until no more tool calls are needed.

**Multi-Modal Input:**
- Interactive console mode with professional terminal styling
- Direct CLI prompt mode for one-off tasks
- Unix pipe integration for stream processing
- Mouse support for text selection and copy/paste

**Language Integration:**
- Tree-sitter parsers (`tree_sitter_support.rs`) - currently using basic text parsing with framework for full Tree-sitter integration
- LSP client (`lsp.rs`) for language server communication (embedded but modular)
- Support for Rust, JavaScript/TypeScript, Python, Java, C++, Go, C#, and Zig

## Configuration System

Configuration follows a hierarchical override pattern:
1. Default config in `config.rs` with sensible defaults
2. User config file at `~/.config/arbiter/config.toml` (auto-created)
3. CLI arguments override both
4. Special command `arbiter "edit config"` for direct configuration editing

The config includes:
- Model settings (arbiter1.0 by default)
- Ollama server URL (http://localhost:11434)
- Context size (31000 tokens) and temperature (0.7)
- LSP server definitions for each supported language
- Token limits and generation parameters

## XML Response Format

The AI model is trained to respond with structured XML:

```xml
<think>
Reasoning and planning goes here, can span multiple lines
</think>

Regular conversational text outside of XML tags.

<tool_call name="tool_name">
Arguments for the tool, can be multiline
</tool_call>
```

The streaming parser handles partial XML gracefully and emits events as complete sections are received.

## Adding New Language Support

Currently using basic text parsing instead of Tree-sitter. To add a new language:

1. Update `tree_sitter_support.rs`:
   - Add file extension mapping in `detect_language()`
   - Add parsing logic in `get_symbols()` for the new language
   - Add helper functions for symbol extraction (similar to `extract_rust_fn_name`)
2. Add LSP server config to default configuration in `config.rs`
3. Update language detection in `lsp.rs`

To restore Tree-sitter support:
1. Add tree-sitter language dependencies to `Cargo.toml`
2. Uncomment extern function declarations in `tree_sitter_support.rs`
3. Restore Tree-sitter initialization in `TreeSitterManager::new()`
4. Implement proper query-based symbol extraction

## Tool System

Tools are executed through the enhanced `ToolExecutor` which:
- Maintains working directory context with proper path resolution
- Executes commands asynchronously with comprehensive error handling
- Detects and provides guidance for interactive/streaming commands
- Uses system shell detection for optimal command execution
- Returns formatted results that get fed back to the AI

Available tools:
- `shell_command`: Direct shell execution with enhanced command detection and interactive command guidance
- `write_file`: File creation with automatic directory creation and path resolution
- `read_file`: File reading with comprehensive error handling and encoding detection
- `git_command`: Git operations with proper repository context
- `code_analysis`: Code structure analysis using Tree-sitter integration

**Interactive Command Detection:**
The tool system automatically detects interactive/streaming commands (like `tail -f`, `watch`, `top`) and provides helpful alternatives and guidance for future releases.

## Model Integration

The `Modelfile.arbiter1.0` defines the comprehensive model configuration for Ollama:
- Base model reference (MiMo GGUF file)
- Optimized chat template with tool integration support
- Comprehensive system prompt with XML structure enforcement
- Detailed tool documentation and usage examples
- Model parameters optimized for coding tasks (31000 context, 0.7 temperature)
- GPU acceleration settings (num_gpu 99)
- Penalty and prediction parameters for consistent output

The model expects the `ARBITER10.gguf` file (based on Xiaomi's MiMo-VL-7B-RL) to be downloaded separately and placed in the project root before creating the Ollama model.

## Console Interface Implementation

The terminal interface (`shell.rs`) uses Ratatui with:
- Professional console-based display with native terminal text selection
- Message history with distinct styling for user/AI/thinking/tool content
- Mouse support for text selection and copy/paste operations
- Proper Ctrl+C handling (copy selected text, interrupt operations, or exit)
- Smart command detection (shell commands vs AI requests)
- Real-time streaming response display with live tool execution feedback
- Interactive command guidance and alternatives
- Professional ANSI colors for optimal readability
- Natural command history navigation

## Error Handling

The codebase uses `anyhow::Result` throughout with context-aware error messages. Critical paths include:
- Ollama connectivity and streaming response parsing
- Tool execution and result formatting
- Configuration loading and validation
- Terminal state management and cleanup