import { NextApiRequest, NextApiResponse } from 'next';
import { getArbiterService } from '@/lib/services/service-manager';

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
