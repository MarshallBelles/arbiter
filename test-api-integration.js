#!/usr/bin/env node

// Test API integration with the new Next.js setup
const http = require('http');

async function makeRequest(path, method = 'GET', data = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 3000,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json',
      }
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        try {
          const jsonData = JSON.parse(body);
          resolve({ status: res.statusCode, data: jsonData });
        } catch (e) {
          resolve({ status: res.statusCode, data: body });
        }
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    if (data) {
      req.write(JSON.stringify(data));
    }

    req.end();
  });
}

async function testAPIIntegration() {
  console.log('🧪 Testing API Integration with New Next.js Setup...');
  
  try {
    // Test health endpoint
    console.log('📡 Testing health endpoint...');
    const healthResponse = await makeRequest('/api/health');
    
    if (healthResponse.status === 200) {
      console.log('✅ Health endpoint working!');
      console.log('   Status:', healthResponse.data.status);
      console.log('   Version:', healthResponse.data.version);
    } else {
      console.log('❌ Health endpoint failed:', healthResponse.status);
      return false;
    }

    // Test ping endpoint
    console.log('📡 Testing ping endpoint...');
    const pingResponse = await makeRequest('/api/health/ping');
    
    if (pingResponse.status === 200 && pingResponse.data.message === 'pong') {
      console.log('✅ Ping endpoint working!');
    } else {
      console.log('❌ Ping endpoint failed:', pingResponse.status);
      return false;
    }

    // Test workflows endpoint
    console.log('📡 Testing workflows endpoint...');
    const workflowsResponse = await makeRequest('/api/workflows');
    
    if (workflowsResponse.status === 200) {
      console.log('✅ Workflows endpoint working!');
      console.log('   Total workflows:', workflowsResponse.data.pagination?.total || 0);
    } else {
      console.log('❌ Workflows endpoint failed:', workflowsResponse.status);
      return false;
    }

    // Test agents endpoint
    console.log('📡 Testing agents endpoint...');
    const agentsResponse = await makeRequest('/api/agents');
    
    if (agentsResponse.status === 200) {
      console.log('✅ Agents endpoint working!');
      console.log('   Total agents:', agentsResponse.data.pagination?.total || 0);
    } else {
      console.log('❌ Agents endpoint failed:', agentsResponse.status);
      return false;
    }

    console.log('🎉 All API endpoints are working correctly!');
    return true;
    
  } catch (error) {
    console.error('💥 API integration test FAILED:', error.message);
    
    if (error.code === 'ECONNREFUSED') {
      console.log('💡 Make sure the Next.js development server is running:');
      console.log('   cd new && npm run dev');
    }
    
    return false;
  }
}

// Run the test
testAPIIntegration()
  .then(success => {
    console.log('\n' + '='.repeat(60));
    if (success) {
      console.log('🎯 RESULT: API integration is working perfectly!');
      console.log('🚀 The Arbiter Next.js platform is ready for use!');
      console.log('📱 Open http://localhost:3000 to access the dashboard');
    } else {
      console.log('⚠️  RESULT: API integration needs attention.');
      console.log('🔧 Check the error messages above for troubleshooting steps.');
    }
    console.log('='.repeat(60));
    process.exit(success ? 0 : 1);
  })
  .catch(error => {
    console.error('💥 Test script failed:', error.message);
    process.exit(1);
  });