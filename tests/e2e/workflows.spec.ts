import { test, expect } from '@playwright/test';

test.describe('Workflows Page', () => {
  test('should display workflows page correctly', async ({ page }) => {
    await page.goto('/workflows');

    // Check main page elements
    await expect(page.getByRole('heading', { name: 'Workflows' })).toBeVisible();
    await expect(page.getByText('Manage your AI agent workflows')).toBeVisible();

    // Check Create Workflow button
    const createWorkflowButton = page.getByRole('link', { name: 'Create Workflow' });
    await expect(createWorkflowButton).toBeVisible();
    await expect(createWorkflowButton).toHaveAttribute('href', '/workflows/designer');
  });

  test('should display search and filter controls', async ({ page }) => {
    await page.goto('/workflows');

    // Check search input
    const searchInput = page.getByPlaceholder('Search workflows...');
    await expect(searchInput).toBeVisible();

    // Check filter dropdown
    const filterDropdown = page.getByRole('combobox');
    await expect(filterDropdown).toBeVisible();
    
    // Check filter options
    await expect(page.getByText('All Types')).toBeVisible();
  });

  test('should display empty state when no workflows exist', async ({ page }) => {
    await page.goto('/workflows');

    // Check empty state
    await expect(page.getByRole('heading', { name: 'No workflows found' })).toBeVisible();
    await expect(page.getByText('Get started by creating your first workflow')).toBeVisible();
    
    // Check empty state Create Workflow button
    const emptyStateButton = page.getByRole('link', { name: 'Create Workflow' }).last();
    await expect(emptyStateButton).toBeVisible();
    await expect(emptyStateButton).toHaveAttribute('href', '/workflows/designer');
  });

  test('should navigate to workflow designer from workflows page', async ({ page }) => {
    await page.goto('/workflows');

    // Click Create Workflow button
    const createButton = page.getByRole('link', { name: 'Create Workflow' }).first();
    await createButton.click();

    // Should navigate to designer
    await expect(page).toHaveURL('/workflows/designer');
    await expect(page.getByRole('heading', { name: 'Create New Workflow' })).toBeVisible();
  });

  test('should allow search interaction', async ({ page }) => {
    await page.goto('/workflows');

    // Test search functionality
    const searchInput = page.getByPlaceholder('Search workflows...');
    await searchInput.fill('test workflow');
    await expect(searchInput).toHaveValue('test workflow');
    
    // Clear search
    await searchInput.clear();
    await expect(searchInput).toHaveValue('');
  });

  test('should allow filter dropdown interaction', async ({ page }) => {
    await page.goto('/workflows');

    // Test filter dropdown
    const filterDropdown = page.getByRole('combobox');
    await filterDropdown.click();
    
    // Check filter options are available
    await expect(page.getByText('All Types')).toBeVisible();
    await expect(page.getByText('Webhook')).toBeVisible();
    await expect(page.getByText('Cron')).toBeVisible();
    await expect(page.getByText('Manual')).toBeVisible();
    await expect(page.getByText('File Watch')).toBeVisible();
  });
});