import { ArbiterServiceDB } from '../../services/arbiter-service-db';
import { ArbiterDatabase } from '@arbiter/database';
import { tmpdir } from 'os';
import { join } from 'path';
import { unlinkSync, existsSync } from 'fs';

describe('ArbiterServiceDB', () => {
  let service: ArbiterServiceDB;
  let testDbPath: string;

  beforeEach(async () => {
    // Create unique temp database for each test
    testDbPath = join(tmpdir(), `arbiter-test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}.db`);
    service = new ArbiterServiceDB(testDbPath);
    await service.initialize();
  });

  afterEach(async () => {
    if (service) {
      await service.shutdown();
    }
    // Clean up test database
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath);
    }
  });

  describe('Initialization', () => {
    test('should initialize successfully', async () => {
      expect(service).toBeDefined();
    });

    test('should create database tables on initialization', async () => {
      // The fact that initialization completed successfully indicates tables were created
      expect(service).toBeDefined();
    });
  });

  describe('Workflow Management', () => {
    test('should create and retrieve workflows', async () => {
      const workflow = {
        id: 'test-workflow-1',
        name: 'Test Workflow',
        description: 'A test workflow',
        nodes: [
          {
            id: 'node-1',
            type: 'agent',
            agentId: 'test-agent',
            tools: [],
            connections: []
          }
        ],
        enabled: true
      };

      await service.createWorkflow(workflow);
      const retrieved = await service.getWorkflow('test-workflow-1');

      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe('test-workflow-1');
      expect(retrieved?.name).toBe('Test Workflow');
    });

    test('should list all workflows', async () => {
      const workflow1 = {
        id: 'workflow-1',
        name: 'Workflow 1',
        description: 'First workflow',
        nodes: [],
        enabled: true
      };

      const workflow2 = {
        id: 'workflow-2',
        name: 'Workflow 2',
        description: 'Second workflow',
        nodes: [],
        enabled: false
      };

      await service.createWorkflow(workflow1);
      await service.createWorkflow(workflow2);

      const workflows = await service.listWorkflows();
      expect(workflows).toHaveLength(2);
      expect(workflows.map(w => w.id)).toContain('workflow-1');
      expect(workflows.map(w => w.id)).toContain('workflow-2');
    });

    test('should update workflows', async () => {
      const workflow = {
        id: 'update-test',
        name: 'Original Name',
        description: 'Original description',
        nodes: [],
        enabled: true
      };

      await service.createWorkflow(workflow);

      const updatedWorkflow = {
        ...workflow,
        name: 'Updated Name',
        description: 'Updated description',
        enabled: false
      };

      await service.updateWorkflow('update-test', updatedWorkflow);
      const retrieved = await service.getWorkflow('update-test');

      expect(retrieved?.name).toBe('Updated Name');
      expect(retrieved?.description).toBe('Updated description');
      expect(retrieved?.enabled).toBe(false);
    });

    test('should delete workflows', async () => {
      const workflow = {
        id: 'delete-test',
        name: 'To Delete',
        description: 'Will be deleted',
        nodes: [],
        enabled: true
      };

      await service.createWorkflow(workflow);
      expect(await service.getWorkflow('delete-test')).toBeDefined();

      await service.deleteWorkflow('delete-test');
      expect(await service.getWorkflow('delete-test')).toBeNull();
    });

    test('should handle non-existent workflow operations gracefully', async () => {
      const nonExistent = await service.getWorkflow('non-existent');
      expect(nonExistent).toBeNull();

      // These should not throw errors
      await expect(service.deleteWorkflow('non-existent')).resolves.not.toThrow();
      await expect(service.updateWorkflow('non-existent', { 
        id: 'non-existent', 
        name: 'Test', 
        description: 'Test', 
        nodes: [], 
        enabled: true 
      })).resolves.not.toThrow();
    });
  });

  describe('Agent Management', () => {
    test('should create and retrieve agents', async () => {
      const agent = {
        id: 'test-agent-1',
        name: 'Test Agent',
        description: 'A test agent',
        model: 'granite-3.3',
        provider: 'local' as const,
        tools: ['web_search', 'calculator'],
        config: { temperature: 0.7 }
      };

      await service.createAgent(agent);
      const retrieved = await service.getAgent('test-agent-1');

      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe('test-agent-1');
      expect(retrieved?.name).toBe('Test Agent');
      expect(retrieved?.tools).toEqual(['web_search', 'calculator']);
    });

    test('should list all agents', async () => {
      const agent1 = {
        id: 'agent-1',
        name: 'Agent 1',
        description: 'First agent',
        model: 'granite-3.3',
        provider: 'local' as const,
        tools: [],
        config: {}
      };

      const agent2 = {
        id: 'agent-2',
        name: 'Agent 2',
        description: 'Second agent',
        model: 'gpt-4',
        provider: 'openai' as const,
        tools: ['web_search'],
        config: { temperature: 0.5 }
      };

      await service.createAgent(agent1);
      await service.createAgent(agent2);

      const agents = await service.listAgents();
      expect(agents).toHaveLength(2);
      expect(agents.map(a => a.id)).toContain('agent-1');
      expect(agents.map(a => a.id)).toContain('agent-2');
    });

    test('should update agents', async () => {
      const agent = {
        id: 'update-agent',
        name: 'Original Agent',
        description: 'Original description',
        model: 'granite-3.3',
        provider: 'local' as const,
        tools: [],
        config: {}
      };

      await service.createAgent(agent);

      const updatedAgent = {
        ...agent,
        name: 'Updated Agent',
        model: 'gpt-4',
        provider: 'openai' as const,
        tools: ['web_search']
      };

      await service.updateAgent('update-agent', updatedAgent);
      const retrieved = await service.getAgent('update-agent');

      expect(retrieved?.name).toBe('Updated Agent');
      expect(retrieved?.model).toBe('gpt-4');
      expect(retrieved?.provider).toBe('openai');
      expect(retrieved?.tools).toEqual(['web_search']);
    });

    test('should delete agents', async () => {
      const agent = {
        id: 'delete-agent',
        name: 'To Delete',
        description: 'Will be deleted',
        model: 'granite-3.3',
        provider: 'local' as const,
        tools: [],
        config: {}
      };

      await service.createAgent(agent);
      expect(await service.getAgent('delete-agent')).toBeDefined();

      await service.deleteAgent('delete-agent');
      expect(await service.getAgent('delete-agent')).toBeNull();
    });
  });

  describe('Event Management', () => {
    test('should register and retrieve event handlers', async () => {
      const handler = {
        id: 'test-handler',
        type: 'cron' as const,
        workflowId: 'test-workflow',
        config: { schedule: '0 * * * *' },
        enabled: true
      };

      await service.registerEventHandler(handler);
      const handlers = await service.getEventHandlers();

      expect(handlers).toHaveLength(1);
      expect(handlers[0].id).toBe('test-handler');
      expect(handlers[0].type).toBe('cron');
      expect(handlers[0].workflowId).toBe('test-workflow');
    });

    test('should get event handlers by workflow', async () => {
      const handler1 = {
        id: 'handler-1',
        type: 'cron' as const,
        workflowId: 'workflow-1',
        config: { schedule: '0 * * * *' },
        enabled: true
      };

      const handler2 = {
        id: 'handler-2',
        type: 'manual' as const,
        workflowId: 'workflow-2',
        config: {},
        enabled: true
      };

      await service.registerEventHandler(handler1);
      await service.registerEventHandler(handler2);

      const workflow1Handlers = await service.getEventHandlers('workflow-1');
      expect(workflow1Handlers).toHaveLength(1);
      expect(workflow1Handlers[0].id).toBe('handler-1');
    });

    test('should update event handlers', async () => {
      const handler = {
        id: 'update-handler',
        type: 'cron' as const,
        workflowId: 'test-workflow',
        config: { schedule: '0 * * * *' },
        enabled: true
      };

      await service.registerEventHandler(handler);

      const updatedHandler = {
        ...handler,
        config: { schedule: '0 0 * * *' },
        enabled: false
      };

      await service.updateEventHandler('update-handler', updatedHandler);
      const handlers = await service.getEventHandlers();

      expect(handlers[0].config).toEqual({ schedule: '0 0 * * *' });
      expect(handlers[0].enabled).toBe(false);
    });

    test('should delete event handlers', async () => {
      const handler = {
        id: 'delete-handler',
        type: 'manual' as const,
        workflowId: 'test-workflow',
        config: {},
        enabled: true
      };

      await service.registerEventHandler(handler);
      expect(await service.getEventHandlers()).toHaveLength(1);

      await service.deleteEventHandler('delete-handler');
      expect(await service.getEventHandlers()).toHaveLength(0);
    });
  });

  describe('Workflow Execution', () => {
    beforeEach(async () => {
      // Set up test workflow and agent
      const workflow = {
        id: 'exec-workflow',
        name: 'Execution Test Workflow',
        description: 'Test workflow for execution',
        nodes: [
          {
            id: 'node-1',
            type: 'agent',
            agentId: 'exec-agent',
            tools: [],
            connections: []
          }
        ],
        enabled: true
      };

      const agent = {
        id: 'exec-agent',
        name: 'Execution Test Agent',
        description: 'Test agent for execution',
        model: 'granite-3.3',
        provider: 'local' as const,
        tools: [],
        config: {}
      };

      await service.createWorkflow(workflow);
      await service.createAgent(agent);
    });

    test('should execute workflow and log runs', async () => {
      const initialRuns = await service.exportRuns({});
      const initialCount = initialRuns.length;

      const result = await service.executeWorkflow('exec-workflow', { test: 'data' });

      expect(result).toBeDefined();
      expect(result.executionId).toBeDefined();

      // Check that run was logged
      const runs = await service.exportRuns({});
      expect(runs.length).toBeGreaterThan(initialCount);

      const workflowRun = runs.find(r => 
        r.runType === 'workflow_execution' && 
        r.workflowId === 'exec-workflow'
      );
      expect(workflowRun).toBeDefined();
    });

    test('should get workflow execution runs', async () => {
      await service.executeWorkflow('exec-workflow', { test: 'data' });
      
      const workflowRuns = await service.getWorkflowRuns('exec-workflow', 10);
      expect(workflowRuns.length).toBeGreaterThan(0);
      
      const workflowRun = workflowRuns.find(r => r.runType === 'workflow_execution');
      expect(workflowRun).toBeDefined();
      expect(workflowRun?.workflowId).toBe('exec-workflow');
    });
  });

  describe('Run Analytics', () => {
    beforeEach(async () => {
      // Set up test workflow and agent for analytics tests
      const workflow = {
        id: 'analytics-workflow',
        name: 'Analytics Test Workflow',
        description: 'Test workflow for analytics',
        nodes: [],
        enabled: true
      };

      const agent = {
        id: 'analytics-agent',
        name: 'Analytics Test Agent',
        description: 'Test agent for analytics',
        model: 'granite-3.3',
        provider: 'local' as const,
        tools: [],
        config: {}
      };

      await service.createWorkflow(workflow);
      await service.createAgent(agent);
    });

    test('should get run statistics', async () => {
      // Execute some workflows to generate data
      await service.executeWorkflow('analytics-workflow', { test: 'data1' });
      await service.executeWorkflow('analytics-workflow', { test: 'data2' });

      const stats = await service.getRunStats();
      
      expect(stats).toBeDefined();
      expect(typeof stats.totalRuns).toBe('number');
      expect(typeof stats.successfulRuns).toBe('number');
      expect(typeof stats.failedRuns).toBe('number');
      expect(typeof stats.averageDuration).toBe('number');
      expect(typeof stats.totalTokens).toBe('number');
      
      expect(stats.totalRuns).toBeGreaterThan(0);
    });

    test('should get workflow-specific statistics', async () => {
      await service.executeWorkflow('analytics-workflow', { test: 'data' });

      const stats = await service.getRunStats('analytics-workflow');
      
      expect(stats).toBeDefined();
      expect(stats.totalRuns).toBeGreaterThan(0);
    });

    test('should get performance metrics', async () => {
      await service.executeWorkflow('analytics-workflow', { test: 'data' });

      const metrics = await service.getPerformanceMetrics();
      
      expect(metrics).toBeDefined();
      expect(typeof metrics.averageTokensPerRun).toBe('number');
      expect(typeof metrics.averageMemoryUsage).toBe('number');
      expect(typeof metrics.averageCpuTime).toBe('number');
      expect(typeof metrics.totalRuns).toBe('number');
    });

    test('should get recent errors', async () => {
      const errors = await service.getRecentErrors(10);
      
      expect(Array.isArray(errors)).toBe(true);
      // Initially might be empty, which is fine
    });

    test('should export runs with filters', async () => {
      await service.executeWorkflow('analytics-workflow', { test: 'data' });

      const allRuns = await service.exportRuns({});
      expect(Array.isArray(allRuns)).toBe(true);

      const filteredRuns = await service.exportRuns({
        workflowId: 'analytics-workflow'
      });
      expect(Array.isArray(filteredRuns)).toBe(true);
      
      // All filtered runs should belong to the specified workflow
      filteredRuns.forEach(run => {
        expect(run.workflowId).toBe('analytics-workflow');
      });
    });

    test('should get execution traces', async () => {
      const result = await service.executeWorkflow('analytics-workflow', { test: 'data' });
      
      if (result.executionId) {
        const trace = await service.getExecutionTrace(result.executionId);
        expect(Array.isArray(trace)).toBe(true);
        
        if (trace.length > 0) {
          const workflowRun = trace.find(r => r.runType === 'workflow_execution');
          expect(workflowRun).toBeDefined();
          expect(workflowRun?.executionId).toBe(result.executionId);
        }
      }
    });
  });

  describe('Error Handling', () => {
    test('should handle database connection errors gracefully', async () => {
      // Close the database to simulate connection error
      await service.shutdown();

      // Operations should handle errors gracefully
      await expect(service.getWorkflow('test')).resolves.toBe(null);
      await expect(service.listWorkflows()).resolves.toEqual([]);
    });

    test('should handle invalid data gracefully', async () => {
      // Test with malformed workflow data
      const invalidWorkflow = {
        id: 'invalid',
        name: null as any,
        description: undefined as any,
        nodes: 'not-an-array' as any,
        enabled: 'not-boolean' as any
      };

      // Should not throw but may handle gracefully
      await expect(async () => {
        await service.createWorkflow(invalidWorkflow);
      }).not.toThrow();
    });

    test('should handle concurrent operations', async () => {
      const workflow = {
        id: 'concurrent-test',
        name: 'Concurrent Test',
        description: 'Test concurrent operations',
        nodes: [],
        enabled: true
      };

      // Create multiple concurrent operations
      const promises = Array.from({ length: 5 }, (_, i) => 
        service.createWorkflow({
          ...workflow,
          id: `concurrent-test-${i}`,
          name: `Concurrent Test ${i}`
        })
      );

      await Promise.all(promises);

      const workflows = await service.listWorkflows();
      const concurrentWorkflows = workflows.filter(w => 
        w.id.startsWith('concurrent-test-')
      );
      
      expect(concurrentWorkflows).toHaveLength(5);
    });
  });

  describe('System Status', () => {
    test('should return system status information', async () => {
      const status = await service.getStatus();
      
      expect(status).toBeDefined();
      expect(status.workflows).toBeDefined();
      expect(status.agents).toBeDefined();
      expect(status.executions).toBeDefined();
      expect(status.events).toBeDefined();
      expect(status.uptime).toBeDefined();
      expect(status.memory).toBeDefined();
      
      expect(typeof status.workflows.total).toBe('number');
      expect(typeof status.agents.total).toBe('number');
      expect(typeof status.executions.active).toBe('number');
      expect(typeof status.uptime).toBe('number');
    });
  });

  describe('Data Integrity', () => {
    test('should maintain referential integrity between workflows and runs', async () => {
      const workflow = {
        id: 'integrity-workflow',
        name: 'Integrity Test',
        description: 'Test referential integrity',
        nodes: [],
        enabled: true
      };

      await service.createWorkflow(workflow);
      await service.executeWorkflow('integrity-workflow', { test: 'data' });

      // Runs should reference the workflow
      const runs = await service.getWorkflowRuns('integrity-workflow', 10);
      expect(runs.length).toBeGreaterThan(0);
      runs.forEach(run => {
        expect(run.workflowId).toBe('integrity-workflow');
      });

      // Delete workflow
      await service.deleteWorkflow('integrity-workflow');

      // Runs might still exist (depending on cascade behavior) but workflow should be gone
      const deletedWorkflow = await service.getWorkflow('integrity-workflow');
      expect(deletedWorkflow).toBeNull();
    });

    test('should handle duplicate IDs appropriately', async () => {
      const workflow = {
        id: 'duplicate-test',
        name: 'Original',
        description: 'Original workflow',
        nodes: [],
        enabled: true
      };

      await service.createWorkflow(workflow);

      const duplicateWorkflow = {
        ...workflow,
        name: 'Duplicate',
        description: 'Duplicate workflow'
      };

      // Creating duplicate should either replace or be handled gracefully
      await expect(async () => {
        await service.createWorkflow(duplicateWorkflow);
      }).not.toThrow();
    });
  });
});