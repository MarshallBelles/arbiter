import { test, expect } from '@playwright/test';

test.describe('Navigation', () => {
  test('should navigate to all main pages', async ({ page }) => {
    // Start at the dashboard
    await page.goto('/');
    await expect(page).toHaveURL('/dashboard');
    await expect(page).toHaveTitle(/Arbiter - AI Agent Orchestration Platform/);

    // Check navigation links are present
    await expect(page.getByRole('link', { name: 'Dashboard' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Workflows' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Agents' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Events' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Runs' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Settings' })).toBeVisible();

    // Navigate to Workflows page
    await page.getByRole('link', { name: 'Workflows' }).click();
    await expect(page).toHaveURL('/workflows');
    await expect(page.getByRole('heading', { name: 'Workflows' })).toBeVisible();

    // Navigate to Agents page
    await page.getByRole('link', { name: 'Agents' }).click();
    await expect(page).toHaveURL('/agents');
    await expect(page.getByRole('heading', { name: 'Agents' })).toBeVisible();

    // Navigate to Events page
    await page.getByRole('link', { name: 'Events' }).click();
    await expect(page).toHaveURL('/events');
    await expect(page.getByRole('heading', { name: 'Events' })).toBeVisible();

    // Navigate to Settings page
    await page.getByRole('link', { name: 'Settings' }).click();
    await expect(page).toHaveURL('/settings');
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

    // Navigate back to Dashboard
    await page.getByRole('link', { name: 'Dashboard' }).click();
    await expect(page).toHaveURL('/dashboard');
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  });

  test('should highlight active navigation item', async ({ page }) => {
    await page.goto('/');
    
    // Dashboard should be active initially
    const dashboardLink = page.getByRole('link', { name: 'Dashboard' });
    await expect(dashboardLink).toHaveClass(/bg-blue-100/);

    // Navigate to workflows and check it becomes active
    await page.getByRole('link', { name: 'Workflows' }).click();
    const workflowsLink = page.getByRole('link', { name: 'Workflows' });
    await expect(workflowsLink).toHaveClass(/bg-blue-100/);
  });
});