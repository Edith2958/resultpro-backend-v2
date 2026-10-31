const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { upload } = require('../config/cloudinary');

/**
 * GET /api/settings
 * Returns global school settings
 */
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM school_settings WHERE id = 1');
    const settings = rows[0] || {
      school_name: 'ResultPro Academy',
      school_address: '',
      school_phone: '',
      school_email: '',
      logo_url: '',
      motto: ''
    };
    res.json({ settings });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load settings' });
  }
});

/**
 * POST /api/settings
 * Updates school settings and handles logo upload directly to Cloudinary
 */
router.post('/', upload.single('logo'), async (req, res) => {
  const { school_name, school_address, school_phone, school_email, motto } = req.body;
  
  try {
    let logo_url = req.body.logo_url || '';
    
    // If a new logo file was uploaded, extract the Cloudinary secure URL
    if (req.file) {
      logo_url = req.file.path || req.file.secure_url;
    }

    const check = await pool.query('SELECT id FROM school_settings WHERE id = 1');
    if (check.rows.length === 0) {
      await pool.query(
        `INSERT INTO school_settings (id, school_name, school_address, school_phone, school_email, logo_url, motto)
         VALUES (1, $1, $2, $3, $4, $5, $6)`,
        [school_name, school_address, school_phone, school_email, logo_url, motto]
      );
    } else {
      await pool.query(
        `UPDATE school_settings
         SET school_name = COALESCE(NULLIF($1, ''), school_name),
             school_address = COALESCE($2, school_address),
             school_phone = COALESCE($3, school_phone),
             school_email = COALESCE($4, school_email),
             logo_url = CASE WHEN $5 != '' THEN $5 ELSE logo_url END,
             motto = COALESCE($6, motto)
         WHERE id = 1`,
        [school_name, school_address, school_phone, school_email, logo_url, motto]
      );
    }

    const { rows } = await pool.query('SELECT * FROM school_settings WHERE id = 1');
    res.json({ success: true, settings: rows[0] });
  } catch (err) {
    console.error('Failed to update settings:', err);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

module.exports = router;