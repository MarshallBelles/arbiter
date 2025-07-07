import {
  AgentConfig,
  AgentTool,
  AgentResponse,
  AgentExecutionResult,
  AgentExecutionContext,
  ModelProviderConfig,
  createLogger,
  AgentError,
  validateAgentConfig,
  ValidationError,
} from '@arbiter/core';
import { GraniteAgent } from './granite-agent';

const logger = createLogger('AgentRuntime');

export class AgentRuntime {
  private agents = new Map<string, GraniteAgent>();
  private agentConfigs = new Map<string, AgentConfig>(); // Store original configs
  private modelConfigs = new Map<string, ModelProviderConfig>();
  private globalTools = new Map<string, AgentTool>();
  private tokenUsage = new Map<string, number>();

  constructor() {
    this.initializeDefaultModelConfigs();
  }

  private initializeDefaultModelConfigs(): void {
    // Default Granite 3.3 configuration for local llama.cpp
    const graniteConfig: ModelProviderConfig = {
      type: 'local',
      name: 'granite-3.3-2b',
      config: {
        baseUrl: 'http://localhost:8080',
        model: 'granite',
        maxTokens: 800,
        temperature: 0.1,
      },
    };

    this.modelConfigs.set('granite', graniteConfig);
  }

  registerModelProvider(name: string, config: ModelProviderConfig): void {
    this.modelConfigs.set(name, config);
    logger.info(`Registered model provider: ${name}`, { type: config.type });
  }

  createAgent(config: AgentConfig, modelProvider = 'granite'): string {
    // Validate agent configuration
    const validationErrors = validateAgentConfig(config);
    if (validationErrors.length > 0) {
      throw new ValidationError('Agent configuration is invalid', validationErrors);
    }

    // Get model configuration
    const modelConfig = this.modelConfigs.get(modelProvider);
    if (!modelConfig) {
      throw new AgentError(`Model provider not found: ${modelProvider}`, config.id);
    }

    // Create agent instance
    const agent = new GraniteAgent(config, modelConfig);

    // Register global tools
    for (const [toolName, tool] of this.globalTools) {
      if (config.availableTools.includes(toolName)) {
        agent.registerTool(tool);
      }
    }

    // Store agent and config
    this.agents.set(config.id, agent);
    this.agentConfigs.set(config.id, config);

    logger.info(`Created agent: ${config.name}`, {
      agentId: config.id,
      model: modelProvider,
      toolCount: agent.getToolCount(),
    });

    return config.id;
  }

  async executeAgent(
    agentId: string,
    input: any,
    userPrompt?: string,
    context?: AgentExecutionContext
  ): Promise<AgentExecutionResult> {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new AgentError(`Agent not found: ${agentId}`, agentId);
    }

    logger.info(`Executing agent: ${agentId}`, {
      hasUserPrompt: !!userPrompt,
      inputType: typeof input,
    });

    try {
      const result = await agent.execute(input, userPrompt, context);
      
      // Track token usage if available
      if (result.tokensUsed && result.tokensUsed > 0) {
        this.addTokenUsage(agentId, result.tokensUsed);
      }
      
      logger.info(`Agent execution completed: ${agentId}`, {
        status: result.status,
        toolCallCount: result.tool_calls.length,
        tokensUsed: result.tokensUsed || 0,
      });

      return result;

    } catch (error) {
      logger.error(`Agent execution failed: ${agentId}`, {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  registerGlobalTool(tool: AgentTool): void {
    this.globalTools.set(tool.name, tool);
    logger.info(`Registered global tool: ${tool.name}`);

    // Add tool to existing agents that have it in their available tools
    for (const [agentId, agent] of this.agents) {
      const agentConfig = this.getAgentConfig(agentId);
      if (agentConfig && agentConfig.availableTools.includes(tool.name)) {
        agent.registerTool(tool);
        logger.debug(`Added tool ${tool.name} to agent ${agentId}`);
      }
    }
  }

  registerAgentTool(agentId: string, tool: AgentTool): void {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new AgentError(`Agent not found: ${agentId}`, agentId);
    }

    agent.registerTool(tool);
    logger.info(`Registered tool for agent: ${tool.name}`, { agentId });
  }

  getAgent(agentId: string): GraniteAgent | undefined {
    return this.agents.get(agentId);
  }

  getAgentConfig(agentId: string): AgentConfig | undefined {
    return this.agentConfigs.get(agentId);
  }

  listAgents(): string[] {
    return Array.from(this.agents.keys());
  }

  removeAgent(agentId: string): boolean {
    const removed = this.agents.delete(agentId);
    if (removed) {
      this.agentConfigs.delete(agentId); // Also remove stored config
      this.tokenUsage.delete(agentId); // Also remove token usage
      logger.info(`Removed agent: ${agentId}`);
    }
    return removed;
  }

  getTokenUsage(agentId: string): number {
    return this.tokenUsage.get(agentId) || 0;
  }

  private addTokenUsage(agentId: string, tokens: number): void {
    const currentUsage = this.tokenUsage.get(agentId) || 0;
    this.tokenUsage.set(agentId, currentUsage + tokens);
  }

  resetTokenUsage(agentId: string): void {
    this.tokenUsage.set(agentId, 0);
  }

  getGlobalTools(): string[] {
    return Array.from(this.globalTools.keys());
  }

  createAgentTool(targetAgent: AgentConfig, context?: any): AgentTool {
    return {
      name: targetAgent.name,
      description: targetAgent.description,
      parameters: targetAgent.inputSchema || {},
      execute: async (params: any): Promise<AgentResponse> => {
        const startTime = Date.now();
        
        try {
          const result = await this.executeAgent(
            targetAgent.id,
            params,
            undefined,
            context
          );

          return {
            success: result.status === 'completed',
            data: result,
            metadata: {
              agentId: targetAgent.id,
              executionTime: Date.now() - startTime,
              model: targetAgent.model,
              tokensUsed: result.tokensUsed || 0
            },
          };

        } catch (error) {
          return {
            success: false,
            data: null,
            error: error instanceof Error ? error.message : 'Unknown error',
            metadata: {
              agentId: targetAgent.id,
              executionTime: Date.now() - startTime,
              model: targetAgent.model,
            },
          };
        }
      },
    };
  }

  async executeToolCall(agentId: string, toolCall: any): Promise<any> {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new AgentError(`Agent not found: ${agentId}`, agentId);
    }

    return await agent.executeToolCall(toolCall);
  }

  clearAgentConversation(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.clearConversation();
      logger.info(`Cleared conversation for agent: ${agentId}`);
    }
  }

  getAgentConversationHistory(agentId: string) {
    const agent = this.agents.get(agentId);
    return agent?.getConversationHistory() || [];
  }

  getModelProviders(): string[] {
    return Array.from(this.modelConfigs.keys());
  }

  getModelProviderConfig(name: string): ModelProviderConfig | undefined {
    return this.modelConfigs.get(name);
  }
}