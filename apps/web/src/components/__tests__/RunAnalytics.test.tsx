import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '../../test/test-utils'
import RunAnalytics from '../RunAnalytics'
import { mockFetch } from '../../test/test-utils'

describe('RunAnalytics', () => {
  const mockStats = {
    totalRuns: 1250,
    successfulRuns: 1067,
    failedRuns: 183,
    averageDuration: 2450,
    totalTokens: 250000,
  }

  const mockPerformance = {
    averageTokensPerRun: 200,
    averageMemoryUsage: 45.8,
    averageCpuTime: 1200,
    totalRuns: 1250,
  }

  const mockErrors = [
    {
      id: 'error-1',
      workflowId: 'workflow-1',
      errorMessage: 'Connection timeout',
      startTime: '2023-01-01T10:00:00Z',
      runType: 'workflow_execution',
    },
    {
      id: 'error-2',
      workflowId: 'workflow-2',
      errorMessage: 'Invalid API key',
      startTime: '2023-01-01T09:00:00Z',
      runType: 'agent_execution',
    },
    {
      id: 'error-3',
      workflowId: 'workflow-3',
      errorMessage: 'Memory limit exceeded',
      startTime: '2023-01-01T08:00:00Z',
      runType: 'tool_call',
    },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  describe('Initial Loading', () => {
    it('displays loading skeleton on initial load', () => {
      // Mock pending promises to keep loading state
      const mockFetchFn = global.fetch as ReturnType<typeof vi.fn>
      mockFetchFn.mockImplementation(() => new Promise(() => {}))
      
      render(<RunAnalytics />)
      
      expect(screen.getByRole('status')).toBeInTheDocument()
      expect(screen.getByText('Loading...')).toBeInTheDocument()
    })

    it('fetches analytics data on mount', async () => {
      const mockFetchFn = global.fetch as ReturnType<typeof vi.fn>
      mockFetchFn
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ stats: mockStats }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ metrics: mockPerformance }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ errors: mockErrors }),
        } as Response)
      
      render(<RunAnalytics />)
      
      await waitFor(() => {
        expect(screen.getByText('Total Runs')).toBeInTheDocument()
      })
      
      expect(global.fetch).toHaveBeenCalledWith('/api/runs/stats')
      expect(global.fetch).toHaveBeenCalledWith('/api/runs/performance')
      expect(global.fetch).toHaveBeenCalledWith('/api/runs/errors?limit=5')
    })

    it('displays error message when API calls fail', async () => {
      const mockFetchFn = global.fetch as ReturnType<typeof vi.fn>
      mockFetchFn.mockResolvedValue({
        ok: false,
        status: 500,
      } as Response)
      
      render(<RunAnalytics />)
      
      await waitFor(() => {
        expect(screen.getByText('Failed to load analytics: Failed to fetch analytics')).toBeInTheDocument()
      })
    })
  })

  describe('Analytics Cards', () => {
    beforeEach(async () => {
      const mockFetchFn = global.fetch as ReturnType<typeof vi.fn>
      mockFetchFn
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ stats: mockStats }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ metrics: mockPerformance }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ errors: mockErrors }),
        } as Response)
      
      render(<RunAnalytics />)
      await waitFor(() => {
        expect(screen.getByText('Total Runs')).toBeInTheDocument()
      })
    })

    it('displays total runs correctly', () => {
      expect(screen.getByText('Total Runs')).toBeInTheDocument()
      expect(screen.getByText('1.3K')).toBeInTheDocument() // 1250 formatted
    })

    it('calculates and displays success rate', () => {
      expect(screen.getByText('Success Rate')).toBeInTheDocument()
      const successRate = Math.round((1067 / 1250) * 100)
      expect(screen.getByText(`${successRate}%`)).toBeInTheDocument()
    })

    it('displays average duration correctly', () => {
      expect(screen.getByText('Avg Duration')).toBeInTheDocument()
      expect(screen.getByText('2.5s')).toBeInTheDocument() // 2450ms formatted
    })

    it('displays total tokens correctly', () => {
      expect(screen.getByText('Total Tokens')).toBeInTheDocument()
      expect(screen.getByText('250.0K')).toBeInTheDocument() // 250000 formatted
    })
  })

  describe('Performance Metrics', () => {
    beforeEach(async () => {
      const mockFetchFn = global.fetch as ReturnType<typeof vi.fn>
      mockFetchFn
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ stats: mockStats }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ metrics: mockPerformance }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ errors: mockErrors }),
        } as Response)
      
      render(<RunAnalytics />)
      await waitFor(() => {
        expect(screen.getByText('Performance Metrics')).toBeInTheDocument()
      })
    })

    it('displays average tokens per run', () => {
      expect(screen.getByText('Avg Tokens per Run')).toBeInTheDocument()
      expect(screen.getByText('200')).toBeInTheDocument()
    })

    it('displays average memory usage', () => {
      expect(screen.getByText('Avg Memory Usage')).toBeInTheDocument()
      expect(screen.getByText('45.8 MB')).toBeInTheDocument()
    })

    it('displays average CPU time', () => {
      expect(screen.getByText('Avg CPU Time')).toBeInTheDocument()
      expect(screen.getByText('1.2s')).toBeInTheDocument() // 1200ms formatted
    })
  })

  describe('Recent Errors', () => {
    beforeEach(async () => {
      const mockFetchFn = global.fetch as ReturnType<typeof vi.fn>
      mockFetchFn
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ stats: mockStats }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ metrics: mockPerformance }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ errors: mockErrors }),
        } as Response)
      
      render(<RunAnalytics />)
      await waitFor(() => {
        expect(screen.getByText('Recent Errors')).toBeInTheDocument()
      })
    })

    it('displays recent errors list', () => {
      expect(screen.getByText('Recent Errors')).toBeInTheDocument()
      expect(screen.getByText('Connection timeout')).toBeInTheDocument()
      expect(screen.getByText('Invalid API key')).toBeInTheDocument()
      expect(screen.getByText('Memory limit exceeded')).toBeInTheDocument()
    })

    it('displays error details correctly', () => {
      const errorElement = screen.getByText('Connection timeout').closest('div')
      expect(errorElement).toHaveTextContent('workflow-1 • workflow_execution')
    })

    it('formats error timestamps correctly', () => {
      const expectedDate = new Date('2023-01-01T10:00:00Z').toLocaleDateString()
      expect(screen.getByText(expectedDate)).toBeInTheDocument()
    })
  })

  describe('Empty States', () => {
    it('displays no errors message when no errors exist', async () => {
      const mockFetchFn = global.fetch as ReturnType<typeof vi.fn>
      mockFetchFn
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ stats: mockStats }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ metrics: mockPerformance }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ errors: [] }),
        } as Response)
      
      render(<RunAnalytics />)
      
      await waitFor(() => {
        expect(screen.getByText('No recent errors')).toBeInTheDocument()
      })
    })

    it('handles zero stats gracefully', async () => {
      const zeroStats = {
        totalRuns: 0,
        successfulRuns: 0,
        failedRuns: 0,
        averageDuration: 0,
        totalTokens: 0,
      }
      
      const mockFetchFn = global.fetch as ReturnType<typeof vi.fn>
      mockFetchFn
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ stats: zeroStats }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ metrics: mockPerformance }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ errors: [] }),
        } as Response)
      
      render(<RunAnalytics />)
      
      await waitFor(() => {
        expect(screen.getByText('Total Runs')).toBeInTheDocument()
      })
      
      expect(screen.getByText('0')).toBeInTheDocument() // total runs
      expect(screen.getByText('0%')).toBeInTheDocument() // success rate
      expect(screen.getByText('0ms')).toBeInTheDocument() // avg duration
    })
  })

  describe('Status Distribution', () => {
    beforeEach(async () => {
      const mockFetchFn = global.fetch as ReturnType<typeof vi.fn>
      mockFetchFn
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ stats: mockStats }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ metrics: mockPerformance }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ errors: mockErrors }),
        } as Response)
      
      render(<RunAnalytics />)
      await waitFor(() => {
        expect(screen.getByText('Run Status Distribution')).toBeInTheDocument()
      })
    })

    it('displays status distribution correctly', () => {
      expect(screen.getByText('Run Status Distribution')).toBeInTheDocument()
      expect(screen.getByText('Successful (1067)')).toBeInTheDocument()
      expect(screen.getByText('Failed (183)')).toBeInTheDocument()
      
      // Other runs = total - successful - failed = 1250 - 1067 - 183 = 0
      expect(screen.getByText('Other (0)')).toBeInTheDocument()
    })

    it('renders status distribution bars', () => {
      const distributionContainer = screen.getByText('Run Status Distribution').closest('div')
      expect(distributionContainer).toBeInTheDocument()
      
      const bars = distributionContainer?.querySelectorAll('.bg-green-500, .bg-red-500, .bg-gray-400')
      expect(bars).toHaveLength(3) // successful, failed, other
    })
  })

  describe('Number Formatting', () => {
    it('formats large numbers correctly', async () => {
      const largeStats = {
        totalRuns: 1500000,
        successfulRuns: 1200000,
        failedRuns: 300000,
        averageDuration: 3600000, // 1 hour
        totalTokens: 5000000,
      }
      
      const mockFetchFn = global.fetch as ReturnType<typeof vi.fn>
      mockFetchFn
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ stats: largeStats }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ metrics: mockPerformance }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ errors: [] }),
        } as Response)
      
      render(<RunAnalytics />)
      
      await waitFor(() => {
        expect(screen.getByText('1.5M')).toBeInTheDocument() // total runs
        expect(screen.getByText('5.0M')).toBeInTheDocument() // total tokens
        expect(screen.getByText('60.0m')).toBeInTheDocument() // avg duration (1 hour)
      })
    })

    it('formats small numbers correctly', async () => {
      const smallStats = {
        totalRuns: 50,
        successfulRuns: 45,
        failedRuns: 5,
        averageDuration: 500, // 500ms
        totalTokens: 1000,
      }
      
      const mockFetchFn = global.fetch as ReturnType<typeof vi.fn>
      mockFetchFn
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ stats: smallStats }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ metrics: mockPerformance }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ errors: [] }),
        } as Response)
      
      render(<RunAnalytics />)
      
      await waitFor(() => {
        expect(screen.getByText('50')).toBeInTheDocument() // total runs
        expect(screen.getByText('1.0K')).toBeInTheDocument() // total tokens
        expect(screen.getByText('500ms')).toBeInTheDocument() // avg duration
      })
    })
  })

  describe('Success Rate Calculation', () => {
    it('calculates success rate correctly for various scenarios', async () => {
      const testCases = [
        { successful: 90, total: 100, expected: '90%' },
        { successful: 85, total: 100, expected: '85%' },
        { successful: 0, total: 100, expected: '0%' },
        { successful: 100, total: 100, expected: '100%' },
      ]
      
      for (const testCase of testCases) {
        const stats = {
          totalRuns: testCase.total,
          successfulRuns: testCase.successful,
          failedRuns: testCase.total - testCase.successful,
          averageDuration: 1000,
          totalTokens: 1000,
        }
        
        const mockFetchFn = global.fetch as ReturnType<typeof vi.fn>
        mockFetchFn
          .mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({ stats }),
          } as Response)
          .mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({ metrics: mockPerformance }),
          } as Response)
          .mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({ errors: [] }),
          } as Response)
        
        render(<RunAnalytics />)
        
        await waitFor(() => {
          expect(screen.getByText(testCase.expected)).toBeInTheDocument()
        })
        
        // Clean up for next test
        vi.clearAllMocks()
      }
    })
  })

  describe('Error Handling', () => {
    it('handles missing or null data gracefully', async () => {
      const mockFetchFn = global.fetch as ReturnType<typeof vi.fn>
      mockFetchFn
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ stats: null }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ metrics: null }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ errors: null }),
        } as Response)
      
      render(<RunAnalytics />)
      
      await waitFor(() => {
        expect(screen.getByText('Total Runs')).toBeInTheDocument()
      })
      
      // Should display zeros for missing data
      expect(screen.getByText('0')).toBeInTheDocument()
      expect(screen.getByText('0%')).toBeInTheDocument()
      expect(screen.getByText('0ms')).toBeInTheDocument()
    })

    it('handles network errors gracefully', async () => {
      const mockFetchFn = global.fetch as ReturnType<typeof vi.fn>
      mockFetchFn.mockRejectedValue(new Error('Network error'))
      
      render(<RunAnalytics />)
      
      await waitFor(() => {
        expect(screen.getByText('Failed to load analytics: Network error')).toBeInTheDocument()
      })
    })

    it('handles partial API failures', async () => {
      const mockFetchFn = global.fetch as ReturnType<typeof vi.fn>
      mockFetchFn
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ stats: mockStats }),
        } as Response)
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ errors: mockErrors }),
        } as Response)
      
      render(<RunAnalytics />)
      
      await waitFor(() => {
        expect(screen.getByText('Failed to load analytics: Failed to fetch analytics')).toBeInTheDocument()
      })
    })
  })

  describe('Performance with Large Datasets', () => {
    it('handles large error lists efficiently', async () => {
      const largeErrorList = Array.from({ length: 100 }, (_, i) => ({
        id: `error-${i}`,
        workflowId: `workflow-${i}`,
        errorMessage: `Error message ${i}`,
        startTime: '2023-01-01T10:00:00Z',
        runType: 'workflow_execution',
      }))
      
      const mockFetchFn = global.fetch as ReturnType<typeof vi.fn>
      mockFetchFn
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ stats: mockStats }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ metrics: mockPerformance }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ errors: largeErrorList }),
        } as Response)
      
      const startTime = performance.now()
      render(<RunAnalytics />)
      
      await waitFor(() => {
        expect(screen.getByText('Recent Errors')).toBeInTheDocument()
      })
      
      const endTime = performance.now()
      const renderTime = endTime - startTime
      
      // Should render within reasonable time
      expect(renderTime).toBeLessThan(1000)
      expect(screen.getByText('Error message 0')).toBeInTheDocument()
    })
  })
})