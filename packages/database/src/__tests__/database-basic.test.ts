import { ArbiterDatabase } from '../database';
import { WorkflowRecord, AgentRecord, RunRecord } from '../types';
import { tmpdir } from 'os';
import { join } from 'path';
import { unlinkSync, existsSync } from 'fs';

describe('ArbiterDatabase - Basic Functionality', () => {
  let db: ArbiterDatabase;
  let tempDbPath: string;

  beforeEach(() => {
    tempDbPath = join(tmpdir(), `test-basic-${Date.now()}-${Math.random().toString(36).substring(2)}.db`);
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

    test('should return undefined for non-existent workflow', async () => {
      const retrieved = await db.getWorkflow('non-existent');
      expect(retrieved).toBeUndefined();
    });

    test('should list workflows', async () => {
      await db.insertWorkflow(mockWorkflow);
      const workflows = await db.listWorkflows();
      expect(workflows).toHaveLength(1);
      expect(workflows[0].name).toBe('Test Workflow');
    });

    test('should delete workflow', async () => {
      await db.insertWorkflow(mockWorkflow);
      const deleted = await db.deleteWorkflow('workflow-1');
      expect(deleted).toBe(true);
      
      const retrieved = await db.getWorkflow('workflow-1');
      expect(retrieved).toBeUndefined();
    });
  });

  describe('Run logging operations', () => {
    const mockWorkflow: WorkflowRecord = {
      id: 'workflow-1',
      name: 'Test Workflow',
      description: 'A test workflow',
      version: '1.0.0',
      config: {},
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

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

    test('should insert and retrieve run', async () => {
      // Insert workflow first to satisfy foreign key constraint
      await db.insertWorkflow(mockWorkflow);
      await db.insertRun(mockRun);
      const retrieved = await db.getRun('run-1');
      
      expect(retrieved).toBeDefined();
      expect(retrieved!.id).toBe('run-1');
      expect(retrieved!.workflowId).toBe('workflow-1');
      expect(retrieved!.requestData).toEqual({ input: 'test' });
    });

    test('should update run status', async () => {
      await db.insertWorkflow(mockWorkflow);
      await db.insertRun(mockRun);
      await db.updateRunStatus('run-1', 'completed', '2024-01-01T00:01:00.000Z', 60000);
      
      const updated = await db.getRun('run-1');
      expect(updated!.status).toBe('completed');
      expect(updated!.endTime).toBe('2024-01-01T00:01:00.000Z');
      expect(updated!.durationMs).toBe(60000);
    });

    test('should search runs', async () => {
      await db.insertWorkflow(mockWorkflow);
      await db.insertRun(mockRun);
      await db.insertRun({
        ...mockRun,
        id: 'run-2',
        status: 'completed',
      });

      const allRuns = await db.searchRuns({});
      expect(allRuns).toHaveLength(2);

      const completedRuns = await db.searchRuns({ status: 'completed' });
      expect(completedRuns).toHaveLength(1);
      expect(completedRuns[0].id).toBe('run-2');
    });
  });

  test('should initialize database without errors', () => {
    expect(db).toBeDefined();
  });
});