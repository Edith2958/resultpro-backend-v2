// Load local .env variables if available
require('dotenv').config();

const { Pool } = require('pg');

// Use the DATABASE_URL from your environment or fallback to your local config
const pool = new Pool(
  process.env.DATABASE_URL
    ? {
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false },
      }
    : {
        host: process.env.DB_HOST || 'localhost',
        port: process.env.DB_PORT || 5432,
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'resultpro',
      }
);

async function runMigration() {
  try {
    console.log('Connecting to database...');
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS school_settings (
        id SERIAL PRIMARY KEY,
        school_name VARCHAR(255) NOT NULL DEFAULT 'My School',
        school_address TEXT,
        school_phone VARCHAR(50),
        school_email VARCHAR(150),
        logo_url TEXT,
        motto VARCHAR(255),
        updated_at TIMESTAMP DEFAULT NOW()
      );

      INSERT INTO school_settings (id, school_name)
      VALUES (1, 'ResultPro Academy')
      ON CONFLICT (id) DO NOTHING;
    `);

    console.log('✅ School settings table created successfully!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    process.exit(1);
  }
}

runMigration();