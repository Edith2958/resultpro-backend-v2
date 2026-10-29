const { Pool } = require('pg');

// Paste your Render External Database URL directly here:
const connectionString = process.env.DATABASE_URL || 'postgresql://resultpro_v2_db_user:kSxVRFn75m9CNF1oOa8h3FDY1yA3fKls@dpg-db8rhqs9v7es73dkk380-a.frankfurt-postgres.render.com/resultpro_v2_db';

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false }, // Required for cloud databases like Render/Neon
});

async function migrate() {
  try {
    console.log('Connecting to cloud database...');
    
    // 1. Add the new name columns
    await pool.query(`
      ALTER TABLE students ADD COLUMN IF NOT EXISTS surname VARCHAR(150);
      ALTER TABLE students ADD COLUMN IF NOT EXISTS first_name VARCHAR(150);
      ALTER TABLE students ADD COLUMN IF NOT EXISTS middle_name VARCHAR(150);
    `);
    console.log('Columns added successfully.');

    // 2. Split legacy full names if present
    try {
      await pool.query(`
        UPDATE students 
        SET surname = split_part(name, ' ', 1), 
            first_name = split_part(name, ' ', 2) 
        WHERE surname IS NULL AND name IS NOT NULL;
      `);
      console.log('Existing names split and migrated successfully.');
    } catch (e) {
      console.log('Note: Legacy "name" column split skipped (already migrated or column dropped).');
    }

    console.log('Database migration completed successfully!');
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }
}

migrate();