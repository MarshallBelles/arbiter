
import { NextApiRequest, NextApiResponse } from 'next';
import { getArbiterService } from '@/lib/services/service-manager';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    const service = await getArbiterService();
    const { status, runType, workflowId, agentId, limit = 100 } = req.query;

    const runs = await service.runRepository.search({
      status: status as string,
      runType: runType as string,
      workflowId: workflowId as string,
      agentId: agentId as string,
      limit: Number(limit),
    });

    res.status(200).json({ runs });
  } else {
    res.setHeader('Allow', ['GET']);
    res.status(405).json({ message: `Method ${req.method} Not Allowed` });
  }
}
