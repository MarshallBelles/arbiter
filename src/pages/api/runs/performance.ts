
import { NextApiRequest, NextApiResponse } from 'next';
import { ArbiterServiceDB } from '@/lib/services/arbiter-service-db';

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
  if (req.method === 'GET') {
    const service = await getArbiterService();
    const metrics = await service.runRepository.getPerformanceMetrics();
    res.status(200).json({ metrics });
  } else {
    res.setHeader('Allow', ['GET']);
    res.status(405).json({ message: `Method ${req.method} Not Allowed` });
  }
}
