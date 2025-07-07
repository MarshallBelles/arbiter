import { ArbiterDatabase } from '../database';
import { RunRepository } from '../repositories/run-repository';
import { RunLogger } from '../run-logger';
import { tmpdir } from 'os';
import { join } from 'path';
import { unlinkSync, existsSync } from 'fs';

describe('RunLogger', () => {
  let db: ArbiterDatabase;
  let tempDbPath: string;
  let runRepo: RunRepository;
  let runLogger: RunLogger;

  beforeEach(() => {
    tempDbPath = join(tmpdir(), `test-logger-${Date.now()}-${Math.random().toString(36).substring(2)}.db`);
    db = new ArbiterDatabase({ path: tempDbPath });
    runRepo = new RunRepository(db);
    runLogger = new RunLogger(runRepo);
  });

  afterEach(() => {
    db.close();
    if (existsSync(tempDbPath)) {
      unlinkSync(tempDbPath);
    }
  });

  describe('Workflow execution logging', () => {
    test('should log workflow execution', async () => {
      const runId = await runLogger.logWorkflowExecution({
        workflowId: 'workflow-1',
        executionId: 'exec-1',
        status: 'pending',
        requestData: { input: 'test' },
        userPrompt: 'Test prompt',
        metadata: { test: true },
      });

      expect(runId).toMatch(/^workflow_\d+_[a-z0-9]+$/);

      const run = await runRepo.findById(runId);
      expect(run).toBeDefined();
      expect(run!.workflowId).toBe('workflow-1');
      expect(run!.executionId).toBe('exec-1');
      expect(run!.runType).toBe('workflow_execution');
      expect(run!.status).toBe('pending');
      expect(run!.requestData).toEqual({ input: 'test' });
      expect(run!.userPrompt).toBe('Test prompt');
      expect(run!.metadata).toEqual({ test: true });
    });

    test('should log workflow execution with parent run', async () => {
      const parentRunId = await runLogger.logWorkflowExecution({
        workflowId: 'workflow-1',
        executionId: 'exec-1',
        status: 'running',
      });

      const childRunId = await runLogger.logWorkflowExecution({
        workflowId: 'workflow-1',
        executionId: 'exec-1',
        status: 'pending',
        parentRunId,
      });

      const childRun = await runRepo.findById(childRunId);
      expect(childRun!.parentRunId).toBe(parentRunId);
    });
  });

  describe('Agent execution logging', () => {
    test('should log agent execution', async () => {
      const runId = await runLogger.logAgentExecution({
        workflowId: 'workflow-1',
        executionId: 'exec-1',
        agentId: 'agent-1',
        status: 'running',
        requestData: { prompt: 'test prompt' },
        responseData: { response: 'test response' },
        rawRequest: 'raw request data',
        rawResponse: 'raw response data',
        userPrompt: 'User prompt',
        systemPrompt: 'System prompt',
        modelName: 'granite',
        tokensUsed: 150,
        memoryUsedMb: 50.5,
        cpuTimeMs: 1500,
        metadata: { agentTest: true },
      });

      expect(runId).toMatch(/^agent_\d+_[a-z0-9]+$/);

      const run = await runRepo.findById(runId);
      expect(run).toBeDefined();
      expect(run!.workflowId).toBe('workflow-1');
      expect(run!.agentId).toBe('agent-1');
      expect(run!.runType).toBe('agent_execution');
      expect(run!.status).toBe('running');
      expect(run!.rawRequest).toBe('raw request data');
      expect(run!.rawResponse).toBe('raw response data');
      expect(run!.modelName).toBe('granite');
      expect(run!.tokensUsed).toBe(150);
      expect(run!.memoryUsedMb).toBe(50.5);
      expect(run!.cpuTimeMs).toBe(1500);
    });
  });

  describe('Tool call logging', () => {
    test('should log tool call', async () => {
      const runId = await runLogger.logToolCall({
        workflowId: 'workflow-1',
        executionId: 'exec-1',
        agentId: 'agent-1',
        toolName: 'test-tool',
        status: 'completed',
        requestData: { toolParam: 'value' },
        responseData: { toolResult: 'success' },
        metadata: { toolTest: true },
      });

      expect(runId).toMatch(/^tool_\d+_[a-z0-9]+$/);

      const run = await runRepo.findById(runId);
      expect(run).toBeDefined();
      expect(run!.workflowId).toBe('workflow-1');
      expect(run!.agentId).toBe('agent-1');
      expect(run!.toolName).toBe('test-tool');
      expect(run!.runType).toBe('tool_call');
      expect(run!.status).toBe('completed');
      expect(run!.requestData).toEqual({ toolParam: 'value' });
      expect(run!.responseData).toEqual({ toolResult: 'success' });
    });
  });

  describe('Model request logging', () => {
    test('should log model request', async () => {
      const runId = await runLogger.logModelRequest({
        workflowId: 'workflow-1',
        executionId: 'exec-1',
        agentId: 'agent-1',
        modelName: 'granite-3.3-2b',
        status: 'completed',
        rawRequest: 'POST /v1/chat/completions {...}',
        rawResponse: '{"choices": [...]}',
        tokensUsed: 200,
        memoryUsedMb: 75.2,
        cpuTimeMs: 2000,
        metadata: { modelTest: true },
      });

      expect(runId).toMatch(/^model_\d+_[a-z0-9]+$/);

      const run = await runRepo.findById(runId);
      expect(run).toBeDefined();
      expect(run!.workflowId).toBe('workflow-1');
      expect(run!.agentId).toBe('agent-1');
      expect(run!.modelName).toBe('granite-3.3-2b');
      expect(run!.runType).toBe('model_request');
      expect(run!.status).toBe('completed');
      expect(run!.rawRequest).toBe('POST /v1/chat/completions {...}');
      expect(run!.rawResponse).toBe('{"choices": [...]}');
      expect(run!.tokensUsed).toBe(200);
    });
  });

  describe('API request logging', () => {
    test('should log API request', async () => {
      const runId = await runLogger.logApiRequest({
        workflowId: 'workflow-1',
        executionId: 'exec-1',
        status: 'completed',
        requestData: { endpoint: '/api/test' },
        responseData: { result: 'success' },
        rawRequest: 'GET /api/test HTTP/1.1',
        rawResponse: 'HTTP/1.1 200 OK {...}',
        metadata: { apiTest: true },
      });

      expect(runId).toMatch(/^api_\d+_[a-z0-9]+$/);

      const run = await runRepo.findById(runId);
      expect(run).toBeDefined();
      expect(run!.workflowId).toBe('workflow-1');
      expect(run!.runType).toBe('api_request');
      expect(run!.status).toBe('completed');
      expect(run!.rawRequest).toBe('GET /api/test HTTP/1.1');
      expect(run!.rawResponse).toBe('HTTP/1.1 200 OK {...}');
    });
  });

  describe('Run status and error management', () => {
    test('should update run status', async () => {
      const runId = await runLogger.logWorkflowExecution({
        workflowId: 'workflow-1',
        executionId: 'exec-1',
        status: 'pending',
      });

      await runLogger.updateRunStatus(runId, 'completed', { result: 'success' });

      const run = await runRepo.findById(runId);
      expect(run!.status).toBe('completed');
      expect(run!.endTime).toBeDefined();
      expect(run!.durationMs).toBeDefined();
      expect(run!.durationMs).toBeGreaterThanOrEqual(0);
    });

    test('should update run error with Error object', async () => {
      const runId = await runLogger.logAgentExecution({
        workflowId: 'workflow-1',
        agentId: 'agent-1',
        status: 'running',
      });

      const error = new Error('Test error message');
      error.stack = 'Error stack trace';
      
      await runLogger.updateRunError(runId, error, 'TEST_ERROR');

      const run = await runRepo.findById(runId);
      expect(run!.status).toBe('failed');
      expect(run!.errorMessage).toBe('Test error message');
      expect(run!.errorStack).toBe('Error stack trace');
      expect(run!.errorCode).toBe('TEST_ERROR');
    });

    test('should update run error with string', async () => {
      const runId = await runLogger.logToolCall({
        workflowId: 'workflow-1',
        toolName: 'test-tool',
        status: 'running',
      });

      await runLogger.updateRunError(runId, 'String error message');

      const run = await runRepo.findById(runId);
      expect(run!.status).toBe('failed');
      expect(run!.errorMessage).toBe('String error message');
      expect(run!.errorStack).toBeUndefined();
    });
  });

  describe('Execution trace and analytics', () => {
    test('should get execution trace', async () => {
      const executionId = 'exec-1';
      
      // Log multiple runs for the same execution
      const workflowRunId = await runLogger.logWorkflowExecution({
        workflowId: 'workflow-1',
        executionId,
        status: 'running',
      });

      const agentRunId = await runLogger.logAgentExecution({
        workflowId: 'workflow-1',
        executionId,
        agentId: 'agent-1',
        status: 'running',
        parentRunId: workflowRunId,
      });

      const toolRunId = await runLogger.logToolCall({
        workflowId: 'workflow-1',
        executionId,
        agentId: 'agent-1',
        toolName: 'test-tool',
        status: 'completed',
        parentRunId: agentRunId,
      });

      const trace = await runLogger.getExecutionTrace(executionId);
      expect(trace).toHaveLength(3);
      
      // Verify chronological order
      const runTypes = trace.map(r => r.runType);
      expect(runTypes).toEqual(['workflow_execution', 'agent_execution', 'tool_call']);
    });

    test('should get workflow runs', async () => {
      const workflowId = 'workflow-1';
      
      await runLogger.logWorkflowExecution({
        workflowId,
        executionId: 'exec-1',
        status: 'completed',
      });

      await runLogger.logAgentExecution({
        workflowId,
        agentId: 'agent-1',
        status: 'completed',
      });

      await runLogger.logWorkflowExecution({
        workflowId: 'workflow-2',
        executionId: 'exec-2',
        status: 'completed',
      });

      const workflowRuns = await runLogger.getWorkflowRuns(workflowId);
      expect(workflowRuns).toHaveLength(2);
      expect(workflowRuns.every(r => r.workflowId === workflowId)).toBe(true);
    });

    test('should export runs with filters', async () => {
      await runLogger.logWorkflowExecution({
        workflowId: 'workflow-1',
        executionId: 'exec-1',
        status: 'completed',
      });

      await runLogger.logAgentExecution({
        workflowId: 'workflow-1',
        agentId: 'agent-1',
        status: 'failed',
      });

      const allRuns = await runLogger.exportRuns();
      expect(allRuns).toHaveLength(2);

      const completedRuns = await runLogger.exportRuns({ status: 'completed' });
      expect(completedRuns).toHaveLength(1);
      expect(completedRuns[0].runType).toBe('workflow_execution');

      const failedRuns = await runLogger.exportRuns({ status: 'failed' });
      expect(failedRuns).toHaveLength(1);
      expect(failedRuns[0].runType).toBe('agent_execution');
    });
  });

  describe('Complex scenarios', () => {
    test('should handle nested execution logging', async () => {
      // Simulate a complex workflow execution with nested calls
      const workflowRunId = await runLogger.logWorkflowExecution({
        workflowId: 'complex-workflow',
        executionId: 'exec-complex',
        status: 'running',
        userPrompt: 'Complex workflow prompt',
        metadata: { complexity: 'high' },
      });

      const rootAgentRunId = await runLogger.logAgentExecution({
        workflowId: 'complex-workflow',
        executionId: 'exec-complex',
        agentId: 'root-agent',
        status: 'running',
        systemPrompt: 'You are the root agent',
        parentRunId: workflowRunId,
      });

      const modelRunId = await runLogger.logModelRequest({
        workflowId: 'complex-workflow',
        executionId: 'exec-complex',
        agentId: 'root-agent',
        modelName: 'granite',
        status: 'completed',
        rawRequest: 'Model request',
        rawResponse: 'Model response',
        tokensUsed: 100,
        parentRunId: rootAgentRunId,
      });

      const toolRunId = await runLogger.logToolCall({
        workflowId: 'complex-workflow',
        executionId: 'exec-complex',
        agentId: 'root-agent',
        toolName: 'sub-agent',
        status: 'running',
        parentRunId: rootAgentRunId,
      });

      const subAgentRunId = await runLogger.logAgentExecution({
        workflowId: 'complex-workflow',
        executionId: 'exec-complex',
        agentId: 'sub-agent',
        status: 'completed',
        parentRunId: toolRunId,
      });

      // Verify the entire execution trace
      const trace = await runLogger.getExecutionTrace('exec-complex');
      expect(trace).toHaveLength(5);

      // Verify parent-child relationships
      const workflowRun = trace.find(r => r.id === workflowRunId);
      const rootAgentRun = trace.find(r => r.id === rootAgentRunId);
      const modelRun = trace.find(r => r.id === modelRunId);
      const toolRun = trace.find(r => r.id === toolRunId);
      const subAgentRun = trace.find(r => r.id === subAgentRunId);

      expect(workflowRun!.parentRunId).toBeUndefined();
      expect(rootAgentRun!.parentRunId).toBe(workflowRunId);
      expect(modelRun!.parentRunId).toBe(rootAgentRunId);
      expect(toolRun!.parentRunId).toBe(rootAgentRunId);
      expect(subAgentRun!.parentRunId).toBe(toolRunId);
    });

    test('should handle concurrent logging', async () => {
      const promises: Promise<string>[] = [];

      // Simulate concurrent logging
      for (let i = 0; i < 10; i++) {
        promises.push(
          runLogger.logAgentExecution({
            workflowId: 'concurrent-workflow',
            agentId: `agent-${i}`,
            status: 'completed',
            tokensUsed: i * 10,
          })
        );
      }

      const runIds = await Promise.all(promises);
      expect(runIds).toHaveLength(10);
      expect(new Set(runIds).size).toBe(10); // All unique

      const runs = await runLogger.getWorkflowRuns('concurrent-workflow');
      expect(runs).toHaveLength(10);
    });
  });
});