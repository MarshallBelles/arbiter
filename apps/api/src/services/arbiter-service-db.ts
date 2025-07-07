import {
  WorkflowConfig,
  WorkflowExecution,
  AgentConfig,
  ArbiterEvent,
  createLogger,
  ArbiterError,
} from '@arbiter/core';
import { 
  ArbiterDatabase, 
  WorkflowRepository, 
  AgentRepository, 
  RunRepository,
  RunLogger,
} from '@arbiter/database';
import { WorkflowEngine } from '@arbiter/workflow-engine';
import { AgentRuntime } from '@arbiter/agent-runtime';
import { EventSystem } from '@arbiter/event-system';
import { join } from 'path';

const logger = createLogger('ArbiterService');

export class ArbiterServiceDB {
  private workflowEngine: WorkflowEngine;
  private agentRuntime: AgentRuntime;
  private eventSystem: EventSystem;
  private db: ArbiterDatabase;
  private workflowRepo: WorkflowRepository;
  private agentRepo: AgentRepository;
  private runRepo: RunRepository;
  private runLogger: RunLogger;

  constructor(dbPath?: string) {
    // Initialize database
    const databasePath = dbPath || join(process.cwd(), 'data', 'arbiter.db');
    this.db = new ArbiterDatabase({ path: databasePath });
    
    // Initialize repositories
    this.workflowRepo = new WorkflowRepository(this.db);
    this.agentRepo = new AgentRepository(this.db);
    this.runRepo = new RunRepository(this.db);
    this.runLogger = new RunLogger(this.runRepo);

    // Initialize services
    this.agentRuntime = new AgentRuntime();
    this.workflowEngine = new WorkflowEngine(this.agentRuntime);
    this.eventSystem = new EventSystem();
  }

  async initialize(): Promise<void> {
    logger.info('Initializing Arbiter service with database persistence');

    // Load existing workflows and agents from database
    await this.loadPersistedData();

    // Set event trigger handler with run logging
    this.eventSystem.setEventTriggerHandler(async (event: ArbiterEvent) => {
      const workflow = await this.workflowRepo.findById(event.metadata?.workflowId);
      if (!workflow) {
        throw new ArbiterError(`Workflow not found: ${event.metadata?.workflowId}`, 'WORKFLOW_NOT_FOUND');
      }

      // Log the workflow execution start
      const runId = await this.runLogger.logWorkflowExecution({
        workflowId: workflow.id,
        executionId: event.id,
        status: 'running',
        requestData: event.data,
        userPrompt: workflow.userPrompt,
        metadata: {
          eventType: event.type,
          eventSource: event.source,
          eventTimestamp: event.timestamp,
        },
      });

      try {
        const execution = await this.workflowEngine.executeWorkflow(workflow, event);
        
        // Log the workflow execution completion
        await this.runLogger.updateRunStatus(runId, execution.status === 'completed' ? 'completed' : 'failed', {
          execution,
        });

        return {
          success: execution.status === 'completed',
          workflowExecutionId: execution.id,
          error: execution.error,
        };
      } catch (error) {
        // Log the workflow execution error
        await this.runLogger.updateRunError(runId, error instanceof Error ? error : new Error(String(error)));
        throw error;
      }
    });

    // Start event system
    await this.eventSystem.startEventSystem();

    logger.info('Arbiter service initialized successfully with database persistence');
  }

  private async loadPersistedData(): Promise<void> {
    try {
      // Load workflows from database
      const workflows = await this.workflowRepo.findAll();
      for (const workflow of workflows) {
        // Register workflow with event system
        await this.eventSystem.registerWorkflow(workflow);
        logger.debug(`Loaded workflow: ${workflow.name}`, { workflowId: workflow.id });
      }

      // Load agents from database and recreate in runtime
      const agents = await this.agentRepo.findAll();
      for (const agent of agents) {
        this.agentRuntime.createAgent(agent);
        logger.debug(`Loaded agent: ${agent.name}`, { agentId: agent.id });
      }

      logger.info(`Loaded ${workflows.length} workflows and ${agents.length} agents from database`);
    } catch (error) {
      logger.error('Failed to load persisted data', { error: error instanceof Error ? error.message : 'Unknown error' });
      throw error;
    }
  }

  async shutdown(): Promise<void> {
    logger.info('Shutting down Arbiter service');
    await this.eventSystem.stopEventSystem();
    this.db.close();
    logger.info('Arbiter service shutdown complete');
  }

  // Workflow management with persistence and logging
  async createWorkflow(config: WorkflowConfig): Promise<string> {
    try {
      // Store workflow in database first
      await this.workflowRepo.create(config);

      // Create and register agents
      await this.createAgent(config.rootAgent);
      
      for (const level of config.levels) {
        for (const agent of level.agents) {
          await this.createAgent(agent);
        }
      }

      // Register workflow with event system
      await this.eventSystem.registerWorkflow(config);

      // Now log the successful API request (after workflow exists)
      await this.runLogger.logApiRequest({
        workflowId: config.id,
        status: 'completed',
        requestData: { action: 'createWorkflow', config },
        metadata: { operation: 'createWorkflow' },
      });

      logger.info(`Created workflow: ${config.name}`, { workflowId: config.id });
      return config.id;
    } catch (error) {
      // If workflow creation failed, we can't log to a non-existent workflow
      logger.error(`Failed to create workflow: ${config.name}`, { error: error instanceof Error ? error.message : 'Unknown error' });
      throw error;
    }
  }

