import { Router } from 'express';
import Joi from 'joi';
import { ArbiterService } from '../services/arbiter-service.js';

const router = Router();

// Validation schemas
const manualEventSchema = Joi.object({
  data: Joi.any().required(),
});

// GET /api/events/handlers - List all event handlers
router.get('/handlers', async (req, res, next) => {
  try {
    const arbiterService = (req as any).arbiterService as ArbiterService;
    const handlers = await arbiterService.getEventHandlers();
    res.json(handlers);
  } catch (error) {
    next(error);
  }
});

// POST /api/events/handlers/:id/enable - Enable an event handler
router.post('/handlers/:id/enable', async (req, res, next) => {
  try {
    const arbiterService = (req as any).arbiterService as ArbiterService;
    await arbiterService.enableEventHandler(req.params.id);
    
    res.json({
      message: 'Event handler enabled successfully',
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/events/handlers/:id/disable - Disable an event handler
router.post('/handlers/:id/disable', async (req, res, next) => {
  try {
    const arbiterService = (req as any).arbiterService as ArbiterService;
    await arbiterService.disableEventHandler(req.params.id);
    
    res.json({
      message: 'Event handler disabled successfully',
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/events/trigger/:workflowId - Trigger a manual event for a workflow
router.post('/trigger/:workflowId', async (req, res, next) => {
  try {
    const { error, value } = manualEventSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        error: 'Validation Error',
        message: error.details[0].message,
        details: error.details,
      });
    }

    const arbiterService = (req as any).arbiterService as ArbiterService;
    const result = await arbiterService.triggerManualEvent(req.params.workflowId, value.data);
    
    res.json({
      result,
      message: 'Manual event triggered successfully',
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/events/executions - Get active executions
router.get('/executions', async (req, res, next) => {
  try {
    const arbiterService = (req as any).arbiterService as ArbiterService;
    const activeExecutions = arbiterService.getActiveExecutions();
    
    const executions = activeExecutions.map(exec => exec.execution);
    res.json(executions);
  } catch (error) {
    next(error);
  }
});

// GET /api/events/executions/:id - Get a specific execution
router.get('/executions/:id', async (req, res, next) => {
  try {
    const arbiterService = (req as any).arbiterService as ArbiterService;
    const execution = arbiterService.getExecution(req.params.id);
    
    if (!execution) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Execution not found',
      });
    }
    
    res.json(execution.execution);
  } catch (error) {
    next(error);
  }
});

// POST /api/events/executions/:id/cancel - Cancel an execution
router.post('/executions/:id/cancel', async (req, res, next) => {
  try {
    const arbiterService = (req as any).arbiterService as ArbiterService;
    const cancelled = await arbiterService.cancelExecution(req.params.id);
    
    if (!cancelled) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Execution not found or already completed',
      });
    }
    
    res.json({
      message: 'Execution cancelled successfully',
    });
  } catch (error) {
    next(error);
  }
});

export { router as eventRoutes };