import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '../../test/test-utils'
import { userEvent } from '@testing-library/user-event'
import RunViewer from '../RunViewer'
import { mockFetch, mockRunData } from '../../test/test-utils'

// Mock URL.createObjectURL and URL.revokeObjectURL for export tests
global.URL.createObjectURL = vi.fn(() => 'mock-blob-url')
global.URL.revokeObjectURL = vi.fn()

describe('RunViewer', () => {
  const mockRuns = [
    {
      id: 'run-1',
      workflowId: 'workflow-1',
      runType: 'workflow_execution' as const,
      status: 'completed' as const,
      startTime: '2023-01-01T10:00:00Z',
      endTime: '2023-01-01T10:05:00Z',
      durationMs: 300000,
      agentId: 'agent-1',
      toolName: 'test-tool',
      tokensUsed: 150,
      memoryUsedMb: 45.2,
      cpuTimeMs: 1200,
    },
    {
      id: 'run-2',
      workflowId: 'workflow-2',
      runType: 'agent_execution' as const,
      status: 'failed' as const,
      startTime: '2023-01-01T11:00:00Z',
      endTime: '2023-01-01T11:01:00Z',
      durationMs: 60000,
      errorMessage: 'Connection timeout',
      errorCode: 'TIMEOUT',
      errorStack: 'Error: Connection timeout\n    at Agent.execute()',
    },
    {
      id: 'run-3',
      workflowId: 'workflow-1',
      runType: 'tool_call' as const,
      status: 'running' as const,
      startTime: '2023-01-01T12:00:00Z',
      agentId: 'agent-2',
      toolName: 'api-call',
    },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  describe('Initial Loading', () => {
    it('displays loading spinner on initial load', async () => {
      mockFetch('/api/runs', { runs: mockRuns })
      
      render(<RunViewer />)
      
      expect(screen.getByRole('status')).toBeInTheDocument()
      expect(screen.getByText('Loading...')).toBeInTheDocument()
    })

    it('fetches and displays runs on mount', async () => {
      mockFetch('/api/runs', { runs: mockRuns })
      
      render(<RunViewer />)
      
      await waitFor(() => {
        expect(screen.getByText('Run Viewer & Debugger')).toBeInTheDocument()
      })
      
      expect(screen.getByText('run-1')).toBeInTheDocument()
      expect(screen.getByText('run-2')).toBeInTheDocument()
      expect(screen.getByText('run-3')).toBeInTheDocument()
    })

    it('displays error message when API call fails', async () => {
      const mockFetchFn = global.fetch as jest.MockedFunction<typeof fetch>
      mockFetchFn.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: 'Server error' }),
      } as Response)
      
      render(<RunViewer />)
      
      await waitFor(() => {
        expect(screen.getByText('Failed to fetch runs')).toBeInTheDocument()
      })
    })
  })

  describe('Search Functionality', () => {
    beforeEach(async () => {
      mockFetch('/api/runs', { runs: mockRuns })
      render(<RunViewer />)
      await waitFor(() => {
        expect(screen.getByText('Run Viewer & Debugger')).toBeInTheDocument()
      })
    })

    it('filters runs by search term', async () => {
      const user = userEvent.setup()
      const searchInput = screen.getByPlaceholderText(/Search runs by ID/i)
      
      await user.type(searchInput, 'run-1')
      
      await waitFor(() => {
        expect(screen.getByText('run-1')).toBeInTheDocument()
        expect(screen.queryByText('run-2')).not.toBeInTheDocument()
        expect(screen.queryByText('run-3')).not.toBeInTheDocument()
      })
    })

    it('searches by workflow ID', async () => {
      const user = userEvent.setup()
      const searchInput = screen.getByPlaceholderText(/Search runs by ID/i)
      
      await user.type(searchInput, 'workflow-1')
      
      await waitFor(() => {
        expect(screen.getByText('run-1')).toBeInTheDocument()
        expect(screen.getByText('run-3')).toBeInTheDocument()
        expect(screen.queryByText('run-2')).not.toBeInTheDocument()
      })
    })

    it('searches by error message', async () => {
      const user = userEvent.setup()
      const searchInput = screen.getByPlaceholderText(/Search runs by ID/i)
      
      await user.type(searchInput, 'timeout')
      
      await waitFor(() => {
        expect(screen.getByText('run-2')).toBeInTheDocument()
        expect(screen.queryByText('run-1')).not.toBeInTheDocument()
        expect(screen.queryByText('run-3')).not.toBeInTheDocument()
      })
    })

    it('shows all runs when search is cleared', async () => {
      const user = userEvent.setup()
      const searchInput = screen.getByPlaceholderText(/Search runs by ID/i)
      
      await user.type(searchInput, 'run-1')
      await waitFor(() => {
        expect(screen.queryByText('run-2')).not.toBeInTheDocument()
      })
      
      await user.clear(searchInput)
      
      await waitFor(() => {
        expect(screen.getByText('run-1')).toBeInTheDocument()
        expect(screen.getByText('run-2')).toBeInTheDocument()
        expect(screen.getByText('run-3')).toBeInTheDocument()
      })
    })
  })

  describe('Filter Functionality', () => {
    beforeEach(async () => {
      mockFetch('/api/runs', { runs: mockRuns })
      render(<RunViewer />)
      await waitFor(() => {
        expect(screen.getByText('Run Viewer & Debugger')).toBeInTheDocument()
      })
    })

    it('toggles filter panel', async () => {
      const user = userEvent.setup()
      const filterButton = screen.getByText('Filters')
      
      await user.click(filterButton)
      
      expect(screen.getByText('Status')).toBeInTheDocument()
      expect(screen.getByText('Run Type')).toBeInTheDocument()
      expect(screen.getByText('Limit')).toBeInTheDocument()
      
      await user.click(filterButton)
      
      expect(screen.queryByText('Status')).not.toBeInTheDocument()
    })

    it('filters by status', async () => {
      const user = userEvent.setup()
      const filterButton = screen.getByText('Filters')
      await user.click(filterButton)
      
      const statusSelect = screen.getByLabelText('Status')
      await user.selectOptions(statusSelect, 'completed')
      
      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith('/api/runs?status=completed')
      })
    })

    it('filters by run type', async () => {
      const user = userEvent.setup()
      const filterButton = screen.getByText('Filters')
      await user.click(filterButton)
      
      const typeSelect = screen.getByLabelText('Run Type')
      await user.selectOptions(typeSelect, 'workflow_execution')
      
      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith('/api/runs?runType=workflow_execution')
      })
    })

    it('sets result limit', async () => {
      const user = userEvent.setup()
      const filterButton = screen.getByText('Filters')
      await user.click(filterButton)
      
      const limitSelect = screen.getByLabelText('Limit')
      await user.selectOptions(limitSelect, '50')
      
      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith('/api/runs?limit=50')
      })
    })
  })

  describe('Run Details Modal', () => {
    beforeEach(async () => {
      mockFetch('/api/runs', { runs: mockRuns })
      render(<RunViewer />)
      await waitFor(() => {
        expect(screen.getByText('Run Viewer & Debugger')).toBeInTheDocument()
      })
    })

    it('opens modal when clicking on a run', async () => {
      const user = userEvent.setup()
      const runRow = screen.getByText('run-1').closest('tr')
      
      await user.click(runRow!)
      
      expect(screen.getByText('Run Details')).toBeInTheDocument()
      expect(screen.getByText('Basic Information')).toBeInTheDocument()
      expect(screen.getByText('Performance Metrics')).toBeInTheDocument()
    })

    it('displays run details correctly', async () => {
      const user = userEvent.setup()
      const runRow = screen.getByText('run-1').closest('tr')
      
      await user.click(runRow!)
      
      expect(screen.getByText('run-1')).toBeInTheDocument()
      expect(screen.getByText('completed')).toBeInTheDocument()
      expect(screen.getByText('workflow_execution')).toBeInTheDocument()
      expect(screen.getByText('workflow-1')).toBeInTheDocument()
      expect(screen.getByText('150')).toBeInTheDocument() // tokens used
      expect(screen.getByText('45.2 MB')).toBeInTheDocument() // memory
    })

    it('shows error details for failed runs', async () => {
      const user = userEvent.setup()
      const runRow = screen.getByText('run-2').closest('tr')
      
      await user.click(runRow!)
      
      expect(screen.getByText('Error Details')).toBeInTheDocument()
      expect(screen.getByText('Connection timeout')).toBeInTheDocument()
      expect(screen.getByText('TIMEOUT')).toBeInTheDocument()
    })

    it('shows stack trace when available', async () => {
      const user = userEvent.setup()
      const runRow = screen.getByText('run-2').closest('tr')
      
      await user.click(runRow!)
      
      const stackTraceToggle = screen.getByText('Stack Trace')
      await user.click(stackTraceToggle)
      
      expect(screen.getByText('Error: Connection timeout')).toBeInTheDocument()
    })

    it('closes modal when clicking close button', async () => {
      const user = userEvent.setup()
      const runRow = screen.getByText('run-1').closest('tr')
      
      await user.click(runRow!)
      expect(screen.getByText('Run Details')).toBeInTheDocument()
      
      const closeButton = screen.getByRole('button', { name: /close/i })
      await user.click(closeButton)
      
      expect(screen.queryByText('Run Details')).not.toBeInTheDocument()
    })
  })

  describe('Status Icons', () => {
    beforeEach(async () => {
      mockFetch('/api/runs', { runs: mockRuns })
      render(<RunViewer />)
      await waitFor(() => {
        expect(screen.getByText('Run Viewer & Debugger')).toBeInTheDocument()
      })
    })

    it('displays correct status icons', () => {
      const completedIcon = screen.getByText('completed').closest('td')?.querySelector('svg')
      const failedIcon = screen.getByText('failed').closest('td')?.querySelector('svg')
      const runningIcon = screen.getByText('running').closest('td')?.querySelector('svg')
      
      expect(completedIcon).toHaveClass('text-green-500')
      expect(failedIcon).toHaveClass('text-red-500')
      expect(runningIcon).toHaveClass('text-blue-500')
    })

    it('shows spinning animation for running status', () => {
      const runningIcon = screen.getByText('running').closest('td')?.querySelector('svg')
      expect(runningIcon).toHaveClass('animate-spin')
    })
  })

  describe('Export Functionality', () => {
    beforeEach(async () => {
      mockFetch('/api/runs', { runs: mockRuns })
      render(<RunViewer />)
      await waitFor(() => {
        expect(screen.getByText('Run Viewer & Debugger')).toBeInTheDocument()
      })
    })

    it('triggers export when export button is clicked', async () => {
      const user = userEvent.setup()
      const mockBlob = new Blob(['test data'], { type: 'application/json' })
      
      const mockFetchFn = global.fetch as jest.MockedFunction<typeof fetch>
      mockFetchFn.mockResolvedValueOnce({
        ok: true,
        blob: () => Promise.resolve(mockBlob),
      } as Response)
      
      const exportButton = screen.getByText('Export')
      await user.click(exportButton)
      
      expect(global.fetch).toHaveBeenCalledWith('/api/runs/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
    })

    it('handles export error gracefully', async () => {
      const user = userEvent.setup()
      const mockFetchFn = global.fetch as jest.MockedFunction<typeof fetch>
      mockFetchFn.mockResolvedValueOnce({
        ok: false,
        status: 500,
      } as Response)
      
      const exportButton = screen.getByText('Export')
      await user.click(exportButton)
      
      await waitFor(() => {
        expect(screen.getByText('Failed to export runs')).toBeInTheDocument()
      })
    })
  })

  describe('Refresh Functionality', () => {
    beforeEach(async () => {
      mockFetch('/api/runs', { runs: mockRuns })
      render(<RunViewer />)
      await waitFor(() => {
        expect(screen.getByText('Run Viewer & Debugger')).toBeInTheDocument()
      })
    })

    it('refreshes data when refresh button is clicked', async () => {
      const user = userEvent.setup()
      const refreshButton = screen.getByText('Refresh')
      
      await user.click(refreshButton)
      
      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledTimes(2) // initial + refresh
      })
    })
  })

  describe('Empty State', () => {
    it('displays empty state when no runs found', async () => {
      mockFetch('/api/runs', { runs: [] })
      
      render(<RunViewer />)
      
      await waitFor(() => {
        expect(screen.getByText('No runs found matching your criteria')).toBeInTheDocument()
      })
    })
  })

  describe('Large Dataset Performance', () => {
    it('handles large number of runs efficiently', async () => {
      const largeRunSet = Array.from({ length: 1000 }, (_, i) => ({
        id: `run-${i}`,
        workflowId: `workflow-${i % 10}`,
        runType: 'workflow_execution' as const,
        status: 'completed' as const,
        startTime: '2023-01-01T10:00:00Z',
        endTime: '2023-01-01T10:05:00Z',
        durationMs: 300000,
      }))
      
      mockFetch('/api/runs', { runs: largeRunSet })
      
      const startTime = performance.now()
      render(<RunViewer />)
      
      await waitFor(() => {
        expect(screen.getByText('Run Viewer & Debugger')).toBeInTheDocument()
      })
      
      const endTime = performance.now()
      const renderTime = endTime - startTime
      
      // Should render within reasonable time (less than 1 second)
      expect(renderTime).toBeLessThan(1000)
      expect(screen.getByText('Showing 1000 of 1000 runs')).toBeInTheDocument()
    })
  })

  describe('Data Formatting', () => {
    it('formats duration correctly', async () => {
      const runWithDuration = {
        ...mockRuns[0],
        durationMs: 1500, // 1.5 seconds
      }
      
      mockFetch('/api/runs', { runs: [runWithDuration] })
      render(<RunViewer />)
      
      await waitFor(() => {
        expect(screen.getByText('1.5s')).toBeInTheDocument()
      })
    })

    it('formats timestamps correctly', async () => {
      mockFetch('/api/runs', { runs: mockRuns })
      render(<RunViewer />)
      
      await waitFor(() => {
        const formattedDate = new Date('2023-01-01T10:00:00Z').toLocaleString()
        expect(screen.getByText(formattedDate)).toBeInTheDocument()
      })
    })

    it('handles missing duration gracefully', async () => {
      const runWithoutDuration = {
        ...mockRuns[0],
        durationMs: undefined,
      }
      
      mockFetch('/api/runs', { runs: [runWithoutDuration] })
      render(<RunViewer />)
      
      await waitFor(() => {
        expect(screen.getByText('N/A')).toBeInTheDocument()
      })
    })
  })
})