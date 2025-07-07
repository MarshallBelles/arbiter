import { createLogger } from '@arbiter/core';
import { RunRepository } from './repositories/run-repository';
import { RunRecord } from './types';

const logger = createLogger('RunLogger');

export class RunLogger {
  constructor(private runRepository: RunRepository) {}

  async logWorkflowExecution(params: {
    workflowId: string;
    executionId: string;
    status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
    requestData?: any;
    responseData?: any;
    userPrompt?: string;
    metadata?: any;
    parentRunId?: string;
  }): Promise<string> {
    const runId = this.runRepository.generateRunId('workflow');
    
    const run: RunRecord = {
      id: runId,
      workflowId: params.workflowId,
      executionId: params.executionId,
      runType: 'workflow_execution',
      status: params.status,
      startTime: new Date().toISOString(),
      requestData: params.requestData,
      responseData: params.responseData,
      userPrompt: params.userPrompt,
      metadata: params.metadata,
      parentRunId: params.parentRunId,
    };

    await this.runRepository.create(run);
    logger.debug('Logged workflow execution', { runId, workflowId: params.workflowId });
    
    return runId;
  }

  async logAgentExecution(params: {
    workflowId: string;
    executionId?: string;
    agentId: string;
    status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
    requestData?: any;
    responseData?: any;
    rawRequest?: string;
    rawResponse?: string;
    userPrompt?: string;
    systemPrompt?: string;
    modelName?: string;
    tokensUsed?: number;
    memoryUsedMb?: number;
    cpuTimeMs?: number;
    metadata?: any;
    parentRunId?: string;
  }): Promise<string> {
    const runId = this.runRepository.generateRunId('agent');
    
    const run: RunRecord = {
      id: runId,
      workflowId: params.workflowId,
      executionId: params.executionId,
      runType: 'agent_execution',
      status: params.status,
      startTime: new Date().toISOString(),
      agentId: params.agentId,
      requestData: params.requestData,
      responseData: params.responseData,
      rawRequest: params.rawRequest,
      rawResponse: params.rawResponse,
      userPrompt: params.userPrompt,
      systemPrompt: params.systemPrompt,
      modelName: params.modelName,
      tokensUsed: params.tokensUsed,
      memoryUsedMb: params.memoryUsedMb,
      cpuTimeMs: params.cpuTimeMs,
      metadata: params.metadata,
      parentRunId: params.parentRunId,
    };

    await this.runRepository.create(run);
    logger.debug('Logged agent execution', { runId, agentId: params.agentId });
    
    return runId;
  }

  async logToolCall(params: {
    workflowId: string;
    executionId?: string;
    agentId?: string;
    toolName: string;
    status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
    requestData?: any;
    responseData?: any;
    metadata?: any;
    parentRunId?: string;
  }): Promise<string> {
    const runId = this.runRepository.generateRunId('tool');
    
    const run: RunRecord = {
      id: runId,
      workflowId: params.workflowId,
      executionId: params.executionId,
      runType: 'tool_call',
      status: params.status,
      startTime: new Date().toISOString(),
      agentId: params.agentId,
      toolName: params.toolName,
      requestData: params.requestData,
      responseData: params.responseData,
      metadata: params.metadata,
      parentRunId: params.parentRunId,
    };

    await this.runRepository.create(run);
    logger.debug('Logged tool call', { runId, toolName: params.toolName });
    
    return runId;
  }

  async logModelRequest(params: {
    workflowId: string;
    executionId?: string;
    agentId?: string;
    modelName: string;
    status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
    rawRequest: string;
    rawResponse?: string;
    tokensUsed?: number;
    memoryUsedMb?: number;
    cpuTimeMs?: number;
    metadata?: any;
    parentRunId?: string;
  }): Promise<string> {
    const runId = this.runRepository.generateRunId('model');
    
    const run: RunRecord = {
      id: runId,
      workflowId: params.workflowId,
      executionId: params.executionId,
      runType: 'model_request',
      status: params.status,
      startTime: new Date().toISOString(),
      agentId: params.agentId,
      modelName: params.modelName,
      rawRequest: params.rawRequest,
      rawResponse: params.rawResponse,
      tokensUsed: params.tokensUsed,
      memoryUsedMb: params.memoryUsedMb,
      cpuTimeMs: params.cpuTimeMs,
      metadata: params.metadata,
      parentRunId: params.parentRunId,
    };

    await this.runRepository.create(run);
    logger.debug('Logged model request', { runId, modelName: params.modelName });
    
    return runId;
  }

  async logApiRequest(params: {
    workflowId: string;
    executionId?: string;
    status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
    requestData?: any;
    responseData?: any;
    rawRequest?: string;
    rawResponse?: string;
    metadata?: any;
    parentRunId?: string;
  }): Promise<string> {
    const runId = this.runRepository.generateRunId('api');
    
    const run: RunRecord = {
      id: runId,
      workflowId: params.workflowId,
      executionId: params.executionId,
      runType: 'api_request',
      status: params.status,
      startTime: new Date().toISOString(),
      requestData: params.requestData,
      responseData: params.responseData,
      rawRequest: params.rawRequest,
      rawResponse: params.rawResponse,
      metadata: params.metadata,
      parentRunId: params.parentRunId,
    };

    await this.runRepository.create(run);
    logger.debug('Logged API request', { runId });
    
    return runId;
  }

  async updateRunStatus(runId: string, status: string, responseData?: any): Promise<void> {
    const endTime = ['completed', 'failed', 'cancelled'].includes(status) 
      ? new Date().toISOString() 
      : undefined;
    
    // Calculate duration if we have end time
    let durationMs: number | undefined;
    if (endTime) {
      const run = await this.runRepository.findById(runId);
      if (run) {
        const startMs = new Date(run.startTime).getTime();
        const endMs = new Date(endTime).getTime();
        durationMs = endMs - startMs;
      }
    }

    await this.runRepository.updateStatus(runId, status, endTime, durationMs);
    
    // Update response data if provided
    if (responseData && status === 'completed') {
      // Note: This would require extending the repository to update response data
      logger.debug('Run status updated', { runId, status, durationMs });
    }
  }

  async updateRunError(runId: string, error: Error | string, errorCode?: string): Promise<void> {
    const errorMessage = error instanceof Error ? error.message : error;
    const errorStack = error instanceof Error ? error.stack : undefined;
    
    await this.runRepository.updateError(runId, errorMessage, errorStack, errorCode);
    logger.debug('Run error updated', { runId, errorMessage });
  }

  async getExecutionTrace(executionId: string): Promise<RunRecord[]> {
    return this.runRepository.findByExecution(executionId);
  }

  async getWorkflowRuns(workflowId: string, limit = 100): Promise<RunRecord[]> {
    return this.runRepository.findByWorkflow(workflowId, limit);
  }

  async exportRuns(filters: any = {}): Promise<RunRecord[]> {
    return this.runRepository.export(filters);
  }
}