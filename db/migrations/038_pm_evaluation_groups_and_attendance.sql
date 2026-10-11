BEGIN;

-- 1. evaluation_groups
CREATE TABLE IF NOT EXISTS evaluation_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed initial default 'Software' group if not exists
INSERT INTO evaluation_groups (id, name, description, is_active)
VALUES ('EVAL-GRP-SOFTWARE', 'Software', 'Kelompok penilaian mahasiswa software engineering lintas proyek', TRUE)
ON CONFLICT (id) DO NOTHING;

-- 2. evaluation_group_role_mappings
CREATE TABLE IF NOT EXISTS evaluation_group_role_mappings (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES evaluation_groups(id) ON DELETE CASCADE,
  role_pattern TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (group_id, role_pattern)
);

-- Seed role patterns for Software group
INSERT INTO evaluation_group_role_mappings (id, group_id, role_pattern, is_active)
VALUES
  ('EVAL-MAP-FE', 'EVAL-GRP-SOFTWARE', '%Frontend%', TRUE),
  ('EVAL-MAP-BE', 'EVAL-GRP-SOFTWARE', '%Backend%', TRUE),
  ('EVAL-MAP-FS', 'EVAL-GRP-SOFTWARE', '%Fullstack%', TRUE),
  ('EVAL-MAP-SW', 'EVAL-GRP-SOFTWARE', '%Software%', TRUE),
  ('EVAL-MAP-WEB', 'EVAL-GRP-SOFTWARE', '%Web%', TRUE),
  ('EVAL-MAP-MOB', 'EVAL-GRP-SOFTWARE', '%Mobile%', TRUE)
ON CONFLICT (group_id, role_pattern) DO NOTHING;

-- 3. evaluation_group_students (Manual student mappings for ambiguous roles or specific assignment)
CREATE TABLE IF NOT EXISTS evaluation_group_students (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES evaluation_groups(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (group_id, student_id)
);

-- 4. evaluation_group_evaluators (PM evaluators assigned to group)
CREATE TABLE IF NOT EXISTS evaluation_group_evaluators (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES evaluation_groups(id) ON DELETE CASCADE,
  evaluator_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (group_id, evaluator_id)
);

-- 5. evaluation_period_evaluators (Attendance and evaluator status at period level)
CREATE TABLE IF NOT EXISTS evaluation_period_evaluators (
  id TEXT PRIMARY KEY,
  period_id TEXT NOT NULL REFERENCES evaluation_periods(id) ON DELETE CASCADE,
  evaluator_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_id TEXT REFERENCES evaluation_groups(id) ON DELETE SET NULL,
  attendance_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (attendance_status IN ('PENDING', 'PRESENT', 'ABSENT')),
  confirmed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  confirmed_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (period_id, evaluator_id)
);

CREATE INDEX IF NOT EXISTS idx_evaluation_period_evaluators_period ON evaluation_period_evaluators(period_id);
CREATE INDEX IF NOT EXISTS idx_evaluation_period_evaluators_evaluator ON evaluation_period_evaluators(evaluator_id);

-- 6. Add group_id and group_name to evaluation_assignments
ALTER TABLE evaluation_assignments
  ADD COLUMN IF NOT EXISTS group_id TEXT REFERENCES evaluation_groups(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS group_name TEXT;

-- 7. Add group_id to evaluation_periods (explicit scoping of period to evaluation group)
ALTER TABLE evaluation_periods
  ADD COLUMN IF NOT EXISTS group_id TEXT REFERENCES evaluation_groups(id) ON DELETE SET NULL;

COMMIT;
