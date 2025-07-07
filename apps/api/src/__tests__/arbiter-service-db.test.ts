import { ArbiterServiceDB } from '../services/arbiter-service-db';
import { WorkflowConfig, AgentConfig } from '@arbiter/core';
import { tmpdir } from 'os';
import { join } from 'path';
import { unlinkSync, existsSync } from 'fs';

describe('ArbiterServiceDB', () => {
  let service: ArbiterServiceDB;
  let tempDbPath: string;

  beforeEach(async () => {
    tempDbPath = join(tmpdir(), `test-arbiter-service-${Date.now()}-${Math.random().toString(36).substring(2)}.db`);
    service = new ArbiterServiceDB(tempDbPath);
    await service.initialize();
  });

  afterEach(async () => {
    await service.shutdown();
    if (existsSync(tempDbPath)) {
      unlinkSync(tempDbPath);
    }
  });

  describe('Workflow Management with Persistence', () => {
    const mockWorkflow: WorkflowConfig = {
      id: 'test-workflow-1',
      name: 'Test Workflow',
      description: 'A test workflow',
      version: '1.0.0',
      userPrompt: 'Test prompt',
      trigger: {
        type: 'manual',
        config: {},
      },
      rootAgent: {
        id: 'root-agent-1',
        name: 'Root Agent',
        description: 'Root agent',
        model: 'granite',
        systemPrompt: 'You are a root agent',
        availableTools: [],
        level: 0,
      },
      levels: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    test('should create and persist workflow', async () => {
      const workflowId = await service.createWorkflow(mockWorkflow);
      expect(workflowId).toBe('test-workflow-1');

      const retrieved = await service.getWorkflow(workflowId);
      expect(retrieved).toBeDefined();
      expect(retrieved!.id).toBe('test-workflow-1');
      expect(retrieved!.name).toBe('Test Workflow');
    });

    test('should list persisted workflows', async () => {
      await service.createWorkflow(mockWorkflow);
      
      const workflows = await service.listWorkflows();
      expect(workflows).toHaveLength(1);
      expect(workflows[0].name).toBe('Test Workflow');
    });

    test('should update persisted workflow', async () => {
      await service.createWorkflow(mockWorkflow);
      
      const updatedWorkflow = {
        ...mockWorkflow,
        name: 'Updated Test Workflow',
        version: '2.0.0',
      };
      
      await service.updateWorkflow('test-workflow-1', updatedWorkflow);
      
      const retrieved = await service.getWorkflow('test-workflow-1');
      expect(retrieved!.name).toBe('Updated Test Workflow');
      expect(retrieved!.version).toBe('2.0.0');
    });

    test('should delete persisted workflow', async () => {
      await service.createWorkflow(mockWorkflow);
      
      await service.deleteWorkflow('test-workflow-1');
      
      const retrieved = await service.getWorkflow('test-workflow-1');
      expect(retrieved).toBeNull();
    });
  });

  describe('Agent Management with Persistence', () => {
    const mockAgent: AgentConfig = {
      id: 'test-agent-1',
      name: 'Test Agent',
      description: 'A test agent',
      model: 'granite',
      systemPrompt: 'You are a test agent',
      availableTools: ['tool1', 'tool2'],
      level: 1,
    };

    test('should create and persist agent', async () => {
      const agentId = await service.createAgent(mockAgent);
      expect(agentId).toBe('test-agent-1');

      const retrieved = await service.getAgent(agentId);
      expect(retrieved).toBeDefined();
      expect(retrieved!.id).toBe('test-agent-1');
      expect(retrieved!.name).toBe('Test Agent');
    });

    test('should list persisted agents', async () => {
      await service.createAgent(mockAgent);
      
      const agents = await service.listAgents();
      expect(agents).toHaveLength(1);
      expect(agents[0].name).toBe('Test Agent');
    });

    test('should delete persisted agent', async () => {
      await service.createAgent(mockAgent);
      
      await service.deleteAgent('test-agent-1');
      
      const retrieved = await service.getAgent('test-agent-1');
      expect(retrieved).toBeNull();
    });
  });

  describe('Run Logging and Analytics', () => {
    const mockWorkflow: WorkflowConfig = {
      id: 'analytics-workflow',
      name: 'Analytics Test Workflow',
      description: 'A workflow for analytics testing',
      version: '1.0.0',
      trigger: { type: 'manual', config: {} },
      rootAgent: {
        id: 'analytics-agent',
        name: 'Analytics Agent',
        description: 'Agent for analytics',
        model: 'granite',
        systemPrompt: 'You are an analytics agent',
        availableTools: [],
        level: 0,
      },
      levels: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    beforeEach(async () => {
      await service.createWorkflow(mockWorkflow);
    });

    test('should get workflow runs', async () => {
      const runs = await service.getWorkflowRuns('analytics-workflow');
      expect(Array.isArray(runs)).toBe(true);
    });

    test('should get run statistics', async () => {
      const stats = await service.getRunStats('analytics-workflow');
      expect(stats).toBeDefined();
      expect(typeof stats.totalRuns).toBe('number');
      expect(typeof stats.successfulRuns).toBe('number');
      expect(typeof stats.failedRuns).toBe('number');
    });

    test('should get performance metrics', async () => {
      const metrics = await service.getPerformanceMetrics('analytics-workflow');
      expect(metrics).toBeDefined();
      expect(typeof metrics.totalRuns).toBe('number');
      expect(typeof metrics.averageTokensPerRun).toBe('number');
    });

    test('should export runs', async () => {
      const runs = await service.exportRuns({ workflowId: 'analytics-workflow' });
      expect(Array.isArray(runs)).toBe(true);
    });

    test('should get recent errors', async () => {
      const errors = await service.getRecentErrors(10);
      expect(Array.isArray(errors)).toBe(true);
    });
  });

  describe('Service Status with Database Insights', () => {
    test('should get enhanced status with database metrics', async () => {
      const status = await service.getStatus();
      
      expect(status).toBeDefined();
      expect(status.workflows).toBeDefined();
      expect(status.agents).toBeDefined();
      expect(status.executions).toBeDefined();
      expect(status.executions.totalRuns).toBeDefined();
      expect(status.performance).toBeDefined();
      expect(status.performance.totalTokens).toBeDefined();
    });

    test('should provide database path', () => {
      const dbPath = service.getDatabasePath();
      expect(typeof dbPath).toBe('string');
    });
  });

  describe('Data Persistence Across Restarts', () => {
    test('should restore workflows and agents after restart', async () => {
      const mockWorkflow: WorkflowConfig = {
        id: 'persistent-workflow',
        name: 'Persistent Workflow',
        description: 'A workflow that survives restarts',
        version: '1.0.0',
        trigger: { type: 'manual', config: {} },
        rootAgent: {
          id: 'persistent-agent',
          name: 'Persistent Agent',
          description: 'Agent that survives restarts',
          model: 'granite',
          systemPrompt: 'You are persistent',
          availableTools: [],
          level: 0,
        },
        levels: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      };

      // Create workflow and agent
      await service.createWorkflow(mockWorkflow);

      // Shutdown and restart service
      await service.shutdown();
      service = new ArbiterServiceDB(tempDbPath);
      await service.initialize();

      // Verify data was restored
      const workflows = await service.listWorkflows();
      const agents = await service.listAgents();

      expect(workflows).toHaveLength(1);
      expect(workflows[0].name).toBe('Persistent Workflow');
      expect(agents).toHaveLength(1);
      expect(agents[0].name).toBe('Persistent Agent');
    });
  });
});