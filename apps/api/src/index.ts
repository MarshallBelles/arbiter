import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { createLogger } from '@arbiter/core';
import { ArbiterServiceDB } from './services/arbiter-service-db.js';
import { workflowRoutes } from './routes/workflows.js';
import { agentRoutes } from './routes/agents.js';
import { eventRoutes } from './routes/events.js';
import { healthRoutes } from './routes/health.js';
import { runRoutes } from './routes/runs.js';
import { errorHandler } from './middleware/error-handler.js';

const logger = createLogger('ArbiterAPI');

const app = express();
const port = process.env.PORT || 3001;

// Initialize Arbiter service with database
const arbiterService = new ArbiterServiceDB();

// Middleware
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
}));

app.use(morgan('combined', {
  stream: {
    write: (message: string) => logger.info(message.trim()),
  },
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
});
app.use('/api/', limiter);

// Add arbiter service to request context
app.use((req, res, next) => {
  (req as any).arbiterService = arbiterService;
  next();
});

// Routes
app.use('/api/health', healthRoutes);
app.use('/api/workflows', workflowRoutes);
app.use('/api/agents', agentRoutes);
app.use('/api/events', eventRoutes);
app.use('/api/runs', runRoutes);

// Error handling
app.use(errorHandler);

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.originalUrl} not found`,
  });
});

async function startServer() {
  try {
    // Initialize Arbiter service
    await arbiterService.initialize();
    
    app.listen(port, () => {
      logger.info(`Arbiter API server started on port ${port}`, {
        port,
        environment: process.env.NODE_ENV || 'development',
      });
    });
  } catch (error) {
    logger.error('Failed to start server', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  logger.info('Received SIGINT, shutting down gracefully');
  await arbiterService.shutdown();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM, shutting down gracefully');
  await arbiterService.shutdown();
  process.exit(0);
});

startServer();