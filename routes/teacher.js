const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { getGrade, getMidTermRemark } = require('../utils/grading');

/**
 * Helper to validate and parse scores:
 * - Ensures numbers are within the allowed range (0 to maxLimit).
 * - Handles explicit clearing (empty string or null sets value to null).
 * - Preserves existing values if the field is omitted (undefined).
 */
function parseScore(val, maxLimit, fieldName) {
  if (val === undefined) {
    return { provided: false, value: null };
  }
  if (val === null || String(val).trim() === '') {
    return { provided: true, value: null }; // Explicitly cleared by user
  }
  const num = Number(val);
  if (isNaN(num) || num < 0 || num > maxLimit) {
    throw new Error(`${fieldName} must be between 0 and ${maxLimit} marks.`);
  }
  return { provided: true, value: num };
}

/**
 * POST /api/teacher/login
 */
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }

  try {
    const { rows } = await pool.query(
      `SELECT id, name, email FROM teachers WHERE email = $1 AND password_hash = $2`,
      [email, password]
    );
    if (rows.length === 0) {
      return res.status(401).json({ error: 'Incorrect email or password' });
    }
    res.json({ teacher: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed' });
  }
});

/**
 * GET /api/teacher/my-subjects
 */
router.get('/my-subjects', async (req, res) => {
  const { teacher_id } = req.query;
  if (!teacher_id) {
    return res.status(400).json({ error: 'teacher_id is required' });
  }

  try {
    const { rows } = await pool.query(
      `SELECT ts.class, ts.subject_id, sub.name AS subject_name
       FROM teacher_subjects ts
       JOIN subjects sub ON sub.id = ts.subject_id
       WHERE ts.teacher_id = $1
       ORDER BY ts.class ASC, sub.name ASC`,
      [teacher_id]
    );
    res.json({ assignments: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load assigned subjects' });
  }
});

async function isAssigned(teacherId, className, subjectId) {
  const { rows } = await pool.query(
    `SELECT 1 FROM teacher_subjects WHERE teacher_id = $1 AND class = $2 AND subject_id = $3`,
    [teacherId, className, subjectId]
  );
  return rows.length > 0;
}

async function checkDeadlineAllowsSave(teacherId, className, term, session) {
  const settingsRes = await pool.query(
    'SELECT teacher_deadline FROM term_settings WHERE term = $1 AND session = $2',
    [term, session]
  );
  const deadline = settingsRes.rows[0]?.teacher_deadline;
  if (!deadline || new Date(deadline) > new Date()) {
    return null;
  }

  const overrideRes = await pool.query(
    'SELECT 1 FROM deadline_overrides WHERE teacher_id = $1 AND class = $2 AND term = $3 AND session = $4',
    [teacherId, className, term, session]
  );
  if (overrideRes.rows.length > 0) {
    return null;
  }

  return 'The deadline for submitting scores has passed. Contact the exam office for an extension.';
}

/**
 * GET /api/teacher/roster
 */
router.get('/roster', async (req, res) => {
  const { class: className, subject_id, term, session, teacher_id } = req.query;
  if (!className || !subject_id || !term || !session || !teacher_id) {
    return res.status(400).json({ error: 'class, subject_id, term, session and teacher_id are required' });
  }

  try {
    if (!(await isAssigned(teacher_id, className, subject_id))) {
      return res.status(403).json({ error: 'You are not assigned to this subject for this class' });
    }
    const { rows } = await pool.query(
      `SELECT s.id AS student_id, s.surname, s.first_name, s.middle_name,
              CONCAT(s.surname, ' ', s.first_name, CASE WHEN s.middle_name IS NOT NULL AND s.middle_name != '' THEN CONCAT(' ', s.middle_name) ELSE '' END) AS name,
              s.admission_no, s.photo_url,
              m.assignment_score, m.test_score, m.status AS mid_term_status
       FROM students s
       LEFT JOIN mid_term_results m
         ON m.student_id = s.id AND m.subject_id = $2 AND m.term = $3 AND m.session = $4
       WHERE s.class = $1
       ORDER BY s.surname ASC`,
      [className, subject_id, term, session]
    );

    const roster = rows.map((r) => {
      const assignment = r.assignment_score !== null ? Number(r.assignment_score) : null;
      const test = r.test_score !== null ? Number(r.test_score) : null;
      const hasAny = assignment !== null || test !== null;
      const total = hasAny ? (assignment || 0) + (test || 0) : null;
      return {
        student_id: r.student_id,
        name: r.name,
        admission_no: r.admission_no,
        photo_url: r.photo_url,
        assignment_score: assignment,
        test_score: test,
        total_score: total,
        remark: getMidTermRemark(total),
        status: r.mid_term_status || 'not_started',
      };
    });

    res.json({ roster });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load roster' });
  }
});

/**
 * POST /api/teacher/midterm-scores
 */
router.post('/midterm-scores', async (req, res) => {
  const { teacher_id, class: className, subject_id, term, session, scores } = req.body;
  if (!className || !subject_id || !term || !session || !teacher_id || !Array.isArray(scores)) {
    return res.status(400).json({ error: 'class, subject_id, term, session, teacher_id and scores[] are required' });
  }

  if (!(await isAssigned(teacher_id, className, subject_id))) {
    return res.status(403).json({ error: 'You are not assigned to this subject for this class' });
  }

  const deadlineError = await checkDeadlineAllowsSave(teacher_id, className, term, session);
  if (deadlineError) {
    return res.status(403).json({ error: deadlineError, deadline_passed: true });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const s of scores) {
      // Validate and parse scores (Assignment: 0–15, Mid-term Test: 0–15)
      const assignParsed = parseScore(s.assignment_score, 15, 'Assignment score');
      const testParsed = parseScore(s.test_score, 15, 'Mid-term score');

      await client.query(
        `INSERT INTO mid_term_results
            (student_id, subject_id, teacher_id, class, term, session, assignment_score, test_score, status, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, NOW())
         ON CONFLICT (student_id, subject_id, term, session)
         DO UPDATE SET
            assignment_score = CASE WHEN $10 THEN $7 ELSE mid_term_results.assignment_score END,
            test_score = CASE WHEN $11 THEN $8 ELSE mid_term_results.test_score END,
            status = COALESCE(EXCLUDED.status, mid_term_results.status),
            teacher_id = EXCLUDED.teacher_id,
            updated_at = NOW()`,
        [
          s.student_id,
          subject_id,
          teacher_id,
          className,
          term,
          session,
          assignParsed.value,
          testParsed.value,
          s.status || 'draft',
          assignParsed.provided,
          testParsed.provided,
        ]
      );
    }

    await client.query('COMMIT');
    res.json({ success: true, saved: scores.length });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(400).json({ error: err.message || 'Failed to save mid-term scores' });
  } finally {
    client.release();
  }
});

/**
 * GET /api/teacher/fullterm-roster
 */
router.get('/fullterm-roster', async (req, res) => {
  const { class: className, subject_id, term, session, teacher_id } = req.query;
  if (!className || !subject_id || !term || !session || !teacher_id) {
    return res.status(400).json({ error: 'class, subject_id, term, session and teacher_id are required' });
  }

  try {
    if (!(await isAssigned(teacher_id, className, subject_id))) {
      return res.status(403).json({ error: 'You are not assigned to this subject for this class' });
    }
    const { rows } = await pool.query(
      `SELECT s.id AS student_id, s.surname, s.first_name, s.middle_name,
              CONCAT(s.surname, ' ', s.first_name, CASE WHEN s.middle_name IS NOT NULL AND s.middle_name != '' THEN CONCAT(' ', s.middle_name) ELSE '' END) AS name,
              s.admission_no,
              m.assignment_score, m.test_score,
              r.exam_score, r.manual_ca_override, r.status AS result_status
       FROM students s
       LEFT JOIN mid_term_results m
         ON m.student_id = s.id AND m.subject_id = $2 AND m.term = $3 AND m.session = $4
       LEFT JOIN results r
         ON r.student_id = s.id AND r.subject_id = $2 AND r.term = $3 AND r.session = $4
       WHERE s.class = $1
       ORDER BY s.surname ASC`,
      [className, subject_id, term, session]
    );

    const roster = rows.map((r) => {
      const midTermTotal =
        r.assignment_score !== null || r.test_score !== null
          ? Number(r.assignment_score || 0) + Number(r.test_score || 0)
          : null;

      const needsManualCA = midTermTotal === null;
      const ca = needsManualCA
        ? (r.manual_ca_override !== null ? Number(r.manual_ca_override) : null)
        : midTermTotal;

      const exam = r.exam_score !== null ? Number(r.exam_score) : null;
      const total = ca !== null && exam !== null ? ca + exam : null;
      const { grade, remark } = getGrade(total);

      return {
        student_id: r.student_id,
        name: r.name,
        admission_no: r.admission_no,
        ca,
        needs_manual_ca: needsManualCA,
        exam_score: exam,
        total_score: total,
        grade,
        remark,
        status: r.result_status || 'not_started',
      };
    });

    res.json({ roster });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load full-term roster' });
  }
});

/**
 * POST /api/teacher/fullterm-scores
 */
router.post('/fullterm-scores', async (req, res) => {
  const { teacher_id, class: className, subject_id, term, session, scores } = req.body;
  if (!className || !subject_id || !term || !session || !teacher_id || !Array.isArray(scores)) {
    return res.status(400).json({ error: 'class, subject_id, term, session, teacher_id and scores[] are required' });
  }

  if (!(await isAssigned(teacher_id, className, subject_id))) {
    return res.status(403).json({ error: 'You are not assigned to this subject for this class' });
  }

  const deadlineError = await checkDeadlineAllowsSave(teacher_id, className, term, session);
  if (deadlineError) {
    return res.status(403).json({ error: deadlineError, deadline_passed: true });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const s of scores) {
      // Validate and parse Exam score (0–70) and manual CA override if applicable (0–30)
      const examParsed = parseScore(s.exam_score, 70, 'Exam score');
      const caOverrideParsed = parseScore(s.manual_ca_override, 30, 'Manual CA override');

      await client.query(
        `INSERT INTO results
            (student_id, subject_id, teacher_id, class, term, session, exam_score, manual_ca_override, status, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, NOW())
         ON CONFLICT (student_id, subject_id, term, session)
         DO UPDATE SET
            exam_score = CASE WHEN $10 THEN $7 ELSE results.exam_score END,
            manual_ca_override = CASE WHEN $11 THEN $8 ELSE results.manual_ca_override END,
            status = COALESCE(EXCLUDED.status, results.status),
            teacher_id = EXCLUDED.teacher_id,
            updated_at = NOW()`,
        [
          s.student_id,
          subject_id,
          teacher_id,
          className,
          term,
          session,
          examParsed.value,
          caOverrideParsed.value,
          s.status || 'draft',
          examParsed.provided,
          caOverrideParsed.provided,
        ]
      );
    }

    await client.query('COMMIT');
    res.json({ success: true, saved: scores.length });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(400).json({ error: err.message || 'Failed to save full-term scores' });
  } finally {
    client.release();
  }
});

module.exports = router;