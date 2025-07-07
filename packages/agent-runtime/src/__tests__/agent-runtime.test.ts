import { AgentRuntime } from '../agent-runtime';
import {
  AgentConfig,
  ModelProviderConfig,
  AgentTool,
  ValidationError,
  AgentError,
} from '@arbiter/core';

// Mock the GraniteAgent
jest.mock('../granite-agent', () => ({
  GraniteAgent: jest.fn().mockImplementation(() => ({
    registerTool: jest.fn(),
    execute: jest.fn().mockResolvedValue({
      reasoning: 'Mock execution',
      tool_calls: [],
      next_steps: 'Mock completed',
      status: 'completed',
    }),
    executeToolCall: jest.fn(),
    getConversationHistory: jest.fn().mockReturnValue([]),
    clearConversation: jest.fn(),
    getToolCount: jest.fn().mockReturnValue(0),
    getAvailableTools: jest.fn().mockReturnValue([]),
  })),
}));

// Mock logger
jest.mock('@arbiter/core', () => ({
  ...jest.requireActual('@arbiter/core'),
  createLogger: () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  }),
}));

describe('AgentRuntime', () => {
  let runtime: AgentRuntime;

  beforeEach(() => {
    runtime = new AgentRuntime();
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create a new agent runtime instance', () => {
      expect(runtime).toBeInstanceOf(AgentRuntime);
    });

    it('should initialize with default model configurations', () => {
      const providers = runtime.getModelProviders();
      expect(providers).toContain('granite');
    });

    it('should have granite as default model provider', () => {
      const graniteConfig = runtime.getModelProviderConfig('granite');
      expect(graniteConfig).toBeDefined();
      expect(graniteConfig?.type).toBe('local');
      expect(graniteConfig?.config.baseUrl).toBe('http://localhost:8080');
    });
  });

  describe('registerModelProvider', () => {
    it('should register a new model provider', () => {
      const config: ModelProviderConfig = {
        type: 'openai',
        name: 'openai-gpt4',
        config: {
          apiKey: 'test-key',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-4',
        },
      };

      runtime.registerModelProvider('openai', config);
      
      const providers = runtime.getModelProviders();
      expect(providers).toContain('openai');
      
      const retrievedConfig = runtime.getModelProviderConfig('openai');
      expect(retrievedConfig).toEqual(config);
    });

    it('should override existing provider if same name is used', () => {
      const config1: ModelProviderConfig = {
        type: 'local',
        name: 'test-model-1',
        config: { baseUrl: 'http://localhost:8080' },
      };

      const config2: ModelProviderConfig = {
        type: 'local',
        name: 'test-model-2',
        config: { baseUrl: 'http://localhost:8081' },
      };

      runtime.registerModelProvider('test', config1);
      runtime.registerModelProvider('test', config2);
      
      const retrievedConfig = runtime.getModelProviderConfig('test');
      expect(retrievedConfig).toEqual(config2);
    });
  });

  describe('createAgent', () => {
    const validAgentConfig: AgentConfig = {
      id: 'test-agent',
      name: 'Test Agent',
      description: 'A test agent',
      model: 'granite',
      systemPrompt: 'You are a test agent',
      availableTools: [],
      level: 0,
    };

    it('should create an agent successfully', () => {
      const agentId = runtime.createAgent(validAgentConfig);
      
      expect(agentId).toBe('test-agent');
      expect(runtime.listAgents()).toContain('test-agent');
    });

    it('should validate agent configuration', () => {
      const invalidConfig = {} as AgentConfig;
      
      expect(() => runtime.createAgent(invalidConfig)).toThrow(ValidationError);
    });

    it('should throw error for unknown model provider', () => {
      const configWithUnknownModel = {
        ...validAgentConfig,
        id: 'unknown-model-agent',
      };
      
      expect(() => 
        runtime.createAgent(configWithUnknownModel, 'unknown-provider')
      ).toThrow(AgentError);
    });

    it('should register global tools with new agent', () => {
      const globalTool: AgentTool = {
        name: 'global_tool',
        description: 'A global tool',
        parameters: {},
        execute: jest.fn(),
      };

      runtime.registerGlobalTool(globalTool);
      
      const agentConfig = {
        ...validAgentConfig,
        availableTools: ['global_tool'],
        id: 'agent-with-global-tool',
      };

      runtime.createAgent(agentConfig);
      
      // Verify agent was created and global tool was registered
      expect(runtime.listAgents()).toContain('agent-with-global-tool');
    });
  });

  describe('executeAgent', () => {
    const agentConfig: AgentConfig = {
      id: 'executable-agent',
      name: 'Executable Agent',
      description: 'An agent for execution testing',
      model: 'granite',
      systemPrompt: 'You are executable',
      availableTools: [],
      level: 0,
    };

    beforeEach(() => {
      runtime.createAgent(agentConfig);
    });

    it('should execute an existing agent', async () => {
      const input = { task: 'test execution' };
      const result = await runtime.executeAgent('executable-agent', input);
      
      expect(result).toBeDefined();
      expect(result.reasoning).toBe('Mock execution');
      expect(result.status).toBe('completed');
    });

    it('should pass user prompt to agent execution', async () => {
      const input = { task: 'test execution' };
      const userPrompt = 'Please be careful';
      
      await runtime.executeAgent('executable-agent', input, userPrompt);
      
      // Verify the mocked agent execute method was called
      const mockAgent = runtime.getAgent('executable-agent');
      expect(mockAgent?.execute).toHaveBeenCalledWith(input, userPrompt, undefined);
    });

    it('should throw error for non-existent agent', async () => {
      const input = { task: 'test' };
      
      await expect(
        runtime.executeAgent('non-existent-agent', input)
      ).rejects.toThrow(AgentError);
    });
  });

  describe('agent management', () => {
    const agentConfig: AgentConfig = {
      id: 'manageable-agent',
      name: 'Manageable Agent',
      description: 'An agent for management testing',
      model: 'granite',
      systemPrompt: 'You are manageable',
      availableTools: [],
      level: 0,
    };

    it('should retrieve agent by ID', async () => {
      runtime.createAgent(agentConfig);
      
      const agent = runtime.getAgent('manageable-agent');
      expect(agent).toBeDefined();
    });

    it('should return undefined for non-existent agent', () => {
      const agent = runtime.getAgent('non-existent');
      expect(agent).toBeUndefined();
    });

    it('should list all created agents', () => {
      runtime.createAgent(agentConfig);
      runtime.createAgent({
        ...agentConfig,
        id: 'another-agent',
        name: 'Another Agent',
      });
      
      const agents = runtime.listAgents();
      expect(agents).toContain('manageable-agent');
      expect(agents).toContain('another-agent');
      expect(agents).toHaveLength(2);
    });

    it('should remove agents', () => {
      runtime.createAgent(agentConfig);
      expect(runtime.listAgents()).toContain('manageable-agent');
      
      const removed = runtime.removeAgent('manageable-agent');
      expect(removed).toBe(true);
      expect(runtime.listAgents()).not.toContain('manageable-agent');
    });

    it('should return false when removing non-existent agent', () => {
      const removed = runtime.removeAgent('non-existent');
      expect(removed).toBe(false);
    });
  });

  describe('tool management', () => {
    it('should register global tools', () => {
      const globalTool: AgentTool = {
        name: 'global_calculator',
        description: 'Global calculation tool',
        parameters: {},
        execute: jest.fn(),
      };

      runtime.registerGlobalTool(globalTool);
      
      const globalTools = runtime.getGlobalTools();
      expect(globalTools).toContain('global_calculator');
    });

    it('should register tools for specific agents', () => {
      const agentConfig: AgentConfig = {
        id: 'tool-agent',
        name: 'Tool Agent',
        description: 'Agent with tools',
        model: 'granite',
        systemPrompt: 'You have tools',
        availableTools: [],
        level: 0,
      };

      runtime.createAgent(agentConfig);

      const specificTool: AgentTool = {
        name: 'specific_tool',
        description: 'Agent-specific tool',
        parameters: {},
        execute: jest.fn(),
      };

      runtime.registerAgentTool('tool-agent', specificTool);
      
      // Verify tool was registered with the agent
      const agent = runtime.getAgent('tool-agent');
      expect(agent?.registerTool).toHaveBeenCalledWith(specificTool);
    });

    it('should throw error when registering tool for non-existent agent', () => {
      const tool: AgentTool = {
        name: 'orphaned_tool',
        description: 'Tool without agent',
        parameters: {},
        execute: jest.fn(),
      };

      expect(() => 
        runtime.registerAgentTool('non-existent-agent', tool)
      ).toThrow(AgentError);
    });

    it('should add global tools to existing agents when they have it in available tools', () => {
      const agentConfig: AgentConfig = {
        id: 'future-tool-agent',
        name: 'Future Tool Agent',
        description: 'Agent that will get a global tool',
        model: 'granite',
        systemPrompt: 'You will get tools',
        availableTools: ['future_global_tool'],
        level: 0,
      };

      runtime.createAgent(agentConfig);

      const globalTool: AgentTool = {
        name: 'future_global_tool',
        description: 'Tool registered after agent creation',
        parameters: {},
        execute: jest.fn(),
      };

      runtime.registerGlobalTool(globalTool);
      
      // Verify the tool was added to the existing agent
      const agent = runtime.getAgent('future-tool-agent');
      expect(agent?.registerTool).toHaveBeenCalledWith(globalTool);
    });
  });

  describe('createAgentTool', () => {
    it('should create an agent tool from agent config', () => {
      const targetAgentConfig: AgentConfig = {
        id: 'target-agent',
        name: 'Target Agent',
        description: 'Agent to be used as tool',
        model: 'granite',
        systemPrompt: 'You are a target',
        availableTools: [],
        level: 1,
      };

      runtime.createAgent(targetAgentConfig);

      const agentTool = runtime.createAgentTool(targetAgentConfig);
      
      expect(agentTool.name).toBe('Target Agent');
      expect(agentTool.description).toBe('Agent to be used as tool');
      expect(typeof agentTool.execute).toBe('function');
    });

    it('should execute agent when agent tool is called', async () => {
      const targetAgentConfig: AgentConfig = {
        id: 'callable-agent',
        name: 'Callable Agent',
        description: 'Agent callable as tool',
        model: 'granite',
        systemPrompt: 'You are callable',
        availableTools: [],
        level: 1,
      };

      runtime.createAgent(targetAgentConfig);

      const agentTool = runtime.createAgentTool(targetAgentConfig);
      const params = { input: 'tool call test' };
      
      const result = await agentTool.execute(params);
      
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.metadata.agentId).toBe('callable-agent');
    });
  });

  describe('conversation management', () => {
    const agentConfig: AgentConfig = {
      id: 'conversation-agent',
      name: 'Conversation Agent',
      description: 'Agent for conversation testing',
      model: 'granite',
      systemPrompt: 'You like to chat',
      availableTools: [],
      level: 0,
    };

    beforeEach(() => {
      runtime.createAgent(agentConfig);
    });

    it('should clear agent conversation', () => {
      runtime.clearAgentConversation('conversation-agent');
      
      const agent = runtime.getAgent('conversation-agent');
      expect(agent?.clearConversation).toHaveBeenCalled();
    });

    it('should get agent conversation history', () => {
      const history = runtime.getAgentConversationHistory('conversation-agent');
      
      const agent = runtime.getAgent('conversation-agent');
      expect(agent?.getConversationHistory).toHaveBeenCalled();
      expect(Array.isArray(history)).toBe(true);
    });

    it('should return empty array for non-existent agent conversation', () => {
      const history = runtime.getAgentConversationHistory('non-existent');
      expect(history).toEqual([]);
    });
  });

  describe('tool execution', () => {
    const agentConfig: AgentConfig = {
      id: 'tool-executor-agent',
      name: 'Tool Executor Agent',
      description: 'Agent that executes tools',
      model: 'granite',
      systemPrompt: 'You execute tools',
      availableTools: [],
      level: 0,
    };

    beforeEach(() => {
      runtime.createAgent(agentConfig);
    });

    it('should execute tool call on agent', async () => {
      const toolCall = {
        tool_name: 'test_tool',
        parameters: { param: 'value' },
        purpose: 'testing',
        sequence_order: 1,
      };

      await runtime.executeToolCall('tool-executor-agent', toolCall);
      
      const agent = runtime.getAgent('tool-executor-agent');
      expect(agent?.executeToolCall).toHaveBeenCalledWith(toolCall);
    });

    it('should throw error for non-existent agent tool execution', async () => {
      const toolCall = {
        tool_name: 'test_tool',
        parameters: {},
        purpose: 'testing',
        sequence_order: 1,
      };

      await expect(
        runtime.executeToolCall('non-existent-agent', toolCall)
      ).rejects.toThrow(AgentError);
    });
  });

  describe('getAgentConfig', () => {
    it('should return basic agent config', () => {
      const agentConfig: AgentConfig = {
        id: 'config-test-agent',
        name: 'Config Test Agent',
        description: 'Agent for config testing',
        model: 'granite',
        systemPrompt: 'You are configurable',
        availableTools: ['tool1', 'tool2'],
        level: 0,
      };

      runtime.createAgent(agentConfig);
      
      const retrievedConfig = runtime.getAgentConfig('config-test-agent');
      
      expect(retrievedConfig).toBeDefined();
      expect(retrievedConfig?.id).toBe('config-test-agent');
      expect(retrievedConfig?.name).toBe('Config Test Agent');
      expect(retrievedConfig?.model).toBe('granite');
    });

    it('should return undefined for non-existent agent config', () => {
      const config = runtime.getAgentConfig('non-existent');
      expect(config).toBeUndefined();
    });
  });
});