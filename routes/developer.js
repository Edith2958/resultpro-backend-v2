const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const crypto = require('crypto');

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

// 9-character alphanumeric PIN, uppercase, excludes ambiguous chars (I, O, 0, 1)
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
  const { count, max_uses = 5, generated_by } = req.body;
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
      // Explicitly set uses_count = 0 so it can never be NULL, even if the
      // column DEFAULT gets dropped during a future migration.
      const { rows } = await client.query(
        `INSERT INTO result_pins (code, max_uses, uses_count, generated_by) 
         VALUES ($1, $2, 0, $3) 
         ON CONFLICT (code) DO NOTHING 
         RETURNING *`,
        [code, maxUsesInt, generated_by || null]
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
  const { status, search, page = 1, pageSize = 25 } = req.query;
  const limit = Math.min(Number(pageSize) || 25, 100);
  const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;

  const conditions = [];
  const params = [];

  if (status === 'unused') conditions.push(`p.student_id IS NULL`);
  if (status === 'active') conditions.push(`p.student_id IS NOT NULL AND p.uses_count < p.max_uses`);
  if (status === 'exhausted') conditions.push(`p.uses_count >= p.max_uses`);
  if (search) {
    params.push(`%${search}%`);
    conditions.push(`(p.code ILIKE $${params.length} OR s.admission_no ILIKE $${params.length})`);
  }
  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

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

module.exports = router;