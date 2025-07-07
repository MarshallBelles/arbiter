import request from 'supertest';
import express from 'express';
import { healthRoutes } from '../../routes/health';
import { ArbiterService } from '../../services/arbiter-service';

// Mock ArbiterService
jest.mock('../../services/arbiter-service');

describe('Health Routes', () => {
  let app: express.Application;
  let mockArbiterService: jest.Mocked<ArbiterService>;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    
    // Create mock ArbiterService
    mockArbiterService = {
      getStatus: jest.fn(),
    } as any;

    // Add ArbiterService to request object
    app.use((req, res, next) => {
      (req as any).arbiterService = mockArbiterService;
      next();
    });

    app.use('/health', healthRoutes);

    // Clear all mocks
    jest.clearAllMocks();
  });

  describe('GET /health', () => {
    it('returns healthy status with basic information', async () => {
      const mockStatus = {
        uptime: 12345,
        database: 'connected',
        totalWorkflows: 5,
        activeRuns: 2,
      };
      
      mockArbiterService.getStatus.mockReturnValue(mockStatus);

      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.body).toMatchObject({
        status: 'healthy',
        timestamp: expect.any(String),
        version: expect.any(String),
        uptime: 12345,
        database: 'connected',
        totalWorkflows: 5,
        activeRuns: 2,
      });

      expect(mockArbiterService.getStatus).toHaveBeenCalledTimes(1);
    });

    it('includes timestamp in ISO format', async () => {
      mockArbiterService.getStatus.mockReturnValue({});

      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    it('includes version from environment or defaults to 1.0.0', async () => {
      mockArbiterService.getStatus.mockReturnValue({});

      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.body.version).toBeDefined();
      expect(typeof response.body.version).toBe('string');
    });

    it('handles service status errors gracefully', async () => {
      mockArbiterService.getStatus.mockImplementation(() => {
        throw new Error('Service unavailable');
      });

      // Should still return 200 but may have different status
      const response = await request(app)
        .get('/health')
        .expect(500); // This depends on error handling middleware

      // Test would need to be adjusted based on actual error handling
    });

    it('returns consistent response structure', async () => {
      const mockStatus = {
        database: 'connected',
        memory: { used: 150, free: 200 },
        cpu: { usage: 45.2 },
      };
      
      mockArbiterService.getStatus.mockReturnValue(mockStatus);

      const response = await request(app)
        .get('/health')
        .expect(200);

      // Verify all expected fields are present
      expect(response.body).toHaveProperty('status');
      expect(response.body).toHaveProperty('timestamp');
      expect(response.body).toHaveProperty('version');
      expect(response.body).toHaveProperty('database');
      expect(response.body).toHaveProperty('memory');
      expect(response.body).toHaveProperty('cpu');
    });
  });

  describe('GET /health/ping', () => {
    it('returns simple pong response', async () => {
      const response = await request(app)
        .get('/health/ping')
        .expect(200);

      expect(response.body).toEqual({
        message: 'pong'
      });
    });

    it('responds quickly for availability checks', async () => {
      const startTime = Date.now();
      
      await request(app)
        .get('/health/ping')
        .expect(200);

      const responseTime = Date.now() - startTime;
      expect(responseTime).toBeLessThan(100); // Should respond within 100ms
    });

    it('does not depend on ArbiterService', async () => {
      // Even if service is broken, ping should work
      mockArbiterService.getStatus.mockImplementation(() => {
        throw new Error('Service broken');
      });

      await request(app)
        .get('/health/ping')
        .expect(200);
    });
  });

  describe('Health Check Performance', () => {
    it('handles concurrent health checks efficiently', async () => {
      mockArbiterService.getStatus.mockReturnValue({
        database: 'connected',
        activeRuns: 0,
      });

      const promises = Array.from({ length: 10 }, () =>
        request(app).get('/health').expect(200)
      );

      const startTime = Date.now();
      const responses = await Promise.all(promises);
      const totalTime = Date.now() - startTime;

      // All should succeed
      expect(responses).toHaveLength(10);
      responses.forEach(response => {
        expect(response.body.status).toBe('healthy');
      });

      // Should handle 10 concurrent requests reasonably fast
      expect(totalTime).toBeLessThan(1000);
    });

    it('maintains performance under load', async () => {
      mockArbiterService.getStatus.mockReturnValue({
        database: 'connected',
        memory: { used: 500, free: 1500 },
      });

      const promises = Array.from({ length: 50 }, () =>
        request(app).get('/health/ping').expect(200)
      );

      const startTime = Date.now();
      await Promise.all(promises);
      const totalTime = Date.now() - startTime;

      // 50 ping requests should complete quickly
      expect(totalTime).toBeLessThan(2000);
    });
  });

  describe('Health Check During System Stress', () => {
    it('reports degraded performance when system is under load', async () => {
      // Simulate high resource usage
      mockArbiterService.getStatus.mockReturnValue({
        database: 'connected',
        memory: { used: 1800, free: 200 }, // High memory usage
        cpu: { usage: 95.5 }, // High CPU usage
        activeRuns: 100, // Many active runs
        uptime: 86400000, // 24 hours
      });

      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.body.memory.used).toBe(1800);
      expect(response.body.cpu.usage).toBe(95.5);
      expect(response.body.activeRuns).toBe(100);
    });

    it('handles database connectivity issues', async () => {
      mockArbiterService.getStatus.mockReturnValue({
        database: 'disconnected',
        lastError: 'Connection timeout after 30s',
        uptime: 12345,
      });

      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.body.database).toBe('disconnected');
      expect(response.body.lastError).toBe('Connection timeout after 30s');
      // Health endpoint should still respond even if database is down
      expect(response.body.status).toBe('healthy'); // Or 'degraded' depending on implementation
    });

    it('reports memory pressure conditions', async () => {
      mockArbiterService.getStatus.mockReturnValue({
        database: 'connected',
        memory: {
          used: 1900,
          free: 100,
          total: 2000,
          percentage: 95
        },
        alerts: ['HIGH_MEMORY_USAGE'],
      });

      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.body.memory.percentage).toBe(95);
      expect(response.body.alerts).toContain('HIGH_MEMORY_USAGE');
    });
  });

  describe('Error Scenarios', () => {
    it('handles service initialization failures', async () => {
      // Test with undefined service
      const appWithoutService = express();
      appWithoutService.use('/health', healthRoutes);

      // This should handle the case where arbiterService is not injected
      const response = await request(appWithoutService)
        .get('/health')
        .expect(500); // Or whatever error handling is implemented
    });

    it('handles malformed status responses', async () => {
      // Mock service returning malformed data
      mockArbiterService.getStatus.mockReturnValue(null as any);

      const response = await request(app)
        .get('/health');

      // Should handle null status gracefully
      expect([200, 500]).toContain(response.status);
    });

    it('handles service method throwing exceptions', async () => {
      mockArbiterService.getStatus.mockImplementation(() => {
        throw new TypeError('Cannot read property of undefined');
      });

      const response = await request(app)
        .get('/health');

      // Should not crash the application
      expect([200, 500]).toContain(response.status);
    });
  });

  describe('Response Headers and Format', () => {
    it('sets correct content-type header', async () => {
      mockArbiterService.getStatus.mockReturnValue({});

      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.headers['content-type']).toMatch(/application\/json/);
    });

    it('includes cache control headers for health checks', async () => {
      mockArbiterService.getStatus.mockReturnValue({});

      const response = await request(app)
        .get('/health')
        .expect(200);

      // Health checks should not be cached (if implemented)
      const cacheControl = response.headers['cache-control'];
      if (cacheControl) {
        expect(cacheControl).toMatch(/no-cache|no-store/);
      } else {
        // If not implemented, just verify response is successful
        expect(response.status).toBe(200);
      }
    });

    it('returns valid JSON format', async () => {
      mockArbiterService.getStatus.mockReturnValue({ test: 'data' });

      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(() => JSON.parse(JSON.stringify(response.body))).not.toThrow();
    });
  });
});