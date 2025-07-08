#!/usr/bin/env node

// Test llama.cpp integration with the new Next.js setup
const { GraniteAgent } = require('./new/src/lib/agents/granite-agent.js');

async function testLlamaIntegration() {
  console.log('🧪 Testing llama.cpp Integration with New Next.js Setup...');
  
  try {
    // Test agent configuration
    const agentConfig = {
      id: 'test-agent',
      name: 'Test Agent', 
      description: 'Test agent for llama.cpp integration',
      model: '/Users/marshallbelles/llama.cpp/models/granite-3.3-2b-instruct-q4_k_m.gguf',
      systemPrompt: `You are an AI assistant. You must respond with valid JSON containing exactly these fields:
- reasoning: your analysis thoughts (string)
- tool_calls: ALWAYS empty array [] (no tools available)
- next_steps: your conclusions (string)
- status: "completed" when done (string)

IMPORTANT: Keep responses concise and ensure valid JSON format.`,
      availableTools: [],
      level: 0
    };

    // Model configuration for llama.cpp
    const modelConfig = {
      provider: 'granite',
      config: {
        baseUrl: 'http://localhost:8080',
        model: '/Users/marshallbelles/llama.cpp/models/granite-3.3-2b-instruct-q4_k_m.gguf',
        maxTokens: 512,
        temperature: 0.1
      }
    };

    console.log('📡 Creating Granite agent...');
    const agent = new GraniteAgent(agentConfig, modelConfig);

    console.log('🚀 Testing agent execution...');
    const startTime = Date.now();
    
    const result = await agent.execute(
      { 
        task: 'Simple test',
        message: 'Hello! Please confirm you are working correctly.'
      }, 
      'Please respond with a simple confirmation that you are working correctly.'
    );
    
    const executionTime = Date.now() - startTime;
    
    console.log('✅ Agent execution completed!');
    console.log(`⏱️  Execution time: ${executionTime}ms`);
    console.log('📝 Response:');
    console.log('   Reasoning:', result.reasoning);
    console.log('   Status:', result.status);
    console.log('   Next Steps:', result.next_steps);
    console.log('   Tool Calls:', result.tool_calls.length);
    
    if (result.tokensUsed) {
      console.log('🔢 Tokens used:', result.tokensUsed);
    }

    // Validate response format
    if (result.reasoning && result.status && result.next_steps && Array.isArray(result.tool_calls)) {
      console.log('🎉 llama.cpp integration test PASSED!');
      console.log('✨ The new Next.js setup is working correctly with Granite 3.3');
      return true;
    } else {
      console.log('❌ llama.cpp integration test FAILED - Invalid response format');
      return false;
    }
    
  } catch (error) {
    console.error('💥 llama.cpp integration test FAILED:', error.message);
    
    if (error.message.includes('ECONNREFUSED') || error.message.includes('fetch')) {
      console.log('💡 Make sure llama.cpp server is running:');
      console.log('   ./llama-server --model /Users/marshallbelles/llama.cpp/models/granite-3.3-2b-instruct-q4_k_m.gguf --port 8080');
    }
    
    return false;
  }
}

// Run the test
testLlamaIntegration()
  .then(success => {
    console.log('\n' + '='.repeat(60));
    if (success) {
      console.log('🎯 RESULT: llama.cpp integration is working perfectly!');
      console.log('🚀 The Arbiter platform is ready for use with your local AI model.');
    } else {
      console.log('⚠️  RESULT: llama.cpp integration needs attention.');
      console.log('🔧 Check the error messages above for troubleshooting steps.');
    }
    console.log('='.repeat(60));
    process.exit(success ? 0 : 1);
  })
  .catch(error => {
    console.error('💥 Test script failed:', error.message);
    process.exit(1);
  });