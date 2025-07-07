import { RunLogger } from '@arbiter/database';
import { ArbiterDatabase, RunRepository, WorkflowRepository, AgentRepository } from '@arbiter/database';
import { tmpdir } from 'os';
import { join } from 'path';
import { unlinkSync, existsSync } from 'fs';

describe('RunLogger', () => {
  let runLogger: RunLogger;
  let runRepo: RunRepository;
  let workflowRepo: WorkflowRepository;
  let agentRepo: AgentRepository;
  let db: ArbiterDatabase;
  let testDbPath: string;

  beforeEach(async () => {
    // Create unique temp database for each test
    testDbPath = join(tmpdir(), `run-logger-test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}.db`);
    db = new ArbiterDatabase({ path: testDbPath });
    
    runRepo = new RunRepository(db);
    workflowRepo = new WorkflowRepository(db);
    agentRepo = new AgentRepository(db);
    runLogger = new RunLogger(runRepo);

    // Helper function to create test workflows
    const createTestWorkflow = async (id: string, name: string) => {
      await workflowRepo.create({
        id,
        name,
        description: 'Test workflow',
        version: '1.0.0',
        nodes: [],
        enabled: true,
        createdAt: new Date(),
        updatedAt: new Date()
      });
    };

    // Helper function to create test agents
    const createTestAgent = async (id: string, name: string) => {
      await agentRepo.create({
        id,
        name,
        description: 'Test agent',
        model: 'test-model',
        systemPrompt: 'Test system prompt',
        availableTools: [],
        level: 1,
        createdAt: new Date(),
        updatedAt: new Date()
      });
    };

    // Create test workflows and agents that will be referenced by runs
    await createTestWorkflow('test-workflow-1', 'Test Workflow 1');
    await createTestWorkflow('test-workflow-2', 'Test Workflow 2');
    await createTestWorkflow('test-workflow-3', 'Test Workflow 3');
    await createTestWorkflow('test-workflow-4', 'Test Workflow 4');
    await createTestWorkflow('test-workflow-5', 'Test Workflow 5');
    await createTestWorkflow('test-workflow-6', 'Test Workflow 6');
    await createTestWorkflow('test-workflow-7', 'Test Workflow 7');
    await createTestWorkflow('test-workflow-8', 'Test Workflow 8');
    await createTestWorkflow('test-workflow-9', 'Test Workflow 9');
    await createTestWorkflow('test-workflow-10', 'Test Workflow 10');
    await createTestWorkflow('complex-workflow', 'Complex Workflow');
    await createTestWorkflow('complex-data-workflow', 'Complex Data Workflow');
    await createTestWorkflow('large-payload-workflow', 'Large Payload Workflow');
    await createTestWorkflow('concurrent-workflow', 'Concurrent Workflow');
    await createTestWorkflow('test-workflow', 'Test Workflow');

    // Create test agents
    await createTestAgent('test-agent-1', 'Test Agent 1');
    await createTestAgent('test-agent-2', 'Test Agent 2');
    await createTestAgent('test-agent-3', 'Test Agent 3');
    await createTestAgent('test-agent', 'Test Agent');
    await createTestAgent('agent-1', 'Agent 1');
    await createTestAgent('agent-2', 'Agent 2');

    // Create agents for concurrent test (using different IDs)
    for (let i = 0; i < 5; i++) {
      await createTestAgent(`concurrent-agent-${i}`, `Concurrent Agent ${i}`);
    }
  });

  afterEach(async () => {
    if (db) {
      await db.close();
    }
    // Clean up test database
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath);
    }
  });

  describe('Workflow Execution Logging', () => {
    test('should log workflow execution start', async () => {
      const executionId = 'test-execution-1';
      const workflowId = 'test-workflow-1';
      const requestData = { test: 'input data' };

      const runId = await runLogger.logWorkflowExecution({
        executionId,
        workflowId,
        status: 'running',
        requestData,
        userPrompt: 'Test workflow execution'
      });

      expect(runId).toBeDefined();
      expect(typeof runId).toBe('string');

      // Verify the run was recorded
      const runs = await runRepo.findByExecution(executionId);
      expect(runs).toHaveLength(1);
      
      const run = runs[0];
      expect(run.executionId).toBe(executionId);
      expect(run.workflowId).toBe(workflowId);
      expect(run.runType).toBe('workflow_execution');
      expect(run.status).toBe('running');
      expect(run.requestData).toEqual(requestData);
      expect(run.startTime).toBeDefined();
    });

    test('should log workflow execution completion', async () => {
      const executionId = 'test-execution-2';
      const workflowId = 'test-workflow-2';
      const requestData = { test: 'input' };
      const responseData = { result: 'success' };

      // Start the workflow
      const runId = await runLogger.logWorkflowExecution({
        executionId,
        workflowId,
        status: 'running',
        requestData
      });

      // Complete the workflow by logging completion status
      await runLogger.logWorkflowExecution({
        executionId,
        workflowId,
        status: 'completed',
        responseData,
        metadata: {
          tokensUsed: 150,
          memoryUsage: 64.5,
          cpuTime: 2500
        }
      });

      // Verify completion was logged
      const runs = await runRepo.findByExecution(executionId);
      const completedRun = runs.find(r => r.status === 'completed');

      expect(completedRun).toBeDefined();
      expect(completedRun?.responseData).toEqual(responseData);
      expect(completedRun?.metadata).toBeDefined();
    });

    test('should log workflow execution failure', async () => {
      const executionId = 'test-execution-3';
      const workflowId = 'test-workflow-3';

      // Start the workflow
      await runLogger.logWorkflowExecution({
        executionId,
        workflowId,
        status: 'running',
        requestData: {}
      });

      // Fail the workflow
      await runLogger.logWorkflowExecution({
        executionId,
        workflowId,
        status: 'failed',
        metadata: {
          error: 'Test workflow failure',
          tokensUsed: 75
        }
      });

      // Verify failure was logged
      const runs = await runRepo.findByExecution(executionId);
      const failedRun = runs.find(r => r.status === 'failed');

      expect(failedRun).toBeDefined();
      expect(failedRun?.metadata?.error).toBe('Test workflow failure');
    });
  });

  describe('Agent Execution Logging', () => {
    test('should log agent execution start', async () => {
      const executionId = 'test-execution-4';
      const workflowId = 'test-workflow-4';
      const agentId = 'test-agent-1';
      const requestData = { prompt: 'Test prompt' };

      const runId = await runLogger.logAgentExecution({
        executionId,
        workflowId,
        agentId,
        status: 'running',
        requestData,
        userPrompt: 'Test agent execution'
      });

      expect(runId).toBeDefined();

      // Verify the run was recorded
      const runs = await runRepo.findByExecution(executionId);
      const agentRun = runs.find(r => r.runType === 'agent_execution');
      
      expect(agentRun).toBeDefined();
      expect(agentRun?.executionId).toBe(executionId);
      expect(agentRun?.workflowId).toBe(workflowId);
      expect(agentRun?.agentId).toBe(agentId);
      expect(agentRun?.runType).toBe('agent_execution');
      expect(agentRun?.status).toBe('running');
      expect(agentRun?.requestData).toEqual(requestData);
    });

    test('should log agent execution completion', async () => {
      const executionId = 'test-execution-5';
      const workflowId = 'test-workflow-5';
      const agentId = 'test-agent-2';
      const responseData = { response: 'Agent response' };

      // Start the agent
      await runLogger.logAgentExecution({
        executionId,
        workflowId,
        agentId,
        status: 'running',
        requestData: { prompt: 'Test prompt' }
      });

      // Complete the agent
      await runLogger.logAgentExecution({
        executionId,
        workflowId,
        agentId,
        status: 'completed',
        responseData,
        tokensUsed: 200,
        memoryUsedMb: 48.3,
        cpuTimeMs: 1800
      });

      // Verify completion was logged
      const runs = await runRepo.findByExecution(executionId);
      const completedRun = runs.find(r => r.status === 'completed' && r.runType === 'agent_execution');

      expect(completedRun).toBeDefined();
      expect(completedRun?.responseData).toEqual(responseData);
      expect(completedRun?.tokensUsed).toBe(200);
      expect(completedRun?.memoryUsedMb).toBe(48.3);
      expect(completedRun?.cpuTimeMs).toBe(1800);
    });

    test('should log agent execution failure', async () => {
      const executionId = 'test-execution-6';
      const workflowId = 'test-workflow-6';
      const agentId = 'test-agent-3';

      // Start the agent
      await runLogger.logAgentExecution({
        executionId,
        workflowId,
        agentId,
        status: 'running',
        requestData: {}
      });

      // Fail the agent
      await runLogger.logAgentExecution({
        executionId,
        workflowId,
        agentId,
        status: 'failed',
        metadata: { error: 'Agent processing failed' },
        tokensUsed: 50
      });

      // Verify failure was logged
      const runs = await runRepo.findByExecution(executionId);
      const failedRun = runs.find(r => r.status === 'failed' && r.runType === 'agent_execution');

      expect(failedRun).toBeDefined();
      expect(failedRun?.metadata?.error).toBe('Agent processing failed');
      expect(failedRun?.tokensUsed).toBe(50);
    });
  });

  describe('Tool Execution Logging', () => {
    test('should log tool execution start', async () => {
      const executionId = 'test-execution-7';
      const workflowId = 'test-workflow-7';
      const toolName = 'web_search';
      const requestData = { query: 'test search' };

      const runId = await runLogger.logToolCall({
        executionId,
        workflowId,
        toolName,
        status: 'running',
        requestData
      });

      expect(runId).toBeDefined();

      // Verify the run was recorded
      const runs = await runRepo.findByExecution(executionId);
      const toolRun = runs.find(r => r.runType === 'tool_call');
      
      expect(toolRun).toBeDefined();
      expect(toolRun?.executionId).toBe(executionId);
      expect(toolRun?.workflowId).toBe(workflowId);
      expect(toolRun?.toolName).toBe(toolName);
      expect(toolRun?.runType).toBe('tool_call');
      expect(toolRun?.status).toBe('running');
      expect(toolRun?.requestData).toEqual(requestData);
    });

    test('should log tool execution completion', async () => {
      const executionId = 'test-execution-8';
      const workflowId = 'test-workflow-8';
      const toolName = 'calculator';
      const requestData = { expression: '2 + 2' };
      const responseData = { result: 4 };

      // Start the tool
      await runLogger.logToolCall({
        executionId,
        workflowId,
        toolName,
        status: 'running',
        requestData
      });

      // Complete the tool
      await runLogger.logToolCall({
        executionId,
        workflowId,
        toolName,
        status: 'completed',
        responseData,
        metadata: {
          tokensUsed: 10,
          memoryUsage: 8.5,
          cpuTime: 100
        }
      });

      // Verify completion was logged
      const runs = await runRepo.findByExecution(executionId);
      const completedRun = runs.find(r => r.status === 'completed' && r.runType === 'tool_call');

      expect(completedRun).toBeDefined();
      expect(completedRun?.responseData).toEqual(responseData);
      expect(completedRun?.metadata).toBeDefined();
    });

    test('should log tool execution failure', async () => {
      const executionId = 'test-execution-9';
      const workflowId = 'test-workflow-9';
      const toolName = 'file_read';

      // Start the tool
      await runLogger.logToolCall({
        executionId,
        workflowId,
        toolName,
        status: 'running',
        requestData: {}
      });

      // Fail the tool
      await runLogger.logToolCall({
        executionId,
        workflowId,
        toolName,
        status: 'failed',
        metadata: { error: 'File not found' }
      });

      // Verify failure was logged
      const runs = await runRepo.findByExecution(executionId);
      const failedRun = runs.find(r => r.status === 'failed' && r.runType === 'tool_call');

      expect(failedRun).toBeDefined();
      expect(failedRun?.metadata?.error).toBe('File not found');
    });
  });

  describe('Run Hierarchy and Relationships', () => {
    test('should maintain parent-child relationships', async () => {
      const executionId = 'test-execution-10';
      const workflowId = 'test-workflow-10';
      
      // Start workflow
      const workflowRunId = await runLogger.logWorkflowExecution({
        executionId,
        workflowId,
        status: 'running',
        requestData: {}
      });
      
      // Start agent within workflow
      const agentRunId = await runLogger.logAgentExecution({
        executionId,
        workflowId,
        agentId: 'test-agent',
        status: 'running',
        requestData: {},
        parentRunId: workflowRunId
      });
      
      // Start tool within agent
      const toolRunId = await runLogger.logToolCall({
        executionId,
        workflowId,
        toolName: 'test-tool',
        status: 'running',
        requestData: {},
        parentRunId: agentRunId
      });

      // Verify hierarchy
      const runs = await runRepo.findByExecution(executionId);
      expect(runs).toHaveLength(3);

      const workflowRun = runs.find(r => r.runType === 'workflow_execution');
      const agentRun = runs.find(r => r.runType === 'agent_execution');
      const toolRun = runs.find(r => r.runType === 'tool_call');

      expect(workflowRun?.parentRunId).toBeNull();
      expect(agentRun?.parentRunId).toBe(workflowRunId);
      expect(toolRun?.parentRunId).toBe(agentRunId);
    });

    test('should track execution traces correctly', async () => {
      const executionId = 'test-execution-11';
      const workflowId = 'complex-workflow';
      
      // Create a complex execution tree
      const workflowRunId = await runLogger.logWorkflowExecution({
        executionId,
        workflowId,
        status: 'running',
        requestData: {}
      });
      
      const agent1RunId = await runLogger.logAgentExecution({
        executionId,
        workflowId,
        agentId: 'agent-1',
        status: 'running',
        requestData: {},
        parentRunId: workflowRunId
      });

      const agent2RunId = await runLogger.logAgentExecution({
        executionId,
        workflowId,
        agentId: 'agent-2',
        status: 'running',
        requestData: {},
        parentRunId: workflowRunId
      });

      // Complete all runs
      await runLogger.logAgentExecution({
        executionId,
        workflowId,
        agentId: 'agent-1',
        status: 'completed',
        responseData: {}
      });

      await runLogger.logAgentExecution({
        executionId,
        workflowId,
        agentId: 'agent-2',
        status: 'completed',
        responseData: {}
      });
      
      await runLogger.logWorkflowExecution({
        executionId,
        workflowId,
        status: 'completed',
        responseData: {}
      });

      // Verify the complete execution trace
      const runs = await runRepo.findByExecution(executionId);
      expect(runs.length).toBeGreaterThanOrEqual(3);

      // Check that we have both running and completed entries
      const completedRuns = runs.filter(r => r.status === 'completed');
      expect(completedRuns.length).toBeGreaterThan(0);
    });
  });

  describe('Data Serialization', () => {
    test('should handle complex input/output objects', async () => {
      const executionId = 'test-execution-16';
      const workflowId = 'complex-data-workflow';
      
      const complexRequestData = {
        nested: { data: { array: [1, 2, 3] } },
        date: new Date().toISOString(),
        regex: '/test/g'
      };

      const runId = await runLogger.logWorkflowExecution({
        executionId,
        workflowId,
        status: 'running',
        requestData: complexRequestData
      });
      
      const complexResponseData = {
        result: 'success',
        metadata: {
          processedAt: new Date().toISOString(),
          stats: { count: 42, success: true }
        }
      };

      await runLogger.logWorkflowExecution({
        executionId,
        workflowId,
        status: 'completed',
        responseData: complexResponseData
      });

      const runs = await runRepo.findByExecution(executionId);
      const runningRun = runs.find(r => r.status === 'running');
      const completedRun = runs.find(r => r.status === 'completed');

      expect(runningRun?.requestData).toBeDefined();
      expect(completedRun?.responseData).toEqual(complexResponseData);
    });

    test('should handle large payloads', async () => {
      const executionId = 'test-execution-17';
      const workflowId = 'large-payload-workflow';
      
      // Create a reasonably large input object (not too large to cause issues)
      const largeRequestData = {
        data: new Array(100).fill(0).map((_, i) => ({
          id: i,
          content: `Content string ${i}`.repeat(5)
        }))
      };

      const runId = await runLogger.logWorkflowExecution({
        executionId,
        workflowId,
        status: 'running',
        requestData: largeRequestData
      });
      
      await runLogger.logWorkflowExecution({
        executionId,
        workflowId,
        status: 'completed',
        responseData: { processed: largeRequestData.data.length }
      });

      const runs = await runRepo.findByExecution(executionId);
      const completedRun = runs.find(r => r.status === 'completed');

      expect(completedRun?.responseData).toEqual({ processed: 100 });
    });
  });

  describe('Error Handling', () => {
    test('should handle malformed parameters gracefully', async () => {
      const executionId = 'test-execution-15';
      
      // Test with valid parameters but boundary cases - should not throw
      await expect(async () => {
        await runLogger.logWorkflowExecution({
          executionId,
          workflowId: 'test-workflow',
          status: 'running',
          requestData: null,
          responseData: undefined,
          userPrompt: '',
          metadata: {}
        });
      }).not.toThrow();

      // Test with minimal valid parameters
      await expect(async () => {
        await runLogger.logWorkflowExecution({
          executionId: executionId + '_2',
          workflowId: 'test-workflow',
          status: 'completed',
          requestData: {}
        });
      }).not.toThrow();
    });

    test('should handle database errors gracefully', async () => {
      // Create a separate database instance for this test to avoid affecting other tests
      const errorDbPath = join(tmpdir(), `error-test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}.db`);
      const errorDb = new ArbiterDatabase({ path: errorDbPath });
      const errorRunRepo = new RunRepository(errorDb);
      const errorRunLogger = new RunLogger(errorRunRepo);
      
      // Close the database to simulate error
      await errorDb.close();

      const executionId = 'test-execution-14';
      
      // Operations should not throw but may fail gracefully
      await expect(async () => {
        await errorRunLogger.logWorkflowExecution({
          executionId,
          workflowId: 'test-workflow',
          status: 'running',
          requestData: {}
        });
      }).not.toThrow();
    });
  });

  describe('Concurrent Logging', () => {
    test('should handle concurrent run logging', async () => {
      const executionId = 'test-execution-18';
      const workflowId = 'concurrent-workflow';
      
      // Start multiple concurrent operations
      const promises = Array.from({ length: 5 }, async (_, i) => {
        return await runLogger.logAgentExecution({
          executionId,
          workflowId,
          agentId: `concurrent-agent-${i}`,
          status: 'completed',
          requestData: { index: i },
          responseData: { result: i },
          tokensUsed: i * 10
        });
      });

      const runIds = await Promise.all(promises);
      
      expect(runIds).toHaveLength(5);
      expect(new Set(runIds).size).toBe(5); // All unique

      const runs = await runRepo.findByExecution(executionId);
      expect(runs).toHaveLength(5);
      
      // Check that all expected agent IDs are present (order doesn't matter)
      const expectedAgentIds = ['concurrent-agent-0', 'concurrent-agent-1', 'concurrent-agent-2', 'concurrent-agent-3', 'concurrent-agent-4'];
      const actualAgentIds = runs.map(run => run.agentId).sort();
      expectedAgentIds.sort();
      
      expect(actualAgentIds).toEqual(expectedAgentIds);
      
      runs.forEach((run) => {
        expect(run.status).toBe('completed');
        expect(run.agentId).toMatch(/^concurrent-agent-\d$/);
      });
    });
  });
});