import { NextApiRequest, NextApiResponse } from 'next';
import Joi from 'joi';
import { ArbiterServiceDB } from '@/lib/services/arbiter-service-db';
import { WorkflowConfig } from '@/lib/core';
import { sanitizeWorkflowConfig } from '@/lib/utils/sanitization';

// Initialize Arbiter service (singleton)
let arbiterService: ArbiterServiceDB | null = null;

function getArbiterService(): ArbiterServiceDB {
  if (!arbiterService) {
    arbiterService = new ArbiterServiceDB(
      process.env.DATABASE_PATH || './data/arbiter.db'
    );
  }
  return arbiterService;
}

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

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const service = getArbiterService();
  await service.initialize();

  try {
    if (req.method === 'GET') {
      // GET /api/workflows - List all workflows
      const page = parseInt(req.query.page as string) || 1;
      const limit = Math.min(parseInt(req.query.limit as string) || 10, 100);
      const offset = (page - 1) * limit;

      const allWorkflows = await service.listWorkflows();
      
      // Apply pagination
      const total = allWorkflows.length;
      const workflows = allWorkflows.slice(offset, offset + limit);

      res.status(200).json({
        workflows,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      });

    } else if (req.method === 'POST') {
      // POST /api/workflows - Create new workflow
      const { name, description } = req.body;

      if (!name || !description) {
        return res.status(400).json({ error: 'Name and description are required' });
      }

      const newWorkflow: WorkflowConfig = {
        id: `wf-${Date.now()}`,
        name,
        description,
        version: '1.0.0',
        trigger: { type: 'manual', config: {} },
        rootAgent: { 
          id: 'agent-0', 
          name: 'Start', 
          description: 'Initial agent', 
          model: 'default', 
          systemPrompt: 'You are the starting agent.', 
          availableTools: [], 
          level: 0 
        },
        levels: [],
      };

      const sanitizedConfig = sanitizeWorkflowConfig(newWorkflow);
      const workflow = await service.createWorkflow(sanitizedConfig);
      
      res.status(201).json(workflow);

    } else {
      res.setHeader('Allow', ['GET', 'POST']);
      res.status(405).json({ message: 'Method not allowed' });
    }

  } catch (error) {
    console.error('Workflows API error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}