import { Router } from 'express';
import Joi from 'joi';
import { ArbiterServiceDB } from '../services/arbiter-service-db';

const router = Router();

// Validation schemas
const runFiltersSchema = Joi.object({
  workflowId: Joi.string().optional(),
  executionId: Joi.string().optional(),
  status: Joi.string().valid('pending', 'running', 'completed', 'failed', 'cancelled').optional(),
  runType: Joi.string().valid('workflow_execution', 'agent_execution', 'tool_call', 'api_request', 'model_request').optional(),
  agentId: Joi.string().optional(),
  startDate: Joi.string().isoDate().optional(),
  endDate: Joi.string().isoDate().optional(),
  limit: Joi.number().integer().min(1).max(1000).optional(),
});

// GET /api/runs - Search runs with filters
router.get('/', async (req, res, next) => {
  try {
    const { error, value } = runFiltersSchema.validate(req.query);
    if (error) {
      return res.status(400).json({
        error: 'Validation Error',
        message: error.details[0].message,
        details: error.details,
      });
    }

    const arbiterService = (req as any).arbiterService as ArbiterServiceDB;
    const runs = await arbiterService.exportRuns(value);
    
    res.json({
      runs,
      total: runs.length,
      filters: value,
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/runs/workflow/:workflowId - Get runs for a specific workflow
router.get('/workflow/:workflowId', async (req, res, next) => {
  try {
    const { workflowId } = req.params;
    const limit = parseInt(req.query.limit as string) || 100;

    const arbiterService = (req as any).arbiterService as ArbiterServiceDB;
    const runs = await arbiterService.getWorkflowRuns(workflowId, limit);
    
    res.json({
      runs,
      workflowId,
      total: runs.length,
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/runs/execution/:executionId - Get execution trace
router.get('/execution/:executionId', async (req, res, next) => {
  try {
    const { executionId } = req.params;

    const arbiterService = (req as any).arbiterService as ArbiterServiceDB;
    const trace = await arbiterService.getExecutionTrace(executionId);
    
    res.json({
      trace,
      executionId,
      total: trace.length,
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/runs/stats - Get run statistics
router.get('/stats', async (req, res, next) => {
  try {
    const workflowId = req.query.workflowId as string;

    const arbiterService = (req as any).arbiterService as ArbiterServiceDB;
    const stats = await arbiterService.getRunStats(workflowId);
    
    res.json({
      stats,
      workflowId: workflowId || 'all',
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/runs/performance - Get performance metrics
router.get('/performance', async (req, res, next) => {
  try {
    const workflowId = req.query.workflowId as string;

    const arbiterService = (req as any).arbiterService as ArbiterServiceDB;
    const metrics = await arbiterService.getPerformanceMetrics(workflowId);
    
    res.json({
      metrics,
      workflowId: workflowId || 'all',
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/runs/errors - Get recent errors
router.get('/errors', async (req, res, next) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;

    const arbiterService = (req as any).arbiterService as ArbiterServiceDB;
    const errors = await arbiterService.getRecentErrors(limit);
    
    res.json({
      errors,
      total: errors.length,
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/runs/export - Export runs to file
router.post('/export', async (req, res, next) => {
  try {
    const { error, value } = runFiltersSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        error: 'Validation Error',
        message: error.details[0].message,
        details: error.details,
      });
    }

    const arbiterService = (req as any).arbiterService as ArbiterServiceDB;
    const runs = await arbiterService.exportRuns(value);
    
    // Set headers for file download
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `arbiter-runs-${timestamp}.json`;
    
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    
    res.json({
      exportedAt: new Date().toISOString(),
      filters: value,
      totalRuns: runs.length,
      runs,
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/runs/analytics - Get comprehensive analytics
router.get('/analytics', async (req, res, next) => {
  try {
    const workflowId = req.query.workflowId as string;

    const arbiterService = (req as any).arbiterService as ArbiterServiceDB;
    
    const [stats, performance, recentErrors] = await Promise.all([
      arbiterService.getRunStats(workflowId),
      arbiterService.getPerformanceMetrics(workflowId),
      arbiterService.getRecentErrors(10),
    ]);
    
    res.json({
      workflowId: workflowId || 'all',
      stats,
      performance,
      recentErrors,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    next(error);
  }
});

export { router as runRoutes };