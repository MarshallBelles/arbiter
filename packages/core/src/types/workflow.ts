import { AgentConfig } from './agent';

export interface WorkflowConfig {
  id: string;
  name: string;
  description: string;
  version: string;
  trigger: EventTrigger;
  rootAgent: AgentConfig;
  userPrompt?: string;
  levels: AgentLevel[];
  metadata?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

export interface AgentLevel {
  level: number;
  agents: AgentConfig[];
  executionMode: 'parallel' | 'conditional';
  condition?: string;
}

export interface EventTrigger {
  type: 'webhook' | 'cron' | 'manual' | 'file-watch' | 'api';
  config: {
    webhook?: {
      endpoint: string;
      method: string;
      headers?: Record<string, string>;
      authentication?: {
        type: 'bearer' | 'basic' | 'api-key';
        config: Record<string, string>;
      };
    };
    cron?: {
      schedule: string;
      timezone?: string;
    };
    fileWatch?: {
      path: string;
      pattern: string;
      events: ('created' | 'modified' | 'deleted')[];
    };
    api?: {
      endpoint: string;
      method: string;
    };
  };
}

export interface WorkflowExecution {
  id: string;
  workflowId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  startTime: Date;
  endTime?: Date;
  eventData: any;
  currentLevel: number;
  currentAgent?: string;
  executionLog: WorkflowLogEntry[];
  result?: any;
  error?: string;
}

export interface WorkflowLogEntry {
  timestamp: Date;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  agentId?: string;
  data?: any;
}

export interface WorkflowExecutionContext {
  execution: WorkflowExecution;
  workflow: WorkflowConfig;
  eventData: any;
  state: Map<string, any>;
  agentResponses: Map<string, any>;
}