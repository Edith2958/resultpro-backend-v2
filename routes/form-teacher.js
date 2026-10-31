const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { getGrade, rankByTotal, ordinal } = require('../utils/grading');
const { upload } = require('../config/cloudinary'); // Import Cloudinary upload middleware

/**
 * Helper to fetch global school settings
 */
async function getSchoolSettings() {
  try {
    const { rows } = await pool.query('SELECT * FROM school_settings WHERE id = 1');
    return rows[0] || {
      school_name: 'ResultPro Academy',
      school_address: '',
      school_phone: '',
      school_email: '',
      logo_url: '',
      motto: ''
    };
  } catch (err) {
    console.error('Failed to fetch school settings:', err);
    return { school_name: 'ResultPro Academy' };
  }
}

/**
 * GET /api/form-teacher/my-class
 * Returns the class this teacher is the form teacher for, if any.
 * Query params: teacher_id
 */
router.get('/my-class', async (req, res) => {
  const { teacher_id } = req.query;
  if (!teacher_id) return res.status(400).json({ error: 'teacher_id is required' });

  try {
    const { rows } = await pool.query(
      `SELECT class FROM form_teacher_classes WHERE teacher_id = $1`,
      [teacher_id]
    );
    res.json({ class: rows[0]?.class || null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to check form-teacher class' });
  }
});

async function isFormTeacherOf(teacherId, className) {
  const { rows } = await pool.query(
    `SELECT 1 FROM form_teacher_classes WHERE teacher_id = $1 AND class = $2`,
    [teacherId, className]
  );
  return rows.length > 0;
}

/**
 * GET /api/form-teacher/broadsheet?class=JSS1A&term=First Term&session=2025/2026&teacher_id=1
 */
router.get('/broadsheet', async (req, res) => {
  const { class: className, term, session, teacher_id } = req.query;
  if (!className || !term || !session || !teacher_id) {
    return res.status(400).json({ error: 'class, term, session and teacher_id are required' });
  }

  try {
    if (!(await isFormTeacherOf(teacher_id, className))) {
      return res.status(403).json({ error: 'You are not the form teacher for this class' });
    }

    const subjectsRes = await pool.query(
      `SELECT DISTINCT sub.id, sub.name
       FROM teacher_subjects ts
       JOIN subjects sub ON sub.id = ts.subject_id
       WHERE ts.class = $1
       ORDER BY sub.name ASC`,
      [className]
    );
    const subjects = subjectsRes.rows;

    const studentsRes = await pool.query(
      `SELECT id, surname, first_name, middle_name, admission_no FROM students WHERE class = $1 ORDER BY surname ASC`,
      [className]
    );
    const students = studentsRes.rows.map(s => ({
      ...s,
      name: `${s.surname} ${s.first_name}${s.middle_name ? ' ' + s.middle_name : ''}`
    }));

    const scoresRes = await pool.query(
      `SELECT r.student_id, r.subject_id,
              m.assignment_score, m.test_score, r.exam_score, r.manual_ca_override
       FROM results r
       LEFT JOIN mid_term_results m
         ON m.student_id = r.student_id AND m.subject_id = r.subject_id AND m.term = r.term AND m.session = r.session
       WHERE r.class = $1 AND r.term = $2 AND r.session = $3`,
      [className, term, session]
    );

    const scoreMap = {};
    for (const row of scoresRes.rows) {
      const midTermTotal =
        row.assignment_score !== null || row.test_score !== null
          ? Number(row.assignment_score || 0) + Number(row.test_score || 0)
          : null;
      const ca = midTermTotal !== null ? midTermTotal : Number(row.manual_ca_override || 0);
      const exam = Number(row.exam_score || 0);
      const total = ca + exam;
      scoreMap[`${row.student_id}-${row.subject_id}`] = { ca, exam, total, ...getGrade(total) };
    }

    const studentTotals = students.map((s) => {
      let total = 0;
      let subjectCount = 0;
      subjects.forEach((sub) => {
        const cell = scoreMap[`${s.id}-${sub.id}`];
        if (cell) { total += cell.total; subjectCount++; }
      });
      return { studentId: s.id, total, subjectCount };
    });
    const ranked = rankByTotal(studentTotals.map(t => ({ studentId: t.studentId, total: t.total })));
    const rankMap = {};
    ranked.forEach(r => { rankMap[r.studentId] = r.position; });

    const rows = students.map((s) => {
      const totals = studentTotals.find(t => t.studentId === s.id);
      const maxObtainable = totals.subjectCount * 100;
      const average = maxObtainable ? Number(((totals.total / maxObtainable) * 100).toFixed(1)) : 0;

      const subjectScores = subjects.map((sub) => {
        const cell = scoreMap[`${s.id}-${sub.id}`];
        return cell
          ? { subject_id: sub.id, total: cell.total, grade: cell.grade }
          : { subject_id: sub.id, total: null, grade: null };
      });

      return {
        student_id: s.id,
        name: s.name,
        admission_no: s.admission_no,
        subject_scores: subjectScores,
        total_score: totals.total,
        max_obtainable: maxObtainable,
        average,
        class_position: ordinal(rankMap[s.id]),
        class_position_rank: rankMap[s.id],
      };
    });

    res.json({ class: className, term, session, subjects, rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to build broadsheet' });
  }
});

/**
 * GET /api/form-teacher/class-result-slips
 */
router.get('/class-result-slips', async (req, res) => {
  const { class: className, term, session, teacher_id } = req.query;
  if (!className || !term || !session || !teacher_id) {
    return res.status(400).json({ error: 'class, term, session and teacher_id are required' });
  }

  try {
    if (!(await isFormTeacherOf(teacher_id, className))) {
      return res.status(403).json({ error: 'You are not the form teacher for this class' });
    }

    const [studentsRes, subjectsRes, schoolSettings] = await Promise.all([
      pool.query(`SELECT id, surname, first_name, middle_name, admission_no, photo_url FROM students WHERE class = $1 ORDER BY surname ASC`, [className]),
      pool.query(
        `SELECT DISTINCT sub.id, sub.name
         FROM teacher_subjects ts
         JOIN subjects sub ON sub.id = ts.subject_id
         WHERE ts.class = $1
         ORDER BY sub.name ASC`,
        [className]
      ),
      getSchoolSettings()
    ]);

    const students = studentsRes.rows.map(s => ({
      ...s,
      name: `${s.surname} ${s.first_name}${s.middle_name ? ' ' + s.middle_name : ''}`
    }));
    const subjects = subjectsRes.rows;

    const scoresRes = await pool.query(
      `SELECT r.student_id, r.subject_id,
              m.assignment_score, m.test_score, r.exam_score, r.manual_ca_override
       FROM results r
       LEFT JOIN mid_term_results m
         ON m.student_id = r.student_id AND m.subject_id = r.subject_id AND m.term = r.term AND m.session = r.session
       WHERE r.class = $1 AND r.term = $2 AND r.session = $3`,
      [className, term, session]
    );

    const scoreMap = {};
    for (const row of scoresRes.rows) {
      const midTermTotal =
        row.assignment_score !== null || row.test_score !== null
          ? Number(row.assignment_score || 0) + Number(row.test_score || 0)
          : null;
      const ca = midTermTotal !== null ? midTermTotal : Number(row.manual_ca_override || 0);
      const exam = Number(row.exam_score || 0);
      const total = ca + exam;
      scoreMap[`${row.student_id}-${row.subject_id}`] = { ca, exam, total, ...getGrade(total) };
    }

    const subjectRankings = {};
    for (const sub of subjects) {
      const entries = students
        .map((s) => {
          const cell = scoreMap[`${s.id}-${sub.id}`];
          return cell ? { studentId: s.id, total: cell.total } : null;
        })
        .filter(Boolean);
      const ranked = rankByTotal(entries);
      const highest = ranked.length ? ranked[0].total : null;
      const map = {};
      ranked.forEach((r) => { map[r.studentId] = { highest, position: ordinal(r.position) }; });
      subjectRankings[sub.id] = map;
    }

    const classTotals = students.map((s) => {
      let total = 0;
      subjects.forEach((sub) => {
        const cell = scoreMap[`${s.id}-${sub.id}`];
        if (cell) total += cell.total;
      });
      return { studentId: s.id, total };
    });
    const classRanked = rankByTotal(classTotals);
    const classRankMap = {};
    classRanked.forEach((r) => { classRankMap[r.studentId] = r.position; });

    const termRecordsRes = await pool.query(
      `SELECT student_id, times_present, times_absent, total_days, form_teacher_comment, principal_comment
       FROM term_records WHERE class = $1 AND term = $2 AND session = $3`,
      [className, term, session]
    );
    const termRecordMap = {};
    termRecordsRes.rows.forEach((r) => { termRecordMap[r.student_id] = r; });

    const slips = students.map((s) => {
      const studentSubjects = subjects
        .map((sub) => {
          const cell = scoreMap[`${s.id}-${sub.id}`];
          if (!cell) return null;
          const rank = subjectRankings[sub.id][s.id] || { highest: null, position: '-' };
          return {
            subject_name: sub.name,
            ca: cell.ca, exam: cell.exam, total: cell.total, grade: cell.grade,
            highest: rank.highest, position: rank.position,
          };
        })
        .filter(Boolean);

      const totalScore = studentSubjects.reduce((sum, sub) => sum + sub.total, 0);
      const maxObtainable = studentSubjects.length * 100;
      const average = maxObtainable ? Number(((totalScore / maxObtainable) * 100).toFixed(1)) : 0;

      const termRecord = termRecordMap[s.id];

      return {
        student: { id: s.id, surname: s.surname, first_name: s.first_name, middle_name: s.middle_name, name: s.name, admission_no: s.admission_no, photo_url: s.photo_url },
        subjects: studentSubjects,
        summary: {
          total_score: totalScore,
          max_obtainable: maxObtainable,
          average,
          class_position: ordinal(classRankMap[s.id]),
          class_size: students.length,
        },
        attendance: termRecord
          ? { present: termRecord.times_present, absent: termRecord.times_absent, total_days: termRecord.total_days }
          : null,
        comments: termRecord
          ? { form_teacher: termRecord.form_teacher_comment, principal: termRecord.principal_comment }
          : null,
      };
    });

    res.json({ class: className, term, session, school: schoolSettings, slips });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to build class result slips' });
  }
});

/**
 * GET /api/form-teacher/roster
 */
router.get('/roster', async (req, res) => {
  const { class: className, term, session, teacher_id } = req.query;
  if (!className || !term || !session || !teacher_id) {
    return res.status(400).json({ error: 'class, term, session and teacher_id are required' });
  }

  try {
    if (!(await isFormTeacherOf(teacher_id, className))) {
      return res.status(403).json({ error: 'You are not the form teacher for this class' });
    }
    const { rows } = await pool.query(
      `SELECT s.id AS student_id, s.surname, s.first_name, s.middle_name, s.admission_no, s.photo_url,
              t.times_present, t.times_absent, t.total_days,
              t.form_teacher_comment, t.principal_comment
       FROM students s
       LEFT JOIN term_records t
         ON t.student_id = s.id AND t.term = $2 AND t.session = $3
       WHERE s.class = $1
       ORDER BY s.surname ASC`,
      [className, term, session]
    );

    const roster = rows.map(s => ({
      ...s,
      name: `${s.surname} ${s.first_name}${s.middle_name ? ' ' + s.middle_name : ''}`
    }));

    res.json({ roster });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load form teacher roster' });
  }
});

/**
 * POST /api/form-teacher/term-records
 */
router.post('/term-records', async (req, res) => {
  const { class: className, term, session, records, teacher_id } = req.body;
  if (!className || !term || !session || !teacher_id || !Array.isArray(records)) {
    return res.status(400).json({ error: 'class, term, session, teacher_id and records[] are required' });
  }

  if (!(await isFormTeacherOf(teacher_id, className))) {
    return res.status(403).json({ error: 'You are not the form teacher for this class' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const r of records) {
      await client.query(
        `INSERT INTO term_records
           (student_id, class, term, session, times_present, times_absent, total_days,
            form_teacher_comment, principal_comment)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (student_id, term, session)
         DO UPDATE SET
           times_present = COALESCE(EXCLUDED.times_present, term_records.times_present),
           times_absent = COALESCE(EXCLUDED.times_absent, term_records.times_absent),
           total_days = COALESCE(EXCLUDED.total_days, term_records.total_days),
           form_teacher_comment = COALESCE(EXCLUDED.form_teacher_comment, term_records.form_teacher_comment),
           principal_comment = COALESCE(EXCLUDED.principal_comment, term_records.principal_comment)`,
        [
          r.student_id, className, term, session,
          r.times_present ?? null, r.times_absent ?? null, r.total_days ?? null,
          r.form_teacher_comment ?? null, r.principal_comment ?? null,
        ]
      );
    }

    await client.query('COMMIT');
    res.json({ success: true, saved: records.length });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Failed to save term records' });
  } finally {
    client.release();
  }
});

/**
 * POST /api/form-teacher/upload-photo
 * multipart/form-data with fields: student_id, class, teacher_id, and a file field named "photo"
 * Uploads directly to Cloudinary and updates students.photo_url with the secure cloud URL.
 */
router.post('/upload-photo', (req, res, next) => {
  upload.single('photo')(req, res, async (err) => {
    if (err) {
      console.error('MULTER/CLOUDINARY UPLOAD ERROR:', err);
      return res.status(500).json({ error: 'Upload failed: ' + (err.message || err) });
    }

    const { student_id, class: className, teacher_id } = req.body;

    if (!student_id || !className || !teacher_id) {
      return res.status(400).json({ error: 'student_id, class and teacher_id are required' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'No photo file received. Make sure the form field name is "photo".' });
    }

    try {
      if (!(await isFormTeacherOf(teacher_id, className))) {
        return res.status(403).json({ error: 'You are not the form teacher for this class' });
      }

      const cloudUrl = req.file.path || req.file.secure_url;
      if (!cloudUrl) {
        throw new Error('Cloudinary did not return a file path.');
      }

      await pool.query('UPDATE students SET photo_url = $1 WHERE id = $2', [cloudUrl, student_id]);

      return res.json({ success: true, photo_url: cloudUrl });
    } catch (dbOrLogicErr) {
      console.error('DATABASE/LOGIC ERROR:', dbOrLogicErr);
      return res.status(500).json({ error: 'Failed to save photo: ' + (dbOrLogicErr.message || dbOrLogicErr) });
    }
  });
});

module.exports = router;