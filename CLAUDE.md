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
# Interactive mode
cargo run

# Direct prompt
cargo run -- "List files in current directory"

# With configuration override
cargo run -- -m different-model -s http://localhost:11434 "prompt"
```

## Architecture Overview

Arbiter is an AI-powered terminal application with a modular architecture centered around XML-based streaming responses and tool execution:

**Core Data Flow:**
1. **Input Processing** (`main.rs`): CLI parsing, configuration loading, and routing to appropriate execution mode
2. **AI Communication** (`ai.rs`): Streaming HTTP client that parses XML responses in real-time, extracting `<think>` tags and `<tool_call>` elements
3. **Tool Execution** (`tools.rs`): Handles shell commands, file operations, git commands, and code analysis
4. **Interactive Interface** (`shell.rs`): TUI built with Ratatui that displays streaming responses with expandable sections

**Key Architectural Patterns:**

**XML Streaming Parser:**
The `XmlStreamParser` in `ai.rs` processes partial XML chunks in real-time, handling incomplete tags and maintaining state across streaming responses. It emits `StreamEvent` variants for different content types.

**Agentic Loop:**
When a tool is executed, its result is fed back into the conversation history, allowing the AI to continue processing and potentially call additional tools based on the results.

**Multi-Modal Input:**
- Interactive TUI mode with terminal controls
- Direct CLI prompt mode  
- Unix pipe integration for stream processing

**Language Integration:**
- Tree-sitter parsers (`tree_sitter_support.rs`) - currently using basic text parsing, Tree-sitter dependencies temporarily removed due to linking issues
- LSP client (`lsp.rs`) for language server communication (currently embedded but modular)

## Configuration System

Configuration follows a hierarchical override pattern:
1. Default config in `config.rs`
2. User config file at `~/.config/arbiter/config.toml` 
3. CLI arguments override both

The config includes model settings, Ollama server URL, and LSP server definitions for each supported language.

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

Tools are executed through the `ToolExecutor` which:
- Maintains a working directory context
- Executes commands asynchronously with proper error handling
- Returns formatted results that get fed back to the AI

Available tools:
- `shell_command`: Direct shell execution with output capture
- `write_file`: File creation with directory creation
- `read_file`: File reading with error handling
- `git_command`: Git operations
- `code_analysis`: Tree-sitter based code structure analysis

## Model Integration

The `Modelfile.arbiter1.0` defines the model configuration for Ollama. It includes:
- Base model reference (MiMo GGUF file)
- Chat template with proper formatting
- System prompt that enforces XML structure
- Model parameters (temperature, context size, etc.)

The model expects the `ARBITER10.gguf` file to be downloaded separately and placed in the project root before creating the Ollama model.

## TUI Implementation

The terminal interface (`shell.rs`) uses Ratatui with:
- Message history with different styling for user/AI/thinking/tool content
- Expandable sections (Tab key toggles)
- Proper Ctrl+C handling (once to interrupt, twice to exit)
- Shell command passthrough detection
- Real-time streaming response display

## Error Handling

The codebase uses `anyhow::Result` throughout with context-aware error messages. Critical paths include:
- Ollama connectivity and streaming response parsing
- Tool execution and result formatting
- Configuration loading and validation
- Terminal state management and cleanup