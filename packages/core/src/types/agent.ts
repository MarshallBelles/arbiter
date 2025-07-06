export interface AgentConfig {
  id: string;
  name: string;
  description: string;
  model: string;
  systemPrompt: string;
  availableTools: string[];
  inputSchema?: Record<string, any>;
  outputSchema?: Record<string, any>;
  level: number;
  metadata?: Record<string, any>;
}

export interface AgentTool {
  name: string;
  description: string;
  parameters: Record<string, any>;
  execute: (params: any) => Promise<AgentResponse>;
}

export interface AgentResponse {
  success: boolean;
  data: any;
  error?: string;
  metadata: {
    agentId: string;
    executionTime: number;
    tokensUsed?: number;
    model?: string;
  };
}

export interface AgentToolCall {
  tool_name: string;
  parameters: Record<string, any>;
  purpose: string;
  sequence_order: number;
}

export interface AgentExecutionContext {
  agentId: string;
  workflowId: string;
  eventData: any;
  userPrompt?: string;
  previousResponses?: AgentResponse[];
  tools: Map<string, AgentTool>;
  conversationHistory: ConversationMessage[];
}

export interface ConversationMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export interface AgentExecutionResult {
  reasoning: string;
  tool_calls: AgentToolCall[];
  next_steps: string;
  status: 'working' | 'completed' | 'need_info' | 'error';
  raw_response?: string;
}