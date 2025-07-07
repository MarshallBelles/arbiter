import { ArbiterDatabase } from '../database';
import { WorkflowRepository, AgentRepository, RunRepository } from '../repositories';
import { WorkflowConfig, AgentConfig } from '@arbiter/core';
import { RunRecord } from '../types';
import { tmpdir } from 'os';
import { join } from 'path';
import { unlinkSync, existsSync } from 'fs';

describe('Repositories', () => {
  let db: ArbiterDatabase;
  let tempDbPath: string;
  let workflowRepo: WorkflowRepository;
  let agentRepo: AgentRepository;
  let runRepo: RunRepository;

  beforeEach(() => {
    tempDbPath = join(tmpdir(), `test-repos-${Date.now()}-${Math.random().toString(36).substring(2)}.db`);
    db = new ArbiterDatabase({ path: tempDbPath });
    workflowRepo = new WorkflowRepository(db);
    agentRepo = new AgentRepository(db);
    runRepo = new RunRepository(db);
  });

  afterEach(() => {
    db.close();
    if (existsSync(tempDbPath)) {
      unlinkSync(tempDbPath);
    }
  });

  describe('WorkflowRepository', () => {
    const mockWorkflow: WorkflowConfig = {
      id: 'workflow-1',
      name: 'Test Workflow',
      description: 'A test workflow',
      version: '1.0.0',
      userPrompt: 'Test prompt',
      trigger: {
        type: 'manual',
        config: {},
      },
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
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
      updatedAt: new Date('2024-01-01T00:00:00.000Z'),
    };

    test('should create and find workflow by ID', async () => {
      await workflowRepo.create(mockWorkflow);
      const found = await workflowRepo.findById('workflow-1');
      
      expect(found).toBeDefined();
      expect(found!.id).toBe('workflow-1');
      expect(found!.name).toBe('Test Workflow');
      expect(found!.createdAt).toEqual(new Date('2024-01-01T00:00:00.000Z'));
    });

    test('should return null for non-existent workflow', async () => {
      const found = await workflowRepo.findById('non-existent');
      expect(found).toBeNull();
    });

    test('should find all workflows', async () => {
      await workflowRepo.create(mockWorkflow);
      await workflowRepo.create({
        ...mockWorkflow,
        id: 'workflow-2',
        name: 'Second Workflow',
      });

      const all = await workflowRepo.findAll();
      expect(all).toHaveLength(2);
      expect(all.map(w => w.name)).toContain('Test Workflow');
      expect(all.map(w => w.name)).toContain('Second Workflow');
    });

    test('should update workflow', async () => {
      await workflowRepo.create(mockWorkflow);
      
      const updatedWorkflow = {
        ...mockWorkflow,
        name: 'Updated Workflow',
        version: '2.0.0',
      };
      
      await workflowRepo.update('workflow-1', updatedWorkflow);
      
      const found = await workflowRepo.findById('workflow-1');
      expect(found!.name).toBe('Updated Workflow');
      expect(found!.version).toBe('2.0.0');
    });

    test('should delete workflow', async () => {
      await workflowRepo.create(mockWorkflow);
      expect(await workflowRepo.exists('workflow-1')).toBe(true);
      
      const deleted = await workflowRepo.delete('workflow-1');
      expect(deleted).toBe(true);
      expect(await workflowRepo.exists('workflow-1')).toBe(false);
    });

    test('should check if workflow exists', async () => {
      expect(await workflowRepo.exists('workflow-1')).toBe(false);
      
      await workflowRepo.create(mockWorkflow);
      expect(await workflowRepo.exists('workflow-1')).toBe(true);
    });
  });

  describe('AgentRepository', () => {
    const mockAgent: AgentConfig = {
      id: 'agent-1',
      name: 'Test Agent',
      description: 'A test agent',
      model: 'granite',
      systemPrompt: 'You are a test agent',
      availableTools: ['tool1', 'tool2'],
      level: 1,
      inputSchema: { type: 'object' },
    };

    test('should create and find agent by ID', async () => {
      await agentRepo.create(mockAgent);
      const found = await agentRepo.findById('agent-1');
      
      expect(found).toBeDefined();
      expect(found!.id).toBe('agent-1');
      expect(found!.name).toBe('Test Agent');
      expect(found!.availableTools).toEqual(['tool1', 'tool2']);
    });

    test('should return null for non-existent agent', async () => {
      const found = await agentRepo.findById('non-existent');
      expect(found).toBeNull();
    });

    test('should find all agents', async () => {
      await agentRepo.create(mockAgent);
      await agentRepo.create({
        ...mockAgent,
        id: 'agent-2',
        name: 'Second Agent',
        level: 2,
      });

      const all = await agentRepo.findAll();
      expect(all).toHaveLength(2);
      expect(all.map(a => a.name)).toContain('Test Agent');
      expect(all.map(a => a.name)).toContain('Second Agent');
    });

    test('should find agents by level', async () => {
      await agentRepo.create(mockAgent);
      await agentRepo.create({
        ...mockAgent,
        id: 'agent-2',
        name: 'Level 2 Agent',
        level: 2,
      });
      await agentRepo.create({
        ...mockAgent,
        id: 'agent-3',
        name: 'Another Level 1 Agent',
        level: 1,
      });

      const level1Agents = await agentRepo.findByLevel(1);
      expect(level1Agents).toHaveLength(2);
      expect(level1Agents.map(a => a.name)).toContain('Test Agent');
      expect(level1Agents.map(a => a.name)).toContain('Another Level 1 Agent');

      const level2Agents = await agentRepo.findByLevel(2);
      expect(level2Agents).toHaveLength(1);
      expect(level2Agents[0].name).toBe('Level 2 Agent');
    });

    test('should find agents by model', async () => {
      await agentRepo.create(mockAgent);
      await agentRepo.create({
        ...mockAgent,
        id: 'agent-2',
        name: 'GPT Agent',
        model: 'gpt-4',
      });

      const graniteAgents = await agentRepo.findByModel('granite');
      expect(graniteAgents).toHaveLength(1);
      expect(graniteAgents[0].name).toBe('Test Agent');

      const gptAgents = await agentRepo.findByModel('gpt-4');
      expect(gptAgents).toHaveLength(1);
      expect(gptAgents[0].name).toBe('GPT Agent');
    });

    test('should delete agent', async () => {
      await agentRepo.create(mockAgent);
      expect(await agentRepo.exists('agent-1')).toBe(true);
      
      const deleted = await agentRepo.delete('agent-1');
      expect(deleted).toBe(true);
      expect(await agentRepo.exists('agent-1')).toBe(false);
    });
  });

  describe('RunRepository', () => {
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

    test('should create and find run by ID', async () => {
      await runRepo.create(mockRun);
      const found = await runRepo.findById('run-1');
      
      expect(found).toBeDefined();
      expect(found!.id).toBe('run-1');
      expect(found!.workflowId).toBe('workflow-1');
      expect(found!.requestData).toEqual({ input: 'test' });
    });

    test('should return null for non-existent run', async () => {
      const found = await runRepo.findById('non-existent');
      expect(found).toBeNull();
    });

    test('should find runs by workflow', async () => {
      await runRepo.create(mockRun);
      await runRepo.create({
        ...mockRun,
        id: 'run-2',
        workflowId: 'workflow-1',
      });
      await runRepo.create({
        ...mockRun,
        id: 'run-3',
        workflowId: 'workflow-2',
      });

      const workflow1Runs = await runRepo.findByWorkflow('workflow-1');
      expect(workflow1Runs).toHaveLength(2);
      expect(workflow1Runs.map(r => r.id)).toContain('run-1');
      expect(workflow1Runs.map(r => r.id)).toContain('run-2');
    });

    test('should find runs by execution', async () => {
      await runRepo.create(mockRun);
      await runRepo.create({
        ...mockRun,
        id: 'run-2',
        executionId: 'exec-1',
      });
      await runRepo.create({
        ...mockRun,
        id: 'run-3',
        executionId: 'exec-2',
      });

      const exec1Runs = await runRepo.findByExecution('exec-1');
      expect(exec1Runs).toHaveLength(2);
      expect(exec1Runs.map(r => r.id)).toContain('run-1');
      expect(exec1Runs.map(r => r.id)).toContain('run-2');
    });

    test('should search runs with filters', async () => {
      await runRepo.create(mockRun);
      await runRepo.create({
        ...mockRun,
        id: 'run-2',
        status: 'completed',
        runType: 'agent_execution',
      });

      const completedRuns = await runRepo.search({ status: 'completed' });
      expect(completedRuns).toHaveLength(1);
      expect(completedRuns[0].id).toBe('run-2');

      const agentRuns = await runRepo.search({ runType: 'agent_execution' });
      expect(agentRuns).toHaveLength(1);
      expect(agentRuns[0].id).toBe('run-2');
    });

    test('should update run status', async () => {
      await runRepo.create(mockRun);
      
      await runRepo.updateStatus('run-1', 'completed', '2024-01-01T00:01:00.000Z', 60000);
      
      const updated = await runRepo.findById('run-1');
      expect(updated!.status).toBe('completed');
      expect(updated!.endTime).toBe('2024-01-01T00:01:00.000Z');
      expect(updated!.durationMs).toBe(60000);
    });

    test('should update run error', async () => {
      await runRepo.create(mockRun);
      
      await runRepo.updateError('run-1', 'Test error', 'Error stack', 'ERROR_CODE');
      
      const updated = await runRepo.findById('run-1');
      expect(updated!.status).toBe('failed');
      expect(updated!.errorMessage).toBe('Test error');
      expect(updated!.errorStack).toBe('Error stack');
      expect(updated!.errorCode).toBe('ERROR_CODE');
    });

    test('should get run statistics', async () => {
      await runRepo.create({
        ...mockRun,
        status: 'completed',
        durationMs: 1000,
        tokensUsed: 100,
      });
      await runRepo.create({
        ...mockRun,
        id: 'run-2',
        status: 'failed',
        durationMs: 500,
        tokensUsed: 50,
      });

      const stats = await runRepo.getStats();
      expect(stats.totalRuns).toBe(2);
      expect(stats.successfulRuns).toBe(1);
      expect(stats.failedRuns).toBe(1);
      expect(stats.totalTokens).toBe(150);
    });

    test('should get performance metrics', async () => {
      await runRepo.create({
        ...mockRun,
        status: 'completed',
        tokensUsed: 100,
        memoryUsedMb: 50,
        cpuTimeMs: 1000,
      });
      await runRepo.create({
        ...mockRun,
        id: 'run-2',
        status: 'completed',
        tokensUsed: 200,
        memoryUsedMb: 100,
        cpuTimeMs: 2000,
      });

      const metrics = await runRepo.getPerformanceMetrics();
      expect(metrics.totalRuns).toBe(2);
      expect(metrics.averageTokensPerRun).toBe(150);
      expect(metrics.averageMemoryUsage).toBe(75);
      expect(metrics.averageCpuTime).toBe(1500);
    });

    test('should get recent errors', async () => {
      await runRepo.create({
        ...mockRun,
        status: 'completed',
      });
      await runRepo.create({
        ...mockRun,
        id: 'run-2',
        status: 'failed',
        errorMessage: 'Test error',
      });

      const errors = await runRepo.getRecentErrors();
      expect(errors).toHaveLength(1);
      expect(errors[0].id).toBe('run-2');
      expect(errors[0].errorMessage).toBe('Test error');
    });

    test('should export runs', async () => {
      await runRepo.create(mockRun);
      await runRepo.create({
        ...mockRun,
        id: 'run-2',
        status: 'completed',
      });

      const exported = await runRepo.export();
      expect(exported).toHaveLength(2);
      
      const exportedCompleted = await runRepo.export({ status: 'completed' });
      expect(exportedCompleted).toHaveLength(1);
      expect(exportedCompleted[0].id).toBe('run-2');
    });

    test('should generate unique run IDs', () => {
      const id1 = runRepo.generateRunId();
      const id2 = runRepo.generateRunId();
      const id3 = runRepo.generateRunId('custom');
      
      expect(id1).toMatch(/^run_\d+_[a-z0-9]+$/);
      expect(id2).toMatch(/^run_\d+_[a-z0-9]+$/);
      expect(id3).toMatch(/^custom_\d+_[a-z0-9]+$/);
      expect(id1).not.toBe(id2);
      expect(id2).not.toBe(id3);
    });
  });
});