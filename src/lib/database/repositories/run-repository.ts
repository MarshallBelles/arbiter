import { ArbiterDatabase } from '../database';
import { RunRecord, RunFilters, RunStats } from '../types';

export class RunRepository {
  constructor(private db: ArbiterDatabase) {}

  async create(run: RunRecord): Promise<void> {
    await this.db.insertRun(run);
  }

  async findById(id: string): Promise<RunRecord | null> {
    return await this.db.getRun(id) || null;
  }

  async findByWorkflow(workflowId: string, limit = 100): Promise<RunRecord[]> {
    return await this.db.getRunsByWorkflow(workflowId, limit);
  }

  async findByExecution(executionId: string): Promise<RunRecord[]> {
    return await this.db.getRunsByExecution(executionId);
  }

  async search(filters: RunFilters): Promise<RunRecord[]> {
    return await this.db.searchRuns(filters);
  }

  async updateStatus(id: string, status: string, endTime?: string, durationMs?: number): Promise<void> {
    await this.db.updateRunStatus(id, status, endTime, durationMs);
  }

  async updateError(id: string, errorMessage: string, errorStack?: string, errorCode?: string): Promise<void> {
    await this.db.updateRunError(id, errorMessage, errorStack, errorCode);
  }

  async getStats(workflowId?: string): Promise<RunStats> {
    return await this.db.getRunStats(workflowId);
  }

  async export(filters: RunFilters = {}): Promise<RunRecord[]> {
    return await this.db.exportRuns(filters);
  }

  async getRecentErrors(limit = 50): Promise<RunRecord[]> {
    return this.search({
      status: 'failed',
      limit,
    });
  }

  async getPerformanceMetrics(workflowId?: string): Promise<{
    averageTokensPerRun: number;
    averageMemoryUsage: number;
    averageCpuTime: number;
    totalRuns: number;
  }> {
    const runs = await this.search({
      workflowId,
      status: 'completed',
      limit: 1000,
    });

    if (runs.length === 0) {
      return {
        averageTokensPerRun: 0,
        averageMemoryUsage: 0,
        averageCpuTime: 0,
        totalRuns: 0,
      };
    }

    const totalTokens = runs.reduce((sum, run) => sum + (run.tokensUsed || 0), 0);
    const totalMemory = runs.reduce((sum, run) => sum + (run.memoryUsedMb || 0), 0);
    const totalCpuTime = runs.reduce((sum, run) => sum + (run.cpuTimeMs || 0), 0);

    return {
      averageTokensPerRun: totalTokens / runs.length,
      averageMemoryUsage: totalMemory / runs.length,
      averageCpuTime: totalCpuTime / runs.length,
      totalRuns: runs.length,
    };
  }

  generateRunId(prefix = 'run'): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }
}