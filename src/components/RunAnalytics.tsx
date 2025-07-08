'use client';

import React, { useState, useEffect } from 'react';
import { 
  TrendingUp, 
  Clock, 
  CheckCircle, 
  XCircle, 
  Activity,
  BarChart3,
  AlertTriangle 
} from 'lucide-react';

interface RunStats {
  totalRuns: number;
  successfulRuns: number;
  failedRuns: number;
  averageDuration: number;
  totalTokens: number;
}

interface PerformanceMetrics {
  averageTokensPerRun: number;
  averageMemoryUsage: number;
  averageCpuTime: number;
  totalRuns: number;
}

interface RunError {
  id: string;
  workflowId: string;
  errorMessage: string;
  startTime: string;
  runType: string;
}

const RunAnalytics: React.FC = () => {
  const [stats, setStats] = useState<RunStats | null>(null);
  const [performance, setPerformance] = useState<PerformanceMetrics | null>(null);
  const [recentErrors, setRecentErrors] = useState<RunError[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchAnalytics();
  }, []);

  const fetchAnalytics = async () => {
    try {
      setLoading(true);
      
      const [statsRes, performanceRes, errorsRes] = await Promise.all([
        fetch('/api/runs/stats'),
        fetch('/api/runs/performance'),
        fetch('/api/runs/errors?limit=5'),
      ]);

      if (!statsRes.ok || !performanceRes.ok || !errorsRes.ok) {
        throw new Error('Failed to fetch analytics');
      }

      const [statsData, performanceData, errorsData] = await Promise.all([
        statsRes.json(),
        performanceRes.json(),
        errorsRes.json(),
      ]);

      setStats(statsData.stats);
      setPerformance(performanceData.metrics);
      setRecentErrors(errorsData.errors);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms.toFixed(0)}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
  };

  const formatNumber = (num: number) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toString();
  };

  const getSuccessRate = () => {
    if (!stats || stats.totalRuns === 0) return 0;
    return Math.round((stats.successfulRuns / stats.totalRuns) * 100);
  };

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow p-6" role="status" aria-label="Loading...">
        <div className="animate-pulse">
          <div className="h-4 bg-gray-200 rounded w-1/4 mb-4"></div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-20 bg-gray-200 rounded"></div>
            ))}
          </div>
        </div>
        <span className="sr-only">Loading...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center gap-2 text-red-600">
          <AlertTriangle className="w-5 h-5" />
          <span>Failed to load analytics: {error}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Total Runs</p>
              <p className="text-2xl font-semibold text-gray-900">
                {formatNumber(stats?.totalRuns || 0)}
              </p>
            </div>
            <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
              <Activity className="w-6 h-6 text-blue-600" />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Success Rate</p>
              <p className="text-2xl font-semibold text-green-600">
                {getSuccessRate()}%
              </p>
            </div>
            <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
              <CheckCircle className="w-6 h-6 text-green-600" />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Avg Duration</p>
              <p className="text-2xl font-semibold text-gray-900">
                {formatDuration(stats?.averageDuration || 0)}
              </p>
            </div>
            <div className="w-12 h-12 bg-yellow-100 rounded-lg flex items-center justify-center">
              <Clock className="w-6 h-6 text-yellow-600" />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Total Tokens</p>
              <p className="text-2xl font-semibold text-gray-900">
                {formatNumber(stats?.totalTokens || 0)}
              </p>
            </div>
            <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center">
              <TrendingUp className="w-6 h-6 text-purple-600" />
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Performance Metrics */}
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center gap-2 mb-4">
            <BarChart3 className="w-5 h-5 text-gray-600" />
            <h3 className="text-lg font-semibold text-gray-900">Performance Metrics</h3>
          </div>
          
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">Avg Tokens per Run</span>
              <span className="text-sm font-medium text-gray-900">
                {formatNumber(performance?.averageTokensPerRun || 0)}
              </span>
            </div>
            
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">Avg Memory Usage</span>
              <span className="text-sm font-medium text-gray-900">
                {(performance?.averageMemoryUsage || 0).toFixed(1)} MB
              </span>
            </div>
            
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">Avg CPU Time</span>
              <span className="text-sm font-medium text-gray-900">
                {formatDuration(performance?.averageCpuTime || 0)}
              </span>
            </div>
          </div>
        </div>

        {/* Recent Errors */}
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center gap-2 mb-4">
            <XCircle className="w-5 h-5 text-red-600" />
            <h3 className="text-lg font-semibold text-gray-900">Recent Errors</h3>
          </div>
          
          {recentErrors && recentErrors.length > 0 ? (
            <div className="space-y-3">
              {recentErrors.map((error) => (
                <div key={error.id} className="border-l-4 border-red-500 pl-3 py-2">
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {error.errorMessage}
                      </p>
                      <p className="text-xs text-gray-500 mt-1">
                        {error.workflowId} • {error.runType}
                      </p>
                    </div>
                    <span className="text-xs text-gray-400 ml-2">
                      {new Date(error.startTime).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-gray-500">
              <CheckCircle className="w-12 h-12 mx-auto mb-2 text-gray-300" />
              <p>No recent errors</p>
            </div>
          )}
        </div>
      </div>

      {/* Status Distribution */}
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Run Status Distribution</h3>
        
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-green-500 rounded"></div>
            <span className="text-sm text-gray-600">
              Successful ({stats?.successfulRuns || 0})
            </span>
          </div>
          
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-red-500 rounded"></div>
            <span className="text-sm text-gray-600">
              Failed ({stats?.failedRuns || 0})
            </span>
          </div>
          
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-gray-400 rounded"></div>
            <span className="text-sm text-gray-600">
              Other ({(stats?.totalRuns || 0) - (stats?.successfulRuns || 0) - (stats?.failedRuns || 0)})
            </span>
          </div>
        </div>
        
        <div className="mt-4 h-2 bg-gray-200 rounded-full overflow-hidden">
          <div className="h-full flex">
            {stats && stats.totalRuns > 0 && (
              <>
                <div 
                  className="bg-green-500" 
                  style={{ width: `${(stats.successfulRuns / stats.totalRuns) * 100}%` }}
                ></div>
                <div 
                  className="bg-red-500" 
                  style={{ width: `${(stats.failedRuns / stats.totalRuns) * 100}%` }}
                ></div>
                <div 
                  className="bg-gray-400" 
                  style={{ 
                    width: `${((stats.totalRuns - stats.successfulRuns - stats.failedRuns) / stats.totalRuns) * 100}%` 
                  }}
                ></div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default RunAnalytics;