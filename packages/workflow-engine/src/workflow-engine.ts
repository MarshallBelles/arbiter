import {
  WorkflowConfig,
  WorkflowExecution,
  WorkflowExecutionContext,
  WorkflowLogEntry,
  AgentConfig,
  AgentTool,
  AgentResponse,
  AgentExecutionResult,
  ArbiterEvent,
  createLogger,
  WorkflowError,
  AgentError,
} from '@arbiter/core';
import { AgentRuntime } from '@arbiter/agent-runtime';

const logger = createLogger('WorkflowEngine');

export class WorkflowEngine {
  private activeExecutions = new Map<string, WorkflowExecutionContext>();
  private agentTools = new Map<string, AgentTool>();
  private agentRuntime: AgentRuntime | null = null;

  constructor(agentRuntime?: AgentRuntime) {
    this.agentRuntime = agentRuntime || null;
  }

  setAgentRuntime(agentRuntime: AgentRuntime): void {
    this.agentRuntime = agentRuntime;
  }

  async executeWorkflow(
    workflow: WorkflowConfig,
    event: ArbiterEvent
  ): Promise<WorkflowExecution> {
    const execution: WorkflowExecution = {
      id: this.generateExecutionId(),
      workflowId: workflow.id,
      status: 'pending',
      startTime: new Date(),
      eventData: event.data,
      currentLevel: 0,
      executionLog: [],
      result: null,
    };

    const context: WorkflowExecutionContext = {
      execution,
      workflow,
      eventData: event.data,
      state: new Map(),
      agentResponses: new Map(),
    };

    this.activeExecutions.set(execution.id, context);

    try {
      execution.status = 'running';
      this.log(context, 'info', 'Starting workflow execution', {
        workflowId: workflow.id,
        eventType: event.type,
      });

      // Validate workflow configuration
      this.validateWorkflow(workflow);

      // Register all agents as tools for the mesh network
      this.registerAgentTools(workflow);

      // Execute root agent
      const rootResult = await this.executeRootAgent(context);
      
      if (rootResult.status === 'completed') {
        execution.status = 'completed';
        execution.result = rootResult;
        this.log(context, 'info', 'Workflow completed successfully');
      } else if (rootResult.status === 'error') {
        execution.status = 'failed';
        execution.error = rootResult.reasoning;
        this.log(context, 'error', 'Workflow failed', { error: rootResult.reasoning });
      }

    } catch (error) {
      execution.status = 'failed';
      execution.error = error instanceof Error ? error.message : 'Unknown error';
      this.log(context, 'error', 'Workflow execution failed', { error: execution.error });
    } finally {
      execution.endTime = new Date();
      this.activeExecutions.delete(execution.id);
    }

    return execution;
  }

  private async executeRootAgent(context: WorkflowExecutionContext): Promise<AgentExecutionResult> {
    const { workflow, eventData } = context;
    const rootAgent = workflow.rootAgent;

    this.log(context, 'info', 'Executing root agent', { agentId: rootAgent.id });

    // Build available tools for root agent
    const availableTools = new Map<string, AgentTool>();
    
    // Register next-level agents as tools
    for (const level of workflow.levels) {
      for (const agent of level.agents) {
        const tool = this.createAgentTool(agent, context);
        availableTools.set(agent.name, tool);
      }
    }

    // Execute root agent with mesh network approach
    return await this.executeAgentWithMeshNetwork(
      rootAgent,
      context,
      availableTools,
      eventData,
      workflow.userPrompt
    );
  }

