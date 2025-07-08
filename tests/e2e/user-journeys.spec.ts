import { test, expect } from '@playwright/test';

test.describe('User Journeys', () => {
  test('complete user journey: dashboard to workflow creation', async ({ page }) => {
    // Start at dashboard
    await page.goto('/');
    await expect(page).toHaveURL('/dashboard');

    // Check system status on dashboard
    await expect(page.getByText('API Server')).toBeVisible();
    await expect(page.getByText('Healthy')).toBeVisible();

    // Click Create Workflow from dashboard
    const createWorkflowButton = page.getByRole('link', { name: 'Create Workflow' }).first();
    await createWorkflowButton.click();

    // Should be on workflow designer
    await expect(page).toHaveURL('/workflows/designer');
    await expect(page.getByRole('heading', { name: 'Create New Workflow' })).toBeVisible();
    await expect(page.getByText('Design your AI agent workflow with a visual mesh network interface')).toBeVisible();

    // Navigate back to dashboard via navigation
    await page.getByRole('link', { name: 'Dashboard' }).click();
    await expect(page).toHaveURL('/dashboard');
  });

  test('explore all sections from dashboard', async ({ page }) => {
    await page.goto('/dashboard');

    // Test Quick Action: Manage Agents
    const manageAgentsLink = page.getByRole('link', { name: /Manage Agents/ });
    await manageAgentsLink.click();
    await expect(page).toHaveURL('/agents');
    await expect(page.getByRole('heading', { name: 'Agents' })).toBeVisible();

    // Go back to dashboard
    await page.getByRole('link', { name: 'Dashboard' }).click();

    // Test Quick Action: Event Monitoring
    const eventMonitoringLink = page.getByRole('link', { name: /Event Monitoring/ });
    await eventMonitoringLink.click();
    await expect(page).toHaveURL('/events');
    await expect(page.getByRole('heading', { name: 'Events' })).toBeVisible();

    // Go back to dashboard
    await page.getByRole('link', { name: 'Dashboard' }).click();

    // Test navigation to Settings
    await page.getByRole('link', { name: 'Settings' }).click();
    await expect(page).toHaveURL('/settings');
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  });

  test('workflow management journey', async ({ page }) => {
    // Start at workflows page
    await page.goto('/workflows');

    // Check empty state
    await expect(page.getByRole('heading', { name: 'No workflows found' })).toBeVisible();
    await expect(page.getByText('Get started by creating your first workflow')).toBeVisible();

    // Test search functionality
    const searchInput = page.getByPlaceholder('Search workflows...');
    await searchInput.fill('test workflow');
    await expect(searchInput).toHaveValue('test workflow');

    // Test filter dropdown
    const filterDropdown = page.getByRole('combobox');
    await filterDropdown.click();
    await expect(page.getByText('Webhook')).toBeVisible();
    await expect(page.getByText('Cron')).toBeVisible();
    await expect(page.getByText('Manual')).toBeVisible();

    // Select a filter option
    await page.getByText('Webhook').click();

    // Clear search
    await searchInput.clear();

    // Navigate to workflow designer
    const createButton = page.getByRole('link', { name: 'Create Workflow' }).first();
    await createButton.click();
    await expect(page).toHaveURL('/workflows/designer');
  });

  test('navigation consistency across pages', async ({ page }) => {
    const pages = [
      { url: '/dashboard', heading: 'Dashboard' },
      { url: '/workflows', heading: 'Workflows' },
      { url: '/agents', heading: 'Agents' },
      { url: '/events', heading: 'Events' },
      { url: '/settings', heading: 'Settings' },
      { url: '/workflows/designer', heading: 'Create New Workflow' },
    ];

    for (const pageInfo of pages) {
      await page.goto(pageInfo.url);
      
      // Check page loads correctly
      await expect(page.getByRole('heading', { name: pageInfo.heading })).toBeVisible();
      
      // Check navigation is present and functional
      await expect(page.getByRole('link', { name: 'Dashboard' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Workflows' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Agents' })).toBeVisible();
      
      // Check search box is present in header
      await expect(page.getByPlaceholder('Search workflows, agents...')).toBeVisible();
      
      // Check Arbiter logo/title is present
      await expect(page.getByText('Arbiter')).toBeVisible();
    }
  });

  test('error handling journey', async ({ page }) => {
    // Test navigation to non-existent page
    await page.goto('/non-existent-page');
    
    // Should show 404 or redirect appropriately
    // (Next.js might handle this differently)
    
    // Test back to working page
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  });

  test('search functionality across different pages', async ({ page }) => {
    // Test global search on dashboard
    await page.goto('/dashboard');
    const globalSearch = page.getByPlaceholder('Search workflows, agents...');
    await globalSearch.fill('global search test');
    await expect(globalSearch).toHaveValue('global search test');

    // Navigate to workflows page
    await page.goto('/workflows');
    const workflowSearch = page.getByPlaceholder('Search workflows...');
    await workflowSearch.fill('workflow search test');
    await expect(workflowSearch).toHaveValue('workflow search test');

    // Global search should still work on workflows page
    const globalSearchOnWorkflows = page.getByPlaceholder('Search workflows, agents...');
    await globalSearchOnWorkflows.fill('global on workflows');
    await expect(globalSearchOnWorkflows).toHaveValue('global on workflows');
  });
});