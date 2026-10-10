const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { getGrade, rankByTotal, ordinal } = require('../utils/grading');

/**
 * Automated principal comment based on student average
 * (Outstanding is set to start from 90+)
 */
function getPrincipalComment(average) {
  if (average >= 90) return "An outstanding performance! Keep up the brilliant work.";
  if (average >= 75) return "Very good result. Consistency will bring even greater success.";
  if (average >= 60) return "A satisfactory performance. Put in more effort next term.";
  if (average >= 50) return "Fair attempt, but you need to dedicate more time to your studies.";
  return "Poor performance. Immediate consultation with teachers and parents is required.";
}

/**
 * POST /api/student/login
 */
router.post('/login', async (req, res) => {
  const { admission_no, surname } = req.body;
  if (!admission_no || !surname) {
    return res.status(400).json({ error: 'admission_no and surname are required' });
  }

  try {
    const { rows } = await pool.query(
      `SELECT id, name, admission_no, class, photo_url FROM students
       WHERE admission_no = $1 AND name ILIKE $2`,
      [admission_no, `%${surname}%`]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'No matching student found' });
    }

    res.json({ student: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed' });
  }
});

/**
 * GET /api/student/midterm-result
 */
router.get('/midterm-result', async (req, res) => {
  const { student_id, term, session } = req.query;
  if (!student_id || !term || !session) {
    return res.status(400).json({ error: 'student_id, term and session are required' });
  }

  try {
    const studentRes = await pool.query('SELECT * FROM students WHERE id = $1', [student_id]);
    if (studentRes.rows.length === 0) {
      return res.status(404).json({ error: 'Student not found' });
    }
    const student = studentRes.rows[0];

    const { rows } = await pool.query(
      `SELECT sub.id AS subject_id, sub.name AS subject_name, m.assignment_score, m.test_score
       FROM mid_term_results m
       JOIN subjects sub ON sub.id = m.subject_id
       WHERE m.student_id = $1 AND m.term = $2 AND m.session = $3
       ORDER BY sub.name ASC`,
      [student_id, term, session]
    );

    const subjects = rows.map((row) => {
      const assignment = row.assignment_score !== null ? Number(row.assignment_score) : null;
      const test = row.test_score !== null ? Number(row.test_score) : null;
      const hasAny = assignment !== null || test !== null;
      const total = hasAny ? (assignment || 0) + (test || 0) : null;
      const remark = total === null ? null : (total >= 15 ? 'Pass' : 'Fail');
      return { subject_id: row.subject_id, subject_name: row.subject_name, assignment, test, total, remark };
    });

    res.json({
      student: { id: student.id, name: student.name, admission_no: student.admission_no, class: student.class, photo_url: student.photo_url },
      term, session, subjects,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load mid-term result' });
  }
});

/**
 * GET /api/student/result
 */
router.get('/result', async (req, res) => {
  const { student_id, term, session, pin_code } = req.query;
  if (!student_id || !term || !session) {
    return res.status(400).json({ error: 'student_id, term and session are required' });
  }
  if (!pin_code) {
    return res.status(400).json({ error: 'A result PIN is required to view the full-term result', pin_required: true });
  }

  try {
    const settingsRes = await pool.query(
      'SELECT result_release_at FROM term_settings WHERE term = $1 AND session = $2',
      [term, session]
    );
    const releaseAt = settingsRes.rows[0]?.result_release_at;
    if (releaseAt && new Date(releaseAt) > new Date()) {
      return res.status(403).json({
        error: 'Results have not been released yet',
        result_release_at: releaseAt,
      });
    }

    const feeRes = await pool.query(
      'SELECT cleared FROM fee_status WHERE student_id = $1 AND term = $2 AND session = $3',
      [student_id, term, session]
    );
    if (feeRes.rows.length > 0 && feeRes.rows[0].cleared === false) {
      return res.status(403).json({
        error: 'Your result is on hold due to an outstanding balance. Please contact the school\'s accounts office.',
        fee_hold: true,
      });
    }

    const pinUpdateRes = await pool.query(
      `UPDATE result_pins
       SET uses_count = uses_count + 1,
           student_id = COALESCE(student_id, $2),
           first_used_at = COALESCE(first_used_at, NOW())
       WHERE code = $1
         AND uses_count < max_uses
         AND (student_id IS NULL OR student_id = $2)
       RETURNING *`,
      [pin_code, student_id]
    );

    if (pinUpdateRes.rows.length === 0) {
      const pinCheckRes = await pool.query('SELECT * FROM result_pins WHERE code = $1', [pin_code]);
      if (pinCheckRes.rows.length === 0) {
        return res.status(403).json({ error: 'Invalid PIN. Please check the code and try again.' });
      }
      const pin = pinCheckRes.rows[0];
      if (pin.uses_count >= pin.max_uses) {
        return res.status(403).json({ error: 'This PIN has reached its maximum number of uses. Please get a new one.' });
      }
      if (pin.student_id && String(pin.student_id) !== String(student_id)) {
        return res.status(403).json({ error: 'This PIN is already registered to another student.' });
      }
      return res.status(403).json({ error: 'This PIN could not be used. Please check the code and try again.' });
    }

    const studentRes = await pool.query('SELECT * FROM students WHERE id = $1', [student_id]);
    if (studentRes.rows.length === 0) {
      return res.status(404).json({ error: 'Student not found' });
    }
    const student = studentRes.rows[0];

    const scoresRes = await pool.query(
      `SELECT sub.id AS subject_id, sub.name AS subject_name,
              m.assignment_score, m.test_score,
              r.exam_score, r.manual_ca_override
       FROM results r
       JOIN subjects sub ON sub.id = r.subject_id
       LEFT JOIN mid_term_results m
         ON m.student_id = r.student_id AND m.subject_id = r.subject_id AND m.term = r.term AND m.session = r.session
       WHERE r.student_id = $1 AND r.term = $2 AND r.session = $3
       ORDER BY sub.name ASC`,
      [student_id, term, session]
    );

    const subjects = scoresRes.rows.map((row) => {
      const midTermTotal =
        row.assignment_score !== null || row.test_score !== null
          ? Number(row.assignment_score || 0) + Number(row.test_score || 0)
          : null;
      const ca = midTermTotal !== null ? midTermTotal : Number(row.manual_ca_override || 0);
      const exam = Number(row.exam_score || 0);
      const total = ca + exam;
      const { grade, remark } = getGrade(total);
      return { subject_id: row.subject_id, subject_name: row.subject_name, ca, exam, total, grade, remark };
    });

    const totalScore = subjects.reduce((sum, s) => sum + s.total, 0);
    const maxObtainable = subjects.length * 100;
    const average = maxObtainable ? Number(((totalScore / maxObtainable) * 100).toFixed(1)) : 0;

    const subjectStats = {};
    for (const s of subjects) {
      const classScoresRes = await pool.query(
        `SELECT r.student_id,
                COALESCE(m.assignment_score,0) + COALESCE(m.test_score,0) + COALESCE(r.exam_score,0) AS total
         FROM results r
         LEFT JOIN mid_term_results m
           ON m.student_id = r.student_id AND m.subject_id = r.subject_id AND m.term = r.term AND m.session = r.session
         WHERE r.class = $1 AND r.subject_id = $2 AND r.term = $3 AND r.session = $4`,
        [student.class, s.subject_id, term, session]
      );
      const entries = classScoresRes.rows.map((r) => ({ studentId: r.student_id, total: Number(r.total) }));
      const ranked = rankByTotal(entries);
      const mine = ranked.find((e) => e.studentId === student.id);
      const highest = ranked.length ? ranked[0].total : null;
      subjectStats[s.subject_id] = { highest, position: mine ? ordinal(mine.position) : '-' };
    }

    const classTotalsRes = await pool.query(
      `SELECT r.student_id,
              SUM(COALESCE(m.assignment_score,0) + COALESCE(m.test_score,0) + COALESCE(r.exam_score,0)) AS total
       FROM results r
       LEFT JOIN mid_term_results m
         ON m.student_id = r.student_id AND m.subject_id = r.subject_id AND m.term = r.term AND m.session = r.session
       WHERE r.class = $1 AND r.term = $2 AND r.session = $3
       GROUP BY r.student_id`,
      [student.class, term, session]
    );
    const classEntries = classTotalsRes.rows.map((r) => ({ studentId: r.student_id, total: Number(r.total) }));
    const classRanked = rankByTotal(classEntries);
    const myClassRank = classRanked.find((e) => e.studentId === student.id);

    const termRecordRes = await pool.query(
      `SELECT * FROM term_records WHERE student_id = $1 AND term = $2 AND session = $3`,
      [student_id, term, session]
    );
    const termRecord = termRecordRes.rows[0] || null;
    const pinData = pinUpdateRes.rows[0];

    // Priority: Custom exam-office comment overrides automated average comment
    const principalComment = termRecord?.principal_comment || getPrincipalComment(average);

    res.json({
      student: { id: student.id, name: student.name, admission_no: student.admission_no, class: student.class, photo_url: student.photo_url },
      term, session,
      subjects: subjects.map((s) => ({ ...s, highest: subjectStats[s.subject_id].highest, position: subjectStats[s.subject_id].position })),
      summary: {
        total_score: totalScore,
        max_obtainable: maxObtainable,
        average,
        class_position: myClassRank ? ordinal(myClassRank.position) : '-',
        class_size: classRanked.length,
      },
      attendance: termRecord
        ? { present: termRecord.times_present, absent: termRecord.times_absent, total_days: termRecord.total_days }
        : null,
      comments: {
        form_teacher: termRecord?.form_teacher_comment || null,
        principal: principalComment
      },
      pin_usage: {
        code: pinData.code,
        uses_count: pinData.uses_count,
        max_uses: pinData.max_uses
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load result' });
  }
});

module.exports = router;