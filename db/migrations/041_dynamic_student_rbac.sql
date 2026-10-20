BEGIN;

-- =============================================================================
-- Migration 041: Dynamic Student RBAC V1.0
-- Foundation for dynamic student roles, capability-based permissions,
-- multi-role scoping (LAB, PROJECT, DIVISION), and audit logging.
-- =============================================================================

-- 1. rbac_roles: Catalog of dynamic roles
CREATE TABLE IF NOT EXISTS rbac_roles (
  id TEXT PRIMARY KEY,
  code VARCHAR(50) UNIQUE NOT NULL,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  version INTEGER NOT NULL DEFAULT 1,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rbac_roles_active_code ON rbac_roles(is_active, code);

-- 2. rbac_permissions: Catalog of registered backend capabilities
CREATE TABLE IF NOT EXISTS rbac_permissions (
  id TEXT PRIMARY KEY,
  code VARCHAR(80) UNIQUE NOT NULL,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  module VARCHAR(50) NOT NULL,
  allowed_scope_types TEXT[] NOT NULL DEFAULT '{"LAB","PROJECT","DIVISION"}',
  enforcement_status VARCHAR(20) NOT NULL DEFAULT 'ENFORCED',
  is_protected BOOLEAN NOT NULL DEFAULT FALSE,
  is_delegable BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rbac_permissions_module ON rbac_permissions(module);

-- 3. rbac_role_permissions: Mapping of roles to granted capabilities
CREATE TABLE IF NOT EXISTS rbac_role_permissions (
  role_id TEXT NOT NULL REFERENCES rbac_roles(id) ON DELETE CASCADE,
  permission_id TEXT NOT NULL REFERENCES rbac_permissions(id) ON DELETE CASCADE,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  granted_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY (role_id, permission_id)
);

-- 4. student_role_assignments: Multi-role scoped assignments
CREATE TABLE IF NOT EXISTS student_role_assignments (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  role_id TEXT NOT NULL REFERENCES rbac_roles(id) ON DELETE CASCADE,
  scope_type VARCHAR(20) NOT NULL CHECK (scope_type IN ('LAB', 'PROJECT', 'DIVISION')),
  scope_id TEXT,
  assigned_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  revoked_at TIMESTAMPTZ,
  revoked_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  revocation_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_student_active_role_scope
  ON student_role_assignments (student_id, role_id, scope_type, COALESCE(scope_id, 'GLOBAL_LAB'))
  WHERE is_active = TRUE AND revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_student_role_assignments_student ON student_role_assignments(student_id);
CREATE INDEX IF NOT EXISTS idx_student_role_assignments_scope ON student_role_assignments(scope_type, scope_id);
CREATE INDEX IF NOT EXISTS idx_student_role_assignments_active ON student_role_assignments(is_active, expires_at);

-- 5. rbac_legacy_role_mappings: Explicit mappings of legacy roles to canonical roles
CREATE TABLE IF NOT EXISTS rbac_legacy_role_mappings (
  id TEXT PRIMARY KEY,
  legacy_role_pattern TEXT NOT NULL UNIQUE,
  canonical_role_id TEXT NOT NULL REFERENCES rbac_roles(id) ON DELETE CASCADE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. rbac_audit_logs: Persistent trail of role, permission, and assignment changes
CREATE TABLE IF NOT EXISTS rbac_audit_logs (
  id TEXT PRIMARY KEY,
  actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  actor_role TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  detail JSONB NOT NULL DEFAULT '{}',
  ip INET,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rbac_audit_logs_target ON rbac_audit_logs(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_rbac_audit_logs_actor ON rbac_audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_rbac_audit_logs_created ON rbac_audit_logs(created_at DESC);

-- 7. rbac_legacy_reconciliations: Tracking and manual reconciliation of ambiguous legacy roles
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

-- =============================================================================
-- Seed Registered Capabilities
-- =============================================================================

INSERT INTO rbac_permissions (id, code, name, description, module, allowed_scope_types, enforcement_status, is_protected, is_delegable)
VALUES
  ('PRM-RES-01', 'research.project.read', 'Lihat Riset', 'Melihat detail proyek riset dan daftar anggota.', 'RESEARCH', '{"LAB","PROJECT"}', 'ENFORCED', FALSE, TRUE),
  ('PRM-RES-02', 'research.project.update', 'Perbarui Riset', 'Mengubah deskripsi atau pengaturan proyek riset.', 'RESEARCH', '{"LAB","PROJECT"}', 'NOT_ENFORCED', FALSE, FALSE),
  ('PRM-RES-03', 'research.member.manage', 'Kelola Anggota Riset', 'Menambahkan atau mengelola anggota proyek riset.', 'RESEARCH', '{"LAB","PROJECT"}', 'NOT_ENFORCED', FALSE, FALSE),
  ('PRM-RES-04', 'research.division.manage', 'Kelola Divisi Riset', 'Mengelola divisi di dalam proyek riset.', 'RESEARCH', '{"LAB","PROJECT","DIVISION"}', 'ENFORCED', FALSE, TRUE),
  ('PRM-SCR-01', 'scrum.sprint.view', 'Lihat Sprint', 'Melihat sprint planning, task board, dan sprint review.', 'SCRUM', '{"LAB","PROJECT"}', 'ENFORCED', FALSE, TRUE),
  ('PRM-SCR-02', 'scrum.sprint.manage', 'Kelola Sprint', 'Membuat, mengubah, memulai, dan menutup sprint serta milestone.', 'SCRUM', '{"LAB","PROJECT"}', 'ENFORCED', FALSE, TRUE),
  ('PRM-SCR-03', 'scrum.task.create', 'Buat Tugas', 'Membuat task card baru pada board.', 'SCRUM', '{"LAB","PROJECT","DIVISION"}', 'ENFORCED', FALSE, TRUE),
  ('PRM-SCR-04', 'scrum.task.edit_own', 'Ubah Tugas Mandiri', 'Mengubah status, progress, dan subtask pada tugas milik sendiri.', 'SCRUM', '{"LAB","PROJECT","DIVISION"}', 'ENFORCED', FALSE, TRUE),
  ('PRM-SCR-05', 'scrum.task.manage', 'Kelola Seluruh Tugas', 'Mengelola, memindahkan, menetapkan assignee, atau menghapus kartu tugas.', 'SCRUM', '{"LAB","PROJECT","DIVISION"}', 'ENFORCED', FALSE, TRUE),
  ('PRM-SCR-06', 'scrum.meeting.manage', 'Kelola Meeting Review', 'Membuat dan mengelola meeting sprint review serta absensi peserta.', 'SCRUM', '{"LAB","PROJECT"}', 'ENFORCED', FALSE, TRUE),
  ('PRM-EVA-01', 'evaluation.pm.evaluate', 'Isi Evaluasi PM', 'Mengisi penilaian PM untuk penugasan yang diberikan.', 'EVALUATION', '{"LAB","PROJECT"}', 'ENFORCED', FALSE, FALSE),
  ('PRM-EVA-02', 'evaluation.recap.view', 'Lihat Rekap Evaluasi', 'Melihat rekap kemajuan penilaian evaluasi dalam scope terkait.', 'EVALUATION', '{"LAB","PROJECT"}', 'ENFORCED', FALSE, TRUE),
  ('PRM-LAB-01', 'lab.picket.manage', 'Kelola Piket', 'Membantu koordinasi dan pengelolaan jadwal piket lab.', 'LAB', '{"LAB"}', 'PARTIAL', FALSE, TRUE)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  module = EXCLUDED.module,
  allowed_scope_types = EXCLUDED.allowed_scope_types,
  enforcement_status = EXCLUDED.enforcement_status,
  is_protected = EXCLUDED.is_protected,
  is_delegable = EXCLUDED.is_delegable;

-- =============================================================================
-- Seed Canonical Roles
-- =============================================================================

INSERT INTO rbac_roles (id, code, name, description, is_system, is_active, version)
VALUES
  ('ROL-PROJECT-MANAGER', 'PROJECT_MANAGER', 'Project Manager', 'Memimpin manajemen riset, sprint, pembagian tugas, dan evaluasi PM.', TRUE, TRUE, 1),
  ('ROL-KETUA-RISET', 'KETUA_RISET', 'Ketua Riset', 'Memimpin arah riset, pengelolaan sprint, milestone, dan anggota riset.', TRUE, TRUE, 1),
  ('ROL-CORE-RESEARCHER', 'CORE_RESEARCHER', 'Core Researcher', 'Peneliti utama dengan akses pembuatan task, pengelolaan sprint, dan kolaborasi.', TRUE, TRUE, 1),
  ('ROL-CONTRIBUTOR', 'CONTRIBUTOR', 'Contributor / Member', 'Anggota riset yang berfokus pada pengerjaan tugas dan kolaborasi.', TRUE, TRUE, 1)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  is_system = EXCLUDED.is_system;

-- =============================================================================
-- Seed Canonical Role Permissions
-- =============================================================================

-- PROJECT_MANAGER Permissions
INSERT INTO rbac_role_permissions (role_id, permission_id)
SELECT 'ROL-PROJECT-MANAGER', p.id
FROM rbac_permissions p
WHERE p.code IN (
  'research.project.read', 'research.project.update', 'research.member.manage', 'research.division.manage',
  'scrum.sprint.view', 'scrum.sprint.manage', 'scrum.task.create', 'scrum.task.manage',
  'scrum.meeting.manage', 'evaluation.pm.evaluate', 'evaluation.recap.view'
)
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- KETUA_RISET Permissions
INSERT INTO rbac_role_permissions (role_id, permission_id)
SELECT 'ROL-KETUA-RISET', p.id
FROM rbac_permissions p
WHERE p.code IN (
  'research.project.read', 'research.project.update', 'research.division.manage',
  'scrum.sprint.view', 'scrum.sprint.manage', 'scrum.task.create', 'scrum.task.manage',
  'scrum.meeting.manage', 'evaluation.recap.view'
)
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- CORE_RESEARCHER Permissions
INSERT INTO rbac_role_permissions (role_id, permission_id)
SELECT 'ROL-CORE-RESEARCHER', p.id
FROM rbac_permissions p
WHERE p.code IN (
  'research.project.read', 'scrum.sprint.view', 'scrum.task.create',
  'scrum.task.edit_own', 'scrum.task.manage'
)
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- CONTRIBUTOR Permissions
INSERT INTO rbac_role_permissions (role_id, permission_id)
SELECT 'ROL-CONTRIBUTOR', p.id
FROM rbac_permissions p
WHERE p.code IN (
  'research.project.read', 'scrum.sprint.view', 'scrum.task.create', 'scrum.task.edit_own'
)
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- =============================================================================
-- Seed Legacy Role Mappings
-- =============================================================================

INSERT INTO rbac_legacy_role_mappings (id, legacy_role_pattern, canonical_role_id, notes)
VALUES
  ('MAP-01', 'ketua', 'ROL-KETUA-RISET', 'Pola peran mengandung ketua'),
  ('MAP-02', 'leader', 'ROL-KETUA-RISET', 'Pola peran mengandung leader'),
  ('MAP-03', 'project manager', 'ROL-PROJECT-MANAGER', 'Pola peran Project Manager'),
  ('MAP-04', 'pm', 'ROL-PROJECT-MANAGER', 'Pola peran PM'),
  ('MAP-05', 'core', 'ROL-CORE-RESEARCHER', 'Pola peran Core Developer/Researcher'),
  ('MAP-06', 'lead', 'ROL-CORE-RESEARCHER', 'Pola peran Lead / Tech Lead'),
  ('MAP-07', 'anggota', 'ROL-CONTRIBUTOR', 'Pola peran Anggota / Contributor'),
  ('MAP-08', 'member', 'ROL-CONTRIBUTOR', 'Pola peran Member')
ON CONFLICT (legacy_role_pattern) DO UPDATE SET
  canonical_role_id = EXCLUDED.canonical_role_id,
  notes = EXCLUDED.notes;

-- =============================================================================
-- Safe Deterministic Backfill of Existing Research Memberships
-- Ambiguous subordinate roles (wakil, asisten, assistant, vice, co-, sub-) are EXCLUDED
-- from automatic role assignments and registered as PENDING_RECONCILIATION.
-- =============================================================================

INSERT INTO rbac_legacy_reconciliations (
  id, student_id, project_id, legacy_peran, status, notes
)
SELECT
  'REC-LEG-' || s.id || '-' || rm.project_id || '-' || SUBSTRING(MD5(LOWER(TRIM(rm.peran))) FROM 1 FOR 8) AS id,
  s.id AS student_id,
  rm.project_id,
  rm.peran AS legacy_peran,
  'PENDING_RECONCILIATION' AS status,
  'Peran ambigu terdeteksi dari migrasi legacy (memerlukan penelaahan manual oleh Admin).' AS notes
FROM research_memberships rm
JOIN students s ON s.user_id = rm.user_id
WHERE rm.member_type = 'Mahasiswa'
  AND COALESCE(rm.status, 'Aktif') = 'Aktif'
  AND (rm.selesai IS NULL OR rm.selesai >= CURRENT_DATE)
  AND LOWER(COALESCE(rm.peran, '')) ~* '\y(wakil|asisten|assistant|vice|co-|sub-)\y'
ON CONFLICT (student_id, project_id, legacy_peran) DO NOTHING;

INSERT INTO student_role_assignments (
  id, student_id, role_id, scope_type, scope_id, assigned_by, assigned_at, is_active
)
SELECT
  'SRA-BKF-' || s.id || '-' || rm.project_id AS id,
  s.id AS student_id,
  CASE
    WHEN LOWER(COALESCE(rm.peran, '')) ~* '\y(ketua|ketua riset|ketua peneliti|research lead)\y' THEN 'ROL-KETUA-RISET'
    WHEN LOWER(COALESCE(rm.peran, '')) ~* '\y(project manager|pm|manajer proyek)\y' THEN 'ROL-PROJECT-MANAGER'
    WHEN LOWER(COALESCE(rm.peran, '')) ~* '\y(core developer|core researcher|peneliti utama|lead developer)\y' THEN 'ROL-CORE-RESEARCHER'
    ELSE 'ROL-CONTRIBUTOR'
  END AS role_id,
  'PROJECT' AS scope_type,
  rm.project_id AS scope_id,
  NULL AS assigned_by,
  NOW() AS assigned_at,
  TRUE AS is_active
FROM research_memberships rm
JOIN students s ON s.user_id = rm.user_id
WHERE rm.member_type = 'Mahasiswa'
  AND COALESCE(rm.status, 'Aktif') = 'Aktif'
  AND (rm.selesai IS NULL OR rm.selesai >= CURRENT_DATE)
  AND NOT (LOWER(COALESCE(rm.peran, '')) ~* '\y(wakil|asisten|assistant|vice|co-|sub-)\y')
ON CONFLICT (student_id, role_id, scope_type, COALESCE(scope_id, 'GLOBAL_LAB'))
  WHERE is_active = TRUE AND revoked_at IS NULL
DO NOTHING;

COMMIT;
