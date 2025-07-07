# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Essential Commands

### Development Workflow
```bash
# Install dependencies (from root)
pnpm install

# Start all development servers
pnpm dev

# Start individual services
cd apps/api && pnpm dev        # API server on port 3001
cd apps/web && pnpm dev        # React frontend on port 3000

# Build everything
pnpm build

# Run tests
pnpm test                      # All packages
pnpm --filter @arbiter/api test  # Specific package
cd apps/api && npm test -- --testPathPattern="run-logger.test.ts"  # Single test file

# Linting and formatting
pnpm lint
pnpm format
```

### Database & Testing
```bash
# Run tests that use the database (creates temp SQLite files)
cd apps/api && npm test

# Clean build artifacts
pnpm clean
```

## Architecture Overview

### Core Concepts
Arbiter is an **AI Agent Orchestration Platform** that uses a unique **left-to-right mesh network** workflow model. Think "Jenkins but for AI agents."

**Key Principle**: Events trigger workflows → Root agent processes → Next-level agents appear as tools → Parallel execution → Synchronous completion.

### Package Architecture
```
packages/
├── core/              # Shared TypeScript types and utilities
├── workflow-engine/   # Mesh network workflow execution
├── agent-runtime/     # Agent execution with Granite 3.3 optimizations  
├── event-system/      # Event triggers (webhook, cron, file-watch, manual)
├── database/          # SQLite persistence layer with repositories
```

### Application Layer
```
apps/
├── api/               # Express REST API server
├── web/               # React frontend with dashboard
├── e2e/               # Playwright end-to-end tests
```

### Database Layer
- **SQLite** with foreign key constraints enabled
- **ArbiterDatabase**: Core database operations
- **Repositories**: WorkflowRepository, AgentRepository, RunRepository  
- **RunLogger**: Comprehensive execution logging system
- **Schema**: workflows, agents, runs tables with proper relationships

### Workflow Execution Flow
1. **Event System** receives trigger (webhook, cron, manual, file-watch)
2. **WorkflowEngine** orchestrates execution using mesh network model
3. **AgentRuntime** executes individual agents with JSON-first architecture
4. **RunLogger** tracks all execution steps for debugging and analytics
5. **Database** persists workflows, agents, and execution history

### Agent Runtime Details
- **Granite 3.3 Optimized**: Specialized for Granite 3.3 2b with 128K context
- **JSON-First Responses**: Structured format for reliable agent communication
- **Tool Registration System**: Dynamic agent-to-agent communication
- **Context Management**: Multi-turn conversation handling

### API Design Patterns
- RESTful endpoints for workflows, agents, events, and runs
- Validation using Joi schemas
- Error handling middleware with proper HTTP status codes
- Rate limiting and security headers via Helmet
- CORS configuration for frontend integration

## Key Files and Their Roles

### Core Type Definitions
- `packages/core/src/types/workflow.ts` - WorkflowConfig, EventTrigger, WorkflowExecution
- `packages/core/src/types/agent.ts` - AgentConfig, AgentTool, AgentResponse
- `packages/core/src/types/event.ts` - ArbiterEvent, EventHandler definitions

### Main Service Classes
- `apps/api/src/services/arbiter-service-db.ts` - Main orchestration service with database persistence
- `packages/workflow-engine/src/workflow-engine.ts` - Mesh network workflow execution logic
- `packages/agent-runtime/src/granite-agent.ts` - Granite 3.3 optimized agent execution
- `packages/database/src/run-logger.ts` - Comprehensive execution logging and tracking

### Database Integration
- `packages/database/src/database.ts` - SQLite operations with proper schema
- `packages/database/src/repositories/` - Repository pattern for data access
- Foreign key relationships: runs → workflows, runs → agents

## Development Patterns

### Test Architecture
- **Unit Tests**: Jest for all packages and API routes
- **Integration Tests**: Event system → WorkflowEngine → AgentRuntime chains
- **E2E Tests**: Playwright for complete user workflows
- **Database Tests**: Temporary SQLite files for isolation

### Error Handling
- Custom error classes: `WorkflowError`, `AgentError`, `ArbiterError`
- Proper error propagation through the execution chain
- Database transaction handling with foreign key constraints

### Logging System
- Structured logging with `createLogger` from core package
- Different log levels: info, warn, error, debug
- Context-aware logging with execution IDs and agent IDs

### Monorepo Management
- **Turborepo** for build orchestration and caching
- **pnpm workspaces** for dependency management
- TypeScript compilation artifacts ignored in source directories
- Shared dependencies through `workspace:*` protocol

## Common Issues and Solutions

### Database Foreign Key Constraints
When creating test data or new records, always ensure:
1. Workflows exist before creating runs that reference them
2. Agents exist before creating runs that reference them  
3. Use proper Date objects, not ISO strings for timestamps

### TypeScript Build Issues
- Run `pnpm build` from root to ensure proper dependency compilation
- Check for circular dependencies between packages
- Use absolute imports with package names (e.g., `@arbiter/core`)

### Test Isolation
- Each test creates unique temporary SQLite databases
- Use `beforeEach`/`afterEach` for proper cleanup
- Avoid sharing database instances between test suites