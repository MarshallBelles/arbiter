
'use client';

import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import RunViewer from '@/components/RunViewer';
import { 
  Activity, 
  Search, 
  Download, 
  Filter, 
  Clock, 
  AlertCircle, 
  CheckCircle, 
  XCircle,
  BarChart3,
  RefreshCw,
  Calendar,
  Zap
} from 'lucide-react';

interface RunRecord {
  id: string;
  workflowId: string;
  executionId?: string;
  runType: 'workflow_execution' | 'agent_execution' | 'tool_call' | 'api_request' | 'model_request';
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  startTime: string;
  endTime?: string;
  durationMs?: number;
  requestData?: any;
  responseData?: any;
  rawRequest?: string;
  rawResponse?: string;
  parentRunId?: string;
  agentId?: string;
  toolName?: string;
  modelName?: string;
  userPrompt?: string;
  systemPrompt?: string;
  tokensUsed?: number;
  memoryUsedMb?: number;
  cpuTimeMs?: number;
  errorMessage?: string;
  errorStack?: string;
  errorCode?: string;
  metadata?: any;
  tags?: string[];
}

interface RunStats {
  totalRuns: number;
  completedRuns: number;
  failedRuns: number;
  runningRuns: number;
  avgDuration: number;
  totalTokens: number;
  successRate: number;
}

