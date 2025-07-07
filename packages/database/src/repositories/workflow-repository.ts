import { WorkflowConfig } from '@arbiter/core';
import { ArbiterDatabase } from '../database';
import { WorkflowRecord } from '../types';

export class WorkflowRepository {
  constructor(private db: ArbiterDatabase) {}

  async create(workflow: WorkflowConfig): Promise<void> {
    const record: WorkflowRecord = {
      id: workflow.id,
      name: workflow.name,
      description: workflow.description,
      version: workflow.version,
      userPrompt: workflow.userPrompt,
      config: workflow,
      createdAt: workflow.createdAt?.toISOString() || new Date().toISOString(),
      updatedAt: workflow.updatedAt?.toISOString() || new Date().toISOString(),
    };

    await this.db.insertWorkflow(record);
  }

  async findById(id: string): Promise<WorkflowConfig | null> {
    const record = await this.db.getWorkflow(id);
    if (!record) return null;

    return {
      ...record.config,
      createdAt: new Date(record.createdAt),
      updatedAt: new Date(record.updatedAt),
    };
  }

  async findAll(): Promise<WorkflowConfig[]> {
    const records = await this.db.listWorkflows();
    return records.map(record => ({
      ...record.config,
      createdAt: new Date(record.createdAt),
      updatedAt: new Date(record.updatedAt),
    }));
  }

  async update(id: string, workflow: WorkflowConfig): Promise<void> {
    const record: Partial<WorkflowRecord> = {
      name: workflow.name,
      description: workflow.description,
      version: workflow.version,
      userPrompt: workflow.userPrompt,
      config: workflow,
      updatedAt: new Date().toISOString(),
    };

    await this.db.updateWorkflow(id, record);
  }

  async delete(id: string): Promise<boolean> {
    return await this.db.deleteWorkflow(id);
  }

  async exists(id: string): Promise<boolean> {
    const record = await this.db.getWorkflow(id);
    return record !== undefined;
  }
}