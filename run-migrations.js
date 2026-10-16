require('dotenv').config(); // <--- THIS LINE IS CRITICAL
const fs = require('fs');
const path = require('path');
const pool = require('./db/pool');

async function runMigrations() {
  const migrationFiles = [
    'schema.sql',
    'migration_teacher_subjects.sql',
    'migration_exam_office.sql',
    'migration_fee_status.sql',
    'migration_pins.sql',
    'migration_term_settings.sql',
    'migration_deadline_overrides.sql'
  ];

  try {
    console.log('Starting database initialization for v2...');
    for (const file of migrationFiles) {
      const filePath = path.join(__dirname, 'db', file);
      if (fs.existsSync(filePath)) {
        console.log(`Running ${file}...`);
        const sql = fs.readFileSync(filePath, 'utf8');
        await pool.query(sql);
        console.log(`Successfully executed ${file}`);
      } else {
        console.warn(`Warning: ${file} not found.`);
      }
    }
    console.log('All database tables initialized successfully!');
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }
}

runMigrations();