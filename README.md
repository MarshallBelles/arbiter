# Arbiter

A next-generation Rust code agent leveraging Aider's architecture with modern technologies including Tree-sitter, LSP integration, and advanced context management.

## Overview

Arbiter is designed as a sophisticated AI-powered code agent that combines the proven architectural patterns from Aider with innovative context management inspired by Claude Code, enhanced by the power of Language Server Protocol (LSP) and Tree-sitter for precise code understanding.

## Features

- **Advanced Context Management**: Multi-layered context system with real-time visualization
- **Tree-sitter Integration**: Precise code parsing and analysis across multiple languages
- **LSP Support**: Semantic code understanding through language server integration
- **Pluggable AI Providers**: Support for different AI models and providers
- **Interactive CLI**: Command-line interface with analysis, generation, and interactive modes
- **Intelligent Code Editing**: SEARCH/REPLACE pattern with validation and rollback

## Architecture

The system is built around several key components:

### Core Components

- **CodeAgent**: Main interface for AI-powered code operations
- **ContextManager**: Manages multi-layered context with intelligent compaction
- **CodeAnalyzer**: Tree-sitter based code parsing and analysis
- **LspManager**: Language Server Protocol integration for semantic understanding
- **RepositoryMapper**: Aider-inspired repository mapping with relevance scoring

### Plugin System

Extensible plugin architecture allowing custom functionality through the Plugin trait.

## Installation

```bash
git clone <repository-url>
cd arbiter
cargo build --release
```

## Usage

### CLI Commands

```bash
# Analyze code context
arbiter analyze "add error handling" --files src/main.rs --symbols --diagnostics

# Generate code changes
arbiter generate "implement user authentication" --files src/auth.rs --apply

# Interactive mode
arbiter interactive

# Show context visualization
arbiter context
```

### Options

- `-v, --verbose`: Enable verbose logging
- `-c, --context-size <SIZE>`: Set context window size (default: 100000)

## Development Status

This is currently a foundational implementation with the core architecture in place. Many components are marked with `todo!()` and require implementation:

### Implemented ✅
- Project structure and build system
- Core type definitions and traits
- CLI interface with clap
- Basic context management framework
- Plugin system architecture
- Mock AI provider for testing

### Todo 🚧
- Tree-sitter parser integration
- LSP client implementations
- Repository scanning and mapping
- CLAUDE.md file discovery
- SEARCH/REPLACE pattern parsing
- File editing and validation
- Context compaction algorithms

## Project Structure

```
src/
├── lib.rs          # Main library with all core components
└── main.rs         # CLI application entry point
Cargo.toml          # Rust project configuration
PLAN.md            # Detailed architectural plan and research
```

## Configuration

The project uses `Cargo.toml` for dependency management and includes all necessary dependencies for:

- Async runtime (tokio)
- Tree-sitter parsers for multiple languages
- LSP client integration (tower-lsp)
- CLI interface (clap)
- HTTP client for AI providers (reqwest)

## Contributing

This project follows the architectural principles outlined in PLAN.md. When implementing todo items:

1. Maintain the modular architecture
2. Follow Rust best practices
3. Add comprehensive error handling
4. Include tests for new functionality
5. Update documentation

## License

MIT OR Apache-2.0

## Acknowledgments

This project draws inspiration from:
- [Aider](https://github.com/paul-gauthier/aider): For repository mapping and editing patterns
- [Claude Code](https://claude.ai/code): For context management innovations
- [Tree-sitter](https://tree-sitter.github.io/): For precise code parsing
- [Language Server Protocol](https://microsoft.github.io/language-server-protocol/): For semantic code understanding