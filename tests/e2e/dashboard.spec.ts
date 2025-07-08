import { test, expect } from '@playwright/test';

test.describe('Dashboard', () => {
  test('should display system statistics', async ({ page }) => {
    await page.goto('/dashboard');

    // Check main dashboard elements
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    await expect(page.getByText('Welcome to Arbiter AI Agent Orchestration Platform')).toBeVisible();

    // Check statistics cards
    await expect(page.getByText('Total Workflows')).toBeVisible();
    await expect(page.getByText('Active Agents')).toBeVisible();
    await expect(page.getByText('Running Executions')).toBeVisible();
    await expect(page.getByText('Event Handlers')).toBeVisible();

    // Check system health section
    await expect(page.getByRole('heading', { name: 'System Health' })).toBeVisible();
    await expect(page.getByText('API Server')).toBeVisible();
    await expect(page.getByText('Workflow Engine')).toBeVisible();
    await expect(page.getByText('Event System')).toBeVisible();
    await expect(page.getByText('Memory Usage')).toBeVisible();

    // Check system status indicators
    await expect(page.getByText('Healthy')).toBeVisible();
    await expect(page.getByText('Running')).toBeVisible();
    await expect(page.getByText('Active')).toBeVisible();
  });

  test('should display quick actions', async ({ page }) => {
    await page.goto('/dashboard');

    // Check quick actions section
    await expect(page.getByRole('heading', { name: 'Quick Actions' })).toBeVisible();
    
    // Check action links
    const createWorkflowLink = page.getByRole('link', { name: /Create New Workflow/ });
    await expect(createWorkflowLink).toBeVisible();
    await expect(createWorkflowLink).toHaveAttribute('href', '/workflows/designer');

    const manageAgentsLink = page.getByRole('link', { name: /Manage Agents/ });
    await expect(manageAgentsLink).toBeVisible();
    await expect(manageAgentsLink).toHaveAttribute('href', '/agents');

    const eventMonitoringLink = page.getByRole('link', { name: /Event Monitoring/ });
    await expect(eventMonitoringLink).toBeVisible();
    await expect(eventMonitoringLink).toHaveAttribute('href', '/events');
  });

  test('should display system information', async ({ page }) => {
    await page.goto('/dashboard');

    // Check system information section
    await expect(page.getByRole('heading', { name: 'System Information' })).toBeVisible();
    
    // Check system info items
    await expect(page.getByText('Uptime')).toBeVisible();
    await expect(page.getByText('Memory')).toBeVisible();
    await expect(page.getByText('Total Events')).toBeVisible();
    await expect(page.getByText('Active Workflows')).toBeVisible();
  });

  test('should have working Create Workflow button', async ({ page }) => {
    await page.goto('/dashboard');

    // Click the main Create Workflow button
    const createWorkflowButton = page.getByRole('link', { name: 'Create Workflow' }).first();
    await createWorkflowButton.click();

    // Should navigate to workflow designer
    await expect(page).toHaveURL('/workflows/designer');
    await expect(page.getByRole('heading', { name: 'Create New Workflow' })).toBeVisible();
  });

  test('should display search functionality in header', async ({ page }) => {
    await page.goto('/dashboard');

    // Check search box is present
    const searchBox = page.getByPlaceholder('Search workflows, agents...');
    await expect(searchBox).toBeVisible();
    
    // Test search input
    await searchBox.fill('test search');
    await expect(searchBox).toHaveValue('test search');
  });
});