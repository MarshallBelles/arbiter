
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
  if (req.method === 'POST') {
    const service = await getArbiterService();
    const filters = req.body;
    const runs = await service.runRepository.export(filters);

    const exportData = {
      exportedAt: new Date().toISOString(),
      filterSummary: filters,
      runs,
    };

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename=runs-export.json');
    res.status(200).json(exportData);
  } else {
    res.setHeader('Allow', ['POST']);
    res.status(405).json({ message: `Method ${req.method} Not Allowed` });
  }
}
