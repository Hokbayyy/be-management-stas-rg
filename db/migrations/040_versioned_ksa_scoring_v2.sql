BEGIN;

-- =============================================================================
-- Migration 040: Versioned KSA Scoring V2
-- Supports: PM_V1_7CRITERIA, PM_V2_KSA, PRESENTATION_V1_7CRITERIA, PRESENTATION_V2_KSA
-- =============================================================================

-- 1. evaluation_periods: add scoring_version column
ALTER TABLE evaluation_periods
  ADD COLUMN IF NOT EXISTS scoring_version TEXT;

-- Deterministic backfill of existing periods based on type
UPDATE evaluation_periods
SET scoring_version = 'PM_V1_7CRITERIA'
WHERE (type = 'PM_EVALUATION' OR type = 'PM_BIWEEKLY') AND scoring_version IS NULL;

UPDATE evaluation_periods
SET scoring_version = 'PRESENTATION_V1_7CRITERIA'
WHERE type = 'MONTHLY_PRESENTATION' AND scoring_version IS NULL;

-- Enforce check constraint on evaluation_periods scoring_version
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'evaluation_periods'::regclass AND conname = 'chk_evaluation_periods_scoring_version'
  ) THEN
    ALTER TABLE evaluation_periods
      ADD CONSTRAINT chk_evaluation_periods_scoring_version
      CHECK (scoring_version IN ('PM_V1_7CRITERIA', 'PM_V2_KSA', 'PRESENTATION_V1_7CRITERIA', 'PRESENTATION_V2_KSA'));
  END IF;
END $$;

-- 2. evaluation_criteria: add scoring_version and weight columns
ALTER TABLE evaluation_criteria
  ADD COLUMN IF NOT EXISTS scoring_version TEXT,
  ADD COLUMN IF NOT EXISTS weight DOUBLE PRECISION NOT NULL DEFAULT 1.0;

-- Backfill existing criteria rows with their V1 scoring versions
UPDATE evaluation_criteria
SET scoring_version = 'PM_V1_7CRITERIA',
    weight = 1.0 / 7.0
WHERE (period_type = 'PM_EVALUATION' OR period_type = 'PM_BIWEEKLY') AND (scoring_version IS NULL OR scoring_version = 'PM_V1_7CRITERIA');

UPDATE evaluation_criteria
SET scoring_version = 'PRESENTATION_V1_7CRITERIA',
    weight = 1.0 / 7.0
WHERE period_type = 'MONTHLY_PRESENTATION' AND (scoring_version IS NULL OR scoring_version = 'PRESENTATION_V1_7CRITERIA');

-- Safely drop old unique constraint (period_type, key) if present
ALTER TABLE evaluation_criteria DROP CONSTRAINT IF EXISTS evaluation_criteria_period_type_key_key;

-- Add check constraint and new unique constraint (scoring_version, key)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'evaluation_criteria'::regclass AND conname = 'chk_evaluation_criteria_scoring_version'
  ) THEN
    ALTER TABLE evaluation_criteria
      ADD CONSTRAINT chk_evaluation_criteria_scoring_version
      CHECK (scoring_version IN ('PM_V1_7CRITERIA', 'PM_V2_KSA', 'PRESENTATION_V1_7CRITERIA', 'PRESENTATION_V2_KSA'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'evaluation_criteria'::regclass AND conname = 'uq_evaluation_criteria_version_key'
  ) THEN
    ALTER TABLE evaluation_criteria
      ADD CONSTRAINT uq_evaluation_criteria_version_key
      UNIQUE (scoring_version, key);
  END IF;
END $$;

-- 3. Seed KSA V2 criteria for PM_EVALUATION and MONTHLY_PRESENTATION
INSERT INTO evaluation_criteria (
  id, period_type, scoring_version, key, name, description, weight, sort_order, min_score, max_score, is_active
)
VALUES
  (
    'CRT-PM-V2-01',
    'PM_EVALUATION',
    'PM_V2_KSA',
    'knowledge',
    'Knowledge',
    'Pemahaman konsep, teknologi, sistem, dan metodologi pekerjaan.',
    1.0 / 3.0,
    1,
    1.0,
    10.0,
    TRUE
  ),
  (
    'CRT-PM-V2-02',
    'PM_EVALUATION',
    'PM_V2_KSA',
    'skill',
    'Skill',
    'Kemampuan teknis, problem solving, penggunaan tools, serta kualitas pengerjaan.',
    1.0 / 3.0,
    2,
    1.0,
    10.0,
    TRUE
  ),
  (
    'CRT-PM-V2-03',
    'PM_EVALUATION',
    'PM_V2_KSA',
    'application',
    'Application',
    'Penerapan kemampuan dalam tugas, kualitas deliverable, dan kontribusi nyata terhadap proyek/riset.',
    1.0 / 3.0,
    3,
    1.0,
    10.0,
    TRUE
  ),
  (
    'CRT-PR-V2-01',
    'MONTHLY_PRESENTATION',
    'PRESENTATION_V2_KSA',
    'knowledge',
    'Knowledge',
    'Penguasaan materi, pemahaman teknis, dan alasan keputusan yang dipresentasikan.',
    1.0 / 3.0,
    1,
    1.0,
    10.0,
    TRUE
  ),
  (
    'CRT-PR-V2-02',
    'MONTHLY_PRESENTATION',
    'PRESENTATION_V2_KSA',
    'skill',
    'Skill',
    'Kemampuan demonstrasi, komunikasi teknis, analisis, dan menjawab pertanyaan.',
    1.0 / 3.0,
    2,
    1.0,
    10.0,
    TRUE
  ),
  (
    'CRT-PR-V2-03',
    'MONTHLY_PRESENTATION',
    'PRESENTATION_V2_KSA',
    'application',
    'Application',
    'Bukti implementasi, hasil pekerjaan/riset, serta relevansi solusi yang dipresentasikan.',
    1.0 / 3.0,
    3,
    1.0,
    10.0,
    TRUE
  )
ON CONFLICT (id) DO UPDATE SET
  period_type = EXCLUDED.period_type,
  scoring_version = EXCLUDED.scoring_version,
  key = EXCLUDED.key,
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  weight = EXCLUDED.weight,
  sort_order = EXCLUDED.sort_order,
  min_score = EXCLUDED.min_score,
  max_score = EXCLUDED.max_score,
  is_active = EXCLUDED.is_active;

COMMIT;
