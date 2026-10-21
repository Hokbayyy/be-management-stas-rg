BEGIN;

-- =============================================================================
-- Migration 043: Unified Role Management V2
-- Expands rbac_roles with category (SYSTEM, FUNCTIONAL, DIVISION),
-- allowed_scope_types, protection flags, and retirement audit support.
-- =============================================================================

-- 1. Extend rbac_roles with category, allowed_scope_types, and protection columns
ALTER TABLE rbac_roles
  ADD COLUMN IF NOT EXISTS category VARCHAR(30) NOT NULL DEFAULT 'FUNCTIONAL',
  ADD COLUMN IF NOT EXISTS allowed_scope_types TEXT[] NOT NULL DEFAULT '{"LAB","PROJECT","DIVISION"}',
  ADD COLUMN IF NOT EXISTS is_protected BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

-- 2. Add constraint for valid categories if not present
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_rbac_roles_category'
  ) THEN
    ALTER TABLE rbac_roles
      ADD CONSTRAINT chk_rbac_roles_category
      CHECK (category IN ('SYSTEM', 'FUNCTIONAL', 'DIVISION'));
  END IF;
END $$;

-- 3. Update existing canonical system roles to category 'SYSTEM' and mark as protected
-- Preserves LAB / PROJECT / DIVISION scope compatibility for member/contributor and core roles
UPDATE rbac_roles
SET category = 'SYSTEM',
    is_system = TRUE,
    is_protected = TRUE,
    allowed_scope_types = CASE
      WHEN code IN ('CONTRIBUTOR', 'CORE_RESEARCHER') THEN '{"LAB","PROJECT","DIVISION"}'::text[]
      WHEN code = 'PROJECT_MANAGER' THEN '{"LAB","PROJECT"}'::text[]
      ELSE '{"PROJECT"}'::text[]
    END
WHERE code IN ('PROJECT_MANAGER', 'KETUA_RISET', 'CORE_RESEARCHER', 'CONTRIBUTOR')
   OR is_system = TRUE;

-- 4. Create indexes for category filtering
CREATE INDEX IF NOT EXISTS idx_rbac_roles_category ON rbac_roles(category);
CREATE INDEX IF NOT EXISTS idx_rbac_roles_active_category ON rbac_roles(is_active, category);

COMMIT;
