import { ArbiterDatabase } from '../database';
import { WorkflowRecord, AgentRecord, RunRecord } from '../types';
import { tmpdir } from 'os';
import { join } from 'path';
import { unlinkSync, existsSync } from 'fs';

describe('ArbiterDatabase', () => {
  let db: ArbiterDatabase;
  let tempDbPath: string;

  beforeEach(() => {
    tempDbPath = join(tmpdir(), `test-arbiter-${Date.now()}-${Math.random().toString(36).substring(2)}.db`);
    db = new ArbiterDatabase({ path: tempDbPath });
  });

  afterEach(() => {
    db.close();
    if (existsSync(tempDbPath)) {
      unlinkSync(tempDbPath);
    }
  });

  describe('Workflow operations', () => {
    const mockWorkflow: WorkflowRecord = {
      id: 'workflow-1',
      name: 'Test Workflow',
      description: 'A test workflow',
      version: '1.0.0',
      userPrompt: 'Test prompt',
      config: {
        id: 'workflow-1',
        name: 'Test Workflow',
        description: 'A test workflow',
        version: '1.0.0',
        trigger: { type: 'manual', config: {} },
        rootAgent: {
          id: 'root-agent',
          name: 'Root Agent',
          description: 'Root agent',
          model: 'granite',
          systemPrompt: 'You are a root agent',
          availableTools: [],
          level: 0,
        },
        levels: [],
      },
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    test('should insert and retrieve workflow', async () => {
      await db.insertWorkflow(mockWorkflow);
      const retrieved = await db.getWorkflow('workflow-1');
      
      expect(retrieved).toBeDefined();
      expect(retrieved!.id).toBe('workflow-1');
      expect(retrieved!.name).toBe('Test Workflow');
      expect(retrieved!.config).toEqual(mockWorkflow.config);
    });

    test('should list all workflows', () => {
      db.insertWorkflow(mockWorkflow);
      db.insertWorkflow({
        ...mockWorkflow,
        id: 'workflow-2',
        name: 'Second Workflow',
      });

      const workflows = db.listWorkflows();
      expect(workflows).toHaveLength(2);
      expect(workflows.map(w => w.name)).toContain('Test Workflow');
      expect(workflows.map(w => w.name)).toContain('Second Workflow');
    });

    test('should update workflow', () => {
      db.insertWorkflow(mockWorkflow);
      
      db.updateWorkflow('workflow-1', {
        name: 'Updated Workflow',
        version: '2.0.0',
        updatedAt: '2024-01-02T00:00:00.000Z',
      });

      const updated = db.getWorkflow('workflow-1');
      expect(updated!.name).toBe('Updated Workflow');
      expect(updated!.version).toBe('2.0.0');
      expect(updated!.updatedAt).toBe('2024-01-02T00:00:00.000Z');
    });

    test('should delete workflow', () => {
      db.insertWorkflow(mockWorkflow);
      expect(db.getWorkflow('workflow-1')).toBeDefined();
      
      const deleted = db.deleteWorkflow('workflow-1');
      expect(deleted).toBe(true);
      expect(db.getWorkflow('workflow-1')).toBeUndefined();
    });

    test('should return false when deleting non-existent workflow', () => {
      const deleted = db.deleteWorkflow('non-existent');
      expect(deleted).toBe(false);
    });
  });

  describe('Agent operations', () => {
    const mockAgent: AgentRecord = {
      id: 'agent-1',
      name: 'Test Agent',
      description: 'A test agent',
      model: 'granite',
      systemPrompt: 'You are a test agent',
      availableTools: ['tool1', 'tool2'],
      level: 1,
      inputSchema: { type: 'object' },
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    test('should insert and retrieve agent', () => {
      db.insertAgent(mockAgent);
      const retrieved = db.getAgent('agent-1');
      
      expect(retrieved).toBeDefined();
      expect(retrieved!.id).toBe('agent-1');
      expect(retrieved!.name).toBe('Test Agent');
      expect(retrieved!.availableTools).toEqual(['tool1', 'tool2']);
      expect(retrieved!.inputSchema).toEqual({ type: 'object' });
    });

    test('should list all agents', () => {
      db.insertAgent(mockAgent);
      db.insertAgent({
        ...mockAgent,
        id: 'agent-2',
        name: 'Second Agent',
      });

      const agents = db.listAgents();
      expect(agents).toHaveLength(2);
      expect(agents.map(a => a.name)).toContain('Test Agent');
      expect(agents.map(a => a.name)).toContain('Second Agent');
    });

    test('should delete agent', () => {
      db.insertAgent(mockAgent);
      expect(db.getAgent('agent-1')).toBeDefined();
      
      const deleted = db.deleteAgent('agent-1');
      expect(deleted).toBe(true);
      expect(db.getAgent('agent-1')).toBeUndefined();
    });
  });

  describe('Run logging operations', () => {
    const mockRun: RunRecord = {
      id: 'run-1',
      workflowId: 'workflow-1',
      executionId: 'exec-1',
      runType: 'workflow_execution',
      status: 'pending',
      startTime: '2024-01-01T00:00:00.000Z',
      requestData: { input: 'test' },
      metadata: { test: true },
    };

    test('should insert and retrieve run', () => {
      db.insertRun(mockRun);
      const retrieved = db.getRun('run-1');
      
      expect(retrieved).toBeDefined();
      expect(retrieved!.id).toBe('run-1');
      expect(retrieved!.workflowId).toBe('workflow-1');
      expect(retrieved!.requestData).toEqual({ input: 'test' });
      expect(retrieved!.metadata).toEqual({ test: true });
    });

    test('should update run status', () => {
      db.insertRun(mockRun);
      
      db.updateRunStatus('run-1', 'completed', '2024-01-01T00:01:00.000Z', 60000);
      
      const updated = db.getRun('run-1');
      expect(updated!.status).toBe('completed');
      expect(updated!.endTime).toBe('2024-01-01T00:01:00.000Z');
      expect(updated!.durationMs).toBe(60000);
    });

    test('should update run error', () => {
      db.insertRun(mockRun);
      
      db.updateRunError('run-1', 'Test error', 'Error stack', 'ERROR_CODE');
      
      const updated = db.getRun('run-1');
      expect(updated!.status).toBe('failed');
      expect(updated!.errorMessage).toBe('Test error');
      expect(updated!.errorStack).toBe('Error stack');
      expect(updated!.errorCode).toBe('ERROR_CODE');
    });

    test('should get runs by workflow', () => {
      db.insertRun(mockRun);
      db.insertRun({
        ...mockRun,
        id: 'run-2',
        workflowId: 'workflow-1',
      });
      db.insertRun({
        ...mockRun,
        id: 'run-3',
        workflowId: 'workflow-2',
      });

      const workflowRuns = db.getRunsByWorkflow('workflow-1');
      expect(workflowRuns).toHaveLength(2);
      expect(workflowRuns.map(r => r.id)).toContain('run-1');
      expect(workflowRuns.map(r => r.id)).toContain('run-2');
    });

    test('should get runs by execution', () => {
      db.insertRun(mockRun);
      db.insertRun({
        ...mockRun,
        id: 'run-2',
        executionId: 'exec-1',
      });
      db.insertRun({
        ...mockRun,
        id: 'run-3',
        executionId: 'exec-2',
      });

      const executionRuns = db.getRunsByExecution('exec-1');
      expect(executionRuns).toHaveLength(2);
      expect(executionRuns.map(r => r.id)).toContain('run-1');
      expect(executionRuns.map(r => r.id)).toContain('run-2');
    });

    test('should search runs with filters', () => {
      db.insertRun(mockRun);
      db.insertRun({
        ...mockRun,
        id: 'run-2',
        status: 'completed',
        runType: 'agent_execution',
      });
      db.insertRun({
        ...mockRun,
        id: 'run-3',
        status: 'failed',
        runType: 'tool_call',
      });

      // Search by status
      const completedRuns = db.searchRuns({ status: 'completed' });
      expect(completedRuns).toHaveLength(1);
      expect(completedRuns[0].id).toBe('run-2');

      // Search by run type
      const agentRuns = db.searchRuns({ runType: 'agent_execution' });
      expect(agentRuns).toHaveLength(1);
      expect(agentRuns[0].id).toBe('run-2');

      // Search by workflow ID
      const workflowRuns = db.searchRuns({ workflowId: 'workflow-1' });
      expect(workflowRuns).toHaveLength(3);
    });

    test('should get run statistics', () => {
      db.insertRun({
        ...mockRun,
        status: 'completed',
        durationMs: 1000,
        tokensUsed: 100,
      });
      db.insertRun({
        ...mockRun,
        id: 'run-2',
        status: 'failed',
        durationMs: 500,
        tokensUsed: 50,
      });
      db.insertRun({
        ...mockRun,
        id: 'run-3',
        status: 'completed',
        durationMs: 1500,
        tokensUsed: 150,
      });

      const stats = db.getRunStats();
      expect(stats.totalRuns).toBe(3);
      expect(stats.successfulRuns).toBe(2);
      expect(stats.failedRuns).toBe(1);
      expect(stats.averageDuration).toBe(1000); // Average of all durations
      expect(stats.totalTokens).toBe(300);
    });

    test('should get run statistics for specific workflow', () => {
      db.insertRun({
        ...mockRun,
        workflowId: 'workflow-1',
        status: 'completed',
        tokensUsed: 100,
      });
      db.insertRun({
        ...mockRun,
        id: 'run-2',
        workflowId: 'workflow-2',
        status: 'completed',
        tokensUsed: 200,
      });

      const workflow1Stats = db.getRunStats('workflow-1');
      expect(workflow1Stats.totalRuns).toBe(1);
      expect(workflow1Stats.totalTokens).toBe(100);

      const workflow2Stats = db.getRunStats('workflow-2');
      expect(workflow2Stats.totalRuns).toBe(1);
      expect(workflow2Stats.totalTokens).toBe(200);
    });
  });

  describe('Database integrity', () => {
    test('should handle foreign key constraints', () => {
      // Insert workflow first
      const mockWorkflow: WorkflowRecord = {
        id: 'workflow-1',
        name: 'Test Workflow',
        description: 'A test workflow',
        version: '1.0.0',
        config: {},
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      };
      db.insertWorkflow(mockWorkflow);

      // Insert run referencing the workflow
      const mockRun: RunRecord = {
        id: 'run-1',
        workflowId: 'workflow-1',
        runType: 'workflow_execution',
        status: 'pending',
        startTime: '2024-01-01T00:00:00.000Z',
      };
      db.insertRun(mockRun);

      // Verify run exists
      expect(db.getRun('run-1')).toBeDefined();

      // Delete workflow (should cascade delete runs)
      db.deleteWorkflow('workflow-1');

      // Verify run was cascade deleted
      expect(db.getRun('run-1')).toBeUndefined();
    });

    test('should handle complex JSON data', () => {
      const complexConfig = {
        nested: {
          object: {
            with: ['arrays', 'and', { deep: 'nesting' }],
          },
        },
        special: 'chars: "quotes" and \'apostrophes\' and \nnewlines',
        unicode: '🚀 Rocket ship emoji',
        numbers: [1, 2.5, -3, 0],
        booleans: [true, false],
        nullValue: null,
      };

      const workflow: WorkflowRecord = {
        id: 'complex-workflow',
        name: 'Complex Workflow',
        description: 'Workflow with complex config',
        version: '1.0.0',
        config: complexConfig,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      };

      db.insertWorkflow(workflow);
      const retrieved = db.getWorkflow('complex-workflow');

      expect(retrieved!.config).toEqual(complexConfig);
    });
  });
});