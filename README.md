# Arbiter - AI Agent Orchestration Platform

**Think Jenkins but for AI agents** - A comprehensive platform for orchestrating AI agent workflows with a mesh network architecture.

## 🚀 Features

### Core Architecture
- **Mesh Network Workflows**: Left-to-right processing with agents as tools
- **Event-Driven Triggers**: Webhooks, cron jobs, file watching, and manual triggers
- **Multi-Model Support**: Local llama.cpp, OpenAI, Gemini, Deepseek, and more
- **Real-time Monitoring**: Live workflow execution tracking and logging

### AI Agent Runtime
- **Granite 3.3 Optimized**: Specialized support for Granite 3.3 2b with 128K context
- **JSON-First Architecture**: Structured responses for reliable agent communication
- **Tool Registration System**: Dynamic tool loading and agent-to-agent communication
- **Context Management**: Multi-turn conversation handling with proper state management

### User Experience
- **Apple-Quality UX**: Modern, responsive web interface
- **Visual Workflow Designer**: Drag-and-drop workflow creation (coming soon)
- **CLI & TUI**: Command-line and terminal interfaces for remote management
- **Real-time Dashboard**: System health monitoring and quick actions

## 🏗 Architecture

```
arbiter/
├── apps/
│   ├── web/                 # React frontend
│   ├── api/                 # Express API server
│   ├── cli/                 # CLI tool
│   ├── tui/                 # Terminal UI
│   └── agents/              # Pre-built agent scripts
├── packages/
│   ├── core/                # Shared types and utilities
│   ├── workflow-engine/     # Mesh network workflow engine
│   ├── agent-runtime/       # Agent execution runtime
│   ├── event-system/        # Event triggers and handlers
│   ├── lsp/                 # LSP server integrations
│   ├── runtime-node/        # Node.js runtime
│   ├── runtime-python/      # Python runtime
│   └── ui-components/       # Shared UI components
└── tools/
    ├── testing/             # E2E testing setup
    └── deployment/          # Docker & deployment configs
```

## 🌊 Workflow Model

Arbiter uses a unique **left-to-right mesh network** approach:

```
Event → [Root Agent] → [Agent 2a] → [Agent 3a]
              ↓         [Agent 2b] → [Agent 3b]
              ↓         [Agent 2c] → [Agent 3c]
              ↓
        [Final Agent] (receives all responses)
```

### Key Principles:
1. **Event Triggers Workflow**: Every workflow starts with an event
2. **Root Agent Processes**: First agent receives event data + optional user prompt
3. **Agents as Tools**: Next-level agents appear as tools to current agent
4. **Parallel Execution**: Tool calls execute simultaneously
5. **Synchronous Completion**: Agent waits for all tool responses before continuing

## 🚦 Getting Started

### Prerequisites
- Node.js 18+
- pnpm 8+
- llama.cpp server (for local AI models)

### Installation

1. **Clone and setup monorepo**:
```bash
git clone <repository-url>
cd arbiter
pnpm install
```

2. **Start llama.cpp server** (for Granite 3.3):
```bash
./llama-server -m models/granite-3b-code-instruct-128k.gguf -c 128000 --port 8080
```

3. **Start development servers**:
```bash
# Terminal 1 - API Server
cd apps/api
pnpm dev

# Terminal 2 - Web Frontend
cd apps/web
pnpm dev
```

4. **Access the application**:
- Web UI: http://localhost:3000
- API: http://localhost:3001
- Health Check: http://localhost:3001/api/health

## 📋 Current Implementation Status

### ✅ Completed
- [x] Monorepo structure with pnpm workspaces
- [x] Core TypeScript interfaces and types
- [x] Mesh network workflow engine
- [x] Agent runtime with Granite 3.3 optimizations
- [x] Event system (webhook, cron, file-watch, manual)
- [x] Express API server with full REST endpoints
- [x] React frontend with dashboard and workflow management
- [x] Real-time system monitoring

### 🚧 In Progress
- [ ] Visual workflow designer with ReactFlow
- [ ] CLI tool implementation
- [ ] TUI (Terminal User Interface)

### 📋 Planned
- [ ] Agent management interface
- [ ] Event monitoring dashboard
- [ ] E2E testing with Playwright
- [ ] Pre-built agent templates
- [ ] Advanced workflow features (branching, conditionals)
- [ ] Multi-model provider support
- [ ] Plugin system

## 🔧 API Endpoints

### Workflows
- `GET /api/workflows` - List workflows
- `POST /api/workflows` - Create workflow
- `GET /api/workflows/:id` - Get workflow
- `PUT /api/workflows/:id` - Update workflow
- `DELETE /api/workflows/:id` - Delete workflow
- `POST /api/workflows/:id/execute` - Execute workflow

### Agents
- `GET /api/agents` - List agents
- `POST /api/agents` - Create agent
- `GET /api/agents/:id` - Get agent
- `PUT /api/agents/:id` - Update agent
- `DELETE /api/agents/:id` - Delete agent
- `POST /api/agents/:id/execute` - Execute agent

### Events
- `GET /api/events/handlers` - List event handlers
- `POST /api/events/handlers/:id/enable` - Enable handler
- `POST /api/events/handlers/:id/disable` - Disable handler
- `POST /api/events/trigger/:workflowId` - Trigger manual event
- `GET /api/events/executions` - List executions
- `POST /api/events/executions/:id/cancel` - Cancel execution

## 🤖 Granite 3.3 Integration

Arbiter is optimized for Granite 3.3 2b with 128K context:

### System Prompt Template
```json
{
  "role": "system",
  "content": "You are an autonomous AI assistant. You must respond in JSON format with this exact structure:\n{\n  \"reasoning\": \"Your step-by-step reasoning\",\n  \"tool_calls\": [...],\n  \"next_steps\": \"What you plan next\",\n  \"status\": \"working|completed|need_info|error\"\n}\n\nAvailable Tools:\n- tool_name: description\n\nWork autonomously to complete the task."
}
```

### Token Allocation
- Simple tasks: 300-500 tokens
- Complex reasoning: 800-1200 tokens
- Multi-step workflows: 1000-1500 tokens

### Response Processing
- JSON-first parsing with fallback handling
- Tool call validation and execution
- Multi-turn conversation management
- Error recovery and retry mechanisms

## 🏃‍♂️ Example Workflow

### DevOps Bug Investigation
```
GitHub Issue Event → [Triage Agent] → [Investigation Agent] → [Solution Agent]
                           ↓              [Testing Agent]      [Documentation Agent]
                     [Priority Agent]
```

1. **Event**: GitHub issue created/updated
2. **Triage Agent**: Analyzes issue, categorizes, and determines next steps
3. **Parallel Tools**: Investigation, testing, and priority assessment
4. **Solution Agent**: Receives all analyses and creates actionable solution

## 🧪 Testing

### Unit Tests
```bash
pnpm test
```

### E2E Tests (Planned)
```bash
pnpm test:e2e
```

## 🚀 Deployment

### Docker (Planned)
```bash
docker-compose up -d
```

### Environment Variables
```env
NODE_ENV=production
PORT=3001
FRONTEND_URL=http://localhost:3000
GRANITE_API_URL=http://localhost:8080
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 📄 License

MIT License - see LICENSE file for details

## 🆘 Support

For support and questions:
- Create an issue on GitHub
- Check the documentation
- Review example workflows

---

**Arbiter**: Making AI agent orchestration as simple and powerful as Jenkins made CI/CD.
