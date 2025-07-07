import request from 'supertest';
import express from 'express';
import { agentRoutes } from '../agents';
import { ArbiterService } from '../../services/arbiter-service';
import { AgentConfig } from '@arbiter/core';
import { errorHandler } from '../../middleware/error-handler';

// Mock the ArbiterService
jest.mock('../../services/arbiter-service');

describe('Agent Routes', () => {
  let app: express.Application;
  let mockArbiterService: jest.Mocked<ArbiterService>;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    
    // Create mock ArbiterService
    mockArbiterService = {
      listAgents: jest.fn(),
      createAgent: jest.fn(),
      getAgent: jest.fn(),
      updateAgent: jest.fn(),
      deleteAgent: jest.fn(),
      executeAgent: jest.fn(),
    } as any;

    // Add ArbiterService to request object
    app.use((req, res, next) => {
      (req as any).arbiterService = mockArbiterService;
      next();
    });

    app.use('/api/agents', agentRoutes);
    
    // Add error handler middleware
    app.use(errorHandler);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/agents', () => {
    it('should return list of agents successfully', async () => {
      const mockAgents: AgentConfig[] = [
        {
          id: 'agent-1',
          name: 'Agent 1',
          description: 'First agent',
          model: 'granite',
          systemPrompt: 'You are agent 1',
          availableTools: [],
          level: 0,
        },
        {
          id: 'agent-2',
          name: 'Agent 2',
          description: 'Second agent',
          model: 'granite',
          systemPrompt: 'You are agent 2',
          availableTools: ['tool1'],
          level: 1,
        },
      ];

      mockArbiterService.listAgents.mockResolvedValue(mockAgents);

      const response = await request(app).get('/api/agents');

      expect(response.status).toBe(200);
      expect(response.body).toEqual(mockAgents);
      expect(mockArbiterService.listAgents).toHaveBeenCalledTimes(1);
    });

    it('should handle empty agent list', async () => {
      mockArbiterService.listAgents.mockResolvedValue([]);

      const response = await request(app).get('/api/agents');

      expect(response.status).toBe(200);
      expect(response.body).toEqual([]);
    });

    it('should handle service errors', async () => {
      mockArbiterService.listAgents.mockRejectedValue(new Error('Database connection failed'));

      const response = await request(app).get('/api/agents');

      expect(response.status).toBe(500);
      expect(response.body).toHaveProperty('error');
    });

    it('should handle null response from service', async () => {
      mockArbiterService.listAgents.mockResolvedValue(null as any);

      const response = await request(app).get('/api/agents');

      expect(response.status).toBe(200);
      expect(response.body).toBe(null);
    });
  });

  describe('POST /api/agents', () => {
    const validAgent: AgentConfig = {
      id: 'test-agent',
      name: 'Test Agent',
      description: 'A test agent',
      model: 'granite',
      systemPrompt: 'You are a test agent',
      availableTools: ['tool1', 'tool2'],
      level: 0,
    };

    it('should create agent successfully with valid data', async () => {
      mockArbiterService.createAgent.mockResolvedValue('test-agent');

      const response = await request(app)
        .post('/api/agents')
        .send(validAgent);

      expect(response.status).toBe(201);
      expect(response.body).toEqual({
        id: 'test-agent',
        message: 'Agent created successfully',
      });
      expect(mockArbiterService.createAgent).toHaveBeenCalledWith(validAgent);
    });

    it('should create agent with optional fields', async () => {
      const agentWithOptionals: AgentConfig = {
        ...validAgent,
        inputSchema: { type: 'object', properties: { input: { type: 'string' } } },
        outputSchema: { type: 'object', properties: { output: { type: 'string' } } },
        metadata: { version: '1.0.0', author: 'test' },
      };

      mockArbiterService.createAgent.mockResolvedValue('test-agent');

      const response = await request(app)
        .post('/api/agents')
        .send(agentWithOptionals);

      expect(response.status).toBe(201);
      expect(mockArbiterService.createAgent).toHaveBeenCalledWith(agentWithOptionals);
    });

    it('should reject request with missing required fields', async () => {
      const invalidAgent = {
        name: 'Test Agent',
        // Missing id, description, model, systemPrompt, availableTools, level
      };

      const response = await request(app)
        .post('/api/agents')
        .send(invalidAgent);

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error', 'Validation Error');
      expect(response.body).toHaveProperty('message');
      expect(response.body).toHaveProperty('details');
      expect(mockArbiterService.createAgent).not.toHaveBeenCalled();
    });

    it('should reject request with empty required string fields', async () => {
      const invalidAgent = {
        ...validAgent,
        id: '',
        name: '',
        description: '',
        systemPrompt: '',
      };

      const response = await request(app)
        .post('/api/agents')
        .send(invalidAgent);

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error', 'Validation Error');
    });

    it('should reject request with invalid level (negative)', async () => {
      const invalidAgent = {
        ...validAgent,
        level: -1,
      };

      const response = await request(app)
        .post('/api/agents')
        .send(invalidAgent);

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error', 'Validation Error');
      expect(response.body.message).toContain('must be greater than or equal to 0');
    });

    it('should reject request with invalid availableTools type', async () => {
      const invalidAgent = {
        ...validAgent,
        availableTools: 'not-an-array',
      };

      const response = await request(app)
        .post('/api/agents')
        .send(invalidAgent);

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error', 'Validation Error');
    });

    it('should reject request with non-string tool names', async () => {
      const invalidAgent = {
        ...validAgent,
        availableTools: ['tool1', 123, 'tool3'],
      };

      const response = await request(app)
        .post('/api/agents')
        .send(invalidAgent);

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error', 'Validation Error');
    });

    it('should handle service creation errors', async () => {
      mockArbiterService.createAgent.mockRejectedValue(new Error('Agent ID already exists'));

      const response = await request(app)
        .post('/api/agents')
        .send(validAgent);

      expect(response.status).toBe(500);
      expect(response.body).toHaveProperty('error');
    });

    it('should handle null request body', async () => {
      const response = await request(app)
        .post('/api/agents')
        .send(null);

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error', 'Validation Error');
    });

    it('should handle empty request body', async () => {
      const response = await request(app)
        .post('/api/agents')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error', 'Validation Error');
    });

    it('should handle malformed JSON in request body', async () => {
      const response = await request(app)
        .post('/api/agents')
        .set('Content-Type', 'application/json')
        .send('{ invalid json }');

      expect(response.status).toBe(400);
    });

    it('should handle extremely large request body', async () => {
      const largeAgent = {
        ...validAgent,
        description: 'A'.repeat(10000), // Very long description
        systemPrompt: 'B'.repeat(50000), // Very long system prompt
      };

      mockArbiterService.createAgent.mockResolvedValue('test-agent');

      const response = await request(app)
        .post('/api/agents')
        .send(largeAgent);

      expect(response.status).toBe(201);
    });
  });

  describe('GET /api/agents/:id', () => {
    const mockAgent: AgentConfig = {
      id: 'test-agent',
      name: 'Test Agent',
      description: 'A test agent',
      model: 'granite',
      systemPrompt: 'You are a test agent',
      availableTools: [],
      level: 0,
    };

    it('should return agent successfully when found', async () => {
      mockArbiterService.getAgent.mockResolvedValue(mockAgent);

      const response = await request(app).get('/api/agents/test-agent');

      expect(response.status).toBe(200);
      expect(response.body).toEqual(mockAgent);
      expect(mockArbiterService.getAgent).toHaveBeenCalledWith('test-agent');
    });

    it('should return 404 when agent not found', async () => {
      mockArbiterService.getAgent.mockResolvedValue(null);

      const response = await request(app).get('/api/agents/nonexistent');

      expect(response.status).toBe(404);
      expect(response.body).toEqual({
        error: 'Not Found',
        message: 'Agent not found',
      });
    });

    it('should handle service errors', async () => {
      mockArbiterService.getAgent.mockRejectedValue(new Error('Database error'));

      const response = await request(app).get('/api/agents/test-agent');

      expect(response.status).toBe(500);
      expect(response.body).toHaveProperty('error');
    });

    it('should handle special characters in agent ID', async () => {
      const specialId = 'agent@#$%^&*()';
      mockArbiterService.getAgent.mockResolvedValue(null);

      const response = await request(app).get(`/api/agents/${encodeURIComponent(specialId)}`);

      expect(response.status).toBe(404);
      expect(mockArbiterService.getAgent).toHaveBeenCalledWith(specialId);
    });

    it('should handle very long agent ID', async () => {
      const longId = 'a'.repeat(1000);
      mockArbiterService.getAgent.mockResolvedValue(null);

      const response = await request(app).get(`/api/agents/${longId}`);

      expect(response.status).toBe(404);
      expect(mockArbiterService.getAgent).toHaveBeenCalledWith(longId);
    });

    it('should handle empty agent ID', async () => {
      const response = await request(app).get('/api/agents/');

      // This should hit the list agents endpoint instead
      expect(mockArbiterService.listAgents).toHaveBeenCalled();
    });

    it('should handle undefined return from service', async () => {
      mockArbiterService.getAgent.mockResolvedValue(undefined as any);

      const response = await request(app).get('/api/agents/test-agent');

      expect(response.status).toBe(404);
    });
  });

  describe('PUT /api/agents/:id', () => {
    const validUpdateData: AgentConfig = {
      id: 'test-agent',
      name: 'Updated Agent',
      description: 'An updated test agent',
      model: 'granite',
      systemPrompt: 'You are an updated test agent',
      availableTools: ['new-tool'],
      level: 1,
    };

    it('should update agent successfully with valid data', async () => {
      mockArbiterService.updateAgent.mockResolvedValue();

      const response = await request(app)
        .put('/api/agents/test-agent')
        .send(validUpdateData);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        message: 'Agent updated successfully',
      });
      expect(mockArbiterService.updateAgent).toHaveBeenCalledWith('test-agent', {
        ...validUpdateData,
        id: 'test-agent', // Should override with URL param
      });
    });

    it('should override agent ID with URL parameter', async () => {
      const updateDataWithDifferentId = {
        ...validUpdateData,
        id: 'different-id',
      };

      mockArbiterService.updateAgent.mockResolvedValue();

      const response = await request(app)
        .put('/api/agents/test-agent')
        .send(updateDataWithDifferentId);

      expect(response.status).toBe(200);
      expect(mockArbiterService.updateAgent).toHaveBeenCalledWith('test-agent', {
        ...updateDataWithDifferentId,
        id: 'test-agent', // Should use URL param, not body
      });
    });

    it('should reject update with missing required fields', async () => {
      const invalidUpdateData = {
        name: 'Updated Agent',
        // Missing other required fields
      };

      const response = await request(app)
        .put('/api/agents/test-agent')
        .send(invalidUpdateData);

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error', 'Validation Error');
      expect(mockArbiterService.updateAgent).not.toHaveBeenCalled();
    });

    it('should reject update with invalid level', async () => {
      const invalidUpdateData = {
        ...validUpdateData,
        level: 'invalid-level',
      };

      const response = await request(app)
        .put('/api/agents/test-agent')
        .send(invalidUpdateData);

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error', 'Validation Error');
    });

    it('should handle service update errors', async () => {
      mockArbiterService.updateAgent.mockRejectedValue(new Error('Agent not found'));

      const response = await request(app)
        .put('/api/agents/test-agent')
        .send(validUpdateData);

      expect(response.status).toBe(500);
      expect(response.body).toHaveProperty('error');
    });

    it('should handle update with null body', async () => {
      const response = await request(app)
        .put('/api/agents/test-agent')
        .send(null);

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error', 'Validation Error');
    });

    it('should handle update with optional fields', async () => {
      const updateWithOptionals = {
        ...validUpdateData,
        inputSchema: { type: 'object' },
        outputSchema: { type: 'string' },
        metadata: { updated: true },
      };

      mockArbiterService.updateAgent.mockResolvedValue();

      const response = await request(app)
        .put('/api/agents/test-agent')
        .send(updateWithOptionals);

      expect(response.status).toBe(200);
      expect(mockArbiterService.updateAgent).toHaveBeenCalledWith('test-agent', {
        ...updateWithOptionals,
        id: 'test-agent',
      });
    });
  });

  describe('DELETE /api/agents/:id', () => {
    it('should delete agent successfully', async () => {
      mockArbiterService.deleteAgent.mockResolvedValue();

      const response = await request(app).delete('/api/agents/test-agent');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        message: 'Agent deleted successfully',
      });
      expect(mockArbiterService.deleteAgent).toHaveBeenCalledWith('test-agent');
    });

    it('should handle service deletion errors', async () => {
      mockArbiterService.deleteAgent.mockRejectedValue(new Error('Agent not found'));

      const response = await request(app).delete('/api/agents/test-agent');

      expect(response.status).toBe(500);
      expect(response.body).toHaveProperty('error');
    });

    it('should handle deletion of nonexistent agent', async () => {
      mockArbiterService.deleteAgent.mockRejectedValue(new Error('Agent not found'));

      const response = await request(app).delete('/api/agents/nonexistent');

      expect(response.status).toBe(500);
    });

    it('should handle special characters in agent ID for deletion', async () => {
      const specialId = 'agent@#$%^&*()';
      mockArbiterService.deleteAgent.mockResolvedValue();

      const response = await request(app).delete(`/api/agents/${encodeURIComponent(specialId)}`);

      expect(response.status).toBe(200);
      expect(mockArbiterService.deleteAgent).toHaveBeenCalledWith(specialId);
    });

    it('should handle very long agent ID for deletion', async () => {
      const longId = 'a'.repeat(1000);
      mockArbiterService.deleteAgent.mockResolvedValue();

      const response = await request(app).delete(`/api/agents/${longId}`);

      expect(response.status).toBe(200);
      expect(mockArbiterService.deleteAgent).toHaveBeenCalledWith(longId);
    });
  });

  describe('POST /api/agents/:id/execute', () => {
    const validExecuteData = {
      input: { message: 'Hello, agent!' },
      userPrompt: 'Please respond politely',
    };

    const mockExecutionResult = {
      reasoning: 'Agent processed the input successfully',
      tool_calls: [],
      next_steps: 'Response generated',
      status: 'completed',
      raw_response: 'Hello! How can I help you?',
    };

    it('should execute agent successfully with valid data', async () => {
      mockArbiterService.executeAgent.mockResolvedValue(mockExecutionResult);

      const response = await request(app)
        .post('/api/agents/test-agent/execute')
        .send(validExecuteData);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        result: mockExecutionResult,
        message: 'Agent executed successfully',
      });
      expect(mockArbiterService.executeAgent).toHaveBeenCalledWith(
        'test-agent',
        validExecuteData.input,
        validExecuteData.userPrompt
      );
    });

    it('should execute agent without userPrompt', async () => {
      const executeDataWithoutPrompt = {
        input: { message: 'Hello, agent!' },
      };

      mockArbiterService.executeAgent.mockResolvedValue(mockExecutionResult);

      const response = await request(app)
        .post('/api/agents/test-agent/execute')
        .send(executeDataWithoutPrompt);

      expect(response.status).toBe(200);
      expect(mockArbiterService.executeAgent).toHaveBeenCalledWith(
        'test-agent',
        executeDataWithoutPrompt.input,
        undefined
      );
    });

    it('should reject execution with missing input', async () => {
      const invalidExecuteData = {
        userPrompt: 'Please respond politely',
        // Missing input
      };

      const response = await request(app)
        .post('/api/agents/test-agent/execute')
        .send(invalidExecuteData);

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error', 'Validation Error');
      expect(mockArbiterService.executeAgent).not.toHaveBeenCalled();
    });

    it('should handle complex input data structures', async () => {
      const complexInput = {
        input: {
          nested: {
            array: [1, 2, 3],
            object: { key: 'value' },
            null_value: null,
            boolean: true,
          },
        },
      };

      mockArbiterService.executeAgent.mockResolvedValue(mockExecutionResult);

      const response = await request(app)
        .post('/api/agents/test-agent/execute')
        .send(complexInput);

      expect(response.status).toBe(200);
      expect(mockArbiterService.executeAgent).toHaveBeenCalledWith(
        'test-agent',
        complexInput.input,
        undefined
      );
    });

    it('should handle null input value', async () => {
      const nullInputData = {
        input: null,
      };

      mockArbiterService.executeAgent.mockResolvedValue(mockExecutionResult);

      const response = await request(app)
        .post('/api/agents/test-agent/execute')
        .send(nullInputData);

      expect(response.status).toBe(200);
      expect(mockArbiterService.executeAgent).toHaveBeenCalledWith(
        'test-agent',
        null,
        undefined
      );
    });

    it('should handle service execution errors', async () => {
      mockArbiterService.executeAgent.mockRejectedValue(new Error('Agent execution failed'));

      const response = await request(app)
        .post('/api/agents/test-agent/execute')
        .send(validExecuteData);

      expect(response.status).toBe(500);
      expect(response.body).toHaveProperty('error');
    });

    it('should handle empty request body for execution', async () => {
      const response = await request(app)
        .post('/api/agents/test-agent/execute')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error', 'Validation Error');
    });

    it('should handle execution with very long userPrompt', async () => {
      const longPromptData = {
        input: { message: 'test' },
        userPrompt: 'A'.repeat(100000), // Very long prompt
      };

      mockArbiterService.executeAgent.mockResolvedValue(mockExecutionResult);

      const response = await request(app)
        .post('/api/agents/test-agent/execute')
        .send(longPromptData);

      expect(response.status).toBe(200);
    });

    it('should handle execution with special characters in userPrompt', async () => {
      const specialPromptData = {
        input: { message: 'test' },
        userPrompt: '!@#$%^&*()_+{}|:"<>?[];\'\\,./`~',
      };

      mockArbiterService.executeAgent.mockResolvedValue(mockExecutionResult);

      const response = await request(app)
        .post('/api/agents/test-agent/execute')
        .send(specialPromptData);

      expect(response.status).toBe(200);
      expect(mockArbiterService.executeAgent).toHaveBeenCalledWith(
        'test-agent',
        specialPromptData.input,
        specialPromptData.userPrompt
      );
    });

    it('should handle execution timeout errors', async () => {
      mockArbiterService.executeAgent.mockRejectedValue(new Error('Request timeout'));

      const response = await request(app)
        .post('/api/agents/test-agent/execute')
        .send(validExecuteData);

      expect(response.status).toBe(500);
    });

    it('should handle execution with undefined result from service', async () => {
      mockArbiterService.executeAgent.mockResolvedValue(undefined as any);

      const response = await request(app)
        .post('/api/agents/test-agent/execute')
        .send(validExecuteData);

      expect(response.status).toBe(200);
      expect(response.body.result).toBeUndefined();
    });
  });

  describe('Edge cases and error conditions', () => {
    it('should handle missing ArbiterService on request object', async () => {
      const appWithoutService = express();
      appWithoutService.use(express.json());
      appWithoutService.use('/api/agents', agentRoutes);

      const response = await request(appWithoutService).get('/api/agents');

      expect(response.status).toBe(500);
    });

    it('should handle ArbiterService being null', async () => {
      const appWithNullService = express();
      appWithNullService.use(express.json());
      appWithNullService.use((req, res, next) => {
        (req as any).arbiterService = null;
        next();
      });
      appWithNullService.use('/api/agents', agentRoutes);

      const response = await request(appWithNullService).get('/api/agents');

      expect(response.status).toBe(500);
    });

    it('should handle very large agent ID in URL', async () => {
      const veryLongId = 'a'.repeat(10000);
      mockArbiterService.getAgent.mockResolvedValue(null);

      const response = await request(app).get(`/api/agents/${veryLongId}`);

      expect(response.status).toBe(404);
    });

    it('should handle URL-encoded special characters in agent ID', async () => {
      const encodedId = encodeURIComponent('agent with spaces & symbols!@#');
      mockArbiterService.getAgent.mockResolvedValue(null);

      const response = await request(app).get(`/api/agents/${encodedId}`);

      expect(response.status).toBe(404);
      expect(mockArbiterService.getAgent).toHaveBeenCalledWith('agent with spaces & symbols!@#');
    });

    it('should handle concurrent requests to same agent', async () => {
      const mockAgent: AgentConfig = {
        id: 'concurrent-agent',
        name: 'Concurrent Agent',
        description: 'An agent for concurrent testing',
        model: 'granite',
        systemPrompt: 'You are a concurrent agent',
        availableTools: [],
        level: 0,
      };

      mockArbiterService.getAgent.mockResolvedValue(mockAgent);

      const requests = Array(10).fill(null).map(() => 
        request(app).get('/api/agents/concurrent-agent')
      );

      const responses = await Promise.all(requests);

      responses.forEach(response => {
        expect(response.status).toBe(200);
        expect(response.body).toEqual(mockAgent);
      });

      expect(mockArbiterService.getAgent).toHaveBeenCalledTimes(10);
    });
  });
});