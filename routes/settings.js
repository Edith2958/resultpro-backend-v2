const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { upload } = require('../config/cloudinary');

router.get('/', async (req, res) => {
  const { school_id } = req.query;
  if (!school_id) return res.status(400).json({ error: 'school_id is required' });

  try {
    // We join the 'schools' table (where the name/code lives) 
    // with 'school_settings' (where the logo/motto/address lives)
    const { rows } = await pool.query(
      `SELECT s.name AS school_name, st.school_address, st.school_phone, st.school_email, st.logo_url, st.motto
       FROM schools s
       LEFT JOIN school_settings st ON st.school_id = s.id
       WHERE s.id = $1`,
      [school_id]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'School not found' });
    }
    
    // Fill in blanks if they haven't set it up yet
    const settings = rows[0];
    settings.school_address = settings.school_address || '';
    settings.school_phone = settings.school_phone || '';
    settings.school_email = settings.school_email || '';
    settings.logo_url = settings.logo_url || '';
    settings.motto = settings.motto || '';

    res.json({ settings });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load settings' });
  }
});

router.post('/', upload.single('logo'), async (req, res) => {
  const { school_name, school_address, school_phone, school_email, motto, school_id } = req.body;
  if (!school_id) return res.status(400).json({ error: 'school_id is required' });
  
  try {
    let logo_url = req.body.logo_url || '';
    if (req.file) {
      logo_url = req.file.path || req.file.secure_url;
    }

    // 1. Update the School Name in the main 'schools' table
    await pool.query(
      `UPDATE schools SET name = COALESCE(NULLIF($1, ''), name) WHERE id = $2`,
      [school_name, school_id]
    );

    // 2. Update the Branding in 'school_settings' table
    const check = await pool.query('SELECT id FROM school_settings WHERE school_id = $1', [school_id]);
    if (check.rows.length === 0) {
      await pool.query(
        `INSERT INTO school_settings (school_id, school_address, school_phone, school_email, logo_url, motto)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [school_id, school_address, school_phone, school_email, logo_url, motto]
      );
    } else {
      await pool.query(
        `UPDATE school_settings
         SET school_address = CASE WHEN $1 IS NULL THEN school_address ELSE $1 END,
             school_phone = CASE WHEN $2 IS NULL THEN school_phone ELSE $2 END,
             school_email = CASE WHEN $3 IS NULL THEN school_email ELSE $3 END,
             logo_url = CASE WHEN $4 IS NULL OR $4 = '' THEN logo_url ELSE $4 END,
             motto = CASE WHEN $5 IS NULL THEN motto ELSE $5 END,
             updated_at = NOW()
         WHERE school_id = $6`,
        [school_address, school_phone, school_email, logo_url, motto, school_id]
      );
    }

    const { rows } = await pool.query(
      `SELECT s.name AS school_name, st.school_address, st.school_phone, st.school_email, st.logo_url, st.motto
       FROM schools s
       LEFT JOIN school_settings st ON st.school_id = s.id
       WHERE s.id = $1`,
      [school_id]
    );
    
    res.json({ success: true, settings: rows[0] });
  } catch (err) {
    console.error('Failed to update settings:', err);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

module.exports = router;