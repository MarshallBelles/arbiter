import { AgentConfig } from '@arbiter/core';
import { ArbiterDatabase } from '../database';
import { AgentRecord } from '../types';

export class AgentRepository {
  constructor(private db: ArbiterDatabase) {}

  async create(agent: AgentConfig): Promise<void> {
    const record: AgentRecord = {
      id: agent.id,
      name: agent.name,
      description: agent.description,
      model: agent.model,
      systemPrompt: agent.systemPrompt,
      availableTools: agent.availableTools,
      level: agent.level,
      inputSchema: agent.inputSchema,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await this.db.insertAgent(record);
  }

  async findById(id: string): Promise<AgentConfig | null> {
    const record = await this.db.getAgent(id);
    if (!record) return null;

    return {
      id: record.id,
      name: record.name,
      description: record.description,
      model: record.model,
      systemPrompt: record.systemPrompt,
      availableTools: record.availableTools,
      level: record.level,
      inputSchema: record.inputSchema,
    };
  }

  async findAll(): Promise<AgentConfig[]> {
    const records = await this.db.listAgents();
    return records.map(record => ({
      id: record.id,
      name: record.name,
      description: record.description,
      model: record.model,
      systemPrompt: record.systemPrompt,
      availableTools: record.availableTools,
      level: record.level,
      inputSchema: record.inputSchema,
    }));
  }

  async delete(id: string): Promise<boolean> {
    return await this.db.deleteAgent(id);
  }

  async exists(id: string): Promise<boolean> {
    const record = await this.db.getAgent(id);
    return record !== undefined;
  }

  async findByLevel(level: number): Promise<AgentConfig[]> {
    const allAgents = await this.findAll();
    return allAgents.filter(agent => agent.level === level);
  }

  async findByModel(model: string): Promise<AgentConfig[]> {
    const allAgents = await this.findAll();
    return allAgents.filter(agent => agent.model === model);
  }
}