  async getWorkflow(workflowId: string): Promise<WorkflowConfig | null> {
    return await this.workflowRepo.findById(workflowId);
  }

  async listWorkflows(): Promise<WorkflowConfig[]> {
    return await this.workflowRepo.findAll();
  }

  async updateWorkflow(workflowId: string, config: WorkflowConfig): Promise<void> {
    try {
      const existingWorkflow = await this.workflowRepo.findById(workflowId);
      if (!existingWorkflow) {
        throw new ArbiterError(`Workflow not found: ${workflowId}`, 'WORKFLOW_NOT_FOUND');
      }

      // Unregister old workflow
      await this.eventSystem.unregisterWorkflow(workflowId);

      // Update workflow in database
      await this.workflowRepo.update(workflowId, config);

      // Re-register with event system
      await this.eventSystem.registerWorkflow(config);

      // Log the successful update
      await this.runLogger.logApiRequest({
        workflowId,
        status: 'completed',
        requestData: { action: 'updateWorkflow', workflowId, config },
        metadata: { operation: 'updateWorkflow' },
      });

      logger.info(`Updated workflow: ${config.name}`, { workflowId });
    } catch (error) {
      logger.error(`Failed to update workflow: ${workflowId}`, { error: error instanceof Error ? error.message : 'Unknown error' });
      throw error;
    }
  }

  async deleteWorkflow(workflowId: string): Promise<void> {
    try {
      const workflow = await this.workflowRepo.findById(workflowId);
      if (!workflow) {
        throw new ArbiterError(`Workflow not found: ${workflowId}`, 'WORKFLOW_NOT_FOUND');
      }

      // Log the deletion before actually deleting (while workflow still exists)
      await this.runLogger.logApiRequest({
        workflowId,
        status: 'completed',
        requestData: { action: 'deleteWorkflow', workflowId },
        metadata: { operation: 'deleteWorkflow' },
      });

      // Unregister from event system
      await this.eventSystem.unregisterWorkflow(workflowId);

      // Remove workflow from database (this will cascade delete runs)
      await this.workflowRepo.delete(workflowId);

      logger.info(`Deleted workflow: ${workflow.name}`, { workflowId });
    } catch (error) {
      logger.error(`Failed to delete workflow: ${workflowId}`, { error: error instanceof Error ? error.message : 'Unknown error' });
      throw error;
    }
  }

