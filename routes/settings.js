const express = require('express');
const router = express.Router();
const pool = require('../db/pool');

// GET school settings
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM school_settings WHERE id = 1');
    res.json({ settings: rows[0] || {} });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load school settings' });
  }
});

// UPDATE school settings
router.post('/', async (req, res) => {
  const { school_name, school_address, school_phone, school_email, logo_url, motto } = req.body;
  if (!school_name) {
    return res.status(400).json({ error: 'School name is required' });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO school_settings (id, school_name, school_address, school_phone, school_email, logo_url, motto, updated_at)
       VALUES (1, $1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (id) DO UPDATE SET
         school_name = EXCLUDED.school_name,
         school_address = EXCLUDED.school_address,
         school_phone = EXCLUDED.school_phone,
         school_email = EXCLUDED.school_email,
         logo_url = EXCLUDED.logo_url,
         motto = EXCLUDED.motto,
         updated_at = NOW()
       RETURNING *`,
      [school_name.trim(), school_address || null, school_phone || null, school_email || null, logo_url || null, motto || null]
    );

    res.json({ settings: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update school settings' });
  }
});

module.exports = router;