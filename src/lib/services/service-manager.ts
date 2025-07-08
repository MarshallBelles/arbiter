import { ArbiterServiceDB } from './arbiter-service-db';
import { createLogger } from '@/lib/core/utils/logger';

const logger = createLogger('ServiceManager');

class ServiceManager {
  private static instance: ServiceManager | null = null;
  private arbiterService: ArbiterServiceDB | null = null;
  private isInitialized = false;
  private initializationPromise: Promise<ArbiterServiceDB> | null = null;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private cleanupHandlersSet = false;

  private constructor() {
    // Private constructor to prevent direct instantiation
  }

  /**
   * Get the singleton instance of ServiceManager
   */
  static getInstance(): ServiceManager {
    if (!ServiceManager.instance) {
      ServiceManager.instance = new ServiceManager();
    }
    return ServiceManager.instance;
  }

  /**
   * Initialize the Arbiter service if not already initialized
   */
  async initializeService(): Promise<ArbiterServiceDB> {
    // If already initialized, return the existing service
    if (this.isInitialized && this.arbiterService) {
      return this.arbiterService;
    }

    // If initialization is in progress, wait for it to complete
    if (this.initializationPromise) {
      return await this.initializationPromise;
    }

    // Start the initialization process
    this.initializationPromise = this.performInitialization();
    
    try {
      const service = await this.initializationPromise;
      this.isInitialized = true;
      return service;
    } catch (error) {
      // Reset the promise on error so it can be retried
      this.initializationPromise = null;
      throw error;
    }
  }
  
  /**
   * Perform the actual initialization (called only once)
   */
  private async performInitialization(): Promise<ArbiterServiceDB> {
    logger.info('Initializing Arbiter service singleton...');
    
    try {
      const databasePath = process.env.DATABASE_PATH || './data/arbiter.db';
      this.arbiterService = new ArbiterServiceDB(databasePath);
      
      // Initialize the service (load persisted data, start event system, etc.)
      await this.arbiterService.initialize();
      
      logger.info('Arbiter service singleton initialized successfully');
      
      // Set up cleanup on process termination
      this.setupCleanupHandlers();
      
      // Start health monitoring in production
      this.startHealthMonitoring();
      
      return this.arbiterService;
    } catch (error) {
      logger.error('Failed to initialize Arbiter service', { 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
      throw error;
    }
  }

  /**
   * Get the Arbiter service instance (initializes if needed)
   */
  async getService(): Promise<ArbiterServiceDB> {
    return await this.initializeService();
  }

  /**
   * Check if the service is initialized
   */
  isServiceInitialized(): boolean {
    return this.isInitialized && this.arbiterService !== null;
  }

  /**
   * Shutdown the service gracefully
   */
  async shutdown(): Promise<void> {
    if (this.arbiterService && this.isInitialized) {
      logger.info('Shutting down Arbiter service...');
      try {
        // Stop health monitoring
        this.stopHealthMonitoring();
        
        // Shutdown the service
        await this.arbiterService.shutdown();
        this.arbiterService = null;
        this.isInitialized = false;
        this.initializationPromise = null;
        logger.info('Arbiter service shutdown complete');
      } catch (error) {
        logger.error('Error during service shutdown', { 
          error: error instanceof Error ? error.message : 'Unknown error' 
        });
      }
    }
  }

  /**
   * Set up cleanup handlers for graceful shutdown
   */
  private setupCleanupHandlers(): void {
    if (this.cleanupHandlersSet) {
      return; // Avoid setting up handlers multiple times
    }
    
    const cleanup = async () => {
      await this.shutdown();
      process.exit(0);
    };

    // Handle different termination signals
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
    process.on('beforeExit', cleanup);

    // Handle uncaught exceptions
    process.on('uncaughtException', async (error) => {
      logger.error('Uncaught exception', { error: error.message });
      await this.shutdown();
      process.exit(1);
    });

    process.on('unhandledRejection', async (reason) => {
      logger.error('Unhandled rejection', { reason });
      await this.shutdown();
      process.exit(1);
    });
    
    // Handle Next.js development server restarts
    if (process.env.NODE_ENV === 'development') {
      process.on('SIGHUP', async () => {
        logger.info('Development server restart detected, cleaning up...');
        await this.shutdown();
      });
    }
    
    this.cleanupHandlersSet = true;
  }

  /**
   * Start health monitoring (production only)
   */
  private startHealthMonitoring(): void {
    if (process.env.NODE_ENV === 'production' && !this.healthCheckInterval) {
      this.healthCheckInterval = setInterval(async () => {
        try {
          if (this.arbiterService) {
            await this.arbiterService.getStatus();
            logger.debug('Health check passed');
          }
        } catch (error) {
          logger.error('Health check failed', { 
            error: error instanceof Error ? error.message : 'Unknown error' 
          });
        }
      }, 30000); // Check every 30 seconds
      
      logger.info('Health monitoring started');
    }
  }
  
  /**
   * Stop health monitoring
   */
  private stopHealthMonitoring(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
      logger.info('Health monitoring stopped');
    }
  }

  /**
   * Get service status for monitoring
   */
  getServiceStatus() {
    return {
      initialized: this.isInitialized,
      initializing: this.initializationPromise !== null && !this.isInitialized,
      serviceAvailable: this.arbiterService !== null,
      healthMonitoring: this.healthCheckInterval !== null,
      environment: process.env.NODE_ENV || 'development',
      uptime: process.uptime(),
    };
  }
  
  /**
   * Validate service health
   */
  async validateHealth(): Promise<boolean> {
    try {
      if (!this.isInitialized || !this.arbiterService) {
        return false;
      }
      
      await this.arbiterService.getStatus();
      return true;
    } catch (error) {
      logger.warn('Service health validation failed', { 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
      return false;
    }
  }
}

// Export a convenience function to get the service
export const getArbiterService = async (): Promise<ArbiterServiceDB> => {
  const serviceManager = ServiceManager.getInstance();
  return await serviceManager.getService();
};

// Export the ServiceManager class for advanced use cases
export { ServiceManager };

// Export status check function
export const getServiceStatus = () => {
  const serviceManager = ServiceManager.getInstance();
  return serviceManager.getServiceStatus();
};

// Export health validation function
export const validateServiceHealth = async (): Promise<boolean> => {
  const serviceManager = ServiceManager.getInstance();
  return await serviceManager.validateHealth();
};

// Export shutdown function for CLI or other use cases
export const shutdownService = async () => {
  const serviceManager = ServiceManager.getInstance();
  await serviceManager.shutdown();
};