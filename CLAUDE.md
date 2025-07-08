# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Essential Commands

### Development Workflow (Next.js)
```bash
# Install dependencies
npm install

# Start development server
npm run dev                    # Frontend + API on port 3000

# Build application
npm run build

# Start production server
npm start

# Run tests
npm run test                   # Jest tests
npm run test:e2e              # Playwright E2E tests

# Linting and formatting
npm run lint
```

## New Architecture Overview (Next.js)

### Core Concepts
Arbiter is an **AI Agent Orchestration Platform** that uses a unique **left-to-right mesh network** workflow model. Think "Jenkins but for AI agents."

**Key Principle**: Events trigger workflows → Root agent processes → Next-level agents appear as tools → Parallel execution → Synchronous completion.

### Simplified Architecture
```
├── src/
│   ├── app/                   # Next.js App Router pages
│   │   ├── dashboard/         # Main dashboard
│   │   ├── workflows/         # Workflow management
│   │   ├── agents/            # Agent management
│   │   ├── events/            # Event monitoring
│   │   └── settings/          # System settings
│   ├── pages/api/             # Next.js API routes
│   │   ├── health/            # Health endpoints
│   │   ├── workflows/         # Workflow API
│   │   └── agents/            # Agent API
│   ├── lib/                   # Core business logic
│   │   ├── core/              # Types and utilities
│   │   ├── database/          # SQLite persistence
│   │   ├── agents/            # Agent runtime
│   │   ├── workflow/          # Workflow engine
│   │   ├── events/            # Event system
│   │   ├── services/          # API services
│   │   └── utils/             # Shared utilities
│   ├── components/            # React components
│   └── hooks/                 # React hooks
├── tests/                     # All tests consolidated
└── public/                    # Static assets
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
- **llama.cpp Integration**: Local inference server at http://localhost:8080

### API Design Patterns
- Next.js API routes with proper HTTP methods
- Validation using Joi schemas
- Error handling with standardized responses
- SQLite database operations
- Environment-based configuration

## Key Files and Their Roles

### Core Type Definitions
- `src/lib/core/types/workflow.ts` - WorkflowConfig, EventTrigger, WorkflowExecution
- `src/lib/core/types/agent.ts` - AgentConfig, AgentTool, AgentResponse
- `src/lib/core/types/event.ts` - ArbiterEvent, EventHandler definitions

### Main Service Classes
- `src/lib/services/arbiter-service-db.ts` - Main orchestration service with database persistence
- `src/lib/workflow/workflow-engine.ts` - Mesh network workflow execution logic
- `src/lib/agents/granite-agent.ts` - Granite 3.3 optimized agent execution
- `src/lib/database/run-logger.ts` - Comprehensive execution logging and tracking

### Database Integration
- `src/lib/database/database.ts` - SQLite operations with proper schema
- `src/lib/database/repositories/` - Repository pattern for data access
- Foreign key relationships: runs → workflows, runs → agents

### API Endpoints
- `src/pages/api/health.ts` - System health monitoring
- `src/pages/api/workflows/` - Workflow CRUD operations
- `src/pages/api/agents/` - Agent management

### Frontend Pages
- `src/app/dashboard/page.tsx` - Main dashboard with analytics
- `src/app/workflows/page.tsx` - Workflow management interface
- `src/app/workflows/designer/page.tsx` - Workflow creation/editing
- `src/app/agents/page.tsx` - Agent management interface

## Development Patterns

### Testing Strategy
The testing strategy has been preserved from the original architecture:

- **Unit Tests**: Jest for lib/ modules
- **Integration Tests**: API endpoint testing
- **Component Tests**: React Testing Library for UI components
- **End-to-End Tests**: Playwright for full user workflows
- **Database Tests**: Temporary SQLite files for isolation

### Error Handling
- Custom error classes: `WorkflowError`, `AgentError`, `ArbiterError`
- Proper error propagation through the execution chain
- Next.js API error responses with proper HTTP status codes

### Logging System
- Structured logging with `createLogger` from core package
- Different log levels: info, warn, error, debug
- Context-aware logging with execution IDs and agent IDs

### Environment Configuration
- `DATABASE_PATH`: SQLite database file location (default: ./data/arbiter.db)
- Model configuration for llama.cpp integration
- API endpoint configurations

## llama.cpp Integration

### Setup
The platform is configured to work with llama.cpp running locally:

```bash
# Start llama.cpp server (separate terminal)
./llama-server --model /path/to/granite-3.3-2b-instruct-q4_k_m.gguf --port 8080

# The platform expects the server at:
# http://localhost:8080
```

### Model Configuration
- **Model**: Granite 3.3 2B Instruct (Q4_K_M quantization)
- **Context**: 128K tokens
- **Temperature**: 0.1 (deterministic)
- **Max Tokens**: 800
- **Format**: JSON-first responses

### Testing llama.cpp Integration
```bash
# Test agent execution with local model
node test-llama-integration.js
```

## Simplified Development Benefits

✅ **Single Package**: No more monorepo complexity  
✅ **Unified Development**: One `npm run dev` command  
✅ **Simplified Imports**: Direct module imports with `@/lib/`  
✅ **Better DX**: Hot reload for full-stack development  
✅ **Production Ready**: Next.js optimizations and deployment  
✅ **Same Functionality**: All features preserved from original architecture

## Migration Notes

The complex monorepo architecture with 8 packages has been successfully consolidated into a single Next.js application. All functionality has been preserved:

- All TypeScript types and interfaces maintained
- Complete database operations and repositories
- Full agent runtime with llama.cpp integration
- Complete workflow engine with mesh network execution
- All event triggers (webhook, cron, manual, file-watch)
- Complete React frontend with all components
- Comprehensive API with all endpoints
- Full test coverage architecture

The simplified architecture makes development much easier while maintaining all the powerful features of the Arbiter platform.