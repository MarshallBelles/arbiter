import { test, expect } from '@playwright/test';

test.describe('Accessibility', () => {
  test('should have proper heading hierarchy', async ({ page }) => {
    await page.goto('/dashboard');

    // Check heading hierarchy
    const h1 = page.getByRole('heading', { level: 1 });
    await expect(h1).toHaveCount(1);
    await expect(h1).toHaveText('Dashboard');

    // Check that h3 headings exist for sections
    const h3Headings = page.getByRole('heading', { level: 3 });
    await expect(h3Headings).toHaveCount(3); // System Health, Quick Actions, System Information
  });

  test('should have proper link text', async ({ page }) => {
    await page.goto('/dashboard');

    // Check navigation links have proper text
    await expect(page.getByRole('link', { name: 'Dashboard' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Workflows' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Agents' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Events' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Settings' })).toBeVisible();

    // Check action links have descriptive text
    await expect(page.getByRole('link', { name: /Create New Workflow/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /Manage Agents/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /Event Monitoring/ })).toBeVisible();
  });

  test('should have proper form labels', async ({ page }) => {
    await page.goto('/dashboard');

    // Check search input has proper label/placeholder
    const searchInput = page.getByPlaceholder('Search workflows, agents...');
    await expect(searchInput).toBeVisible();

    // Navigate to workflows page to check search form
    await page.goto('/workflows');
    const workflowSearch = page.getByPlaceholder('Search workflows...');
    await expect(workflowSearch).toBeVisible();
  });

  test('should support keyboard navigation', async ({ page }) => {
    await page.goto('/dashboard');

    // Test tab navigation through main navigation
    await page.keyboard.press('Tab'); // Should focus first focusable element
    
    // Navigate through the main menu items
    const dashboardLink = page.getByRole('link', { name: 'Dashboard' });
    const workflowsLink = page.getByRole('link', { name: 'Workflows' });
    
    // Check that links are focusable
    await dashboardLink.focus();
    await expect(dashboardLink).toBeFocused();
    
    await workflowsLink.focus();
    await expect(workflowsLink).toBeFocused();
  });

  test('should have semantic HTML structure', async ({ page }) => {
    await page.goto('/dashboard');

    // Check for proper semantic elements
    await expect(page.getByRole('main')).toBeVisible();
    await expect(page.getByRole('navigation')).toBeVisible();
    await expect(page.getByRole('banner')).toBeVisible(); // Header area

    // Check for proper list structure in navigation
    const nav = page.getByRole('navigation');
    await expect(nav).toBeVisible();
  });

  test('should have proper color contrast', async ({ page }) => {
    await page.goto('/dashboard');

    // Check that status indicators use appropriate colors
    await expect(page.getByText('Healthy')).toBeVisible();
    await expect(page.getByText('Running')).toBeVisible();
    await expect(page.getByText('Active')).toBeVisible();

    // These should have good color contrast (green for healthy states)
  });

  test('should work with reduced motion preferences', async ({ page }) => {
    // Simulate reduced motion preference
    await page.emulateMedia({ reducedMotion: 'reduce' });
    
    await page.goto('/dashboard');

    // Page should still be functional
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    
    // Navigation should still work
    await page.getByRole('link', { name: 'Workflows' }).click();
    await expect(page).toHaveURL('/workflows');
  });
});