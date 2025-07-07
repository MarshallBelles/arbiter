import request from 'supertest';
import express from 'express';
import { eventRoutes } from '../events';
import { ArbiterService } from '../../services/arbiter-service';
import { errorHandler } from '../../middleware/error-handler';
import { EventHandler, WorkflowExecutionContext } from '@arbiter/core';

// Mock the ArbiterService
jest.mock('../../services/arbiter-service');

describe('Event Routes', () => {
  let app: express.Application;
  let mockArbiterService: jest.Mocked<ArbiterService>;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    
    // Create mock ArbiterService
    mockArbiterService = {
      getEventHandlers: jest.fn(),
      enableEventHandler: jest.fn(),
      disableEventHandler: jest.fn(),
      triggerManualEvent: jest.fn(),
      getActiveExecutions: jest.fn(),
      getExecution: jest.fn(),
      cancelExecution: jest.fn(),
    } as any;

    // Add ArbiterService to request object
    app.use((req, res, next) => {
      (req as any).arbiterService = mockArbiterService;
      next();
    });

    app.use('/api/events', eventRoutes);
    
    // Add error handler middleware
    app.use(errorHandler);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/events/handlers', () => {
    it('should return list of event handlers successfully', async () => {
      const testDate = new Date();
      const mockHandlers: EventHandler[] = [
        {
          id: 'handler-1',
          eventType: 'webhook',
          workflowId: 'workflow-1',
          condition: '/api/webhook/test',
          enabled: true,
          triggerCount: 5,
        },
        {
          id: 'handler-2',
          eventType: 'cron',
          workflowId: 'workflow-2',
          condition: '0 0 * * *',
          enabled: false,
          triggerCount: 0,
          lastTriggered: testDate,
        },
      ];

      mockArbiterService.getEventHandlers.mockResolvedValue(mockHandlers);

      const response = await request(app).get('/api/events/handlers');

      expect(response.status).toBe(200);
      expect(response.body).toEqual([
        {
          id: 'handler-1',
          eventType: 'webhook',
          workflowId: 'workflow-1',
          condition: '/api/webhook/test',
          enabled: true,
          triggerCount: 5,
        },
        {
          id: 'handler-2',
          eventType: 'cron',
          workflowId: 'workflow-2',
          condition: '0 0 * * *',
          enabled: false,
          triggerCount: 0,
          lastTriggered: testDate.toISOString(), // Date gets serialized to ISO string
        },
      ]);
      expect(mockArbiterService.getEventHandlers).toHaveBeenCalledTimes(1);
    });

    it('should handle empty event handlers list', async () => {
      mockArbiterService.getEventHandlers.mockResolvedValue([]);

      const response = await request(app).get('/api/events/handlers');

      expect(response.status).toBe(200);
      expect(response.body).toEqual([]);
    });

    it('should handle service errors', async () => {
      mockArbiterService.getEventHandlers.mockRejectedValue(new Error('Database connection failed'));

      const response = await request(app).get('/api/events/handlers');

      expect(response.status).toBe(500);
      expect(response.body).toHaveProperty('error', 'Internal Server Error');
    });

    it('should handle null response from service', async () => {
      mockArbiterService.getEventHandlers.mockResolvedValue(null as any);

      const response = await request(app).get('/api/events/handlers');

      expect(response.status).toBe(200);
      expect(response.body).toBe(null);
    });

    it('should handle undefined response from service', async () => {
      mockArbiterService.getEventHandlers.mockResolvedValue(undefined as any);

      const response = await request(app).get('/api/events/handlers');

      expect(response.status).toBe(200);
      expect(response.body).toBe(''); // Express converts undefined to empty string
    });
  });

  describe('POST /api/events/handlers/:id/enable', () => {
    it('should enable event handler successfully', async () => {
      mockArbiterService.enableEventHandler.mockResolvedValue();

      const response = await request(app).post('/api/events/handlers/handler-1/enable');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        message: 'Event handler enabled successfully',
      });
      expect(mockArbiterService.enableEventHandler).toHaveBeenCalledWith('handler-1');
    });

    it('should handle service errors when enabling', async () => {
      mockArbiterService.enableEventHandler.mockRejectedValue(new Error('Handler not found'));

      const response = await request(app).post('/api/events/handlers/nonexistent/enable');

      expect(response.status).toBe(500);
      expect(response.body).toHaveProperty('error', 'Internal Server Error');
    });

    it('should handle special characters in handler ID', async () => {
      const specialId = 'handler@#$%^&*()';
      mockArbiterService.enableEventHandler.mockResolvedValue();

      const response = await request(app).post(`/api/events/handlers/${encodeURIComponent(specialId)}/enable`);

      expect(response.status).toBe(200);
      expect(mockArbiterService.enableEventHandler).toHaveBeenCalledWith(specialId);
    });

    it('should handle very long handler ID', async () => {
      const longId = 'handler-' + 'a'.repeat(1000);
      mockArbiterService.enableEventHandler.mockResolvedValue();

      const response = await request(app).post(`/api/events/handlers/${longId}/enable`);

      expect(response.status).toBe(200);
      expect(mockArbiterService.enableEventHandler).toHaveBeenCalledWith(longId);
    });

    it('should handle empty handler ID', async () => {
      const response = await request(app).post('/api/events/handlers//enable');

      expect(response.status).toBe(404); // Should not match the route
    });

    it('should handle handler enable timeout', async () => {
      mockArbiterService.enableEventHandler.mockRejectedValue(new Error('Request timeout'));

      const response = await request(app).post('/api/events/handlers/timeout-handler/enable');

      expect(response.status).toBe(500);
    });
  });

  describe('POST /api/events/handlers/:id/disable', () => {
    it('should disable event handler successfully', async () => {
      mockArbiterService.disableEventHandler.mockResolvedValue();

      const response = await request(app).post('/api/events/handlers/handler-1/disable');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        message: 'Event handler disabled successfully',
      });
      expect(mockArbiterService.disableEventHandler).toHaveBeenCalledWith('handler-1');
    });

    it('should handle service errors when disabling', async () => {
      mockArbiterService.disableEventHandler.mockRejectedValue(new Error('Handler not found'));

      const response = await request(app).post('/api/events/handlers/nonexistent/disable');

      expect(response.status).toBe(500);
      expect(response.body).toHaveProperty('error', 'Internal Server Error');
    });

    it('should handle special characters in handler ID for disable', async () => {
      const specialId = 'handler@#$%^&*()';
      mockArbiterService.disableEventHandler.mockResolvedValue();

      const response = await request(app).post(`/api/events/handlers/${encodeURIComponent(specialId)}/disable`);

      expect(response.status).toBe(200);
      expect(mockArbiterService.disableEventHandler).toHaveBeenCalledWith(specialId);
    });

    it('should handle already disabled handler', async () => {
      mockArbiterService.disableEventHandler.mockResolvedValue();

      const response = await request(app).post('/api/events/handlers/disabled-handler/disable');

      expect(response.status).toBe(200);
      expect(mockArbiterService.disableEventHandler).toHaveBeenCalledWith('disabled-handler');
    });
  });

  describe('POST /api/events/trigger/:workflowId', () => {
    const validEventData = {
      data: {
        message: 'Test event data',
        timestamp: new Date().toISOString(),
      },
    };

    const mockEventResult = {
      success: true,
      workflowExecutionId: 'exec-123',
    };

    it('should trigger manual event successfully', async () => {
      mockArbiterService.triggerManualEvent.mockResolvedValue(mockEventResult);

      const response = await request(app)
        .post('/api/events/trigger/workflow-1')
        .send(validEventData);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        result: mockEventResult,
        message: 'Manual event triggered successfully',
      });
      expect(mockArbiterService.triggerManualEvent).toHaveBeenCalledWith('workflow-1', validEventData.data);
    });

    it('should reject event with missing data field', async () => {
      const invalidEventData = {
        // Missing data field
        message: 'This should not work',
      };

      const response = await request(app)
        .post('/api/events/trigger/workflow-1')
        .send(invalidEventData);

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error', 'Validation Error');
      expect(response.body.message).toContain('data');
      expect(mockArbiterService.triggerManualEvent).not.toHaveBeenCalled();
    });

    it('should handle complex event data structures', async () => {
      const complexEventData = {
        data: {
          nested: {
            array: [1, 2, 3],
            object: { key: 'value' },
            null_value: null,
            boolean: true,
          },
          user: { id: 123, name: 'John Doe' },
          metadata: { version: '1.0.0' },
        },
      };

      mockArbiterService.triggerManualEvent.mockResolvedValue(mockEventResult);

      const response = await request(app)
        .post('/api/events/trigger/workflow-1')
        .send(complexEventData);

      expect(response.status).toBe(200);
      expect(mockArbiterService.triggerManualEvent).toHaveBeenCalledWith('workflow-1', complexEventData.data);
    });

    it('should handle null event data', async () => {
      const nullEventData = {
        data: null,
      };

      mockArbiterService.triggerManualEvent.mockResolvedValue(mockEventResult);

      const response = await request(app)
        .post('/api/events/trigger/workflow-1')
        .send(nullEventData);

      expect(response.status).toBe(200);
      expect(mockArbiterService.triggerManualEvent).toHaveBeenCalledWith('workflow-1', null);
    });

    it('should handle primitive event data types', async () => {
      const primitiveData = {
        data: 'simple string data',
      };

      mockArbiterService.triggerManualEvent.mockResolvedValue(mockEventResult);

      const response = await request(app)
        .post('/api/events/trigger/workflow-1')
        .send(primitiveData);

      expect(response.status).toBe(200);
      expect(mockArbiterService.triggerManualEvent).toHaveBeenCalledWith('workflow-1', 'simple string data');
    });

    it('should handle service errors when triggering event', async () => {
      mockArbiterService.triggerManualEvent.mockRejectedValue(new Error('Workflow not found'));

      const response = await request(app)
        .post('/api/events/trigger/nonexistent-workflow')
        .send(validEventData);

      expect(response.status).toBe(500);
      expect(response.body).toHaveProperty('error', 'Internal Server Error');
    });

    it('should handle empty request body', async () => {
      const response = await request(app)
        .post('/api/events/trigger/workflow-1')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error', 'Validation Error');
    });

    it('should handle malformed JSON in request body', async () => {
      const response = await request(app)
        .post('/api/events/trigger/workflow-1')
        .set('Content-Type', 'application/json')
        .send('{ invalid json }');

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error', 'Invalid JSON');
    });

    it('should handle special characters in workflow ID', async () => {
      const specialWorkflowId = 'workflow@#$%^&*()';
      mockArbiterService.triggerManualEvent.mockResolvedValue(mockEventResult);

      const response = await request(app)
        .post(`/api/events/trigger/${encodeURIComponent(specialWorkflowId)}`)
        .send(validEventData);

      expect(response.status).toBe(200);
      expect(mockArbiterService.triggerManualEvent).toHaveBeenCalledWith(specialWorkflowId, validEventData.data);
    });

    it('should handle very long workflow ID', async () => {
      const longWorkflowId = 'workflow-' + 'a'.repeat(1000);
      mockArbiterService.triggerManualEvent.mockResolvedValue(mockEventResult);

      const response = await request(app)
        .post(`/api/events/trigger/${longWorkflowId}`)
        .send(validEventData);

      expect(response.status).toBe(200);
      expect(mockArbiterService.triggerManualEvent).toHaveBeenCalledWith(longWorkflowId, validEventData.data);
    });

    it('should handle undefined result from service', async () => {
      mockArbiterService.triggerManualEvent.mockResolvedValue(undefined as any);

      const response = await request(app)
        .post('/api/events/trigger/workflow-1')
        .send(validEventData);

      expect(response.status).toBe(200);
      expect(response.body.result).toBeUndefined();
    });
  });

  describe('GET /api/events/executions', () => {
    it('should return active executions successfully', async () => {
      const startTime1 = new Date();
      const startTime2 = new Date();
      const endTime2 = new Date();
      
      const mockExecutions: WorkflowExecutionContext[] = [
        {
          execution: {
            id: 'exec-1',
            workflowId: 'workflow-1',
            status: 'running',
            startTime: startTime1,
            eventData: { test: 'data' },
            currentLevel: 0,
            executionLog: [],
            result: null,
          },
          workflow: {} as any,
          eventData: { test: 'data' },
          state: new Map(),
          agentResponses: new Map(),
        },
        {
          execution: {
            id: 'exec-2',
            workflowId: 'workflow-2',
            status: 'completed',
            startTime: startTime2,
            endTime: endTime2,
            eventData: { test: 'data2' },
            currentLevel: 1,
            executionLog: [],
            result: { status: 'completed' },
          },
          workflow: {} as any,
          eventData: { test: 'data2' },
          state: new Map(),
          agentResponses: new Map(),
        },
      ];

      mockArbiterService.getActiveExecutions.mockReturnValue(mockExecutions);

      const response = await request(app).get('/api/events/executions');

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(2);
      expect(response.body[0]).toEqual({
        id: 'exec-1',
        workflowId: 'workflow-1',
        status: 'running',
        startTime: startTime1.toISOString(),
        eventData: { test: 'data' },
        currentLevel: 0,
        executionLog: [],
        result: null,
      });
      expect(response.body[1]).toEqual({
        id: 'exec-2',
        workflowId: 'workflow-2',
        status: 'completed',
        startTime: startTime2.toISOString(),
        endTime: endTime2.toISOString(),
        eventData: { test: 'data2' },
        currentLevel: 1,
        executionLog: [],
        result: { status: 'completed' },
      });
    });

    it('should handle empty active executions', async () => {
      mockArbiterService.getActiveExecutions.mockReturnValue([]);

      const response = await request(app).get('/api/events/executions');

      expect(response.status).toBe(200);
      expect(response.body).toEqual([]);
    });

    it('should handle null response from service', async () => {
      mockArbiterService.getActiveExecutions.mockReturnValue(null as any);

      const response = await request(app).get('/api/events/executions');

      expect(response.status).toBe(200);
      expect(response.body).toEqual([]); // Our fix returns empty array for null
    });

    it('should handle service throwing error', async () => {
      mockArbiterService.getActiveExecutions.mockImplementation(() => {
        throw new Error('Service unavailable');
      });

      const response = await request(app).get('/api/events/executions');

      expect(response.status).toBe(500);
      expect(response.body).toHaveProperty('error', 'Internal Server Error');
    });

    it('should handle executions with missing execution property', async () => {
      const invalidExecutions = [
        { workflow: {} as any, eventData: {}, state: new Map(), agentResponses: new Map() }, // Missing execution
      ] as any;

      mockArbiterService.getActiveExecutions.mockReturnValue(invalidExecutions);

      const response = await request(app).get('/api/events/executions');

      expect(response.status).toBe(200);
      expect(response.body).toEqual([]); // Our fix filters out invalid entries
    });
  });

  describe('GET /api/events/executions/:id', () => {
    const startTime = new Date();
    const mockExecutionContext: WorkflowExecutionContext = {
      execution: {
        id: 'exec-1',
        workflowId: 'workflow-1',
        status: 'running',
        startTime: startTime,
        eventData: { test: 'data' },
        currentLevel: 0,
        executionLog: [],
        result: null,
      },
      workflow: {} as any,
      eventData: { test: 'data' },
      state: new Map(),
      agentResponses: new Map(),
    };

    it('should return specific execution successfully', async () => {
      mockArbiterService.getExecution.mockReturnValue(mockExecutionContext);

      const response = await request(app).get('/api/events/executions/exec-1');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        id: 'exec-1',
        workflowId: 'workflow-1',
        status: 'running',
        startTime: startTime.toISOString(),
        eventData: { test: 'data' },
        currentLevel: 0,
        executionLog: [],
        result: null,
      });
      expect(mockArbiterService.getExecution).toHaveBeenCalledWith('exec-1');
    });

    it('should return 404 when execution not found', async () => {
      mockArbiterService.getExecution.mockReturnValue(null);

      const response = await request(app).get('/api/events/executions/nonexistent');

      expect(response.status).toBe(404);
      expect(response.body).toEqual({
        error: 'Not Found',
        message: 'Execution not found',
      });
    });

    it('should return 404 when execution is undefined', async () => {
      mockArbiterService.getExecution.mockReturnValue(undefined as any);

      const response = await request(app).get('/api/events/executions/undefined-exec');

      expect(response.status).toBe(404);
    });

    it('should handle service errors', async () => {
      mockArbiterService.getExecution.mockImplementation(() => {
        throw new Error('Database connection failed');
      });

      const response = await request(app).get('/api/events/executions/exec-1');

      expect(response.status).toBe(500);
      expect(response.body).toHaveProperty('error', 'Internal Server Error');
    });

    it('should handle special characters in execution ID', async () => {
      const specialId = 'exec@#$%^&*()';
      mockArbiterService.getExecution.mockReturnValue(null);

      const response = await request(app).get(`/api/events/executions/${encodeURIComponent(specialId)}`);

      expect(response.status).toBe(404);
      expect(mockArbiterService.getExecution).toHaveBeenCalledWith(specialId);
    });

    it('should handle very long execution ID', async () => {
      const longId = 'exec-' + 'a'.repeat(1000);
      mockArbiterService.getExecution.mockReturnValue(null);

      const response = await request(app).get(`/api/events/executions/${longId}`);

      expect(response.status).toBe(404);
      expect(mockArbiterService.getExecution).toHaveBeenCalledWith(longId);
    });

    it('should handle execution context with null execution property', async () => {
      const invalidContext = {
        execution: null,
        workflow: {} as any,
        eventData: {},
        state: new Map(),
        agentResponses: new Map(),
      } as any;

      mockArbiterService.getExecution.mockReturnValue(invalidContext);

      const response = await request(app).get('/api/events/executions/invalid-exec');

      expect(response.status).toBe(404); // Our fix returns 404 for null execution
    });
  });

  describe('POST /api/events/executions/:id/cancel', () => {
    it('should cancel execution successfully', async () => {
      mockArbiterService.cancelExecution.mockResolvedValue(true);

      const response = await request(app).post('/api/events/executions/exec-1/cancel');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        message: 'Execution cancelled successfully',
      });
      expect(mockArbiterService.cancelExecution).toHaveBeenCalledWith('exec-1');
    });

    it('should return 404 when execution not found for cancellation', async () => {
      mockArbiterService.cancelExecution.mockResolvedValue(false);

      const response = await request(app).post('/api/events/executions/nonexistent/cancel');

      expect(response.status).toBe(404);
      expect(response.body).toEqual({
        error: 'Not Found',
        message: 'Execution not found or already completed',
      });
    });

    it('should handle service errors during cancellation', async () => {
      mockArbiterService.cancelExecution.mockRejectedValue(new Error('Cancellation failed'));

      const response = await request(app).post('/api/events/executions/exec-1/cancel');

      expect(response.status).toBe(500);
      expect(response.body).toHaveProperty('error', 'Internal Server Error');
    });

    it('should handle special characters in execution ID for cancellation', async () => {
      const specialId = 'exec@#$%^&*()';
      mockArbiterService.cancelExecution.mockResolvedValue(true);

      const response = await request(app).post(`/api/events/executions/${encodeURIComponent(specialId)}/cancel`);

      expect(response.status).toBe(200);
      expect(mockArbiterService.cancelExecution).toHaveBeenCalledWith(specialId);
    });

    it('should handle very long execution ID for cancellation', async () => {
      const longId = 'exec-' + 'a'.repeat(1000);
      mockArbiterService.cancelExecution.mockResolvedValue(true);

      const response = await request(app).post(`/api/events/executions/${longId}/cancel`);

      expect(response.status).toBe(200);
      expect(mockArbiterService.cancelExecution).toHaveBeenCalledWith(longId);
    });

    it('should handle undefined return from service for cancellation', async () => {
      mockArbiterService.cancelExecution.mockResolvedValue(undefined as any);

      const response = await request(app).post('/api/events/executions/exec-1/cancel');

      expect(response.status).toBe(404);
    });

    it('should handle null return from service for cancellation', async () => {
      mockArbiterService.cancelExecution.mockResolvedValue(null as any);

      const response = await request(app).post('/api/events/executions/exec-1/cancel');

      expect(response.status).toBe(404);
    });
  });

  describe('Edge cases and error conditions', () => {
    it('should handle missing ArbiterService on request object', async () => {
      const appWithoutService = express();
      appWithoutService.use(express.json());
      appWithoutService.use('/api/events', eventRoutes);
      appWithoutService.use(errorHandler);

      const response = await request(appWithoutService).get('/api/events/handlers');

      expect(response.status).toBe(500);
    });

    it('should handle ArbiterService being null', async () => {
      const appWithNullService = express();
      appWithNullService.use(express.json());
      appWithNullService.use((req, res, next) => {
        (req as any).arbiterService = null;
        next();
      });
      appWithNullService.use('/api/events', eventRoutes);
      appWithNullService.use(errorHandler);

      const response = await request(appWithNullService).get('/api/events/handlers');

      expect(response.status).toBe(500);
    });

    it('should handle concurrent requests to same endpoint', async () => {
      const mockHandlers: EventHandler[] = [
        {
          id: 'handler-1',
          eventType: 'webhook',
          workflowId: 'workflow-1',
          condition: '/api/webhook/test',
          enabled: true,
          triggerCount: 5,
        },
      ];

      mockArbiterService.getEventHandlers.mockResolvedValue(mockHandlers);

      const requests = Array(10).fill(null).map(() => 
        request(app).get('/api/events/handlers')
      );

      const responses = await Promise.all(requests);

      responses.forEach(response => {
        expect(response.status).toBe(200);
        expect(response.body).toEqual(mockHandlers);
      });

      expect(mockArbiterService.getEventHandlers).toHaveBeenCalledTimes(10);
    });

    it('should handle reasonably large event data payload', async () => {
      const largeEventData = {
        data: {
          largeArray: Array(1000).fill({ key: 'value' }), // Smaller array
          largeString: 'A'.repeat(5000), // Smaller string
        },
      };

      mockArbiterService.triggerManualEvent.mockResolvedValue({ success: true });

      const response = await request(app)
        .post('/api/events/trigger/workflow-1')
        .send(largeEventData);

      expect(response.status).toBe(200);
    });

    it('should reject extremely large event data payload (over 10MB limit)', async () => {
      const largeEventData = {
        data: {
          largeString: 'A'.repeat(12 * 1024 * 1024), // 12MB string - exceeds 10MB limit
        },
      };

      const response = await request(app)
        .post('/api/events/trigger/workflow-1')
        .send(largeEventData);

      expect(response.status).toBe(500); // Express returns 500 for payload too large
      expect(response.body).toHaveProperty('error');
    });

    it('should handle event trigger with circular reference in data', async () => {
      const circularData: any = {
        data: { message: 'test' },
      };
      circularData.data.circular = circularData; // Create circular reference

      mockArbiterService.triggerManualEvent.mockResolvedValue({ success: true });

      const response = await request(app)
        .post('/api/events/trigger/workflow-1')
        .send(circularData);

      expect(response.status).toBe(200);
      // The circular reference should be handled by JSON.stringify during request processing
    });

    it('should handle empty execution ID path parameter', async () => {
      const response = await request(app).get('/api/events/executions/');

      // This should hit the list executions endpoint instead
      expect(mockArbiterService.getActiveExecutions).toHaveBeenCalled();
    });

    it('should handle handler enable/disable with empty ID', async () => {
      const enableResponse = await request(app).post('/api/events/handlers//enable');
      const disableResponse = await request(app).post('/api/events/handlers//disable');

      expect(enableResponse.status).toBe(404);
      expect(disableResponse.status).toBe(404);
    });
  });
});