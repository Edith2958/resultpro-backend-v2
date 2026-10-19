require('dotenv').config();
const pool = require('./db/pool');

async function createDeveloperAdmin() {
  const name = 'Developer Admin';
  const email = 'dev@example.com';        // <-- Change to your preferred email
  const password = 'yourpassword123';      // <-- Change to your preferred password

  try {
    const query = `
      INSERT INTO developer_admins (name, email, password_hash)
      VALUES ($1, $2, $3)
      ON CONFLICT (email) DO UPDATE 
      SET password_hash = EXCLUDED.password_hash
      RETURNING id, name, email;
    `;
    
    const res = await pool.query(query, [name, email, password]);
    console.log('Developer Admin account created successfully:');
    console.log(res.rows[0]);
    process.exit(0);
  } catch (err) {
    console.error('Failed to create Developer Admin:', err);
    process.exit(1);
  }
}

createDeveloperAdmin();