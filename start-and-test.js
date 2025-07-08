#!/usr/bin/env node

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

let serverProcess = null;

function startServer() {
  return new Promise((resolve, reject) => {
    console.log('🚀 Starting Next.js development server...');
    
    serverProcess = spawn('npm', ['run', 'dev'], {
      cwd: path.join(__dirname, 'new'),
      stdio: 'pipe'
    });

    let serverReady = false;

    serverProcess.stdout.on('data', (data) => {
      const output = data.toString();
      console.log('Server:', output.trim());
      
      if (output.includes('Ready in') && !serverReady) {
        serverReady = true;
        console.log('✅ Server is ready!');
        resolve();
      }
    });

    serverProcess.stderr.on('data', (data) => {
      console.error('Server Error:', data.toString());
    });

    serverProcess.on('error', (error) => {
      reject(error);
    });

    // Timeout after 30 seconds
    setTimeout(() => {
      if (!serverReady) {
        reject(new Error('Server startup timeout'));
      }
    }, 30000);
  });
}

async function testHealthEndpoint() {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 3000,
      path: '/api/health',
      method: 'GET',
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

    req.end();
  });
}

async function main() {
  try {
    await startServer();
    
    // Wait a bit for the server to fully initialize
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    console.log('🧪 Testing health endpoint...');
    const response = await testHealthEndpoint();
    
    console.log('Response status:', response.status);
    console.log('Response data:', response.data);
    
    if (response.status === 200) {
      console.log('🎉 SUCCESS: Next.js application is working!');
      console.log('📱 You can now access the dashboard at http://localhost:3000');
    } else {
      console.log('❌ FAILED: Health endpoint returned status', response.status);
    }
    
  } catch (error) {
    console.error('💥 Test failed:', error.message);
  } finally {
    if (serverProcess) {
      console.log('🛑 Stopping server...');
      serverProcess.kill();
    }
    process.exit(0);
  }
}

main();