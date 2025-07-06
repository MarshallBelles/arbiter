import {
  WorkflowConfig,
  WorkflowExecution,
  AgentConfig,
  ArbiterEvent,
  createLogger,
  ArbiterError,
} from '@arbiter/core';
import { WorkflowEngine } from '@arbiter/workflow-engine';
import { AgentRuntime } from '@arbiter/agent-runtime';
import { EventSystem } from '@arbiter/event-system';

const logger = createLogger('ArbiterService');

export class ArbiterService {
  private workflowEngine: WorkflowEngine;
  private agentRuntime: AgentRuntime;
  private eventSystem: EventSystem;
  private workflows = new Map<string, WorkflowConfig>();
  private agents = new Map<string, AgentConfig>();

  constructor() {
    this.workflowEngine = new WorkflowEngine();
    this.agentRuntime = new AgentRuntime();
    this.eventSystem = new EventSystem();
  }

  async initialize(): Promise<void> {
    logger.info('Initializing Arbiter service');

    // Set event trigger handler to connect event system with workflow engine
    this.eventSystem.setEventTriggerHandler(async (event: ArbiterEvent) => {
      const workflow = this.workflows.get(event.metadata?.workflowId);
      if (!workflow) {
        throw new ArbiterError(`Workflow not found: ${event.metadata?.workflowId}`, 'WORKFLOW_NOT_FOUND');
      }

      const execution = await this.workflowEngine.executeWorkflow(workflow, event);
      
      return {
        success: execution.status === 'completed',
        workflowExecutionId: execution.id,
        error: execution.error,
      };
    });

    // Start event system
    await this.eventSystem.startEventSystem();

    logger.info('Arbiter service initialized successfully');
  }

  async shutdown(): Promise<void> {
    logger.info('Shutting down Arbiter service');
    await this.eventSystem.stopEventSystem();
    logger.info('Arbiter service shutdown complete');
  }

  // Workflow management
  async createWorkflow(config: WorkflowConfig): Promise<string> {
    // Store workflow
    this.workflows.set(config.id, config);

    // Create and register agents
    await this.createAgent(config.rootAgent);
    
    for (const level of config.levels) {
      for (const agent of level.agents) {
        await this.createAgent(agent);
      }
    }

    // Register workflow with event system
    await this.eventSystem.registerWorkflow(config);

    logger.info(`Created workflow: ${config.name}`, { workflowId: config.id });
    return config.id;
  }

  async getWorkflow(workflowId: string): Promise<WorkflowConfig | undefined> {
    return this.workflows.get(workflowId);
  }

  async listWorkflows(): Promise<WorkflowConfig[]> {
    return Array.from(this.workflows.values());
  }

  async updateWorkflow(workflowId: string, config: WorkflowConfig): Promise<void> {
    const existingWorkflow = this.workflows.get(workflowId);
    if (!existingWorkflow) {
      throw new ArbiterError(`Workflow not found: ${workflowId}`, 'WORKFLOW_NOT_FOUND');
    }

    // Unregister old workflow
    await this.eventSystem.unregisterWorkflow(workflowId);

    // Update workflow
    this.workflows.set(workflowId, config);

    // Re-register with event system
    await this.eventSystem.registerWorkflow(config);

    logger.info(`Updated workflow: ${config.name}`, { workflowId });
  }

  async deleteWorkflow(workflowId: string): Promise<void> {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      throw new ArbiterError(`Workflow not found: ${workflowId}`, 'WORKFLOW_NOT_FOUND');
    }

    // Unregister from event system
    await this.eventSystem.unregisterWorkflow(workflowId);

    // Remove workflow
    this.workflows.delete(workflowId);

    logger.info(`Deleted workflow: ${workflow.name}`, { workflowId });
  }

  async executeWorkflow(workflowId: string, eventData: any): Promise<WorkflowExecution> {
    const workflow = this.workflows.get(workflowId);
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

    return await this.workflowEngine.executeWorkflow(workflow, event);
  }

  // Agent management
  async createAgent(config: AgentConfig): Promise<string> {
    // Store agent config
    this.agents.set(config.id, config);

    // Create agent in runtime
    const agentId = this.agentRuntime.createAgent(config);

    logger.info(`Created agent: ${config.name}`, { agentId: config.id });
    return agentId;
  }

  async getAgent(agentId: string): Promise<AgentConfig | undefined> {
    return this.agents.get(agentId);
  }

  async listAgents(): Promise<AgentConfig[]> {
    return Array.from(this.agents.values());
  }

  async updateAgent(agentId: string, config: AgentConfig): Promise<void> {
    const existingAgent = this.agents.get(agentId);
    if (!existingAgent) {
      throw new ArbiterError(`Agent not found: ${agentId}`, 'AGENT_NOT_FOUND');
    }

    // Remove old agent from runtime
    this.agentRuntime.removeAgent(agentId);

    // Update agent config
    this.agents.set(agentId, config);

    // Create new agent in runtime
    this.agentRuntime.createAgent(config);

    logger.info(`Updated agent: ${config.name}`, { agentId });
  }

  async deleteAgent(agentId: string): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new ArbiterError(`Agent not found: ${agentId}`, 'AGENT_NOT_FOUND');
    }

    // Remove from runtime
    this.agentRuntime.removeAgent(agentId);

    // Remove agent config
    this.agents.delete(agentId);

    logger.info(`Deleted agent: ${agent.name}`, { agentId });
  }

  async executeAgent(agentId: string, input: any, userPrompt?: string): Promise<any> {
    return await this.agentRuntime.executeAgent(agentId, input, userPrompt);
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

  // Status and monitoring
  getStatus() {
    const workflows = Array.from(this.workflows.values());
    const agents = Array.from(this.agents.values());
    const activeExecutions = this.workflowEngine.getActiveExecutions();
    const eventStats = this.eventSystem.getEventStats();

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
      },
      events: eventStats,
      uptime: process.uptime(),
      memory: process.memoryUsage(),
    };
  }
}