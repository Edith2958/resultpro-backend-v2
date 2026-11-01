console.log("=== SCRIPT STARTED ===");

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://resultpro_v2_db_user:kSxVRFn75m9CNF1oOa8h3FDY1yA3fKls@dpg-db8rhqs9v7es73dkk380-a.frankfurt-postgres.render.com/resultpro_v2_db',
  ssl: { rejectUnauthorized: false }
});

pool.query('ALTER TABLE term_records ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();')
  .then(() => {
    console.log('SUCCESS: updated_at column added to Render database!');
    process.exit(0);
  })
  .catch(err => {
    console.error('ERROR FAILED:', err);
    process.exit(1);
  });