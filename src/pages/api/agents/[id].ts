
import { NextApiRequest, NextApiResponse } from 'next';
import { ArbiterServiceDB } from '@/lib/services/arbiter-service-db';
import { sanitizeAgentConfig } from '@/lib/utils/sanitization';

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

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const service = await getArbiterService();
  const { id } = req.query;

  if (typeof id !== 'string') {
    return res.status(400).json({ error: 'Invalid agent ID' });
  }

  try {
    if (req.method === 'GET') {
      const agent = await service.agentRepository.findById(id);
      if (agent) {
        res.status(200).json(agent);
      } else {
        res.status(404).json({ error: 'Agent not found' });
      }
    } else if (req.method === 'PUT') {
      const updatedAgent = await service.updateAgent(id, req.body);
      res.status(200).json(updatedAgent);
    } else if (req.method === 'DELETE') {
      await service.deleteAgent(id);
      res.status(204).end();
    } else {
      res.setHeader('Allow', ['GET', 'PUT', 'DELETE']);
      res.status(405).json({ message: `Method ${req.method} Not Allowed` });
    }
  } catch (error) {
    console.error(`Agent API Error for ID: ${id}`, error);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
}
