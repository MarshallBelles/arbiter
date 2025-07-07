import request from 'supertest';
import express from 'express';
import { agentRoutes } from '../../routes/agents';
import { eventRoutes } from '../../routes/events';
import { workflowRoutes } from '../../routes/workflows';
import { ArbiterService } from '../../services/arbiter-service';
import { errorHandler } from '../../middleware/error-handler';
import { AgentConfig, WorkflowConfig } from '@arbiter/core';

// Mock the ArbiterService
jest.mock('../../services/arbiter-service');

describe('API Stress Tests', () => {
  let app: express.Application;
  let mockArbiterService: jest.Mocked<ArbiterService>;

  beforeEach(() => {
    app = express();
    app.use(express.json({ limit: '10mb' })); // Match production config
    
    // Create mock ArbiterService
    mockArbiterService = {
      listAgents: jest.fn(),
      createAgent: jest.fn(),
      getAgent: jest.fn(),
      updateAgent: jest.fn(),
      deleteAgent: jest.fn(),
      executeAgent: jest.fn(),
      getEventHandlers: jest.fn(),
      enableEventHandler: jest.fn(),
      disableEventHandler: jest.fn(),
      triggerManualEvent: jest.fn(),
      getActiveExecutions: jest.fn(),
      getExecution: jest.fn(),
      cancelExecution: jest.fn(),
      listWorkflows: jest.fn(),
      createWorkflow: jest.fn(),
      getWorkflow: jest.fn(),
      updateWorkflow: jest.fn(),
      deleteWorkflow: jest.fn(),
      executeWorkflow: jest.fn(),
    } as any;

    // Add ArbiterService to request object
    app.use((req, res, next) => {
      (req as any).arbiterService = mockArbiterService;
      next();
    });

    app.use('/api/agents', agentRoutes);
    app.use('/api/events', eventRoutes);
    app.use('/api/workflows', workflowRoutes);
    app.use(errorHandler);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Concurrent Request Stress Tests', () => {
    it('should handle 50 concurrent agent creation requests without race conditions', async () => {
      const agentTemplate: AgentConfig = {
        id: 'stress-agent',
        name: 'Stress Test Agent',
        description: 'Agent for stress testing',
        model: 'granite',
        systemPrompt: 'You are a stress test agent',
        availableTools: [],
        level: 0,
      };

      mockArbiterService.createAgent.mockResolvedValue('stress-agent');

      const concurrentRequests = Array(50).fill(null).map((_, index) => 
        request(app)
          .post('/api/agents')
          .send({ ...agentTemplate, id: `stress-agent-${index}` })
      );

      const startTime = Date.now();
      const responses = await Promise.all(concurrentRequests);
      const duration = Date.now() - startTime;

      // All requests should succeed
      responses.forEach(response => {
        expect(response.status).toBe(201);
      });

      // Should complete within reasonable time (10 seconds)
      expect(duration).toBeLessThan(10000);
      
      // Service should have been called for each request
      expect(mockArbiterService.createAgent).toHaveBeenCalledTimes(50);
    }, 15000);

    it('should handle 100 concurrent agent list requests', async () => {
      const mockAgents: AgentConfig[] = Array(1000).fill(null).map((_, i) => ({
        id: `agent-${i}`,
        name: `Agent ${i}`,
        description: `Agent number ${i}`,
        model: 'granite',
        systemPrompt: 'System prompt',
        availableTools: [],
        level: 0,
      }));

      mockArbiterService.listAgents.mockResolvedValue(mockAgents);

      const concurrentRequests = Array(100).fill(null).map(() => 
        request(app).get('/api/agents')
      );

      const startTime = Date.now();
      const responses = await Promise.all(concurrentRequests);
      const duration = Date.now() - startTime;

      // All requests should succeed
      responses.forEach(response => {
        expect(response.status).toBe(200);
        expect(response.body).toHaveLength(1000);
      });

      // Should complete within reasonable time (5 seconds)
      expect(duration).toBeLessThan(5000);
      
      expect(mockArbiterService.listAgents).toHaveBeenCalledTimes(100);
    }, 10000);

    it('should handle mixed concurrent operations (CRUD) without conflicts', async () => {
      const agentTemplate: AgentConfig = {
        id: 'crud-agent',
        name: 'CRUD Test Agent',
        description: 'Agent for CRUD testing',
        model: 'granite',
        systemPrompt: 'You are a CRUD test agent',
        availableTools: [],
        level: 0,
      };

      // Setup mocks
      mockArbiterService.createAgent.mockResolvedValue('crud-agent');
      mockArbiterService.getAgent.mockResolvedValue(agentTemplate);
      mockArbiterService.updateAgent.mockResolvedValue();
      mockArbiterService.deleteAgent.mockResolvedValue();

      const operations = [];

      // Create operations
      for (let i = 0; i < 10; i++) {
        operations.push(
          request(app)
            .post('/api/agents')
            .send({ ...agentTemplate, id: `create-agent-${i}` })
        );
      }

      // Read operations
      for (let i = 0; i < 20; i++) {
        operations.push(request(app).get(`/api/agents/read-agent-${i}`));
      }

      // Update operations
      for (let i = 0; i < 10; i++) {
        operations.push(
          request(app)
            .put(`/api/agents/update-agent-${i}`)
            .send({ ...agentTemplate, id: `update-agent-${i}` })
        );
      }

      // Delete operations
      for (let i = 0; i < 10; i++) {
        operations.push(request(app).delete(`/api/agents/delete-agent-${i}`));
      }

      const startTime = Date.now();
      const responses = await Promise.all(operations);
      const duration = Date.now() - startTime;

      // Verify response counts
      const createResponses = responses.slice(0, 10);
      const readResponses = responses.slice(10, 30);
      const updateResponses = responses.slice(30, 40);
      const deleteResponses = responses.slice(40, 50);

      createResponses.forEach(response => expect(response.status).toBe(201));
      readResponses.forEach(response => expect([200, 404]).toContain(response.status));
      updateResponses.forEach(response => expect([200, 500]).toContain(response.status));
      deleteResponses.forEach(response => expect([200, 500]).toContain(response.status));

      // Should complete within reasonable time
      expect(duration).toBeLessThan(8000);
    }, 12000);
  });

  describe('Large Data Stress Tests', () => {
    it('should handle agent execution with large input data without memory issues', async () => {
      const largeInput = {
        message: 'A'.repeat(100000), // 100KB string
        data: Array(1000).fill({ key: 'value', number: 42 }),
        nested: {
          level1: {
            level2: {
              level3: Array(500).fill('nested data'),
            },
          },
        },
      };

      const mockResult = {
        reasoning: 'Processed large input successfully',
        tool_calls: [],
        next_steps: 'Complete',
        status: 'completed',
        raw_response: 'Success',
      };

      mockArbiterService.executeAgent.mockResolvedValue(mockResult);

      const response = await request(app)
        .post('/api/agents/large-data-agent/execute')
        .send({ input: largeInput });

      expect(response.status).toBe(200);
      expect(response.body.result).toEqual(mockResult);
      expect(mockArbiterService.executeAgent).toHaveBeenCalledWith(
        'large-data-agent',
        largeInput,
        undefined
      );
    });

    it('should handle multiple large workflows without performance degradation', async () => {
      const createLargeWorkflow = (id: string): WorkflowConfig => ({
        id,
        name: `Large Workflow ${id}`,
        description: 'A'.repeat(10000), // Large description
        version: '1.0.0',
        trigger: {
          type: 'manual',
          config: {},
        },
        rootAgent: {
          id: `root-${id}`,
          name: `Root Agent ${id}`,
          description: 'B'.repeat(5000),
          model: 'granite',
          systemPrompt: 'C'.repeat(20000), // Large system prompt
          availableTools: Array(100).fill(null).map((_, i) => `tool-${i}`),
          level: 0,
        },
        levels: Array(5).fill(null).map((_, levelIndex) => ({ // Reduced levels for test performance
          level: levelIndex + 1,
          agents: Array(3).fill(null).map((_, agentIndex) => ({ // Reduced agents for test performance
            id: `agent-${id}-${levelIndex}-${agentIndex}`,
            name: `Agent ${levelIndex}-${agentIndex}`,
            description: 'D'.repeat(1000), // Reduced size for faster tests
            model: 'granite',
            systemPrompt: 'E'.repeat(5000), // Reduced size for faster tests
            availableTools: Array(20).fill(null).map((_, i) => `level-tool-${i}`), // Reduced tools
            level: levelIndex + 1,
          })),
          executionMode: 'parallel' as const,
        })),
        // createdAt and updatedAt are added by the route handler, not sent in request
      });

      mockArbiterService.createWorkflow.mockImplementation(async (workflow) => workflow.id);

      const workflows = Array(5).fill(null).map((_, i) => createLargeWorkflow(`large-${i}`));
      
      const concurrentRequests = workflows.map(workflow =>
        request(app)
          .post('/api/workflows')
          .send(workflow)
      );

      const startTime = Date.now();
      const responses = await Promise.all(concurrentRequests);
      const duration = Date.now() - startTime;

      responses.forEach((response, index) => {
        if (response.status !== 201) {
          console.log(`Workflow ${index} failed:`, response.body);
        }
        expect(response.status).toBe(201);
      });

      // Should handle large data without significant delay
      expect(duration).toBeLessThan(5000);
    }, 10000);
  });

  describe('Memory Leak Detection Tests', () => {
    it('should not accumulate memory during repeated operations', async () => {
      const agentTemplate: AgentConfig = {
        id: 'memory-test-agent',
        name: 'Memory Test Agent',
        description: 'Agent for memory testing',
        model: 'granite',
        systemPrompt: 'You are a memory test agent',
        availableTools: [],
        level: 0,
      };

      mockArbiterService.createAgent.mockResolvedValue('memory-test-agent');
      mockArbiterService.getAgent.mockResolvedValue(agentTemplate);
      mockArbiterService.deleteAgent.mockResolvedValue();

      // Measure initial memory usage
      const initialMemory = process.memoryUsage();

      // Perform 1000 create/get/delete cycles
      for (let cycle = 0; cycle < 100; cycle++) { // Reduced for test performance
        const promises = [];
        
        // Create batch
        for (let i = 0; i < 10; i++) {
          promises.push(
            request(app)
              .post('/api/agents')
              .send({ ...agentTemplate, id: `memory-agent-${cycle}-${i}` })
          );
        }

        // Get batch
        for (let i = 0; i < 10; i++) {
          promises.push(request(app).get(`/api/agents/memory-agent-${cycle}-${i}`));
        }

        // Delete batch
        for (let i = 0; i < 10; i++) {
          promises.push(request(app).delete(`/api/agents/memory-agent-${cycle}-${i}`));
        }

        await Promise.all(promises);

        // Force garbage collection if available
        if (global.gc) {
          global.gc();
        }
      }

      // Measure final memory usage
      const finalMemory = process.memoryUsage();
      const memoryIncrease = finalMemory.heapUsed - initialMemory.heapUsed;

      // Memory increase should be reasonable (less than 100MB for JavaScript GC behavior)
      expect(memoryIncrease).toBeLessThan(100 * 1024 * 1024);
    }, 30000);
  });

  describe('Error Handling Under Load', () => {
    it('should maintain error handling quality under high load', async () => {
      // Mix of valid and invalid requests
      const requests = [];

      // Valid requests
      for (let i = 0; i < 25; i++) {
        requests.push(
          request(app)
            .post('/api/agents')
            .send({
              id: `valid-agent-${i}`,
              name: `Valid Agent ${i}`,
              description: 'Valid agent',
              model: 'granite',
              systemPrompt: 'Valid prompt',
              availableTools: [],
              level: 0,
            })
        );
      }

      // Invalid requests (missing required fields)
      for (let i = 0; i < 25; i++) {
        requests.push(
          request(app)
            .post('/api/agents')
            .send({ name: `Invalid Agent ${i}` }) // Missing required fields
        );
      }

      mockArbiterService.createAgent.mockResolvedValue('valid-agent');

      const responses = await Promise.all(requests);

      // Valid responses should be 201
      const validResponses = responses.slice(0, 25);
      validResponses.forEach(response => {
        expect(response.status).toBe(201);
      });

      // Invalid responses should be 400 with proper error structure
      const invalidResponses = responses.slice(25, 50);
      invalidResponses.forEach(response => {
        expect(response.status).toBe(400);
        expect(response.body).toHaveProperty('error', 'Validation Error');
        expect(response.body).toHaveProperty('message');
      });
    });

    it('should handle service failures gracefully under load', async () => {
      // Setup service to fail randomly
      mockArbiterService.getAgent.mockImplementation(() => {
        if (Math.random() < 0.3) { // 30% failure rate
          throw new Error('Random service failure');
        }
        return Promise.resolve({
          id: 'test-agent',
          name: 'Test Agent',
          description: 'Test',
          model: 'granite',
          systemPrompt: 'Test',
          availableTools: [],
          level: 0,
        });
      });

      const requests = Array(100).fill(null).map((_, i) =>
        request(app).get(`/api/agents/test-agent-${i}`)
      );

      const responses = await Promise.all(requests);

      let successCount = 0;
      let errorCount = 0;

      responses.forEach(response => {
        if (response.status === 200) {
          successCount++;
        } else if (response.status === 500) {
          errorCount++;
          expect(response.body).toHaveProperty('error');
        }
      });

      // Should have mix of success and errors
      expect(successCount).toBeGreaterThan(50);
      expect(errorCount).toBeGreaterThan(10);
      expect(successCount + errorCount).toBe(100);
    });
  });

  describe('Response Time Performance Tests', () => {
    it('should maintain response times under moderate load', async () => {
      const agentTemplate: AgentConfig = {
        id: 'perf-agent',
        name: 'Performance Agent',
        description: 'Agent for performance testing',
        model: 'granite',
        systemPrompt: 'You are a performance test agent',
        availableTools: [],
        level: 0,
      };

      mockArbiterService.getAgent.mockResolvedValue(agentTemplate);

      const measurements: number[] = [];

      // Test with moderate concurrent load
      for (let batch = 0; batch < 10; batch++) {
        const batchRequests = Array(10).fill(null).map(() => {
          const start = Date.now();
          return request(app)
            .get('/api/agents/perf-agent')
            .then(response => {
              const duration = Date.now() - start;
              measurements.push(duration);
              return response;
            });
        });

        await Promise.all(batchRequests);
      }

      // Calculate response time statistics
      const avgResponseTime = measurements.reduce((a, b) => a + b, 0) / measurements.length;
      const maxResponseTime = Math.max(...measurements);
      const p95ResponseTime = measurements.sort((a, b) => a - b)[Math.floor(measurements.length * 0.95)];

      // Performance expectations
      expect(avgResponseTime).toBeLessThan(100); // Average < 100ms
      expect(maxResponseTime).toBeLessThan(500); // Max < 500ms
      expect(p95ResponseTime).toBeLessThan(200); // 95th percentile < 200ms
    });
  });
});