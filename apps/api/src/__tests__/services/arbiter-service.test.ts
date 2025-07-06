import { ArbiterService } from '../../services/arbiter-service';
import {
  WorkflowConfig,
  AgentConfig,
  WorkflowExecution,
  ArbiterEvent,
  ArbiterError,
} from '@arbiter/core';

// Mock dependencies
jest.mock('@arbiter/workflow-engine');
jest.mock('@arbiter/agent-runtime');
jest.mock('@arbiter/event-system');
jest.mock('@arbiter/core', () => ({
  ...jest.requireActual('@arbiter/core'),
  createLogger: () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  }),
}));

import { WorkflowEngine } from '@arbiter/workflow-engine';
import { AgentRuntime } from '@arbiter/agent-runtime';
import { EventSystem } from '@arbiter/event-system';

const MockWorkflowEngine = WorkflowEngine as jest.MockedClass<typeof WorkflowEngine>;
const MockAgentRuntime = AgentRuntime as jest.MockedClass<typeof AgentRuntime>;
const MockEventSystem = EventSystem as jest.MockedClass<typeof EventSystem>;

describe('ArbiterService', () => {
  let arbiterService: ArbiterService;
  let mockWorkflowEngine: jest.Mocked<WorkflowEngine>;
  let mockAgentRuntime: jest.Mocked<AgentRuntime>;
  let mockEventSystem: jest.Mocked<EventSystem>;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Create mock instances
    mockWorkflowEngine = {
      executeWorkflow: jest.fn(),
      getActiveExecutions: jest.fn(),
      getExecution: jest.fn(),
      cancelExecution: jest.fn(),
    } as any;

    mockAgentRuntime = {
      createAgent: jest.fn(),
      removeAgent: jest.fn(),
      executeAgent: jest.fn(),
      listAgents: jest.fn(),
    } as any;

    mockEventSystem = {
      setEventTriggerHandler: jest.fn(),
      startEventSystem: jest.fn(),
      stopEventSystem: jest.fn(),
      registerWorkflow: jest.fn(),
      unregisterWorkflow: jest.fn(),
      triggerManualEvent: jest.fn(),
      getEventHandlers: jest.fn(),
      enableEventHandler: jest.fn(),
      disableEventHandler: jest.fn(),
      getEventStats: jest.fn(),
    } as any;

    // Setup mock constructors
    MockWorkflowEngine.mockImplementation(() => mockWorkflowEngine);
    MockAgentRuntime.mockImplementation(() => mockAgentRuntime);
    MockEventSystem.mockImplementation(() => mockEventSystem);

    arbiterService = new ArbiterService();
  });

  const createTestWorkflow = (): WorkflowConfig => ({
    id: 'test-workflow-1',
    name: 'Test Workflow',
    description: 'A test workflow',
    version: '1.0.0',
    userPrompt: 'Test user prompt',
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
    levels: [
      {
        level: 1,
        agents: [
          {
            id: 'agent-1',
            name: 'Agent 1',
            description: 'Test agent',
            model: 'granite',
            systemPrompt: 'You are agent 1',
            availableTools: [],
            level: 1,
          },
        ],
        executionMode: 'parallel',
      },
    ],
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const createTestAgent = (): AgentConfig => ({
    id: 'test-agent',
    name: 'Test Agent',
    description: 'A test agent',
    model: 'granite',
    systemPrompt: 'You are a test agent',
    availableTools: [],
    level: 0,
  });

  describe('constructor', () => {
    it('should create instances of dependencies', () => {
      expect(MockWorkflowEngine).toHaveBeenCalledTimes(1);
      expect(MockAgentRuntime).toHaveBeenCalledTimes(1);
      expect(MockEventSystem).toHaveBeenCalledTimes(1);
    });
  });

  describe('initialize', () => {
    it('should set up event trigger handler and start event system', async () => {
      await arbiterService.initialize();

      expect(mockEventSystem.setEventTriggerHandler).toHaveBeenCalledWith(expect.any(Function));
      expect(mockEventSystem.startEventSystem).toHaveBeenCalledTimes(1);
    });

    it('should handle workflow execution via event handler', async () => {
      const workflow = createTestWorkflow();
      const execution: WorkflowExecution = {
        id: 'exec-123',
        workflowId: workflow.id,
        status: 'completed',
        startTime: new Date(),
        eventData: {},
        currentLevel: 0,
        executionLog: [],
        result: null,
      };

      mockWorkflowEngine.executeWorkflow.mockResolvedValue(execution);

      await arbiterService.initialize();
      await arbiterService.createWorkflow(workflow);

      // Get the event handler that was set
      const eventHandler = mockEventSystem.setEventTriggerHandler.mock.calls[0][0];

      const event: ArbiterEvent = {
        id: 'test-event',
        type: 'manual',
        source: 'test',
        timestamp: new Date(),
        data: {},
        metadata: { workflowId: workflow.id },
      };

      const result = await eventHandler(event);

      expect(result).toEqual({
        success: true,
        workflowExecutionId: 'exec-123',
        error: undefined,
      });

      expect(mockWorkflowEngine.executeWorkflow).toHaveBeenCalledWith(workflow, event);
    });

    it('should handle unknown workflow in event handler', async () => {
      await arbiterService.initialize();

      const eventHandler = mockEventSystem.setEventTriggerHandler.mock.calls[0][0];

      const event: ArbiterEvent = {
        id: 'test-event',
        type: 'manual',
        source: 'test',
        timestamp: new Date(),
        data: {},
        metadata: { workflowId: 'unknown-workflow' },
      };

      await expect(eventHandler(event)).rejects.toThrow(ArbiterError);
      await expect(eventHandler(event)).rejects.toThrow('Workflow not found: unknown-workflow');
    });
  });

  describe('shutdown', () => {
    it('should stop event system', async () => {
      await arbiterService.shutdown();

      expect(mockEventSystem.stopEventSystem).toHaveBeenCalledTimes(1);
    });
  });

  describe('workflow management', () => {
    describe('createWorkflow', () => {
      it('should create workflow and register agents', async () => {
        const workflow = createTestWorkflow();
        mockAgentRuntime.createAgent.mockReturnValue('agent-id');

        const workflowId = await arbiterService.createWorkflow(workflow);

        expect(workflowId).toBe(workflow.id);
        expect(mockAgentRuntime.createAgent).toHaveBeenCalledWith(workflow.rootAgent);
        expect(mockAgentRuntime.createAgent).toHaveBeenCalledWith(workflow.levels[0].agents[0]);
        expect(mockEventSystem.registerWorkflow).toHaveBeenCalledWith(workflow);
      });

      it('should handle workflows with multiple levels', async () => {
        const workflow = createTestWorkflow();
        workflow.levels.push({
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
        });

        mockAgentRuntime.createAgent.mockReturnValue('agent-id');

        await arbiterService.createWorkflow(workflow);

        expect(mockAgentRuntime.createAgent).toHaveBeenCalledTimes(3); // root + 2 levels
      });
    });

    describe('getWorkflow', () => {
      it('should return workflow by id', async () => {
        const workflow = createTestWorkflow();
        await arbiterService.createWorkflow(workflow);

        const result = await arbiterService.getWorkflow(workflow.id);

        expect(result).toEqual(workflow);
      });

      it('should return undefined for non-existent workflow', async () => {
        const result = await arbiterService.getWorkflow('non-existent');

        expect(result).toBeUndefined();
      });
    });

    describe('listWorkflows', () => {
      it('should return all workflows', async () => {
        const workflow1 = createTestWorkflow();
        const workflow2 = { ...createTestWorkflow(), id: 'test-workflow-2', name: 'Test Workflow 2' };

        await arbiterService.createWorkflow(workflow1);
        await arbiterService.createWorkflow(workflow2);

        const workflows = await arbiterService.listWorkflows();

        expect(workflows).toHaveLength(2);
        expect(workflows).toContain(workflow1);
        expect(workflows).toContain(workflow2);
      });

      it('should return empty array when no workflows exist', async () => {
        const workflows = await arbiterService.listWorkflows();

        expect(workflows).toEqual([]);
      });
    });

    describe('updateWorkflow', () => {
      it('should update existing workflow', async () => {
        const workflow = createTestWorkflow();
        await arbiterService.createWorkflow(workflow);

        const updatedWorkflow = { ...workflow, name: 'Updated Workflow' };

        await arbiterService.updateWorkflow(workflow.id, updatedWorkflow);

        expect(mockEventSystem.unregisterWorkflow).toHaveBeenCalledWith(workflow.id);
        expect(mockEventSystem.registerWorkflow).toHaveBeenCalledWith(updatedWorkflow);

        const result = await arbiterService.getWorkflow(workflow.id);
        expect(result?.name).toBe('Updated Workflow');
      });

      it('should throw error for non-existent workflow', async () => {
        const workflow = createTestWorkflow();

        await expect(arbiterService.updateWorkflow('non-existent', workflow))
          .rejects.toThrow(ArbiterError);
        await expect(arbiterService.updateWorkflow('non-existent', workflow))
          .rejects.toThrow('Workflow not found: non-existent');
      });
    });

    describe('deleteWorkflow', () => {
      it('should delete existing workflow', async () => {
        const workflow = createTestWorkflow();
        await arbiterService.createWorkflow(workflow);

        await arbiterService.deleteWorkflow(workflow.id);

        expect(mockEventSystem.unregisterWorkflow).toHaveBeenCalledWith(workflow.id);

        const result = await arbiterService.getWorkflow(workflow.id);
        expect(result).toBeUndefined();
      });

      it('should throw error for non-existent workflow', async () => {
        await expect(arbiterService.deleteWorkflow('non-existent'))
          .rejects.toThrow(ArbiterError);
        await expect(arbiterService.deleteWorkflow('non-existent'))
          .rejects.toThrow('Workflow not found: non-existent');
      });
    });

    describe('executeWorkflow', () => {
      it('should execute workflow with event data', async () => {
        const workflow = createTestWorkflow();
        const execution: WorkflowExecution = {
          id: 'exec-123',
          workflowId: workflow.id,
          status: 'running',
          startTime: new Date(),
          eventData: { test: 'data' },
          currentLevel: 0,
          executionLog: [],
          result: null,
        };

        await arbiterService.createWorkflow(workflow);
        mockWorkflowEngine.executeWorkflow.mockResolvedValue(execution);

        const result = await arbiterService.executeWorkflow(workflow.id, { test: 'data' });

        expect(result).toEqual(execution);
        expect(mockWorkflowEngine.executeWorkflow).toHaveBeenCalledWith(
          workflow,
          expect.objectContaining({
            type: 'manual',
            source: 'api',
            data: { test: 'data' },
            metadata: { workflowId: workflow.id },
          })
        );
      });

      it('should throw error for non-existent workflow', async () => {
        await expect(arbiterService.executeWorkflow('non-existent', {}))
          .rejects.toThrow(ArbiterError);
        await expect(arbiterService.executeWorkflow('non-existent', {}))
          .rejects.toThrow('Workflow not found: non-existent');
      });
    });
  });

  describe('agent management', () => {
    describe('createAgent', () => {
      it('should create agent in runtime', async () => {
        const agent = createTestAgent();
        mockAgentRuntime.createAgent.mockReturnValue('agent-123');

        const agentId = await arbiterService.createAgent(agent);

        expect(agentId).toBe('agent-123');
        expect(mockAgentRuntime.createAgent).toHaveBeenCalledWith(agent);
      });
    });

    describe('getAgent', () => {
      it('should return agent by id', async () => {
        const agent = createTestAgent();
        await arbiterService.createAgent(agent);

        const result = await arbiterService.getAgent(agent.id);

        expect(result).toEqual(agent);
      });

      it('should return undefined for non-existent agent', async () => {
        const result = await arbiterService.getAgent('non-existent');

        expect(result).toBeUndefined();
      });
    });

    describe('listAgents', () => {
      it('should return all agents', async () => {
        const agent1 = createTestAgent();
        const agent2 = { ...createTestAgent(), id: 'test-agent-2', name: 'Test Agent 2' };

        await arbiterService.createAgent(agent1);
        await arbiterService.createAgent(agent2);

        const agents = await arbiterService.listAgents();

        expect(agents).toHaveLength(2);
        expect(agents).toContain(agent1);
        expect(agents).toContain(agent2);
      });
    });

    describe('updateAgent', () => {
      it('should update existing agent', async () => {
        const agent = createTestAgent();
        await arbiterService.createAgent(agent);

        const updatedAgent = { ...agent, name: 'Updated Agent' };

        await arbiterService.updateAgent(agent.id, updatedAgent);

        expect(mockAgentRuntime.removeAgent).toHaveBeenCalledWith(agent.id);
        expect(mockAgentRuntime.createAgent).toHaveBeenCalledWith(updatedAgent);

        const result = await arbiterService.getAgent(agent.id);
        expect(result?.name).toBe('Updated Agent');
      });

      it('should throw error for non-existent agent', async () => {
        const agent = createTestAgent();

        await expect(arbiterService.updateAgent('non-existent', agent))
          .rejects.toThrow(ArbiterError);
        await expect(arbiterService.updateAgent('non-existent', agent))
          .rejects.toThrow('Agent not found: non-existent');
      });
    });

    describe('deleteAgent', () => {
      it('should delete existing agent', async () => {
        const agent = createTestAgent();
        await arbiterService.createAgent(agent);

        await arbiterService.deleteAgent(agent.id);

        expect(mockAgentRuntime.removeAgent).toHaveBeenCalledWith(agent.id);

        const result = await arbiterService.getAgent(agent.id);
        expect(result).toBeUndefined();
      });

      it('should throw error for non-existent agent', async () => {
        await expect(arbiterService.deleteAgent('non-existent'))
          .rejects.toThrow(ArbiterError);
        await expect(arbiterService.deleteAgent('non-existent'))
          .rejects.toThrow('Agent not found: non-existent');
      });
    });

    describe('executeAgent', () => {
      it('should execute agent with input and user prompt', async () => {
        const agent = createTestAgent();
        await arbiterService.createAgent(agent);

        mockAgentRuntime.executeAgent.mockResolvedValue({ result: 'success' });

        const result = await arbiterService.executeAgent(agent.id, { input: 'test' }, 'user prompt');

        expect(result).toEqual({ result: 'success' });
        expect(mockAgentRuntime.executeAgent).toHaveBeenCalledWith(agent.id, { input: 'test' }, 'user prompt');
      });
    });
  });

  describe('event management', () => {
    describe('triggerManualEvent', () => {
      it('should trigger manual event via event system', async () => {
        mockEventSystem.triggerManualEvent.mockResolvedValue({ success: true });

        const result = await arbiterService.triggerManualEvent('workflow-1', { test: 'data' });

        expect(result).toEqual({ success: true });
        expect(mockEventSystem.triggerManualEvent).toHaveBeenCalledWith('workflow-1', { test: 'data' });
      });
    });

    describe('getEventHandlers', () => {
      it('should return event handlers from event system', async () => {
        const handlers = [{ id: 'handler-1', workflowId: 'workflow-1' }];
        mockEventSystem.getEventHandlers.mockReturnValue(handlers as any);

        const result = await arbiterService.getEventHandlers();

        expect(result).toEqual(handlers);
      });
    });

    describe('enableEventHandler', () => {
      it('should enable event handler via event system', async () => {
        await arbiterService.enableEventHandler('handler-1');

        expect(mockEventSystem.enableEventHandler).toHaveBeenCalledWith('handler-1');
      });
    });

    describe('disableEventHandler', () => {
      it('should disable event handler via event system', async () => {
        await arbiterService.disableEventHandler('handler-1');

        expect(mockEventSystem.disableEventHandler).toHaveBeenCalledWith('handler-1');
      });
    });
  });

  describe('execution management', () => {
    describe('getActiveExecutions', () => {
      it('should return active executions from workflow engine', () => {
        const executions = [{ execution: { id: 'exec-1' } }];
        mockWorkflowEngine.getActiveExecutions.mockReturnValue(executions as any);

        const result = arbiterService.getActiveExecutions();

        expect(result).toEqual(executions);
      });
    });

    describe('getExecution', () => {
      it('should return execution by id from workflow engine', () => {
        const execution = { execution: { id: 'exec-1' } };
        mockWorkflowEngine.getExecution.mockReturnValue(execution as any);

        const result = arbiterService.getExecution('exec-1');

        expect(result).toEqual(execution);
        expect(mockWorkflowEngine.getExecution).toHaveBeenCalledWith('exec-1');
      });
    });

    describe('cancelExecution', () => {
      it('should cancel execution via workflow engine', async () => {
        mockWorkflowEngine.cancelExecution.mockResolvedValue(true);

        const result = await arbiterService.cancelExecution('exec-1');

        expect(result).toBe(true);
        expect(mockWorkflowEngine.cancelExecution).toHaveBeenCalledWith('exec-1');
      });
    });
  });

  describe('getStatus', () => {
    it('should return comprehensive status information', async () => {
      const workflow = createTestWorkflow();
      const agent = createTestAgent();

      await arbiterService.createAgent(agent);
      await arbiterService.createWorkflow(workflow);

      const activeExecutions = [{ execution: { id: 'exec-1' } }];
      const eventStats = { totalHandlers: 1, enabledHandlers: 1, totalTriggers: 0 };

      mockWorkflowEngine.getActiveExecutions.mockReturnValue(activeExecutions as any);
      mockEventSystem.getEventStats.mockReturnValue(eventStats);
      mockAgentRuntime.listAgents.mockReturnValue(['agent-1']);

      const status = arbiterService.getStatus();

      expect(status).toEqual({
        workflows: {
          total: 1,
          enabled: 1,
        },
        agents: {
          total: 3, // 1 manual agent + 1 root agent + 1 level agent = 3 total
          runtime: 1,
        },
        executions: {
          active: 1,
        },
        events: eventStats,
        uptime: expect.any(Number),
        memory: expect.any(Object),
      });
    });

    it('should return zero counts for empty service', () => {
      mockWorkflowEngine.getActiveExecutions.mockReturnValue([]);
      mockEventSystem.getEventStats.mockReturnValue({ totalHandlers: 0, enabledHandlers: 0, totalTriggers: 0 });
      mockAgentRuntime.listAgents.mockReturnValue([]);

      const status = arbiterService.getStatus();

      expect(status.workflows.total).toBe(0);
      expect(status.agents.total).toBe(0);
      expect(status.executions.active).toBe(0);
    });
  });

  describe('integration scenarios', () => {
    it('should handle complete workflow lifecycle', async () => {
      // Initialize service
      await arbiterService.initialize();

      // Create workflow
      const workflow = createTestWorkflow();
      const workflowId = await arbiterService.createWorkflow(workflow);

      // Execute workflow
      const execution: WorkflowExecution = {
        id: 'exec-123',
        workflowId,
        status: 'completed',
        startTime: new Date(),
        eventData: {},
        currentLevel: 0,
        executionLog: [],
        result: null,
      };

      mockWorkflowEngine.executeWorkflow.mockResolvedValue(execution);
      const result = await arbiterService.executeWorkflow(workflowId, { test: 'data' });

      expect(result).toEqual(execution);

      // Delete workflow
      await arbiterService.deleteWorkflow(workflowId);

      // Verify cleanup
      const deletedWorkflow = await arbiterService.getWorkflow(workflowId);
      expect(deletedWorkflow).toBeUndefined();

      // Shutdown service
      await arbiterService.shutdown();

      expect(mockEventSystem.startEventSystem).toHaveBeenCalledTimes(1);
      expect(mockEventSystem.stopEventSystem).toHaveBeenCalledTimes(1);
    });

    it('should handle event handler workflow execution', async () => {
      await arbiterService.initialize();

      const workflow = createTestWorkflow();
      await arbiterService.createWorkflow(workflow);

      const execution: WorkflowExecution = {
        id: 'exec-123',
        workflowId: workflow.id,
        status: 'failed',
        startTime: new Date(),
        eventData: {},
        currentLevel: 0,
        executionLog: [],
        result: null,
        error: 'Test error',
      };

      mockWorkflowEngine.executeWorkflow.mockResolvedValue(execution);

      // Get and call the event handler
      const eventHandler = mockEventSystem.setEventTriggerHandler.mock.calls[0][0];

      const event: ArbiterEvent = {
        id: 'test-event',
        type: 'webhook',
        source: 'test',
        timestamp: new Date(),
        data: {},
        metadata: { workflowId: workflow.id },
      };

      const result = await eventHandler(event);

      expect(result).toEqual({
        success: false,
        workflowExecutionId: 'exec-123',
        error: 'Test error',
      });
    });
  });
});