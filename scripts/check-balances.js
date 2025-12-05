/**
 * Script to check database balances
 * Shows all users, their wallet balances, and liquidity pool balance
 */

import pkg from 'pg';
const { Pool } = pkg;
import { ENV } from '../config/env.js';
import dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({
  connectionString: ENV.DATABASE_URL,
  ssl: ENV.NODE_ENV === 'production' 
    ? { rejectUnauthorized: false } 
    : false
});

async function checkBalances() {
  const client = await pool.connect();
  
  try {
    console.log('\n📊 DATABASE BALANCE REPORT\n');
    console.log('=' .repeat(60));
    
    // Get all users with their wallet balances
    console.log('\n👥 USER WALLETS:');
    console.log('-'.repeat(60));
    const usersResult = await client.query(`
      SELECT 
        u.user_id,
        COALESCE(w.balance, 0) as balance,
        u.stripe_account_id,
        u.stripe_account_status,
        u.created_at
      FROM users u
      LEFT JOIN user_wallet w ON u.user_id = w.user_id
      ORDER BY w.balance DESC NULLS LAST
    `);
    
    if (usersResult.rows.length === 0) {
      console.log('No users found in database.');
    } else {
      let totalUserBalance = 0;
      usersResult.rows.forEach((user, index) => {
        const balance = parseFloat(user.balance || 0);
        totalUserBalance += balance;
        console.log(`\n${index + 1}. User: ${user.user_id}`);
        console.log(`   Balance: $${balance.toFixed(2)}`);
        console.log(`   Stripe Account: ${user.stripe_account_id || 'Not connected'}`);
        console.log(`   Status: ${user.stripe_account_status || 'N/A'}`);
        console.log(`   Created: ${user.created_at ? new Date(user.created_at).toLocaleString() : 'N/A'}`);
      });
      console.log(`\n   Total User Balances: $${totalUserBalance.toFixed(2)}`);
    }
    
    // Get liquidity pool balance
    console.log('\n\n💰 PLATFORM LIQUIDITY POOL:');
    console.log('-'.repeat(60));
    const poolResult = await client.query(`
      SELECT balance, description, updated_at
      FROM platform_liquidity_pool
      WHERE id = 1
    `);
    
    if (poolResult.rows.length === 0) {
      console.log('Liquidity pool not initialized.');
    } else {
      const pool = poolResult.rows[0];
      const poolBalance = parseFloat(pool.balance || 0);
      console.log(`Balance: $${poolBalance.toFixed(2)}`);
      console.log(`Description: ${pool.description || 'N/A'}`);
      console.log(`Last Updated: ${pool.updated_at ? new Date(pool.updated_at).toLocaleString() : 'N/A'}`);
      
      if (poolBalance > 0) {
        console.log(`\n✅ Platform has $${poolBalance.toFixed(2)} in liquidity pool (from losing parlays)`);
      } else if (poolBalance < 0) {
        console.log(`\n⚠️  Platform owes $${Math.abs(poolBalance).toFixed(2)} (from winning parlays)`);
      } else {
        console.log(`\n⚖️  Liquidity pool is balanced`);
      }
    }
    
    // Get total pending withdrawals
    console.log('\n\n💸 PENDING WITHDRAWALS:');
    console.log('-'.repeat(60));
    // Check if stripe_transfer_id column exists
    const columnCheck = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'withdrawal_requests' 
      AND column_name = 'stripe_transfer_id'
    `);
    
    const hasTransferId = columnCheck.rows.length > 0;
    const transferIdColumn = hasTransferId ? 'stripe_transfer_id,' : '';
    
    const withdrawalsResult = await client.query(`
      SELECT 
        user_id,
        amount,
        status,
        payment_method,
        ${transferIdColumn}
        stripe_payout_id,
        created_at
      FROM withdrawal_requests
      WHERE status = 'pending'
      ORDER BY created_at DESC
    `);
    
    if (withdrawalsResult.rows.length === 0) {
      console.log('No pending withdrawals.');
    } else {
      let totalPending = 0;
      withdrawalsResult.rows.forEach((withdrawal, index) => {
        const amount = parseFloat(withdrawal.amount || 0);
        totalPending += amount;
        console.log(`\n${index + 1}. User: ${withdrawal.user_id}`);
        console.log(`   Amount: $${amount.toFixed(2)}`);
        console.log(`   Status: ${withdrawal.status}`);
        if (hasTransferId) {
          console.log(`   Transfer ID: ${withdrawal.stripe_transfer_id || 'N/A'}`);
        }
        console.log(`   Payout ID: ${withdrawal.stripe_payout_id || 'N/A'}`);
        console.log(`   Created: ${withdrawal.created_at ? new Date(withdrawal.created_at).toLocaleString() : 'N/A'}`);
      });
      console.log(`\n   Total Pending: $${totalPending.toFixed(2)}`);
    }
    
    // Summary
    console.log('\n\n📈 SUMMARY:');
    console.log('='.repeat(60));
    const totalUsers = usersResult.rows.length;
    const totalUserBalance = usersResult.rows.reduce((sum, u) => sum + parseFloat(u.balance || 0), 0);
    const poolBalance = poolResult.rows.length > 0 ? parseFloat(poolResult.rows[0].balance || 0) : 0;
    const totalPending = withdrawalsResult.rows.reduce((sum, w) => sum + parseFloat(w.amount || 0), 0);
    
    console.log(`Total Users: ${totalUsers}`);
    console.log(`Total User Wallet Balances: $${totalUserBalance.toFixed(2)}`);
    console.log(`Platform Liquidity Pool: $${poolBalance.toFixed(2)}`);
    console.log(`Pending Withdrawals: $${totalPending.toFixed(2)}`);
    console.log(`Net Platform Position: $${(poolBalance - totalPending).toFixed(2)}`);
    
    console.log('\n' + '='.repeat(60) + '\n');
    
  } catch (err) {
    console.error('Error checking balances:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

checkBalances().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

