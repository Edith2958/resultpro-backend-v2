require('dotenv').config();
const pool = require('./db/pool');

async function createExamOfficer() {
  const name = 'Exam Officer';
  const email = 'examoffice@example.com';   // <-- Change to your preferred email
  const password = 'password123';          // <-- Change to your preferred password

  try {
    const query = `
      INSERT INTO exam_officers (name, email, password_hash)
      VALUES ($1, $2, $3)
      ON CONFLICT (email) DO UPDATE 
      SET password_hash = EXCLUDED.password_hash
      RETURNING id, name, email;
    `;
    
    const res = await pool.query(query, [name, email, password]);
    console.log('Exam Officer account created successfully:');
    console.log(res.rows[0]);
    process.exit(0);
  } catch (err) {
    console.error('Failed to create Exam Officer:', err);
    process.exit(1);
  }
}

createExamOfficer();