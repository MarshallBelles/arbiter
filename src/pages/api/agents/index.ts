import { NextApiRequest, NextApiResponse } from 'next';
import Joi from 'joi';
import { ArbiterServiceDB } from '@/lib/services/arbiter-service-db';
import { AgentConfig } from '@/lib/core';
import { sanitizeAgentConfig } from '@/lib/utils/sanitization';

// Initialize Arbiter service (singleton)
let arbiterService: ArbiterServiceDB | null = null;

async function getArbiterService(): Promise<ArbiterServiceDB> {
  if (!arbiterService) {
    arbiterService = new ArbiterServiceDB(
      process.env.DATABASE_PATH || './data/arbiter.db'
    );
    await arbiterService.initialize();
  }
  return arbiterService;
}

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

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const service = await getArbiterService();

  try {
    if (req.method === 'GET') {
      // GET /api/agents - List all agents
      const page = parseInt(req.query.page as string) || 1;
      const limit = Math.min(parseInt(req.query.limit as string) || 10, 100);
      const offset = (page - 1) * limit;
      
      const level = req.query.level ? parseInt(req.query.level as string) : undefined;
      const model = req.query.model as string;

      const allAgents = await service.listAgents();
      
      // Apply filters
      let filteredAgents = allAgents;
      if (level !== undefined) {
        filteredAgents = filteredAgents.filter(agent => agent.level === level);
      }
      if (model) {
        filteredAgents = filteredAgents.filter(agent => agent.model === model);
      }
      
      // Apply pagination
      const total = filteredAgents.length;
      const agents = filteredAgents.slice(offset, offset + limit);

      res.status(200).json({
        agents,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      });

    } else if (req.method === 'POST') {
      // POST /api/agents - Create new agent
      const { error, value } = agentSchema.validate(req.body);
      if (error) {
        return res.status(400).json({
          error: 'Validation failed',
          details: error.details.map(d => d.message),
        });
      }

      const sanitizedConfig = sanitizeAgentConfig(value as AgentConfig);
      const agent = await service.createAgent(sanitizedConfig);
      
      res.status(201).json(agent);

    } else {
      res.setHeader('Allow', ['GET', 'POST']);
      res.status(405).json({ message: 'Method not allowed' });
    }

  } catch (error) {
    console.error('Agents API error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}