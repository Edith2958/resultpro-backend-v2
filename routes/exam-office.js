const express = require('express');
const router = express.Router();
const pool = require('../db/pool');

// 1. Get Students (with search and class filter)
router.get('/students', async (req, res) => {
  const { search = '', class: className = '' } = req.query;
  try {
    let query = 'SELECT * FROM students WHERE 1=1';
    let params = [];
    let paramIndex = 1;

    if (search) {
      query += ` AND (name ILIKE $${paramIndex} OR admission_no ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    if (className) {
      query += ` AND class = $${paramIndex}`;
      params.push(className);
      paramIndex++;
    }

    query += ' ORDER BY name ASC';
    const result = await pool.query(query, params);
    res.json({ students: result.rows });
  } catch (err) {
    console.error('Error fetching students:', err);
    res.status(500).json({ error: 'Failed to fetch students' });
  }
});

// Delete Student
router.delete('/students/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM students WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete student' });
  }
});

// 2. Teachers Directory
router.get('/teachers', async (req, res) => {
  try {
    const result = await pool.query('SELECT id, name, email FROM teachers ORDER BY name ASC');
    res.json({ teachers: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch teachers' });
  }
});

router.post('/teachers', async (req, res) => {
  const { name, email, password } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO teachers (name, email, password) VALUES ($1, $2, $3) RETURNING id, name, email',
      [name, email, password]
    );
    res.json({ success: true, teacher: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to add teacher' });
  }
});

router.delete('/teachers/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM teachers WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete teacher' });
  }
});

// 3. Term Records & Custom Principal Comment Overrides
router.post('/term-records', async (req, res) => {
  const { student_id, term, session, principal_comment } = req.body;
  try {
    // Check if a record already exists for this student, term, and session
    const existing = await pool.query(
      'SELECT id FROM term_records WHERE student_id = $1 AND term = $2 AND session = $3',
      [student_id, term, session]
    );

    if (existing.rows.length > 0) {
      // Update existing record
      await pool.query(
        'UPDATE term_records SET principal_comment = $1 WHERE student_id = $2 AND term = $3 AND session = $4',
        [principal_comment, student_id, term, session]
      );
    } else {
      // Insert new record
      await pool.query(
        'INSERT INTO term_records (student_id, term, session, principal_comment) VALUES ($1, $2, $3, $4)',
        [student_id, term, session, principal_comment]
      );
    }

    res.json({ success: true, message: 'Principal comment override saved successfully!' });
  } catch (err) {
    console.error('Error saving term record override:', err);
    res.status(500).json({ error: 'Failed to save term record override' });
  }
});

// 4. Result PINs Manager
router.get('/pins', async (req, res) => {
  const { search = '', status = '' } = req.query;
  try {
    let query = `
      SELECT p.*, s.name AS student_name, s.admission_no AS student_admission_no
      FROM result_pins p
      LEFT JOIN students s ON s.id = p.student_id
      WHERE 1=1
    `;
    let params = [];
    if (search) {
      query += ` AND (p.code ILIKE $1 OR s.name ILIKE $1 OR s.admission_no ILIKE $1)`;
      params.push(`%${search}%`);
    }
    query += ' ORDER BY p.id DESC';
    const result = await pool.query(query, params);
    res.json({ pins: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch PINs' });
  }
});

// 5. Fee Clearance Status
router.get('/fee-status', async (req, res) => {
  const { term = 'First Term', session = '2025/2026', search = '' } = req.query;
  try {
    let query = `
      SELECT s.id, s.admission_no, s.name, s.class, 
             COALESCE(f.cleared, false) AS cleared
      FROM students s
      LEFT JOIN fee_status f ON f.student_id = s.id AND f.term = $1 AND f.session = $2
      WHERE 1=1
    `;
    let params = [term, session];
    if (search) {
      query += ` AND (s.name ILIKE $3 OR s.admission_no ILIKE $3)`;
      params.push(`%${search}%`);
    }
    query += ' ORDER BY s.name ASC';
    const result = await pool.query(query, params);
    res.json({ students: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch fee statuses' });
  }
});

router.post('/fee-status', async (req, res) => {
  const { student_id, term, session, cleared } = req.body;
  try {
    const existing = await pool.query(
      'SELECT id FROM fee_status WHERE student_id = $1 AND term = $2 AND session = $3',
      [student_id, term, session]
    );

    if (existing.rows.length > 0) {
      await pool.query(
        'UPDATE fee_status SET cleared = $1 WHERE student_id = $2 AND term = $3 AND session = $4',
        [cleared, student_id, term, session]
      );
    } else {
      await pool.query(
        'INSERT INTO fee_status (student_id, term, session, cleared) VALUES ($1, $2, $3, $4)',
        [student_id, term, session, cleared]
      );
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update fee status' });
  }
});

// 6. Classes & Subjects & Assignments (Placeholders / Table Queries)
router.get('/classes', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM classes ORDER BY level, arm ASC');
    res.json({ classes: result.rows });
  } catch (err) { res.json({ classes: [] }); }
});

router.post('/classes', async (req, res) => {
  const { level, arm } = req.body;
  try {
    await pool.query('INSERT INTO classes (name, level, arm) VALUES ($1, $2, $3)', [`${level} ${arm}`, level, arm]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Failed to add class' }); }
});

router.get('/subjects', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM subjects ORDER BY name ASC');
    res.json({ subjects: result.rows });
  } catch (err) { res.json({ subjects: [] }); }
});

router.post('/subjects', async (req, res) => {
  const { name } = req.body;
  try {
    await pool.query('INSERT INTO subjects (name) VALUES ($1)', [name]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Failed to add subject' }); }
});

router.get('/assignments', async (req, res) => {
  try {
    const result = await pool.query(`
      ta.*, t.name AS teacher_name, sub.name AS subject_name 
      FROM teacher_assignments ta
      JOIN teachers t ON t.id = ta.teacher_id
      JOIN subjects sub ON sub.id = ta.subject_id
    `.replace('ta.*', 'SELECT ta.*')).catch(() => ({ rows: [] }));
    res.json({ assignments: result.rows || [] });
  } catch (err) { res.json({ assignments: [] }); }
});

router.get('/form-teachers', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT ft.*, t.name AS teacher_name 
      FROM form_teachers ft
      JOIN teachers t ON t.id = ft.teacher_id
    `).catch(() => ({ rows: [] }));
    res.json({ formTeachers: result.rows || [] });
  } catch (err) { res.json({ formTeachers: [] }); }
});

router.get('/deadline-overrides', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT d.*, t.name AS teacher_name 
      FROM deadline_overrides d
      JOIN teachers t ON t.id = d.teacher_id
    `).catch(() => ({ rows: [] }));
    res.json({ overrides: result.rows || [] });
  } catch (err) { res.json({ overrides: [] }); }
});

module.exports = router;