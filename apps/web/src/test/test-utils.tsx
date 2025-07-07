import React from 'react'
import { render, RenderOptions } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'

// Custom render function that includes providers
const AllTheProviders: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <BrowserRouter>
      {children}
    </BrowserRouter>
  )
}

const customRender = (ui: React.ReactElement, options?: RenderOptions) =>
  render(ui, { wrapper: AllTheProviders, ...options })

export * from '@testing-library/react'
export { customRender as render }

// Mock API responses
export const mockApiResponse = (data: any, status = 200) => {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  } as Response)
}

// Mock fetch for specific endpoints
export const mockFetch = (url: string, response: any, status = 200) => {
  const mockFn = global.fetch as jest.MockedFunction<typeof fetch>
  mockFn.mockImplementation((input) => {
    if (input === url || (typeof input === 'object' && input.url === url)) {
      return mockApiResponse(response, status)
    }
    return Promise.reject(new Error(`Unhandled request: ${input}`))
  })
}

// Common test data
export const mockRunData = {
  id: 'test-run-1',
  workflowId: 'test-workflow-1',
  status: 'completed',
  startTime: new Date('2023-01-01T10:00:00Z'),
  endTime: new Date('2023-01-01T10:05:00Z'),
  duration: 300000,
  success: true,
  error: null,
  input: { test: 'input' },
  output: { test: 'output' },
  steps: [
    {
      id: 'step-1',
      agentId: 'agent-1',
      status: 'completed',
      startTime: new Date('2023-01-01T10:00:00Z'),
      endTime: new Date('2023-01-01T10:05:00Z'),
      input: { test: 'input' },
      output: { test: 'output' },
      error: null,
    },
  ],
}

export const mockAnalyticsData = {
  totalRuns: 150,
  successRate: 85.5,
  avgDuration: 240000,
  errorRate: 14.5,
  performance: {
    avgResponseTime: 1200,
    p95ResponseTime: 2800,
    p99ResponseTime: 4500,
    throughput: 25.5,
  },
  recentErrors: [
    {
      id: 'error-1',
      workflowId: 'workflow-1',
      message: 'Connection timeout',
      timestamp: new Date('2023-01-01T09:00:00Z'),
    },
  ],
  statusDistribution: {
    completed: 85,
    failed: 10,
    running: 3,
    pending: 2,
  },
}