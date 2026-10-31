const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const multer = require('multer');
const path = require('path');

// Configure multer storage to save logos inside the public/uploads folder
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '../uploads'));
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'school-logo-' + uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({ storage });

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

// POST / PUT school settings with optional logo file upload
router.post('/', upload.single('logo_file'), async (req, res) => {
  const { school_name, school_address, school_phone, school_email, motto } = req.body;
  
  if (!school_name) {
    return res.status(400).json({ error: 'School name is required' });
  }

  try {
    // If a new file was uploaded, use its path; otherwise, keep existing logo
    let logoUrl = req.body.logo_url;
    if (req.file) {
      logoUrl = `/uploads/${req.file.filename}`;
    }

    const { rows } = await pool.query(
      `INSERT INTO school_settings (id, school_name, school_address, school_phone, school_email, logo_url, motto, updated_at)
       VALUES (1, $1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (id) DO UPDATE SET
         school_name = EXCLUDED.school_name,
         school_address = EXCLUDED.school_address,
         school_phone = EXCLUDED.school_phone,
         school_email = EXCLUDED.school_email,
         logo_url = COALESCE(EXCLUDED.logo_url, school_settings.logo_url),
         motto = EXCLUDED.motto,
         updated_at = NOW()
       RETURNING *`,
      [school_name.trim(), school_address || null, school_phone || null, school_email || null, logoUrl || null, motto || null]
    );

    res.json({ settings: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update school settings' });
  }
});

module.exports = router;