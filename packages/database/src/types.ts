export interface DatabaseConfig {
  path: string;
  enableWAL?: boolean;
}

export interface WorkflowRecord {
  id: string;
  name: string;
  description: string;
  version: string;
  userPrompt?: string;
  config: any; // Full WorkflowConfig JSON
  createdAt: string;
  updatedAt: string;
}

export interface AgentRecord {
  id: string;
  name: string;
  description: string;
  model: string;
  systemPrompt: string;
  availableTools: string[];
  level: number;
  inputSchema?: any;
  createdAt: string;
  updatedAt: string;
}

export interface RunRecord {
  id: string;
  workflowId: string;
  executionId?: string;
  runType: 'workflow_execution' | 'agent_execution' | 'tool_call' | 'api_request' | 'model_request';
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  startTime: string;
  endTime?: string;
  durationMs?: number;
  
  // Request/Response data for debugging
  requestData?: any;
  responseData?: any;
  rawRequest?: string;
  rawResponse?: string;
  
  // Context and metadata
  parentRunId?: string;
  agentId?: string;
  toolName?: string;
  modelName?: string;
  userPrompt?: string;
  systemPrompt?: string;
  
  // Performance metrics
  tokensUsed?: number;
  memoryUsedMb?: number;
  cpuTimeMs?: number;
  
  // Error tracking
  errorMessage?: string;
  errorStack?: string;
  errorCode?: string;
  
  // Additional metadata
  metadata?: any;
  tags?: string[];
}

export interface RunFilters {
  workflowId?: string;
  executionId?: string;
  status?: string;
  runType?: string;
  agentId?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
}

export interface RunStats {
  totalRuns: number;
  successfulRuns: number;
  failedRuns: number;
  averageDuration: number;
  totalTokens: number;
}