
'use client';

import React, { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { 
  Button 
} from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/useToast';
import { WorkflowConfig } from '@/lib/core';
import { 
  Play, 
  Edit3, 
  Save, 
  ArrowLeft, 
  Activity, 
  Clock, 
  AlertCircle, 
  CheckCircle, 
  XCircle,
  BarChart3,
  Calendar,
  Download,
  RefreshCw,
  Settings,
  Trash2
} from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"

interface RunRecord {
  id: string;
  workflowId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  startTime: string;
  endTime?: string;
  durationMs?: number;
  errorMessage?: string;
}

export default function WorkflowDetailPage() {
  const router = useRouter();
  const params = useParams();
  const { toast } = useToast();
  const id = params.id as string;

  const [workflow, setWorkflow] = useState<WorkflowConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  
  // Form states for editing
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [executionInput, setExecutionInput] = useState('{}');
  
  // Analytics states
  const [recentRuns, setRecentRuns] = useState<RunRecord[]>([]);
  const [runStats, setRunStats] = useState({
    total: 0,
    completed: 0,
    failed: 0,
    avgDuration: 0
  });

  useEffect(() => {
    if (id) {
      fetchWorkflow();
      fetchRunHistory();
    }
  }, [id]);

  const fetchWorkflow = async () => {
    try {
      const response = await fetch(`/api/workflows/${id}`);
      if (!response.ok) {
        throw new Error('Failed to fetch workflow');
      }
      const data = await response.json();
      setWorkflow(data);
      setName(data.name);
      setDescription(data.description);
    } catch (error) {
      toast({ title: 'Error fetching workflow', description: error.message, variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  const fetchRunHistory = async () => {
    try {
      const response = await fetch(`/api/runs?workflowId=${id}&limit=10`);
      if (response.ok) {
        const data = await response.json();
        const runs = data.runs || [];
        setRecentRuns(runs);
        
        // Calculate stats
        const total = runs.length;
        const completed = runs.filter(r => r.status === 'completed').length;
        const failed = runs.filter(r => r.status === 'failed').length;
        const avgDuration = runs
          .filter(r => r.durationMs)
          .reduce((sum, r) => sum + (r.durationMs || 0), 0) / 
          Math.max(1, runs.filter(r => r.durationMs).length);
        
        setRunStats({ total, completed, failed, avgDuration });
      }
    } catch (error) {
      console.error('Failed to fetch run history:', error);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const response = await fetch(`/api/workflows/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to update workflow');
      }

      const updatedWorkflow = await response.json();
      setWorkflow(updatedWorkflow);
      setIsEditing(false);
      toast({ title: 'Workflow updated successfully' });
    } catch (error) {
      toast({ title: 'Error updating workflow', description: error.message, variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleExecute = async () => {
    setIsExecuting(true);
    try {
      let inputData;
      try {
        inputData = JSON.parse(executionInput);
      } catch {
        throw new Error('Invalid JSON input');
      }

      const response = await fetch(`/api/workflows/${id}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: inputData }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Execution failed');
      }

      const execution = await response.json();
      toast({ title: 'Workflow execution started', description: `Execution ID: ${execution.id}` });
      
      // Refresh run history after execution
      setTimeout(() => {
        fetchRunHistory();
      }, 1000);
      
    } catch (error) {
      toast({ title: 'Execution failed', description: error.message, variant: 'destructive' });
    } finally {
      setIsExecuting(false);
    }
  };

  const handleDelete = async () => {
    try {
      const response = await fetch(`/api/workflows/${id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error('Failed to delete workflow');
      }

      toast({ title: 'Workflow deleted successfully' });
      router.push('/workflows');
    } catch (error) {
      toast({ title: 'Error deleting workflow', description: error.message, variant: 'destructive' });
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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-arbiter-600"></div>
      </div>
    );
  }

  if (!workflow) {
    return (
      <div className="text-center py-12">
        <AlertCircle className="w-12 h-12 mx-auto mb-4 text-gray-300" />
        <h3 className="text-lg font-medium text-gray-900 mb-2">Workflow not found</h3>
        <p className="text-gray-600">The requested workflow could not be found.</p>
        <Button onClick={() => router.push('/workflows')} className="mt-4">
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Workflows
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <Button variant="outline" onClick={() => router.push('/workflows')}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{workflow.name}</h1>
            <p className="text-gray-600">{workflow.description}</p>
          </div>
        </div>
        <div className="flex items-center space-x-2">
          <Button variant="outline" onClick={() => setIsEditing(!isEditing)}>
            <Edit3 className="w-4 h-4 mr-2" />
            {isEditing ? 'Cancel' : 'Edit'}
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive">
                <Trash2 className="w-4 h-4 mr-2" />
                Delete
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete Workflow</AlertDialogTitle>
                <AlertDialogDescription>
                  Are you sure you want to delete this workflow? This action cannot be undone and will remove all associated run history.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Workflow Configuration */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Settings className="w-5 h-5" />
                Workflow Configuration
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isEditing ? (
                <div className="space-y-4">
                  <div>
                    <label htmlFor="name" className="block text-sm font-medium text-gray-700">Name</label>
                    <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
                  </div>
                  <div>
                    <label htmlFor="description" className="block text-sm font-medium text-gray-700">Description</label>
                    <Textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} required />
                  </div>
                  <div className="flex justify-end space-x-2">
                    <Button variant="outline" onClick={() => setIsEditing(false)}>Cancel</Button>
                    <Button onClick={handleSave} disabled={isSaving}>
                      <Save className="w-4 h-4 mr-2" />
                      {isSaving ? 'Saving...' : 'Save Changes'}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div>
                    <span className="text-sm font-medium text-gray-500">Name</span>
                    <p className="text-gray-900">{workflow.name}</p>
                  </div>
                  <div>
                    <span className="text-sm font-medium text-gray-500">Description</span>
                    <p className="text-gray-900">{workflow.description}</p>
                  </div>
                  <div>
                    <span className="text-sm font-medium text-gray-500">Agents</span>
                    <p className="text-gray-900">{workflow.agents?.length || 0} agents configured</p>
                  </div>
                  <div>
                    <span className="text-sm font-medium text-gray-500">Created</span>
                    <p className="text-gray-900">{workflow.createdAt ? formatTimestamp(workflow.createdAt) : 'Unknown'}</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Execution Panel */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Play className="w-5 h-5" />
                Execute Workflow
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div>
                  <label htmlFor="input" className="block text-sm font-medium text-gray-700">Input Data (JSON)</label>
                  <Textarea
                    id="input"
                    value={executionInput}
                    onChange={(e) => setExecutionInput(e.target.value)}
                    placeholder='{"key": "value"}'
                    rows={4}
                    className="font-mono text-sm"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Provide JSON input data that will be passed to the workflow execution.
                  </p>
                </div>
                <Button onClick={handleExecute} disabled={isExecuting} className="w-full">
                  <Play className="w-4 h-4 mr-2" />
                  {isExecuting ? 'Executing...' : 'Execute Workflow'}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Recent Runs */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <Activity className="w-5 h-5" />
                  Recent Executions
                </CardTitle>
                <Button variant="outline" size="sm" onClick={fetchRunHistory}>
                  <RefreshCw className="w-4 h-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {recentRuns.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <Activity className="w-8 h-8 mx-auto mb-2 text-gray-300" />
                  <p>No executions yet</p>
                  <p className="text-sm">Execute the workflow to see results here</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {recentRuns.map((run) => (
                    <div key={run.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                      <div className="flex items-center space-x-3">
                        {getStatusIcon(run.status)}
                        <div>
                          <p className="text-sm font-medium text-gray-900">
                            Run {run.id.substring(0, 8)}...
                          </p>
                          <p className="text-xs text-gray-500">
                            {formatTimestamp(run.startTime)}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-sm text-gray-900 capitalize">{run.status}</p>
                        <p className="text-xs text-gray-500">
                          {formatDuration(run.durationMs)}
                        </p>
                      </div>
                    </div>
                  ))}
                  <Button variant="outline" size="sm" onClick={() => router.push(`/runs?workflowId=${id}`)} className="w-full mt-2">
                    View All Runs
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Quick Stats */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="w-5 h-5" />
                Statistics
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex justify-between">
                  <span className="text-sm text-gray-500">Total Runs</span>
                  <span className="font-medium">{runStats.total}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-gray-500">Success Rate</span>
                  <span className="font-medium">
                    {runStats.total > 0 ? Math.round((runStats.completed / runStats.total) * 100) : 0}%
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-gray-500">Failed Runs</span>
                  <span className="font-medium text-red-600">{runStats.failed}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-gray-500">Avg Duration</span>
                  <span className="font-medium">{formatDuration(runStats.avgDuration)}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Quick Actions */}
          <Card>
            <CardHeader>
              <CardTitle>Quick Actions</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <Button variant="outline" size="sm" onClick={() => router.push(`/runs?workflowId=${id}`)} className="w-full justify-start">
                  <Activity className="w-4 h-4 mr-2" />
                  View All Runs
                </Button>
                <Button variant="outline" size="sm" onClick={() => router.push('/workflows/designer')} className="w-full justify-start">
                  <Settings className="w-4 h-4 mr-2" />
                  Workflow Designer
                </Button>
                <Button variant="outline" size="sm" onClick={() => {
                  const dataStr = JSON.stringify(workflow, null, 2);
                  const dataBlob = new Blob([dataStr], {type: 'application/json'});
                  const url = URL.createObjectURL(dataBlob);
                  const link = document.createElement('a');
                  link.href = url;
                  link.download = `workflow-${workflow.name.replace(/\s+/g, '-')}.json`;
                  link.click();
                }} className="w-full justify-start">
                  <Download className="w-4 h-4 mr-2" />
                  Export Config
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
