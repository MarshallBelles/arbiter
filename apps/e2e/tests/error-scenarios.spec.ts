import { test, expect } from '@playwright/test';

test.describe('Error Scenarios and Edge Cases', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1')).toContainText('Dashboard');
  });

  test('should handle API server downtime gracefully', async ({ page }) => {
    // Note: This test would require actually stopping the API server
    // For demo purposes, we'll test the error handling UI components
    
    // Navigate to a page that requires API data
    await page.goto('/workflows');
    
    // Simulate network error by intercepting requests
    await page.route('**/api/**', route => {
      route.abort('connectionrefused');
    });
    
    // Try to refresh the page
    await page.reload();
    
    // Verify error handling
    await expect(page.locator('.error-state')).toBeVisible();
    await expect(page.locator('.error-state')).toContainText('Unable to connect to server');
    
    // Verify retry functionality
    await expect(page.locator('button:has-text("Retry")')).toBeVisible();
    
    // Remove the network intercept
    await page.unroute('**/api/**');
    
    // Click retry
    await page.click('button:has-text("Retry")');
    
    // Verify recovery
    await expect(page.locator('.error-state')).not.toBeVisible();
    await expect(page.locator('h1')).toContainText('Workflows');
  });

  test('should handle malformed workflow configurations', async ({ page }) => {
    // Create a workflow with invalid configuration
    await page.goto('/workflows');
    await page.click('text=Create Workflow');
    
    // Add a workflow with circular dependencies
    await page.fill('input[name="name"]', 'Circular Workflow');
    await page.fill('textarea[name="description"]', 'Workflow with circular references');
    
    // Add multiple nodes
    await page.click('button:has-text("Add Agent Node")');
    await page.click('button:has-text("Add Agent Node")');
    
    // Configure nodes to create circular dependency
    const firstNode = page.locator('.workflow-node').first();
    const secondNode = page.locator('.workflow-node').nth(1);
    
    // Connect first to second
    await firstNode.locator('.node-output-handle').dragTo(secondNode.locator('.node-input-handle'));
    
    // Try to connect second back to first (circular)
    await secondNode.locator('.node-output-handle').dragTo(firstNode.locator('.node-input-handle'));
    
    // Attempt to save
    await page.click('button:has-text("Save Workflow")');
    
    // Verify validation error
    await expect(page.locator('.error-message')).toContainText('Circular dependency detected');
    await expect(page.locator('.toast-error')).toBeVisible();
  });

  test('should handle extremely large workflow inputs', async ({ page }) => {
    // Create a simple workflow first
    await page.goto('/workflows');
    await page.click('text=Create Workflow');
    
    await page.fill('input[name="name"]', 'Large Input Test');
    await page.fill('textarea[name="description"]', 'Testing large input handling');
    
    await page.click('button:has-text("Add Agent Node")');
    const agentNode = page.locator('.workflow-node').first();
    await agentNode.click();
    
    await page.fill('input[data-testid="agent-name"]', 'Test Agent');
    await page.selectOption('select[data-testid="agent-model"]', 'granite-3.3');
    await page.selectOption('select[data-testid="agent-provider"]', 'local');
    
    await page.click('button:has-text("Save Workflow")');
    await expect(page.locator('.toast-success')).toBeVisible();
    
    // Execute with extremely large input
    await page.goto('/workflows');
    const workflowRow = page.locator('tr:has-text("Large Input Test")');
    await workflowRow.locator('button:has-text("Execute")').click();
    
    // Create a large input object (10MB+ of text)
    const largeText = 'A'.repeat(10 * 1024 * 1024); // 10MB of 'A's
    const largeInput = JSON.stringify({
      prompt: 'Process this large text',
      data: largeText
    });
    
    await page.fill('textarea[data-testid="execution-input"]', largeInput);
    await page.click('button:has-text("Start Execution")');
    
    // Verify error handling for large input
    await expect(page.locator('.error-message')).toContainText(/Input too large|Request entity too large/);
    await expect(page.locator('.execution-status')).toContainText('Failed');
  });

  test('should handle concurrent workflow executions', async ({ page }) => {
    // Create a workflow for concurrent testing
    await page.goto('/workflows');
    await page.click('text=Create Workflow');
    
    await page.fill('input[name="name"]', 'Concurrent Test');
    await page.fill('textarea[name="description"]', 'Testing concurrent executions');
    
    await page.click('button:has-text("Add Agent Node")');
    const agentNode = page.locator('.workflow-node').first();
    await agentNode.click();
    
    await page.fill('input[data-testid="agent-name"]', 'Concurrent Agent');
    await page.selectOption('select[data-testid="agent-model"]', 'granite-3.3');
    await page.selectOption('select[data-testid="agent-provider"]', 'local');
    
    await page.click('button:has-text("Save Workflow")');
    await expect(page.locator('.toast-success')).toBeVisible();
    
    // Open multiple tabs and execute simultaneously
    const pages = [page];
    for (let i = 0; i < 3; i++) {
      pages.push(await page.context().newPage());
    }
    
    // Execute workflow in all tabs simultaneously
    const executionPromises = pages.map(async (p, index) => {
      await p.goto('/workflows');
      const workflowRow = p.locator('tr:has-text("Concurrent Test")');
      await workflowRow.locator('button:has-text("Execute")').click();
      
      await p.fill('textarea[data-testid="execution-input"]', JSON.stringify({
        prompt: `Concurrent execution ${index}`,
        id: index
      }));
      
      await p.click('button:has-text("Start Execution")');
      
      // Wait for execution to start
      await expect(p.locator('.execution-status')).toContainText(/Running|Queued/);
    });
    
    await Promise.all(executionPromises);
    
    // Verify all executions were handled properly
    for (const p of pages) {
      await expect(p.locator('.execution-status')).toContainText(/Completed|Failed/, { timeout: 30000 });
    }
    
    // Close additional pages
    for (let i = 1; i < pages.length; i++) {
      await pages[i].close();
    }
  });

  test('should handle invalid JSON in workflow inputs', async ({ page }) => {
    // Create a basic workflow
    await page.goto('/workflows');
    await page.click('text=Create Workflow');
    
    await page.fill('input[name="name"]', 'JSON Test Workflow');
    await page.click('button:has-text("Add Agent Node")');
    
    const agentNode = page.locator('.workflow-node').first();
    await agentNode.click();
    await page.fill('input[data-testid="agent-name"]', 'JSON Test Agent');
    await page.selectOption('select[data-testid="agent-model"]', 'granite-3.3');
    await page.selectOption('select[data-testid="agent-provider"]', 'local');
    
    await page.click('button:has-text("Save Workflow")');
    await expect(page.locator('.toast-success')).toBeVisible();
    
    // Execute with invalid JSON
    await page.goto('/workflows');
    const workflowRow = page.locator('tr:has-text("JSON Test Workflow")');
    await workflowRow.locator('button:has-text("Execute")').click();
    
    // Enter invalid JSON
    await page.fill('textarea[data-testid="execution-input"]', '{ invalid json: missing quotes, }');
    await page.click('button:has-text("Start Execution")');
    
    // Verify JSON validation error
    await expect(page.locator('.error-message')).toContainText('Invalid JSON format');
    await expect(page.locator('.json-error')).toBeVisible();
    
    // Try with correctly formatted JSON
    await page.fill('textarea[data-testid="execution-input"]', '{"valid": "json", "test": true}');
    await page.click('button:has-text("Start Execution")');
    
    // Verify execution proceeds
    await expect(page.locator('.execution-status')).toContainText(/Running|Completed/);
  });

  test('should handle browser session timeouts', async ({ page }) => {
    // Navigate to a protected route
    await page.goto('/workflows');
    
    // Simulate session timeout by clearing cookies/storage
    await page.context().clearCookies();
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    
    // Try to perform an action that requires authentication
    await page.click('text=Create Workflow');
    
    // Verify redirect to login or appropriate error handling
    // (This would depend on your authentication implementation)
    await expect(page.locator('.auth-error, .login-form')).toBeVisible();
  });

  test('should handle memory-intensive workflow executions', async ({ page }) => {
    // Create a workflow designed to use significant memory
    await page.goto('/workflows');
    await page.click('text=Create Workflow');
    
    await page.fill('input[name="name"]', 'Memory Intensive Workflow');
    await page.fill('textarea[name="description"]', 'Testing memory usage limits');
    
    await page.click('button:has-text("Add Agent Node")');
    const agentNode = page.locator('.workflow-node').first();
    await agentNode.click();
    
    await page.fill('input[data-testid="agent-name"]', 'Memory Agent');
    await page.selectOption('select[data-testid="agent-model"]', 'granite-3.3');
    await page.selectOption('select[data-testid="agent-provider"]', 'local');
    
    // Configure for high memory usage
    await page.fill('input[name="maxTokens"]', '8192'); // Large token limit
    await page.fill('input[name="memorySize"]', '10000'); // Large memory
    
    await page.click('button:has-text("Save Workflow")');
    await expect(page.locator('.toast-success')).toBeVisible();
    
    // Execute with memory-intensive input
    await page.goto('/workflows');
    const workflowRow = page.locator('tr:has-text("Memory Intensive Workflow")');
    await workflowRow.locator('button:has-text("Execute")').click();
    
    const memoryIntensiveInput = {
      prompt: 'Generate a detailed analysis of the following large dataset',
      data: Array(1000).fill(0).map((_, i) => ({
        id: i,
        content: `Large data item ${i} with extensive content `.repeat(100)
      }))
    };
    
    await page.fill('textarea[data-testid="execution-input"]', JSON.stringify(memoryIntensiveInput));
    await page.click('button:has-text("Start Execution")');
    
    // Monitor for memory-related errors or timeouts
    await expect(page.locator('.execution-status')).toContainText(/Running|Failed|Timeout/, { timeout: 60000 });
    
    // If it fails, verify appropriate error message
    const status = await page.locator('.execution-status').textContent();
    if (status?.includes('Failed')) {
      await expect(page.locator('.execution-error')).toContainText(/Memory|Timeout|Resource/);
    }
  });

  test('should handle rapid successive API calls', async ({ page }) => {
    // Navigate to a page with real-time updates
    await page.goto('/runs');
    
    // Rapidly trigger multiple API calls
    for (let i = 0; i < 10; i++) {
      await page.click('button:has-text("Refresh")');
      await page.waitForTimeout(100); // Very rapid succession
    }
    
    // Verify the UI doesn't break from rapid requests
    await expect(page.locator('h1')).toContainText('Run Viewer');
    await expect(page.locator('.run-table')).toBeVisible();
    
    // Verify no duplicate loading states
    const loadingSpinners = page.locator('.loading-spinner');
    await expect(loadingSpinners).toHaveCount(0, 1); // Should be 0 or 1, not multiple
  });

  test('should handle workflow execution interruption', async ({ page }) => {
    // Create a long-running workflow
    await page.goto('/workflows');
    await page.click('text=Create Workflow');
    
    await page.fill('input[name="name"]', 'Long Running Workflow');
    await page.click('button:has-text("Add Agent Node")');
    
    const agentNode = page.locator('.workflow-node').first();
    await agentNode.click();
    await page.fill('input[data-testid="agent-name"]', 'Slow Agent');
    await page.selectOption('select[data-testid="agent-model"]', 'granite-3.3');
    await page.selectOption('select[data-testid="agent-provider"]', 'local');
    
    await page.click('button:has-text("Save Workflow")');
    await expect(page.locator('.toast-success')).toBeVisible();
    
    // Start execution
    await page.goto('/workflows');
    const workflowRow = page.locator('tr:has-text("Long Running Workflow")');
    await workflowRow.locator('button:has-text("Execute")').click();
    
    await page.fill('textarea[data-testid="execution-input"]', JSON.stringify({
      prompt: 'Perform a very long and detailed analysis that takes significant time'
    }));
    
    await page.click('button:has-text("Start Execution")');
    
    // Wait for execution to start
    await expect(page.locator('.execution-status')).toContainText('Running');
    
    // Cancel the execution
    await page.click('button:has-text("Cancel Execution")');
    
    // Verify cancellation
    await expect(page.locator('.execution-status')).toContainText('Cancelled');
    await expect(page.locator('.toast-info')).toContainText('Execution cancelled');
  });

  test('should handle file upload edge cases', async ({ page }) => {
    // Navigate to a file upload feature (if available)
    await page.goto('/workflows');
    await page.click('text=Create Workflow');
    
    // Try to upload an extremely large file
    const largeFileInput = page.locator('input[type="file"][data-testid="workflow-import"]');
    if (await largeFileInput.count() > 0) {
      // Create a mock large file
      const largeContent = 'A'.repeat(100 * 1024 * 1024); // 100MB
      await largeFileInput.setInputFiles({
        name: 'large-workflow.json',
        mimeType: 'application/json',
        buffer: Buffer.from(largeContent)
      });
      
      // Verify error handling for large file
      await expect(page.locator('.error-message')).toContainText(/File too large|Maximum file size exceeded/);
    }
    
    // Try to upload an invalid file type
    if (await largeFileInput.count() > 0) {
      await largeFileInput.setInputFiles({
        name: 'invalid.exe',
        mimeType: 'application/x-executable',
        buffer: Buffer.from('Invalid file content')
      });
      
      // Verify file type validation
      await expect(page.locator('.error-message')).toContainText(/Invalid file type|Only JSON files allowed/);
    }
  });

  test('should handle UI component stress testing', async ({ page }) => {
    // Navigate to a complex page
    await page.goto('/dashboard');
    
    // Rapidly interact with multiple UI components
    const promises = [];
    
    // Click multiple navigation items rapidly
    promises.push(page.click('a[href="/workflows"]'));
    promises.push(page.click('a[href="/agents"]'));
    promises.push(page.click('a[href="/runs"]'));
    promises.push(page.click('a[href="/dashboard"]'));
    
    await Promise.all(promises);
    
    // Verify the UI remains stable
    await expect(page.locator('body')).toBeVisible();
    await expect(page.locator('.navigation')).toBeVisible();
    
    // Check for JavaScript errors in console
    const errors = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });
    
    // Trigger various UI interactions
    await page.hover('.sidebar');
    await page.click('.user-menu', { timeout: 1000 }).catch(() => {}); // Ignore if doesn't exist
    
    // Verify no critical errors occurred
    expect(errors.filter(e => !e.includes('404') && !e.includes('favicon'))).toHaveLength(0);
  });
});