export default function RunsPage() {
  const searchParams = useSearchParams();
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [filteredRuns, setFilteredRuns] = useState<RunRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRun, setSelectedRun] = useState<RunRecord | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  
  // Filters
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterType, setFilterType] = useState<string>('all');
  const [filterWorkflowId, setFilterWorkflowId] = useState<string>(searchParams?.get('workflowId') || '');
  const [filterAgentId, setFilterAgentId] = useState<string>(searchParams?.get('agentId') || '');
  const [showFilters, setShowFilters] = useState(false);
  const [limit, setLimit] = useState(100);

  const [stats, setStats] = useState<RunStats>({
    totalRuns: 0,
    completedRuns: 0,
    failedRuns: 0,
    runningRuns: 0,
    avgDuration: 0,
    totalTokens: 0,
    successRate: 0
  });

  useEffect(() => {
    fetchRuns();
  }, [filterStatus, filterType, filterWorkflowId, filterAgentId, limit]);

  useEffect(() => {
    // Filter runs based on search term
    let filtered = runs;
    
    if (searchTerm) {
      filtered = filtered.filter(run =>
        run.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
        run.workflowId.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (run.agentId && run.agentId.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (run.toolName && run.toolName.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (run.errorMessage && run.errorMessage.toLowerCase().includes(searchTerm.toLowerCase()))
      );
    }
    
    setFilteredRuns(filtered);
  }, [runs, searchTerm]);

  const fetchRuns = async () => {
    try {
      const queryParams = new URLSearchParams();
      if (filterStatus !== 'all') queryParams.append('status', filterStatus);
      if (filterType !== 'all') queryParams.append('runType', filterType);
      if (filterWorkflowId) queryParams.append('workflowId', filterWorkflowId);
      if (filterAgentId) queryParams.append('agentId', filterAgentId);
      queryParams.append('limit', limit.toString());

      const response = await fetch(`/api/runs?${queryParams}`);
      if (!response.ok) throw new Error('Failed to fetch runs');
      
      const data = await response.json();
      const runsData = data.runs || [];
      setRuns(runsData);
      
      // Calculate stats
      const totalRuns = runsData.length;
      const completedRuns = runsData.filter((r: RunRecord) => r.status === 'completed').length;
      const failedRuns = runsData.filter((r: RunRecord) => r.status === 'failed').length;
      const runningRuns = runsData.filter((r: RunRecord) => r.status === 'running').length;
      
      const durations = runsData
        .filter((r: RunRecord) => r.durationMs)
        .map((r: RunRecord) => r.durationMs || 0);
      const avgDuration = durations.length > 0 
        ? durations.reduce((sum, dur) => sum + dur, 0) / durations.length 
        : 0;
      
      const totalTokens = runsData
        .reduce((sum: number, r: RunRecord) => sum + (r.tokensUsed || 0), 0);
      
      const successRate = totalRuns > 0 ? (completedRuns / totalRuns) * 100 : 0;
      
      setStats({
        totalRuns,
        completedRuns,
        failedRuns,
        runningRuns,
        avgDuration,
        totalTokens,
        successRate
      });
      
    } catch (error) {
      console.error('Failed to fetch runs:', error);
    } finally {
      setLoading(false);
    }
  };

  const exportRuns = async () => {
    try {
      const queryParams = new URLSearchParams();
      if (filterStatus !== 'all') queryParams.append('status', filterStatus);
      if (filterType !== 'all') queryParams.append('runType', filterType);
      if (filterWorkflowId) queryParams.append('workflowId', filterWorkflowId);
      if (filterAgentId) queryParams.append('agentId', filterAgentId);

      const response = await fetch('/api/runs/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.fromEntries(queryParams)),
      });
      
      if (!response.ok) throw new Error('Failed to export runs');
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `arbiter-runs-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Export failed:', error);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed': return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'failed': return <XCircle className="w-4 h-4 text-red-500" />;
      case 'running': return <Clock className="w-4 h-4 text-blue-500 animate-spin" />;
      case 'pending': return <Clock className="w-4 h-4 text-yellow-500" />;
      case 'cancelled': return <XCircle className="w-4 h-4 text-gray-500" />;
      default: return <AlertCircle className="w-4 h-4 text-gray-400" />;
    }
  };

  const formatDuration = (durationMs?: number) => {
    if (!durationMs) return 'N/A';
    if (durationMs < 1000) return `${durationMs}ms`;
    if (durationMs < 60000) return `${(durationMs / 1000).toFixed(1)}s`;
    return `${(durationMs / 60000).toFixed(1)}m`;
  };

  const formatTimestamp = (timestamp: string) => {
    return new Date(timestamp).toLocaleString();
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
          <h1 className="text-2xl font-bold text-gray-900">Run History</h1>
          <p className="text-gray-600">Comprehensive execution logs and analytics</p>
        </div>
        <div className="flex items-center space-x-2">
          <Button variant="outline" onClick={fetchRuns} size="sm">
            <RefreshCw className="w-4 h-4" />
          </Button>
          <Button variant="outline" onClick={exportRuns} size="sm">
            <Download className="w-4 h-4 mr-2" />
            Export
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Total Runs</p>
                <p className="text-2xl font-bold">{stats.totalRuns}</p>
              </div>
              <Activity className="w-8 h-8 text-gray-400" />
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Completed</p>
                <p className="text-2xl font-bold text-green-600">{stats.completedRuns}</p>
              </div>
              <CheckCircle className="w-8 h-8 text-green-400" />
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Failed</p>
                <p className="text-2xl font-bold text-red-600">{stats.failedRuns}</p>
              </div>
              <XCircle className="w-8 h-8 text-red-400" />
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Running</p>
                <p className="text-2xl font-bold text-blue-600">{stats.runningRuns}</p>
              </div>
              <Clock className="w-8 h-8 text-blue-400" />
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Success Rate</p>
                <p className="text-2xl font-bold">{Math.round(stats.successRate)}%</p>
              </div>
              <BarChart3 className="w-8 h-8 text-gray-400" />
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Avg Duration</p>
                <p className="text-2xl font-bold">{formatDuration(stats.avgDuration)}</p>
              </div>
              <Clock className="w-8 h-8 text-gray-400" />
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Total Tokens</p>
                <p className="text-2xl font-bold">{stats.totalTokens.toLocaleString()}</p>
              </div>
              <Zap className="w-8 h-8 text-gray-400" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Search and Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="space-y-4">
            {/* Search */}
            <div className="flex flex-col sm:flex-row gap-4">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                <Input
                  type="text"
                  placeholder="Search runs by ID, workflow, agent, tool, or error..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
              
              <Button
                variant="outline"
                onClick={() => setShowFilters(!showFilters)}
              >
                <Filter className="w-4 h-4 mr-2" />
                Filters
              </Button>
            </div>

            {/* Advanced Filters */}
            {showFilters && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 p-4 bg-gray-50 rounded-lg">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                  <select
                    value={filterStatus}
                    onChange={(e) => setFilterStatus(e.target.value)}
                    className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-arbiter-500"
                  >
                    <option value="all">All Statuses</option>
                    <option value="pending">Pending</option>
                    <option value="running">Running</option>
                    <option value="completed">Completed</option>
                    <option value="failed">Failed</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Run Type</label>
                  <select
                    value={filterType}
                    onChange={(e) => setFilterType(e.target.value)}
                    className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-arbiter-500"
                  >
                    <option value="all">All Types</option>
                    <option value="workflow_execution">Workflow Execution</option>
                    <option value="agent_execution">Agent Execution</option>
                    <option value="tool_call">Tool Call</option>
                    <option value="api_request">API Request</option>
                    <option value="model_request">Model Request</option>
                  </select>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Workflow ID</label>
                  <Input
                    type="text"
                    value={filterWorkflowId}
                    onChange={(e) => setFilterWorkflowId(e.target.value)}
                    placeholder="Filter by workflow..."
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Agent ID</label>
                  <Input
                    type="text"
                    value={filterAgentId}
                    onChange={(e) => setFilterAgentId(e.target.value)}
                    placeholder="Filter by agent..."
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Limit</label>
                  <select
                    value={limit}
                    onChange={(e) => setLimit(parseInt(e.target.value))}
                    className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-arbiter-500"
                  >
                    <option value={50}>50 runs</option>
                    <option value={100}>100 runs</option>
                    <option value={500}>500 runs</option>
                    <option value={1000}>1000 runs</option>
                  </select>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Results Summary */}
      <div className="text-sm text-gray-600">
        Showing {filteredRuns.length} of {runs.length} runs
      </div>

      {/* Runs Table */}
      <Card>
        <CardHeader>
          <CardTitle>Execution History</CardTitle>
        </CardHeader>
        <CardContent>
          {filteredRuns.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <Activity className="w-12 h-12 mx-auto mb-4 text-gray-300" />
              <p>No runs found matching your criteria</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Type</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">ID</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Workflow</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Started</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Duration</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Details</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {filteredRuns.map((run) => (
                    <tr
                      key={run.id}
                      className="hover:bg-gray-50 cursor-pointer"
                      onClick={() => setSelectedRun(run)}
                    >
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          {getStatusIcon(run.status)}
                          <span className="text-sm capitalize">{run.status}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {run.runType.replace('_', ' ')}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-mono text-gray-700">
                        {run.id.substring(0, 12)}...
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {run.workflowId}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {formatTimestamp(run.startTime)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {formatDuration(run.durationMs)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {run.agentId && <span className="mr-2">Agent: {run.agentId}</span>}
                        {run.toolName && <span className="mr-2">Tool: {run.toolName}</span>}
                        {run.tokensUsed && <span>Tokens: {run.tokensUsed}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Run Detail Modal */}
      {selectedRun && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-6xl w-full max-h-[90vh] overflow-hidden">
            <div className="flex justify-between items-center p-6 border-b">
              <h2 className="text-xl font-semibold">Run Details</h2>
              <button
                onClick={() => setSelectedRun(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                <XCircle className="w-6 h-6" />
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto max-h-[80vh]">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <h3 className="text-lg font-medium mb-3">Basic Information</h3>
                  <div className="space-y-2 text-sm">
                    <div><span className="font-medium">ID:</span> {selectedRun.id}</div>
                    <div><span className="font-medium">Status:</span> 
                      <span className="ml-2 flex items-center gap-1">
                        {getStatusIcon(selectedRun.status)}
                        {selectedRun.status}
                      </span>
                    </div>
                    <div><span className="font-medium">Type:</span> {selectedRun.runType}</div>
                    <div><span className="font-medium">Workflow:</span> {selectedRun.workflowId}</div>
                    <div><span className="font-medium">Started:</span> {formatTimestamp(selectedRun.startTime)}</div>
                    {selectedRun.endTime && (
                      <div><span className="font-medium">Ended:</span> {formatTimestamp(selectedRun.endTime)}</div>
                    )}
                    <div><span className="font-medium">Duration:</span> {formatDuration(selectedRun.durationMs)}</div>
                  </div>
                </div>

                <div>
                  <h3 className="text-lg font-medium mb-3">Performance Metrics</h3>
                  <div className="space-y-2 text-sm">
                    {selectedRun.tokensUsed && (
                      <div><span className="font-medium">Tokens Used:</span> {selectedRun.tokensUsed}</div>
                    )}
                    {selectedRun.memoryUsedMb && (
                      <div><span className="font-medium">Memory:</span> {selectedRun.memoryUsedMb.toFixed(1)} MB</div>
                    )}
                    {selectedRun.cpuTimeMs && (
                      <div><span className="font-medium">CPU Time:</span> {selectedRun.cpuTimeMs}ms</div>
                    )}
                    {selectedRun.agentId && (
                      <div><span className="font-medium">Agent:</span> {selectedRun.agentId}</div>
                    )}
                    {selectedRun.toolName && (
                      <div><span className="font-medium">Tool:</span> {selectedRun.toolName}</div>
                    )}
                    {selectedRun.modelName && (
                      <div><span className="font-medium">Model:</span> {selectedRun.modelName}</div>
                    )}
                  </div>
                </div>
              </div>

              {selectedRun.errorMessage && (
                <div className="mt-6">
                  <h3 className="text-lg font-medium mb-3 text-red-600">Error Details</h3>
                  <div className="bg-red-50 p-4 rounded-lg">
                    <div className="text-sm text-red-800">
                      <div><span className="font-medium">Message:</span> {selectedRun.errorMessage}</div>
                      {selectedRun.errorCode && (
                        <div className="mt-1"><span className="font-medium">Code:</span> {selectedRun.errorCode}</div>
                      )}
                    </div>
                    {selectedRun.errorStack && (
                      <details className="mt-3">
                        <summary className="cursor-pointer text-red-700 font-medium">Stack Trace</summary>
                        <pre className="mt-2 text-xs bg-red-100 p-2 rounded overflow-x-auto">
                          {selectedRun.errorStack}
                        </pre>
                      </details>
                    )}
                  </div>
                </div>
              )}

              {(selectedRun.requestData || selectedRun.responseData) && (
                <div className="mt-6">
                  <h3 className="text-lg font-medium mb-3">Request/Response Data</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {selectedRun.requestData && (
                      <div>
                        <h4 className="font-medium mb-2">Request Data</h4>
                        <pre className="text-xs bg-gray-100 p-3 rounded overflow-x-auto">
                          {JSON.stringify(selectedRun.requestData, null, 2)}
                        </pre>
                      </div>
                    )}
                    {selectedRun.responseData && (
                      <div>
                        <h4 className="font-medium mb-2">Response Data</h4>
                        <pre className="text-xs bg-gray-100 p-3 rounded overflow-x-auto">
                          {JSON.stringify(selectedRun.responseData, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {(selectedRun.rawRequest || selectedRun.rawResponse) && (
                <div className="mt-6">
                  <h3 className="text-lg font-medium mb-3">Raw Request/Response</h3>
                  <div className="space-y-4">
                    {selectedRun.rawRequest && (
                      <div>
                        <h4 className="font-medium mb-2">Raw Request</h4>
                        <pre className="text-xs bg-gray-100 p-3 rounded overflow-x-auto">
                          {selectedRun.rawRequest}
                        </pre>
                      </div>
                    )}
                    {selectedRun.rawResponse && (
                      <div>
                        <h4 className="font-medium mb-2">Raw Response</h4>
                        <pre className="text-xs bg-gray-100 p-3 rounded overflow-x-auto">
                          {selectedRun.rawResponse}
                        </pre>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {selectedRun.metadata && (
                <div className="mt-6">
                  <h3 className="text-lg font-medium mb-3">Metadata</h3>
                  <pre className="text-xs bg-gray-100 p-3 rounded overflow-x-auto">
                    {JSON.stringify(selectedRun.metadata, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
