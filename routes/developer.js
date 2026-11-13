const bcrypt = require('bcrypt');
const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const crypto = require('crypto');

// ==========================================
// DEVELOPER LOGIN
// ==========================================
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }
  try {
    const { rows } = await pool.query(
      `SELECT id, name, email FROM developer_admins WHERE email = $1 AND password_hash = $2`,
      [email, password]
    );
    if (rows.length === 0) {
      return res.status(401).json({ error: 'Incorrect email or password' });
    }
    res.json({ admin: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// ==========================================
// PIN MANAGEMENT (Now tied to schools)
// ==========================================
function generatePinCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  const bytes = crypto.randomBytes(9);
  for (let i = 0; i < 9; i++) {
    code += chars[bytes[i] % chars.length];
  }
  return code;
}

router.post('/pins/generate', async (req, res) => {
  const { count, max_uses = 5, generated_by, school_id } = req.body;
  
  if (!school_id) return res.status(400).json({ error: 'school_id is required to generate PINs' });

  const howMany = Number(count);
  if (!howMany || howMany < 1 || howMany > 1000 || !Number.isInteger(howMany)) {
    return res.status(400).json({ error: 'count must be between 1 and 1000' });
  }

  const maxUsesInt = Number(max_uses);
  if (!Number.isInteger(maxUsesInt) || maxUsesInt < 1) {
    return res.status(400).json({ error: 'max_uses must be a positive integer' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const generated = [];

    const uniqueCodes = new Set();
    while (uniqueCodes.size < howMany) {
      uniqueCodes.add(generatePinCode());
    }

    for (const code of uniqueCodes) {
      const { rows } = await client.query(
        `INSERT INTO result_pins (code, max_uses, uses_count, generated_by, school_id) 
         VALUES ($1, $2, 0, $3, $4) 
         ON CONFLICT (code) DO NOTHING 
         RETURNING *`,
        [code, maxUsesInt, generated_by || null, school_id]
      );

      if (rows.length > 0) {
        generated.push(rows[0]);
      }
    }

    await client.query('COMMIT');
    res.json({ pins: generated });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Failed to generate PINs' });
  } finally {
    client.release();
  }
});

router.get('/pins', async (req, res) => {
  const { status, search, page = 1, pageSize = 25, school_id } = req.query;
  
  if (!school_id) return res.status(400).json({ error: 'school_id is required to view PINs' });

  const limit = Math.min(Number(pageSize) || 25, 100);
  const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;

  // Start by filtering by the school that generated the PIN
  const conditions = [`p.school_id = $1`];
  const params = [school_id];

  if (status === 'unused') conditions.push(`p.student_id IS NULL`);
  if (status === 'active') conditions.push(`p.student_id IS NOT NULL AND p.uses_count < p.max_uses`);
  if (status === 'exhausted') conditions.push(`p.uses_count >= p.max_uses`);
  
  if (search) {
    params.push(`%${search}%`);
    conditions.push(`(p.code ILIKE $${params.length} OR s.admission_no ILIKE $${params.length})`);
  }
  
  const whereClause = `WHERE ${conditions.join(' AND ')}`;

  try {
    const countRes = await pool.query(
      `SELECT COUNT(*) FROM result_pins p LEFT JOIN students s ON s.id = p.student_id ${whereClause}`,
      params
    );
    const total = Number(countRes.rows[0].count);

    params.push(limit, offset);
    const limitIndex = params.length - 1;
    const offsetIndex = params.length;

    const { rows } = await pool.query(
      `SELECT p.id, p.code, p.max_uses, p.uses_count, p.created_at, p.first_used_at,
              s.surname AS student_name, s.admission_no AS student_admission_no
       FROM result_pins p
       LEFT JOIN students s ON s.id = p.student_id
       ${whereClause}
       ORDER BY p.created_at DESC
       LIMIT $${limitIndex} OFFSET $${offsetIndex}`,
      params
    );

    res.json({ pins: rows, total, page: Number(page), pageSize: limit });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load PINs' });
  }
});

// ==========================================
// MULTI-SCHOOL (SAAS) MANAGEMENT
// ==========================================

// Get all schools
router.get('/schools', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM schools ORDER BY created_at DESC');
    res.json({ schools: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load schools' });
  }
});

// Create a new school
router.post('/schools', async (req, res) => {
  const { name, code, admin_email, admin_password } = req.body;
  
  if (!name || !code || !admin_email || !admin_password) {
    return res.status(400).json({ error: 'School name, code, admin email, and admin password are required' });
  }
  
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Create the school
    const schoolRes = await client.query(
      `INSERT INTO schools (name, code) VALUES ($1, $2) RETURNING *`,
      [name.trim(), code.trim().toUpperCase()]
    );
    const school = schoolRes.rows[0];

    // 2. Hash the admin password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(admin_password, salt);

    // 3. Create the first Exam Officer for this school
    await client.query(
      `INSERT INTO exam_officers (name, email, password_hash, school_id) 
       VALUES ($1, $2, $3, $4)`,
      [name + ' Admin', admin_email.trim(), hashedPassword, school.id]
    );

    await client.query('COMMIT');
    res.json({ school });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') return res.status(400).json({ error: 'That School Code or Admin Email is already taken' });
    console.error(err);
    res.status(500).json({ error: 'Failed to create school' });
  } finally {
    client.release();
  }
});

// Toggle school status (Suspend / Activate)
router.put('/schools/:id/status', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { status } = req.body;
  
  if (!['active', 'suspended'].includes(status)) {
    return res.status(400).json({ error: 'Status must be active or suspended' });
  }

  try {
    const { rows } = await pool.query(
      'UPDATE schools SET status = $1 WHERE id = $2 RETURNING *',
      [status, id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'School not found' });
    res.json({ school: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update status' });
  }
});
// Delete a school permanently
router.delete('/schools/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    // Because of ON DELETE CASCADE in the database, deleting the school
    // will automatically delete all their students, teachers, exams, etc.
    const { rows } = await pool.query('DELETE FROM schools WHERE id = $1 RETURNING *', [id]);
    
    if (rows.length === 0) return res.status(404).json({ error: 'School not found' });
    
    res.json({ success: true, message: 'School and all associated data deleted.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete school' });
  }
});
// Public route for the Gateway to verify a school code
router.get('/public/school-lookup', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).json({ error: 'School code is required' });

  try {
    const { rows } = await pool.query(
      `SELECT s.id, s.name, s.status, st.logo_url 
       FROM schools s
       LEFT JOIN school_settings st ON st.school_id = s.id
       WHERE s.code = $1`,
      [code.trim().toUpperCase()]
    );
    
    if (rows.length === 0) return res.status(404).json({ error: 'School not found' });
    
    const school = rows[0];
    if (school.status === 'suspended') {
      return res.status(403).json({ error: 'This school\'s subscription is suspended.' });
    }

    res.json({ school });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Lookup failed' });
  }
});

module.exports = router;
