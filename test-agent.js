#!/usr/bin/env node

// Simple test script to validate llama.cpp agent functionality
// This tests the core agent creation and execution without the full API server

import { GraniteAgent } from './packages/agent-runtime/dist/agent-runtime/src/granite-agent.js';

async function testLlamaAgent() {
  console.log('🔍 Testing Arbiter Agent with llama.cpp...');
  
  // Create agent configuration for llama.cpp
  const agentConfig = {
    id: 'test-llama-agent',
    name: 'Test Llama Agent',
    description: 'A test agent using llama.cpp locally',
    model: '/Users/marshallbelles/llama.cpp/models/granite-3.3-2b-instruct-q4_k_m.gguf',
    systemPrompt: 'You are a helpful AI assistant. Please respond with JSON formatted output containing your reasoning, any tool_calls (empty array if none), next_steps, and status.',
    availableTools: [],
    level: 0
  };

  // Create model provider configuration for llama.cpp
  const modelConfig = {
    provider: 'granite',
    config: {
      baseUrl: 'http://localhost:8080',
      model: '/Users/marshallbelles/llama.cpp/models/granite-3.3-2b-instruct-q4_k_m.gguf',
      maxTokens: 2048,
      temperature: 0.7
    }
  };

  try {
    // Test 1: Create agent instance
    console.log('📝 Test 1: Creating agent instance...');
    const agent = new GraniteAgent(agentConfig, modelConfig);
    console.log('✅ Agent created successfully');

    // Test 2: Execute simple task
    console.log('📝 Test 2: Testing basic agent execution...');
    const testInput = {
      task: 'Hello! Please respond with a brief JSON-formatted response that includes your reasoning.'
    };
    
    const result = await agent.execute(testInput, 'Test user prompt');
    
    console.log('✅ Agent execution completed');
    console.log('📊 Result:', JSON.stringify(result, null, 2));
    
    // Test 3: Validate response format
    console.log('📝 Test 3: Validating response format...');
    if (result.reasoning && result.status) {
      console.log('✅ Response format is valid');
    } else {
      console.log('❌ Response format is invalid:', {
        hasReasoning: !!result.reasoning,
        hasStatus: !!result.status
      });
    }

    return result;
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error('Stack:', error.stack);
    throw error;
  }
}

// Run the test
testLlamaAgent()
  .then(() => {
    console.log('🎉 All tests completed successfully!');
    process.exit(0);
  })
  .catch(error => {
    console.error('💥 Test suite failed:', error.message);
    process.exit(1);
  });