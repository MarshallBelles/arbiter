import { Router } from 'express';
import Joi from 'joi';
import { ArbiterService } from '../services/arbiter-service';
import { WorkflowConfig } from '@arbiter/core';
import { sanitizeWorkflowConfig, sanitizeExecutionInput } from '../utils/sanitization';

const router = Router();

// Validation schemas
const workflowSchema = Joi.object({
  id: Joi.string().required(),
  name: Joi.string().required(),
  description: Joi.string().required(),
  version: Joi.string().required(),
  userPrompt: Joi.string().optional(),
  trigger: Joi.object({
    type: Joi.string().valid('webhook', 'cron', 'manual', 'file-watch', 'api').required(),
    config: Joi.object().required(),
  }).required(),
  rootAgent: Joi.object({
    id: Joi.string().required(),
    name: Joi.string().required(),
    description: Joi.string().required(),
    model: Joi.string().required(),
    systemPrompt: Joi.string().required(),
    availableTools: Joi.array().items(Joi.string()).required(),
    level: Joi.number().min(0).required(),
  }).required(),
  levels: Joi.array().items(Joi.object({
    level: Joi.number().min(1).required(),
    agents: Joi.array().items(Joi.object({
      id: Joi.string().required(),
      name: Joi.string().required(),
      description: Joi.string().required(),
      model: Joi.string().required(),
      systemPrompt: Joi.string().required(),
      availableTools: Joi.array().items(Joi.string()).required(),
      level: Joi.number().min(1).required(),
    })).required(),
    executionMode: Joi.string().valid('parallel', 'conditional').required(),
  })).required(),
  metadata: Joi.object().optional(),
});

const executeWorkflowSchema = Joi.object({
  data: Joi.any().required(),
});

// GET /api/workflows - List all workflows
router.get('/', async (req, res, next) => {
  try {
    const arbiterService = (req as any).arbiterService as ArbiterService;
    const workflows = await arbiterService.listWorkflows();
    res.json(workflows);
  } catch (error) {
    next(error);
  }
});

// POST /api/workflows - Create a new workflow
router.post('/', async (req, res, next) => {
  try {
    const { error, value } = workflowSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        error: 'Validation Error',
        message: error.details[0].message,
        details: error.details,
      });
    }

    const workflowConfig: WorkflowConfig = {
      ...sanitizeWorkflowConfig(value),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const arbiterService = (req as any).arbiterService as ArbiterService;
    const workflowId = await arbiterService.createWorkflow(workflowConfig);
    
    res.status(201).json({
      id: workflowId,
      message: 'Workflow created successfully',
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/workflows/:id - Get a specific workflow
router.get('/:id', async (req, res, next) => {
  try {
    const arbiterService = (req as any).arbiterService as ArbiterService;
    const workflow = await arbiterService.getWorkflow(req.params.id);
    
    if (!workflow) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Workflow not found',
      });
    }
    
    res.json(workflow);
  } catch (error) {
    next(error);
  }
});

// PUT /api/workflows/:id - Update a workflow
router.put('/:id', async (req, res, next) => {
  try {
    const { error, value } = workflowSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        error: 'Validation Error',
        message: error.details[0].message,
        details: error.details,
      });
    }

    const workflowConfig: WorkflowConfig = {
      ...sanitizeWorkflowConfig(value),
      id: req.params.id,
      updatedAt: new Date(),
    };

    const arbiterService = (req as any).arbiterService as ArbiterService;
    await arbiterService.updateWorkflow(req.params.id, workflowConfig);
    
    res.json({
      message: 'Workflow updated successfully',
    });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/workflows/:id - Delete a workflow
router.delete('/:id', async (req, res, next) => {
  try {
    const arbiterService = (req as any).arbiterService as ArbiterService;
    await arbiterService.deleteWorkflow(req.params.id);
    
    res.json({
      message: 'Workflow deleted successfully',
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/workflows/:id/execute - Execute a workflow manually
router.post('/:id/execute', async (req, res, next) => {
  try {
    const { error, value } = executeWorkflowSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        error: 'Validation Error',
        message: error.details[0].message,
        details: error.details,
      });
    }

    const arbiterService = (req as any).arbiterService as ArbiterService;
    const execution = await arbiterService.executeWorkflow(req.params.id, sanitizeExecutionInput(value.data));
    
    res.json({
      executionId: execution.id,
      status: execution.status,
      startTime: execution.startTime,
      message: 'Workflow execution started',
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/workflows/:id/executions - Get workflow executions
router.get('/:id/executions', async (req, res, next) => {
  try {
    const arbiterService = (req as any).arbiterService as ArbiterService;
    const activeExecutions = arbiterService.getActiveExecutions();
    
    // Filter executions for this workflow
    const workflowExecutions = activeExecutions
      .filter(exec => exec.execution.workflowId === req.params.id)
      .map(exec => exec.execution);
    
    res.json(workflowExecutions);
  } catch (error) {
    next(error);
  }
});

export { router as workflowRoutes };