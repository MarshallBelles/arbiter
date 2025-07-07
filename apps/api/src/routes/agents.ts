import { Router } from 'express';
import Joi from 'joi';
import { ArbiterService } from '../services/arbiter-service.js';
import { AgentConfig } from '@arbiter/core';
import { sanitizeAgentConfig, sanitizeExecutionInput } from '../utils/sanitization';

const router = Router();

// Validation schemas
const agentSchema = Joi.object({
  id: Joi.string().required(),
  name: Joi.string().required(),
  description: Joi.string().required(),
  model: Joi.string().required(),
  systemPrompt: Joi.string().required(),
  availableTools: Joi.array().items(Joi.string()).required(),
  inputSchema: Joi.object().optional(),
  outputSchema: Joi.object().optional(),
  level: Joi.number().min(0).required(),
  metadata: Joi.object().optional(),
});

const executeAgentSchema = Joi.object({
  input: Joi.any().required(),
  userPrompt: Joi.string().optional(),
});

// GET /api/agents - List all agents
router.get('/', async (req, res, next) => {
  try {
    const arbiterService = (req as any).arbiterService as ArbiterService;
    const agents = await arbiterService.listAgents();
    res.json(agents);
  } catch (error) {
    next(error);
  }
});

// POST /api/agents - Create a new agent
router.post('/', async (req, res, next) => {
  try {
    const { error, value } = agentSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        error: 'Validation Error',
        message: error.details[0].message,
        details: error.details,
      });
    }

    const agentConfig: AgentConfig = sanitizeAgentConfig(value);

    const arbiterService = (req as any).arbiterService as ArbiterService;
    const agentId = await arbiterService.createAgent(agentConfig);
    
    res.status(201).json({
      id: agentId,
      message: 'Agent created successfully',
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/agents/:id - Get a specific agent
router.get('/:id', async (req, res, next) => {
  try {
    const arbiterService = (req as any).arbiterService as ArbiterService;
    const agent = await arbiterService.getAgent(req.params.id);
    
    if (!agent) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Agent not found',
      });
    }
    
    res.json(agent);
  } catch (error) {
    next(error);
  }
});

// PUT /api/agents/:id - Update an agent
router.put('/:id', async (req, res, next) => {
  try {
    const { error, value } = agentSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        error: 'Validation Error',
        message: error.details[0].message,
        details: error.details,
      });
    }

    const agentConfig: AgentConfig = {
      ...sanitizeAgentConfig(value),
      id: req.params.id,
    };

    const arbiterService = (req as any).arbiterService as ArbiterService;
    await arbiterService.updateAgent(req.params.id, agentConfig);
    
    res.json({
      message: 'Agent updated successfully',
    });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/agents/:id - Delete an agent
router.delete('/:id', async (req, res, next) => {
  try {
    const arbiterService = (req as any).arbiterService as ArbiterService;
    await arbiterService.deleteAgent(req.params.id);
    
    res.json({
      message: 'Agent deleted successfully',
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/agents/:id/execute - Execute an agent
router.post('/:id/execute', async (req, res, next) => {
  try {
    const { error, value } = executeAgentSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        error: 'Validation Error',
        message: error.details[0].message,
        details: error.details,
      });
    }

    const arbiterService = (req as any).arbiterService as ArbiterService;
    const result = await arbiterService.executeAgent(
      req.params.id,
      sanitizeExecutionInput(value.input),
      value.userPrompt ? sanitizeExecutionInput(value.userPrompt) : undefined
    );
    
    res.json({
      result,
      message: 'Agent executed successfully',
    });
  } catch (error) {
    next(error);
  }
});

export { router as agentRoutes };