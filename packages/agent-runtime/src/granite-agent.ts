import {
  AgentConfig,
  AgentTool,
  AgentResponse,
  AgentExecutionResult,
  AgentExecutionContext,
  ConversationMessage,
  ModelProviderConfig,
  ModelResponse,
  createLogger,
  AgentError,
  ModelError,
  validateJSON,
} from '@arbiter/core';
import fetch from 'node-fetch';

const logger = createLogger('GraniteAgent');

export class GraniteAgent {
  private tools = new Map<string, AgentTool>();
  private conversationHistory: ConversationMessage[] = [];
  private config: AgentConfig;
  private modelConfig: ModelProviderConfig;

  constructor(config: AgentConfig, modelConfig: ModelProviderConfig) {
    this.config = config;
    this.modelConfig = modelConfig;
    this.initializeSystemPrompt();
  }

  private initializeSystemPrompt(): void {
    const systemMessage: ConversationMessage = {
      role: 'system',
      content: this.buildGraniteSystemPrompt(),
      timestamp: new Date(),
    };
    this.conversationHistory = [systemMessage];
  }

  private buildGraniteSystemPrompt(): string {
    const toolDescriptions = Array.from(this.tools.values())
      .map(tool => `- ${tool.name}: ${tool.description}`)
      .join('\n');

    return `${this.config.systemPrompt}

You are an autonomous AI assistant. You must respond in JSON format with this exact structure:
{
  "reasoning": "Your step-by-step reasoning about the task",
  "tool_calls": [
    {
      "tool_name": "function_name",
      "parameters": {"param1": "value1"},
      "purpose": "why this tool is needed",
      "sequence_order": 1
    }
  ],
  "next_steps": "What you plan to do next",
  "status": "working|completed|need_info|error"
}

Available Tools:
${toolDescriptions || 'No tools available'}

Work autonomously to complete the task. Make decisions about what information to gather, how to process results, and what steps to take.`;
  }

  registerTool(tool: AgentTool): void {
    this.tools.set(tool.name, tool);
    logger.info(`Registered tool: ${tool.name}`, { agentId: this.config.id });
    
    // Update system prompt with new tool
    this.conversationHistory[0].content = this.buildGraniteSystemPrompt();
  }

