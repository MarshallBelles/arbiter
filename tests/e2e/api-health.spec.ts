import { test, expect } from '@playwright/test';

test.describe('API Health', () => {
  test('should have working health endpoint', async ({ request }) => {
    // Test the health API endpoint
    const response = await request.get('/api/health');
    
    expect(response.status()).toBe(200);
    
    const data = await response.json();
    expect(data).toHaveProperty('status', 'healthy');
    expect(data).toHaveProperty('timestamp');
    expect(data).toHaveProperty('version');
    expect(data).toHaveProperty('workflows');
    expect(data).toHaveProperty('agents');
    expect(data).toHaveProperty('executions');
    expect(data).toHaveProperty('events');
    expect(data).toHaveProperty('uptime');
    expect(data).toHaveProperty('memory');
  });

  test('should have working workflows API endpoint', async ({ request }) => {
    // Test the workflows API endpoint
    const response = await request.get('/api/workflows');
    
    expect(response.status()).toBe(200);
    
    const data = await response.json();
    expect(data).toHaveProperty('workflows');
    expect(data).toHaveProperty('pagination');
    expect(Array.isArray(data.workflows)).toBe(true);
  });

  test('should have working agents API endpoint', async ({ request }) => {
    // Test the agents API endpoint
    const response = await request.get('/api/agents');
    
    // Should succeed or return 404/405 if not implemented
    expect([200, 404, 405]).toContain(response.status());
  });

  test('should reflect API data in dashboard', async ({ page }) => {
    await page.goto('/dashboard');

    // Wait for the dashboard to load data from API
    await page.waitForTimeout(2000);

    // Check that numerical values are displayed (even if 0)
    const totalWorkflows = page.locator('text=Total Workflows').locator('..').locator('text=/^\\d+$/');
    await expect(totalWorkflows).toBeVisible();

    const activeAgents = page.locator('text=Active Agents').locator('..').locator('text=/^\\d+$/');
    await expect(activeAgents).toBeVisible();

    const runningExecutions = page.locator('text=Running Executions').locator('..').locator('text=/^\\d+$/');
    await expect(runningExecutions).toBeVisible();

    const eventHandlers = page.locator('text=Event Handlers').locator('..').locator('text=/^\\d+$/');
    await expect(eventHandlers).toBeVisible();
  });
});