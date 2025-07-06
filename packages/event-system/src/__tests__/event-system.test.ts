import { EventSystem } from '../event-system';
import {
  WorkflowConfig,
  ArbiterEvent,
  EventProcessingResult,
  EventHandler,
} from '@arbiter/core';

// Mock the trigger implementations
jest.mock('../triggers/webhook-trigger', () => ({
  WebhookTrigger: jest.fn().mockImplementation(() => ({
    register: jest.fn(),
    unregister: jest.fn(),
    start: jest.fn(),
    stop: jest.fn(),
  })),
}));

jest.mock('../triggers/cron-trigger', () => ({
  CronTrigger: jest.fn().mockImplementation(() => ({
    register: jest.fn(),
    unregister: jest.fn(),
    start: jest.fn(),
    stop: jest.fn(),
  })),
}));

jest.mock('../triggers/file-watch-trigger', () => ({
  FileWatchTrigger: jest.fn().mockImplementation(() => ({
    register: jest.fn(),
    unregister: jest.fn(),
    start: jest.fn(),
    stop: jest.fn(),
  })),
}));

jest.mock('../triggers/manual-trigger', () => ({
  ManualTrigger: jest.fn().mockImplementation(() => ({
    register: jest.fn(),
    unregister: jest.fn(),
    start: jest.fn(),
    stop: jest.fn(),
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

describe('EventSystem', () => {
  let eventSystem: EventSystem;
  let mockEventTriggerHandler: jest.Mock;

  beforeEach(() => {
    eventSystem = new EventSystem();
    mockEventTriggerHandler = jest.fn();
    eventSystem.setEventTriggerHandler(mockEventTriggerHandler);
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create a new event system instance', () => {
      expect(eventSystem).toBeInstanceOf(EventSystem);
    });

    it('should initialize trigger instances', () => {
      const triggerTypes = eventSystem.getTriggerTypes();
      expect(triggerTypes).toContain('webhook');
      expect(triggerTypes).toContain('cron');
      expect(triggerTypes).toContain('file-watch');
      expect(triggerTypes).toContain('manual');
    });
  });

  describe('setEventTriggerHandler', () => {
    it('should set the event trigger handler', () => {
      const handler = jest.fn();
      eventSystem.setEventTriggerHandler(handler);
      
      // The handler should be set internally
      expect(() => eventSystem.setEventTriggerHandler(handler)).not.toThrow();
    });
  });

  describe('registerWorkflow', () => {
    const createTestWorkflow = (): WorkflowConfig => ({
      id: 'test-workflow',
      name: 'Test Workflow',
      description: 'A test workflow for event system testing',
      version: '1.0.0',
      trigger: {
        type: 'webhook',
        config: {
          webhook: {
            endpoint: '/api/webhook/test',
            method: 'POST',
          },
        },
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
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    it('should register a workflow successfully', async () => {
      const workflow = createTestWorkflow();
      
      await eventSystem.registerWorkflow(workflow);
      
      const handlers = eventSystem.getEventHandlers();
      expect(handlers).toHaveLength(1);
      expect(handlers[0].workflowId).toBe(workflow.id);
      expect(handlers[0].eventType).toBe('webhook');
    });

    it('should register webhook trigger', async () => {
      const workflow = createTestWorkflow();
      
      await eventSystem.registerWorkflow(workflow);
      
      const webhookTrigger = eventSystem.getTriggerInstance('webhook');
      expect(webhookTrigger.register).toHaveBeenCalledWith(
        workflow.trigger,
        expect.any(Function)
      );
    });

    it('should register cron trigger', async () => {
      const workflow = createTestWorkflow();
      workflow.trigger = {
        type: 'cron',
        config: {
          cron: {
            schedule: '0 0 * * *',
            timezone: 'UTC',
          },
        },
      };
      
      await eventSystem.registerWorkflow(workflow);
      
      const cronTrigger = eventSystem.getTriggerInstance('cron');
      expect(cronTrigger.register).toHaveBeenCalledWith(
        workflow.trigger,
        expect.any(Function)
      );
    });

    it('should create event handler with correct properties', async () => {
      const workflow = createTestWorkflow();
      
      await eventSystem.registerWorkflow(workflow);
      
      const handlers = eventSystem.getEventHandlers();
      const handler = handlers[0];
      
      expect(handler.id).toMatch(/^handler_test-workflow$/);
      expect(handler.eventType).toBe('webhook');
      expect(handler.workflowId).toBe('test-workflow');
      expect(handler.enabled).toBe(true);
      expect(handler.triggerCount).toBe(0);
    });

    it('should store workflow configuration', async () => {
      const workflow = createTestWorkflow();
      
      await eventSystem.registerWorkflow(workflow);
      
      const storedWorkflow = eventSystem.getWorkflowConfig(workflow.id);
      expect(storedWorkflow).toEqual(workflow);
    });
  });

  describe('unregisterWorkflow', () => {
    const createTestWorkflow = (): WorkflowConfig => ({
      id: 'unregister-test-workflow',
      name: 'Unregister Test Workflow',
      description: 'A workflow for unregistration testing',
      version: '1.0.0',
      trigger: {
        type: 'manual',
        config: {},
      },
      rootAgent: {
        id: 'root-agent',
        name: 'Root Agent',
        description: 'Root agent',
        model: 'granite',
        systemPrompt: 'You are a test agent',
        availableTools: [],
        level: 0,
      },
      levels: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    it('should unregister a workflow successfully', async () => {
      const workflow = createTestWorkflow();
      
      await eventSystem.registerWorkflow(workflow);
      expect(eventSystem.getEventHandlers()).toHaveLength(1);
      
      await eventSystem.unregisterWorkflow(workflow.id);
      expect(eventSystem.getEventHandlers()).toHaveLength(0);
    });

    it('should remove workflow configuration', async () => {
      const workflow = createTestWorkflow();
      
      await eventSystem.registerWorkflow(workflow);
      expect(eventSystem.getWorkflowConfig(workflow.id)).toBeDefined();
      
      await eventSystem.unregisterWorkflow(workflow.id);
      expect(eventSystem.getWorkflowConfig(workflow.id)).toBeUndefined();
    });

    it('should unregister from trigger', async () => {
      const workflow = createTestWorkflow();
      
      await eventSystem.registerWorkflow(workflow);
      await eventSystem.unregisterWorkflow(workflow.id);
      
      const manualTrigger = eventSystem.getTriggerInstance('manual');
      expect(manualTrigger.unregister).toHaveBeenCalledWith(workflow.trigger);
    });

    it('should throw error for non-existent workflow', async () => {
      await expect(
        eventSystem.unregisterWorkflow('non-existent-workflow')
      ).rejects.toThrow('Workflow not found: non-existent-workflow');
    });
  });

  describe('triggerManualEvent', () => {
    const createTestWorkflow = (): WorkflowConfig => ({
      id: 'manual-trigger-workflow',
      name: 'Manual Trigger Workflow',
      description: 'A workflow for manual triggering',
      version: '1.0.0',
      trigger: {
        type: 'manual',
        config: {},
      },
      rootAgent: {
        id: 'root-agent',
        name: 'Root Agent',
        description: 'Root agent',
        model: 'granite',
        systemPrompt: 'You are a test agent',
        availableTools: [],
        level: 0,
      },
      levels: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    beforeEach(async () => {
      const workflow = createTestWorkflow();
      await eventSystem.registerWorkflow(workflow);
    });

    it('should trigger manual event successfully', async () => {
      mockEventTriggerHandler.mockResolvedValue({
        success: true,
        workflowExecutionId: 'exec-123',
      });

      const eventData = { test: 'data' };
      const result = await eventSystem.triggerManualEvent('manual-trigger-workflow', eventData);
      
      expect(result.success).toBe(true);
      expect(result.workflowExecutionId).toBe('exec-123');
    });

    it('should create proper event structure', async () => {
      mockEventTriggerHandler.mockResolvedValue({ success: true });

      const eventData = { input: 'test input' };
      await eventSystem.triggerManualEvent('manual-trigger-workflow', eventData);
      
      expect(mockEventTriggerHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'manual',
          source: 'arbiter-manual',
          data: eventData,
          metadata: expect.objectContaining({
            workflowId: 'manual-trigger-workflow',
            triggeredBy: 'manual',
          }),
        })
      );
    });

    it('should throw error for non-existent workflow', async () => {
      await expect(
        eventSystem.triggerManualEvent('non-existent', {})
      ).rejects.toThrow('Workflow not found: non-existent');
    });

    it('should update trigger count', async () => {
      mockEventTriggerHandler.mockResolvedValue({ success: true });

      await eventSystem.triggerManualEvent('manual-trigger-workflow', {});
      
      const handlers = eventSystem.getEventHandlers();
      const handler = handlers.find(h => h.workflowId === 'manual-trigger-workflow');
      
      expect(handler?.triggerCount).toBe(1);
      expect(handler?.lastTriggered).toBeInstanceOf(Date);
    });
  });

  describe('event handler management', () => {
    let handlerId: string;

    beforeEach(async () => {
      const workflow: WorkflowConfig = {
        id: 'handler-test-workflow',
        name: 'Handler Test Workflow',
        description: 'Workflow for handler testing',
        version: '1.0.0',
        trigger: {
          type: 'webhook',
          config: {
            webhook: {
              endpoint: '/test',
              method: 'POST',
            },
          },
        },
        rootAgent: {
          id: 'root-agent',
          name: 'Root Agent',
          description: 'Root agent',
          model: 'granite',
          systemPrompt: 'You are a test agent',
          availableTools: [],
          level: 0,
        },
        levels: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await eventSystem.registerWorkflow(workflow);
      const handlers = eventSystem.getEventHandlers();
      handlerId = handlers[0].id;
    });

    it('should enable event handler', async () => {
      await eventSystem.disableEventHandler(handlerId);
      
      let handler = eventSystem.getEventHandler(handlerId);
      expect(handler?.enabled).toBe(false);
      
      await eventSystem.enableEventHandler(handlerId);
      
      handler = eventSystem.getEventHandler(handlerId);
      expect(handler?.enabled).toBe(true);
    });

    it('should disable event handler', async () => {
      let handler = eventSystem.getEventHandler(handlerId);
      expect(handler?.enabled).toBe(true);
      
      await eventSystem.disableEventHandler(handlerId);
      
      handler = eventSystem.getEventHandler(handlerId);
      expect(handler?.enabled).toBe(false);
    });

    it('should throw error for non-existent handler when enabling', async () => {
      await expect(
        eventSystem.enableEventHandler('non-existent-handler')
      ).rejects.toThrow('Event handler not found: non-existent-handler');
    });

    it('should throw error for non-existent handler when disabling', async () => {
      await expect(
        eventSystem.disableEventHandler('non-existent-handler')
      ).rejects.toThrow('Event handler not found: non-existent-handler');
    });

    it('should get event handler by ID', () => {
      const handler = eventSystem.getEventHandler(handlerId);
      
      expect(handler).toBeDefined();
      expect(handler?.id).toBe(handlerId);
      expect(handler?.workflowId).toBe('handler-test-workflow');
    });

    it('should return undefined for non-existent handler', () => {
      const handler = eventSystem.getEventHandler('non-existent-handler');
      expect(handler).toBeUndefined();
    });
  });

  describe('workflow configuration management', () => {
    it('should get all workflow configurations', async () => {
      const workflow1: WorkflowConfig = {
        id: 'workflow-1',
        name: 'Workflow 1',
        description: 'First workflow',
        version: '1.0.0',
        trigger: { type: 'manual', config: {} },
        rootAgent: {
          id: 'agent-1',
          name: 'Agent 1',
          description: 'Agent 1',
          model: 'granite',
          systemPrompt: 'Agent 1',
          availableTools: [],
          level: 0,
        },
        levels: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const workflow2: WorkflowConfig = {
        id: 'workflow-2',
        name: 'Workflow 2',
        description: 'Second workflow',
        version: '1.0.0',
        trigger: { type: 'cron', config: { cron: { schedule: '0 0 * * *' } } },
        rootAgent: {
          id: 'agent-2',
          name: 'Agent 2',
          description: 'Agent 2',
          model: 'granite',
          systemPrompt: 'Agent 2',
          availableTools: [],
          level: 0,
        },
        levels: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await eventSystem.registerWorkflow(workflow1);
      await eventSystem.registerWorkflow(workflow2);
      
      const configs = eventSystem.getWorkflowConfigs();
      expect(configs).toHaveLength(2);
      expect(configs.find(c => c.id === 'workflow-1')).toBeDefined();
      expect(configs.find(c => c.id === 'workflow-2')).toBeDefined();
    });

    it('should get specific workflow configuration', async () => {
      const workflow: WorkflowConfig = {
        id: 'specific-workflow',
        name: 'Specific Workflow',
        description: 'A specific workflow',
        version: '1.0.0',
        trigger: { type: 'manual', config: {} },
        rootAgent: {
          id: 'specific-agent',
          name: 'Specific Agent',
          description: 'Specific agent',
          model: 'granite',
          systemPrompt: 'Specific agent',
          availableTools: [],
          level: 0,
        },
        levels: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await eventSystem.registerWorkflow(workflow);
      
      const config = eventSystem.getWorkflowConfig('specific-workflow');
      expect(config).toEqual(workflow);
    });

    it('should return undefined for non-existent workflow config', () => {
      const config = eventSystem.getWorkflowConfig('non-existent');
      expect(config).toBeUndefined();
    });
  });

  describe('system lifecycle', () => {
    it('should start event system', async () => {
      await eventSystem.startEventSystem();
      
      // Verify all triggers were started
      const webhookTrigger = eventSystem.getTriggerInstance('webhook');
      const cronTrigger = eventSystem.getTriggerInstance('cron');
      const fileWatchTrigger = eventSystem.getTriggerInstance('file-watch');
      const manualTrigger = eventSystem.getTriggerInstance('manual');
      
      expect(webhookTrigger.start).toHaveBeenCalled();
      expect(cronTrigger.start).toHaveBeenCalled();
      expect(fileWatchTrigger.start).toHaveBeenCalled();
      expect(manualTrigger.start).toHaveBeenCalled();
    });

    it('should stop event system', async () => {
      await eventSystem.stopEventSystem();
      
      // Verify all triggers were stopped
      const webhookTrigger = eventSystem.getTriggerInstance('webhook');
      const cronTrigger = eventSystem.getTriggerInstance('cron');
      const fileWatchTrigger = eventSystem.getTriggerInstance('file-watch');
      const manualTrigger = eventSystem.getTriggerInstance('manual');
      
      expect(webhookTrigger.stop).toHaveBeenCalled();
      expect(cronTrigger.stop).toHaveBeenCalled();
      expect(fileWatchTrigger.stop).toHaveBeenCalled();
      expect(manualTrigger.stop).toHaveBeenCalled();
    });

    it('should handle trigger start errors gracefully', async () => {
      const webhookTrigger = eventSystem.getTriggerInstance('webhook');
      webhookTrigger.start.mockRejectedValue(new Error('Start failed'));
      
      // Should not throw
      await expect(eventSystem.startEventSystem()).resolves.not.toThrow();
    });

    it('should handle trigger stop errors gracefully', async () => {
      const cronTrigger = eventSystem.getTriggerInstance('cron');
      cronTrigger.stop.mockRejectedValue(new Error('Stop failed'));
      
      // Should not throw
      await expect(eventSystem.stopEventSystem()).resolves.not.toThrow();
    });
  });

  describe('event statistics', () => {
    it('should return event statistics', async () => {
      const workflow1: WorkflowConfig = {
        id: 'stats-workflow-1',
        name: 'Stats Workflow 1',
        description: 'First stats workflow',
        version: '1.0.0',
        trigger: { type: 'manual', config: {} },
        rootAgent: {
          id: 'stats-agent-1',
          name: 'Stats Agent 1',
          description: 'Stats agent 1',
          model: 'granite',
          systemPrompt: 'Stats agent 1',
          availableTools: [],
          level: 0,
        },
        levels: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const workflow2: WorkflowConfig = {
        id: 'stats-workflow-2',
        name: 'Stats Workflow 2',
        description: 'Second stats workflow',
        version: '1.0.0',
        trigger: { type: 'webhook', config: { webhook: { endpoint: '/test', method: 'POST' } } },
        rootAgent: {
          id: 'stats-agent-2',
          name: 'Stats Agent 2',
          description: 'Stats agent 2',
          model: 'granite',
          systemPrompt: 'Stats agent 2',
          availableTools: [],
          level: 0,
        },
        levels: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await eventSystem.registerWorkflow(workflow1);
      await eventSystem.registerWorkflow(workflow2);
      
      // Disable one handler
      const handlers = eventSystem.getEventHandlers();
      await eventSystem.disableEventHandler(handlers[0].id);
      
      // Trigger some events
      mockEventTriggerHandler.mockResolvedValue({ success: true });
      await eventSystem.triggerManualEvent('stats-workflow-2', {}); // Use enabled workflow
      await eventSystem.triggerManualEvent('stats-workflow-2', {}); // Use enabled workflow
      
      const stats = eventSystem.getEventStats();
      
      expect(stats.totalHandlers).toBe(2);
      expect(stats.enabledHandlers).toBe(1);
      expect(stats.totalTriggers).toBe(2);
    });
  });

  describe('generateEventId', () => {
    it('should generate unique event IDs', () => {
      const eventSystemAny = eventSystem as any;
      
      const id1 = eventSystemAny.generateEventId();
      const id2 = eventSystemAny.generateEventId();
      
      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^event_\d+_[a-z0-9]+$/);
      expect(id2).toMatch(/^event_\d+_[a-z0-9]+$/);
    });
  });

  describe('error handling', () => {
    it('should handle disabled event handlers', async () => {
      const workflow: WorkflowConfig = {
        id: 'disabled-workflow',
        name: 'Disabled Workflow',
        description: 'A workflow that will be disabled',
        version: '1.0.0',
        trigger: { type: 'manual', config: {} },
        rootAgent: {
          id: 'disabled-agent',
          name: 'Disabled Agent',
          description: 'Disabled agent',
          model: 'granite',
          systemPrompt: 'Disabled agent',
          availableTools: [],
          level: 0,
        },
        levels: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await eventSystem.registerWorkflow(workflow);
      
      const handlers = eventSystem.getEventHandlers();
      await eventSystem.disableEventHandler(handlers[0].id);
      
      const result = await eventSystem.triggerManualEvent('disabled-workflow', {});
      
      expect(result.success).toBe(true);
      expect(result.skipped).toBe(true);
      expect(result.reason).toBe('Handler disabled');
    });

    it('should handle event trigger handler errors', async () => {
      const workflow: WorkflowConfig = {
        id: 'error-workflow',
        name: 'Error Workflow',
        description: 'A workflow that will cause errors',
        version: '1.0.0',
        trigger: { type: 'manual', config: {} },
        rootAgent: {
          id: 'error-agent',
          name: 'Error Agent',
          description: 'Error agent',
          model: 'granite',
          systemPrompt: 'Error agent',
          availableTools: [],
          level: 0,
        },
        levels: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await eventSystem.registerWorkflow(workflow);
      
      mockEventTriggerHandler.mockRejectedValue(new Error('Handler error'));
      
      const result = await eventSystem.triggerManualEvent('error-workflow', {});
      
      expect(result.success).toBe(false);
      expect(result.error).toBe('Handler error');
    });

    it('should handle missing event trigger handler', async () => {
      const workflow: WorkflowConfig = {
        id: 'no-handler-workflow',
        name: 'No Handler Workflow',
        description: 'A workflow with no event trigger handler',
        version: '1.0.0',
        trigger: { type: 'manual', config: {} },
        rootAgent: {
          id: 'no-handler-agent',
          name: 'No Handler Agent',
          description: 'No handler agent',
          model: 'granite',
          systemPrompt: 'No handler agent',
          availableTools: [],
          level: 0,
        },
        levels: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Create new event system without handler
      const eventSystemNoHandler = new EventSystem();
      await eventSystemNoHandler.registerWorkflow(workflow);
      
      const result = await eventSystemNoHandler.triggerManualEvent('no-handler-workflow', {});
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('No event trigger handler configured');
    });

    it('should handle non-string error objects', async () => {
      const workflow: WorkflowConfig = {
        id: 'string-error-workflow',
        name: 'String Error Workflow',
        description: 'A workflow that throws string errors',
        version: '1.0.0',
        trigger: { type: 'manual', config: {} },
        rootAgent: {
          id: 'string-error-agent',
          name: 'String Error Agent',
          description: 'String error agent',
          model: 'granite',
          systemPrompt: 'String error agent',
          availableTools: [],
          level: 0,
        },
        levels: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await eventSystem.registerWorkflow(workflow);
      
      mockEventTriggerHandler.mockRejectedValue('String error message');
      
      const result = await eventSystem.triggerManualEvent('string-error-workflow', {});
      
      expect(result.success).toBe(false);
      expect(result.error).toBe('Unknown error');
    });

    it('should handle missing trigger instance for workflow registration', async () => {
      const workflow: WorkflowConfig = {
        id: 'unknown-trigger-workflow',
        name: 'Unknown Trigger Workflow',
        description: 'A workflow with unknown trigger type',
        version: '1.0.0',
        trigger: { type: 'unknown-trigger' as any, config: {} },
        rootAgent: {
          id: 'unknown-trigger-agent',
          name: 'Unknown Trigger Agent',
          description: 'Unknown trigger agent',
          model: 'granite',
          systemPrompt: 'Unknown trigger agent',
          availableTools: [],
          level: 0,
        },
        levels: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Should not throw, but should handle gracefully
      await expect(eventSystem.registerWorkflow(workflow)).resolves.not.toThrow();
      
      // Workflow should still be registered
      const storedWorkflow = eventSystem.getWorkflowConfig(workflow.id);
      expect(storedWorkflow).toEqual(workflow);
    });

    it('should handle trigger registration errors gracefully', async () => {
      const workflow: WorkflowConfig = {
        id: 'trigger-error-workflow',
        name: 'Trigger Error Workflow',
        description: 'A workflow where trigger registration fails',
        version: '1.0.0',
        trigger: { type: 'webhook', config: { webhook: { endpoint: '/error', method: 'POST' } } },
        rootAgent: {
          id: 'trigger-error-agent',
          name: 'Trigger Error Agent',
          description: 'Trigger error agent',
          model: 'granite',
          systemPrompt: 'Trigger error agent',
          availableTools: [],
          level: 0,
        },
        levels: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Mock trigger to throw error
      const webhookTrigger = eventSystem.getTriggerInstance('webhook');
      webhookTrigger.register.mockRejectedValue(new Error('Trigger registration failed'));

      await expect(eventSystem.registerWorkflow(workflow)).rejects.toThrow('Trigger registration failed');
    });

    it('should handle trigger unregistration errors gracefully', async () => {
      const workflow: WorkflowConfig = {
        id: 'unregister-error-workflow',
        name: 'Unregister Error Workflow',
        description: 'A workflow where trigger unregistration fails',
        version: '1.0.0',
        trigger: { type: 'cron', config: { cron: { schedule: '0 0 * * *' } } },
        rootAgent: {
          id: 'unregister-error-agent',
          name: 'Unregister Error Agent',
          description: 'Unregister error agent',
          model: 'granite',
          systemPrompt: 'Unregister error agent',
          availableTools: [],
          level: 0,
        },
        levels: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await eventSystem.registerWorkflow(workflow);

      // Mock trigger to throw error on unregister
      const cronTrigger = eventSystem.getTriggerInstance('cron');
      cronTrigger.unregister.mockRejectedValue(new Error('Trigger unregistration failed'));

      await expect(eventSystem.unregisterWorkflow(workflow.id)).rejects.toThrow('Trigger unregistration failed');
    });
  });

  describe('event handling edge cases', () => {
    it('should handle workflow registration with null trigger config', async () => {
      const workflow: WorkflowConfig = {
        id: 'null-config-workflow',
        name: 'Null Config Workflow',
        description: 'A workflow with null trigger config',
        version: '1.0.0',
        trigger: { type: 'manual', config: null as any },
        rootAgent: {
          id: 'null-config-agent',
          name: 'Null Config Agent',
          description: 'Null config agent',
          model: 'granite',
          systemPrompt: 'Null config agent',
          availableTools: [],
          level: 0,
        },
        levels: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await expect(eventSystem.registerWorkflow(workflow)).resolves.not.toThrow();
      
      const handler = eventSystem.getEventHandlers().find(h => h.workflowId === workflow.id);
      expect(handler).toBeDefined();
      expect(handler?.condition).toBeUndefined();
    });

    it('should handle manual event triggering without registered handler', async () => {
      const workflow: WorkflowConfig = {
        id: 'no-handler-registered-workflow',
        name: 'No Handler Registered Workflow',
        description: 'A workflow without registered handler',
        version: '1.0.0',
        trigger: { type: 'manual', config: {} },
        rootAgent: {
          id: 'no-handler-registered-agent',
          name: 'No Handler Registered Agent',
          description: 'No handler registered agent',
          model: 'granite',
          systemPrompt: 'No handler registered agent',
          availableTools: [],
          level: 0,
        },
        levels: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Register workflow but then manually remove the handler
      await eventSystem.registerWorkflow(workflow);
      const handlers = eventSystem.getEventHandlers();
      const handlerId = handlers.find(h => h.workflowId === workflow.id)?.id;
      
      if (handlerId) {
        // Manually remove the handler from the internal map
        (eventSystem as any).eventHandlers.delete(handlerId);
      }

      await expect(
        eventSystem.triggerManualEvent('no-handler-registered-workflow', {})
      ).rejects.toThrow('Event handler not found for workflow: no-handler-registered-workflow');
    });

    it('should handle complex event data with nested objects', async () => {
      const workflow: WorkflowConfig = {
        id: 'complex-data-workflow',
        name: 'Complex Data Workflow',
        description: 'A workflow with complex event data',
        version: '1.0.0',
        trigger: { type: 'manual', config: {} },
        rootAgent: {
          id: 'complex-data-agent',
          name: 'Complex Data Agent',
          description: 'Complex data agent',
          model: 'granite',
          systemPrompt: 'Complex data agent',
          availableTools: [],
          level: 0,
        },
        levels: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await eventSystem.registerWorkflow(workflow);
      mockEventTriggerHandler.mockResolvedValue({ success: true });

      const complexData = {
        user: { id: 123, name: 'John Doe', preferences: { theme: 'dark', language: 'en' } },
        items: [{ id: 1, name: 'Item 1' }, { id: 2, name: 'Item 2' }],
        metadata: { timestamp: new Date(), version: '1.0.0' },
        nullValue: null,
        undefinedValue: undefined,
      };

      const result = await eventSystem.triggerManualEvent('complex-data-workflow', complexData);
      
      expect(result.success).toBe(true);
      expect(mockEventTriggerHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          data: complexData,
        })
      );
    });

    it('should handle rapid sequential event triggering', async () => {
      const workflow: WorkflowConfig = {
        id: 'rapid-events-workflow',
        name: 'Rapid Events Workflow',
        description: 'A workflow for rapid event testing',
        version: '1.0.0',
        trigger: { type: 'manual', config: {} },
        rootAgent: {
          id: 'rapid-events-agent',
          name: 'Rapid Events Agent',
          description: 'Rapid events agent',
          model: 'granite',
          systemPrompt: 'Rapid events agent',
          availableTools: [],
          level: 0,
        },
        levels: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await eventSystem.registerWorkflow(workflow);
      mockEventTriggerHandler.mockResolvedValue({ success: true });

      // Trigger multiple events rapidly
      const promises = [];
      for (let i = 0; i < 10; i++) {
        promises.push(eventSystem.triggerManualEvent('rapid-events-workflow', { eventNumber: i }));
      }

      const results = await Promise.all(promises);
      
      expect(results).toHaveLength(10);
      expect(results.every(r => r.success)).toBe(true);
      
      // Check trigger count
      const handler = eventSystem.getEventHandlers().find(h => h.workflowId === workflow.id);
      expect(handler?.triggerCount).toBe(10);
    });

    it('should generate unique event IDs under rapid generation', () => {
      const eventSystemAny = eventSystem as any;
      const ids = new Set();
      
      for (let i = 0; i < 1000; i++) {
        const id = eventSystemAny.generateEventId();
        expect(ids.has(id)).toBe(false); // No duplicates
        ids.add(id);
      }
      
      expect(ids.size).toBe(1000);
    });

    it('should handle triggers without start/stop methods', async () => {
      // Mock triggers without start/stop methods
      const eventSystemNoMethods = new EventSystem();
      const triggerInstance = eventSystemNoMethods.getTriggerInstance('manual');
      
      // Remove start/stop methods
      delete triggerInstance.start;
      delete triggerInstance.stop;

      // Should not throw when starting/stopping
      await expect(eventSystemNoMethods.startEventSystem()).resolves.not.toThrow();
      await expect(eventSystemNoMethods.stopEventSystem()).resolves.not.toThrow();
    });
  });
});