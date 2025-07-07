import { GraniteAgent } from '../granite-agent';
import {
  AgentConfig,
  ModelProviderConfig,
  AgentTool,
} from '@arbiter/core';

// Mock node-fetch
jest.mock('node-fetch', () => ({
  __esModule: true,
  default: jest.fn(),
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

const mockFetch = jest.mocked(require('node-fetch').default);

describe('GraniteAgent', () => {
  let agent: GraniteAgent;
  let agentConfig: AgentConfig;
  let modelConfig: ModelProviderConfig;

  beforeEach(() => {
    agentConfig = {
      id: 'test-agent',
      name: 'Test Agent',
      description: 'A test agent for unit testing',
      model: 'granite',
      systemPrompt: 'You are a test agent',
      availableTools: [],
      level: 0,
    };

    modelConfig = {
      type: 'local',
      name: 'granite-test',
      config: {
        baseUrl: 'http://localhost:8080',
        model: 'granite',
        maxTokens: 800,
        temperature: 0.1,
      },
    };

    agent = new GraniteAgent(agentConfig, modelConfig);
    mockFetch.mockClear();
  });

  describe('constructor', () => {
    it('should create a new granite agent instance', () => {
      expect(agent).toBeInstanceOf(GraniteAgent);
    });

    it('should initialize with system prompt in conversation history', () => {
      const history = agent.getConversationHistory();
      expect(history).toHaveLength(1);
      expect(history[0].role).toBe('system');
      expect(history[0].content).toContain('You are a test agent');
    });

    it('should include available tools in system prompt', () => {
      const testTool: AgentTool = {
        name: 'test_tool',
        description: 'A test tool',
        parameters: {},
        execute: jest.fn(),
      };

      agent.registerTool(testTool);
      const history = agent.getConversationHistory();
      
      expect(history[0].content).toContain('test_tool: A test tool');
    });
  });

  describe('registerTool', () => {
    it('should register a tool successfully', () => {
      const testTool: AgentTool = {
        name: 'calculator',
        description: 'Performs calculations',
        parameters: { operation: 'string', numbers: 'array' },
        execute: jest.fn(),
      };

      agent.registerTool(testTool);
      expect(agent.getAvailableTools()).toContain('calculator');
      expect(agent.getToolCount()).toBe(1);
    });

    it('should update system prompt when tool is registered', () => {
      const initialHistory = agent.getConversationHistory();
      const initialSystemPrompt = initialHistory[0].content;

      const testTool: AgentTool = {
        name: 'new_tool',
        description: 'A newly registered tool',
        parameters: {},
        execute: jest.fn(),
      };

      agent.registerTool(testTool);
      const updatedHistory = agent.getConversationHistory();
      const updatedSystemPrompt = updatedHistory[0].content;

      expect(updatedSystemPrompt).not.toBe(initialSystemPrompt);
      expect(updatedSystemPrompt).toContain('new_tool: A newly registered tool');
    });
  });

  describe('execute', () => {
    beforeEach(() => {
      // Mock successful API response
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          choices: [{
            message: {
              content: JSON.stringify({
                reasoning: 'Test reasoning',
                tool_calls: [],
                next_steps: 'Test completed',
                status: 'completed',
              }),
            },
            finish_reason: 'stop',
          }],
          usage: {
            prompt_tokens: 100,
            completion_tokens: 50,
            total_tokens: 150,
          },
          model: 'granite',
        }),
      } as any);
    });

    it('should execute agent with input data', async () => {
      const input = { task: 'test task' };
      const result = await agent.execute(input);

      expect(result).toBeDefined();
      expect(result.reasoning).toBe('Test reasoning');
      expect(result.status).toBe('completed');
      expect(result.tool_calls).toEqual([]);
      expect(result.next_steps).toBe('Test completed');
    });

    it('should include user prompt in execution', async () => {
      const input = { task: 'test task' };
      const userPrompt = 'Please complete this task carefully';
      
      await agent.execute(input, userPrompt);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8080/v1/chat/completions',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: expect.stringContaining('User Instructions: Please complete this task carefully'),
        })
      );
    });

    it('should handle tool results in subsequent calls', async () => {
      const input = {
        tool_results: [
          {
            tool_name: 'test_tool',
            success: true,
            data: 'tool result data',
          },
        ],
      };

      await agent.execute(input);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8080/v1/chat/completions',
        expect.objectContaining({
          body: expect.stringContaining('Tool Results:'),
        })
      );
    });

    it('should maintain conversation history', async () => {
      const input = { task: 'first task' };
      await agent.execute(input);

      const history = agent.getConversationHistory();
      expect(history).toHaveLength(3); // system, user, assistant
      expect(history[1].role).toBe('user');
      expect(history[2].role).toBe('assistant');
    });

    it('should handle API errors gracefully', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      } as any);

      const input = { task: 'error task' };
      
      await expect(agent.execute(input)).rejects.toThrow();
    });

    it('should handle malformed JSON responses', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          choices: [{
            message: {
              content: 'Invalid JSON response',
            },
            finish_reason: 'stop',
          }],
        }),
      } as any);

      const input = { task: 'malformed response task' };
      
      await expect(agent.execute(input)).rejects.toThrow();
    });

    it('should handle JSON wrapped in code blocks', async () => {
      const jsonResponse = {
        reasoning: 'Code block test',
        tool_calls: [],
        next_steps: 'Completed',
        status: 'completed',
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          choices: [{
            message: {
              content: '```json\n' + JSON.stringify(jsonResponse) + '\n```',
            },
            finish_reason: 'stop',
          }],
        }),
      } as any);

      const input = { task: 'code block task' };
      const result = await agent.execute(input);

      expect(result.reasoning).toBe('Code block test');
      expect(result.status).toBe('completed');
    });
  });

  describe('executeToolCall', () => {
    it('should execute a registered tool successfully', async () => {
      const mockExecute = jest.fn().mockResolvedValue({
        success: true,
        data: 'tool execution result',
        metadata: {
          agentId: 'tool-agent',
          executionTime: 100,
        },
      });

      const testTool: AgentTool = {
        name: 'test_tool',
        description: 'A test tool',
        parameters: {},
        execute: mockExecute,
      };

      agent.registerTool(testTool);

      const toolCall = {
        tool_name: 'test_tool',
        parameters: { param1: 'value1' },
        purpose: 'testing',
        sequence_order: 1,
      };

      const result = await agent.executeToolCall(toolCall);

      expect(result.success).toBe(true);
      expect(result.data).toBe('tool execution result');
      expect(mockExecute).toHaveBeenCalledWith({ param1: 'value1' });
    });

    it('should handle non-existent tool calls', async () => {
      const toolCall = {
        tool_name: 'non_existent_tool',
        parameters: {},
        purpose: 'testing',
        sequence_order: 1,
      };

      const result = await agent.executeToolCall(toolCall);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Tool non_existent_tool not found');
    });

    it('should handle tool execution errors', async () => {
      const mockExecute = jest.fn().mockRejectedValue(new Error('Tool execution failed'));

      const testTool: AgentTool = {
        name: 'failing_tool',
        description: 'A tool that fails',
        parameters: {},
        execute: mockExecute,
      };

      agent.registerTool(testTool);

      const toolCall = {
        tool_name: 'failing_tool',
        parameters: {},
        purpose: 'testing failure',
        sequence_order: 1,
      };

      const result = await agent.executeToolCall(toolCall);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Tool execution failed');
    });
  });

  describe('conversation management', () => {
    it('should return conversation history', () => {
      const history = agent.getConversationHistory();
      
      expect(Array.isArray(history)).toBe(true);
      expect(history[0].role).toBe('system');
      expect(history[0].timestamp).toBeInstanceOf(Date);
    });

    it('should clear conversation but keep system prompt', () => {
      // Manually add messages to test clearing
      const agentAny = agent as any;
      agentAny.conversationHistory.push(
        { role: 'user', content: 'test message', timestamp: new Date() },
        { role: 'assistant', content: 'test response', timestamp: new Date() }
      );

      expect(agent.getConversationHistory()).toHaveLength(3);

      agent.clearConversation();
      const history = agent.getConversationHistory();

      expect(history).toHaveLength(1);
      expect(history[0].role).toBe('system');
    });
  });

  describe('tool management', () => {
    it('should return correct tool count', () => {
      expect(agent.getToolCount()).toBe(0);

      const tool1: AgentTool = {
        name: 'tool1',
        description: 'First tool',
        parameters: {},
        execute: jest.fn(),
      };

      const tool2: AgentTool = {
        name: 'tool2',
        description: 'Second tool',
        parameters: {},
        execute: jest.fn(),
      };

      agent.registerTool(tool1);
      expect(agent.getToolCount()).toBe(1);

      agent.registerTool(tool2);
      expect(agent.getToolCount()).toBe(2);
    });

    it('should return available tool names', () => {
      const tool1: AgentTool = {
        name: 'calculator',
        description: 'Math operations',
        parameters: {},
        execute: jest.fn(),
      };

      const tool2: AgentTool = {
        name: 'weather',
        description: 'Weather information',
        parameters: {},
        execute: jest.fn(),
      };

      agent.registerTool(tool1);
      agent.registerTool(tool2);

      const availableTools = agent.getAvailableTools();
      expect(availableTools).toContain('calculator');
      expect(availableTools).toContain('weather');
      expect(availableTools).toHaveLength(2);
    });
  });

  describe('model integration', () => {
    it('should use correct model configuration', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          choices: [{
            message: { content: '{"reasoning":"test","tool_calls":[],"status":"completed"}' },
            finish_reason: 'stop',
          }],
        }),
      } as any);

      await agent.execute({ task: 'test' });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8080/v1/chat/completions',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: expect.stringContaining('"model":"granite"'),
        })
      );
    });

    it('should handle model timeout configuration', async () => {
      mockFetch.mockImplementation(() => 
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Timeout')), 100)
        )
      );

      const input = { task: 'timeout test' };
      
      await expect(agent.execute(input)).rejects.toThrow();
    });
  });

  describe('JSON response parsing', () => {
    it('should parse valid JSON responses correctly', () => {
      const agentAny = agent as any;
      const validJson = '{"reasoning": "test", "status": "completed"}';
      
      const result = agentAny.parseGraniteResponse(validJson);
      expect(result).toEqual({ reasoning: 'test', status: 'completed' });
    });

    it('should handle JSON wrapped in markdown code blocks', () => {
      const agentAny = agent as any;
      const wrappedJson = '```json\n{"reasoning": "test", "status": "completed"}\n```';
      
      const result = agentAny.parseGraniteResponse(wrappedJson);
      expect(result).toEqual({ reasoning: 'test', status: 'completed' });
    });

    it('should return null for invalid JSON', () => {
      const agentAny = agent as any;
      const invalidJson = '{"invalid": json}';
      
      const result = agentAny.parseGraniteResponse(invalidJson);
      expect(result).toBeNull();
    });

    it('should handle malformed code blocks', () => {
      const agentAny = agent as any;
      const malformedCodeBlock = '```json\n{"reasoning": "test", "status": "completed"'; // Missing closing ```
      
      const result = agentAny.parseGraniteResponse(malformedCodeBlock);
      expect(result).toBeNull();
    });

    it('should handle empty response', () => {
      const agentAny = agent as any;
      const emptyResponse = '';
      
      const result = agentAny.parseGraniteResponse(emptyResponse);
      expect(result).toBeNull();
    });

    it('should handle null response', () => {
      const agentAny = agent as any;
      const nullResponse = null;
      
      const result = agentAny.parseGraniteResponse(nullResponse);
      expect(result).toBeNull();
    });

    it('should handle response with extra text before JSON', () => {
      const agentAny = agent as any;
      const responseWithExtra = 'Here is my response:\n{"reasoning": "test", "status": "completed"}';
      
      const result = agentAny.parseGraniteResponse(responseWithExtra);
      expect(result).toBeNull(); // Should fail because it's not pure JSON
    });

    it('should handle response with multiple code blocks', () => {
      const agentAny = agent as any;
      const multipleBlocks = '```json\n{"reasoning": "first"}\n```\n\n```json\n{"status": "completed"}\n```';
      
      const result = agentAny.parseGraniteResponse(multipleBlocks);
      expect(result).toEqual({ reasoning: 'first' }); // Should parse first block
    });

    it('should handle deeply nested JSON', () => {
      const agentAny = agent as any;
      const deepJson = JSON.stringify({
        reasoning: "test",
        status: "completed",
        tool_calls: [{
          tool_name: "test",
          parameters: {
            nested: {
              deep: {
                value: "test"
              }
            }
          }
        }]
      });
      
      const result = agentAny.parseGraniteResponse(deepJson);
      expect(result.tool_calls[0].parameters.nested.deep.value).toBe("test");
    });
  });

  describe('error handling edge cases', () => {
    it('should handle network timeout', async () => {
      mockFetch.mockImplementation(() => 
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Network timeout')), 50)
        )
      );

      const input = { task: 'timeout test' };
      
      await expect(agent.execute(input)).rejects.toThrow('Agent execution failed');
    });

    it('should handle API returning 429 (rate limit)', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
      } as any);

      const input = { task: 'rate limit test' };
      
      await expect(agent.execute(input)).rejects.toThrow();
    });

    it('should handle API returning malformed JSON', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.reject(new Error('Malformed JSON')),
      } as any);

      const input = { task: 'malformed json test' };
      
      await expect(agent.execute(input)).rejects.toThrow();
    });

    it('should handle API response with missing choices', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          usage: { prompt_tokens: 100, completion_tokens: 50 },
          model: 'granite',
          // Missing choices array
        }),
      } as any);

      const input = { task: 'missing choices test' };
      
      await expect(agent.execute(input)).rejects.toThrow();
    });

    it('should handle API response with empty choices array', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          choices: [], // Empty choices
          usage: { prompt_tokens: 100, completion_tokens: 50 },
          model: 'granite',
        }),
      } as any);

      const input = { task: 'empty choices test' };
      
      await expect(agent.execute(input)).rejects.toThrow();
    });

    it('should handle API response with null message content', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          choices: [{
            message: {
              content: null, // Null content
            },
            finish_reason: 'stop',
          }],
          usage: { prompt_tokens: 100, completion_tokens: 50 },
          model: 'granite',
        }),
      } as any);

      const input = { task: 'null content test' };
      
      await expect(agent.execute(input)).rejects.toThrow();
    });

    it('should handle response missing required fields', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          choices: [{
            message: {
              content: '{"reasoning": "test"}', // Missing status field
            },
            finish_reason: 'stop',
          }],
          usage: { prompt_tokens: 100, completion_tokens: 50 },
          model: 'granite',
        }),
      } as any);

      const input = { task: 'missing fields test' };
      
      await expect(agent.execute(input)).rejects.toThrow('Missing required fields');
    });
  });

  describe('tool call edge cases', () => {
    it('should handle tool returning null result', async () => {
      const mockExecute = jest.fn().mockResolvedValue(null);

      const testTool: AgentTool = {
        name: 'null_tool',
        description: 'A tool that returns null',
        parameters: {},
        execute: mockExecute,
      };

      agent.registerTool(testTool);

      const toolCall = {
        tool_name: 'null_tool',
        parameters: {},
      };

      const result = await agent.executeToolCall(toolCall);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should handle tool throwing string error', async () => {
      const mockExecute = jest.fn().mockRejectedValue('String error message');

      const testTool: AgentTool = {
        name: 'string_error_tool',
        description: 'A tool that throws string error',
        parameters: {},
        execute: mockExecute,
      };

      agent.registerTool(testTool);

      const toolCall = {
        tool_name: 'string_error_tool',
        parameters: {},
      };

      const result = await agent.executeToolCall(toolCall);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Unknown error');
    });

    it('should handle tool with undefined parameters', async () => {
      const mockExecute = jest.fn().mockResolvedValue({
        success: true,
        data: 'success',
        metadata: { executionTime: 100 },
      });

      const testTool: AgentTool = {
        name: 'undefined_params_tool',
        description: 'A tool with undefined params',
        parameters: {},
        execute: mockExecute,
      };

      agent.registerTool(testTool);

      const toolCall = {
        tool_name: 'undefined_params_tool',
        parameters: undefined,
      };

      const result = await agent.executeToolCall(toolCall);

      expect(result.success).toBe(true);
      expect(mockExecute).toHaveBeenCalledWith(undefined);
    });
  });

  describe('conversation history edge cases', () => {
    it('should handle very long conversation history', async () => {
      const agentAny = agent as any;
      
      // Add many messages to test history management
      for (let i = 0; i < 100; i++) {
        agentAny.conversationHistory.push({
          role: i % 2 === 0 ? 'user' : 'assistant',
          content: `Message ${i}`,
          timestamp: new Date(),
        });
      }

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          choices: [{
            message: {
              content: '{"reasoning": "test", "status": "completed"}',
            },
            finish_reason: 'stop',
          }],
          usage: { prompt_tokens: 100, completion_tokens: 50 },
          model: 'granite',
        }),
      } as any);

      const input = { task: 'long history test' };
      
      await expect(agent.execute(input)).resolves.toBeDefined();
      expect(agentAny.conversationHistory.length).toBe(103); // 100 + system + user + assistant
    });

    it('should handle messages with special characters', async () => {
      const input = { 
        task: 'Special chars: 你好 🌟 <script>alert("xss")</script> \n\t\r\0'
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          choices: [{
            message: {
              content: '{"reasoning": "handled special chars", "status": "completed"}',
            },
            finish_reason: 'stop',
          }],
          usage: { prompt_tokens: 100, completion_tokens: 50 },
          model: 'granite',
        }),
      } as any);

      const result = await agent.execute(input);
      
      expect(result.reasoning).toBe('handled special chars');
    });
  });

  describe('buildUserMessage edge cases', () => {
    it('should handle circular references in input', () => {
      const agentAny = agent as any;
      const circularInput: any = { task: 'circular test' };
      circularInput.self = circularInput; // Create circular reference

      const message = agentAny.buildUserMessage(circularInput);
      
      expect(message).toContain('Task Input:');
      expect(message).toContain('[Circular Reference]');
      // Should not crash due to circular reference
    });

    it('should handle very large input objects', () => {
      const agentAny = agent as any;
      const largeInput = {
        task: 'large input test',
        data: new Array(1000).fill(0).map((_, i) => ({ id: i, value: `item ${i}` }))
      };

      const message = agentAny.buildUserMessage(largeInput);
      
      expect(message).toContain('Task Input:');
      expect(message.length).toBeGreaterThan(1000);
    });

    it('should handle undefined and null values in input', () => {
      const agentAny = agent as any;
      const inputWithNulls = {
        task: 'null test',
        nullValue: null,
        undefinedValue: undefined,
      };

      const message = agentAny.buildUserMessage(inputWithNulls);
      
      expect(message).toContain('Task Input:');
      expect(message).toContain('null');
    });
  });
});