  async execute(
    input: any,
    userPrompt?: string,
    context?: AgentExecutionContext
  ): Promise<AgentExecutionResult> {
    const startTime = Date.now();
    
    try {
      // Build initial user message
      const userMessage = this.buildUserMessage(input, userPrompt);
      
      // Execute the conversation loop
      const result = await this.executeConversationLoop(userMessage, context);
      
      logger.info('Agent execution completed', {
        agentId: this.config.id,
        status: result.status,
        executionTime: Date.now() - startTime,
      });

      return result;

    } catch (error) {
      logger.error('Agent execution failed', {
        agentId: this.config.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      throw new AgentError(
        `Agent execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        this.config.id,
        { executionTime: Date.now() - startTime }
      );
    }
  }

  private buildUserMessage(input: any, userPrompt?: string): string {
    let message = '';
    
    if (userPrompt) {
      message += `User Instructions: ${userPrompt}\n\n`;
    }
    
    if (input.tool_results) {
      message += `Tool Results:\n`;
      for (const result of input.tool_results) {
        message += `${result.tool_name}: ${result.success ? 'SUCCESS' : 'ERROR'} - ${result.data || result.error}\n`;
      }
      message += `\nPlease proceed with next steps.\n`;
    } else {
      message += `Task Input: ${this.safeJsonStringify(input, 2)}\n`;
    }
    
    if (input.previous_reasoning) {
      message += `\nPrevious Reasoning: ${input.previous_reasoning}\n`;
    }

    return message;
  }

  private safeJsonStringify(obj: any, indent: number = 0): string {
    try {
      // Handle circular references by using a Map to track visited objects
      const seen = new WeakSet();
      
      const replacer = (key: string, value: any): any => {
        if (typeof value === 'object' && value !== null) {
          if (seen.has(value)) {
            return '[Circular Reference]';
          }
          seen.add(value);
        }
        return value;
      };
      
      return JSON.stringify(obj, replacer, indent);
    } catch (error) {
      logger.warn('Failed to stringify input object', {
        agentId: this.config.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      
      // Fallback: create a safe representation
      if (typeof obj === 'object' && obj !== null) {
        const safeObj: any = {};
        for (const [key, value] of Object.entries(obj)) {
          try {
            JSON.stringify(value);
            safeObj[key] = value;
          } catch {
            safeObj[key] = '[Unserializable Value]';
          }
        }
        return JSON.stringify(safeObj, null, indent);
      }
      
      return String(obj);
    }
  }

  private async executeConversationLoop(
    userMessage: string,
    context?: AgentExecutionContext
  ): Promise<AgentExecutionResult> {
    
    // Add user message to conversation
    this.conversationHistory.push({
      role: 'user',
      content: userMessage,
      timestamp: new Date(),
    });

    // Get AI response
    const response = await this.callGraniteModel();
    
    // Add assistant response to conversation
    this.conversationHistory.push({
      role: 'assistant',
      content: response.content,
      timestamp: new Date(),
    });

    // Parse the JSON response
    const parsed = this.parseGraniteResponse(response.content);
    
    if (!parsed || typeof parsed !== 'object') {
      throw new AgentError('Invalid response format from model', this.config.id);
    }

    // Validate required fields
    if (!parsed.reasoning || !parsed.status) {
      throw new AgentError('Missing required fields in agent response', this.config.id);
    }

    // Return structured result
    return {
      reasoning: parsed.reasoning,
      tool_calls: parsed.tool_calls || [],
      next_steps: parsed.next_steps || 'No next steps specified',
      status: parsed.status,
      raw_response: response.content,
    };
  }

  private async callGraniteModel(): Promise<ModelResponse> {
    const { baseUrl, model, maxTokens, temperature } = this.modelConfig.config;
    
    const requestBody = {
      model: model || 'granite',
      messages: this.conversationHistory.map(msg => ({
        role: msg.role,
        content: msg.content,
      })),
      max_tokens: maxTokens || 800,
      temperature: temperature || 0.1,
    };

    logger.debug('Calling Granite model', {
      agentId: this.config.id,
      model: model,
      messageCount: this.conversationHistory.length,
    });

    try {
      const response = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        throw new ModelError(
          `Model API request failed: ${response.status} ${response.statusText}`,
          model || 'granite'
        );
      }

      const data = await response.json() as any;
      
      if (!data.choices || !data.choices[0]) {
        throw new ModelError('Invalid response from model API', model || 'granite');
      }

      const choice = data.choices[0];
      
      return {
        content: choice.message.content,
        usage: data.usage,
        model: data.model || model || 'granite',
        finishReason: choice.finish_reason || 'stop',
      };

    } catch (error) {
      if (error instanceof ModelError) {
        throw error;
      }
      
      throw new ModelError(
        `Failed to call model: ${error instanceof Error ? error.message : 'Unknown error'}`,
        model || 'granite'
      );
    }
  }

  private parseGraniteResponse(content: string): any {
    try {
      // Handle code block wrapped JSON
      const jsonMatch = content.match(/```json\n(.*?)\n```/s);
      const jsonString = jsonMatch ? jsonMatch[1] : content;
      
      const validation = validateJSON(jsonString);
      if (!validation.valid) {
        logger.warn('Failed to parse JSON response', {
          agentId: this.config.id,
          error: validation.error,
          content: content.substring(0, 200),
        });
        return null;
      }

      return validation.parsed;

    } catch (error) {
      logger.error('Response parsing failed', {
        agentId: this.config.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return null;
    }
  }

  async executeToolCall(toolCall: any): Promise<any> {
    const tool = this.tools.get(toolCall.tool_name);
    
    if (!tool) {
      logger.warn(`Tool not found: ${toolCall.tool_name}`, { agentId: this.config.id });
      return {
        tool_name: toolCall.tool_name,
        success: false,
        error: `Tool ${toolCall.tool_name} not found`,
      };
    }

    try {
      logger.info(`Executing tool: ${toolCall.tool_name}`, {
        agentId: this.config.id,
        parameters: toolCall.parameters,
      });

      const result = await tool.execute(toolCall.parameters);
      
      logger.info(`Tool completed: ${toolCall.tool_name}`, {
        agentId: this.config.id,
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
      logger.error(`Tool execution failed: ${toolCall.tool_name}`, {
        agentId: this.config.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return {
        tool_name: toolCall.tool_name,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  getConversationHistory(): ConversationMessage[] {
    return [...this.conversationHistory];
  }

  clearConversation(): void {
    this.conversationHistory = [this.conversationHistory[0]]; // Keep system prompt
  }

  getToolCount(): number {
    return this.tools.size;
  }

  getAvailableTools(): string[] {
    return Array.from(this.tools.keys());
  }
}