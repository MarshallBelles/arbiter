export interface RuntimeConfig {
  type: 'node' | 'python';
  version: string;
  dependencies: string[];
  environment: Record<string, string>;
  timeout: number;
  memoryLimit: number;
  sandboxed: boolean;
}

export interface RuntimeExecution {
  id: string;
  runtimeType: 'node' | 'python';
  code: string;
  input: any;
  output?: any;
  error?: string;
  startTime: Date;
  endTime?: Date;
  exitCode?: number;
  memoryUsage?: number;
  logs: string[];
}

export interface ModelProviderConfig {
  type: 'openai' | 'anthropic' | 'local' | 'gemini' | 'deepseek';
  name: string;
  config: {
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    maxTokens?: number;
    temperature?: number;
    topP?: number;
    frequencyPenalty?: number;
    presencePenalty?: number;
  };
}

export interface ModelResponse {
  content: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  model: string;
  finishReason: string;
}