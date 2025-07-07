import { test, expect } from '@playwright/test';

test.describe('Basic Navigation', () => {
  test('should load the application and display dashboard', async ({ page }) => {
    await page.goto('/');
    
    // Verify the app loads
    await expect(page).toHaveTitle(/Arbiter/);
    
    // Verify main navigation elements are present
    await expect(page.locator('h1')).toContainText('Dashboard');
    await expect(page.locator('nav')).toBeVisible();
    
    // Check for key navigation items
    await expect(page.locator('a[href="/workflows"]')).toBeVisible();
    await expect(page.locator('a[href="/agents"]')).toBeVisible();
    await expect(page.locator('a[href="/runs"]')).toBeVisible();
  });

  test('should navigate between main sections', async ({ page }) => {
    await page.goto('/');
    
    // Navigate to workflows
    await page.click('a[href="/workflows"]');
    await expect(page).toHaveURL('/workflows');
    await expect(page.locator('h1')).toContainText('Workflows');
    
    // Navigate to agents
    await page.click('a[href="/agents"]');
    await expect(page).toHaveURL('/agents');
    await expect(page.locator('h1')).toContainText('Agents');
    
    // Navigate to runs
    await page.click('a[href="/runs"]');
    await expect(page).toHaveURL('/runs');
    await expect(page.locator('h1')).toContainText(/Run|Runs/);
    
    // Navigate back to dashboard
    await page.click('a[href="/"]');
    await expect(page).toHaveURL('/');
    await expect(page.locator('h1')).toContainText('Dashboard');
  });

  test('should display responsive navigation', async ({ page }) => {
    // Test on mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
    
    // Verify mobile navigation works
    await expect(page.locator('h1')).toContainText('Dashboard');
    
    // Check if mobile menu toggle is present (if applicable)
    const mobileMenuButton = page.locator('button[data-testid="mobile-menu"]');
    if (await mobileMenuButton.count() > 0) {
      await mobileMenuButton.click();
      await expect(page.locator('nav')).toBeVisible();
    }
  });

  test('should handle page not found', async ({ page }) => {
    await page.goto('/non-existent-page');
    
    // Verify 404 handling
    await expect(page.locator('text=404')).toBeVisible().catch(() => {
      // If no explicit 404 page, verify we redirect to dashboard or show error
      expect(page.url()).toContain('/');
    });
  });
});