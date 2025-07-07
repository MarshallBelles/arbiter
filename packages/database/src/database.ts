import sqlite3 from 'sqlite3';
import { promisify } from 'util';
import { createLogger } from '@arbiter/core';
import { DatabaseConfig, RunRecord, WorkflowRecord, AgentRecord } from './types';

const logger = createLogger('Database');

export class ArbiterDatabase {
  private db: sqlite3.Database;
  private dbRun: (sql: string, ...params: any[]) => Promise<sqlite3.RunResult>;
  private dbGet: (sql: string, ...params: any[]) => Promise<any>;
  private dbAll: (sql: string, ...params: any[]) => Promise<any[]>;

  constructor(config: DatabaseConfig) {
    this.db = new sqlite3.Database(config.path);
    
    // Promisify database methods with proper context
    this.dbRun = (sql: string, ...params: any[]) => {
      return new Promise((resolve, reject) => {
        this.db.run(sql, params, function(err) {
          if (err) reject(err);
          else resolve(this);
        });
      });
    };
    
    this.dbGet = (sql: string, ...params: any[]) => {
      return new Promise((resolve, reject) => {
        this.db.get(sql, params, (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });
    };
    
    this.dbAll = (sql: string, ...params: any[]) => {
      return new Promise((resolve, reject) => {
        this.db.all(sql, params, (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      });
    };
    
    this.initializeTables();
    
    logger.info('Database initialized', { path: config.path });
  }

  private initializeTables(): void {
    // Use exec for schema creation (synchronous)
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      
      CREATE TABLE IF NOT EXISTS workflows (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        version TEXT NOT NULL,
        user_prompt TEXT,
        config JSON NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        model TEXT NOT NULL,
        system_prompt TEXT NOT NULL,
        available_tools JSON NOT NULL,
        level INTEGER NOT NULL,
        input_schema JSON,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        workflow_id TEXT NOT NULL,
        execution_id TEXT,
        run_type TEXT NOT NULL CHECK (run_type IN ('workflow_execution', 'agent_execution', 'tool_call', 'api_request', 'model_request')),
        status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
        start_time TEXT NOT NULL,
        end_time TEXT,
        duration_ms INTEGER,
        
        -- Request/Response data for debugging
        request_data JSON,
        response_data JSON,
        raw_request TEXT,
        raw_response TEXT,
        
        -- Context and metadata
        parent_run_id TEXT,
        agent_id TEXT,
        tool_name TEXT,
        model_name TEXT,
        user_prompt TEXT,
        system_prompt TEXT,
        
        -- Performance metrics
        tokens_used INTEGER DEFAULT 0,
        memory_used_mb REAL,
        cpu_time_ms INTEGER,
        
        -- Error tracking
        error_message TEXT,
        error_stack TEXT,
        error_code TEXT,
        
        -- Additional metadata
        metadata JSON,
        tags JSON,
        
        FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE,
        FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE SET NULL,
        FOREIGN KEY (parent_run_id) REFERENCES runs(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_runs_workflow_id ON runs(workflow_id);
      CREATE INDEX IF NOT EXISTS idx_runs_execution_id ON runs(execution_id);
      CREATE INDEX IF NOT EXISTS idx_runs_start_time ON runs(start_time);
      CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);
      CREATE INDEX IF NOT EXISTS idx_runs_run_type ON runs(run_type);
      CREATE INDEX IF NOT EXISTS idx_runs_parent_run_id ON runs(parent_run_id);
      CREATE INDEX IF NOT EXISTS idx_runs_agent_id ON runs(agent_id);
    `);

    logger.info('Database tables initialized');
  }

  // Workflow operations
  async insertWorkflow(workflow: WorkflowRecord): Promise<void> {
    await this.dbRun(`
      INSERT INTO workflows (id, name, description, version, user_prompt, config, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, 
      workflow.id,
      workflow.name,
      workflow.description,
      workflow.version,
      workflow.userPrompt,
      JSON.stringify(workflow.config),
      workflow.createdAt,
      workflow.updatedAt
    );
  }

  async getWorkflow(id: string): Promise<WorkflowRecord | undefined> {
    const row = await this.dbGet('SELECT * FROM workflows WHERE id = ?', id);
    
    if (!row) return undefined;
    
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      version: row.version,
      userPrompt: row.user_prompt,
      config: JSON.parse(row.config),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async listWorkflows(): Promise<WorkflowRecord[]> {
    const rows = await this.dbAll('SELECT * FROM workflows ORDER BY created_at DESC');
    
    return rows.map(row => ({
      id: row.id,
      name: row.name,
      description: row.description,
      version: row.version,
      userPrompt: row.user_prompt,
      config: JSON.parse(row.config),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  async updateWorkflow(id: string, workflow: Partial<WorkflowRecord>): Promise<void> {
    const updates: string[] = [];
    const values: any[] = [];
    
    if (workflow.name !== undefined) {
      updates.push('name = ?');
      values.push(workflow.name);
    }
    if (workflow.description !== undefined) {
      updates.push('description = ?');
      values.push(workflow.description);
    }
    if (workflow.version !== undefined) {
      updates.push('version = ?');
      values.push(workflow.version);
    }
    if (workflow.userPrompt !== undefined) {
      updates.push('user_prompt = ?');
      values.push(workflow.userPrompt);
    }
    if (workflow.config !== undefined) {
      updates.push('config = ?');
      values.push(JSON.stringify(workflow.config));
    }
    if (workflow.updatedAt !== undefined) {
      updates.push('updated_at = ?');
      values.push(workflow.updatedAt);
    }
    
    if (updates.length === 0) return;
    
    values.push(id);
    await this.dbRun(`UPDATE workflows SET ${updates.join(', ')} WHERE id = ?`, ...values);
  }

  async deleteWorkflow(id: string): Promise<boolean> {
    const result = await this.dbRun('DELETE FROM workflows WHERE id = ?', id);
    return result && (result as any).changes ? (result as any).changes > 0 : false;
  }

  // Agent operations
  async insertAgent(agent: AgentRecord): Promise<void> {
    await this.dbRun(`
      INSERT INTO agents (id, name, description, model, system_prompt, available_tools, level, input_schema, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      agent.id,
      agent.name,
      agent.description,
      agent.model,
      agent.systemPrompt,
      JSON.stringify(agent.availableTools),
      agent.level,
      agent.inputSchema ? JSON.stringify(agent.inputSchema) : null,
      agent.createdAt,
      agent.updatedAt
    );
  }

  async getAgent(id: string): Promise<AgentRecord | undefined> {
    const row = await this.dbGet('SELECT * FROM agents WHERE id = ?', id);
    
    if (!row) return undefined;
    
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      model: row.model,
      systemPrompt: row.system_prompt,
      availableTools: JSON.parse(row.available_tools),
      level: row.level,
      inputSchema: row.input_schema ? JSON.parse(row.input_schema) : undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async listAgents(): Promise<AgentRecord[]> {
    const rows = await this.dbAll('SELECT * FROM agents ORDER BY created_at DESC');
    
    return rows.map(row => ({
      id: row.id,
      name: row.name,
      description: row.description,
      model: row.model,
      systemPrompt: row.system_prompt,
      availableTools: JSON.parse(row.available_tools),
      level: row.level,
      inputSchema: row.input_schema ? JSON.parse(row.input_schema) : undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  async deleteAgent(id: string): Promise<boolean> {
    const result = await this.dbRun('DELETE FROM agents WHERE id = ?', id);
    return result && (result as any).changes ? (result as any).changes > 0 : false;
  }

  // Run logging operations for debugging
  async insertRun(run: RunRecord): Promise<void> {
    await this.dbRun(`
      INSERT INTO runs (
        id, workflow_id, execution_id, run_type, status, start_time, end_time, duration_ms,
        request_data, response_data, raw_request, raw_response,
        parent_run_id, agent_id, tool_name, model_name, user_prompt, system_prompt,
        tokens_used, memory_used_mb, cpu_time_ms,
        error_message, error_stack, error_code,
        metadata, tags
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      run.id,
      run.workflowId,
      run.executionId,
      run.runType,
      run.status,
      run.startTime,
      run.endTime,
      run.durationMs,
      run.requestData ? JSON.stringify(run.requestData) : null,
      run.responseData ? JSON.stringify(run.responseData) : null,
      run.rawRequest,
      run.rawResponse,
      run.parentRunId,
      run.agentId,
      run.toolName,
      run.modelName,
      run.userPrompt,
      run.systemPrompt,
      run.tokensUsed || 0,
      run.memoryUsedMb,
      run.cpuTimeMs,
      run.errorMessage,
      run.errorStack,
      run.errorCode,
      run.metadata ? JSON.stringify(run.metadata) : null,
      run.tags ? JSON.stringify(run.tags) : null
    );
  }

  async updateRunStatus(id: string, status: string, endTime?: string, durationMs?: number): Promise<void> {
    await this.dbRun(`
      UPDATE runs SET status = ?, end_time = ?, duration_ms = ? WHERE id = ?
    `, status, endTime, durationMs, id);
  }

  async updateRunError(id: string, errorMessage: string, errorStack?: string, errorCode?: string): Promise<void> {
    await this.dbRun(`
      UPDATE runs SET error_message = ?, error_stack = ?, error_code = ?, status = 'failed' WHERE id = ?
    `, errorMessage, errorStack, errorCode, id);
  }

  async getRun(id: string): Promise<RunRecord | undefined> {
    const row = await this.dbGet('SELECT * FROM runs WHERE id = ?', id);
    
    if (!row) return undefined;
    
    return this.mapRowToRunRecord(row);
  }

  async getRunsByWorkflow(workflowId: string, limit = 100): Promise<RunRecord[]> {
    const rows = await this.dbAll(`
      SELECT * FROM runs WHERE workflow_id = ? ORDER BY start_time DESC LIMIT ?
    `, workflowId, limit);
    
    return rows.map(row => this.mapRowToRunRecord(row));
  }

  async getRunsByExecution(executionId: string): Promise<RunRecord[]> {
    const rows = await this.dbAll(`
      SELECT * FROM runs WHERE execution_id = ? ORDER BY start_time ASC
    `, executionId);
    
    return rows.map(row => this.mapRowToRunRecord(row));
  }

  async searchRuns(filters: {
    workflowId?: string;
    status?: string;
    runType?: string;
    agentId?: string;
    startDate?: string;
    endDate?: string;
    limit?: number;
  }): Promise<RunRecord[]> {
    let query = 'SELECT * FROM runs WHERE 1=1';
    const params: any[] = [];
    
    if (filters.workflowId) {
      query += ' AND workflow_id = ?';
      params.push(filters.workflowId);
    }
    if (filters.status) {
      query += ' AND status = ?';
      params.push(filters.status);
    }
    if (filters.runType) {
      query += ' AND run_type = ?';
      params.push(filters.runType);
    }
    if (filters.agentId) {
      query += ' AND agent_id = ?';
      params.push(filters.agentId);
    }
    if (filters.startDate) {
      query += ' AND start_time >= ?';
      params.push(filters.startDate);
    }
    if (filters.endDate) {
      query += ' AND start_time <= ?';
      params.push(filters.endDate);
    }
    
    query += ' ORDER BY start_time DESC';
    
    if (filters.limit) {
      query += ' LIMIT ?';
      params.push(filters.limit);
    }
    
    const rows = await this.dbAll(query, ...params);
    
    return rows.map(row => this.mapRowToRunRecord(row));
  }

  private mapRowToRunRecord(row: any): RunRecord {
    return {
      id: row.id,
      workflowId: row.workflow_id,
      executionId: row.execution_id,
      runType: row.run_type,
      status: row.status,
      startTime: row.start_time,
      endTime: row.end_time,
      durationMs: row.duration_ms,
      requestData: row.request_data ? JSON.parse(row.request_data) : undefined,
      responseData: row.response_data ? JSON.parse(row.response_data) : undefined,
      rawRequest: row.raw_request,
      rawResponse: row.raw_response,
      parentRunId: row.parent_run_id,
      agentId: row.agent_id,
      toolName: row.tool_name,
      modelName: row.model_name,
      userPrompt: row.user_prompt,
      systemPrompt: row.system_prompt,
      tokensUsed: row.tokens_used,
      memoryUsedMb: row.memory_used_mb,
      cpuTimeMs: row.cpu_time_ms,
      errorMessage: row.error_message,
      errorStack: row.error_stack,
      errorCode: row.error_code,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      tags: row.tags ? JSON.parse(row.tags) : undefined,
    };
  }

  // Analytics and debugging helpers
  async getRunStats(workflowId?: string): Promise<{
    totalRuns: number;
    successfulRuns: number;
    failedRuns: number;
    averageDuration: number;
    totalTokens: number;
  }> {
    let query = `
      SELECT 
        COUNT(*) as total_runs,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as successful_runs,
        COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_runs,
        AVG(duration_ms) as average_duration,
        SUM(tokens_used) as total_tokens
      FROM runs
    `;
    
    const params: any[] = [];
    if (workflowId) {
      query += ' WHERE workflow_id = ?';
      params.push(workflowId);
    }
    
    const result = await this.dbGet(query, ...params);
    
    return {
      totalRuns: result.total_runs || 0,
      successfulRuns: result.successful_runs || 0,
      failedRuns: result.failed_runs || 0,
      averageDuration: result.average_duration || 0,
      totalTokens: result.total_tokens || 0,
    };
  }

  async exportRuns(filters: any = {}): Promise<RunRecord[]> {
    return this.searchRuns({ ...filters, limit: undefined });
  }

  close(): void {
    this.db.close();
    logger.info('Database connection closed');
  }
}