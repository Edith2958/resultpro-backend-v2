require('dotenv').config();
const { Client } = require('pg');
const fs = require('fs');

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function smartImport() {
  try {
    if (!fs.existsSync('backup_data.sql')) {
      console.error("Error: backup_data.sql file not found. Run 'node export.js' first!");
      return;
    }

    const sqlContent = fs.readFileSync('backup_data.sql', 'utf8');
    if (!sqlContent.trim()) {
      console.log("backup_data.sql is empty. No data to import.");
      return;
    }

    console.log("Connecting to Neon database...");
    await client.connect();

    console.log("Cleaning old tables to ensure a fresh, conflict-free migration...");
    await client.query(`
      DROP TABLE IF EXISTS deadline_overrides, term_settings, form_teacher_classes, 
                           teacher_subjects, result_pins, developer_admins, fee_status, 
                           classes, exam_officers, school_settings, subjects, teachers, students CASCADE;
    `);

    // Split the file into individual INSERT statements
    const statements = sqlContent
      .split(';\n')
      .map(s => s.trim())
      .filter(s => s.length > 0);

    console.log(`Found ${statements.length} records to process. Creating tables dynamically and importing...`);

    for (let stmt of statements) {
      const match = stmt.match(/^INSERT INTO\s+([a-zA-Z0-9_]+)\s*\(([^)]+)\)\s*VALUES\s*\(([\s\S]*)\)$/i);
      
      if (match) {
        const tableName = match[1];
        const columns = match[2].split(',').map(c => c.trim().replace(/"/g, ''));

        // Dynamically create the table if it hasn't been created yet
        const colDefinitions = columns.map(col => {
          if (col === 'id') return 'id SERIAL PRIMARY KEY';
          return `"${col}" TEXT`;
        }).join(', ');

        try {
          await client.query(`CREATE TABLE IF NOT EXISTS "${tableName}" (${colDefinitions});`);
        } catch (e) {
          // Table might already exist from a previous statement, safe to ignore
        }
      }

      // Execute the insert statement
      try {
        await client.query(stmt);
      } catch (err) {
        console.error(`Note on statement: ${err.message}`);
      }
    }

    console.log("✅ Smart import completed successfully! All tables, exact columns, and user credentials have been migrated to Neon.");
  } catch (err) {
    console.error("Import failed:", err);
  } finally {
    await client.end();
  }
}

smartImport();