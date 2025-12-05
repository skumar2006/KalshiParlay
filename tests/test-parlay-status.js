/**
 * Quick test script for parlay status
 * Usage: node tests/test-parlay-status.js <sessionId> <action>
 * Actions: won, lost, reset
 */

import fetch from 'node-fetch';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:4000';
const sessionId = process.argv[2];
const action = process.argv[3];

if (!sessionId || !action) {
  console.log('Usage: node tests/test-parlay-status.js <sessionId> <won|lost|reset>');
  console.log('\nExample:');
  console.log('  node tests/test-parlay-status.js cs_test_123 won');
  console.log('  node tests/test-parlay-status.js cs_test_123 lost');
  console.log('  node tests/test-parlay-status.js cs_test_123 reset');
  process.exit(1);
}

async function test() {
  try {
    let endpoint;
    let options = { method: 'POST' };
    
    if (action === 'won') {
      endpoint = `${BACKEND_URL}/api/test/set-all-legs-won/${sessionId}`;
      console.log(`🎯 Setting all legs to WON for parlay: ${sessionId}`);
    } else if (action === 'lost') {
      endpoint = `${BACKEND_URL}/api/test/set-all-legs-lost/${sessionId}`;
      console.log(`🎯 Setting parlay to LOST: ${sessionId}`);
    } else if (action === 'reset') {
      endpoint = `${BACKEND_URL}/api/test/set-parlay-status/${sessionId}`;
      options.headers = { 'Content-Type': 'application/json' };
      options.body = JSON.stringify({ status: 'pending', claimableAmount: 0 });
      console.log(`🎯 Resetting parlay to PENDING: ${sessionId}`);
    } else {
      console.error('❌ Invalid action. Use: won, lost, or reset');
      process.exit(1);
    }
    
    const res = await fetch(endpoint, options);
    const data = await res.json();
    
    if (res.ok) {
      console.log('✅', data.message || 'Success');
    } else {
      console.error('❌ Error:', data.error || data.message);
      process.exit(1);
    }
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
}

test();

