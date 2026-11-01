require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function runAllMigrations() {
  try {
    console.log('Connecting to Neon database for full migration...');
    await pool.query('SELECT NOW()');
    console.log('Connected successfully. Re-creating tables cleanly...');

    // Drop and recreate tables to prevent schema/column mismatches
    await pool.query(`
      DROP TABLE IF EXISTS deadline_overrides CASCADE;
      DROP TABLE IF EXISTS term_settings CASCADE;
      DROP TABLE IF EXISTS form_teacher_classes CASCADE;
      DROP TABLE IF EXISTS teacher_subjects CASCADE;
      DROP TABLE IF EXISTS result_pins CASCADE;
      DROP TABLE IF EXISTS developer_admins CASCADE;
      DROP TABLE IF EXISTS fee_status CASCADE;
      DROP TABLE IF EXISTS classes CASCADE;
      DROP TABLE IF EXISTS exam_officers CASCADE;
      DROP TABLE IF EXISTS school_settings CASCADE;
      DROP TABLE IF EXISTS subjects CASCADE;
      DROP TABLE IF EXISTS teachers CASCADE;
      DROP TABLE IF EXISTS students CASCADE;
    `);

    // 1. Base Tables (Students, Teachers, Subjects)
    await pool.query(`
      CREATE TABLE students (
        id SERIAL PRIMARY KEY,
        name VARCHAR(150) NOT NULL,
        admission_no VARCHAR(50) UNIQUE NOT NULL,
        class VARCHAR(20) NOT NULL,
        photo_url TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
      
      

      CREATE TABLE teachers (
        id SERIAL PRIMARY KEY,
        name VARCHAR(150) NOT NULL,
        email VARCHAR(150) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE subjects (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) UNIQUE NOT NULL,
        code VARCHAR(20),
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // 2. School Settings
    await pool.query(`
      CREATE TABLE school_settings (
        id SERIAL PRIMARY KEY,
        school_name VARCHAR(255) NOT NULL DEFAULT 'My School',
        school_address TEXT,
        school_phone VARCHAR(50),
        school_email VARCHAR(150),
        logo_url TEXT,
        motto VARCHAR(255),
        updated_at TIMESTAMP DEFAULT NOW()
      );

      INSERT INTO school_settings (id, school_name)
      VALUES (1, 'ResultPro Academy')
      ON CONFLICT (id) DO NOTHING;
    `);

    // 3. Exam Office & Classes[cite: 4]
    await pool.query(`
      CREATE TABLE exam_officers (
        id SERIAL PRIMARY KEY,
        name VARCHAR(150) NOT NULL,
        email VARCHAR(150) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE classes (
        id SERIAL PRIMARY KEY,
        level VARCHAR(20) NOT NULL,
        arm VARCHAR(2) NOT NULL,
        name VARCHAR(30) NOT NULL UNIQUE,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(level, arm)
      );
    `);

    // 4. Fee Status[cite: 5]
    await pool.query(`
      CREATE TABLE fee_status (
        id SERIAL PRIMARY KEY,
        student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
        term VARCHAR(20) NOT NULL,
        session VARCHAR(20) NOT NULL,
        cleared BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(student_id, term, session)
      );

      CREATE INDEX idx_fee_status_lookup ON fee_status(student_id, term, session);
    `);

    // 5. Developer Admins & Result PINs[cite: 6]
    await pool.query(`
      CREATE TABLE developer_admins (
        id SERIAL PRIMARY KEY,
        name VARCHAR(150) NOT NULL,
        email VARCHAR(150) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE result_pins (
        id SERIAL PRIMARY KEY,
        code VARCHAR(20) UNIQUE NOT NULL,
        max_uses INTEGER NOT NULL DEFAULT 5,
        uses_count INTEGER NOT NULL DEFAULT 0,
        student_id INTEGER REFERENCES students(id),
        generated_by INTEGER REFERENCES developer_admins(id),
        created_at TIMESTAMP DEFAULT NOW(),
        first_used_at TIMESTAMP
      );

      CREATE INDEX idx_result_pins_code ON result_pins(code);
      CREATE INDEX idx_result_pins_student ON result_pins(student_id);
    `);

    // 6. Teacher Subjects & Form Teacher Classes[cite: 8]
    await pool.query(`
      CREATE TABLE teacher_subjects (
        id SERIAL PRIMARY KEY,
        teacher_id INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
        subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
        class VARCHAR(20) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(teacher_id, subject_id, class)
      );

      CREATE INDEX idx_teacher_subjects_lookup ON teacher_subjects(teacher_id);

      CREATE TABLE form_teacher_classes (
        id SERIAL PRIMARY KEY,
        teacher_id INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
        class VARCHAR(20) NOT NULL UNIQUE,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // 7. Term Settings & Deadline Overrides[cite: 3, 9]
    await pool.query(`
      CREATE TABLE term_settings (
        id SERIAL PRIMARY KEY,
        term VARCHAR(20) NOT NULL,
        session VARCHAR(20) NOT NULL,
        teacher_deadline TIMESTAMP,
        result_release_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(term, session)
      );

      CREATE TABLE deadline_overrides (
        id SERIAL PRIMARY KEY,
        teacher_id INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
        class VARCHAR(20) NOT NULL,
        term VARCHAR(20) NOT NULL,
        session VARCHAR(20) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(teacher_id, class, term, session)
      );
    `);

    console.log('✅ All database tables and migrations created successfully on Neon!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    process.exit(1);
  }
}

runAllMigrations();