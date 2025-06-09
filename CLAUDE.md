# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build and Development Commands

- `cargo build` - Build the project
- `cargo build --release` - Build optimized release version
- `cargo run` - Run the CLI application
- `cargo test` - Run all tests
- `cargo run -- analyze "query" --files src/main.rs` - Analyze code context
- `cargo run -- generate "request" --files src/lib.rs --apply` - Generate and apply changes
- `cargo run -- interactive` - Start interactive mode

## Architecture Overview

Arbiter is a next-generation Rust code agent that combines proven patterns from Aider with modern technologies. The architecture is modular and follows these key design principles:

### Core Components Architecture
- **CodeAgent trait**: Main interface for AI-powered operations (`analyze_context`, `generate_changes`, `apply_changes`)
- **ContextManager**: Multi-layered context system with real-time visualization and intelligent compaction (inspired by Claude Code)
- **CodeAnalyzer**: Tree-sitter integration for precise code parsing with incremental updates and language-agnostic queries
- **LspManager**: Language Server Protocol integration providing semantic understanding across multiple languages
- **RepositoryMapper**: Aider-inspired repository mapping with graph-based relevance scoring and dynamic token allocation

### Context Management Strategy
The system implements a 4-layer context hierarchy:
1. Persistent project context (CLAUDE.md files) - coding conventions and architectural decisions
2. Dynamic repository map - Tree-sitter built with relevance-based ranking
3. Live semantic context - LSP servers providing type information and diagnostics
4. Conversation context - intelligent summarization with compaction capabilities

### AI Integration Pattern
- Uses trait-based AI provider system allowing pluggable models
- Follows Aider's SEARCH/REPLACE block format for reliable code generation
- Implements structured prompt engineering with format-specific instructions
- Includes LSP-guided validation before applying changes

### Plugin Architecture
Extensible plugin system through the Plugin trait supporting:
- File change notifications
- Edit request processing 
- Custom initialization contexts

## Code Conventions

- All core functionality is implemented in `src/lib.rs` with modular organization
- CLI interface is in `src/main.rs` using clap for argument parsing
- Use `async/await` throughout with tokio runtime
- Prefer `Arc<RwLock<T>>` for shared state management
- Follow Rust naming conventions and use `thiserror` for error handling
- Many components are marked with `todo!()` indicating implementation needed

## Key Implementation Notes

- Tree-sitter integration uses incremental parsing for performance
- Context window management includes automatic compaction when approaching limits
- LSP integration supports multiple language servers simultaneously 
- Repository mapping allocates 1,024 default tokens with dynamic expansion
- Edit validation combines Tree-sitter syntax checking with LSP semantic analysis
- All file operations should maintain atomic updates with rollback capability

## Current Development Status

This is a foundational implementation with core architecture in place. Most complex functionality (Tree-sitter parsing, LSP integration, repository scanning, SEARCH/REPLACE parsing) is marked as `todo!()` and requires implementation.