import { test, expect } from '@playwright/test';

test.describe('Agent Management', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1')).toContainText('Dashboard');
  });

  test('should create a new agent with all configurations', async ({ page }) => {
    // Navigate to agents page
    await page.click('a[href="/agents"]');
    await expect(page).toHaveURL('/agents');
    await expect(page.locator('h1')).toContainText('Agents');

    // Click create new agent
    await page.click('button:has-text("Create Agent")');
    
    // Verify agent creation form
    await expect(page.locator('.agent-form')).toBeVisible();
    await expect(page.locator('h2')).toContainText('Create New Agent');

    // Fill basic agent information
    await page.fill('input[name="name"]', 'E2E Test Agent');
    await page.fill('textarea[name="description"]', 'An agent created by end-to-end tests for validation');
    
    // Configure model settings
    await page.selectOption('select[name="model"]', 'granite-3.3');
    await page.selectOption('select[name="provider"]', 'local');
    
    // Configure advanced settings
    await page.fill('input[name="temperature"]', '0.7');
    await page.fill('input[name="maxTokens"]', '2048');
    await page.fill('input[name="topP"]', '0.9');
    
    // Select tools
    await page.check('input[name="tools"][value="calculator"]');
    await page.check('input[name="tools"][value="web_search"]');
    await page.check('input[name="tools"][value="file_operations"]');
    
    // Add custom system prompt
    await page.fill('textarea[name="systemPrompt"]', 
      'You are a helpful AI assistant designed for testing purposes. Always provide accurate and helpful responses.'
    );
    
    // Set memory configuration
    await page.fill('input[name="memorySize"]', '1000');
    await page.check('input[name="persistMemory"]');
    
    // Save the agent
    await page.click('button:has-text("Create Agent")');
    
    // Verify success notification
    await expect(page.locator('.toast-success')).toBeVisible();
    await expect(page.locator('.toast-success')).toContainText('Agent created successfully');
    
    // Verify redirect back to agents list
    await expect(page).toHaveURL('/agents');
    
    // Verify agent appears in the list
    await expect(page.locator('text=E2E Test Agent')).toBeVisible();
    
    // Verify agent card contains correct information
    const agentCard = page.locator('.agent-card:has-text("E2E Test Agent")');
    await expect(agentCard.locator('.agent-model')).toContainText('granite-3.3');
    await expect(agentCard.locator('.agent-provider')).toContainText('local');
    await expect(agentCard.locator('.agent-tools')).toContainText('calculator');
    await expect(agentCard.locator('.agent-tools')).toContainText('web_search');
  });

  test('should edit existing agent configuration', async ({ page }) => {
    // First create an agent to edit
    await page.goto('/agents');
    await page.click('button:has-text("Create Agent")');
    
    await page.fill('input[name="name"]', 'Agent to Edit');
    await page.fill('textarea[name="description"]', 'Original description');
    await page.selectOption('select[name="model"]', 'granite-3.3');
    await page.selectOption('select[name="provider"]', 'local');
    await page.check('input[name="tools"][value="calculator"]');
    
    await page.click('button:has-text("Create Agent")');
    await expect(page.locator('.toast-success')).toBeVisible();
    
    // Now edit the agent
    const agentCard = page.locator('.agent-card:has-text("Agent to Edit")');
    await agentCard.locator('button:has-text("Edit")').click();
    
    // Verify edit form loaded with existing data
    await expect(page.locator('.agent-form h2')).toContainText('Edit Agent');
    await expect(page.locator('input[name="name"]')).toHaveValue('Agent to Edit');
    
    // Modify agent properties
    await page.fill('input[name="name"]', 'Updated Agent Name');
    await page.fill('textarea[name="description"]', 'Updated description with more details');
    await page.selectOption('select[name="model"]', 'gpt-4');
    await page.selectOption('select[name="provider"]', 'openai');
    
    // Change temperature
    await page.fill('input[name="temperature"]', '0.5');
    
    // Add more tools
    await page.check('input[name="tools"][value="web_search"]');
    await page.check('input[name="tools"][value="file_operations"]');
    
    // Update system prompt
    await page.fill('textarea[name="systemPrompt"]', 'Updated system prompt for better performance');
    
    // Save changes
    await page.click('button:has-text("Save Changes")');
    
    // Verify success
    await expect(page.locator('.toast-success')).toContainText('Agent updated successfully');
    
    // Verify changes are reflected in the list
    await expect(page.locator('text=Updated Agent Name')).toBeVisible();
    const updatedCard = page.locator('.agent-card:has-text("Updated Agent Name")');
    await expect(updatedCard.locator('.agent-model')).toContainText('gpt-4');
    await expect(updatedCard.locator('.agent-provider')).toContainText('openai');
  });

  test('should test agent functionality', async ({ page }) => {
    // Create a test agent
    await page.goto('/agents');
    await page.click('button:has-text("Create Agent")');
    
    await page.fill('input[name="name"]', 'Test Agent');
    await page.fill('textarea[name="description"]', 'Agent for testing functionality');
    await page.selectOption('select[name="model"]', 'granite-3.3');
    await page.selectOption('select[name="provider"]', 'local');
    await page.check('input[name="tools"][value="calculator"]');
    
    await page.click('button:has-text("Create Agent")');
    await expect(page.locator('.toast-success')).toBeVisible();
    
    // Test the agent
    const agentCard = page.locator('.agent-card:has-text("Test Agent")');
    await agentCard.locator('button:has-text("Test")').click();
    
    // Verify test modal opened
    await expect(page.locator('.test-modal')).toBeVisible();
    await expect(page.locator('.test-modal h2')).toContainText('Test Agent');
    
    // Enter test prompt
    await page.fill('textarea[data-testid="test-prompt"]', 'Calculate 15 + 27 and explain the calculation');
    
    // Submit test
    await page.click('button:has-text("Run Test")');
    
    // Verify test is running
    await expect(page.locator('.test-status')).toContainText('Running');
    
    // Wait for test completion
    await expect(page.locator('.test-status')).toContainText('Completed', { timeout: 30000 });
    
    // Verify test results
    const testResults = page.locator('.test-results');
    await expect(testResults).toBeVisible();
    await expect(testResults).toContainText('42'); // Expected calculation result
    
    // Check execution details
    await expect(page.locator('.test-metadata')).toBeVisible();
    await expect(page.locator('.test-metadata')).toContainText('Duration:');
    await expect(page.locator('.test-metadata')).toContainText('Tokens used:');
    
    // Close test modal
    await page.click('button:has-text("Close")');
    await expect(page.locator('.test-modal')).not.toBeVisible();
  });

  test('should clone an existing agent', async ({ page }) => {
    // Create an agent to clone
    await page.goto('/agents');
    await page.click('button:has-text("Create Agent")');
    
    await page.fill('input[name="name"]', 'Original Agent');
    await page.fill('textarea[name="description"]', 'Agent to be cloned');
    await page.selectOption('select[name="model"]', 'granite-3.3');
    await page.selectOption('select[name="provider"]', 'local');
    await page.check('input[name="tools"][value="calculator"]');
    await page.check('input[name="tools"][value="web_search"]');
    await page.fill('input[name="temperature"]', '0.8');
    
    await page.click('button:has-text("Create Agent")');
    await expect(page.locator('.toast-success')).toBeVisible();
    
    // Clone the agent
    const agentCard = page.locator('.agent-card:has-text("Original Agent")');
    await agentCard.locator('button:has-text("Clone")').click();
    
    // Verify clone form pre-filled
    await expect(page.locator('.agent-form h2')).toContainText('Clone Agent');
    await expect(page.locator('input[name="name"]')).toHaveValue('Original Agent (Copy)');
    await expect(page.locator('textarea[name="description"]')).toContainText('Agent to be cloned');
    await expect(page.locator('select[name="model"]')).toHaveValue('granite-3.3');
    await expect(page.locator('input[name="temperature"]')).toHaveValue('0.8');
    
    // Modify the clone
    await page.fill('input[name="name"]', 'Cloned Agent');
    await page.fill('textarea[name="description"]', 'This is a cloned agent with modifications');
    
    // Save the clone
    await page.click('button:has-text("Create Agent")');
    await expect(page.locator('.toast-success')).toContainText('Agent created successfully');
    
    // Verify both agents exist
    await expect(page.locator('text=Original Agent')).toBeVisible();
    await expect(page.locator('text=Cloned Agent')).toBeVisible();
    
    // Verify they have similar but distinct configurations
    const originalCard = page.locator('.agent-card:has-text("Original Agent")');
    const clonedCard = page.locator('.agent-card:has-text("Cloned Agent")');
    
    await expect(originalCard.locator('.agent-model')).toContainText('granite-3.3');
    await expect(clonedCard.locator('.agent-model')).toContainText('granite-3.3');
  });

  test('should delete agent with confirmation', async ({ page }) => {
    // Create an agent to delete
    await page.goto('/agents');
    await page.click('button:has-text("Create Agent")');
    
    await page.fill('input[name="name"]', 'Agent to Delete');
    await page.fill('textarea[name="description"]', 'This agent will be deleted');
    await page.selectOption('select[name="model"]', 'granite-3.3');
    await page.selectOption('select[name="provider"]', 'local');
    
    await page.click('button:has-text("Create Agent")');
    await expect(page.locator('.toast-success')).toBeVisible();
    
    // Delete the agent
    const agentCard = page.locator('.agent-card:has-text("Agent to Delete")');
    await agentCard.locator('button:has-text("Delete")').click();
    
    // Verify confirmation modal
    await expect(page.locator('.confirmation-modal')).toBeVisible();
    await expect(page.locator('.confirmation-modal')).toContainText('Are you sure you want to delete this agent?');
    await expect(page.locator('.confirmation-modal')).toContainText('Agent to Delete');
    
    // Confirm deletion
    await page.click('button:has-text("Delete Agent")');
    
    // Verify success
    await expect(page.locator('.toast-success')).toContainText('Agent deleted successfully');
    
    // Verify agent is no longer in the list
    await expect(page.locator('text=Agent to Delete')).not.toBeVisible();
  });

  test('should validate agent configuration', async ({ page }) => {
    await page.goto('/agents');
    await page.click('button:has-text("Create Agent")');
    
    // Try to save without required fields
    await page.click('button:has-text("Create Agent")');
    
    // Verify validation errors
    await expect(page.locator('.error-message')).toContainText('Agent name is required');
    
    // Fill name but leave other required fields
    await page.fill('input[name="name"]', 'Test Agent');
    await page.click('button:has-text("Create Agent")');
    
    await expect(page.locator('.error-message')).toContainText('Model selection is required');
    
    // Select model but leave provider
    await page.selectOption('select[name="model"]', 'granite-3.3');
    await page.click('button:has-text("Create Agent")');
    
    await expect(page.locator('.error-message')).toContainText('Provider selection is required');
    
    // Test invalid temperature values
    await page.selectOption('select[name="provider"]', 'local');
    await page.fill('input[name="temperature"]', '2.0'); // Invalid: > 1.0
    await page.click('button:has-text("Create Agent")');
    
    await expect(page.locator('.error-message')).toContainText('Temperature must be between 0.0 and 1.0');
    
    // Fix temperature and test invalid maxTokens
    await page.fill('input[name="temperature"]', '0.7');
    await page.fill('input[name="maxTokens"]', '-100'); // Invalid: negative
    await page.click('button:has-text("Create Agent")');
    
    await expect(page.locator('.error-message')).toContainText('Max tokens must be a positive number');
    
    // Fix all validation issues
    await page.fill('input[name="maxTokens"]', '2048');
    await page.click('button:has-text("Create Agent")');
    
    await expect(page.locator('.toast-success')).toBeVisible();
  });

  test('should filter and search agents', async ({ page }) => {
    // Create multiple agents for testing filters
    await page.goto('/agents');
    
    // Create first agent
    await page.click('button:has-text("Create Agent")');
    await page.fill('input[name="name"]', 'Calculator Agent');
    await page.fill('textarea[name="description"]', 'Specialized in mathematical calculations');
    await page.selectOption('select[name="model"]', 'granite-3.3');
    await page.selectOption('select[name="provider"]', 'local');
    await page.check('input[name="tools"][value="calculator"]');
    await page.click('button:has-text("Create Agent")');
    await expect(page.locator('.toast-success')).toBeVisible();
    
    // Create second agent
    await page.click('button:has-text("Create Agent")');
    await page.fill('input[name="name"]', 'Web Research Agent');
    await page.fill('textarea[name="description"]', 'Specialized in web research and information gathering');
    await page.selectOption('select[name="model"]', 'gpt-4');
    await page.selectOption('select[name="provider"]', 'openai');
    await page.check('input[name="tools"][value="web_search"]');
    await page.click('button:has-text("Create Agent")');
    await expect(page.locator('.toast-success')).toBeVisible();
    
    // Test search functionality
    await page.fill('input[data-testid="agent-search"]', 'Calculator');
    await page.waitForTimeout(500);
    
    await expect(page.locator('.agent-card:has-text("Calculator Agent")')).toBeVisible();
    await expect(page.locator('.agent-card:has-text("Web Research Agent")')).not.toBeVisible();
    
    // Clear search
    await page.fill('input[data-testid="agent-search"]', '');
    await page.waitForTimeout(500);
    
    // Test model filter
    await page.selectOption('select[data-testid="model-filter"]', 'granite-3.3');
    await page.waitForTimeout(500);
    
    await expect(page.locator('.agent-card:has-text("Calculator Agent")')).toBeVisible();
    await expect(page.locator('.agent-card:has-text("Web Research Agent")')).not.toBeVisible();
    
    // Test provider filter
    await page.selectOption('select[data-testid="model-filter"]', ''); // Clear model filter
    await page.selectOption('select[data-testid="provider-filter"]', 'openai');
    await page.waitForTimeout(500);
    
    await expect(page.locator('.agent-card:has-text("Calculator Agent")')).not.toBeVisible();
    await expect(page.locator('.agent-card:has-text("Web Research Agent")')).toBeVisible();
    
    // Clear all filters
    await page.selectOption('select[data-testid="provider-filter"]', '');
    await page.waitForTimeout(500);
    
    await expect(page.locator('.agent-card:has-text("Calculator Agent")')).toBeVisible();
    await expect(page.locator('.agent-card:has-text("Web Research Agent")')).toBeVisible();
  });

  test('should display agent usage statistics', async ({ page }) => {
    // Create an agent and use it in a workflow
    await page.goto('/agents');
    await page.click('button:has-text("Create Agent")');
    
    await page.fill('input[name="name"]', 'Statistics Agent');
    await page.selectOption('select[name="model"]', 'granite-3.3');
    await page.selectOption('select[name="provider"]', 'local');
    await page.check('input[name="tools"][value="calculator"]');
    
    await page.click('button:has-text("Create Agent")');
    await expect(page.locator('.toast-success')).toBeVisible();
    
    // View agent details
    const agentCard = page.locator('.agent-card:has-text("Statistics Agent")');
    await agentCard.click();
    
    // Verify agent details modal
    await expect(page.locator('.agent-details-modal')).toBeVisible();
    await expect(page.locator('.agent-details-modal h2')).toContainText('Agent Details');
    
    // Check statistics section
    const statsSection = page.locator('.agent-statistics');
    await expect(statsSection).toBeVisible();
    
    await expect(statsSection.locator('text=Total Executions')).toBeVisible();
    await expect(statsSection.locator('text=Success Rate')).toBeVisible();
    await expect(statsSection.locator('text=Average Duration')).toBeVisible();
    await expect(statsSection.locator('text=Total Tokens Used')).toBeVisible();
    
    // Verify recent executions list
    await expect(page.locator('.recent-executions')).toBeVisible();
    await expect(page.locator('.recent-executions h3')).toContainText('Recent Executions');
    
    // Close modal
    await page.click('button:has-text("Close")');
    await expect(page.locator('.agent-details-modal')).not.toBeVisible();
  });
});