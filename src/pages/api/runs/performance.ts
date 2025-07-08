import { NextApiRequest, NextApiResponse } from 'next';
import { getArbiterService } from '@/lib/services/service-manager';

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
