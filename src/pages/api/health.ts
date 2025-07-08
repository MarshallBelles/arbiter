import { NextApiRequest, NextApiResponse } from 'next';
import { getArbiterService, getServiceStatus, validateServiceHealth } from '@/lib/services/service-manager';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    try {
      // Initialize service and get status
      const service = await getArbiterService();
      const serviceStatus = await service.getStatus();
      const serviceManagerStatus = getServiceStatus();
      
      res.status(200).json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        version: process.env.npm_package_version || '1.0.0',
        serviceManager: serviceManagerStatus,
        arbiterService: serviceStatus,
      });
    } catch (error) {
      const serviceManagerStatus = getServiceStatus();
      
      res.status(500).json({
        status: 'error',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
        serviceManager: serviceManagerStatus,
      });
    }
  } else {
    res.setHeader('Allow', ['GET']);
    res.status(405).json({ message: 'Method not allowed' });
  }
}