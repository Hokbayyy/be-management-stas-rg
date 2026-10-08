BEGIN;

-- 1. evaluation_periods
CREATE TABLE IF NOT EXISTS evaluation_periods (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('PM_EVALUATION', 'MONTHLY_PRESENTATION')),
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'OPEN', 'CLOSED')),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  description TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  opened_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_evaluation_periods_type_status ON evaluation_periods(type, status);
CREATE INDEX IF NOT EXISTS idx_evaluation_periods_dates ON evaluation_periods(start_date DESC, end_date DESC);

-- 2. evaluation_criteria
CREATE TABLE IF NOT EXISTS evaluation_criteria (
  id TEXT PRIMARY KEY,
  period_type TEXT NOT NULL CHECK (period_type IN ('PM_EVALUATION', 'MONTHLY_PRESENTATION')),
  key TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  min_score NUMERIC(4, 2) NOT NULL DEFAULT 1.0,
  max_score NUMERIC(4, 2) NOT NULL DEFAULT 10.0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (period_type, key)
);

CREATE INDEX IF NOT EXISTS idx_evaluation_criteria_type_sort ON evaluation_criteria(period_type, sort_order ASC);

-- Seed initial criteria
INSERT INTO evaluation_criteria (id, period_type, key, name, sort_order, min_score, max_score, is_active)
VALUES
  ('CRT-PM-01', 'PM_EVALUATION', 'quality_of_work', 'Quality of Work', 1, 1.0, 10.0, TRUE),
  ('CRT-PM-02', 'PM_EVALUATION', 'responsibility', 'Responsibility', 2, 1.0, 10.0, TRUE),
  ('CRT-PM-03', 'PM_EVALUATION', 'technical_skill', 'Technical Skill', 3, 1.0, 10.0, TRUE),
  ('CRT-PM-04', 'PM_EVALUATION', 'problem_solving', 'Problem Solving', 4, 1.0, 10.0, TRUE),
  ('CRT-PM-05', 'PM_EVALUATION', 'collaboration', 'Collaboration', 5, 1.0, 10.0, TRUE),
  ('CRT-PM-06', 'PM_EVALUATION', 'initiative', 'Initiative', 6, 1.0, 10.0, TRUE),
  ('CRT-PM-07', 'PM_EVALUATION', 'research_contribution', 'Research Contribution', 7, 1.0, 10.0, TRUE),

  ('CRT-PR-01', 'MONTHLY_PRESENTATION', 'progress_achievement', 'Progress Achievement', 1, 1.0, 10.0, TRUE),
  ('CRT-PR-02', 'MONTHLY_PRESENTATION', 'quality_of_result', 'Quality of Result', 2, 1.0, 10.0, TRUE),
  ('CRT-PR-03', 'MONTHLY_PRESENTATION', 'technical_understanding', 'Technical Understanding', 3, 1.0, 10.0, TRUE),
  ('CRT-PR-04', 'MONTHLY_PRESENTATION', 'problem_solving', 'Problem Solving', 4, 1.0, 10.0, TRUE),
  ('CRT-PR-05', 'MONTHLY_PRESENTATION', 'presentation_delivery', 'Presentation Delivery', 5, 1.0, 10.0, TRUE),
  ('CRT-PR-06', 'MONTHLY_PRESENTATION', 'response_to_questions', 'Response to Questions', 6, 1.0, 10.0, TRUE),
  ('CRT-PR-07', 'MONTHLY_PRESENTATION', 'next_plan', 'Next Plan', 7, 1.0, 10.0, TRUE)
ON CONFLICT (period_type, key) DO UPDATE SET
  name = EXCLUDED.name,
  sort_order = EXCLUDED.sort_order;

