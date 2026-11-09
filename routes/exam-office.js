const bcrypt = require('bcrypt');
const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const multer = require('multer');
const XLSX = require('xlsx');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

router.post('/login', async (req, res) => {
  const { email, password, school_code } = req.body;
  
  if (!email || !password) return res.status(400).json({ error: 'email and password are required' });
  if (!school_code) return res.status(400).json({ error: 'School Code is required' });

  try {
    // 1. Find the school
    const schoolRes = await pool.query('SELECT id, status, name, code FROM schools WHERE code = $1', [school_code.trim().toUpperCase()]);
    if (schoolRes.rows.length === 0) return res.status(404).json({ error: 'Invalid School Code' });
    
    const school = schoolRes.rows[0];
    if (school.status === 'suspended') {
      return res.status(403).json({ error: 'This school\'s subscription has been suspended.' });
    }

    // 2. Find the officer by email
    const { rows } = await pool.query(
      `SELECT id, name, email, password_hash, school_id FROM exam_officers 
       WHERE email = $1 AND school_id = $2`,
      [email, school.id]
    );
    
    if (rows.length === 0) return res.status(401).json({ error: 'Incorrect email or password' });

    const officer = rows[0];

    // 3. Compare the typed password with the hashed password in the DB
    const isMatch = await bcrypt.compare(password, officer.password_hash);
    if (!isMatch) return res.status(401).json({ error: 'Incorrect email or password' });

    // 4. Remove password_hash before sending to frontend
    delete officer.password_hash;

    res.json({ officer, school: { id: school.id, name: school.name, code: school.code } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed' });
  }
});
router.post('/settings', async (req, res) => {
  const { current_term, current_session } = req.body;
  if (!current_term || !current_session) {
    return res.status(400).json({ error: 'current_term and current_session are required' });
  }
  try {
    const checkRes = await pool.query('SELECT id FROM school_settings LIMIT 1');
    
    let rows;
    if (checkRes.rows.length > 0) {
      const updateRes = await pool.query(
        `UPDATE school_settings SET current_term = $1, current_session = $2, updated_at = NOW() WHERE id = $3 RETURNING current_term, current_session`,
        [current_term, current_session, checkRes.rows[0].id]
      );
      rows = updateRes.rows;
    } else {
      const insertRes = await pool.query(
        `INSERT INTO school_settings (current_term, current_session) VALUES ($1, $2) RETURNING current_term, current_session`,
        [current_term, current_session]
      );
      rows = insertRes.rows;
    }

    res.json({ success: true, settings: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update school settings' });
  }
});

router.post('/term-records', async (req, res) => {
  let { student_id, term, session, principal_comment } = req.body;
  if (!student_id || !term || !session || !principal_comment) {
    return res.status(400).json({ error: 'student_id, term, session, and principal_comment are required' });
  }
  student_id = parseInt(student_id, 10);

  try {
    const studentRes = await pool.query('SELECT class FROM students WHERE id = $1', [student_id]);
    const studentClass = studentRes.rows[0]?.class || null;

    const { rows } = await pool.query(
      `INSERT INTO term_records (student_id, class, term, session, principal_comment, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (student_id, term, session)
       DO UPDATE SET principal_comment = $5, class = COALESCE(EXCLUDED.class, term_records.class), updated_at = NOW()
       RETURNING *`,
      [student_id, studentClass, term, session, principal_comment]
    );
    res.json({ termRecord: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to save principal comment override' });
  }
});

router.get('/fee-status', async (req, res) => {
  const { term, session, class: className, search, page = 1, pageSize = 25 } = req.query;
  if (!term || !session) {
    return res.status(400).json({ error: 'term and session are required' });
  }

  const limit = Math.min(Number(pageSize) || 25, 100);
  const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;

  const conditions = [];
  const params = [];

  if (search) {
    params.push(`%${search}%`);
    conditions.push(`(s.surname ILIKE $${params.length} OR s.first_name ILIKE $${params.length} OR s.middle_name ILIKE $${params.length} OR s.admission_no ILIKE $${params.length})`);
  }
  if (className) {
    params.push(className);
    conditions.push(`s.class = $${params.length}`);
  }
  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    const countRes = await pool.query(`SELECT COUNT(*) FROM students s ${whereClause}`, params);
    const total = Number(countRes.rows[0].count);

    params.push(term, session, limit, offset);
    const { rows } = await pool.query(
      `SELECT s.id, s.surname, s.first_name, s.middle_name,
              CONCAT(s.surname, ' ', s.first_name, CASE WHEN s.middle_name IS NOT NULL AND s.middle_name != '' THEN CONCAT(' ', s.middle_name) ELSE '' END) AS name,
              s.admission_no, s.class,
              COALESCE(f.cleared, true) AS cleared
       FROM students s
       LEFT JOIN fee_status f
         ON f.student_id = s.id AND f.term = $${params.length - 3} AND f.session = $${params.length - 2}
       ${whereClause}
       ORDER BY s.class ASC, s.surname ASC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    res.json({ students: rows, total, page: Number(page), pageSize: limit });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load fee status' });
  }
});

router.post('/fee-status', async (req, res) => {
  let { student_id, term, session, cleared } = req.body;
  if (!student_id || !term || !session || typeof cleared !== 'boolean') {
    return res.status(400).json({ error: 'student_id, term, session and cleared (true/false) are required' });
  }
  student_id = parseInt(student_id, 10);

  try {
    const { rows } = await pool.query(
      `INSERT INTO fee_status (student_id, term, session, cleared, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (student_id, term, session)
       DO UPDATE SET cleared = $4, updated_at = NOW()
       RETURNING *`,
      [student_id, term, session, cleared]
    );
    res.json({ feeStatus: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update fee status' });
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
    conditions.push(`(p.code ILIKE $${params.length} OR s.admission_no ILIKE $${params.length} OR s.surname ILIKE $${params.length} OR s.first_name ILIKE $${params.length})`);
  }
  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    const countRes = await pool.query(
      `SELECT COUNT(*) FROM result_pins p LEFT JOIN students s ON s.id = p.student_id ${whereClause}`,
      params
    );
    const total = Number(countRes.rows[0].count);

    params.push(limit, offset);
    const { rows } = await pool.query(
      `SELECT p.id, p.code, p.max_uses, p.uses_count, p.created_at, p.first_used_at,
              s.surname AS student_surname, s.first_name AS student_first_name, s.middle_name AS student_middle_name,
              CONCAT(s.surname, ' ', s.first_name, CASE WHEN s.middle_name IS NOT NULL AND s.middle_name != '' THEN CONCAT(' ', s.middle_name) ELSE '' END) AS student_name,
              s.admission_no AS student_admission_no
       FROM result_pins p
       LEFT JOIN students s ON s.id = p.student_id
       ${whereClause}
       ORDER BY p.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    res.json({ pins: rows, total, page: Number(page), pageSize: limit });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load PINs' });
  }
});

router.get('/deadline-overrides', async (req, res) => {
  const { term, session } = req.query;
  if (!term || !session) {
    return res.status(400).json({ error: 'term and session are required' });
  }
  try {
    const { rows } = await pool.query(
      `SELECT d.id, d.class, t.id AS teacher_id, t.name AS teacher_name
       FROM deadline_overrides d
       JOIN teachers t ON t.id = d.teacher_id
       WHERE d.term = $1 AND d.session = $2
       ORDER BY d.class ASC, t.name ASC`,
      [term, session]
    );
    res.json({ overrides: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load deadline overrides' });
  }
});

router.post('/deadline-overrides', async (req, res) => {
  let { teacher_id, class: className, term, session } = req.body;
  if (!teacher_id || !className || !term || !session) {
    return res.status(400).json({ error: 'teacher_id, class, term and session are required' });
  }
  teacher_id = parseInt(teacher_id, 10);

  try {
    const { rows } = await pool.query(
      `INSERT INTO deadline_overrides (teacher_id, class, term, session) VALUES ($1, $2, $3, $4)
       ON CONFLICT (teacher_id, class, term, session) DO NOTHING RETURNING *`,
      [teacher_id, className, term, session]
    );
    res.json({ override: rows[0] || { already_granted: true } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to grant extension' });
  }
});

router.delete('/deadline-overrides/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    await pool.query('DELETE FROM deadline_overrides WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to revoke extension' });
  }
});

router.get('/students', async (req, res) => {
  const { search, class: className, school_id, page = 1, pageSize = 25 } = req.query;
  if (!school_id) return res.status(400).json({ error: 'school_id is required' });

  const limit = Math.min(Number(pageSize) || 25, 100);
  const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;

  const conditions = [`school_id = $1`];
  const params = [school_id];

  if (search) {
    params.push(`%${search}%`);
    conditions.push(`(surname ILIKE $${params.length} OR first_name ILIKE $${params.length} OR middle_name ILIKE $${params.length} OR admission_no ILIKE $${params.length})`);
  }
  if (className) {
    params.push(className);
    conditions.push(`class = $${params.length}`);
  }
  const whereClause = `WHERE ${conditions.join(' AND ')}`;

  try {
    const countRes = await pool.query(`SELECT COUNT(*) FROM students ${whereClause}`, params);
    const total = Number(countRes.rows[0].count);

    params.push(limit, offset);
    const { rows } = await pool.query(
      `SELECT id, surname, first_name, middle_name,
              CONCAT(surname, ' ', first_name, CASE WHEN middle_name IS NOT NULL AND middle_name != '' THEN CONCAT(' ', middle_name) ELSE '' END) AS name,
              admission_no, class, photo_url, created_at
       FROM students
       ${whereClause}
       ORDER BY class ASC, surname ASC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    res.json({ students: rows, total, page: Number(page), pageSize: limit });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load students' });
  }
});
router.post('/students', async (req, res) => {
  let { surname, first_name, middle_name, admission_no, class: className, term, session } = req.body;
  if (!surname || !first_name || !admission_no || !className) {
    return res.status(400).json({ error: 'surname, first_name, admission_no and class are required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existingRes = await client.query('SELECT id, class FROM students WHERE admission_no = $1', [admission_no.trim()]);
    
    let studentId;
    
    if (existingRes.rows.length > 0) {
      const existing = existingRes.rows[0];
      
      if (existing.class === className) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `Student with admission number ${admission_no} is already in ${className}` });
      }

      const updateRes = await client.query(
        `UPDATE students 
         SET surname = $1, first_name = $2, middle_name = $3, class = $4
         WHERE id = $5
         RETURNING id, surname, first_name, middle_name,
                   CONCAT(surname, ' ', first_name, CASE WHEN middle_name IS NOT NULL AND middle_name != '' THEN CONCAT(' ', middle_name) ELSE '' END) AS name,
                   admission_no, class, photo_url`,
        [surname.trim(), first_name.trim(), middle_name ? middle_name.trim() : null, className, existing.id]
      );
      studentId = existing.id;
      
    } else {
      const insertRes = await client.query(
        `INSERT INTO students (surname, first_name, middle_name, admission_no, class)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, surname, first_name, middle_name,
                   CONCAT(surname, ' ', first_name, CASE WHEN middle_name IS NOT NULL AND middle_name != '' THEN CONCAT(' ', middle_name) ELSE '' END) AS name,
                   admission_no, class, photo_url`,
        [surname.trim(), first_name.trim(), middle_name ? middle_name.trim() : null, admission_no.trim(), className]
      );
      studentId = insertRes.rows[0].id;
    }

    if (!term || !session) {
      const settingsRes = await client.query('SELECT current_term, current_session FROM school_settings ORDER BY id DESC LIMIT 1');
      if (settingsRes.rows.length > 0) {
        term = term || settingsRes.rows[0].current_term;
        session = session || settingsRes.rows[0].current_session;
      }
    }

    if (term && session) {
      await client.query(
        `INSERT INTO student_term_enrollments (student_id, class, term, session, status)
         VALUES ($1, $2, $3, $4, 'ACTIVE')
         ON CONFLICT (student_id, term, session) 
         DO UPDATE SET class = $2, status = 'ACTIVE'`,
        [studentId, className, term, session]
      );
    }

    await client.query('COMMIT');
    
    const finalStudent = await pool.query('SELECT id, surname, first_name, middle_name, admission_no, class, photo_url FROM students WHERE id = $1', [studentId]);
    res.json({ student: finalStudent.rows[0], message: 'Student saved successfully' });
    
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Failed to save student' });
  } finally {
    client.release();
  }
});

router.delete('/students/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    await pool.query('DELETE FROM students WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: friendlyDeleteError(err, 'student') });
  }
});

router.put('/students/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { surname, first_name, middle_name, admission_no, class: className } = req.body;
  if (!surname && !first_name && !middle_name && !admission_no && !className) {
    return res.status(400).json({ error: 'Provide at least one student field to update' });
  }
  try {
    const { rows } = await pool.query(
      `UPDATE students SET
         surname = COALESCE($1, surname),
         first_name = COALESCE($2, first_name),
         middle_name = COALESCE($3, middle_name),
         admission_no = COALESCE($4, admission_no),
         class = COALESCE($5, class)
       WHERE id = $6
       RETURNING id, surname, first_name, middle_name,
                 CONCAT(surname, ' ', first_name, CASE WHEN middle_name IS NOT NULL AND middle_name != '' THEN CONCAT(' ', middle_name) ELSE '' END) AS name,
                 admission_no, class, photo_url`,
      [
        surname?.trim() || null,
        first_name?.trim() || null,
        middle_name !== undefined ? (middle_name ? middle_name.trim() : null) : null,
        admission_no?.trim() || null,
        className || null,
        id
      ]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Student not found' });
    res.json({ student: rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'A student with that admission number already exists' });
    console.error(err);
    res.status(500).json({ error: 'Failed to update student' });
  }
});

router.post('/students/bulk-import', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file received. Upload an .xlsx or .csv file.' });
  }

  let rows;
  try {
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    rows = XLSX.utils.sheet_to_json(firstSheet, { defval: '' });
  } catch (err) {
    return res.status(400).json({ error: 'Could not read that file. Make sure it is a valid .xlsx or .csv file.' });
  }

  if (rows.length === 0) {
    return res.status(400).json({ error: 'The file has no rows to import.' });
  }

  let activeTerm = 'First Term';
  let activeSession = '2026/2027';
  try {
    const settingsRes = await pool.query('SELECT current_term, current_session FROM school_settings ORDER BY id DESC LIMIT 1');
    if (settingsRes.rows.length > 0) {
      activeTerm = settingsRes.rows[0].current_term;
      activeSession = settingsRes.rows[0].current_session;
    }
  } catch (e) {}

  const normalize = (key) => String(key).toLowerCase().replace(/[^a-z0-9]/g, '');
  function extractField(row, candidates) {
    const keys = Object.keys(row);
    for (const key of keys) {
      if (candidates.includes(normalize(key))) return String(row[key]).trim();
    }
    return '';
  }

  const results = { processed: 0, skipped: [] };

  for (let i = 0; i < rows.length; i++) {
    const rowNum = i + 2;
    const row = rows[i];

    let surname = extractField(row, ['surname', 'last name', 'familyname']);
    let firstName = extractField(row, ['firstname', 'first name', 'givenname']);
    let middleName = extractField(row, ['middlename', 'middle name', 'othername']);
    let admissionNo = extractField(row, ['admissionno', 'admno', 'admissionnumber']);
    const className = extractField(row, ['class']);

    if (!surname || !firstName) {
      const fullName = extractField(row, ['name', 'studentname', 'fullname']);
      if (fullName) {
        const parts = fullName.split(/\s+/);
        if (parts.length >= 2) {
          surname = parts[0];
          firstName = parts[1];
          if (parts.length > 2) middleName = parts.slice(2).join(' ');
        } else if (parts.length === 1) {
          surname = parts[0];
          firstName = '';
        }
      }
    }

    if (!surname || !firstName || !className) {
      results.skipped.push({ row: rowNum, reason: 'Missing surname, first name, or class' });
      continue;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Handle Brand New Students (no admission number provided)
      if (!admissionNo) {
        const year = new Date().getFullYear();
        const random = Math.floor(1000 + Math.random() * 9000);
        admissionNo = `ADM-${year}-${random}`;
      }

      const existingRes = await client.query('SELECT id, class FROM students WHERE admission_no = $1', [admissionNo]);
      
      let studentId;

      if (existingRes.rows.length > 0) {
        const existing = existingRes.rows[0];
        
        if (existing.class === className) {
          await client.query('ROLLBACK');
          results.skipped.push({ row: rowNum, reason: `Student is already in ${className}` });
          continue;
        }

        await client.query(
          `UPDATE students SET surname = $1, first_name = $2, middle_name = $3, class = $4 WHERE id = $5`,
          [surname, firstName, middleName || null, className, existing.id]
        );
        studentId = existing.id;
        
      } else {
        const studentRes = await client.query(
          `INSERT INTO students (surname, first_name, middle_name, admission_no, class) 
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [surname, firstName, middleName || null, admissionNo, className]
        );
        studentId = studentRes.rows[0].id;
      }

      await client.query(
        `INSERT INTO student_term_enrollments (student_id, class, term, session, status)
         VALUES ($1, $2, $3, $4, 'ACTIVE')
         ON CONFLICT (student_id, term, session) 
         DO UPDATE SET class = $2, status = 'ACTIVE'`,
        [studentId, className, activeTerm, activeSession]
      );

      await client.query('COMMIT');
      results.processed++;
        } catch (err) {
      await client.query('ROLLBACK');
      console.error(`BULK IMPORT FAILED — Row ${rowNum}:`, err.message, '| Code:', err.code);
      results.skipped.push({ row: rowNum, reason: `DB Error: ${err.message}` });
    } finally {
      client.release();
    }
  }

  res.json(results);
});

router.get('/subjects', async (req, res) => {
  const { school_id } = req.query;
  if (!school_id) return res.status(400).json({ error: 'school_id is required' });

  try {
    const { rows } = await pool.query('SELECT * FROM subjects WHERE school_id = $1 ORDER BY name ASC', [school_id]);
    res.json({ subjects: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load subjects' });
  }
});

router.post('/subjects', async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  try {
    const { rows } = await pool.query(
      'INSERT INTO subjects (name) VALUES ($1) RETURNING *',
      [name.trim()]
    );
    res.json({ subject: rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'That subject already exists' });
    console.error(err);
    res.status(500).json({ error: 'Failed to add subject' });
  }
});

router.delete('/subjects/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    await pool.query('DELETE FROM subjects WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: friendlyDeleteError(err, 'subject') });
  }
});

router.get('/teachers', async (req, res) => {
  const { school_id } = req.query;
  if (!school_id) return res.status(400).json({ error: 'school_id is required' });

  try {
    const { rows } = await pool.query('SELECT id, name, email, created_at FROM teachers WHERE school_id = $1 ORDER BY name ASC', [school_id]);
    res.json({ teachers: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load teachers' });
  }
});

router.post('/teachers', async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'name, email and password are required' });
  }
  try {
    const { rows } = await pool.query(
      'INSERT INTO teachers (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, name, email',
      [name.trim(), email.trim(), password]
    );
    res.json({ teacher: rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'A teacher with that email already exists' });
    console.error(err);
    res.status(500).json({ error: 'Failed to add teacher' });
  }
});

router.delete('/teachers/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    await pool.query('DELETE FROM teachers WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: friendlyDeleteError(err, 'teacher') });
  }
});

