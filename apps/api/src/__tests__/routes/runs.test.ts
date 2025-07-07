import request from 'supertest';
import express from 'express';
import { runRoutes } from '../../routes/runs';
import { ArbiterServiceDB } from '../../services/arbiter-service-db';
import { RunRecord } from '@arbiter/database';
import { tmpdir } from 'os';
import { join } from 'path';
import { unlinkSync, existsSync } from 'fs';

// Mock the ArbiterServiceDB
const mockService = {
  exportRuns: jest.fn(),
  getWorkflowRuns: jest.fn(),
  getExecutionTrace: jest.fn(),
  getRunStats: jest.fn(),
  getPerformanceMetrics: jest.fn(),
  getRecentErrors: jest.fn(),
} as unknown as ArbiterServiceDB;

const app = express();
app.use(express.json());
app.use((req, res, next) => {
  (req as any).arbiterService = mockService;
  next();
});
app.use('/api/runs', runRoutes);

describe('Run Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/runs', () => {
    test('should return runs with default filters', async () => {
      const mockRuns: RunRecord[] = [
        {
          id: 'run-1',
          workflowId: 'workflow-1',
          runType: 'workflow_execution',
          status: 'completed',
          startTime: '2024-01-01T00:00:00.000Z',
        },
        {
          id: 'run-2',
          workflowId: 'workflow-1',
          runType: 'agent_execution',
          status: 'failed',
          startTime: '2024-01-01T00:01:00.000Z',
          errorMessage: 'Test error',
        },
      ];

      (mockService.exportRuns as jest.Mock).mockResolvedValue(mockRuns);

      const response = await request(app)
        .get('/api/runs')
        .expect(200);

      expect(response.body).toEqual({
        runs: mockRuns,
        total: 2,
        filters: {},
      });

      expect(mockService.exportRuns).toHaveBeenCalledWith({});
    });

    test('should apply filters correctly', async () => {
      const mockRuns: RunRecord[] = [
        {
          id: 'run-1',
          workflowId: 'workflow-1',
          runType: 'workflow_execution',
          status: 'completed',
          startTime: '2024-01-01T00:00:00.000Z',
        },
      ];

      (mockService.exportRuns as jest.Mock).mockResolvedValue(mockRuns);

      const response = await request(app)
        .get('/api/runs')
        .query({
          workflowId: 'workflow-1',
          status: 'completed',
          runType: 'workflow_execution',
          limit: '50',
        })
        .expect(200);

      expect(response.body).toEqual({
        runs: mockRuns,
        total: 1,
        filters: {
          workflowId: 'workflow-1',
          status: 'completed',
          runType: 'workflow_execution',
          limit: 50,
        },
      });

      expect(mockService.exportRuns).toHaveBeenCalledWith({
        workflowId: 'workflow-1',
        status: 'completed',
        runType: 'workflow_execution',
        limit: 50,
      });
    });

    test('should validate filter parameters', async () => {
      const response = await request(app)
        .get('/api/runs')
        .query({
          status: 'invalid-status',
          limit: 'not-a-number',
        })
        .expect(400);

      expect(response.body.error).toBe('Validation Error');
      expect(mockService.exportRuns).not.toHaveBeenCalled();
    });

    test('should handle service errors', async () => {
      (mockService.exportRuns as jest.Mock).mockRejectedValue(new Error('Service error'));

      await request(app)
        .get('/api/runs')
        .expect(500);
    });
  });

  describe('GET /api/runs/workflow/:workflowId', () => {
    test('should return runs for specific workflow', async () => {
      const mockRuns: RunRecord[] = [
        {
          id: 'run-1',
          workflowId: 'workflow-1',
          runType: 'workflow_execution',
          status: 'completed',
          startTime: '2024-01-01T00:00:00.000Z',
        },
      ];

      (mockService.getWorkflowRuns as jest.Mock).mockResolvedValue(mockRuns);

      const response = await request(app)
        .get('/api/runs/workflow/workflow-1')
        .expect(200);

      expect(response.body).toEqual({
        runs: mockRuns,
        workflowId: 'workflow-1',
        total: 1,
      });

      expect(mockService.getWorkflowRuns).toHaveBeenCalledWith('workflow-1', 100);
    });

    test('should respect limit parameter', async () => {
      const mockRuns: RunRecord[] = [];
      (mockService.getWorkflowRuns as jest.Mock).mockResolvedValue(mockRuns);

      await request(app)
        .get('/api/runs/workflow/workflow-1')
        .query({ limit: '50' })
        .expect(200);

      expect(mockService.getWorkflowRuns).toHaveBeenCalledWith('workflow-1', 50);
    });
  });

  describe('GET /api/runs/execution/:executionId', () => {
    test('should return execution trace', async () => {
      const mockTrace: RunRecord[] = [
        {
          id: 'run-1',
          workflowId: 'workflow-1',
          executionId: 'exec-1',
          runType: 'workflow_execution',
          status: 'running',
          startTime: '2024-01-01T00:00:00.000Z',
        },
        {
          id: 'run-2',
          workflowId: 'workflow-1',
          executionId: 'exec-1',
          runType: 'agent_execution',
          status: 'completed',
          startTime: '2024-01-01T00:00:30.000Z',
          parentRunId: 'run-1',
        },
      ];

      (mockService.getExecutionTrace as jest.Mock).mockResolvedValue(mockTrace);

      const response = await request(app)
        .get('/api/runs/execution/exec-1')
        .expect(200);

      expect(response.body).toEqual({
        trace: mockTrace,
        executionId: 'exec-1',
        total: 2,
      });

      expect(mockService.getExecutionTrace).toHaveBeenCalledWith('exec-1');
    });
  });

  describe('GET /api/runs/stats', () => {
    test('should return run statistics', async () => {
      const mockStats = {
        totalRuns: 100,
        successfulRuns: 85,
        failedRuns: 15,
        averageDuration: 5000,
        totalTokens: 50000,
      };

      (mockService.getRunStats as jest.Mock).mockResolvedValue(mockStats);

      const response = await request(app)
        .get('/api/runs/stats')
        .expect(200);

      expect(response.body).toEqual({
        stats: mockStats,
        workflowId: 'all',
      });

      expect(mockService.getRunStats).toHaveBeenCalledWith(undefined);
    });

    test('should return stats for specific workflow', async () => {
      const mockStats = {
        totalRuns: 50,
        successfulRuns: 45,
        failedRuns: 5,
        averageDuration: 3000,
        totalTokens: 25000,
      };

      (mockService.getRunStats as jest.Mock).mockResolvedValue(mockStats);

      const response = await request(app)
        .get('/api/runs/stats')
        .query({ workflowId: 'workflow-1' })
        .expect(200);

      expect(response.body).toEqual({
        stats: mockStats,
        workflowId: 'workflow-1',
      });

      expect(mockService.getRunStats).toHaveBeenCalledWith('workflow-1');
    });
  });

  describe('GET /api/runs/performance', () => {
    test('should return performance metrics', async () => {
      const mockMetrics = {
        averageTokensPerRun: 500,
        averageMemoryUsage: 128.5,
        averageCpuTime: 1500,
        totalRuns: 100,
      };

      (mockService.getPerformanceMetrics as jest.Mock).mockResolvedValue(mockMetrics);

      const response = await request(app)
        .get('/api/runs/performance')
        .expect(200);

      expect(response.body).toEqual({
        metrics: mockMetrics,
        workflowId: 'all',
      });

      expect(mockService.getPerformanceMetrics).toHaveBeenCalledWith(undefined);
    });
  });

  describe('GET /api/runs/errors', () => {
    test('should return recent errors', async () => {
      const mockErrors: RunRecord[] = [
        {
          id: 'run-1',
          workflowId: 'workflow-1',
          runType: 'agent_execution',
          status: 'failed',
          startTime: '2024-01-01T00:00:00.000Z',
          errorMessage: 'Agent execution failed',
          errorCode: 'AGENT_ERROR',
        },
      ];

      (mockService.getRecentErrors as jest.Mock).mockResolvedValue(mockErrors);

      const response = await request(app)
        .get('/api/runs/errors')
        .expect(200);

      expect(response.body).toEqual({
        errors: mockErrors,
        total: 1,
      });

      expect(mockService.getRecentErrors).toHaveBeenCalledWith(50);
    });

    test('should respect limit parameter', async () => {
      (mockService.getRecentErrors as jest.Mock).mockResolvedValue([]);

      await request(app)
        .get('/api/runs/errors')
        .query({ limit: '20' })
        .expect(200);

      expect(mockService.getRecentErrors).toHaveBeenCalledWith(20);
    });
  });

  describe('POST /api/runs/export', () => {
    test('should export runs with filters', async () => {
      const mockRuns: RunRecord[] = [
        {
          id: 'run-1',
          workflowId: 'workflow-1',
          runType: 'workflow_execution',
          status: 'completed',
          startTime: '2024-01-01T00:00:00.000Z',
        },
      ];

      (mockService.exportRuns as jest.Mock).mockResolvedValue(mockRuns);

      const exportFilters = {
        workflowId: 'workflow-1',
        status: 'completed',
      };

      const response = await request(app)
        .post('/api/runs/export')
        .send(exportFilters)
        .expect(200);

      expect(response.headers['content-type']).toMatch(/application\/json/);
      expect(response.headers['content-disposition']).toMatch(/attachment; filename=/);

      expect(response.body).toMatchObject({
        filters: exportFilters,
        totalRuns: 1,
        runs: mockRuns,
      });

      expect(response.body.exportedAt).toBeDefined();
      expect(mockService.exportRuns).toHaveBeenCalledWith(exportFilters);
    });

    test('should validate export filters', async () => {
      const response = await request(app)
        .post('/api/runs/export')
        .send({
          status: 'invalid-status',
          limit: 'not-a-number',
        })
        .expect(400);

      expect(response.body.error).toBe('Validation Error');
      expect(mockService.exportRuns).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/runs/analytics', () => {
    test('should return comprehensive analytics', async () => {
      const mockStats = {
        totalRuns: 100,
        successfulRuns: 85,
        failedRuns: 15,
        averageDuration: 5000,
        totalTokens: 50000,
      };

      const mockPerformance = {
        averageTokensPerRun: 500,
        averageMemoryUsage: 128.5,
        averageCpuTime: 1500,
        totalRuns: 100,
      };

      const mockErrors: RunRecord[] = [
        {
          id: 'run-1',
          workflowId: 'workflow-1',
          runType: 'agent_execution',
          status: 'failed',
          startTime: '2024-01-01T00:00:00.000Z',
          errorMessage: 'Test error',
        },
      ];

      (mockService.getRunStats as jest.Mock).mockResolvedValue(mockStats);
      (mockService.getPerformanceMetrics as jest.Mock).mockResolvedValue(mockPerformance);
      (mockService.getRecentErrors as jest.Mock).mockResolvedValue(mockErrors);

      const response = await request(app)
        .get('/api/runs/analytics')
        .expect(200);

      expect(response.body).toMatchObject({
        workflowId: 'all',
        stats: mockStats,
        performance: mockPerformance,
        recentErrors: mockErrors,
      });

      expect(response.body.generatedAt).toBeDefined();

      expect(mockService.getRunStats).toHaveBeenCalledWith(undefined);
      expect(mockService.getPerformanceMetrics).toHaveBeenCalledWith(undefined);
      expect(mockService.getRecentErrors).toHaveBeenCalledWith(10);
    });

    test('should return analytics for specific workflow', async () => {
      (mockService.getRunStats as jest.Mock).mockResolvedValue({});
      (mockService.getPerformanceMetrics as jest.Mock).mockResolvedValue({});
      (mockService.getRecentErrors as jest.Mock).mockResolvedValue([]);

      const response = await request(app)
        .get('/api/runs/analytics')
        .query({ workflowId: 'workflow-1' })
        .expect(200);

      expect(response.body.workflowId).toBe('workflow-1');
      expect(mockService.getRunStats).toHaveBeenCalledWith('workflow-1');
      expect(mockService.getPerformanceMetrics).toHaveBeenCalledWith('workflow-1');
    });
  });

  describe('Error handling', () => {
    test('should handle service errors gracefully', async () => {
      (mockService.exportRuns as jest.Mock).mockRejectedValue(new Error('Database connection failed'));

      await request(app)
        .get('/api/runs')
        .expect(500);
    });

    test('should validate date filters', async () => {
      const response = await request(app)
        .get('/api/runs')
        .query({
          startDate: 'invalid-date',
          endDate: 'also-invalid',
        })
        .expect(400);

      expect(response.body.error).toBe('Validation Error');
    });

    test('should validate limit boundaries', async () => {
      const response = await request(app)
        .get('/api/runs')
        .query({
          limit: '2000', // Above max limit of 1000
        })
        .expect(400);

      expect(response.body.error).toBe('Validation Error');
    });
  });

  describe('Integration scenarios', () => {
    test('should handle complex filter combinations', async () => {
      (mockService.exportRuns as jest.Mock).mockResolvedValue([]);

      const complexFilters = {
        workflowId: 'workflow-1',
        status: 'completed',
        runType: 'agent_execution',
        agentId: 'agent-1',
        startDate: '2024-01-01T00:00:00.000Z',
        endDate: '2024-01-02T00:00:00.000Z',
        limit: '100',
      };

      await request(app)
        .get('/api/runs')
        .query(complexFilters)
        .expect(200);

      expect(mockService.exportRuns).toHaveBeenCalledWith({
        workflowId: 'workflow-1',
        status: 'completed',
        runType: 'agent_execution',
        agentId: 'agent-1',
        startDate: '2024-01-01T00:00:00.000Z',
        endDate: '2024-01-02T00:00:00.000Z',
        limit: 100,
      });
    });

    test('should handle empty results', async () => {
      (mockService.exportRuns as jest.Mock).mockResolvedValue([]);
      (mockService.getRecentErrors as jest.Mock).mockResolvedValue([]);

      const response = await request(app)
        .get('/api/runs')
        .expect(200);

      expect(response.body).toEqual({
        runs: [],
        total: 0,
        filters: {},
      });
    });
  });
});