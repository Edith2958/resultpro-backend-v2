const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL || 'postgresql://resultpro_v2_db_user:kSxVRFn75m9CNF1oOa8h3FDY1yA3fKls@dpg-db8rhqs9v7es73dkk380-a.frankfurt-postgres.render.com/resultpro_v2_db';

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

async function migrate() {
  try {
    console.log('Connecting to cloud database...');
    
    // Drop the obsolete 'name' column if it still exists
    await pool.query(`
      ALTER TABLE students DROP COLUMN IF EXISTS name;
    `);
    console.log('Legacy "name" column dropped successfully.');

    console.log('Database migration completed successfully!');
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }
}

migrate();