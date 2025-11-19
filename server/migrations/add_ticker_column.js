import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false // Local database doesn't need SSL
});

async function migrate() {
  const client = await pool.connect();
  
  try {
    console.log('🔧 Adding ticker column to parlay_bets table...');
    
    // Check if column already exists
    const checkColumn = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name='parlay_bets' AND column_name='ticker';
    `);
    
    if (checkColumn.rows.length > 0) {
      console.log('✅ Column "ticker" already exists');
    } else {
      // Add ticker column
      await client.query(`
        ALTER TABLE parlay_bets 
        ADD COLUMN ticker VARCHAR(255);
      `);
      
      console.log('✅ Added "ticker" column to parlay_bets table');
    }
    
    console.log('🎉 Migration complete!');
  } catch (err) {
    console.error('❌ Migration failed:', err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch(err => {
  console.error(err);
  process.exit(1);
});