const VALID_LEVELS = ['JSS1', 'JSS2', 'JSS3', 'SS1', 'SS2', 'SS3'];
const VALID_ARMS = ['A', 'B', 'C', 'D', 'E'];

router.get('/classes', async (req, res) => {
  const { school_id } = req.query;
  if (!school_id) return res.status(400).json({ error: 'school_id is required' });

  try {
    const { rows } = await pool.query('SELECT * FROM classes WHERE school_id = $1 ORDER BY level ASC, arm ASC', [school_id]);
    res.json({ classes: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load classes' });
  }
});

router.post('/classes', async (req, res) => {
  const { level, arm } = req.body;
  if (!VALID_LEVELS.includes(level) || !VALID_ARMS.includes(arm)) {
    return res.status(400).json({ error: `level must be one of ${VALID_LEVELS.join(', ')} and arm one of ${VALID_ARMS.join(', ')}` });
  }
  const name = `${level}${arm}`;
  try {
    const { rows } = await pool.query(
      'INSERT INTO classes (level, arm, name) VALUES ($1, $2, $3) RETURNING *',
      [level, arm, name]
    );
    res.json({ class: rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: `${name} already exists` });
    console.error(err);
    res.status(500).json({ error: 'Failed to add class' });
  }
});

router.delete('/classes/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    await pool.query('DELETE FROM classes WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: friendlyDeleteError(err, 'class') });
  }
});

