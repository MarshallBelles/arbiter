'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { 
  Activity, 
  Workflow, 
  Bot, 
  Calendar,
  TrendingUp,
  Clock,
  CheckCircle,
  AlertCircle
} from 'lucide-react';
import { api } from '@/lib/utils/api';
import { createLogger } from '@/lib/core/utils/logger';
import RunAnalytics from '@/components/RunAnalytics';

const logger = createLogger('DashboardPage');

interface SystemStatus {
  workflows: { total: number; enabled: number };
  agents: { total: number; runtime: number };
  executions: { active: number };
  events: { totalHandlers: number; enabledHandlers: number; totalTriggers: number };
  uptime: number;
  memory: { rss: number; heapUsed: number; heapTotal: number };
}

export default function Dashboard() {
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const response = await api.get('/health');
        setStatus(response.data);
      } catch (error) {
        logger.error('Failed to fetch system status', { error: error instanceof Error ? error.message : 'Unknown error' });
      } finally {
        setLoading(false);
      }
    };

    fetchStatus();
    const interval = setInterval(fetchStatus, 30000); // Update every 30 seconds
    
    return () => clearInterval(interval);
  }, []);

  const formatUptime = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
  };

  const formatMemory = (bytes: number) => {
    return `${Math.round(bytes / 1024 / 1024)}MB`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-arbiter-600"></div>
      </div>
    );
  }

  const stats = [
    {
      title: 'Total Workflows',
      value: status?.workflows.total || 0,
      icon: Workflow,
      color: 'text-blue-600',
      bgColor: 'bg-blue-100',
      change: '+12%',
      changeType: 'positive' as const,
    },
    {
      title: 'Active Agents',
      value: status?.agents.runtime || 0,
      icon: Bot,
      color: 'text-green-600',
      bgColor: 'bg-green-100',
      change: '+5%',
      changeType: 'positive' as const,
    },
    {
      title: 'Running Executions',
      value: status?.executions.active || 0,
      icon: Activity,
      color: 'text-yellow-600',
      bgColor: 'bg-yellow-100',
      change: '-3%',
      changeType: 'negative' as const,
    },
    {
      title: 'Event Handlers',
      value: status?.events.enabledHandlers || 0,
      icon: Calendar,
      color: 'text-purple-600',
      bgColor: 'bg-purple-100',
      change: '+8%',
      changeType: 'positive' as const,
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-gray-600">Welcome to Arbiter AI Agent Orchestration Platform</p>
        </div>
        <div className="flex space-x-3">
          <Link
            href="/workflows/designer"
            className="bg-arbiter-600 text-white px-4 py-2 rounded-md hover:bg-arbiter-700 transition-colors"
          >
            Create Workflow
          </Link>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <div key={stat.title} className="bg-white rounded-lg shadow p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">{stat.title}</p>
                  <p className="text-2xl font-bold text-gray-900">{stat.value}</p>
                </div>
                <div className={`p-3 rounded-full ${stat.bgColor}`}>
                  <Icon className={`w-6 h-6 ${stat.color}`} />
                </div>
              </div>
              <div className="mt-4 flex items-center">
                {stat.changeType === 'positive' ? (
                  <TrendingUp className="w-4 h-4 text-green-500" />
                ) : (
                  <TrendingUp className="w-4 h-4 text-red-500 rotate-180" />
                )}
                <span className={`ml-1 text-sm ${
                  stat.changeType === 'positive' ? 'text-green-600' : 'text-red-600'
                }`}>
                  {stat.change}
                </span>
                <span className="ml-1 text-sm text-gray-500">vs last week</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* System Status */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* System Health */}
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">System Health</h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <CheckCircle className="w-5 h-5 text-green-500 mr-2" />
                <span className="text-sm text-gray-600">API Server</span>
              </div>
              <span className="text-sm font-medium text-green-600">Healthy</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <CheckCircle className="w-5 h-5 text-green-500 mr-2" />
                <span className="text-sm text-gray-600">Workflow Engine</span>
              </div>
              <span className="text-sm font-medium text-green-600">Running</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <CheckCircle className="w-5 h-5 text-green-500 mr-2" />
                <span className="text-sm text-gray-600">Event System</span>
              </div>
              <span className="text-sm font-medium text-green-600">Active</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <AlertCircle className="w-5 h-5 text-yellow-500 mr-2" />
                <span className="text-sm text-gray-600">Memory Usage</span>
              </div>
              <span className="text-sm font-medium text-yellow-600">
                {status ? formatMemory(status.memory.heapUsed) : 'N/A'}
              </span>
            </div>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Quick Actions</h3>
          <div className="space-y-3">
            <Link
              href="/workflows/designer"
              className="flex items-center p-3 border border-gray-200 rounded-md hover:bg-gray-50 transition-colors"
            >
              <Workflow className="w-5 h-5 text-arbiter-600 mr-3" />
              <div>
                <p className="text-sm font-medium text-gray-900">Create New Workflow</p>
                <p className="text-xs text-gray-600">Design a new agent workflow</p>
              </div>
            </Link>
            <Link
              href="/agents"
              className="flex items-center p-3 border border-gray-200 rounded-md hover:bg-gray-50 transition-colors"
            >
              <Bot className="w-5 h-5 text-green-600 mr-3" />
              <div>
                <p className="text-sm font-medium text-gray-900">Manage Agents</p>
                <p className="text-xs text-gray-600">Configure AI agents</p>
              </div>
            </Link>
            <Link
              href="/events"
              className="flex items-center p-3 border border-gray-200 rounded-md hover:bg-gray-50 transition-colors"
            >
              <Calendar className="w-5 h-5 text-purple-600 mr-3" />
              <div>
                <p className="text-sm font-medium text-gray-900">Event Monitoring</p>
                <p className="text-xs text-gray-600">View event handlers and executions</p>
              </div>
            </Link>
          </div>
        </div>
      </div>

      {/* System Information */}
      {status && (
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">System Information</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p className="text-sm text-gray-600">Uptime</p>
              <p className="text-lg font-semibold text-gray-900 flex items-center">
                <Clock className="w-4 h-4 mr-1" />
                {formatUptime(status.uptime)}
              </p>
            </div>
            <div>
              <p className="text-sm text-gray-600">Memory</p>
              <p className="text-lg font-semibold text-gray-900">
                {formatMemory(status.memory.heapUsed)} / {formatMemory(status.memory.heapTotal)}
              </p>
            </div>
            <div>
              <p className="text-sm text-gray-600">Total Events</p>
              <p className="text-lg font-semibold text-gray-900">
                {status.events.totalTriggers}
              </p>
            </div>
            <div>
              <p className="text-sm text-gray-600">Active Workflows</p>
              <p className="text-lg font-semibold text-gray-900">
                {status.workflows.enabled}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Run Analytics */}
      <div>
        <h2 className="text-xl font-semibold text-gray-900 mb-4">Run Analytics & Debugging</h2>
        <RunAnalytics />
      </div>
    </div>
  );
}