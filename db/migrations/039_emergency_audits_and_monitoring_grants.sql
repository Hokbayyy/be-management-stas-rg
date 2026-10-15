BEGIN;

-- 1. evaluation_emergency_audits
-- Persistently tracks all emergency actions on CLOSED evaluation periods.
-- NOTE: period_id has NO foreign key constraint so that audit records survive physical deletion of periods.
CREATE TABLE IF NOT EXISTS evaluation_emergency_audits (
  id TEXT PRIMARY KEY,
  period_id TEXT NOT NULL,
  period_title TEXT NOT NULL,
  period_type TEXT NOT NULL,
  period_status_before TEXT NOT NULL,
  actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  actor_name TEXT,
  actor_role TEXT,
  action_type TEXT NOT NULL,
  reason TEXT NOT NULL,
  affected_records_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  execution_status TEXT NOT NULL CHECK (execution_status IN ('SUCCESS', 'FAILURE')),
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_evaluation_emergency_audits_period ON evaluation_emergency_audits(period_id);
CREATE INDEX IF NOT EXISTS idx_evaluation_emergency_audits_actor ON evaluation_emergency_audits(actor_id);
CREATE INDEX IF NOT EXISTS idx_evaluation_emergency_audits_created ON evaluation_emergency_audits(created_at);

-- 2. evaluation_monitoring_grants
-- Explicit, scope-aware monitoring permissions for Dosen to view other PMs' evaluations after period is CLOSED.
CREATE TABLE IF NOT EXISTS evaluation_monitoring_grants (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period_id TEXT REFERENCES evaluation_periods(id) ON DELETE CASCADE,
  group_id TEXT REFERENCES evaluation_groups(id) ON DELETE CASCADE,
  granted_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  revoked_by TEXT REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_evaluation_monitoring_grants_user ON evaluation_monitoring_grants(user_id);
CREATE INDEX IF NOT EXISTS idx_evaluation_monitoring_grants_period ON evaluation_monitoring_grants(period_id);
CREATE INDEX IF NOT EXISTS idx_evaluation_monitoring_grants_group ON evaluation_monitoring_grants(group_id);
CREATE INDEX IF NOT EXISTS idx_evaluation_monitoring_grants_active ON evaluation_monitoring_grants(is_active);

COMMIT;