router.get('/assignments', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT ts.id, ts.class, t.id AS teacher_id, t.name AS teacher_name, sub.id AS subject_id, sub.name AS subject_name
       FROM teacher_subjects ts
       JOIN teachers t ON t.id = ts.teacher_id
       JOIN subjects sub ON sub.id = ts.subject_id
       ORDER BY ts.class ASC, t.name ASC`
    );
    res.json({ assignments: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load assignments' });
  }
});

router.post('/assignments', async (req, res) => {
  let { teacher_id, subject_id, class: className } = req.body;
  if (!teacher_id || !subject_id || !className) {
    return res.status(400).json({ error: 'teacher_id, subject_id and class are required' });
  }
  teacher_id = parseInt(teacher_id, 10);
  subject_id = parseInt(subject_id, 10);

  try {
    const { rows } = await pool.query(
      'INSERT INTO teacher_subjects (teacher_id, subject_id, class) VALUES ($1, $2, $3) RETURNING *',
      [teacher_id, subject_id, className]
    );
    res.json({ assignment: rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'That teacher is already assigned to this subject and class' });
    console.error(err);
    res.status(500).json({ error: 'Failed to add assignment' });
  }
});

router.delete('/assignments/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    await pool.query('DELETE FROM teacher_subjects WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: friendlyDeleteError(err, 'assignment') });
  }
});

router.get('/form-teachers', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT ftc.id, ftc.class, t.id AS teacher_id, t.name AS teacher_name
       FROM form_teacher_classes ftc
       JOIN teachers t ON t.id = ftc.teacher_id
       ORDER BY ftc.class ASC`
    );
    res.json({ formTeachers: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load form teachers' });
  }
});

router.post('/form-teachers', async (req, res) => {
  let { teacher_id, class: className } = req.body;
  if (!teacher_id || !className) {
    return res.status(400).json({ error: 'teacher_id and class are required' });
  }
  teacher_id = parseInt(teacher_id, 10);

  try {
    const { rows } = await pool.query(
      'INSERT INTO form_teacher_classes (teacher_id, class) VALUES ($1, $2) RETURNING *',
      [teacher_id, className]
    );
    res.json({ formTeacher: rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'This class already has a form teacher — remove them first' });
    console.error(err);
    res.status(500).json({ error: 'Failed to assign form teacher' });
  }
});

router.delete('/form-teachers/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    await pool.query('DELETE FROM form_teacher_classes WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: friendlyDeleteError(err, 'form teacher assignment') });
  }
});

module.exports = router;