const express = require('express');
const router = express.Router();
const pool = require('../db/pool');

/**
 * GET /api/verify/:pin_code
 * Public — no auth. Given a PIN, tells the caller whether the PIN is a
 * genuine PIN issued by the school, and which student/term it belongs to
 * (with PII redacted to first name initial + class only).
 *
 * Response states:
 *   - valid + active     : PIN is real, still has uses left
 *   - valid + exhausted  : PIN is real, but max_uses reached (still verifies as authentic)
 *   - invalid            : PIN not found in the system
 */
router.get('/:pin_code', async (req, res) => {
  const raw = req.params.pin_code;
  if (!raw || typeof raw !== 'string') {
    return res.status(400).json({ error: 'PIN code is required' });
  }
  const pinCode = raw.trim().toUpperCase();
  if (pinCode.length < 4 || pinCode.length > 32) {
    return res.status(400).json({ error: 'Invalid PIN format' });
  }

  try {
    const { rows } = await pool.query(
      `SELECT p.code, p.max_uses, p.uses_count, p.student_id, p.first_used_at,
              s.surname, s.first_name, s.class,
              sch.school_name, sch.logo_url, sch.motto
       FROM result_pins p
       LEFT JOIN students s ON s.id = p.student_id
       LEFT JOIN school_settings sch ON sch.id = 1
       WHERE UPPER(p.code) = $1
       LIMIT 1`,
      [pinCode]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        valid: false,
        state: 'not_found',
        message: 'This PIN is not recognised. It may be mistyped or not issued by this school.'
      });
    }

    const pin = rows[0];
    const isExhausted = pin.uses_count >= pin.max_uses;

    // Redact PII — only first letter of first name + class, no admission number
    let studentDisplay = null;
    if (pin.student_id && pin.surname) {
      const firstInitial = pin.first_name ? pin.first_name.trim().charAt(0).toUpperCase() + '.' : '';
      studentDisplay = {
        name: `${pin.surname} ${firstInitial}`.trim(),
        class: pin.class || null
      };
    }

    const response = {
      valid: true,
      state: isExhausted ? 'exhausted' : (pin.student_id ? 'active' : 'unused'),
      pin_code: pin.code,
      uses: {
        count: pin.uses_count,
        max: pin.max_uses
      },
      first_used_at: pin.first_used_at,
      student: studentDisplay,
      school: {
        name: pin.school_name || null,
        logo_url: pin.logo_url || null,
        motto: pin.motto || null
      },
      verified_at: new Date().toISOString()
    };

    if (isExhausted) {
      response.message = 'This PIN is authentic, but it has reached its maximum number of uses. The original result was issued by this school.';
    } else if (pin.student_id) {
      response.message = 'This PIN is authentic and has been used to view a result from this school.';
    } else {
      response.message = 'This PIN is authentic but has not yet been used by any student.';
    }

    res.json(response);
  } catch (err) {
    console.error('VERIFY FAILED:', err.query, err.position, err);
    res.status(500).json({ error: 'Verification failed' });
  }
});

module.exports = router;