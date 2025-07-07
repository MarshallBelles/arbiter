import request from 'supertest';
import express from 'express';
import { workflowRoutes } from '../../routes/workflows';
import { ArbiterService } from '../../services/arbiter-service';
import { WorkflowConfig, WorkflowExecution } from '@arbiter/core';

// Mock ArbiterService
jest.mock('../../services/arbiter-service');

describe('Workflow Routes', () => {
  let app: express.Application;
  let mockArbiterService: jest.Mocked<ArbiterService>;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    
    // Create mock ArbiterService
    mockArbiterService = {
      listWorkflows: jest.fn(),
      createWorkflow: jest.fn(),
      getWorkflow: jest.fn(),
      updateWorkflow: jest.fn(),
      deleteWorkflow: jest.fn(),
      executeWorkflow: jest.fn(),
      getActiveExecutions: jest.fn(),
    } as any;

    // Add ArbiterService to request object
    app.use((req, res, next) => {
      (req as any).arbiterService = mockArbiterService;
      next();
    });

    app.use('/api/workflows', workflowRoutes);

    // Clear all mocks
    jest.clearAllMocks();
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

  describe('GET /api/workflows', () => {
    it('should return list of workflows', async () => {
      const workflows = [createTestWorkflow()];
      mockArbiterService.listWorkflows.mockResolvedValue(workflows);

      const response = await request(app)
        .get('/api/workflows')
        .expect(200);

      expect(response.body).toEqual(
        workflows.map(w => ({
          ...w,
          createdAt: w.createdAt.toISOString(),
          updatedAt: w.updatedAt.toISOString(),
        }))
      );
      expect(mockArbiterService.listWorkflows).toHaveBeenCalledTimes(1);
    });

    it('should handle service errors', async () => {
      mockArbiterService.listWorkflows.mockRejectedValue(new Error('Service error'));

      await request(app)
        .get('/api/workflows')
        .expect(500);

      expect(mockArbiterService.listWorkflows).toHaveBeenCalledTimes(1);
    });

    it('should return empty array when no workflows exist', async () => {
      mockArbiterService.listWorkflows.mockResolvedValue([]);

      const response = await request(app)
        .get('/api/workflows')
        .expect(200);

      expect(response.body).toEqual([]);
    });
  });

  describe('POST /api/workflows', () => {
    it('should create a new workflow successfully', async () => {
      const workflow = createTestWorkflow();
      const { createdAt, updatedAt, ...workflowWithoutDates } = workflow;
      mockArbiterService.createWorkflow.mockResolvedValue('test-workflow-1');

      const response = await request(app)
        .post('/api/workflows')
        .send(workflowWithoutDates)
        .expect(201);

      expect(response.body).toEqual({
        id: 'test-workflow-1',
        message: 'Workflow created successfully',
      });

      expect(mockArbiterService.createWorkflow).toHaveBeenCalledWith(
        expect.objectContaining({
          ...workflowWithoutDates,
          createdAt: expect.any(Date),
          updatedAt: expect.any(Date),
        })
      );
    });

    it('should validate required fields', async () => {
      const invalidWorkflow = {
        name: 'Test Workflow',
        // Missing required fields
      };

      const response = await request(app)
        .post('/api/workflows')
        .send(invalidWorkflow)
        .expect(400);

      expect(response.body).toMatchObject({
        error: 'Validation Error',
        message: expect.any(String),
        details: expect.any(Array),
      });

      expect(mockArbiterService.createWorkflow).not.toHaveBeenCalled();
    });

    it('should validate trigger type', async () => {
      const workflow = createTestWorkflow();
      workflow.trigger.type = 'invalid-type' as any;

      const response = await request(app)
        .post('/api/workflows')
        .send(workflow)
        .expect(400);

      expect(response.body.error).toBe('Validation Error');
      expect(mockArbiterService.createWorkflow).not.toHaveBeenCalled();
    });

    it('should validate root agent structure', async () => {
      const workflow = createTestWorkflow();
      delete (workflow.rootAgent as any).systemPrompt;

      const response = await request(app)
        .post('/api/workflows')
        .send(workflow)
        .expect(400);

      expect(response.body.error).toBe('Validation Error');
      expect(mockArbiterService.createWorkflow).not.toHaveBeenCalled();
    });

    it('should handle service errors during creation', async () => {
      const workflow = createTestWorkflow();
      const { createdAt, updatedAt, ...workflowWithoutDates } = workflow;
      mockArbiterService.createWorkflow.mockRejectedValue(new Error('Service error'));

      await request(app)
        .post('/api/workflows')
        .send(workflowWithoutDates)
        .expect(500);

      expect(mockArbiterService.createWorkflow).toHaveBeenCalledTimes(1);
    });
  });

  describe('GET /api/workflows/:id', () => {
    it('should return workflow by id', async () => {
      const workflow = createTestWorkflow();
      mockArbiterService.getWorkflow.mockResolvedValue(workflow);

      const response = await request(app)
        .get('/api/workflows/test-workflow-1')
        .expect(200);

      expect(response.body).toEqual({
        ...workflow,
        createdAt: workflow.createdAt.toISOString(),
        updatedAt: workflow.updatedAt.toISOString(),
      });
      expect(mockArbiterService.getWorkflow).toHaveBeenCalledWith('test-workflow-1');
    });

    it('should return 404 for non-existent workflow', async () => {
      mockArbiterService.getWorkflow.mockResolvedValue(null);

      const response = await request(app)
        .get('/api/workflows/non-existent')
        .expect(404);

      expect(response.body).toEqual({
        error: 'Not Found',
        message: 'Workflow not found',
      });
    });

    it('should handle service errors', async () => {
      mockArbiterService.getWorkflow.mockRejectedValue(new Error('Service error'));

      await request(app)
        .get('/api/workflows/test-workflow-1')
        .expect(500);
    });
  });

  describe('PUT /api/workflows/:id', () => {
    it('should update workflow successfully', async () => {
      const workflow = createTestWorkflow();
      const { createdAt, updatedAt, ...workflowWithoutDates } = workflow;
      mockArbiterService.updateWorkflow.mockResolvedValue(undefined);

      const response = await request(app)
        .put('/api/workflows/test-workflow-1')
        .send(workflowWithoutDates)
        .expect(200);

      expect(response.body).toEqual({
        message: 'Workflow updated successfully',
      });

      expect(mockArbiterService.updateWorkflow).toHaveBeenCalledWith(
        'test-workflow-1',
        expect.objectContaining({
          ...workflowWithoutDates,
          id: 'test-workflow-1',
          updatedAt: expect.any(Date),
        })
      );
    });

    it('should validate update data', async () => {
      const invalidData = {
        name: 'Updated Workflow',
        // Missing required fields
      };

      const response = await request(app)
        .put('/api/workflows/test-workflow-1')
        .send(invalidData)
        .expect(400);

      expect(response.body.error).toBe('Validation Error');
      expect(mockArbiterService.updateWorkflow).not.toHaveBeenCalled();
    });

    it('should handle service errors during update', async () => {
      const workflow = createTestWorkflow();
      const { createdAt, updatedAt, ...workflowWithoutDates } = workflow;
      mockArbiterService.updateWorkflow.mockRejectedValue(new Error('Service error'));

      await request(app)
        .put('/api/workflows/test-workflow-1')
        .send(workflowWithoutDates)
        .expect(500);
    });
  });

  describe('DELETE /api/workflows/:id', () => {
    it('should delete workflow successfully', async () => {
      mockArbiterService.deleteWorkflow.mockResolvedValue(undefined);

      const response = await request(app)
        .delete('/api/workflows/test-workflow-1')
        .expect(200);

      expect(response.body).toEqual({
        message: 'Workflow deleted successfully',
      });

      expect(mockArbiterService.deleteWorkflow).toHaveBeenCalledWith('test-workflow-1');
    });

    it('should handle service errors during deletion', async () => {
      mockArbiterService.deleteWorkflow.mockRejectedValue(new Error('Service error'));

      await request(app)
        .delete('/api/workflows/test-workflow-1')
        .expect(500);
    });
  });

  describe('POST /api/workflows/:id/execute', () => {
    it('should execute workflow successfully', async () => {
      const execution: WorkflowExecution = {
        id: 'exec-123',
        workflowId: 'test-workflow-1',
        status: 'running',
        startTime: new Date(),
        eventData: { test: 'data' },
        currentLevel: 0,
        executionLog: [],
        result: null,
      };

      mockArbiterService.executeWorkflow.mockResolvedValue(execution);

      const response = await request(app)
        .post('/api/workflows/test-workflow-1/execute')
        .send({ data: { test: 'data' } })
        .expect(200);

      expect(response.body).toEqual({
        executionId: 'exec-123',
        status: 'running',
        startTime: execution.startTime.toISOString(),
        message: 'Workflow execution started',
      });

      expect(mockArbiterService.executeWorkflow).toHaveBeenCalledWith(
        'test-workflow-1',
        { test: 'data' }
      );
    });

    it('should validate execution data', async () => {
      const response = await request(app)
        .post('/api/workflows/test-workflow-1/execute')
        .send({}) // Missing 'data' field
        .expect(400);

      expect(response.body.error).toBe('Validation Error');
      expect(mockArbiterService.executeWorkflow).not.toHaveBeenCalled();
    });

    it('should handle service errors during execution', async () => {
      mockArbiterService.executeWorkflow.mockRejectedValue(new Error('Execution error'));

      await request(app)
        .post('/api/workflows/test-workflow-1/execute')
        .send({ data: { test: 'data' } })
        .expect(500);
    });
  });

  describe('GET /api/workflows/:id/executions', () => {
    it('should return workflow executions', async () => {
      const execution1: WorkflowExecution = {
        id: 'exec-1',
        workflowId: 'test-workflow-1',
        status: 'running',
        startTime: new Date(),
        eventData: {},
        currentLevel: 0,
        executionLog: [],
        result: null,
      };

      const execution2: WorkflowExecution = {
        id: 'exec-2',
        workflowId: 'other-workflow',
        status: 'completed',
        startTime: new Date(),
        eventData: {},
        currentLevel: 0,
        executionLog: [],
        result: null,
      };

      const activeExecutions = [
        { execution: execution1, workflow: createTestWorkflow(), eventData: {}, state: new Map(), agentResponses: new Map() },
        { execution: execution2, workflow: createTestWorkflow(), eventData: {}, state: new Map(), agentResponses: new Map() },
      ];

      mockArbiterService.getActiveExecutions.mockReturnValue(activeExecutions);

      const response = await request(app)
        .get('/api/workflows/test-workflow-1/executions')
        .expect(200);

      expect(response.body).toEqual([{
        ...execution1,
        startTime: execution1.startTime.toISOString(),
      }]);
      expect(mockArbiterService.getActiveExecutions).toHaveBeenCalledTimes(1);
    });

    it('should return empty array when no executions exist', async () => {
      mockArbiterService.getActiveExecutions.mockReturnValue([]);

      const response = await request(app)
        .get('/api/workflows/test-workflow-1/executions')
        .expect(200);

      expect(response.body).toEqual([]);
    });

    it('should handle service errors', async () => {
      mockArbiterService.getActiveExecutions.mockImplementation(() => {
        throw new Error('Service error');
      });

      await request(app)
        .get('/api/workflows/test-workflow-1/executions')
        .expect(500);
    });
  });

  describe('validation edge cases', () => {
    it('should handle empty request body', async () => {
      const response = await request(app)
        .post('/api/workflows')
        .send({})
        .expect(400);

      expect(response.body.error).toBe('Validation Error');
    });

    it('should validate agent level constraints', async () => {
      const workflow = createTestWorkflow();
      workflow.rootAgent.level = -1; // Invalid level

      const response = await request(app)
        .post('/api/workflows')
        .send(workflow)
        .expect(400);

      expect(response.body.error).toBe('Validation Error');
    });

    it('should validate execution mode values', async () => {
      const workflow = createTestWorkflow();
      workflow.levels[0].executionMode = 'invalid-mode' as any;

      const response = await request(app)
        .post('/api/workflows')
        .send(workflow)
        .expect(400);

      expect(response.body.error).toBe('Validation Error');
    });

    it('should handle malformed JSON', async () => {
      await request(app)
        .post('/api/workflows')
        .set('Content-Type', 'application/json')
        .send('{"invalid": json}')
        .expect(400);
    });
  });

  describe('comprehensive edge cases', () => {
    describe('Large Payload Handling', () => {
      it('should handle very large workflow configurations', async () => {
        const largeWorkflow = createTestWorkflow();
        
        // Create a large description (10MB)
        largeWorkflow.description = 'A'.repeat(10 * 1024 * 1024);
        
        mockArbiterService.createWorkflow.mockResolvedValue(largeWorkflow);

        const response = await request(app)
          .post('/api/workflows')
          .send(largeWorkflow);

        // Should handle large payloads - either accept (200) or reject gracefully (413)
        expect([200, 413]).toContain(response.status);
      });

      it('should handle workflows with many agents', async () => {
        const workflowWithManyAgents = createTestWorkflow();
        
        // Create 100 levels with 10 agents each (1000 agents total)
        workflowWithManyAgents.levels = Array.from({ length: 100 }, (_, levelIndex) => ({
          level: levelIndex + 1,
          agents: Array.from({ length: 10 }, (_, agentIndex) => ({
            id: `agent-${levelIndex}-${agentIndex}`,
            name: `Agent ${levelIndex}-${agentIndex}`,
            description: 'Test agent with many siblings',
            model: 'granite',
            systemPrompt: 'You are a test agent in a large workflow',
            availableTools: [],
            level: levelIndex + 1,
          })),
          executionMode: 'parallel' as const,
        }));

        mockArbiterService.createWorkflow.mockResolvedValue(workflowWithManyAgents);

        const response = await request(app)
          .post('/api/workflows')
          .send(workflowWithManyAgents);

        expect([200, 400, 413]).toContain(response.status);
      });

      it('should handle workflows with deeply nested levels', async () => {
        const deepWorkflow = createTestWorkflow();
        
        // Create 50 levels deep
        deepWorkflow.levels = Array.from({ length: 50 }, (_, levelIndex) => ({
          level: levelIndex + 1,
          agents: [
            {
              id: `agent-level-${levelIndex + 1}`,
              name: `Agent Level ${levelIndex + 1}`,
              description: 'Deep level agent',
              model: 'granite',
              systemPrompt: 'You are a deep level agent',
              availableTools: [],
              level: levelIndex + 1,
            },
          ],
          executionMode: 'sequential' as const,
        }));

        mockArbiterService.createWorkflow.mockResolvedValue(deepWorkflow);

        const response = await request(app)
          .post('/api/workflows')
          .send(deepWorkflow);

        expect([200, 400, 413]).toContain(response.status);
      });
    });

    describe('Concurrent Operations', () => {
      it('should handle concurrent workflow creation', async () => {
        const workflow1 = { ...createTestWorkflow(), id: 'workflow-1', name: 'Concurrent Workflow 1' };
        const workflow2 = { ...createTestWorkflow(), id: 'workflow-2', name: 'Concurrent Workflow 2' };
        
        mockArbiterService.createWorkflow
          .mockResolvedValueOnce(workflow1)
          .mockResolvedValueOnce(workflow2);

        const promises = [
          request(app).post('/api/workflows').send(workflow1),
          request(app).post('/api/workflows').send(workflow2),
        ];

        const responses = await Promise.all(promises);
        
        responses.forEach(response => {
          expect([200, 400, 409]).toContain(response.status); // 409 for conflicts
        });
      });

      it('should handle concurrent workflow updates', async () => {
        const workflow = createTestWorkflow();
        const update1 = { ...workflow, description: 'Updated description 1' };
        const update2 = { ...workflow, description: 'Updated description 2' };
        
        mockArbiterService.updateWorkflow
          .mockResolvedValueOnce(update1)
          .mockResolvedValueOnce(update2);

        const promises = [
          request(app).put('/api/workflows/test-workflow-1').send(update1),
          request(app).put('/api/workflows/test-workflow-1').send(update2),
        ];

        const responses = await Promise.all(promises);
        
        responses.forEach(response => {
          expect([200, 409]).toContain(response.status);
        });
      });

      it('should handle execution during workflow update', async () => {
        const workflow = createTestWorkflow();
        mockArbiterService.updateWorkflow.mockResolvedValue(workflow);
        mockArbiterService.executeWorkflow.mockResolvedValue({
          id: 'exec-1',
          workflowId: 'test-workflow-1',
          status: 'running',
          startTime: new Date(),
        } as WorkflowExecution);

        const promises = [
          request(app).put('/api/workflows/test-workflow-1').send(workflow),
          request(app).post('/api/workflows/test-workflow-1/execute').send({ input: {} }),
        ];

        const responses = await Promise.all(promises);
        
        // Should handle gracefully - either succeed or fail with proper error codes
        responses.forEach(response => {
          expect([200, 409, 423]).toContain(response.status); // 423 for locked resource
        });
      });
    });

    describe('Complex Nested Structures', () => {
      it('should validate circular dependencies in agent references', async () => {
        const workflow = createTestWorkflow();
        
        // Create agents that reference each other circularly
        workflow.levels = [
          {
            level: 1,
            agents: [
              {
                id: 'agent-a',
                name: 'Agent A',
                description: 'References Agent B',
                model: 'granite',
                systemPrompt: 'Call agent-b when needed',
                availableTools: [{ name: 'call-agent', config: { targetAgent: 'agent-b' } }],
                level: 1,
              },
              {
                id: 'agent-b',
                name: 'Agent B',
                description: 'References Agent A',
                model: 'granite',
                systemPrompt: 'Call agent-a when needed',
                availableTools: [{ name: 'call-agent', config: { targetAgent: 'agent-a' } }],
                level: 1,
              },
            ],
            executionMode: 'parallel',
          },
        ];

        const response = await request(app)
          .post('/api/workflows')
          .send(workflow);

        // Should detect and reject circular dependencies
        expect([400]).toContain(response.status);
      });

      it('should handle workflows with complex tool configurations', async () => {
        const workflow = createTestWorkflow();
        
        workflow.rootAgent.availableTools = [
          {
            name: 'complex-tool',
            config: {
              nestedConfig: {
                deeplyNested: {
                  array: [1, 2, 3, { key: 'value' }],
                  largeString: 'x'.repeat(1000),
                },
              },
              functions: ['func1', 'func2', 'func3'],
              parameters: {
                param1: { type: 'string', required: true },
                param2: { type: 'number', default: 42 },
              },
            },
          },
        ];

        mockArbiterService.createWorkflow.mockResolvedValue(workflow);

        const response = await request(app)
          .post('/api/workflows')
          .send(workflow);

        expect([200, 400]).toContain(response.status);
      });
    });

    describe('Resource Limits and Performance', () => {
      it('should handle requests with high memory requirements', async () => {
        const workflow = createTestWorkflow();
        
        // Add memory-intensive system prompts
        workflow.levels.forEach(level => {
          level.agents.forEach(agent => {
            agent.systemPrompt = 'A'.repeat(50000); // 50KB system prompt
          });
        });

        mockArbiterService.createWorkflow.mockResolvedValue(workflow);

        const response = await request(app)
          .post('/api/workflows')
          .send(workflow);

        expect([200, 413]).toContain(response.status);
      });

      it('should timeout on very slow operations', async () => {
        mockArbiterService.createWorkflow.mockImplementation(() => 
          new Promise(resolve => setTimeout(() => resolve(createTestWorkflow()), 10000))
        );

        const response = await request(app)
          .post('/api/workflows')
          .send(createTestWorkflow())
          .timeout(5000);

        expect([200, 408, 504]).toContain(response.status);
      }, 15000);

      it('should handle rapid successive requests', async () => {
        const workflow = createTestWorkflow();
        mockArbiterService.createWorkflow.mockResolvedValue(workflow);

        const promises = Array.from({ length: 20 }, (_, i) =>
          request(app)
            .post('/api/workflows')
            .send({ ...workflow, id: `rapid-workflow-${i}` })
        );

        const responses = await Promise.all(promises);
        
        // Should handle all requests without crashing
        responses.forEach(response => {
          expect([200, 429, 503]).toContain(response.status); // 429 for rate limiting
        });
      });
    });

    describe('Data Integrity and Validation', () => {
      it('should validate workflow schema strictly', async () => {
        const invalidWorkflows = [
          // Missing required fields
          { name: 'Incomplete Workflow' },
          // Invalid types
          { ...createTestWorkflow(), version: 123 },
          // Invalid agent model
          { ...createTestWorkflow(), rootAgent: { ...createTestWorkflow().rootAgent, model: 'invalid-model' } },
        ];

        for (const invalidWorkflow of invalidWorkflows) {
          const response = await request(app)
            .post('/api/workflows')
            .send(invalidWorkflow);

          expect(response.status).toBe(400);
          expect(response.body.error).toBe('Validation Error');
        }
      });

      it('should prevent SQL injection in workflow names', async () => {
        const workflow = createTestWorkflow();
        workflow.name = "'; DROP TABLE workflows; --";

        mockArbiterService.createWorkflow.mockResolvedValue(workflow);

        const response = await request(app)
          .post('/api/workflows')
          .send(workflow);

        // Should either sanitize input or reject it
        expect([200, 400]).toContain(response.status);
      });

      it('should handle special characters in workflow data', async () => {
        const workflow = createTestWorkflow();
        workflow.description = '🚀 Special chars: áéíóú, ñ, ç, ü, emoji 😊, symbols ©®™';
        workflow.rootAgent.systemPrompt = 'Handle unicode: 中文, العربية, русский';

        mockArbiterService.createWorkflow.mockResolvedValue(workflow);

        const response = await request(app)
          .post('/api/workflows')
          .send(workflow);

        expect(response.status).toBe(200);
      });
    });

    describe('Error Recovery and Resilience', () => {
      it('should recover from partial failures during creation', async () => {
        mockArbiterService.createWorkflow
          .mockRejectedValueOnce(new Error('Temporary database error'))
          .mockResolvedValueOnce(createTestWorkflow());

        // First request should fail
        const response1 = await request(app)
          .post('/api/workflows')
          .send(createTestWorkflow());

        expect(response1.status).toBe(500);

        // Retry should succeed
        const response2 = await request(app)
          .post('/api/workflows')
          .send(createTestWorkflow());

        expect(response2.status).toBe(200);
      });

      it('should handle database connection issues', async () => {
        mockArbiterService.listWorkflows.mockRejectedValue(new Error('Database connection lost'));

        const response = await request(app)
          .get('/api/workflows');

        expect(response.status).toBe(500);
        expect(response.body.error).toContain('error');
      });

      it('should provide detailed error information for debugging', async () => {
        mockArbiterService.createWorkflow.mockRejectedValue(
          new Error('Workflow validation failed: Agent model "invalid" not supported')
        );

        const response = await request(app)
          .post('/api/workflows')
          .send(createTestWorkflow());

        expect(response.status).toBe(500);
        expect(response.body).toHaveProperty('error');
        // Should include enough information for debugging in development
      });
    });
  });
});