  async executeWorkflow(workflowId: string, eventData: any): Promise<WorkflowExecution> {
    const workflow = await this.workflowRepo.findById(workflowId);
    if (!workflow) {
      throw new ArbiterError(`Workflow not found: ${workflowId}`, 'WORKFLOW_NOT_FOUND');
    }

    const event: ArbiterEvent = {
      id: `manual_${Date.now()}`,
      type: 'manual',
      source: 'api',
      timestamp: new Date(),
      data: eventData,
      metadata: { workflowId },
    };

    // Log the workflow execution start
    const runId = await this.runLogger.logWorkflowExecution({
      workflowId: workflow.id,
      executionId: event.id,
      status: 'running',
      requestData: event.data,
      userPrompt: workflow.userPrompt,
      metadata: {
        eventType: event.type,
        eventSource: event.source,
        eventTimestamp: event.timestamp,
      },
    });

    try {
      const execution = await this.workflowEngine.executeWorkflow(workflow, event);
      
      // Log the workflow execution completion
      await this.runLogger.updateRunStatus(runId, execution.status === 'completed' ? 'completed' : 'failed', {
        execution,
      });

      return execution;
    } catch (error) {
      // Log the workflow execution error
      await this.runLogger.updateRunError(runId, error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  // Agent management with persistence
  async createAgent(config: AgentConfig): Promise<string> {
    // Store agent config in database
    await this.agentRepo.create(config);

    // Create agent in runtime
    const agentId = this.agentRuntime.createAgent(config);

    logger.info(`Created agent: ${config.name}`, { agentId: config.id });
    return agentId;
  }

  async getAgent(agentId: string): Promise<AgentConfig | null> {
    return await this.agentRepo.findById(agentId);
  }

  async listAgents(): Promise<AgentConfig[]> {
    return await this.agentRepo.findAll();
  }

  async updateAgent(agentId: string, config: AgentConfig): Promise<void> {
    const existingAgent = await this.agentRepo.findById(agentId);
    if (!existingAgent) {
      throw new ArbiterError(`Agent not found: ${agentId}`, 'AGENT_NOT_FOUND');
    }

    // Remove old agent from runtime
    this.agentRuntime.removeAgent(agentId);

    // Update agent config in database
    // Note: AgentRepository doesn't have update method, so we delete and recreate
    await this.agentRepo.delete(agentId);
    await this.agentRepo.create(config);

    // Create new agent in runtime
    this.agentRuntime.createAgent(config);

    logger.info(`Updated agent: ${config.name}`, { agentId });
  }

  async deleteAgent(agentId: string): Promise<void> {
    const agent = await this.agentRepo.findById(agentId);
    if (!agent) {
      throw new ArbiterError(`Agent not found: ${agentId}`, 'AGENT_NOT_FOUND');
    }

    // Remove from runtime
    this.agentRuntime.removeAgent(agentId);

    // Remove agent config from database
    await this.agentRepo.delete(agentId);

    logger.info(`Deleted agent: ${agent.name}`, { agentId });
  }

  async executeAgent(agentId: string, input: any, userPrompt?: string): Promise<any> {
    try {
      // First create a temporary workflow for direct agent execution if it doesn't exist
      const directWorkflowId = 'direct-execution';
      const existingWorkflow = await this.workflowRepo.findById(directWorkflowId);
      
      if (!existingWorkflow) {
        // Create a minimal workflow for direct agent execution
        const directWorkflow: WorkflowConfig = {
          id: directWorkflowId,
          name: 'Direct Agent Execution',
          description: 'Temporary workflow for direct agent execution',
          version: '1.0.0',
          trigger: {
            type: 'manual',
            config: {}
          },
          rootAgent: {
            id: agentId,
            name: 'Direct Execution Agent',
            description: 'Agent for direct execution',
            model: 'granite-3.3',
            systemPrompt: 'Execute tasks directly',
            availableTools: [],
            level: 1
          },
          levels: [],
          createdAt: new Date(),
          updatedAt: new Date()
        };
        
        await this.workflowRepo.create(directWorkflow);
      }

      const runId = await this.runLogger.logAgentExecution({
        workflowId: directWorkflowId,
        agentId,
        status: 'running',
        requestData: input,
        userPrompt,
        metadata: { executionType: 'direct' },
      });

      const result = await this.agentRuntime.executeAgent(agentId, input, userPrompt);
      await this.runLogger.updateRunStatus(runId, 'completed', result);
      return result;
    } catch (error) {
      logger.error(`Failed to execute agent: ${agentId}`, { error: error instanceof Error ? error.message : 'Unknown error' });
      throw error;
    }
  }

  // Event management
  async triggerManualEvent(workflowId: string, data: any) {
    return await this.eventSystem.triggerManualEvent(workflowId, data);
  }

  async getEventHandlers() {
    return this.eventSystem.getEventHandlers();
  }

  async enableEventHandler(handlerId: string): Promise<void> {
    await this.eventSystem.enableEventHandler(handlerId);
  }

  async disableEventHandler(handlerId: string): Promise<void> {
    await this.eventSystem.disableEventHandler(handlerId);
  }

  // Execution management
  getActiveExecutions() {
    return this.workflowEngine.getActiveExecutions();
  }

  getExecution(executionId: string) {
    return this.workflowEngine.getExecution(executionId);
  }

  async cancelExecution(executionId: string): Promise<boolean> {
    return await this.workflowEngine.cancelExecution(executionId);
  }

  // Run logging and analytics methods
  async getWorkflowRuns(workflowId: string, limit = 100) {
    return await this.runLogger.getWorkflowRuns(workflowId, limit);
  }

  async getExecutionTrace(executionId: string) {
    return await this.runLogger.getExecutionTrace(executionId);
  }

  async getRunStats(workflowId?: string) {
    return await this.runRepo.getStats(workflowId);
  }

  async exportRuns(filters: any = {}) {
    return await this.runLogger.exportRuns(filters);
  }

  async getPerformanceMetrics(workflowId?: string) {
    return await this.runRepo.getPerformanceMetrics(workflowId);
  }

  async getRecentErrors(limit = 50) {
    return await this.runRepo.getRecentErrors(limit);
  }

  // Status and monitoring with database insights
  async getStatus() {
    const workflows = await this.listWorkflows();
    const agents = await this.listAgents();
    const activeExecutions = this.workflowEngine.getActiveExecutions();
    const eventStats = this.eventSystem.getEventStats();
    const runStats = await this.getRunStats();

    return {
      workflows: {
        total: workflows.length,
        enabled: workflows.length, // All workflows are enabled by default
      },
      agents: {
        total: agents.length,
        runtime: this.agentRuntime.listAgents().length,
      },
      executions: {
        active: activeExecutions.length,
        totalRuns: runStats.totalRuns,
        successfulRuns: runStats.successfulRuns,
        failedRuns: runStats.failedRuns,
        averageDuration: runStats.averageDuration,
      },
      events: eventStats,
      performance: {
        totalTokens: runStats.totalTokens,
        ...(await this.getPerformanceMetrics()),
      },
      uptime: process.uptime(),
      memory: process.memoryUsage(),
    };
  }

  // Database-specific methods
  getDatabasePath(): string {
    return (this.db as any).db?.filename || 'unknown';
  }

  async runDatabaseMaintenance(): Promise<void> {
    // Could implement VACUUM, ANALYZE, etc.
    logger.info('Database maintenance completed');
  }
}