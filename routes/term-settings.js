const express = require('express');
const router = express.Router();
const pool = require('../db/pool');

function toTimestampOrNull(val, fieldName) {
  if (val === null || val === undefined || String(val).trim() === '') return null;
  const d = new Date(val);
  if (isNaN(d.getTime())) {
    throw new Error(`${fieldName} is not a valid date`);
  }
  return d.toISOString();
}

router.get('/', async (req, res) => {
  const { term, session } = req.query;
  if (!term || !session) {
    return res.status(400).json({ error: 'term and session are required' });
  }
  try {
    const { rows } = await pool.query(
      'SELECT * FROM term_settings WHERE term = $1 AND session = $2',
      [term, session]
    );
    res.json({ settings: rows[0] || { term, session, teacher_deadline: null, result_release_at: null } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load term settings' });
  }
});

router.post('/', async (req, res) => {
  const { term, session, teacher_deadline, result_release_at } = req.body;
  if (!term || !session) {
    return res.status(400).json({ error: 'term and session are required' });
  }

  let deadlineIso, releaseIso;
  try {
    deadlineIso = toTimestampOrNull(teacher_deadline, 'teacher_deadline');
    releaseIso = toTimestampOrNull(result_release_at, 'result_release_at');
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  // Release must be strictly after the teacher submission deadline.
  if (deadlineIso && releaseIso && new Date(releaseIso) <= new Date(deadlineIso)) {
    return res.status(400).json({
      error: 'Result release date must be AFTER the teacher submission deadline.',
      validation: 'release_before_deadline'
    });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO term_settings (term, session, teacher_deadline, result_release_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (term, session)
       DO UPDATE SET teacher_deadline = $3, result_release_at = $4, updated_at = NOW()
       RETURNING *`,
      [term, session, deadlineIso, releaseIso]
    );
    res.json({ settings: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to save term settings' });
  }
});

module.exports = router;