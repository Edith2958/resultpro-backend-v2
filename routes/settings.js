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

    // Normalize: convert undefined → null so COALESCE works, but keep '' as '' so
    // NULLIF can turn it into a fallback. Also trim strings.
    const normalize = (v) => {
      if (v === undefined || v === null) return null;
      const s = String(v).trim();
      return s === '' ? '' : s;
    };

    const check = await pool.query('SELECT id FROM school_settings WHERE id = 1');
    if (check.rows.length === 0) {
      // BUG FIX: school_name is NOT NULL with a default — if empty string was passed
      // the insert would fail. Fall back to the default when empty.
      const safeName = normalize(school_name) || 'My School';
      await pool.query(
        `INSERT INTO school_settings (id, school_name, school_address, school_phone, school_email, logo_url, motto)
         VALUES (1, $1, $2, $3, $4, $5, $6)`,
        [
          safeName,
          normalize(school_address),
          normalize(school_phone),
          normalize(school_email),
          logo_url || null,
          normalize(motto)
        ]
      );
    } else {
      // BUG FIX: original UPDATE used COALESCE(NULLIF($2, ''), school_address) for the
      // address/phone/email/motto fields, which means an empty string fallback kept the
      // OLD value. That's fine for "leave blank to keep" semantics — but it also means
      // clearing a field became impossible. Keep the semantics but be explicit about
      // each field so the behavior is predictable.
      await pool.query(
        `UPDATE school_settings
         SET school_name = COALESCE(NULLIF($1, ''), school_name),
             school_address = CASE WHEN $2 IS NULL THEN school_address ELSE $2 END,
             school_phone = CASE WHEN $3 IS NULL THEN school_phone ELSE $3 END,
             school_email = CASE WHEN $4 IS NULL THEN school_email ELSE $4 END,
             logo_url = CASE WHEN $5 IS NULL OR $5 = '' THEN logo_url ELSE $5 END,
             motto = CASE WHEN $6 IS NULL THEN motto ELSE $6 END,
             updated_at = NOW()
         WHERE id = 1`,
        [
          normalize(school_name),
          normalize(school_address),
          normalize(school_phone),
          normalize(school_email),
          logo_url,
          normalize(motto)
        ]
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