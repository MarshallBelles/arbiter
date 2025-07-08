import { NextApiRequest, NextApiResponse } from 'next';
import { ArbiterServiceDB } from '@/lib/services/arbiter-service-db';

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

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query;
  const service = getArbiterService();

  if (typeof id !== 'string') {
    return res.status(400).json({ error: 'Invalid workflow ID' });
  }

  try {
    if (req.method === 'GET') {
      // GET /api/workflows/:id - Get specific workflow
      const workflow = await service.getWorkflow(id);
      if (!workflow) {
        return res.status(404).json({ error: 'Workflow not found' });
      }
      res.status(200).json(workflow);

    } else if (req.method === 'PUT') {
      // PUT /api/workflows/:id - Update workflow
      await service.updateWorkflow(id, req.body);
      const updatedWorkflow = await service.getWorkflow(id);
      if (!updatedWorkflow) {
        return res.status(404).json({ error: 'Workflow not found' });
      }
      res.status(200).json(updatedWorkflow);

    } else if (req.method === 'DELETE') {
      // DELETE /api/workflows/:id - Delete workflow
      try {
        await service.deleteWorkflow(id);
        res.status(204).end();
      } catch (error) {
        if (error instanceof Error && error.message.includes('not found')) {
          return res.status(404).json({ error: 'Workflow not found' });
        }
        throw error;
      }

    } else {
      res.setHeader('Allow', ['GET', 'PUT', 'DELETE']);
      res.status(405).json({ message: 'Method not allowed' });
    }

  } catch (error) {
    console.error('Workflow API error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}