-- 3. evaluation_assignments (for PM evaluations)
CREATE TABLE IF NOT EXISTS evaluation_assignments (
  id TEXT PRIMARY KEY,
  period_id TEXT NOT NULL REFERENCES evaluation_periods(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  evaluator_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  division_id TEXT REFERENCES research_divisions(id) ON DELETE SET NULL,
  division_name TEXT,
  project_id TEXT REFERENCES research_projects(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'DRAFT', 'SUBMITTED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (period_id, student_id, evaluator_id)
);

CREATE INDEX IF NOT EXISTS idx_evaluation_assignments_period ON evaluation_assignments(period_id);
CREATE INDEX IF NOT EXISTS idx_evaluation_assignments_evaluator ON evaluation_assignments(evaluator_id);
CREATE INDEX IF NOT EXISTS idx_evaluation_assignments_student ON evaluation_assignments(student_id);

-- 4. presentation_sessions (for Monthly Presentation)
CREATE TABLE IF NOT EXISTS presentation_sessions (
  id TEXT PRIMARY KEY,
  period_id TEXT NOT NULL REFERENCES evaluation_periods(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  session_date DATE NOT NULL,
  start_time TIME,
  end_time TIME,
  location TEXT,
  notes TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_presentation_sessions_period ON presentation_sessions(period_id);
CREATE INDEX IF NOT EXISTS idx_presentation_sessions_date ON presentation_sessions(session_date ASC);

-- 5. presentation_evaluators
CREATE TABLE IF NOT EXISTS presentation_evaluators (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES presentation_sessions(id) ON DELETE CASCADE,
  evaluator_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT,
  is_present BOOLEAN NOT NULL DEFAULT TRUE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (session_id, evaluator_id)
);

CREATE INDEX IF NOT EXISTS idx_presentation_evaluators_session ON presentation_evaluators(session_id);
CREATE INDEX IF NOT EXISTS idx_presentation_evaluators_evaluator ON presentation_evaluators(evaluator_id);

-- 6. presentation_slots
CREATE TABLE IF NOT EXISTS presentation_slots (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES presentation_sessions(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  slot_order INTEGER NOT NULL DEFAULT 1,
  start_time TIME,
  end_time TIME,
  status TEXT NOT NULL DEFAULT 'SCHEDULED'
    CHECK (status IN ('SCHEDULED', 'PRESENTING', 'COMPLETED', 'ABSENT', 'RESCHEDULED')),
  division_id TEXT REFERENCES research_divisions(id) ON DELETE SET NULL,
  division_name TEXT,
  project_id TEXT REFERENCES research_projects(id) ON DELETE SET NULL,
  topic TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (session_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_presentation_slots_session_order ON presentation_slots(session_id, slot_order ASC);
CREATE INDEX IF NOT EXISTS idx_presentation_slots_student ON presentation_slots(student_id);

-- 7. evaluation_submissions
CREATE TABLE IF NOT EXISTS evaluation_submissions (
  id TEXT PRIMARY KEY,
  period_id TEXT NOT NULL REFERENCES evaluation_periods(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  evaluator_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assignment_id TEXT REFERENCES evaluation_assignments(id) ON DELETE CASCADE,
  slot_id TEXT REFERENCES presentation_slots(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED')),
  overall_score NUMERIC(4, 2),
  strength TEXT,
  improvement TEXT,
  notes TEXT,
  submitted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_eval_submission_target CHECK (
    (assignment_id IS NOT NULL AND slot_id IS NULL) OR
    (slot_id IS NOT NULL AND assignment_id IS NULL)
  ),
  CONSTRAINT uq_eval_submission_assignment UNIQUE (assignment_id),
  CONSTRAINT uq_eval_submission_slot_evaluator UNIQUE (slot_id, evaluator_id)
);

CREATE INDEX IF NOT EXISTS idx_evaluation_submissions_period ON evaluation_submissions(period_id);
CREATE INDEX IF NOT EXISTS idx_evaluation_submissions_student ON evaluation_submissions(student_id);
CREATE INDEX IF NOT EXISTS idx_evaluation_submissions_evaluator ON evaluation_submissions(evaluator_id);

-- 8. evaluation_score_items
CREATE TABLE IF NOT EXISTS evaluation_score_items (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL REFERENCES evaluation_submissions(id) ON DELETE CASCADE,
  criteria_id TEXT NOT NULL REFERENCES evaluation_criteria(id) ON DELETE CASCADE,
  criteria_key TEXT NOT NULL,
  score NUMERIC(4, 2) NOT NULL CHECK (score >= 1.0 AND score <= 10.0),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (submission_id, criteria_id)
);

CREATE INDEX IF NOT EXISTS idx_evaluation_score_items_submission ON evaluation_score_items(submission_id);

-- Additive updates to existing research tables
ALTER TABLE research_divisions
  ADD COLUMN IF NOT EXISTS coordinator_id TEXT REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE research_memberships
  ADD COLUMN IF NOT EXISTS division_id TEXT REFERENCES research_divisions(id) ON DELETE SET NULL;

COMMIT;
