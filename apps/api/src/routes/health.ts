import { Router } from 'express';
import { ArbiterService } from '../services/arbiter-service.js';

const router = Router();

router.get('/', (req, res) => {
  const arbiterService = (req as any).arbiterService as ArbiterService;
  const status = arbiterService.getStatus();
  
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0',
    ...status,
  });
});

router.get('/ping', (req, res) => {
  res.json({ message: 'pong' });
});

export { router as healthRoutes };