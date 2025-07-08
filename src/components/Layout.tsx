'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { 
  Home, 
  Workflow, 
  Bot, 
  Calendar, 
  Settings, 
  Menu,
  Search,
  Activity,
  X
} from 'lucide-react';
import { NotificationCenter } from './NotificationCenter';

interface LayoutProps {
  children: React.ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  
  const navigation = [
    { name: 'Dashboard', href: '/dashboard', icon: Home },
    { name: 'Workflows', href: '/workflows', icon: Workflow },
    { name: 'Agents', href: '/agents', icon: Bot },
    { name: 'Events', href: '/events', icon: Calendar },
    { name: 'Runs', href: '/runs', icon: Activity },
    { name: 'Settings', href: '/settings', icon: Settings },
  ];

  const isActive = (path: string) => {
    if (!pathname) return false;
    if (path === '/dashboard') {
      return pathname === '/dashboard' || pathname === '/';
    }
    return pathname.startsWith(path);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Mobile sidebar */}
      {sidebarOpen && (
        <div className="fixed inset-0 flex z-40 lg:hidden">
          {/* Sidebar */}
          <div className="fixed inset-y-0 left-0 w-64 bg-white shadow-lg z-50">
            <div className="flex h-16 items-center px-6 border-b">
              <div className="flex items-center space-x-2">
                <div className="w-8 h-8 bg-arbiter-600 rounded-lg flex items-center justify-center">
                  <Workflow className="w-5 h-5 text-white" />
                </div>
                <span className="text-xl font-bold text-gray-900">Arbiter</span>
              </div>
              <button
                onClick={() => setSidebarOpen(false)}
                className="ml-auto p-2 rounded-md text-gray-500 hover:bg-gray-100"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
            <nav className="mt-6 px-3">
              <div className="space-y-1">
                {navigation.map((item) => {
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.name}
                      href={item.href}
                      onClick={() => setSidebarOpen(false)}
                      className={`
                        group flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors
                        ${isActive(item.href)
                          ? 'bg-arbiter-100 text-arbiter-700'
                          : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                        }
                      `}
                    >
                      <Icon className="mr-3 h-5 w-5" />
                      {item.name}
                    </Link>
                  );
                })}
              </div>
            </nav>
          </div>
          {/* Overlay */}
          <div className="fixed inset-0 bg-black bg-opacity-25" onClick={() => setSidebarOpen(false)}></div>
        </div>
      )}

      {/* Desktop Sidebar */}
      <div className="hidden lg:fixed lg:inset-y-0 lg:left-0 lg:w-64 lg:bg-white lg:shadow-lg">
        <div className="flex h-16 items-center px-6 border-b">
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 bg-arbiter-600 rounded-lg flex items-center justify-center">
              <Workflow className="w-5 h-5 text-white" />
            </div>
            <span className="text-xl font-bold text-gray-900">Arbiter</span>
          </div>
        </div>
        
        <nav className="mt-6 px-3">
          <div className="space-y-1">
            {navigation.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  className={`
                    group flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors
                    ${isActive(item.href)
                      ? 'bg-arbiter-100 text-arbiter-700'
                      : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                    }
                  `}
                >
                  <Icon className="mr-3 h-5 w-5" />
                  {item.name}
                </Link>
              );
            })}
          </div>
        </nav>
      </div>

      {/* Main content */}
      <div className="lg:pl-64">
        {/* Header */}
        <header className="bg-white shadow-sm border-b">
          <div className="flex h-16 items-center justify-between px-6">
            <div className="flex items-center space-x-4">
              <button 
                className="p-2 rounded-md hover:bg-gray-100 lg:hidden"
                onClick={() => setSidebarOpen(true)}
              >
                <Menu className="w-5 h-5 text-gray-600" />
              </button>
              
              <div className="relative hidden sm:block">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search workflows, agents..."
                  className="pl-10 pr-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-arbiter-500 focus:border-transparent"
                />
              </div>
            </div>
            
            <div className="flex items-center space-x-4">
              <NotificationCenter />
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="p-6">
          {children}
        </main>
      </div>
    </div>
  );
}