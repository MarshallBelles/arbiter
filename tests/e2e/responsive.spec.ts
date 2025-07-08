import { test, expect } from '@playwright/test';

test.describe('Responsive Design', () => {
  test('should work on mobile viewport', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    
    await page.goto('/dashboard');

    // Check that main elements are still visible
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    await expect(page.getByText('Welcome to Arbiter AI Agent Orchestration Platform')).toBeVisible();

    // Navigation should be present (might be hamburger menu on mobile)
    await expect(page.getByRole('navigation')).toBeVisible();

    // Stats should be visible (might be stacked)
    await expect(page.getByText('Total Workflows')).toBeVisible();
    await expect(page.getByText('Active Agents')).toBeVisible();
  });

  test('should work on tablet viewport', async ({ page }) => {
    // Set tablet viewport
    await page.setViewportSize({ width: 768, height: 1024 });
    
    await page.goto('/dashboard');

    // Check that main elements are still visible
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    await expect(page.getByText('Welcome to Arbiter AI Agent Orchestration Platform')).toBeVisible();

    // Navigation should be visible
    await expect(page.getByRole('link', { name: 'Dashboard' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Workflows' })).toBeVisible();
  });

  test('should maintain functionality across viewports', async ({ page }) => {
    // Test navigation on different viewports
    const viewports = [
      { width: 375, height: 667 },  // Mobile
      { width: 768, height: 1024 }, // Tablet
      { width: 1200, height: 800 }, // Desktop
    ];

    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await page.goto('/dashboard');

      // Test navigation to workflows page
      await page.getByRole('link', { name: 'Workflows' }).click();
      await expect(page).toHaveURL('/workflows');
      await expect(page.getByRole('heading', { name: 'Workflows' })).toBeVisible();

      // Navigate back to dashboard
      await page.getByRole('link', { name: 'Dashboard' }).click();
      await expect(page).toHaveURL('/dashboard');
    }
  });

  test('should have readable text on all viewport sizes', async ({ page }) => {
    const viewports = [
      { width: 375, height: 667 },
      { width: 768, height: 1024 },
      { width: 1200, height: 800 },
    ];

    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await page.goto('/dashboard');

      // Check that text is readable (not overlapping or cut off)
      const heading = page.getByRole('heading', { name: 'Dashboard' });
      await expect(heading).toBeVisible();
      
      const description = page.getByText('Welcome to Arbiter AI Agent Orchestration Platform');
      await expect(description).toBeVisible();
    }
  });
});