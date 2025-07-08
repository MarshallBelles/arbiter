import { test, expect } from '@playwright/test';

test.describe('Application Pages', () => {
  test.describe('Agents Page', () => {
    test('should display agents page correctly', async ({ page }) => {
      await page.goto('/agents');

      // Check main page elements
      await expect(page.getByRole('heading', { name: 'Agents' })).toBeVisible();
      await expect(page.getByText('Manage your AI agents and their configurations')).toBeVisible();

      // Check coming soon message
      await expect(page.getByRole('heading', { name: 'Agent Management Coming Soon' })).toBeVisible();
      await expect(page.getByText('Create, configure, and manage AI agents with different models and capabilities')).toBeVisible();
    });

    test('should be accessible from dashboard quick actions', async ({ page }) => {
      await page.goto('/dashboard');

      // Click Manage Agents from Quick Actions
      const manageAgentsLink = page.getByRole('link', { name: /Manage Agents/ });
      await manageAgentsLink.click();

      // Should be on agents page
      await expect(page).toHaveURL('/agents');
      await expect(page.getByRole('heading', { name: 'Agents' })).toBeVisible();
    });
  });

  test.describe('Events Page', () => {
    test('should display events page correctly', async ({ page }) => {
      await page.goto('/events');

      // Check main page elements
      await expect(page.getByRole('heading', { name: 'Events' })).toBeVisible();
      await expect(page.getByText('Monitor workflow executions and event handlers')).toBeVisible();

      // Check coming soon message
      await expect(page.getByRole('heading', { name: 'Event Monitoring Coming Soon' })).toBeVisible();
      await expect(page.getByText('Real-time monitoring of workflow executions, event triggers, and system events')).toBeVisible();
    });

    test('should be accessible from dashboard quick actions', async ({ page }) => {
      await page.goto('/dashboard');

      // Click Event Monitoring from Quick Actions
      const eventMonitoringLink = page.getByRole('link', { name: /Event Monitoring/ });
      await eventMonitoringLink.click();

      // Should be on events page
      await expect(page).toHaveURL('/events');
      await expect(page.getByRole('heading', { name: 'Events' })).toBeVisible();
    });
  });

  test.describe('Settings Page', () => {
    test('should display settings page correctly', async ({ page }) => {
      await page.goto('/settings');

      // Check main page elements
      await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
      await expect(page.getByText('Configure Arbiter system settings and preferences')).toBeVisible();

      // Check coming soon message
      await expect(page.getByRole('heading', { name: 'Settings Panel Coming Soon' })).toBeVisible();
      await expect(page.getByText('Configure model providers, system settings, and user preferences')).toBeVisible();
    });
  });

  test.describe('Runs Page', () => {
    test('should display runs page', async ({ page }) => {
      // Note: This page might not exist yet, but we should test navigation to it
      await page.goto('/runs');
      
      // The page should load without errors
      await expect(page).toHaveURL('/runs');
    });
  });
});