'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { 
  Plus, 
  Search, 
  Filter,
  Play,
  Pause,
  Settings,
  Calendar,
  Bot,
  Activity
} from 'lucide-react';
import { api } from '@/lib/utils/api';
import { createLogger } from '@/lib/core/utils/logger';
import { useToast } from '@/hooks/useToast';

const logger = createLogger('WorkflowsPage');

interface Workflow {
  id: string;
  name: string;
  description: string;
  version: string;
  trigger: {
    type: string;
    config: Record<string, unknown>;
  };
  rootAgent: {
    name: string;
    model: string;
  };
  levels: Array<{
    level: number;
    agents: Array<{ name: string }>;
  }>;
  createdAt: string;
  updatedAt: string;
}

export default function Workflows() {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState('all');
  const { showSuccess, showError } = useToast();

  useEffect(() => {
    const fetchWorkflows = async () => {
      try {
        const response = await api.get('/workflows');
        setWorkflows(response.data);
      } catch (error) {
        logger.error('Failed to fetch workflows', { error: error instanceof Error ? error.message : 'Unknown error' });
      } finally {
        setLoading(false);
      }
    };

    fetchWorkflows();
  }, []);

  const filteredWorkflows = workflows.filter(workflow => {
    const matchesSearch = workflow.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         workflow.description.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesFilter = filterType === 'all' || workflow.trigger.type === filterType;
    
    return matchesSearch && matchesFilter;
  });

  const executeWorkflow = async (workflowId: string) => {
    try {
      await api.post(`/workflows/${workflowId}/execute`, {
        data: { source: 'manual', timestamp: new Date() }
      });
      showSuccess('Workflow Executed', 'The workflow has been started successfully');
      logger.info('Workflow executed successfully', { workflowId });
    } catch (error) {
      showError('Execution Failed', 'Failed to execute the workflow. Please try again.');
      logger.error('Failed to execute workflow', { 
        workflowId, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
    }
  };

  const getTriggerIcon = (type: string) => {
    switch (type) {
      case 'webhook':
        return '🔗';
      case 'cron':
        return '⏰';
      case 'manual':
        return '👋';
      case 'file-watch':
        return '📁';
      default:
        return '⚡';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-arbiter-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Workflows</h1>
          <p className="text-gray-600">Manage your AI agent workflows</p>
        </div>
        <Link
          href="/workflows/designer"
          className="bg-arbiter-600 text-white px-4 py-2 rounded-md hover:bg-arbiter-700 transition-colors flex items-center"
        >
          <Plus className="w-4 h-4 mr-2" />
          Create Workflow
        </Link>
      </div>

      {/* Search and Filter */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search workflows..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10 pr-4 py-2 w-full border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-arbiter-500 focus:border-transparent"
          />
        </div>
        <div className="relative">
          <Filter className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="pl-10 pr-8 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-arbiter-500 focus:border-transparent"
          >
            <option value="all">All Types</option>
            <option value="webhook">Webhook</option>
            <option value="cron">Cron</option>
            <option value="manual">Manual</option>
            <option value="file-watch">File Watch</option>
          </select>
        </div>
      </div>

      {/* Workflows Grid */}
      {filteredWorkflows.length === 0 ? (
        <div className="text-center py-12">
          <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Activity className="w-8 h-8 text-gray-400" />
          </div>
          <h3 className="text-lg font-medium text-gray-900 mb-2">No workflows found</h3>
          <p className="text-gray-600 mb-4">
            {workflows.length === 0 
              ? "Get started by creating your first workflow"
              : "Try adjusting your search or filter criteria"
            }
          </p>
          <Link
            href="/workflows/designer"
            className="bg-arbiter-600 text-white px-4 py-2 rounded-md hover:bg-arbiter-700 transition-colors"
          >
            Create Workflow
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredWorkflows.map((workflow) => (
            <div key={workflow.id} className="bg-white rounded-lg shadow hover:shadow-md transition-shadow">
              <div className="p-6">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900 mb-1">
                      {workflow.name}
                    </h3>
                    <p className="text-sm text-gray-600 line-clamp-2">
                      {workflow.description}
                    </p>
                  </div>
                  <div className="text-2xl">
                    {getTriggerIcon(workflow.trigger.type)}
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center text-sm text-gray-600">
                    <Calendar className="w-4 h-4 mr-2" />
                    <span className="capitalize">{workflow.trigger.type} trigger</span>
                  </div>
                  
                  <div className="flex items-center text-sm text-gray-600">
                    <Bot className="w-4 h-4 mr-2" />
                    <span>
                      {workflow.levels.reduce((total, level) => total + level.agents.length, 1)} agents
                    </span>
                  </div>

                  <div className="flex items-center text-sm text-gray-600">
                    <Activity className="w-4 h-4 mr-2" />
                    <span>v{workflow.version}</span>
                  </div>
                </div>

                <div className="mt-6 flex items-center justify-between">
                  <div className="flex space-x-2">
                    <button
                      onClick={() => executeWorkflow(workflow.id)}
                      className="p-2 text-green-600 hover:bg-green-100 rounded-md transition-colors"
                      title="Execute workflow"
                    >
                      <Play className="w-4 h-4" />
                    </button>
                    <button
                      className="p-2 text-gray-600 hover:bg-gray-100 rounded-md transition-colors"
                      title="Pause workflow"
                    >
                      <Pause className="w-4 h-4" />
                    </button>
                    <button
                      className="p-2 text-gray-600 hover:bg-gray-100 rounded-md transition-colors"
                      title="Settings"
                    >
                      <Settings className="w-4 h-4" />
                    </button>
                  </div>
                  
                  <Link
                    href={`/workflows/designer?id=${workflow.id}`}
                    className="text-sm font-medium text-arbiter-600 hover:text-arbiter-700"
                  >
                    Edit
                  </Link>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}