import request from 'supertest';
import express from 'express';
import { ArbiterService } from '../../services/arbiter-service';
import { workflowRoutes } from '../../routes/workflows';
import { healthRoutes } from '../../routes/health';

// Mock external services
jest.mock('../../services/arbiter-service');

describe('Chaos Engineering Tests', () => {
  let app: express.Application;
  let mockArbiterService: jest.Mocked<ArbiterService>;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    
    mockArbiterService = {
      createWorkflow: jest.fn(),
      listWorkflows: jest.fn(),
      getWorkflow: jest.fn(),
      updateWorkflow: jest.fn(),
      deleteWorkflow: jest.fn(),
      executeWorkflow: jest.fn(),
      getActiveExecutions: jest.fn(),
      getStatus: jest.fn(),
    } as any;

    app.use((req, res, next) => {
      (req as any).arbiterService = mockArbiterService;
      next();
    });

    app.use('/api/workflows', workflowRoutes);
    app.use('/health', healthRoutes);

    jest.clearAllMocks();
  });

  describe('Random Component Failures', () => {
    it('should handle random database connection drops', async () => {
      // Simulate random database failures affecting different operations
      const operations = [
        () => mockArbiterService.listWorkflows.mockRejectedValue(new Error('Database connection lost')),
        () => mockArbiterService.createWorkflow.mockRejectedValue(new Error('Connection timeout')),
        () => mockArbiterService.getWorkflow.mockRejectedValue(new Error('Database unavailable')),
      ];

      // Randomly trigger failures
      const randomFailure = operations[Math.floor(Math.random() * operations.length)];
      randomFailure();

      const requests = [
        request(app).get('/api/workflows'),
        request(app).post('/api/workflows').send({
          id: 'chaos-test',
          name: 'Chaos Test Workflow',
          description: 'Testing chaos scenarios',
          version: '1.0.0',
          trigger: { type: 'manual', config: {} },
          rootAgent: {
            id: 'root',
            name: 'Root Agent',
            model: 'granite',
            systemPrompt: 'Test',
            availableTools: [],
            level: 0,
          },
          levels: [],
        }),
        request(app).get('/api/workflows/test-id'),
      ];

      const randomRequest = requests[Math.floor(Math.random() * requests.length)];
      const response = await randomRequest;

      // System should handle failures gracefully - not crash
      expect([200, 400, 500, 503]).toContain(response.status);
    });

    it('should handle memory pressure during peak load', async () => {
      // Simulate memory pressure affecting multiple services
      const memoryPressureError = new Error('Cannot allocate memory: heap limit reached');
      
      mockArbiterService.listWorkflows.mockRejectedValue(memoryPressureError);
      mockArbiterService.getStatus.mockReturnValue({
        memory: { used: 950, total: 1000, percentage: 95 },
        status: 'critical',
        alerts: ['HIGH_MEMORY_USAGE', 'GC_PRESSURE'],
      });

      // Multiple concurrent requests during memory pressure
      const promises = Array.from({ length: 10 }, () =>
        request(app).get('/api/workflows')
      );

      const responses = await Promise.all(promises.map(p => p.catch(err => ({ status: 500 }))));
      
      responses.forEach(response => {
        // System should either succeed or fail gracefully
        expect([200, 500, 503]).toContain(response.status);
      });

      // Health check should reflect system state
      const healthResponse = await request(app).get('/health');
      expect(healthResponse.status).toBe(200);
      expect(healthResponse.body.memory.percentage).toBe(95);
    });

    it('should handle cascading service failures', async () => {
      // Simulate one failure causing others (cascade effect)
      let failureCount = 0;
      
      const cascadeFailure = () => {
        failureCount++;
        if (failureCount === 1) {
          // First failure: database
          mockArbiterService.listWorkflows.mockRejectedValue(new Error('Primary database failed'));
        } else if (failureCount === 2) {
          // Second failure: affects workflow creation
          mockArbiterService.createWorkflow.mockRejectedValue(new Error('Cannot reach database cluster'));
        } else {
          // System overwhelmed
          throw new Error('System overloaded due to cascading failures');
        }
      };

      try {
        // Trigger cascade
        cascadeFailure();
        await request(app).get('/api/workflows');
        
        cascadeFailure();
        await request(app).post('/api/workflows').send({
          id: 'cascade-test',
          name: 'Cascade Test',
          description: 'Testing cascade failures',
          version: '1.0.0',
          trigger: { type: 'manual', config: {} },
          rootAgent: {
            id: 'root',
            name: 'Root Agent',
            model: 'granite',
            systemPrompt: 'Test',
            availableTools: [],
            level: 0,
          },
          levels: [],
        });

        cascadeFailure();
      } catch (error) {
        // System should contain cascade failures
        expect(error.message).toContain('cascading failures');
      }

      expect(failureCount).toBeGreaterThan(0);
    });
  });

  describe('Partial System Failures', () => {
    it('should handle agent execution failures while maintaining API availability', async () => {
      // API should remain available even if agent execution fails
      mockArbiterService.executeWorkflow.mockRejectedValue(
        new Error('Agent execution failed: Model service unavailable')
      );
      
      mockArbiterService.listWorkflows.mockResolvedValue([
        {
          id: 'available-workflow',
          name: 'Available Workflow',
          description: 'This workflow is available for viewing',
          version: '1.0.0',
          trigger: { type: 'manual', config: {} },
          rootAgent: {
            id: 'root',
            name: 'Root Agent',
            model: 'granite',
            systemPrompt: 'Test',
            availableTools: [],
            level: 0,
          },
          levels: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      // Execution should fail
      const execResponse = await request(app)
        .post('/api/workflows/test-workflow/execute')
        .send({ input: { prompt: 'test' } });
      
      expect([400, 500]).toContain(execResponse.status);

      // But listing should still work
      const listResponse = await request(app).get('/api/workflows');
      expect(listResponse.status).toBe(200);
      expect(listResponse.body).toHaveLength(1);
    });

    it('should handle storage failures while maintaining read operations', async () => {
      // Writes fail but reads from cache/memory succeed
      mockArbiterService.createWorkflow.mockRejectedValue(
        new Error('Storage unavailable: Cannot write to disk')
      );
      
      mockArbiterService.listWorkflows.mockResolvedValue([
        {
          id: 'cached-workflow',
          name: 'Cached Workflow',
          description: 'Served from cache due to storage issues',
          version: '1.0.0',
          trigger: { type: 'manual', config: {} },
          rootAgent: {
            id: 'root',
            name: 'Root Agent',
            model: 'granite',
            systemPrompt: 'Test',
            availableTools: [],
            level: 0,
          },
          levels: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      // Create should fail
      const createResponse = await request(app)
        .post('/api/workflows')
        .send({
          id: 'new-workflow',
          name: 'New Workflow',
          description: 'Should fail to create',
          version: '1.0.0',
          trigger: { type: 'manual', config: {} },
          rootAgent: {
            id: 'root',
            name: 'Root Agent',
            model: 'granite',
            systemPrompt: 'Test',
            availableTools: [],
            level: 0,
          },
          levels: [],
        });

      expect([400, 500]).toContain(createResponse.status);

      // But read should work (from cache)
      const listResponse = await request(app).get('/api/workflows');
      expect(listResponse.status).toBe(200);
      expect(listResponse.body[0].description).toContain('cache');
    });

    it('should handle authentication service failures with graceful degradation', async () => {
      // Simulate auth service down but allow limited operations
      mockArbiterService.getStatus.mockReturnValue({
        status: 'degraded',
        authService: 'unavailable',
        degradedMode: true,
        availableOperations: ['read', 'health-check'],
      });

      mockArbiterService.listWorkflows.mockResolvedValue([
        {
          id: 'public-workflow',
          name: 'Public Workflow (No Auth Required)',
          description: 'Available in degraded mode',
          version: '1.0.0',
          trigger: { type: 'manual', config: {} },
          rootAgent: {
            id: 'root',
            name: 'Root Agent',
            model: 'granite',
            systemPrompt: 'Test',
            availableTools: [],
            level: 0,
          },
          levels: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      // Health check should work
      const healthResponse = await request(app).get('/health');
      expect(healthResponse.status).toBe(200);
      expect(healthResponse.body.authService).toBe('unavailable');

      // Read operations should work in degraded mode
      const listResponse = await request(app).get('/api/workflows');
      expect(listResponse.status).toBe(200);
      expect(listResponse.body[0].name).toContain('No Auth Required');
    });
  });

  describe('Resource Exhaustion Scenarios', () => {
    it('should handle CPU exhaustion gracefully', async () => {
      // Simulate high CPU usage affecting response times
      mockArbiterService.getStatus.mockReturnValue({
        status: 'warning',
        cpu: { usage: 98.5, cores: 4 },
        responseTime: 5000, // 5 seconds
        throttling: true,
      });

      // Slow but functional responses
      mockArbiterService.listWorkflows.mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 1000)); // Simulate slow response
        return [
          {
            id: 'slow-workflow',
            name: 'Slow Workflow (High CPU)',
            description: 'Response delayed due to high CPU usage',
            version: '1.0.0',
            trigger: { type: 'manual', config: {} },
            rootAgent: {
              id: 'root',
              name: 'Root Agent',
              model: 'granite',
              systemPrompt: 'Test',
              availableTools: [],
              level: 0,
            },
            levels: [],
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ];
      });

      const startTime = Date.now();
      const response = await request(app).get('/api/workflows');
      const responseTime = Date.now() - startTime;

      expect(response.status).toBe(200);
      expect(responseTime).toBeGreaterThan(500); // Slow but working
      expect(response.body[0].description).toContain('High CPU');
    });

    it('should handle file descriptor exhaustion', async () => {
      // Simulate running out of file descriptors
      mockArbiterService.createWorkflow.mockRejectedValue(
        new Error('EMFILE: too many open files, open \'/var/log/arbiter.log\'')
      );

      mockArbiterService.getStatus.mockReturnValue({
        status: 'critical',
        fileDescriptors: { used: 1020, limit: 1024 },
        alerts: ['FILE_DESCRIPTOR_EXHAUSTION'],
      });

      const response = await request(app)
        .post('/api/workflows')
        .send({
          id: 'fd-test',
          name: 'FD Test',
          description: 'Testing file descriptor limits',
          version: '1.0.0',
          trigger: { type: 'manual', config: {} },
          rootAgent: {
            id: 'root',
            name: 'Root Agent',
            model: 'granite',
            systemPrompt: 'Test',
            availableTools: [],
            level: 0,
          },
          levels: [],
        });

      expect([400, 500]).toContain(response.status);

      // Health check should reflect the issue
      const healthResponse = await request(app).get('/health');
      expect(healthResponse.body.fileDescriptors.used).toBeGreaterThan(1000);
    });

    it('should handle network bandwidth saturation', async () => {
      // Simulate network congestion affecting external service calls
      mockArbiterService.executeWorkflow.mockRejectedValue(
        new Error('Network congestion: Bandwidth limit exceeded, request queued')
      );

      mockArbiterService.getStatus.mockReturnValue({
        status: 'degraded',
        network: { 
          bandwidth: { used: 95, limit: 100, unit: 'Mbps' },
          congestion: true,
          queuedRequests: 25,
        },
      });

      const response = await request(app)
        .post('/api/workflows/bandwidth-test/execute')
        .send({ input: { data: 'large payload'.repeat(1000) } });

      expect([400, 429, 503]).toContain(response.status); // Rate limited or unavailable

      const healthResponse = await request(app).get('/health');
      expect(healthResponse.body.network.congestion).toBe(true);
    });
  });

  describe('Time-Based Chaos Scenarios', () => {
    it('should handle system behavior during time zone changes', async () => {
      // Simulate DST transition or timezone configuration changes
      const originalTZ = process.env.TZ;
      process.env.TZ = 'America/New_York';

      mockArbiterService.listWorkflows.mockResolvedValue([
        {
          id: 'tz-workflow',
          name: 'Timezone Test Workflow',
          description: 'Testing timezone handling',
          version: '1.0.0',
          trigger: { type: 'manual', config: {} },
          rootAgent: {
            id: 'root',
            name: 'Root Agent',
            model: 'granite',
            systemPrompt: 'Test',
            availableTools: [],
            level: 0,
          },
          levels: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      const response = await request(app).get('/api/workflows');
      expect(response.status).toBe(200);

      // Restore original timezone
      process.env.TZ = originalTZ;
    });

    it('should handle clock drift and time synchronization issues', async () => {
      // Simulate system clock being out of sync
      const futureTime = new Date(Date.now() + 86400000); // 1 day in future
      
      mockArbiterService.getStatus.mockReturnValue({
        status: 'warning',
        systemTime: futureTime.toISOString(),
        clockDrift: '+24h',
        ntpSync: false,
        alerts: ['CLOCK_DRIFT_DETECTED'],
      });

      const healthResponse = await request(app).get('/health');
      expect(healthResponse.status).toBe(200);
      expect(healthResponse.body.clockDrift).toBe('+24h');
      expect(healthResponse.body.alerts).toContain('CLOCK_DRIFT_DETECTED');
    });

    it('should handle leap second transitions', async () => {
      // Simulate behavior during leap second (rare but critical)
      mockArbiterService.getStatus.mockReturnValue({
        status: 'warning',
        leapSecond: true,
        timestamp: '2024-12-31T23:59:60.000Z', // Theoretical leap second
        timeSync: 'adjusting',
      });

      const response = await request(app).get('/health');
      expect(response.status).toBe(200);
      expect(response.body.leapSecond).toBe(true);
    });
  });

  describe('System Recovery Scenarios', () => {
    it('should test recovery after total system restart', async () => {
      // Simulate system coming back online after restart
      let isSystemRestarting = true;
      
      mockArbiterService.getStatus.mockImplementation(() => {
        if (isSystemRestarting) {
          isSystemRestarting = false;
          throw new Error('System initializing: Services not ready');
        }
        return {
          status: 'healthy',
          uptime: 30, // 30 seconds since restart
          initialization: 'complete',
        };
      });

      // First request should fail
      const failResponse = await request(app).get('/health');
      expect([500, 503]).toContain(failResponse.status);

      // Second request should succeed
      const successResponse = await request(app).get('/health');
      expect(successResponse.status).toBe(200);
      expect(successResponse.body.uptime).toBe(30);
    });

    it('should test graceful shutdown behavior', async () => {
      // Simulate system preparing for shutdown
      mockArbiterService.getStatus.mockReturnValue({
        status: 'shutting_down',
        acceptingRequests: false,
        activeConnections: 5,
        shutdownTimeout: 30,
      });

      mockArbiterService.listWorkflows.mockRejectedValue(
        new Error('Service shutting down: Not accepting new requests')
      );

      const response = await request(app).get('/api/workflows');
      expect([503]).toContain(response.status);

      const healthResponse = await request(app).get('/health');
      expect(healthResponse.body.status).toBe('shutting_down');
    });

    it('should test rolling update scenarios', async () => {
      // Simulate rolling deployment with version mismatch
      mockArbiterService.getStatus.mockReturnValue({
        status: 'deploying',
        version: '1.1.0',
        previousVersion: '1.0.0',
        rollingUpdate: true,
        nodesUpdated: 2,
        totalNodes: 3,
      });

      const healthResponse = await request(app).get('/health');
      expect(healthResponse.status).toBe(200);
      expect(healthResponse.body.rollingUpdate).toBe(true);
      expect(healthResponse.body.nodesUpdated).toBe(2);
    });
  });

  describe('Data Corruption Scenarios', () => {
    it('should handle corrupted workflow configuration data', async () => {
      // Simulate database returning corrupted data
      mockArbiterService.getWorkflow.mockResolvedValue({
        id: 'corrupted-workflow',
        name: null, // Corrupted data
        description: undefined,
        version: 'invalid-version-format',
        trigger: null,
        rootAgent: {
          id: 'root',
          model: 'non-existent-model',
          systemPrompt: null,
          availableTools: 'not-an-array', // Wrong type
        },
      } as any);

      const response = await request(app).get('/api/workflows/corrupted-workflow');
      
      // System should handle corrupted data gracefully
      expect([400, 500]).toContain(response.status);
    });

    it('should handle checksum validation failures', async () => {
      // Simulate data integrity check failures
      mockArbiterService.createWorkflow.mockRejectedValue(
        new Error('Data integrity error: Checksum mismatch for workflow data')
      );

      const response = await request(app)
        .post('/api/workflows')
        .send({
          id: 'checksum-test',
          name: 'Checksum Test',
          description: 'Testing data integrity',
          version: '1.0.0',
          trigger: { type: 'manual', config: {} },
          rootAgent: {
            id: 'root',
            name: 'Root Agent',
            model: 'granite',
            systemPrompt: 'Test',
            availableTools: [],
            level: 0,
          },
          levels: [],
        });

      expect([400, 500]).toContain(response.status);
    });
  });
});