  private async executeAgentWithMeshNetwork(
    agent: AgentConfig,
    context: WorkflowExecutionContext,
    availableTools: Map<string, AgentTool>,
    input: any,
    userPrompt?: string
  ): Promise<AgentExecutionResult> {
    
    let iterations = 0;
    const maxIterations = 10;
    let currentResult: AgentExecutionResult | null = null;

    while (iterations < maxIterations) {
      iterations++;
      
      this.log(context, 'debug', `Agent iteration ${iterations}`, { agentId: agent.id });

      try {
        // Use real agent runtime if available, otherwise simulate
        if (this.agentRuntime) {
          currentResult = await this.agentRuntime.executeAgent(
            agent.id,
            input,
            userPrompt,
            {
              workflowId: context.workflow.id,
              executionId: context.execution.id,
              metadata: context.eventData,
            }
          );
        } else {
          currentResult = await this.simulateAgentExecution(
            agent,
            context,
            availableTools,
            input,
            userPrompt
          );
        }

        if (currentResult.status === 'completed' || currentResult.status === 'error') {
          break;
        }

        if (currentResult.status === 'working' && currentResult.tool_calls.length > 0) {
          // Execute all tool calls in parallel
          const toolResults = await this.executeToolCalls(
            currentResult.tool_calls,
            availableTools,
            context
          );

          // Prepare tool results for next iteration
          input = {
            ...input,
            tool_results: toolResults,
            previous_reasoning: currentResult.reasoning,
          };
        }

      } catch (error) {
        this.log(context, 'error', 'Agent execution failed', { 
          agentId: agent.id, 
          error: error instanceof Error ? error.message : 'Unknown error' 
        });
        
        return {
          reasoning: 'Agent execution failed',
          tool_calls: [],
          next_steps: 'Workflow terminated due to error',
          status: 'error',
          raw_response: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }

    if (iterations >= maxIterations) {
      this.log(context, 'warn', 'Agent reached maximum iterations', { agentId: agent.id });
      return {
        reasoning: 'Maximum iterations reached',
        tool_calls: [],
        next_steps: 'Workflow terminated due to iteration limit',
        status: 'error',
        raw_response: 'Maximum iterations exceeded',
      };
    }

    return currentResult || {
      reasoning: 'No result generated',
      tool_calls: [],
      next_steps: 'Workflow terminated',
      status: 'error',
      raw_response: 'No result',
    };
  }

  private async executeToolCalls(
    toolCalls: any[],
    availableTools: Map<string, AgentTool>,
    context: WorkflowExecutionContext
  ): Promise<any[]> {
    const results: any[] = [];

    // Sort tool calls by sequence order
    const sortedCalls = toolCalls.sort((a, b) => (a.sequence_order || 0) - (b.sequence_order || 0));

    // Execute all tool calls in parallel
    const promises = sortedCalls.map(async (toolCall) => {
      const tool = availableTools.get(toolCall.tool_name);
      
      if (!tool) {
        this.log(context, 'warn', `Tool not found: ${toolCall.tool_name}`);
        return {
          tool_name: toolCall.tool_name,
          success: false,
          error: `Tool ${toolCall.tool_name} not found`,
        };
      }

      try {
        this.log(context, 'info', `Executing tool: ${toolCall.tool_name}`, {
          parameters: toolCall.parameters,
        });

        const result = await tool.execute(toolCall.parameters);
        
        this.log(context, 'info', `Tool completed: ${toolCall.tool_name}`, {
          success: result.success,
          executionTime: result.metadata.executionTime,
        });

        return {
          tool_name: toolCall.tool_name,
          success: result.success,
          data: result.data,
          metadata: result.metadata,
        };

      } catch (error) {
        this.log(context, 'error', `Tool execution failed: ${toolCall.tool_name}`, {
          error: error instanceof Error ? error.message : 'Unknown error',
        });

        return {
          tool_name: toolCall.tool_name,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    });

    const toolResults = await Promise.all(promises);
    results.push(...toolResults);

    return results;
  }

  private createAgentTool(agent: AgentConfig, context: WorkflowExecutionContext): AgentTool {
    return {
      name: agent.name,
      description: agent.description,
      parameters: agent.inputSchema || {},
      execute: async (params: any): Promise<AgentResponse> => {
        const startTime = Date.now();
        
        try {
          // Create tools for this agent's next level
          const nextLevelTools = new Map<string, AgentTool>();
          
          // Find agents at the next level
          const nextLevel = context.workflow.levels.find(level => level.level === agent.level + 1);
          if (nextLevel) {
            for (const nextAgent of nextLevel.agents) {
              const tool = this.createAgentTool(nextAgent, context);
              nextLevelTools.set(nextAgent.name, tool);
            }
          }

          // Execute agent with its available tools
          const result = await this.executeAgentWithMeshNetwork(
            agent,
            context,
            nextLevelTools,
            params
          );

          return {
            success: result.status === 'completed',
            data: result,
            metadata: {
              agentId: agent.id,
              executionTime: Date.now() - startTime,
              model: agent.model,
            },
          };

        } catch (error) {
          return {
            success: false,
            data: null,
            error: error instanceof Error ? error.message : 'Unknown error',
            metadata: {
              agentId: agent.id,
              executionTime: Date.now() - startTime,
              model: agent.model,
            },
          };
        }
      },
    };
  }

  private async simulateAgentExecution(
    agent: AgentConfig,
    context: WorkflowExecutionContext,
    availableTools: Map<string, AgentTool>,
    input: any,
    userPrompt?: string
  ): Promise<AgentExecutionResult> {
    // This is a simulation - in the real implementation, this would call the agent runtime
    // The agent runtime would handle the actual AI model calls
    
    return {
      reasoning: `Agent ${agent.name} processed the input and determined next steps`,
      tool_calls: [],
      next_steps: 'Analysis complete',
      status: 'completed',
      raw_response: 'Simulated agent response',
    };
  }

  private registerAgentTools(workflow: WorkflowConfig): void {
    // Register all agents as tools in the mesh network
    for (const level of workflow.levels) {
      for (const agent of level.agents) {
        const tool: AgentTool = {
          name: agent.name,
          description: agent.description,
          parameters: agent.inputSchema || {},
          execute: async (params: any) => {
            if (this.agentRuntime) {
              const result = await this.agentRuntime.executeAgent(
                agent.id,
                params,
                undefined,
                {
                  workflowId: workflow.id,
                  executionId: 'tool-call',
                  metadata: params,
                }
              );
              return {
                success: result.status === 'completed',
                data: result.reasoning,
                metadata: {
                  agentId: agent.id,
                  executionTime: Date.now(),
                  model: agent.model,
                  tokensUsed: result.tokensUsed || 0,
                },
              };
            } else {
              // Fallback to simulation
              return {
                success: true,
                data: params,
                metadata: {
                  agentId: agent.id,
                  executionTime: 100,
                  model: agent.model,
                },
              };
            }
          },
        };
        
        this.agentTools.set(agent.name, tool);
      }
    }
  }

  private log(
    context: WorkflowExecutionContext,
    level: WorkflowLogEntry['level'],
    message: string,
    data?: any
  ): void {
    const entry: WorkflowLogEntry = {
      timestamp: new Date(),
      level,
      message,
      data,
    };

    context.execution.executionLog.push(entry);
    
    // Log to console as well
    const logFn = logger[level] || logger.info;
    logFn.call(logger, message, { 
      executionId: context.execution.id,
      workflowId: context.workflow.id,
      ...data 
    });
  }

  private generateExecutionId(): string {
    return `exec_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }

  private validateWorkflow(workflow: WorkflowConfig): void {
    // Validate root agent
    if (!workflow.rootAgent) {
      throw new WorkflowError('Root agent is required', workflow.id);
    }

    if (!workflow.rootAgent.systemPrompt || workflow.rootAgent.systemPrompt.trim() === '') {
      throw new WorkflowError('Root agent system prompt cannot be empty', workflow.id);
    }

    if (!workflow.rootAgent.id || !workflow.rootAgent.name) {
      throw new WorkflowError('Root agent must have id and name', workflow.id);
    }

    // Validate levels
    if (workflow.levels) {
      for (const level of workflow.levels) {
        if (!Array.isArray(level.agents)) {
          throw new WorkflowError(`Level ${level.level} must have agents array`, workflow.id);
        }

        for (const agent of level.agents) {
          if (!agent.systemPrompt || agent.systemPrompt.trim() === '') {
            throw new WorkflowError(`Agent ${agent.id} system prompt cannot be empty`, workflow.id);
          }
        }
      }
    }
  }

  getActiveExecutions(): WorkflowExecutionContext[] {
    return Array.from(this.activeExecutions.values());
  }

  getExecution(executionId: string): WorkflowExecutionContext | undefined {
    return this.activeExecutions.get(executionId);
  }

  async cancelExecution(executionId: string): Promise<boolean> {
    const context = this.activeExecutions.get(executionId);
    if (!context) {
      return false;
    }

    context.execution.status = 'cancelled';
    context.execution.endTime = new Date();
    this.log(context, 'info', 'Workflow execution cancelled');
    
    this.activeExecutions.delete(executionId);
    return true;
  }
}