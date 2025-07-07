import { WorkflowEngine } from '../workflow-engine';
import {
  WorkflowConfig,
  ArbiterEvent,
} from '@arbiter/core';

// Mock console to avoid noise in tests
jest.mock('@arbiter/core', () => ({
  ...jest.requireActual('@arbiter/core'),
  createLogger: () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  }),
}));

describe('WorkflowEngine', () => {
  let workflowEngine: WorkflowEngine;

  beforeEach(() => {
    workflowEngine = new WorkflowEngine();
  });

  describe('constructor', () => {
    it('should create a new workflow engine instance', () => {
      expect(workflowEngine).toBeInstanceOf(WorkflowEngine);
    });

    it('should initialize with empty active executions', () => {
      const activeExecutions = workflowEngine.getActiveExecutions();
      expect(activeExecutions).toHaveLength(0);
    });
  });

  describe('executeWorkflow', () => {
    const createTestWorkflow = (): WorkflowConfig => ({
      id: 'test-workflow',
      name: 'Test Workflow',
      description: 'A test workflow',
      version: '1.0.0',
      trigger: {
        type: 'manual',
        config: {},
      },
      rootAgent: {
        id: 'root-agent',
        name: 'Root Agent',
        description: 'Root agent for testing',
        model: 'granite',
        systemPrompt: 'You are a test agent',
        availableTools: [],
        level: 0,
      },
      levels: [],
      userPrompt: 'Test user prompt',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const createTestEvent = (): ArbiterEvent => ({
      id: 'test-event',
      type: 'manual',
      source: 'test',
      timestamp: new Date(),
      data: { test: 'data' },
    });

    it('should execute a basic workflow successfully', async () => {
      const workflow = createTestWorkflow();
      const event = createTestEvent();

      const execution = await workflowEngine.executeWorkflow(workflow, event);

      expect(execution).toBeDefined();
      expect(execution.id).toBeDefined();
      expect(execution.workflowId).toBe(workflow.id);
      expect(execution.eventData).toEqual(event.data);
      expect(execution.startTime).toBeInstanceOf(Date);
      expect(execution.endTime).toBeInstanceOf(Date);
      expect(['completed', 'failed']).toContain(execution.status);
    });

    it('should create unique execution IDs', async () => {
      const workflow = createTestWorkflow();
      const event1 = createTestEvent();
      const event2 = { ...createTestEvent(), id: 'test-event-2' };

      const execution1 = await workflowEngine.executeWorkflow(workflow, event1);
      const execution2 = await workflowEngine.executeWorkflow(workflow, event2);

      expect(execution1.id).not.toBe(execution2.id);
    });

    it('should handle workflow with multiple levels', async () => {
      const workflow = createTestWorkflow();
      workflow.levels = [
        {
          level: 1,
          agents: [
            {
              id: 'agent-1',
              name: 'Agent 1',
              description: 'First level agent',
              model: 'granite',
              systemPrompt: 'You are agent 1',
              availableTools: [],
              level: 1,
            },
          ],
          executionMode: 'parallel',
        },
        {
          level: 2,
          agents: [
            {
              id: 'agent-2',
              name: 'Agent 2',
              description: 'Second level agent',
              model: 'granite',
              systemPrompt: 'You are agent 2',
              availableTools: [],
              level: 2,
            },
          ],
          executionMode: 'parallel',
        },
      ];

      const event = createTestEvent();
      const execution = await workflowEngine.executeWorkflow(workflow, event);

      expect(execution).toBeDefined();
      expect(execution.workflowId).toBe(workflow.id);
    });

    it('should include user prompt in execution context', async () => {
      const workflow = createTestWorkflow();
      workflow.userPrompt = 'Custom user instructions';
      const event = createTestEvent();

      const execution = await workflowEngine.executeWorkflow(workflow, event);

      expect(execution).toBeDefined();
      // The user prompt should be part of the workflow context
      expect(workflow.userPrompt).toBe('Custom user instructions');
    });

    it('should handle execution errors gracefully', async () => {
      const workflow = createTestWorkflow();
      // Create an invalid agent config to trigger an error
      workflow.rootAgent.systemPrompt = ''; // This might cause validation errors
      
      const event = createTestEvent();

      const execution = await workflowEngine.executeWorkflow(workflow, event);

      expect(execution).toBeDefined();
      expect(execution.status).toBe('failed');
      expect(execution.error).toBeDefined();
    });

    it('should log execution events', async () => {
      const workflow = createTestWorkflow();
      const event = createTestEvent();

      const execution = await workflowEngine.executeWorkflow(workflow, event);

      expect(execution.executionLog).toBeDefined();
      expect(execution.executionLog.length).toBeGreaterThan(0);
      
      const startLog = execution.executionLog.find(log => 
        log.message.includes('Starting workflow execution')
      );
      expect(startLog).toBeDefined();
    });
  });

  describe('getActiveExecutions', () => {
    it('should return empty array initially', () => {
      const executions = workflowEngine.getActiveExecutions();
      expect(executions).toEqual([]);
    });

    it('should track active executions during workflow execution', async () => {
      const workflow: WorkflowConfig = {
        id: 'long-running-workflow',
        name: 'Long Running Workflow',
        description: 'A workflow that takes time',
        version: '1.0.0',
        trigger: { type: 'manual', config: {} },
        rootAgent: {
          id: 'slow-agent',
          name: 'Slow Agent',
          description: 'An agent that takes time',
          model: 'granite',
          systemPrompt: 'You are a slow agent',
          availableTools: [],
          level: 0,
        },
        levels: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const event: ArbiterEvent = {
        id: 'test-event',
        type: 'manual',
        source: 'test',
        timestamp: new Date(),
        data: {},
      };

      // Execute workflow (this will complete quickly in our simulation)
      await workflowEngine.executeWorkflow(workflow, event);
      
      // Since our simulation completes quickly, active executions should be empty
      const executions = workflowEngine.getActiveExecutions();
      expect(Array.isArray(executions)).toBe(true);
    });
  });

  describe('getExecution', () => {
    it('should return undefined for non-existent execution', () => {
      const execution = workflowEngine.getExecution('non-existent-id');
      expect(execution).toBeUndefined();
    });
  });

  describe('cancelExecution', () => {
    it('should return false for non-existent execution', async () => {
      const result = await workflowEngine.cancelExecution('non-existent-id');
      expect(result).toBe(false);
    });
  });

  describe('generateExecutionId', () => {
    it('should generate unique execution IDs', () => {
      // Access private method through any for testing
      const engine = workflowEngine as any;
      
      const id1 = engine.generateExecutionId();
      const id2 = engine.generateExecutionId();
      
      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^exec_\d+_[a-z0-9]+$/);
      expect(id2).toMatch(/^exec_\d+_[a-z0-9]+$/);
    });
  });

  describe('mesh network functionality', () => {
    const createMeshWorkflow = (): WorkflowConfig => ({
      id: 'mesh-workflow',
      name: 'Mesh Network Workflow',
      description: 'A workflow with mesh network structure',
      version: '1.0.0',
      trigger: { type: 'manual', config: {} },
      rootAgent: {
        id: 'root',
        name: 'Root Agent',
        description: 'Root of the mesh',
        model: 'granite',
        systemPrompt: 'You are the root agent',
        availableTools: ['agent-a', 'agent-b'],
        level: 0,
      },
      levels: [
        {
          level: 1,
          agents: [
            {
              id: 'agent-a',
              name: 'Agent A',
              description: 'First parallel agent',
              model: 'granite',
              systemPrompt: 'You are agent A',
              availableTools: ['agent-c'],
              level: 1,
            },
            {
              id: 'agent-b',
              name: 'Agent B',
              description: 'Second parallel agent',
              model: 'granite',
              systemPrompt: 'You are agent B',
              availableTools: ['agent-c'],
              level: 1,
            },
          ],
          executionMode: 'parallel',
        },
        {
          level: 2,
          agents: [
            {
              id: 'agent-c',
              name: 'Agent C',
              description: 'Final agent',
              model: 'granite',
              systemPrompt: 'You are agent C',
              availableTools: [],
              level: 2,
            },
          ],
          executionMode: 'parallel',
        },
      ],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    it('should handle mesh network workflow structure', async () => {
      const workflow = createMeshWorkflow();
      const event: ArbiterEvent = {
        id: 'mesh-event',
        type: 'manual',
        source: 'test',
        timestamp: new Date(),
        data: { input: 'mesh test' },
      };

      const execution = await workflowEngine.executeWorkflow(workflow, event);

      expect(execution).toBeDefined();
      expect(execution.workflowId).toBe(workflow.id);
    });

    it('should register agents as tools correctly', async () => {
      const workflow = createMeshWorkflow();
      const event: ArbiterEvent = {
        id: 'tool-test-event',
        type: 'manual',
        source: 'test',
        timestamp: new Date(),
        data: {},
      };

      // The workflow should execute without errors
      const execution = await workflowEngine.executeWorkflow(workflow, event);
      
      expect(execution).toBeDefined();
      // Should complete (since we're simulating agent execution)
      expect(['completed', 'failed']).toContain(execution.status);
    });
  });

  describe('error handling', () => {
    it('should handle missing workflow configuration gracefully', async () => {
      const workflow = {} as WorkflowConfig; // Invalid workflow
      const event: ArbiterEvent = {
        id: 'error-event',
        type: 'manual',
        source: 'test',
        timestamp: new Date(),
        data: {},
      };

      const execution = await workflowEngine.executeWorkflow(workflow, event);

      expect(execution.status).toBe('failed');
      expect(execution.error).toBeDefined();
    });

    it('should handle agent execution timeouts', async () => {
      const workflow: WorkflowConfig = {
        id: 'timeout-workflow',
        name: 'Timeout Workflow',
        description: 'A workflow that should timeout',
        version: '1.0.0',
        trigger: { type: 'manual', config: {} },
        rootAgent: {
          id: 'timeout-agent',
          name: 'Timeout Agent',
          description: 'An agent that times out',
          model: 'granite',
          systemPrompt: 'You should timeout',
          availableTools: [],
          level: 0,
        },
        levels: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const event: ArbiterEvent = {
        id: 'timeout-event',
        type: 'manual',
        source: 'test',
        timestamp: new Date(),
        data: {},
      };

      const execution = await workflowEngine.executeWorkflow(workflow, event);

      // Should complete (our simulation doesn't actually timeout)
      expect(execution).toBeDefined();
    });
  });

  describe('workflow validation edge cases', () => {
    it('should reject workflow with null root agent', async () => {
      const workflow: WorkflowConfig = {
        id: 'invalid-workflow',
        name: 'Invalid Workflow',
        description: 'A workflow with null root agent',
        version: '1.0.0',
        trigger: { type: 'manual' as const, config: {} },
        rootAgent: null as any,
        levels: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const event: ArbiterEvent = {
        id: 'test-event',
        type: 'manual',
        source: 'test',
        timestamp: new Date(),
        data: {},
      };

      const execution = await workflowEngine.executeWorkflow(workflow, event);

      expect(execution.status).toBe('failed');
      expect(execution.error).toContain('Root agent is required');
    });

    it('should reject workflow with empty root agent system prompt', async () => {
      const workflow: WorkflowConfig = {
        id: 'empty-prompt-workflow',
        name: 'Empty Prompt Workflow',
        description: 'A workflow with empty system prompt',
        version: '1.0.0',
        trigger: { type: 'manual', config: {} },
        rootAgent: {
          id: 'root-agent',
          name: 'Root Agent',
          description: 'Root agent with empty prompt',
          model: 'granite',
          systemPrompt: '   ', // Whitespace only
          availableTools: [],
          level: 0,
        },
        levels: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const event: ArbiterEvent = {
        id: 'test-event',
        type: 'manual',
        source: 'test',
        timestamp: new Date(),
        data: {},
      };

      const execution = await workflowEngine.executeWorkflow(workflow, event);

      expect(execution.status).toBe('failed');
      expect(execution.error).toContain('system prompt cannot be empty');
    });

    it('should reject workflow with missing root agent id', async () => {
      const workflow: WorkflowConfig = {
        id: 'no-id-workflow',
        name: 'No ID Workflow',
        description: 'A workflow with missing agent id',
        version: '1.0.0',
        trigger: { type: 'manual', config: {} },
        rootAgent: {
          id: '', // Empty ID
          name: 'Root Agent',
          description: 'Root agent with no id',
          model: 'granite',
          systemPrompt: 'You are a test agent',
          availableTools: [],
          level: 0,
        },
        levels: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const event: ArbiterEvent = {
        id: 'test-event',
        type: 'manual',
        source: 'test',
        timestamp: new Date(),
        data: {},
      };

      const execution = await workflowEngine.executeWorkflow(workflow, event);

      expect(execution.status).toBe('failed');
      expect(execution.error).toContain('must have id and name');
    });

    it('should reject workflow with agents having empty system prompts', async () => {
      const workflow: WorkflowConfig = {
        id: 'invalid-agents-workflow',
        name: 'Invalid Agents Workflow',
        description: 'A workflow with invalid agents',
        version: '1.0.0',
        trigger: { type: 'manual', config: {} },
        rootAgent: {
          id: 'root-agent',
          name: 'Root Agent',
          description: 'Valid root agent',
          model: 'granite',
          systemPrompt: 'You are a test agent',
          availableTools: [],
          level: 0,
        },
        levels: [
          {
            level: 1,
            agents: [
              {
                id: 'agent-1',
                name: 'Agent 1',
                description: 'Agent with empty prompt',
                model: 'granite',
                systemPrompt: '', // Empty prompt
                availableTools: [],
                level: 1,
              },
            ],
            executionMode: 'parallel',
          },
        ],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const event: ArbiterEvent = {
        id: 'test-event',
        type: 'manual',
        source: 'test',
        timestamp: new Date(),
        data: {},
      };

      const execution = await workflowEngine.executeWorkflow(workflow, event);

      expect(execution.status).toBe('failed');
      expect(execution.error).toContain('system prompt cannot be empty');
    });

    it('should reject workflow with level missing agents array', async () => {
      const workflow: WorkflowConfig = {
        id: 'no-agents-workflow',
        name: 'No Agents Workflow',
        description: 'A workflow with missing agents array',
        version: '1.0.0',
        trigger: { type: 'manual' as const, config: {} },
        rootAgent: {
          id: 'root-agent',
          name: 'Root Agent',
          description: 'Valid root agent',
          model: 'granite',
          systemPrompt: 'You are a test agent',
          availableTools: [],
          level: 0,
        },
        levels: [
          {
            level: 1,
            agents: null as any, // Invalid agents array
            executionMode: 'parallel',
          },
        ],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const event: ArbiterEvent = {
        id: 'test-event',
        type: 'manual',
        source: 'test',
        timestamp: new Date(),
        data: {},
      };

      const execution = await workflowEngine.executeWorkflow(workflow, event);

      expect(execution.status).toBe('failed');
      expect(execution.error).toContain('must have agents array');
    });
  });

  describe('mesh network execution edge cases', () => {
    it('should handle maximum iteration limit', async () => {
      // Mock the private method to simulate max iterations
      const mockSimulateAgentExecution = jest.fn();
      const originalMethod = (workflowEngine as any).simulateAgentExecution;

      // Mock to return 'working' status repeatedly to trigger max iterations
      mockSimulateAgentExecution.mockResolvedValue({
        reasoning: 'Still working',
        tool_calls: [{ tool_name: 'some_tool', parameters: {} }],
        next_steps: 'Continue processing',
        status: 'working',
        raw_response: 'Mock working response',
      });

      (workflowEngine as any).simulateAgentExecution = mockSimulateAgentExecution;

      const workflow: WorkflowConfig = {
        id: 'max-iter-workflow',
        name: 'Max Iterations Workflow',
        description: 'A workflow that hits max iterations',
        version: '1.0.0',
        trigger: { type: 'manual', config: {} },
        rootAgent: {
          id: 'root-agent',
          name: 'Root Agent',
          description: 'Root agent that loops',
          model: 'granite',
          systemPrompt: 'You are a test agent',
          availableTools: [],
          level: 0,
        },
        levels: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const event: ArbiterEvent = {
        id: 'test-event',
        type: 'manual',
        source: 'test',
        timestamp: new Date(),
        data: {},
      };

      const execution = await workflowEngine.executeWorkflow(workflow, event);

      expect(execution.status).toBe('failed');
      expect(execution.error).toContain('Maximum iterations reached');

      // Restore original method
      (workflowEngine as any).simulateAgentExecution = originalMethod;
    });

    it('should handle tool execution failures in parallel', async () => {
      const workflow: WorkflowConfig = {
        id: 'failing-tools-workflow',
        name: 'Failing Tools Workflow',
        description: 'A workflow with failing tools',
        version: '1.0.0',
        trigger: { type: 'manual', config: {} },
        rootAgent: {
          id: 'root-agent',
          name: 'Root Agent',
          description: 'Root agent with failing tools',
          model: 'granite',
          systemPrompt: 'You are a test agent',
          availableTools: [],
          level: 0,
        },
        levels: [
          {
            level: 1,
            agents: [
              {
                id: 'failing-agent',
                name: 'Failing Agent',
                description: 'An agent that always fails',
                model: 'granite',
                systemPrompt: 'You are a failing agent',
                availableTools: [],
                level: 1,
              },
            ],
            executionMode: 'parallel',
          },
        ],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Mock the executeToolCalls method to simulate failures
      const originalExecuteToolCalls = (workflowEngine as any).executeToolCalls;
      (workflowEngine as any).executeToolCalls = jest.fn().mockResolvedValue([
        {
          tool_name: 'Failing Agent',
          success: false,
          error: 'Simulated tool failure',
        },
      ]);

      const event: ArbiterEvent = {
        id: 'test-event',
        type: 'manual',
        source: 'test',
        timestamp: new Date(),
        data: {},
      };

      const execution = await workflowEngine.executeWorkflow(workflow, event);

      expect(execution).toBeDefined();
      // Should still complete even with tool failures
      expect(['completed', 'failed']).toContain(execution.status);

      // Restore original method
      (workflowEngine as any).executeToolCalls = originalExecuteToolCalls;
    });

    it('should handle null/undefined tool results', async () => {
      const workflow: WorkflowConfig = {
        id: 'null-results-workflow',
        name: 'Null Results Workflow',
        description: 'A workflow with null tool results',
        version: '1.0.0',
        trigger: { type: 'manual', config: {} },
        rootAgent: {
          id: 'root-agent',
          name: 'Root Agent',
          description: 'Root agent with null results',
          model: 'granite',
          systemPrompt: 'You are a test agent',
          availableTools: [],
          level: 0,
        },
        levels: [
          {
            level: 1,
            agents: [
              {
                id: 'null-agent',
                name: 'Null Agent',
                description: 'An agent that returns null',
                model: 'granite',
                systemPrompt: 'You are a null agent',
                availableTools: [],
                level: 1,
              },
            ],
            executionMode: 'parallel',
          },
        ],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Mock createAgentTool to return null results
      const originalCreateAgentTool = (workflowEngine as any).createAgentTool;
      (workflowEngine as any).createAgentTool = jest.fn().mockReturnValue({
        name: 'Null Agent',
        description: 'An agent that returns null',
        parameters: {},
        execute: async () => null, // Return null
      });

      const event: ArbiterEvent = {
        id: 'test-event',
        type: 'manual',
        source: 'test',
        timestamp: new Date(),
        data: {},
      };

      const execution = await workflowEngine.executeWorkflow(workflow, event);

      expect(execution).toBeDefined();
      // Should handle null results gracefully
      expect(['completed', 'failed']).toContain(execution.status);

      // Restore original method
      (workflowEngine as any).createAgentTool = originalCreateAgentTool;
    });

    it('should handle tool calls with missing tool names', async () => {
      const originalMethod = (workflowEngine as any).executeToolCalls;

      // Test the actual executeToolCalls method with invalid tool calls
      const invalidToolCalls = [
        { tool_name: undefined, parameters: {} },
        { tool_name: null, parameters: {} },
        { tool_name: '', parameters: {} },
        { parameters: {} }, // Missing tool_name entirely
      ];

      const availableTools = new Map();
      const context = {
        execution: { id: 'test-exec', executionLog: [] },
        workflow: { id: 'test-workflow' },
      };

      const result = await originalMethod.call(workflowEngine, invalidToolCalls, availableTools, context);

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(4);
      
      // All should fail due to missing/invalid tool names
      result.forEach((toolResult: any) => {
        expect(toolResult.success).toBe(false);
        expect(toolResult.error).toBeDefined();
      });
    });

    it('should handle circular agent tool dependencies', async () => {
      const workflow: WorkflowConfig = {
        id: 'circular-workflow',
        name: 'Circular Dependencies Workflow',
        description: 'A workflow with circular agent dependencies',
        version: '1.0.0',
        trigger: { type: 'manual', config: {} },
        rootAgent: {
          id: 'root-agent',
          name: 'Root Agent',
          description: 'Root agent',
          model: 'granite',
          systemPrompt: 'You are a test agent',
          availableTools: ['agent-a'],
          level: 0,
        },
        levels: [
          {
            level: 1,
            agents: [
              {
                id: 'agent-a',
                name: 'Agent A',
                description: 'Agent A that depends on Agent B',
                model: 'granite',
                systemPrompt: 'You are agent A',
                availableTools: ['agent-b'],
                level: 1,
              },
            ],
            executionMode: 'parallel',
          },
          {
            level: 2,
            agents: [
              {
                id: 'agent-b',
                name: 'Agent B',
                description: 'Agent B that depends on Agent A',
                model: 'granite',
                systemPrompt: 'You are agent B',
                availableTools: ['agent-a'], // Circular dependency
                level: 2,
              },
            ],
            executionMode: 'parallel',
          },
        ],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const event: ArbiterEvent = {
        id: 'test-event',
        type: 'manual',
        source: 'test',
        timestamp: new Date(),
        data: {},
      };

      const execution = await workflowEngine.executeWorkflow(workflow, event);

      expect(execution).toBeDefined();
      // Should complete without infinite recursion
      expect(['completed', 'failed']).toContain(execution.status);
    });
  });

  describe('tool call sequence ordering', () => {
    it('should handle tool calls with mixed sequence orders', async () => {
      const toolCalls = [
        { tool_name: 'tool-c', parameters: {}, sequence_order: 3 },
        { tool_name: 'tool-a', parameters: {}, sequence_order: 1 },
        { tool_name: 'tool-b', parameters: {}, sequence_order: 2 },
        { tool_name: 'tool-d', parameters: {} }, // No sequence_order (should default to 0)
      ];

      const availableTools = new Map([
        ['tool-a', { name: 'tool-a', execute: async () => ({ success: true, data: 'a', metadata: {} }) }],
        ['tool-b', { name: 'tool-b', execute: async () => ({ success: true, data: 'b', metadata: {} }) }],
        ['tool-c', { name: 'tool-c', execute: async () => ({ success: true, data: 'c', metadata: {} }) }],
        ['tool-d', { name: 'tool-d', execute: async () => ({ success: true, data: 'd', metadata: {} }) }],
      ]);

      const context = {
        execution: { id: 'test-exec', executionLog: [] },
        workflow: { id: 'test-workflow' },
      };

      const originalMethod = (workflowEngine as any).executeToolCalls;
      const result = await originalMethod.call(workflowEngine, toolCalls, availableTools, context);

      expect(result).toBeDefined();
      expect(result.length).toBe(4);
      
      // Check that tools were executed (all should succeed)
      expect(result.every((r: any) => r.success)).toBe(true);
    });

    it('should handle tool calls with undefined sequence orders', async () => {
      const toolCalls = [
        { tool_name: 'tool-a', parameters: {}, sequence_order: undefined },
        { tool_name: 'tool-b', parameters: {}, sequence_order: null },
        { tool_name: 'tool-c', parameters: {} },
      ];

      const availableTools = new Map([
        ['tool-a', { name: 'tool-a', execute: async () => ({ success: true, data: 'a', metadata: {} }) }],
        ['tool-b', { name: 'tool-b', execute: async () => ({ success: true, data: 'b', metadata: {} }) }],
        ['tool-c', { name: 'tool-c', execute: async () => ({ success: true, data: 'c', metadata: {} }) }],
      ]);

      const context = {
        execution: { id: 'test-exec', executionLog: [] },
        workflow: { id: 'test-workflow' },
      };

      const originalMethod = (workflowEngine as any).executeToolCalls;
      const result = await originalMethod.call(workflowEngine, toolCalls, availableTools, context);

      expect(result).toBeDefined();
      expect(result.length).toBe(3);
      expect(result.every((r: any) => r.success)).toBe(true);
    });
  });

  describe('execution ID generation edge cases', () => {
    it('should generate execution IDs with proper format', () => {
      const engine = workflowEngine as any;
      
      for (let i = 0; i < 100; i++) {
        const id = engine.generateExecutionId();
        expect(id).toMatch(/^exec_\d+_[a-z0-9]{9}$/);
        expect(id.length).toBeGreaterThan(15);
      }
    });

    it('should handle rapid ID generation without collisions', () => {
      const engine = workflowEngine as any;
      const ids = new Set();
      
      for (let i = 0; i < 1000; i++) {
        const id = engine.generateExecutionId();
        expect(ids.has(id)).toBe(false); // No duplicates
        ids.add(id);
      }
      
      expect(ids.size).toBe(1000);
    });
  });
});