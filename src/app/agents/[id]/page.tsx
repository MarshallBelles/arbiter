
'use client';

import React, { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/useToast';
import { AgentConfig } from '@/lib/core';
import {
  ArrowLeft,
  Edit3,
  Save,
  Play,
  Brain,
  Settings,
  Activity,
  MessageSquare,
  Clock,
  Zap,
  BarChart3,
  Download,
  RefreshCw,
  AlertCircle,
  CheckCircle,
  XCircle,
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

interface TestResult {
  id: string;
  timestamp: string;
  prompt: string;
  response: string;
  latencyMs: number;
  tokensUsed?: number;
  success: boolean;
  error?: string;
}

interface AgentStats {
  totalRuns: number;
  successRate: number;
  avgLatency: number;
  totalTokensUsed: number;
}

export default function AgentDetailPage() {
  const router = useRouter();
  const params = useParams();
  const { toast } = useToast();
  const id = params?.id as string;

  const [agent, setAgent] = useState<AgentConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);

  // Form states for editing
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [model, setModel] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [level, setLevel] = useState(0);

  // Testing states
  const [testPrompt, setTestPrompt] = useState('Hello! Please introduce yourself and explain your capabilities.');
  const [testResults, setTestResults] = useState<TestResult[]>([]);
  const [currentResponse, setCurrentResponse] = useState('');

  // Stats
  const [stats, setStats] = useState<AgentStats>({
    totalRuns: 0,
    successRate: 0,
    avgLatency: 0,
    totalTokensUsed: 0
  });

  useEffect(() => {
    if (id) {
      fetchAgent();
      fetchTestHistory();
      fetchAgentStats();
    }
  }, [id]);

  const fetchAgent = async () => {
    try {
      const response = await fetch(`/api/agents/${id}`);
      if (!response.ok) {
        throw new Error('Failed to fetch agent');
      }
      const data = await response.json();
      setAgent(data);
      setName(data.name);
      setDescription(data.description);
      setModel(data.model || '');
      setSystemPrompt(data.systemPrompt || '');
      setLevel(data.level || 0);
    } catch (error) {
      toast({ title: 'Error fetching agent', description: error.message, variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  const fetchTestHistory = async () => {
    try {
      const response = await fetch(`/api/runs?agentId=${id}&limit=5&runType=agent_execution`);
      if (response.ok) {
        const data = await response.json();
        // Transform runs to test results format
        const runs = data.runs || [];
        const testResults = runs.map((run: any) => ({
          id: run.id,
          timestamp: run.startTime,
          prompt: run.userPrompt || 'Test execution',
          response: run.responseData?.response || 'No response captured',
          latencyMs: run.durationMs || 0,
          tokensUsed: run.tokensUsed,
          success: run.status === 'completed',
          error: run.errorMessage
        }));
        setTestResults(testResults);
      }
    } catch (error) {
      console.error('Failed to fetch test history:', error);
    }
  };

  const fetchAgentStats = async () => {
    try {
      const response = await fetch(`/api/runs/stats?agentId=${id}`);
      if (response.ok) {
        const data = await response.json();
        setStats(data.stats || stats);
      }
    } catch (error) {
      console.error('Failed to fetch agent stats:', error);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const response = await fetch(`/api/agents/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description, model, systemPrompt, level }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to update agent');
      }

      const updatedAgent = await response.json();
      setAgent(updatedAgent);
      setIsEditing(false);
      toast({ title: 'Agent updated successfully' });
    } catch (error) {
      toast({ title: 'Error updating agent', description: error.message, variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleTestAgent = async () => {
    setIsTesting(true);
    setCurrentResponse('');
    
    try {
      // Create a test execution request
      const response = await fetch('/api/agents/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: id,
          prompt: testPrompt
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Test failed');
      }

      const result = await response.json();
      setCurrentResponse(result.response || 'No response received');
      
      // Add to test results
      const newTest: TestResult = {
        id: `test-${Date.now()}`,
        timestamp: new Date().toISOString(),
        prompt: testPrompt,
        response: result.response || 'No response received',
        latencyMs: result.latencyMs || 0,
        tokensUsed: result.tokensUsed,
        success: true,
        error: undefined
      };
      
      setTestResults([newTest, ...testResults.slice(0, 4)]);
      toast({ title: 'Test completed successfully' });
      
    } catch (error) {
      const failedTest: TestResult = {
        id: `test-${Date.now()}`,
        timestamp: new Date().toISOString(),
        prompt: testPrompt,
        response: '',
        latencyMs: 0,
        success: false,
        error: error.message
      };
      
      setTestResults([failedTest, ...testResults.slice(0, 4)]);
      toast({ title: 'Test failed', description: error.message, variant: 'destructive' });
    } finally {
      setIsTesting(false);
    }
  };

  const handleDelete = async () => {
    try {
      const response = await fetch(`/api/agents/${id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error('Failed to delete agent');
      }

      toast({ title: 'Agent deleted successfully' });
      router.push('/agents');
    } catch (error) {
      toast({ title: 'Error deleting agent', description: error.message, variant: 'destructive' });
    }
  };

  const formatTimestamp = (timestamp: string) => {
    return new Date(timestamp).toLocaleString();
  };

  const formatDuration = (durationMs: number) => {
    if (durationMs < 1000) return `${durationMs}ms`;
    if (durationMs < 60000) return `${(durationMs / 1000).toFixed(1)}s`;
    return `${(durationMs / 60000).toFixed(1)}m`;
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-arbiter-600"></div>
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="text-center py-12">
        <AlertCircle className="w-12 h-12 mx-auto mb-4 text-gray-300" />
        <h3 className="text-lg font-medium text-gray-900 mb-2">Agent not found</h3>
        <p className="text-gray-600">The requested agent could not be found.</p>
        <Button onClick={() => router.push('/agents')} className="mt-4">
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Agents
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <Button variant="outline" onClick={() => router.push('/agents')}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{agent.name}</h1>
            <p className="text-gray-600">{agent.description}</p>
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
                <AlertDialogTitle>Delete Agent</AlertDialogTitle>
                <AlertDialogDescription>
                  Are you sure you want to delete this agent? This action cannot be undone and will remove all associated run history.
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
          {/* Agent Configuration */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Settings className="w-5 h-5" />
                Agent Configuration
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
                  <div>
                    <label htmlFor="model" className="block text-sm font-medium text-gray-700">Model</label>
                    <Input id="model" value={model} onChange={(e) => setModel(e.target.value)} placeholder="e.g., granite-3.3-2b-instruct" />
                  </div>
                  <div>
                    <label htmlFor="level" className="block text-sm font-medium text-gray-700">Level</label>
                    <Input id="level" type="number" value={level} onChange={(e) => setLevel(parseInt(e.target.value, 10) || 0)} />
                  </div>
                  <div>
                    <label htmlFor="systemPrompt" className="block text-sm font-medium text-gray-700">System Prompt</label>
                    <Textarea 
                      id="systemPrompt" 
                      value={systemPrompt} 
                      onChange={(e) => setSystemPrompt(e.target.value)} 
                      rows={8}
                      placeholder="Define the agent's role, behavior, and capabilities..."
                    />
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
                    <p className="text-gray-900">{agent.name}</p>
                  </div>
                  <div>
                    <span className="text-sm font-medium text-gray-500">Description</span>
                    <p className="text-gray-900">{agent.description}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <span className="text-sm font-medium text-gray-500">Model</span>
                      <p className="text-gray-900">{agent.model || 'Not specified'}</p>
                    </div>
                    <div>
                      <span className="text-sm font-medium text-gray-500">Level</span>
                      <p className="text-gray-900">{agent.level}</p>
                    </div>
                  </div>
                  <div>
                    <span className="text-sm font-medium text-gray-500">System Prompt</span>
                    <div className="mt-1 p-3 bg-gray-50 rounded-md max-h-32 overflow-y-auto">
                      <pre className="text-sm text-gray-700 whitespace-pre-wrap">{agent.systemPrompt || 'No system prompt defined'}</pre>
                    </div>
                  </div>
                  <div>
                    <span className="text-sm font-medium text-gray-500">Available Tools</span>
                    <p className="text-gray-900">{agent.availableTools?.length || 0} tools configured</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Agent Testing */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Brain className="w-5 h-5" />
                Test Agent
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div>
                  <label htmlFor="testPrompt" className="block text-sm font-medium text-gray-700">Test Prompt</label>
                  <Textarea
                    id="testPrompt"
                    value={testPrompt}
                    onChange={(e) => setTestPrompt(e.target.value)}
                    rows={3}
                    placeholder="Enter a prompt to test the agent..."
                  />
                </div>
                <Button onClick={handleTestAgent} disabled={isTesting} className="w-full">
                  <Play className="w-4 h-4 mr-2" />
                  {isTesting ? 'Testing...' : 'Test Agent'}
                </Button>
                
                {currentResponse && (
                  <div>
                    <span className="text-sm font-medium text-gray-700">Current Response:</span>
                    <div className="mt-1 p-3 bg-blue-50 border border-blue-200 rounded-md">
                      <p className="text-sm text-blue-900 whitespace-pre-wrap">{currentResponse}</p>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Test History */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <MessageSquare className="w-5 h-5" />
                  Recent Tests
                </CardTitle>
                <Button variant="outline" size="sm" onClick={fetchTestHistory}>
                  <RefreshCw className="w-4 h-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {testResults.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <MessageSquare className="w-8 h-8 mx-auto mb-2 text-gray-300" />
                  <p>No tests run yet</p>
                  <p className="text-sm">Test the agent to see results here</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {testResults.map((test) => (
                    <div key={test.id} className="border border-gray-200 rounded-lg p-4">
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex items-center space-x-2">
                          {test.success ? 
                            <CheckCircle className="w-4 h-4 text-green-500" /> : 
                            <XCircle className="w-4 h-4 text-red-500" />
                          }
                          <span className="text-sm text-gray-500">{formatTimestamp(test.timestamp)}</span>
                        </div>
                        <div className="text-right text-xs text-gray-500">
                          <div>{formatDuration(test.latencyMs)}</div>
                          {test.tokensUsed && <div>{test.tokensUsed} tokens</div>}
                        </div>
                      </div>
                      
                      <div className="space-y-2">
                        <div>
                          <span className="text-xs font-medium text-gray-500">Prompt:</span>
                          <p className="text-sm text-gray-700 bg-gray-50 p-2 rounded">{test.prompt}</p>
                        </div>
                        
                        {test.success ? (
                          <div>
                            <span className="text-xs font-medium text-gray-500">Response:</span>
                            <p className="text-sm text-gray-700 bg-green-50 p-2 rounded">{test.response}</p>
                          </div>
                        ) : (
                          <div>
                            <span className="text-xs font-medium text-red-500">Error:</span>
                            <p className="text-sm text-red-700 bg-red-50 p-2 rounded">{test.error}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Performance Stats */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="w-5 h-5" />
                Performance
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex justify-between">
                  <span className="text-sm text-gray-500">Total Runs</span>
                  <span className="font-medium">{stats.totalRuns}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-gray-500">Success Rate</span>
                  <span className="font-medium">{Math.round(stats.successRate)}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-gray-500">Avg Latency</span>
                  <span className="font-medium">{formatDuration(stats.avgLatency)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-gray-500">Total Tokens</span>
                  <span className="font-medium">{stats.totalTokensUsed.toLocaleString()}</span>
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
                <Button variant="outline" size="sm" onClick={() => router.push(`/runs?agentId=${id}`)} className="w-full justify-start">
                  <Activity className="w-4 h-4 mr-2" />
                  View All Runs
                </Button>
                <Button variant="outline" size="sm" onClick={() => {
                  const dataStr = JSON.stringify(agent, null, 2);
                  const dataBlob = new Blob([dataStr], {type: 'application/json'});
                  const url = URL.createObjectURL(dataBlob);
                  const link = document.createElement('a');
                  link.href = url;
                  link.download = `agent-${agent.name.replace(/\s+/g, '-')}.json`;
                  link.click();
                }} className="w-full justify-start">
                  <Download className="w-4 h-4 mr-2" />
                  Export Config
                </Button>
                <Button variant="outline" size="sm" onClick={() => setTestPrompt('Explain your role and capabilities in detail.')} className="w-full justify-start">
                  <Zap className="w-4 h-4 mr-2" />
                  Quick Test
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Agent Info */}
          <Card>
            <CardHeader>
              <CardTitle>Agent Info</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3 text-sm">
                <div>
                  <span className="font-medium text-gray-500">Agent ID:</span>
                  <p className="font-mono text-xs mt-1 break-all">{agent.id}</p>
                </div>
                <div>
                  <span className="font-medium text-gray-500">Level:</span>
                  <p className="mt-1">
                    <span className="inline-block bg-blue-100 text-blue-800 px-2 py-1 rounded-full text-xs">
                      Level {agent.level}
                    </span>
                  </p>
                </div>
                <div>
                  <span className="font-medium text-gray-500">Tools:</span>
                  <p className="mt-1">{agent.availableTools?.length || 0} configured</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
