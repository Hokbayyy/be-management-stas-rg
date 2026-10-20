BEGIN;

-- =============================================================================
-- Migration 042: Forward-Only Reconciliation of Ambiguous Legacy Roles
-- & Capability Enforcement Metadata
-- =============================================================================

-- 1. Ensure capability metadata columns on rbac_permissions
ALTER TABLE rbac_permissions
  ADD COLUMN IF NOT EXISTS enforcement_status VARCHAR(20) NOT NULL DEFAULT 'ENFORCED',
  ADD COLUMN IF NOT EXISTS is_delegable BOOLEAN NOT NULL DEFAULT TRUE;

-- 2. Update capability enforcement statuses
UPDATE rbac_permissions SET enforcement_status = 'NOT_ENFORCED', is_delegable = FALSE
WHERE code IN ('research.member.manage', 'research.project.update');

UPDATE rbac_permissions SET enforcement_status = 'PARTIAL', is_delegable = TRUE
WHERE code IN ('lab.picket.manage');

UPDATE rbac_permissions SET enforcement_status = 'ENFORCED', is_delegable = TRUE
WHERE code IN (
  'research.project.read', 'research.division.manage',
  'scrum.sprint.view', 'scrum.sprint.manage', 'scrum.task.create',
  'scrum.task.edit_own', 'scrum.task.manage', 'scrum.meeting.manage',
  'evaluation.recap.view'
);

UPDATE rbac_permissions SET enforcement_status = 'ENFORCED', is_delegable = FALSE
WHERE code = 'evaluation.pm.evaluate';

-- 3. Create rbac_legacy_reconciliations table
CREATE TABLE IF NOT EXISTS rbac_legacy_reconciliations (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  legacy_peran TEXT NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'PENDING_RECONCILIATION' CHECK (status IN ('PENDING_RECONCILIATION', 'RECONCILED', 'IGNORED')),
  reconciled_role_id TEXT REFERENCES rbac_roles(id) ON DELETE SET NULL,
  reconciled_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  reconciled_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_rbac_reconciliation_student_project_peran
  ON rbac_legacy_reconciliations (student_id, project_id, legacy_peran);
CREATE INDEX IF NOT EXISTS idx_rbac_reconciliations_status ON rbac_legacy_reconciliations(status);

-- 4. Detect and record ambiguous roles from existing active research memberships
INSERT INTO rbac_legacy_reconciliations (
  id, student_id, project_id, legacy_peran, status, notes
)
SELECT
  'REC-LEG-' || s.id || '-' || rm.project_id || '-' || SUBSTRING(MD5(LOWER(TRIM(rm.peran))) FROM 1 FOR 8),
  s.id,
  rm.project_id,
  rm.peran,
  'PENDING_RECONCILIATION',
  'Peran ambigu terdeteksi dari migrasi legacy (memerlukan penelaahan manual oleh Admin).'
FROM research_memberships rm
JOIN students s ON s.user_id = rm.user_id
WHERE rm.member_type = 'Mahasiswa'
  AND COALESCE(rm.status, 'Aktif') = 'Aktif'
  AND (rm.selesai IS NULL OR rm.selesai >= CURRENT_DATE)
  AND LOWER(COALESCE(rm.peran, '')) ~* '\y(wakil|asisten|assistant|vice|co-|sub-)\y'
ON CONFLICT (student_id, project_id, legacy_peran) DO NOTHING;

-- 5. Safely revoke/delete ONLY auto-backfilled assignments (id LIKE 'SRA-BKF-%' and assigned_by IS NULL)
--    for students with ambiguous legacy roles, leaving manual assignments intact.
DELETE FROM student_role_assignments
WHERE id LIKE 'SRA-BKF-%'
  AND assigned_by IS NULL
  AND scope_type = 'PROJECT'
  AND role_id = 'ROL-CONTRIBUTOR'
  AND (student_id, scope_id) IN (
    SELECT s.id, rm.project_id
    FROM research_memberships rm
    JOIN students s ON s.user_id = rm.user_id
    WHERE rm.member_type = 'Mahasiswa'
      AND LOWER(COALESCE(rm.peran, '')) ~* '\y(wakil|asisten|assistant|vice|co-|sub-)\y'
  );

COMMIT;
