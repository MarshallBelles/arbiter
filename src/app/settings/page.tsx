'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/useToast';
import { 
  Settings as SettingsIcon, 
  Database, 
  Brain, 
  Globe, 
  Clock, 
  Bell, 
  Shield, 
  Download,
  Upload,
  RefreshCw,
  Save,
  AlertCircle,
  CheckCircle
} from 'lucide-react';

interface SystemSettings {
  databasePath: string;
  llmEndpoint: string;
  llmModel: string;
  llmApiKey: string;
  maxConcurrentRuns: number;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  retentionDays: number;
  webhookTimeout: number;
  enableNotifications: boolean;
  notificationTypes: string[];
  backupEnabled: boolean;
  backupFrequency: 'daily' | 'weekly' | 'monthly';
}

interface SystemHealth {
  databaseConnected: boolean;
  llmConnected: boolean;
  diskSpace: string;
  memory: string;
  uptime: string;
  version: string;
  totalRuns: number;
  totalWorkflows: number;
  totalAgents: number;
}

export default function SettingsPage() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState('general');
  const [settings, setSettings] = useState<SystemSettings>({
    databasePath: './data/arbiter.db',
    llmEndpoint: 'http://localhost:8080',
    llmModel: 'granite-3.3-2b-instruct',
    llmApiKey: '',
    maxConcurrentRuns: 10,
    logLevel: 'info',
    retentionDays: 30,
    webhookTimeout: 30000,
    enableNotifications: true,
    notificationTypes: ['workflow_complete', 'workflow_failed', 'system_error'],
    backupEnabled: true,
    backupFrequency: 'daily'
  });
  
  const [health, setHealth] = useState<SystemHealth>({
    databaseConnected: true,
    llmConnected: false,
    diskSpace: '45.2 GB / 100 GB',
    memory: '2.1 GB / 8 GB',
    uptime: '2 days, 14 hours',
    version: '1.0.0',
    totalRuns: 0,
    totalWorkflows: 0,
    totalAgents: 0
  });

  const [isSaving, setIsSaving] = useState(false);
  const [isTestingLLM, setIsTestingLLM] = useState(false);

  useEffect(() => {
    fetchSettings();
    fetchSystemHealth();
  }, []);

  const fetchSettings = async () => {
    try {
      const response = await fetch('/api/settings');
      if (response.ok) {
        const data = await response.json();
        setSettings(prev => ({ ...prev, ...data.settings }));
      }
    } catch (error) {
      console.error('Failed to fetch settings:', error);
    }
  };

  const fetchSystemHealth = async () => {
    try {
      const [healthResponse, workflowsResponse, agentsResponse, runsResponse] = await Promise.all([
        fetch('/api/health'),
        fetch('/api/workflows'),
        fetch('/api/agents'),
        fetch('/api/runs?limit=1')
      ]);

      if (healthResponse.ok) {
        const healthData = await healthResponse.json();
        setHealth(prev => ({ ...prev, ...healthData }));
      }

      if (workflowsResponse.ok) {
        const workflowsData = await workflowsResponse.json();
        setHealth(prev => ({ ...prev, totalWorkflows: workflowsData.workflows?.length || 0 }));
      }

      if (agentsResponse.ok) {
        const agentsData = await agentsResponse.json();
        setHealth(prev => ({ ...prev, totalAgents: agentsData.agents?.length || 0 }));
      }

      if (runsResponse.ok) {
        const runsData = await runsResponse.json();
        setHealth(prev => ({ ...prev, totalRuns: runsData.total || 0 }));
      }
    } catch (error) {
      console.error('Failed to fetch system health:', error);
    }
  };

  const saveSettings = async () => {
    setIsSaving(true);
    try {
      const response = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });

      if (response.ok) {
        toast({ title: 'Settings saved successfully' });
      } else {
        throw new Error('Failed to save settings');
      }
    } catch (error) {
      toast({ title: 'Error saving settings', description: error.message, variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  const testLLMConnection = async () => {
    setIsTestingLLM(true);
    try {
      const response = await fetch('/api/settings/test-llm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: settings.llmEndpoint,
          model: settings.llmModel,
          apiKey: settings.llmApiKey
        }),
      });

      if (response.ok) {
        toast({ title: 'LLM connection successful' });
        setHealth(prev => ({ ...prev, llmConnected: true }));
      } else {
        const error = await response.json();
        throw new Error(error.message || 'LLM connection failed');
      }
    } catch (error) {
      toast({ title: 'LLM connection failed', description: error.message, variant: 'destructive' });
      setHealth(prev => ({ ...prev, llmConnected: false }));
    } finally {
      setIsTestingLLM(false);
    }
  };

  const exportSettings = () => {
    const dataStr = JSON.stringify(settings, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `arbiter-settings-${new Date().toISOString().split('T')[0]}.json`;
    link.click();
  };

  const importSettings = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const imported = JSON.parse(e.target?.result as string);
          setSettings(prev => ({ ...prev, ...imported }));
          toast({ title: 'Settings imported successfully' });
        } catch (error) {
          toast({ title: 'Error importing settings', description: 'Invalid JSON file', variant: 'destructive' });
        }
      };
      reader.readAsText(file);
    }
  };

  const tabs = [
    { id: 'general', name: 'General', icon: SettingsIcon },
    { id: 'llm', name: 'AI Models', icon: Brain },
    { id: 'database', name: 'Database', icon: Database },
    { id: 'notifications', name: 'Notifications', icon: Bell },
    { id: 'security', name: 'Security', icon: Shield },
    { id: 'system', name: 'System', icon: Globe }
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
          <p className="text-gray-600">Configure Arbiter system settings and preferences</p>
        </div>
        <div className="flex items-center space-x-2">
          <input
            type="file"
            accept=".json"
            onChange={importSettings}
            className="hidden"
            id="import-settings"
          />
          <label htmlFor="import-settings">
            <Button variant="outline" size="sm" asChild>
              <span className="cursor-pointer">
                <Upload className="w-4 h-4 mr-2" />
                Import
              </span>
            </Button>
          </label>
          <Button variant="outline" onClick={exportSettings} size="sm">
            <Download className="w-4 h-4 mr-2" />
            Export
          </Button>
          <Button onClick={saveSettings} disabled={isSaving}>
            <Save className="w-4 h-4 mr-2" />
            {isSaving ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </div>

      {/* System Health Overview */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <RefreshCw className="w-5 h-5" />
            System Health
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="flex items-center space-x-2">
              {health.databaseConnected ? 
                <CheckCircle className="w-4 h-4 text-green-500" /> : 
                <AlertCircle className="w-4 h-4 text-red-500" />
              }
              <span className="text-sm">Database: {health.databaseConnected ? 'Connected' : 'Disconnected'}</span>
            </div>
            <div className="flex items-center space-x-2">
              {health.llmConnected ? 
                <CheckCircle className="w-4 h-4 text-green-500" /> : 
                <AlertCircle className="w-4 h-4 text-yellow-500" />
              }
              <span className="text-sm">LLM: {health.llmConnected ? 'Connected' : 'Not Connected'}</span>
            </div>
            <div className="text-sm">
              <span className="text-gray-500">Uptime:</span> {health.uptime}
            </div>
            <div className="text-sm">
              <span className="text-gray-500">Version:</span> {health.version}
            </div>
          </div>
          
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
            <div className="text-sm">
              <span className="text-gray-500">Workflows:</span> {health.totalWorkflows}
            </div>
            <div className="text-sm">
              <span className="text-gray-500">Agents:</span> {health.totalAgents}
            </div>
            <div className="text-sm">
              <span className="text-gray-500">Total Runs:</span> {health.totalRuns}
            </div>
            <div className="text-sm">
              <span className="text-gray-500">Memory:</span> {health.memory}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Settings Tabs */}
      <div className="flex flex-col lg:flex-row gap-6">
        {/* Tab Navigation */}
        <div className="lg:w-64">
          <nav className="space-y-1">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`
                    w-full flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors
                    ${activeTab === tab.id
                      ? 'bg-arbiter-100 text-arbiter-700 border-r-2 border-arbiter-500'
                      : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                    }
                  `}
                >
                  <Icon className="mr-3 h-5 w-5" />
                  {tab.name}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Tab Content */}
        <div className="flex-1">
          {activeTab === 'general' && (
            <Card>
              <CardHeader>
                <CardTitle>General Settings</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Max Concurrent Runs</label>
                  <Input
                    type="number"
                    value={settings.maxConcurrentRuns}
                    onChange={(e) => setSettings(prev => ({ ...prev, maxConcurrentRuns: parseInt(e.target.value) || 1 }))}
                    min="1"
                    max="100"
                  />
                  <p className="text-xs text-gray-500 mt-1">Maximum number of workflows that can run simultaneously</p>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Log Level</label>
                  <select
                    value={settings.logLevel}
                    onChange={(e) => setSettings(prev => ({ ...prev, logLevel: e.target.value as any }))}
                    className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-arbiter-500"
                  >
                    <option value="debug">Debug</option>
                    <option value="info">Info</option>
                    <option value="warn">Warning</option>
                    <option value="error">Error</option>
                  </select>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Data Retention (Days)</label>
                  <Input
                    type="number"
                    value={settings.retentionDays}
                    onChange={(e) => setSettings(prev => ({ ...prev, retentionDays: parseInt(e.target.value) || 30 }))}
                    min="1"
                    max="365"
                  />
                  <p className="text-xs text-gray-500 mt-1">How long to keep run logs and execution data</p>
                </div>
              </CardContent>
            </Card>
          )}

          {activeTab === 'llm' && (
            <Card>
              <CardHeader>
                <CardTitle>AI Model Configuration</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">LLM Endpoint</label>
                  <Input
                    type="url"
                    value={settings.llmEndpoint}
                    onChange={(e) => setSettings(prev => ({ ...prev, llmEndpoint: e.target.value }))}
                    placeholder="http://localhost:8080"
                  />
                  <p className="text-xs text-gray-500 mt-1">URL for your llama.cpp server or compatible API</p>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Model Name</label>
                  <Input
                    value={settings.llmModel}
                    onChange={(e) => setSettings(prev => ({ ...prev, llmModel: e.target.value }))}
                    placeholder="granite-3.3-2b-instruct"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">API Key (Optional)</label>
                  <Input
                    type="password"
                    value={settings.llmApiKey}
                    onChange={(e) => setSettings(prev => ({ ...prev, llmApiKey: e.target.value }))}
                    placeholder="Leave empty for local llama.cpp"
                  />
                </div>
                
                <Button onClick={testLLMConnection} disabled={isTestingLLM}>
                  {isTestingLLM ? 'Testing...' : 'Test Connection'}
                </Button>
              </CardContent>
            </Card>
          )}

          {activeTab === 'database' && (
            <Card>
              <CardHeader>
                <CardTitle>Database Settings</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Database Path</label>
                  <Input
                    value={settings.databasePath}
                    onChange={(e) => setSettings(prev => ({ ...prev, databasePath: e.target.value }))}
                    placeholder="./data/arbiter.db"
                  />
                  <p className="text-xs text-gray-500 mt-1">Path to SQLite database file</p>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Backup Settings</label>
                  <div className="space-y-2">
                    <label className="flex items-center">
                      <input
                        type="checkbox"
                        checked={settings.backupEnabled}
                        onChange={(e) => setSettings(prev => ({ ...prev, backupEnabled: e.target.checked }))}
                        className="mr-2"
                      />
                      Enable automatic backups
                    </label>
                    
                    {settings.backupEnabled && (
                      <select
                        value={settings.backupFrequency}
                        onChange={(e) => setSettings(prev => ({ ...prev, backupFrequency: e.target.value as any }))}
                        className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-arbiter-500"
                      >
                        <option value="daily">Daily</option>
                        <option value="weekly">Weekly</option>
                        <option value="monthly">Monthly</option>
                      </select>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {activeTab === 'notifications' && (
            <Card>
              <CardHeader>
                <CardTitle>Notification Settings</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <label className="flex items-center">
                    <input
                      type="checkbox"
                      checked={settings.enableNotifications}
                      onChange={(e) => setSettings(prev => ({ ...prev, enableNotifications: e.target.checked }))}
                      className="mr-2"
                    />
                    Enable notifications
                  </label>
                </div>
                
                {settings.enableNotifications && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Notification Types</label>
                    <div className="space-y-2">
                      {[
                        { id: 'workflow_complete', label: 'Workflow Completed' },
                        { id: 'workflow_failed', label: 'Workflow Failed' },
                        { id: 'system_error', label: 'System Errors' },
                        { id: 'agent_error', label: 'Agent Errors' },
                        { id: 'high_memory', label: 'High Memory Usage' }
                      ].map((type) => (
                        <label key={type.id} className="flex items-center">
                          <input
                            type="checkbox"
                            checked={settings.notificationTypes.includes(type.id)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSettings(prev => ({
                                  ...prev,
                                  notificationTypes: [...prev.notificationTypes, type.id]
                                }));
                              } else {
                                setSettings(prev => ({
                                  ...prev,
                                  notificationTypes: prev.notificationTypes.filter(t => t !== type.id)
                                }));
                              }
                            }}
                            className="mr-2"
                          />
                          {type.label}
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {activeTab === 'security' && (
            <Card>
              <CardHeader>
                <CardTitle>Security Settings</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Webhook Timeout (ms)</label>
                  <Input
                    type="number"
                    value={settings.webhookTimeout}
                    onChange={(e) => setSettings(prev => ({ ...prev, webhookTimeout: parseInt(e.target.value) || 30000 }))}
                    min="1000"
                    max="300000"
                  />
                  <p className="text-xs text-gray-500 mt-1">Timeout for incoming webhook requests</p>
                </div>
                
                <div className="bg-yellow-50 p-4 rounded-lg">
                  <h4 className="text-sm font-medium text-yellow-800 mb-2">Security Notice</h4>
                  <p className="text-sm text-yellow-700">
                    Arbiter is designed for local development environments. For production use, consider implementing:
                  </p>
                  <ul className="text-sm text-yellow-700 mt-2 list-disc list-inside">
                    <li>API authentication and authorization</li>
                    <li>HTTPS/TLS encryption</li>
                    <li>Network access controls</li>
                    <li>Regular security updates</li>
                  </ul>
                </div>
              </CardContent>
            </Card>
          )}

          {activeTab === 'system' && (
            <Card>
              <CardHeader>
                <CardTitle>System Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <span className="text-sm font-medium text-gray-500">Version:</span>
                    <p className="text-sm text-gray-900">{health.version}</p>
                  </div>
                  <div>
                    <span className="text-sm font-medium text-gray-500">Uptime:</span>
                    <p className="text-sm text-gray-900">{health.uptime}</p>
                  </div>
                  <div>
                    <span className="text-sm font-medium text-gray-500">Memory Usage:</span>
                    <p className="text-sm text-gray-900">{health.memory}</p>
                  </div>
                  <div>
                    <span className="text-sm font-medium text-gray-500">Disk Space:</span>
                    <p className="text-sm text-gray-900">{health.diskSpace}</p>
                  </div>
                </div>
                
                <div className="pt-4 border-t">
                  <Button onClick={fetchSystemHealth} variant="outline">
                    <RefreshCw className="w-4 h-4 mr-2" />
                    Refresh System Info
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}