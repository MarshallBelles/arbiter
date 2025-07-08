'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Activity,
  AlertCircle,
  CheckCircle,
  XCircle,
  Clock,
  Search,
  Filter,
  RefreshCw,
  Zap,
  Calendar,
  Database,
  Globe,
  FileText,
  Play,
  Pause,
  Download,
  Settings
} from 'lucide-react';

interface ArbiterEvent {
  id: string;
  type: 'webhook' | 'cron' | 'manual' | 'api' | 'file_watch';
  source: string;
  timestamp: string;
  data?: any;
  workflowId?: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  errorMessage?: string;
  executionId?: string;
  processingTime?: number;
  metadata?: any;
}

interface EventStats {
  total: number;
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  avgProcessingTime: number;
}

export default function EventsPage() {
  const [events, setEvents] = useState<ArbiterEvent[]>([]);
  const [filteredEvents, setFilteredEvents] = useState<ArbiterEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [realTimeEnabled, setRealTimeEnabled] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  
  const [stats, setStats] = useState<EventStats>({
    total: 0,
    pending: 0,
    processing: 0,
    completed: 0,
    failed: 0,
    avgProcessingTime: 0
  });

  useEffect(() => {
    fetchEvents();
    
    // Set up real-time polling if enabled
    let interval: NodeJS.Timeout;
    if (realTimeEnabled) {
      interval = setInterval(fetchEvents, 2000);
    }
    
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [realTimeEnabled]);

  useEffect(() => {
    // Filter events based on search and filters
    let filtered = events;
    
    if (searchTerm) {
      filtered = filtered.filter(event =>
        event.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
        event.source.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (event.workflowId && event.workflowId.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (event.errorMessage && event.errorMessage.toLowerCase().includes(searchTerm.toLowerCase()))
      );
    }
    
    if (filterType !== 'all') {
      filtered = filtered.filter(event => event.type === filterType);
    }
    
    if (filterStatus !== 'all') {
      filtered = filtered.filter(event => event.status === filterStatus);
    }
    
    setFilteredEvents(filtered);
  }, [events, searchTerm, filterType, filterStatus]);

  const fetchEvents = async () => {
    try {
      const response = await fetch('/api/events?limit=100');
      if (response.ok) {
        const data = await response.json();
        const eventData = data.events || [];
        setEvents(eventData);
        
        // Calculate stats
        const total = eventData.length;
        const pending = eventData.filter((e: ArbiterEvent) => e.status === 'pending').length;
        const processing = eventData.filter((e: ArbiterEvent) => e.status === 'processing').length;
        const completed = eventData.filter((e: ArbiterEvent) => e.status === 'completed').length;
        const failed = eventData.filter((e: ArbiterEvent) => e.status === 'failed').length;
        
        const processingTimes = eventData
          .filter((e: ArbiterEvent) => e.processingTime)
          .map((e: ArbiterEvent) => e.processingTime || 0);
        const avgProcessingTime = processingTimes.length > 0 
          ? processingTimes.reduce((sum: number, time: number) => sum + time, 0) / processingTimes.length 
          : 0;
        
        setStats({ total, pending, processing, completed, failed, avgProcessingTime });
      }
    } catch (error) {
      console.error('Failed to fetch events:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleExportEvents = async () => {
    try {
      const response = await fetch('/api/events/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: filterType !== 'all' ? filterType : undefined,
          status: filterStatus !== 'all' ? filterStatus : undefined,
        }),
      });
      
      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `arbiter-events-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      }
    } catch (error) {
      console.error('Export failed:', error);
    }
  };

  const getEventIcon = (type: string) => {
    switch (type) {
      case 'webhook': return <Globe className="w-4 h-4 text-blue-500" />;
      case 'cron': return <Clock className="w-4 h-4 text-purple-500" />;
      case 'manual': return <Play className="w-4 h-4 text-green-500" />;
      case 'api': return <Zap className="w-4 h-4 text-yellow-500" />;
      case 'file_watch': return <FileText className="w-4 h-4 text-orange-500" />;
      default: return <Activity className="w-4 h-4 text-gray-400" />;
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed': return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'failed': return <XCircle className="w-4 h-4 text-red-500" />;
      case 'processing': return <Clock className="w-4 h-4 text-blue-500 animate-spin" />;
      case 'pending': return <Clock className="w-4 h-4 text-yellow-500" />;
      default: return <AlertCircle className="w-4 h-4 text-gray-400" />;
    }
  };

  const formatTimestamp = (timestamp: string) => {
    return new Date(timestamp).toLocaleString();
  };

  const formatDuration = (durationMs?: number) => {
    if (!durationMs) return 'N/A';
    if (durationMs < 1000) return `${durationMs}ms`;
    if (durationMs < 60000) return `${(durationMs / 1000).toFixed(1)}s`;
    return `${(durationMs / 60000).toFixed(1)}m`;
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
          <h1 className="text-2xl font-bold text-gray-900">Events Monitor</h1>
          <p className="text-gray-600">Real-time monitoring of workflow events and triggers</p>
        </div>
        <div className="flex items-center space-x-2">
          <Button
            variant={realTimeEnabled ? "default" : "outline"}
            onClick={() => setRealTimeEnabled(!realTimeEnabled)}
            size="sm"
          >
            {realTimeEnabled ? <Pause className="w-4 h-4 mr-2" /> : <Play className="w-4 h-4 mr-2" />}
            {realTimeEnabled ? 'Pause' : 'Live'}
          </Button>
          <Button variant="outline" onClick={fetchEvents} size="sm">
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Total</p>
                <p className="text-2xl font-bold">{stats.total}</p>
              </div>
              <Activity className="w-8 h-8 text-gray-400" />
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Pending</p>
                <p className="text-2xl font-bold text-yellow-600">{stats.pending}</p>
              </div>
              <Clock className="w-8 h-8 text-yellow-400" />
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Processing</p>
                <p className="text-2xl font-bold text-blue-600">{stats.processing}</p>
              </div>
              <Settings className="w-8 h-8 text-blue-400 animate-spin" />
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Completed</p>
                <p className="text-2xl font-bold text-green-600">{stats.completed}</p>
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
                <p className="text-2xl font-bold text-red-600">{stats.failed}</p>
              </div>
              <XCircle className="w-8 h-8 text-red-400" />
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Avg Time</p>
                <p className="text-2xl font-bold">{formatDuration(stats.avgProcessingTime)}</p>
              </div>
              <Database className="w-8 h-8 text-gray-400" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters and Search */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                type="text"
                placeholder="Search events by ID, source, workflow..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
            
            <div className="flex gap-2">
              <select
                value={filterType}
                onChange={(e) => setFilterType(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-arbiter-500"
              >
                <option value="all">All Types</option>
                <option value="webhook">Webhook</option>
                <option value="cron">Cron</option>
                <option value="manual">Manual</option>
                <option value="api">API</option>
                <option value="file_watch">File Watch</option>
              </select>
              
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-arbiter-500"
              >
                <option value="all">All Status</option>
                <option value="pending">Pending</option>
                <option value="processing">Processing</option>
                <option value="completed">Completed</option>
                <option value="failed">Failed</option>
              </select>
              
              <Button variant="outline" onClick={handleExportEvents}>
                <Download className="w-4 h-4 mr-2" />
                Export
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Events List */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Event Stream</span>
            {realTimeEnabled && (
              <div className="flex items-center text-sm text-green-600">
                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse mr-2"></div>
                Live Updates
              </div>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {filteredEvents.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <Activity className="w-12 h-12 mx-auto mb-4 text-gray-300" />
              <p>No events found</p>
              <p className="text-sm">Events will appear here when workflows are triggered</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {filteredEvents.map((event) => (
                <div
                  key={event.id}
                  className="flex items-center justify-between p-4 border border-gray-200 rounded-lg hover:bg-gray-50"
                >
                  <div className="flex items-center space-x-4">
                    <div className="flex items-center space-x-2">
                      {getEventIcon(event.type)}
                      {getStatusIcon(event.status)}
                    </div>
                    
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center space-x-2">
                        <p className="text-sm font-medium text-gray-900 truncate">
                          {event.source}
                        </p>
                        <span className="inline-block bg-gray-100 text-gray-700 px-2 py-1 rounded-full text-xs capitalize">
                          {event.type}
                        </span>
                      </div>
                      
                      <div className="flex items-center space-x-4 mt-1">
                        <p className="text-xs text-gray-500">
                          ID: {event.id.substring(0, 12)}...
                        </p>
                        {event.workflowId && (
                          <p className="text-xs text-gray-500">
                            Workflow: {event.workflowId}
                          </p>
                        )}
                        {event.executionId && (
                          <p className="text-xs text-gray-500">
                            Execution: {event.executionId.substring(0, 8)}...
                          </p>
                        )}
                      </div>
                      
                      {event.errorMessage && (
                        <p className="text-xs text-red-600 mt-1 truncate">
                          Error: {event.errorMessage}
                        </p>
                      )}
                    </div>
                  </div>
                  
                  <div className="text-right text-xs text-gray-500">
                    <p>{formatTimestamp(event.timestamp)}</p>
                    {event.processingTime && (
                      <p className="mt-1">{formatDuration(event.processingTime)}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Summary */}
      <div className="text-sm text-gray-500 text-center">
        Showing {filteredEvents.length} of {events.length} events
        {realTimeEnabled && ' • Updates every 2 seconds'}
      </div>
    </div>
  );
}