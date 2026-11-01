const { Client } = require('pg');
const fs = require('fs');

const client = new Client({
  connectionString: "postgresql://resultpro_v2_db_user:kSxVRFn75m9CNF1oOa8h3FDY1yA3fKls@dpg-db8rhqs9v7es73dkk380-a.frankfurt-postgres.render.com/resultpro_v2_db",
  ssl: { rejectUnauthorized: false }
});

async function exportData() {
  try {
    await client.connect();
    console.log("Connected to Render database...");

    const tablesRes = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema='public' AND table_type='BASE TABLE';
    `);

    let backupSQL = "";
    for (let row of tablesRes.rows) {
      const tableName = row.table_name;
      const dataRes = await client.query(`SELECT * FROM ${tableName}`);
      
      if (dataRes.rows.length > 0) {
        for (let r of dataRes.rows) {
          const keys = Object.keys(r);
          const values = Object.values(r).map(v => {
            if (v === null) return 'NULL';
            if (v instanceof Date) {
              // Format JS Date object to SQL-friendly 'YYYY-MM-DD HH:mm:ss'
              return `'${v.toISOString().slice(0, 19).replace('T', ' ')}'`;
            }
            return `'${String(v).replace(/'/g, "''")}'`;
          });
          backupSQL += `INSERT INTO ${tableName} (${keys.join(', ')}) VALUES (${values.join(', ')});\n`;
        }
      }
    }

    fs.writeFileSync('backup_data.sql', backupSQL);
    console.log("Export complete! Saved clean dates to backup_data.sql");
  } catch (err) {
    console.error("Export failed:", err);
  } finally {
    await client.end();
  }
}

exportData();