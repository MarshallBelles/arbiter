'use client';

import React, { useState, useEffect } from 'react';
import { Bell, X, AlertCircle, CheckCircle, Info, Clock } from 'lucide-react';

interface Notification {
  id: string;
  type: 'success' | 'error' | 'info' | 'warning';
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
  relatedId?: string;
  relatedType?: 'workflow' | 'agent' | 'run';
}

interface NotificationCenterProps {
  className?: string;
}

export function NotificationCenter({ className = '' }: NotificationCenterProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    fetchNotifications();
    
    // Poll for new notifications every 30 seconds
    const interval = setInterval(fetchNotifications, 30000);
    
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const unread = notifications.filter(n => !n.read).length;
    setUnreadCount(unread);
  }, [notifications]);

  const fetchNotifications = async () => {
    try {
      // Since we don't have a notifications API endpoint yet, we'll simulate with recent events
      const response = await fetch('/api/runs?limit=10');
      if (response.ok) {
        const data = await response.json();
        const runs = data.runs || [];
        
        // Convert recent runs to notifications
        const runNotifications: Notification[] = runs
          .filter((run: any) => {
            // Only show completed or failed runs from the last 24 hours
            const runTime = new Date(run.startTime);
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            return runTime > yesterday && (run.status === 'completed' || run.status === 'failed');
          })
          .map((run: any) => ({
            id: `run-${run.id}`,
            type: run.status === 'completed' ? 'success' : 'error' as const,
            title: run.status === 'completed' ? 'Workflow Completed' : 'Workflow Failed',
            message: `${run.runType.replace('_', ' ')} for ${run.workflowId}`,
            timestamp: run.endTime || run.startTime,
            read: false,
            relatedId: run.id,
            relatedType: 'run' as const
          }));

        // Add some system notifications
        const systemNotifications: Notification[] = [];
        
        // Check if there are any recent failures
        const recentFailures = runs.filter((run: any) => {
          const runTime = new Date(run.startTime);
          const lastHour = new Date();
          lastHour.setHours(lastHour.getHours() - 1);
          return runTime > lastHour && run.status === 'failed';
        });

        if (recentFailures.length > 0) {
          systemNotifications.push({
            id: 'system-failures',
            type: 'warning',
            title: 'Multiple Failures Detected',
            message: `${recentFailures.length} workflows have failed in the last hour`,
            timestamp: new Date().toISOString(),
            read: false
          });
        }

        const allNotifications = [...systemNotifications, ...runNotifications]
          .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
          .slice(0, 10); // Keep only the 10 most recent

        setNotifications(allNotifications);
      }
    } catch (error) {
      console.error('Failed to fetch notifications:', error);
    }
  };

  const markAsRead = (notificationId: string) => {
    setNotifications(prev => 
      prev.map(n => 
        n.id === notificationId ? { ...n, read: true } : n
      )
    );
  };

  const markAllAsRead = () => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  };

  const removeNotification = (notificationId: string) => {
    setNotifications(prev => prev.filter(n => n.id !== notificationId));
  };

  const getIcon = (type: string) => {
    switch (type) {
      case 'success': return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'error': return <AlertCircle className="w-4 h-4 text-red-500" />;
      case 'warning': return <AlertCircle className="w-4 h-4 text-yellow-500" />;
      case 'info': return <Info className="w-4 h-4 text-blue-500" />;
      default: return <Info className="w-4 h-4 text-gray-500" />;
    }
  };

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffInMinutes = Math.floor((now.getTime() - date.getTime()) / (1000 * 60));
    
    if (diffInMinutes < 1) return 'Just now';
    if (diffInMinutes < 60) return `${diffInMinutes}m ago`;
    if (diffInMinutes < 1440) return `${Math.floor(diffInMinutes / 60)}h ago`;
    return date.toLocaleDateString();
  };

  const getBgColor = (type: string, read: boolean) => {
    const opacity = read ? 'bg-opacity-50' : 'bg-opacity-100';
    switch (type) {
      case 'success': return `bg-green-50 ${opacity}`;
      case 'error': return `bg-red-50 ${opacity}`;
      case 'warning': return `bg-yellow-50 ${opacity}`;
      case 'info': return `bg-blue-50 ${opacity}`;
      default: return `bg-gray-50 ${opacity}`;
    }
  };

  return (
    <div className={`relative ${className}`}>
      <button 
        className="p-2 rounded-md hover:bg-gray-100 relative"
        onClick={() => setIsOpen(!isOpen)}
      >
        <Bell className="w-5 h-5 text-gray-600" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[1.25rem] h-5 bg-red-500 text-white text-xs rounded-full flex items-center justify-center px-1">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full mt-2 w-80 bg-white border border-gray-200 rounded-lg shadow-lg z-50">
          <div className="p-4 border-b border-gray-100">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">Notifications</h3>
              <div className="flex items-center space-x-2">
                {unreadCount > 0 && (
                  <button
                    onClick={markAllAsRead}
                    className="text-sm text-blue-600 hover:text-blue-800"
                  >
                    Mark all read
                  </button>
                )}
                <button
                  onClick={() => setIsOpen(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
          </div>

          <div className="max-h-96 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="p-8 text-center text-gray-500">
                <Bell className="w-8 h-8 mx-auto mb-2 text-gray-300" />
                <p>No notifications</p>
                <p className="text-sm">You&apos;re all caught up!</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {notifications.map((notification) => (
                  <div
                    key={notification.id}
                    className={`p-4 hover:bg-gray-50 cursor-pointer ${getBgColor(notification.type, notification.read)}`}
                    onClick={() => markAsRead(notification.id)}
                  >
                    <div className="flex items-start space-x-3">
                      <div className="flex-shrink-0 mt-0.5">
                        {getIcon(notification.type)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <h4 className={`text-sm font-medium ${notification.read ? 'text-gray-600' : 'text-gray-900'}`}>
                            {notification.title}
                          </h4>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              removeNotification(notification.id);
                            }}
                            className="text-gray-400 hover:text-gray-600"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                        <p className={`text-sm ${notification.read ? 'text-gray-500' : 'text-gray-700'} mt-1`}>
                          {notification.message}
                        </p>
                        <div className="flex items-center mt-2 space-x-2">
                          <Clock className="w-3 h-3 text-gray-400" />
                          <span className="text-xs text-gray-500">
                            {formatTimestamp(notification.timestamp)}
                          </span>
                          {!notification.read && (
                            <span className="w-2 h-2 bg-blue-500 rounded-full"></span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {notifications.length > 0 && (
            <div className="p-4 border-t border-gray-100">
              <button
                onClick={() => {
                  setIsOpen(false);
                  // In a real app, this would navigate to a full notifications page
                  window.location.href = '/runs';
                }}
                className="w-full text-center text-sm text-blue-600 hover:text-blue-800"
              >
                View all activity
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default NotificationCenter;