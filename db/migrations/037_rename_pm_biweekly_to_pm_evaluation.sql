BEGIN;

-- 1. Safely update evaluation_periods constraint & existing data
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'evaluation_periods'::regclass AND conname = 'evaluation_periods_type_check'
  ) THEN
    ALTER TABLE evaluation_periods DROP CONSTRAINT evaluation_periods_type_check;
  END IF;

  UPDATE evaluation_periods
  SET type = 'PM_EVALUATION'
  WHERE type = 'PM_BIWEEKLY';

  ALTER TABLE evaluation_periods ADD CONSTRAINT evaluation_periods_type_check
    CHECK (type IN ('PM_EVALUATION', 'MONTHLY_PRESENTATION'));
END $$;

-- 2. Safely update evaluation_criteria constraint & existing data
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'evaluation_criteria'::regclass AND conname = 'evaluation_criteria_period_type_check'
  ) THEN
    ALTER TABLE evaluation_criteria DROP CONSTRAINT evaluation_criteria_period_type_check;
  END IF;

  UPDATE evaluation_criteria
  SET period_type = 'PM_EVALUATION'
  WHERE period_type = 'PM_BIWEEKLY';

  ALTER TABLE evaluation_criteria ADD CONSTRAINT evaluation_criteria_period_type_check
    CHECK (period_type IN ('PM_EVALUATION', 'MONTHLY_PRESENTATION'));
END $$;

-- 3. Upsert evaluation_criteria for PM_EVALUATION
INSERT INTO evaluation_criteria (id, period_type, key, name, sort_order, min_score, max_score, is_active)
VALUES
  ('CRT-PM-01', 'PM_EVALUATION', 'quality_of_work', 'Quality of Work', 1, 1.0, 10.0, TRUE),
  ('CRT-PM-02', 'PM_EVALUATION', 'responsibility', 'Responsibility', 2, 1.0, 10.0, TRUE),
  ('CRT-PM-03', 'PM_EVALUATION', 'technical_skill', 'Technical Skill', 3, 1.0, 10.0, TRUE),
  ('CRT-PM-04', 'PM_EVALUATION', 'problem_solving', 'Problem Solving', 4, 1.0, 10.0, TRUE),
  ('CRT-PM-05', 'PM_EVALUATION', 'collaboration', 'Collaboration', 5, 1.0, 10.0, TRUE),
  ('CRT-PM-06', 'PM_EVALUATION', 'initiative', 'Initiative', 6, 1.0, 10.0, TRUE),
  ('CRT-PM-07', 'PM_EVALUATION', 'research_contribution', 'Research Contribution', 7, 1.0, 10.0, TRUE)
ON CONFLICT (period_type, key) DO UPDATE SET
  name = EXCLUDED.name,
  sort_order = EXCLUDED.sort_order;

COMMIT;
