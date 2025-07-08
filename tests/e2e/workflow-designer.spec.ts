import { test, expect } from '@playwright/test';

test.describe('Workflow Designer', () => {
  test('should display workflow designer page', async ({ page }) => {
    await page.goto('/workflows/designer');

    // Check main page elements
    await expect(page.getByRole('heading', { name: 'Create New Workflow' })).toBeVisible();
    await expect(page.getByText('Design your AI agent workflow with a visual mesh network interface')).toBeVisible();
  });

  test('should display coming soon message', async ({ page }) => {
    await page.goto('/workflows/designer');

    // Check coming soon section
    await expect(page.getByRole('heading', { name: 'Workflow Designer Coming Soon' })).toBeVisible();
    await expect(page.getByText('Visual drag-and-drop workflow builder with mesh network support')).toBeVisible();
  });

  test('should be accessible from dashboard Create Workflow button', async ({ page }) => {
    await page.goto('/dashboard');

    // Click Create Workflow from dashboard
    const createWorkflowButton = page.getByRole('link', { name: 'Create Workflow' }).first();
    await createWorkflowButton.click();

    // Should be on designer page
    await expect(page).toHaveURL('/workflows/designer');
    await expect(page.getByRole('heading', { name: 'Create New Workflow' })).toBeVisible();
  });

  test('should be accessible from workflows page', async ({ page }) => {
    await page.goto('/workflows');

    // Click Create Workflow from workflows page
    const createWorkflowButton = page.getByRole('link', { name: 'Create Workflow' }).first();
    await createWorkflowButton.click();

    // Should be on designer page
    await expect(page).toHaveURL('/workflows/designer');
    await expect(page.getByRole('heading', { name: 'Create New Workflow' })).toBeVisible();
  });

  test('should be accessible from quick actions', async ({ page }) => {
    await page.goto('/dashboard');

    // Click Create New Workflow from Quick Actions
    const quickActionLink = page.getByRole('link', { name: /Create New Workflow/ });
    await quickActionLink.click();

    // Should be on designer page
    await expect(page).toHaveURL('/workflows/designer');
    await expect(page.getByRole('heading', { name: 'Create New Workflow' })).toBeVisible();
  });
});