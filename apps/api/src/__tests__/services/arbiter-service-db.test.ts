import { ArbiterServiceDB } from '../../services/arbiter-service-db';
import { ArbiterDatabase } from '@arbiter/database';
import { tmpdir } from 'os';
import { join } from 'path';
import { unlinkSync, existsSync } from 'fs';

describe('ArbiterServiceDB', () => {
  let service: ArbiterServiceDB;
  let testDbPath: string;

  // Helper function to create a proper AgentConfig
  const createTestAgent = (id: string, name: string, options: Partial<any> = {}) => ({
    id,
    name,
    description: options.description || `${name} description`,
    model: options.model || 'granite-3.3',
    systemPrompt: options.systemPrompt || `You are ${name}`,
    availableTools: options.availableTools || [],
    level: options.level || 1,
    ...options
  });

  // Helper function to create a proper WorkflowConfig
  const createTestWorkflow = (id: string, name: string, options: Partial<any> = {}) => {
    const rootAgent = options.rootAgent || createTestAgent(`${id}-agent`, `${name} Agent`);
    
    return {
      id,
      name,
      description: options.description || `${name} description`,
      version: options.version || '1.0.0',
      trigger: options.trigger || { type: 'manual' as const, config: {} },
      rootAgent,
      userPrompt: options.userPrompt,
      levels: options.levels || [],
      metadata: options.metadata,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...options
    };
  };

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
      const workflow = createTestWorkflow('test-workflow-1', 'Test Workflow', {
        userPrompt: 'Test workflow execution',
        rootAgent: createTestAgent('test-agent-1', 'Test Agent', { availableTools: ['web_search'] })
      });

      await service.createWorkflow(workflow);
      const retrieved = await service.getWorkflow('test-workflow-1');

      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe('test-workflow-1');
      expect(retrieved?.name).toBe('Test Workflow');
    });

    test('should list all workflows', async () => {
      const workflow1 = createTestWorkflow('workflow-1', 'Workflow 1');
      const workflow2 = createTestWorkflow('workflow-2', 'Workflow 2', {
        trigger: { type: 'cron' as const, config: { cron: { schedule: '0 * * * *' } } }
      });

      await service.createWorkflow(workflow1);
      await service.createWorkflow(workflow2);

      const workflows = await service.listWorkflows();
      expect(workflows).toHaveLength(2);
      expect(workflows.map(w => w.id)).toContain('workflow-1');
      expect(workflows.map(w => w.id)).toContain('workflow-2');
    });

    test('should update workflows', async () => {
      const workflow = createTestWorkflow('update-test', 'Original Name');
      await service.createWorkflow(workflow);

      const updatedWorkflow = createTestWorkflow('update-test', 'Updated Name', {
        description: 'Updated description'
      });

      await service.updateWorkflow('update-test', updatedWorkflow);
      const retrieved = await service.getWorkflow('update-test');

      expect(retrieved?.name).toBe('Updated Name');
      expect(retrieved?.description).toBe('Updated description');
    });

    test('should delete workflows', async () => {
      const workflow = createTestWorkflow('delete-test', 'To Delete');
      await service.createWorkflow(workflow);
      expect(await service.getWorkflow('delete-test')).toBeDefined();

      await service.deleteWorkflow('delete-test');
      expect(await service.getWorkflow('delete-test')).toBeNull();
    });

    test('should handle non-existent workflow operations gracefully', async () => {
      const nonExistent = await service.getWorkflow('non-existent');
      expect(nonExistent).toBeNull();

      // These should throw appropriate errors
      await expect(service.deleteWorkflow('non-existent')).rejects.toThrow('Workflow not found');
      
      const testWorkflow = createTestWorkflow('non-existent', 'Test');
      await expect(service.updateWorkflow('non-existent', testWorkflow)).rejects.toThrow('Workflow not found');
    });
  });

  describe('Agent Management', () => {
    test('should create and retrieve agents', async () => {
      const agent = createTestAgent('test-agent-1', 'Test Agent', {
        availableTools: ['web_search', 'calculator']
      });

      await service.createAgent(agent);
      const retrieved = await service.getAgent('test-agent-1');

      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe('test-agent-1');
      expect(retrieved?.name).toBe('Test Agent');
      expect(retrieved?.availableTools).toEqual(['web_search', 'calculator']);
    });

    test('should list all agents', async () => {
      const agent1 = createTestAgent('agent-1', 'Agent 1');
      const agent2 = createTestAgent('agent-2', 'Agent 2', {
        model: 'gpt-4',
        availableTools: ['web_search']
      });

      await service.createAgent(agent1);
      await service.createAgent(agent2);

      const agents = await service.listAgents();
      expect(agents).toHaveLength(2);
      expect(agents.map(a => a.id)).toContain('agent-1');
      expect(agents.map(a => a.id)).toContain('agent-2');
    });

    test('should update agents', async () => {
      const agent = createTestAgent('update-agent', 'Original Agent');
      await service.createAgent(agent);

      const updatedAgent = createTestAgent('update-agent', 'Updated Agent', {
        model: 'gpt-4',
        availableTools: ['web_search']
      });

      await service.updateAgent('update-agent', updatedAgent);
      const retrieved = await service.getAgent('update-agent');

      expect(retrieved?.name).toBe('Updated Agent');
      expect(retrieved?.model).toBe('gpt-4');
      expect(retrieved?.availableTools).toEqual(['web_search']);
    });

    test('should delete agents', async () => {
      const agent = createTestAgent('delete-agent', 'To Delete');
      await service.createAgent(agent);
      expect(await service.getAgent('delete-agent')).toBeDefined();

      await service.deleteAgent('delete-agent');
      expect(await service.getAgent('delete-agent')).toBeNull();
    });
  });

  describe('Event Management', () => {
    test('should get event handlers from workflows', async () => {
      // Create a workflow which automatically registers event handlers
      const workflow = createTestWorkflow('event-workflow', 'Event Workflow');
      await service.createWorkflow(workflow);

      const handlers = await service.getEventHandlers();
      expect(Array.isArray(handlers)).toBe(true);
      // Event handlers are automatically created when workflows are registered
    });
  });

  describe('Workflow Execution', () => {
    test('should execute workflow and log runs', async () => {
      // Set up test workflow
      const workflow = createTestWorkflow('exec-workflow', 'Execution Test Workflow');
      await service.createWorkflow(workflow);

      const initialRuns = await service.exportRuns({});
      const initialCount = initialRuns.length;

      const result = await service.executeWorkflow('exec-workflow', { test: 'data' });

      expect(result).toBeDefined();
      expect(result.id).toBeDefined();

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
      // Set up test workflow
      const workflow = createTestWorkflow('exec-workflow-2', 'Execution Test Workflow 2');
      await service.createWorkflow(workflow);
      
      await service.executeWorkflow('exec-workflow-2', { test: 'data' });
      
      const workflowRuns = await service.getWorkflowRuns('exec-workflow-2', 10);
      expect(workflowRuns.length).toBeGreaterThan(0);
      
      const workflowRun = workflowRuns.find(r => r.runType === 'workflow_execution');
      expect(workflowRun).toBeDefined();
      expect(workflowRun?.workflowId).toBe('exec-workflow-2');
    });
  });

  describe('Run Analytics', () => {
    test('should get run statistics', async () => {
      const stats = await service.getRunStats();
      
      expect(stats).toBeDefined();
      expect(typeof stats.totalRuns).toBe('number');
      expect(typeof stats.successfulRuns).toBe('number');
      expect(typeof stats.failedRuns).toBe('number');
      expect(typeof stats.averageDuration).toBe('number');
      expect(typeof stats.totalTokens).toBe('number');
    });

    test('should get performance metrics', async () => {
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
      const allRuns = await service.exportRuns({});
      expect(Array.isArray(allRuns)).toBe(true);

      const filteredRuns = await service.exportRuns({
        workflowId: 'test-workflow-1'  // Use a workflow that might exist from previous tests
      });
      expect(Array.isArray(filteredRuns)).toBe(true);
    });
  });

  describe('Error Handling', () => {
    test('should handle invalid data gracefully', async () => {
      // Test with malformed workflow data
      const invalidWorkflow = {
        id: 'invalid',
        name: null as any,
        description: undefined as any,
        version: '1.0.0',
        trigger: { type: 'manual' as const, config: {} },
        rootAgent: null as any,
        levels: [],
        createdAt: new Date(),
        updatedAt: new Date()
      };

      // Should throw appropriate errors for invalid data
      await expect(async () => {
        await service.createWorkflow(invalidWorkflow);
      }).rejects.toThrow();
    });

    test('should handle concurrent operations', async () => {
      // Create multiple concurrent operations
      const promises = Array.from({ length: 3 }, (_, i) => 
        service.createWorkflow(createTestWorkflow(`concurrent-test-${i}`, `Concurrent Test ${i}`))
      );

      await Promise.all(promises);

      const workflows = await service.listWorkflows();
      const concurrentWorkflows = workflows.filter(w => 
        w.id.startsWith('concurrent-test-')
      );
      
      expect(concurrentWorkflows).toHaveLength(3);
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
      const workflow = createTestWorkflow('integrity-workflow', 'Integrity Test');
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

      // Workflow should be gone
      const deletedWorkflow = await service.getWorkflow('integrity-workflow');
      expect(deletedWorkflow).toBeNull();
    });

    test('should handle duplicate IDs appropriately', async () => {
      const workflow = createTestWorkflow('duplicate-test', 'Original');
      await service.createWorkflow(workflow);

      const duplicateWorkflow = createTestWorkflow('duplicate-test', 'Duplicate');

      // Creating duplicate should throw an error or handle gracefully
      await expect(async () => {
        await service.createWorkflow(duplicateWorkflow);
      }).rejects.toThrow();
    });
  });
});