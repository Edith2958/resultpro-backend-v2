CREATE TABLE IF NOT EXISTS school_settings (
  id SERIAL PRIMARY KEY,
  school_name VARCHAR(255) NOT NULL DEFAULT 'My School',
  school_address TEXT,
  school_phone VARCHAR(50),
  school_email VARCHAR(150),
  logo_url TEXT,
  motto VARCHAR(255),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Insert the default record so the table is never empty
INSERT INTO school_settings (id, school_name)
VALUES (1, 'ResultPro Academy')
ON CONFLICT (id) DO NOTHING;