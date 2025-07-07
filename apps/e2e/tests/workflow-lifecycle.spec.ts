import { test, expect } from '@playwright/test';

test.describe('Workflow Lifecycle', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the app and wait for it to load
    await page.goto('/');
    await expect(page.locator('h1')).toContainText('Dashboard');
  });

  test('should create, configure, and execute a complete workflow', async ({ page }) => {
    // Step 1: Navigate to create new workflow
    await page.click('text=Create Workflow');
    await expect(page).toHaveURL(/\/workflows\/new/);
    await expect(page.locator('h1')).toContainText('Workflow Designer');

    // Step 2: Configure basic workflow properties
    await page.fill('input[name="name"]', 'E2E Test Workflow');
    await page.fill('textarea[name="description"]', 'A test workflow created by E2E tests');
    
    // Step 3: Add workflow nodes
    // Add an agent node
    await page.click('button:has-text("Add Agent Node")');
    const agentNode = page.locator('.workflow-node').first();
    await expect(agentNode).toBeVisible();
    
    // Configure the agent node
    await agentNode.click();
    await page.fill('input[data-testid="agent-name"]', 'Test Agent');
    await page.selectOption('select[data-testid="agent-model"]', 'granite-3.3');
    await page.selectOption('select[data-testid="agent-provider"]', 'local');
    
    // Add tools to the agent
    await page.check('input[data-testid="tool-calculator"]');
    await page.check('input[data-testid="tool-web_search"]');
    
    // Step 4: Configure workflow connections
    // Connect nodes if there are multiple
    const nodes = page.locator('.workflow-node');
    const nodeCount = await nodes.count();
    
    if (nodeCount > 1) {
      // Drag from first node's output to second node's input
      const sourceHandle = nodes.first().locator('.node-output-handle');
      const targetHandle = nodes.nth(1).locator('.node-input-handle');
      
      await sourceHandle.dragTo(targetHandle);
      
      // Verify connection was created
      await expect(page.locator('.workflow-edge')).toBeVisible();
    }

    // Step 5: Save the workflow
    await page.click('button:has-text("Save Workflow")');
    
    // Wait for success notification
    await expect(page.locator('.toast-success')).toBeVisible();
    await expect(page.locator('.toast-success')).toContainText('Workflow saved successfully');
    
    // Verify redirect to workflows list
    await expect(page).toHaveURL(/\/workflows/);
    
    // Step 6: Verify workflow appears in list
    await expect(page.locator('text=E2E Test Workflow')).toBeVisible();
    
    // Step 7: Execute the workflow
    const workflowRow = page.locator('tr:has-text("E2E Test Workflow")');
    await workflowRow.locator('button:has-text("Execute")').click();
    
    // Fill in execution parameters
    await page.fill('textarea[data-testid="execution-input"]', JSON.stringify({
      prompt: 'Calculate 2 + 2 and explain the result',
      context: 'This is a test execution'
    }));
    
    await page.click('button:has-text("Start Execution")');
    
    // Step 8: Monitor execution progress
    await expect(page.locator('.execution-status')).toContainText('Running');
    
    // Wait for execution to complete (with timeout)
    await expect(page.locator('.execution-status')).toContainText('Completed', { timeout: 30000 });
    
    // Step 9: Verify execution results
    await expect(page.locator('.execution-results')).toBeVisible();
    const results = page.locator('.execution-results');
    await expect(results).toContainText('4'); // Calculator result
    
    // Step 10: Check run logs
    await page.click('text=View Logs');
    await expect(page.locator('.run-logs')).toBeVisible();
    
    // Verify logs contain expected entries
    await expect(page.locator('.log-entry:has-text("workflow_execution")')).toBeVisible();
    await expect(page.locator('.log-entry:has-text("agent_execution")')).toBeVisible();
    await expect(page.locator('.log-entry:has-text("tool_execution")')).toBeVisible();
  });

  test('should handle workflow execution errors gracefully', async ({ page }) => {
    // Create a workflow that will fail
    await page.click('text=Create Workflow');
    await page.fill('input[name="name"]', 'Failing Workflow');
    await page.fill('textarea[name="description"]', 'A workflow designed to fail for testing');
    
    // Add an agent node with invalid configuration
    await page.click('button:has-text("Add Agent Node")');
    const agentNode = page.locator('.workflow-node').first();
    await agentNode.click();
    
    // Configure with invalid settings
    await page.fill('input[data-testid="agent-name"]', 'Failing Agent');
    await page.selectOption('select[data-testid="agent-model"]', 'invalid-model');
    
    await page.click('button:has-text("Save Workflow")');
    await expect(page.locator('.toast-success')).toBeVisible();
    
    // Execute the failing workflow
    await page.goto('/workflows');
    const workflowRow = page.locator('tr:has-text("Failing Workflow")');
    await workflowRow.locator('button:has-text("Execute")').click();
    
    await page.fill('textarea[data-testid="execution-input"]', '{"test": "input"}');
    await page.click('button:has-text("Start Execution")');
    
    // Verify error handling
    await expect(page.locator('.execution-status')).toContainText('Failed', { timeout: 30000 });
    await expect(page.locator('.execution-error')).toBeVisible();
    await expect(page.locator('.execution-error')).toContainText('Model not found');
  });

  test('should support workflow editing and updates', async ({ page }) => {
    // First create a basic workflow
    await page.click('text=Create Workflow');
    await page.fill('input[name="name"]', 'Editable Workflow');
    await page.fill('textarea[name="description"]', 'Original description');
    
    await page.click('button:has-text("Add Agent Node")');
    await page.click('button:has-text("Save Workflow")');
    await expect(page.locator('.toast-success')).toBeVisible();
    
    // Now edit the workflow
    await page.goto('/workflows');
    const workflowRow = page.locator('tr:has-text("Editable Workflow")');
    await workflowRow.locator('button:has-text("Edit")').click();
    
    await expect(page).toHaveURL(/\/workflows\/.*\/designer/);
    
    // Modify workflow properties
    await page.fill('input[name="name"]', 'Updated Workflow Name');
    await page.fill('textarea[name="description"]', 'Updated description with more details');
    
    // Add another node
    await page.click('button:has-text("Add Agent Node")');
    await expect(page.locator('.workflow-node')).toHaveCount(2);
    
    // Save changes
    await page.click('button:has-text("Save Workflow")');
    await expect(page.locator('.toast-success')).toBeVisible();
    
    // Verify changes were saved
    await page.goto('/workflows');
    await expect(page.locator('text=Updated Workflow Name')).toBeVisible();
    
    // Verify the updated workflow can still be executed
    const updatedRow = page.locator('tr:has-text("Updated Workflow Name")');
    await updatedRow.locator('button:has-text("Execute")').click();
    
    await page.fill('textarea[data-testid="execution-input"]', '{"test": "updated workflow"}');
    await page.click('button:has-text("Start Execution")');
    
    await expect(page.locator('.execution-status')).toContainText(/Running|Completed/, { timeout: 30000 });
  });

  test('should support workflow deletion with confirmation', async ({ page }) => {
    // Create a workflow to delete
    await page.click('text=Create Workflow');
    await page.fill('input[name="name"]', 'Workflow to Delete');
    await page.fill('textarea[name="description"]', 'This workflow will be deleted');
    
    await page.click('button:has-text("Add Agent Node")');
    await page.click('button:has-text("Save Workflow")');
    await expect(page.locator('.toast-success')).toBeVisible();
    
    // Navigate to workflows list
    await page.goto('/workflows');
    await expect(page.locator('text=Workflow to Delete')).toBeVisible();
    
    // Attempt to delete
    const workflowRow = page.locator('tr:has-text("Workflow to Delete")');
    await workflowRow.locator('button:has-text("Delete")').click();
    
    // Confirm deletion in modal
    await expect(page.locator('.modal')).toBeVisible();
    await expect(page.locator('.modal')).toContainText('Are you sure');
    await page.click('button:has-text("Confirm Delete")');
    
    // Verify workflow was deleted
    await expect(page.locator('.toast-success')).toContainText('Workflow deleted');
    await expect(page.locator('text=Workflow to Delete')).not.toBeVisible();
  });

  test('should validate workflow configuration before saving', async ({ page }) => {
    await page.click('text=Create Workflow');
    
    // Try to save without required fields
    await page.click('button:has-text("Save Workflow")');
    
    // Verify validation errors
    await expect(page.locator('.error-message')).toContainText('Workflow name is required');
    
    // Fill name but leave description empty
    await page.fill('input[name="name"]', 'Test Workflow');
    await page.click('button:has-text("Save Workflow")');
    
    // Try to save without any nodes
    await expect(page.locator('.error-message')).toContainText('At least one node is required');
    
    // Add a node but don't configure it
    await page.click('button:has-text("Add Agent Node")');
    const agentNode = page.locator('.workflow-node').first();
    await agentNode.click();
    await page.click('button:has-text("Save Workflow")');
    
    // Verify agent configuration validation
    await expect(page.locator('.error-message')).toContainText('Agent name is required');
    
    // Properly configure the workflow
    await page.fill('input[data-testid="agent-name"]', 'Valid Agent');
    await page.selectOption('select[data-testid="agent-model"]', 'granite-3.3');
    await page.selectOption('select[data-testid="agent-provider"]', 'local');
    
    await page.click('button:has-text("Save Workflow")');
    await expect(page.locator('.toast-success')).toBeVisible();
  });
});