const crypto = require("crypto");
const { pool, query } = require("../db/pool");
const { resolveStudentRecord } = require("./studentResolver");

function buildId(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
}

function createHttpError(message, statusCode = 400) {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.status = statusCode;
  return err;
}

async function runQuery(executor, sql, params = []) {
  if (typeof executor === "function") {
    return executor(sql, params);
  }
  if (executor && typeof executor.query === "function") {
    return executor.query(sql, params);
  }
  return query(sql, params);
}

// =============================================================================
// REGISTERED CAPABILITIES & CANONICAL ROLES
// =============================================================================

const REGISTERED_PERMISSIONS = [
  {
    code: "research.project.read",
    name: "Lihat Riset",
    description: "Melihat detail proyek riset dan daftar anggota.",
    module: "RESEARCH",
    allowedScopeTypes: ["LAB", "PROJECT"],
    enforcementStatus: "ENFORCED",
    isProtected: false,
    isDelegable: true
  },
  {
    code: "research.project.update",
    name: "Perbarui Riset",
    description: "Mengubah deskripsi atau pengaturan proyek riset.",
    module: "RESEARCH",
    allowedScopeTypes: ["LAB", "PROJECT"],
    enforcementStatus: "NOT_ENFORCED",
    isProtected: false,
    isDelegable: false
  },
  {
    code: "research.member.manage",
    name: "Kelola Anggota Riset",
    description: "Menambahkan atau mengelola anggota proyek riset.",
    module: "RESEARCH",
    allowedScopeTypes: ["LAB", "PROJECT"],
    enforcementStatus: "NOT_ENFORCED",
    isProtected: false,
    isDelegable: false
  },
  {
    code: "research.division.manage",
    name: "Kelola Divisi Riset",
    description: "Mengelola divisi di dalam proyek riset.",
    module: "RESEARCH",
    allowedScopeTypes: ["LAB", "PROJECT", "DIVISION"],
    enforcementStatus: "ENFORCED",
    isProtected: false,
    isDelegable: true
  },
  {
    code: "scrum.sprint.view",
    name: "Lihat Sprint",
    description: "Melihat sprint planning, task board, dan sprint review.",
    module: "SCRUM",
    allowedScopeTypes: ["LAB", "PROJECT"],
    enforcementStatus: "ENFORCED",
    isProtected: false,
    isDelegable: true
  },
  {
    code: "scrum.sprint.manage",
    name: "Kelola Sprint",
    description: "Membuat, mengubah, memulai, dan menutup sprint serta milestone.",
    module: "SCRUM",
    allowedScopeTypes: ["LAB", "PROJECT"],
    enforcementStatus: "ENFORCED",
    isProtected: false,
    isDelegable: true
  },
  {
    code: "scrum.task.create",
    name: "Buat Tugas",
    description: "Membuat task card baru pada board.",
    module: "SCRUM",
    allowedScopeTypes: ["LAB", "PROJECT", "DIVISION"],
    enforcementStatus: "ENFORCED",
    isProtected: false,
    isDelegable: true
  },
  {
    code: "scrum.task.edit_own",
    name: "Ubah Tugas Mandiri",
    description: "Mengubah status, progress, dan subtask pada tugas milik sendiri.",
    module: "SCRUM",
    allowedScopeTypes: ["LAB", "PROJECT", "DIVISION"],
    enforcementStatus: "ENFORCED",
    isProtected: false,
    isDelegable: true
  },
  {
    code: "scrum.task.manage",
    name: "Kelola Seluruh Tugas",
    description: "Mengelola, memindahkan, menetapkan assignee, atau menghapus kartu tugas.",
    module: "SCRUM",
    allowedScopeTypes: ["LAB", "PROJECT", "DIVISION"],
    enforcementStatus: "ENFORCED",
    isProtected: false,
    isDelegable: true
  },
  {
    code: "scrum.meeting.manage",
    name: "Kelola Meeting Review",
    description: "Membuat dan mengelola meeting sprint review serta absensi peserta.",
    module: "SCRUM",
    allowedScopeTypes: ["LAB", "PROJECT"],
    enforcementStatus: "ENFORCED",
    isProtected: false,
    isDelegable: true
  },
  {
    code: "evaluation.pm.evaluate",
    name: "Isi Evaluasi PM",
    description: "Mengisi penilaian PM untuk penugasan yang diberikan.",
    module: "EVALUATION",
    allowedScopeTypes: ["LAB", "PROJECT"],
    enforcementStatus: "ENFORCED",
    isProtected: false,
    isDelegable: false
  },
  {
    code: "evaluation.recap.view",
    name: "Lihat Rekap Evaluasi",
    description: "Melihat rekap kemajuan penilaian evaluasi dalam scope terkait.",
    module: "EVALUATION",
    allowedScopeTypes: ["LAB", "PROJECT"],
    enforcementStatus: "ENFORCED",
    isProtected: false,
    isDelegable: true
  },
  {
    code: "lab.picket.manage",
    name: "Kelola Piket",
    description: "Membantu koordinasi dan pengelolaan jadwal piket lab.",
    module: "LAB",
    allowedScopeTypes: ["LAB"],
    enforcementStatus: "PARTIAL",
    isProtected: false,
    isDelegable: true
  }
];

const REGISTERED_PERMISSION_CODES = new Set(REGISTERED_PERMISSIONS.map((p) => p.code));

const PROTECTED_PERMISSION_PATTERNS = [
  /^\*$/,
  /^admin(\..*)?$/i,
  /^operator(\..*)?$/i,
  /^emergency(\..*)?$/i,
  /^audit\.delete$/i,
  /^user\.delete$/i
];

function isProtectedPermission(code) {
  const norm = String(code || "").trim();
  return PROTECTED_PERMISSION_PATTERNS.some((pattern) => pattern.test(norm));
}

const CANONICAL_ROLES = [
  {
    id: "ROL-PROJECT-MANAGER",
    code: "PROJECT_MANAGER",
    name: "Project Manager",
    description: "Memimpin manajemen riset, sprint, pembagian tugas, dan evaluasi PM.",
    permissions: [
      "research.project.read",
      "research.project.update",
      "research.member.manage",
      "research.division.manage",
      "scrum.sprint.view",
      "scrum.sprint.manage",
      "scrum.task.create",
      "scrum.task.manage",
      "scrum.meeting.manage",
      "evaluation.pm.evaluate",
      "evaluation.recap.view"
    ]
  },
  {
    id: "ROL-KETUA-RISET",
    code: "KETUA_RISET",
    name: "Ketua Riset",
    description: "Memimpin arah riset, pengelolaan sprint, milestone, dan anggota riset.",
    permissions: [
      "research.project.read",
      "research.project.update",
      "research.division.manage",
      "scrum.sprint.view",
      "scrum.sprint.manage",
      "scrum.task.create",
      "scrum.task.manage",
      "scrum.meeting.manage",
      "evaluation.recap.view"
    ]
  },
  {
    id: "ROL-CORE-RESEARCHER",
    code: "CORE_RESEARCHER",
    name: "Core Researcher",
    description: "Peneliti utama dengan akses pembuatan task, pengelolaan sprint, dan kolaborasi.",
    permissions: [
      "research.project.read",
      "scrum.sprint.view",
      "scrum.task.create",
      "scrum.task.edit_own",
      "scrum.task.manage"
    ]
  },
  {
    id: "ROL-CONTRIBUTOR",
    code: "CONTRIBUTOR",
    name: "Contributor / Member",
    description: "Anggota riset yang berfokus pada pengerjaan tugas dan kolaborasi.",
    permissions: [
      "research.project.read",
      "scrum.sprint.view",
      "scrum.task.create",
      "scrum.task.edit_own"
    ]
  }
];

const LEGACY_ROLE_MAPPINGS = [
  { id: "MAP-01", pattern: "ketua", canonicalRole: "ROL-KETUA-RISET" },
  { id: "MAP-02", pattern: "leader", canonicalRole: "ROL-KETUA-RISET" },
  { id: "MAP-03", pattern: "project manager", canonicalRole: "ROL-PROJECT-MANAGER" },
  { id: "MAP-04", pattern: "pm", canonicalRole: "ROL-PROJECT-MANAGER" },
  { id: "MAP-05", pattern: "core", canonicalRole: "ROL-CORE-RESEARCHER" },
  { id: "MAP-06", pattern: "lead", canonicalRole: "ROL-CORE-RESEARCHER" },
  { id: "MAP-07", pattern: "anggota", canonicalRole: "ROL-CONTRIBUTOR" },
  { id: "MAP-08", pattern: "member", canonicalRole: "ROL-CONTRIBUTOR" }
];

let tablesEnsured = false;

async function ensureRbacTables(executor = query) {
  if (tablesEnsured) return;

  await runQuery(
    executor,
    `
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

    ALTER TABLE rbac_permissions
      ADD COLUMN IF NOT EXISTS enforcement_status VARCHAR(20) NOT NULL DEFAULT 'ENFORCED',
      ADD COLUMN IF NOT EXISTS is_delegable BOOLEAN NOT NULL DEFAULT TRUE;

    CREATE TABLE IF NOT EXISTS rbac_role_permissions (
      role_id TEXT NOT NULL REFERENCES rbac_roles(id) ON DELETE CASCADE,
      permission_id TEXT NOT NULL REFERENCES rbac_permissions(id) ON DELETE CASCADE,
      granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      granted_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      PRIMARY KEY (role_id, permission_id)
    );

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

    CREATE TABLE IF NOT EXISTS rbac_legacy_role_mappings (
      id TEXT PRIMARY KEY,
      legacy_role_pattern TEXT NOT NULL UNIQUE,
      canonical_role_id TEXT NOT NULL REFERENCES rbac_roles(id) ON DELETE CASCADE,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

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
    `
  );

  // Seed permissions
  for (let i = 0; i < REGISTERED_PERMISSIONS.length; i++) {
    const p = REGISTERED_PERMISSIONS[i];
    const permId = `PRM-STD-${String(i + 1).padStart(2, "0")}`;
    await runQuery(
      executor,
      `
      INSERT INTO rbac_permissions (id, code, name, description, module, allowed_scope_types, enforcement_status, is_protected, is_delegable)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (code) DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        module = EXCLUDED.module,
        allowed_scope_types = EXCLUDED.allowed_scope_types,
        enforcement_status = EXCLUDED.enforcement_status,
        is_protected = EXCLUDED.is_protected,
        is_delegable = EXCLUDED.is_delegable
      `,
      [permId, p.code, p.name, p.description, p.module, p.allowedScopeTypes, p.enforcementStatus || "ENFORCED", p.isProtected, p.isDelegable !== false]
    );
  }

  // Seed canonical roles & permissions
  for (const r of CANONICAL_ROLES) {
    await runQuery(
      executor,
      `
      INSERT INTO rbac_roles (id, code, name, description, is_system, is_active, version)
      VALUES ($1, $2, $3, $4, TRUE, TRUE, 1)
      ON CONFLICT (code) DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        is_system = TRUE
      `,
      [r.id, r.code, r.name, r.description]
    );

    for (const pCode of r.permissions) {
      await runQuery(
        executor,
        `
        INSERT INTO rbac_role_permissions (role_id, permission_id)
        SELECT $1, p.id
        FROM rbac_permissions p
        WHERE p.code = $2
        ON CONFLICT (role_id, permission_id) DO NOTHING
        `,
        [r.id, pCode]
      );
    }
  }

  // Seed legacy role mappings
  for (const m of LEGACY_ROLE_MAPPINGS) {
    await runQuery(
      executor,
      `
      INSERT INTO rbac_legacy_role_mappings (id, legacy_role_pattern, canonical_role_id)
      VALUES ($1, $2, $3)
      ON CONFLICT (legacy_role_pattern) DO UPDATE SET
        canonical_role_id = EXCLUDED.canonical_role_id
      `,
      [m.id, m.pattern, m.canonicalRole]
    );
  }

  tablesEnsured = true;
}

// =============================================================================
// AUDIT LOGGING
// =============================================================================

async function logRbacAction(
  { actorId, actorRole, action, targetType, targetId, detail = {}, ip = null },
  executor = query
) {
  await ensureRbacTables(executor);
  const logId = buildId("AUD-RBC");
  await runQuery(
    executor,
    `
    INSERT INTO rbac_audit_logs (id, actor_id, actor_role, action, target_type, target_id, detail, ip)
    VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
    `,
    [
      logId,
      actorId || null,
      String(actorRole || "SYSTEM").toUpperCase(),
      String(action || "").toUpperCase(),
      String(targetType || "").toUpperCase(),
      String(targetId || ""),
      JSON.stringify(detail),
      ip || null
    ]
  );
  return logId;
}

async function listRbacAuditLogs({ limit = 50, offset = 0, action = null, targetType = null } = {}, executor = query) {
  await ensureRbacTables(executor);
  const conditions = [];
  const params = [];

  if (action) {
    params.push(String(action).toUpperCase());
    conditions.push(`action = $${params.length}`);
  }
  if (targetType) {
    params.push(String(targetType).toUpperCase());
    conditions.push(`target_type = $${params.length}`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  params.push(Math.min(Math.max(Number(limit) || 50, 1), 200));
  const limitIdx = params.length;
  params.push(Math.max(Number(offset) || 0, 0));
  const offsetIdx = params.length;

  const result = await runQuery(
    executor,
    `
    SELECT ral.*, u.name AS actor_name, u.email AS actor_email
    FROM rbac_audit_logs ral
    LEFT JOIN users u ON u.id = ral.actor_id
    ${whereClause}
    ORDER BY ral.created_at DESC
    LIMIT $${limitIdx} OFFSET $${offsetIdx}
    `,
    params
  );

  return result.rows.map((r) => ({
    id: r.id,
    actorId: r.actor_id,
    actorName: r.actor_name,
    actorEmail: r.actor_email,
    actorRole: r.actor_role,
    action: r.action,
    targetType: r.target_type,
    targetId: r.target_id,
    detail: r.detail,
    ip: r.ip,
    createdAt: r.created_at
  }));
}

// =============================================================================
// PERMISSION CATALOG
// =============================================================================

async function listPermissions(executor = query) {
  await ensureRbacTables(executor);
  const result = await runQuery(
    executor,
    `
    SELECT id, code, name, description, module, allowed_scope_types,
           enforcement_status, is_protected, is_delegable, created_at
    FROM rbac_permissions
    ORDER BY module ASC, code ASC
    `
  );
  return result.rows.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    description: r.description,
    module: r.module,
    allowedScopeTypes: r.allowed_scope_types,
    enforcementStatus: r.enforcement_status || "ENFORCED",
    isProtected: r.is_protected,
    isDelegable: r.is_delegable !== undefined ? r.is_delegable : true,
    createdAt: r.created_at
  }));
}

// =============================================================================
// ROLE CATALOG MANAGEMENT
// =============================================================================

async function listRoles({ includeArchived = false, limit = 50, offset = 0 } = {}, executor = query) {
  await ensureRbacTables(executor);
  const conditions = [];
  const params = [];

  if (!includeArchived) {
    conditions.push("is_active = TRUE");
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  params.push(Math.min(Math.max(Number(limit) || 50, 1), 200));
  const limitIdx = params.length;
  params.push(Math.max(Number(offset) || 0, 0));
  const offsetIdx = params.length;

  const result = await runQuery(
    executor,
    `
    SELECT r.*,
      (SELECT COUNT(*)::int FROM rbac_role_permissions rp WHERE rp.role_id = r.id) AS permission_count,
      (SELECT COUNT(*)::int FROM student_role_assignments sra WHERE sra.role_id = r.id AND sra.is_active = TRUE AND sra.revoked_at IS NULL AND (sra.expires_at IS NULL OR sra.expires_at > NOW())) AS active_assignment_count
    FROM rbac_roles r
    ${whereClause}
    ORDER BY r.is_system DESC, r.created_at ASC
    LIMIT $${limitIdx} OFFSET $${offsetIdx}
    `,
    params
  );

  return result.rows.map(mapRoleRow);
}

function mapRoleRow(row) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    isSystem: row.is_system,
    isActive: row.is_active,
    version: row.version,
    permissionCount: row.permission_count != null ? row.permission_count : undefined,
    activeAssignmentCount: row.active_assignment_count != null ? row.active_assignment_count : undefined,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function getRoleById(id, executor = query) {
  await ensureRbacTables(executor);
  const result = await runQuery(
    executor,
    `
    SELECT r.*,
      (SELECT COUNT(*)::int FROM rbac_role_permissions rp WHERE rp.role_id = r.id) AS permission_count,
      (SELECT COUNT(*)::int FROM student_role_assignments sra WHERE sra.role_id = r.id AND sra.is_active = TRUE AND sra.revoked_at IS NULL AND (sra.expires_at IS NULL OR sra.expires_at > NOW())) AS active_assignment_count
    FROM rbac_roles r
    WHERE r.id = $1
    LIMIT 1
    `,
    [id]
  );
  return result.rows[0] ? mapRoleRow(result.rows[0]) : null;
}

async function getRoleByCode(code, executor = query) {
  await ensureRbacTables(executor);
  const normalizedCode = String(code || "").trim().toUpperCase();
  const result = await runQuery(
    executor,
    `
    SELECT r.*,
      (SELECT COUNT(*)::int FROM rbac_role_permissions rp WHERE rp.role_id = r.id) AS permission_count,
      (SELECT COUNT(*)::int FROM student_role_assignments sra WHERE sra.role_id = r.id AND sra.is_active = TRUE AND sra.revoked_at IS NULL AND (sra.expires_at IS NULL OR sra.expires_at > NOW())) AS active_assignment_count
    FROM rbac_roles r
    WHERE r.code = $1
    LIMIT 1
    `,
    [normalizedCode]
  );
  return result.rows[0] ? mapRoleRow(result.rows[0]) : null;
}

function validateRoleCode(code) {
  const norm = String(code || "").trim().toUpperCase();
  if (!norm) {
    throw createHttpError("Kode role tidak boleh kosong.", 400);
  }
  if (!/^[A-Z0-9_]{2,50}$/.test(norm)) {
    throw createHttpError(
      "Format kode role tidak valid. Harus berupa huruf kapital, angka, underscore, 2-50 karakter (contoh: TECH_LEAD).",
      400
    );
  }
  return norm;
}

async function createRole(payload = {}, actorContext = {}, executor = pool) {
  await ensureRbacTables(executor);
  const code = validateRoleCode(payload.code);
  const name = String(payload.name || "").trim();
  const description = payload.description ? String(payload.description).trim() : null;

  if (!name) {
    throw createHttpError("Nama role tidak boleh kosong.", 400);
  }

  // Check unique code
  const existing = await getRoleByCode(code, executor);
  if (existing) {
    throw createHttpError(`Role dengan kode '${code}' sudah terdaftar.`, 409);
  }

  const roleId = buildId("ROL");
  const actorId = actorContext.actorId || null;
  const actorRole = actorContext.actorRole || "OPERATOR";

  const result = await runQuery(
    executor,
    `
    INSERT INTO rbac_roles (id, code, name, description, is_system, is_active, version, created_by)
    VALUES ($1, $2, $3, $4, FALSE, TRUE, 1, $5)
    RETURNING *
    `,
    [roleId, code, name, description, actorId]
  );

  await logRbacAction(
    {
      actorId,
      actorRole,
      action: "ROLE_CREATED",
      targetType: "ROLE",
      targetId: roleId,
      detail: { code, name, description },
      ip: actorContext.ip
    },
    executor
  );

  return mapRoleRow(result.rows[0]);
}

async function updateRole(id, payload = {}, actorContext = {}, executor = pool) {
  await ensureRbacTables(executor);
  const role = await getRoleById(id, executor);
  if (!role) throw createHttpError("Role tidak ditemukan.", 404);

  // Role code is immutable
  if (payload.code && String(payload.code).trim().toUpperCase() !== role.code) {
    throw createHttpError("Kode role bersifat immutable dan tidak dapat diubah.", 400);
  }

  const name = payload.name !== undefined ? String(payload.name).trim() : role.name;
  if (!name) throw createHttpError("Nama role tidak boleh kosong.", 400);

  const description = payload.description !== undefined ? String(payload.description).trim() : role.description;

  const result = await runQuery(
    executor,
    `
    UPDATE rbac_roles
    SET name = $2, description = $3, version = version + 1, updated_at = NOW()
    WHERE id = $1
    RETURNING *
    `,
    [id, name, description]
  );

  await logRbacAction(
    {
      actorId: actorContext.actorId,
      actorRole: actorContext.actorRole,
      action: "ROLE_UPDATED",
      targetType: "ROLE",
      targetId: id,
      detail: { previous: { name: role.name, description: role.description }, updated: { name, description } },
      ip: actorContext.ip
    },
    executor
  );

  return mapRoleRow(result.rows[0]);
}

async function archiveRole(id, actorContext = {}, executor = pool) {
  await ensureRbacTables(executor);
  const role = await getRoleById(id, executor);
  if (!role) throw createHttpError("Role tidak ditemukan.", 404);
  if (!role.isActive) throw createHttpError("Role sudah dalam status diarsipkan.", 400);

  const result = await runQuery(
    executor,
    `
    UPDATE rbac_roles
    SET is_active = FALSE, version = version + 1, updated_at = NOW()
    WHERE id = $1
    RETURNING *
    `,
    [id]
  );

  await logRbacAction(
    {
      actorId: actorContext.actorId,
      actorRole: actorContext.actorRole,
      action: "ROLE_ARCHIVED",
      targetType: "ROLE",
      targetId: id,
      detail: { code: role.code, name: role.name },
      ip: actorContext.ip
    },
    executor
  );

  return mapRoleRow(result.rows[0]);
}

async function restoreRole(id, actorContext = {}, executor = pool) {
  await ensureRbacTables(executor);
  const role = await getRoleById(id, executor);
  if (!role) throw createHttpError("Role tidak ditemukan.", 404);
  if (role.isActive) throw createHttpError("Role sudah aktif.", 400);

  const result = await runQuery(
    executor,
    `
    UPDATE rbac_roles
    SET is_active = TRUE, version = version + 1, updated_at = NOW()
    WHERE id = $1
    RETURNING *
    `,
    [id]
  );

  await logRbacAction(
    {
      actorId: actorContext.actorId,
      actorRole: actorContext.actorRole,
      action: "ROLE_RESTORED",
      targetType: "ROLE",
      targetId: id,
      detail: { code: role.code, name: role.name },
      ip: actorContext.ip
    },
    executor
  );

  return mapRoleRow(result.rows[0]);
}

async function getRolePermissions(roleId, executor = query) {
  await ensureRbacTables(executor);
  const role = await getRoleById(roleId, executor);
  if (!role) throw createHttpError("Role tidak ditemukan.", 404);

  const result = await runQuery(
    executor,
    `
    SELECT p.id, p.code, p.name, p.description, p.module, p.allowed_scope_types, p.is_protected, rp.granted_at
    FROM rbac_role_permissions rp
    JOIN rbac_permissions p ON p.id = rp.permission_id
    WHERE rp.role_id = $1
    ORDER BY p.module ASC, p.code ASC
    `,
    [roleId]
  );

  return {
    roleId: role.id,
    roleCode: role.code,
    roleName: role.name,
    version: role.version,
    permissions: result.rows.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      description: r.description,
      module: r.module,
      allowedScopeTypes: r.allowed_scope_types,
      isProtected: r.is_protected,
      grantedAt: r.granted_at
    }))
  };
}

async function updateRolePermissions(
  roleId,
  permissionCodes = [],
  { expectedVersion = null } = {},
  actorContext = {},
  executor = pool
) {
  await ensureRbacTables(executor);
  const client = typeof executor.connect === "function" ? await executor.connect() : executor;
  const ownsTransaction = typeof executor.connect === "function";

  try {
    if (ownsTransaction) await client.query("BEGIN");

    const roleRes = await client.query("SELECT * FROM rbac_roles WHERE id = $1 FOR UPDATE", [roleId]);
    if (roleRes.rowCount === 0) throw createHttpError("Role tidak ditemukan.", 404);
    const role = roleRes.rows[0];

    // Optimistic concurrency check
    if (expectedVersion != null && role.version !== Number(expectedVersion)) {
      throw createHttpError(
        `Konflik konkurensi (versi diharapkan: ${expectedVersion}, versi saat ini: ${role.version}). Silakan refresh halaman dan ulangi.`,
        409
      );
    }

    if (!Array.isArray(permissionCodes)) {
      throw createHttpError("permissionCodes harus berupa array of string.", 400);
    }

    // Validate permission codes: no arbitrary or protected permissions
    const normalizedCodes = Array.from(new Set(permissionCodes.map((c) => String(c).trim()))).filter(Boolean);

    for (const code of normalizedCodes) {
      if (isProtectedPermission(code)) {
        throw createHttpError(
          `Permission '${code}' dilindungi dan tidak dapat diberikan kepada role mahasiswa.`,
          400
        );
      }
      if (!REGISTERED_PERMISSION_CODES.has(code)) {
        throw createHttpError(
          `Permission '${code}' tidak dikenali dalam katalog kapabilitas resmi backend.`,
          400
        );
      }
    }

    // Fetch existing permissions for audit
    const prevPermsRes = await client.query(
      `
      SELECT p.code FROM rbac_role_permissions rp
      JOIN rbac_permissions p ON p.id = rp.permission_id
      WHERE rp.role_id = $1
      `,
      [roleId]
    );
    const prevCodes = prevPermsRes.rows.map((r) => r.code);

    // Delete current permissions
    await client.query("DELETE FROM rbac_role_permissions WHERE role_id = $1", [roleId]);

    // Insert new permissions
    if (normalizedCodes.length > 0) {
      const permsRes = await client.query(
        "SELECT id, code FROM rbac_permissions WHERE code = ANY($1::text[])",
        [normalizedCodes]
      );
      for (const p of permsRes.rows) {
        await client.query(
          "INSERT INTO rbac_role_permissions (role_id, permission_id, granted_by) VALUES ($1, $2, $3)",
          [roleId, p.id, actorContext.actorId || null]
        );
      }
    }

    // Increment version
    const updatedRoleRes = await client.query(
      "UPDATE rbac_roles SET version = version + 1, updated_at = NOW() WHERE id = $1 RETURNING *",
      [roleId]
    );

    await logRbacAction(
      {
        actorId: actorContext.actorId,
        actorRole: actorContext.actorRole,
        action: "PERMISSIONS_UPDATED",
        targetType: "ROLE_PERMISSION",
        targetId: roleId,
        detail: {
          roleCode: role.code,
          previousPermissions: prevCodes,
          newPermissions: normalizedCodes,
          version: updatedRoleRes.rows[0].version
        },
        ip: actorContext.ip
      },
      client
    );

    if (ownsTransaction) await client.query("COMMIT");

    return {
      roleId: role.id,
      roleCode: role.code,
      version: updatedRoleRes.rows[0].version,
      permissions: normalizedCodes
    };
  } catch (err) {
    if (ownsTransaction) await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    if (ownsTransaction) client.release();
  }
}

async function getRoleImpact(roleId, executor = query) {
  await ensureRbacTables(executor);
  const role = await getRoleById(roleId, executor);
  if (!role) throw createHttpError("Role tidak ditemukan.", 404);

  const totalRes = await runQuery(
    executor,
    "SELECT COUNT(*)::int AS count FROM student_role_assignments WHERE role_id = $1",
    [roleId]
  );
  const activeRes = await runQuery(
    executor,
    `
    SELECT COUNT(*)::int AS count, COUNT(DISTINCT student_id)::int AS unique_students
    FROM student_role_assignments
    WHERE role_id = $1 AND is_active = TRUE AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > NOW())
    `,
    [roleId]
  );

  const breakdownRes = await runQuery(
    executor,
    `
    SELECT scope_type, COUNT(*)::int AS count
    FROM student_role_assignments
    WHERE role_id = $1 AND is_active = TRUE AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > NOW())
    GROUP BY scope_type
    `,
    [roleId]
  );

  const scopeBreakdown = { LAB: 0, PROJECT: 0, DIVISION: 0 };
  for (const r of breakdownRes.rows) {
    if (scopeBreakdown[r.scope_type] !== undefined) {
      scopeBreakdown[r.scope_type] = r.count;
    }
  }

  return {
    roleId: role.id,
    roleCode: role.code,
    roleName: role.name,
    totalAssignments: totalRes.rows[0]?.count || 0,
    activeAssignments: activeRes.rows[0]?.count || 0,
    uniqueStudents: activeRes.rows[0]?.unique_students || 0,
    scopeBreakdown
  };
}

// =============================================================================
// STUDENT ROLE ASSIGNMENTS
// =============================================================================

async function assignStudentRole(studentId, payload = {}, actorContext = {}, executor = pool) {
  await ensureRbacTables(executor);

  // Authorization check: ONLY operator / admin can assign student roles
  const actorRole = String(actorContext.actorRole || "").trim().toLowerCase();
  if (actorRole !== "operator" && actorRole !== "admin") {
    throw createHttpError("Akses ditolak. Hanya operator/admin yang dapat memberikan penugasan role.", 403);
  }

  // Resolve student
  const student = await resolveStudentRecord(studentId, executor);
  if (!student) {
    throw createHttpError("Mahasiswa tidak ditemukan.", 404);
  }

  // Self-privilege escalation protection
  if (actorContext.actorId && student.user_id === actorContext.actorId) {
    throw createHttpError("Akses ditolak. Pengguna tidak diizinkan memberikan atau mengeskalasi role milik sendiri.", 403);
  }

  // Resolve role
  let role = null;
  if (payload.roleId) {
    role = await getRoleById(payload.roleId, executor);
  } else if (payload.roleCode) {
    role = await getRoleByCode(payload.roleCode, executor);
  }
  if (!role) {
    throw createHttpError("Role yang ditentukan tidak ditemukan.", 404);
  }
  if (!role.isActive) {
    throw createHttpError(`Role '${role.name}' sedang dalam status nonaktif/diarsipkan.`, 400);
  }

  // Scope validation
  const scopeType = String(payload.scopeType || "LAB").trim().toUpperCase();
  if (!["LAB", "PROJECT", "DIVISION"].includes(scopeType)) {
    throw createHttpError("scopeType harus salah satu dari: LAB, PROJECT, DIVISION.", 400);
  }

  let scopeId = payload.scopeId ? String(payload.scopeId).trim() : null;

  if (scopeType === "LAB") {
    scopeId = null;
  } else if (scopeType === "PROJECT") {
    if (!scopeId) {
      throw createHttpError("scopeId (ID Project) wajib disertakan untuk scope PROJECT.", 400);
    }
    const prjRes = await runQuery(executor, "SELECT id, title FROM research_projects WHERE id = $1 LIMIT 1", [scopeId]);
    if (prjRes.rowCount === 0) {
      throw createHttpError("Proyek riset tujuan tidak ditemukan.", 404);
    }
    // Verify membership invariant: student must be an active project member
    const memRes = await runQuery(
      executor,
      `
      SELECT 1 FROM research_memberships
      WHERE project_id = $1 AND user_id = $2 AND COALESCE(status, 'Aktif') = 'Aktif'
        AND (selesai IS NULL OR selesai >= CURRENT_DATE)
      LIMIT 1
      `,
      [scopeId, student.user_id]
    );
    if (memRes.rowCount === 0) {
      throw createHttpError(
        "Mahasiswa belum terdaftar sebagai anggota aktif pada proyek riset ini. Tambahkan anggota riset terlebih dahulu sebelum menetapkan role proyek.",
        422
      );
    }
  } else if (scopeType === "DIVISION") {
    if (!scopeId) {
      throw createHttpError("scopeId (ID Divisi) wajib disertakan untuk scope DIVISION.", 400);
    }
    const divRes = await runQuery(
      executor,
      "SELECT id, project_id, name FROM research_divisions WHERE id = $1 LIMIT 1",
      [scopeId]
    );
    if (divRes.rowCount === 0) {
      throw createHttpError("Divisi riset tujuan tidak ditemukan.", 404);
    }
    // Verify student is a member of the parent project
    const parentPrjId = divRes.rows[0].project_id;
    const memRes = await runQuery(
      executor,
      `
      SELECT 1 FROM research_memberships
      WHERE project_id = $1 AND user_id = $2 AND COALESCE(status, 'Aktif') = 'Aktif'
        AND (selesai IS NULL OR selesai >= CURRENT_DATE)
      LIMIT 1
      `,
      [parentPrjId, student.user_id]
    );
    if (memRes.rowCount === 0) {
      throw createHttpError(
        "Mahasiswa belum terdaftar sebagai anggota aktif pada proyek riset induk divisi ini.",
        422
      );
    }
  }

  // Check duplicate active assignment
  const existingActive = await runQuery(
    executor,
    `
    SELECT id FROM student_role_assignments
    WHERE student_id = $1 AND role_id = $2 AND scope_type = $3
      AND COALESCE(scope_id, 'GLOBAL_LAB') = COALESCE($4, 'GLOBAL_LAB')
      AND is_active = TRUE AND revoked_at IS NULL
      AND (expires_at IS NULL OR expires_at > NOW())
    LIMIT 1
    `,
    [student.id, role.id, scopeType, scopeId]
  );

  if (existingActive.rowCount > 0) {
    throw createHttpError(
      `Mahasiswa sudah memiliki penugasan role '${role.name}' aktif pada scope yang sama.`,
      409
    );
  }

  const assignmentId = buildId("SRA");
  const expiresAt = payload.expiresAt ? new Date(payload.expiresAt).toISOString() : null;

  const result = await runQuery(
    executor,
    `
    INSERT INTO student_role_assignments (
      id, student_id, role_id, scope_type, scope_id, assigned_by, assigned_at, expires_at, is_active
    )
    VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7, TRUE)
    RETURNING *
    `,
    [assignmentId, student.id, role.id, scopeType, scopeId, actorContext.actorId || null, expiresAt]
  );

  await logRbacAction(
    {
      actorId: actorContext.actorId,
      actorRole: actorContext.actorRole,
      action: "ROLE_ASSIGNED",
      targetType: "STUDENT_ROLE_ASSIGNMENT",
      targetId: assignmentId,
      detail: {
        studentId: student.id,
        roleCode: role.code,
        roleName: role.name,
        scopeType,
        scopeId,
        expiresAt
      },
      ip: actorContext.ip
    },
    executor
  );

  return {
    id: result.rows[0].id,
    studentId: student.id,
    roleId: role.id,
    roleCode: role.code,
    roleName: role.name,
    scopeType,
    scopeId,
    assignedBy: actorContext.actorId || null,
    assignedAt: result.rows[0].assigned_at,
    expiresAt: result.rows[0].expires_at,
    isActive: true
  };
}

async function revokeStudentRoleAssignment(assignmentId, payload = {}, actorContext = {}, executor = pool) {
  await ensureRbacTables(executor);

  const actorRole = String(actorContext.actorRole || "").trim().toLowerCase();
  if (actorRole !== "operator" && actorRole !== "admin") {
    throw createHttpError("Akses ditolak. Hanya operator/admin yang dapat mencabut penugasan role.", 403);
  }

  const asnRes = await runQuery(
    executor,
    `
    SELECT sra.*, r.code AS role_code, r.name AS role_name, s.user_id AS student_user_id
    FROM student_role_assignments sra
    JOIN rbac_roles r ON r.id = sra.role_id
    JOIN students s ON s.id = sra.student_id
    WHERE sra.id = $1
    LIMIT 1
    `,
    [assignmentId]
  );

  if (asnRes.rowCount === 0) {
    throw createHttpError("Penugasan role tidak ditemukan.", 404);
  }

  const assignment = asnRes.rows[0];
  if (!assignment.is_active || assignment.revoked_at != null) {
    throw createHttpError("Penugasan role sudah dicabut sebelumnya.", 400);
  }

  const reason = payload.reason ? String(payload.reason).trim() : "Dicabut oleh administrator";

  const result = await runQuery(
    executor,
    `
    UPDATE student_role_assignments
    SET is_active = FALSE, revoked_at = NOW(), revoked_by = $2, revocation_reason = $3, updated_at = NOW()
    WHERE id = $1
    RETURNING *
    `,
    [assignmentId, actorContext.actorId || null, reason]
  );

  await logRbacAction(
    {
      actorId: actorContext.actorId,
      actorRole: actorContext.actorRole,
      action: "ROLE_REVOKED",
      targetType: "STUDENT_ROLE_ASSIGNMENT",
      targetId: assignmentId,
      detail: {
        studentId: assignment.student_id,
        roleCode: assignment.role_code,
        scopeType: assignment.scope_type,
        scopeId: assignment.scope_id,
        reason
      },
      ip: actorContext.ip
    },
    executor
  );

  return {
    id: result.rows[0].id,
    studentId: assignment.student_id,
    roleId: assignment.role_id,
    roleCode: assignment.role_code,
    roleName: assignment.role_name,
    scopeType: assignment.scope_type,
    scopeId: assignment.scope_id,
    isActive: false,
    revokedAt: result.rows[0].revoked_at,
    revocationReason: reason
  };
}

async function listStudentRoleAssignments(studentId, { includeRevoked = false } = {}, executor = query) {
  await ensureRbacTables(executor);
  const student = await resolveStudentRecord(studentId, executor);
  if (!student) throw createHttpError("Mahasiswa tidak ditemukan.", 404);

  const conditions = ["sra.student_id = $1"];
  const params = [student.id];

  if (!includeRevoked) {
    conditions.push("sra.is_active = TRUE");
    conditions.push("sra.revoked_at IS NULL");
    conditions.push("(sra.expires_at IS NULL OR sra.expires_at > NOW())");
  }

  const result = await runQuery(
    executor,
    `
    SELECT sra.*, r.code AS role_code, r.name AS role_name, r.is_system, r.is_active AS role_is_active,
           u_assigned.name AS assigned_by_name,
           u_revoked.name AS revoked_by_name,
           rp.title AS project_name,
           rd.name AS division_name
    FROM student_role_assignments sra
    JOIN rbac_roles r ON r.id = sra.role_id
    LEFT JOIN users u_assigned ON u_assigned.id = sra.assigned_by
    LEFT JOIN users u_revoked ON u_revoked.id = sra.revoked_by
    LEFT JOIN research_projects rp ON rp.id = sra.scope_id AND sra.scope_type = 'PROJECT'
    LEFT JOIN research_divisions rd ON rd.id = sra.scope_id AND sra.scope_type = 'DIVISION'
    WHERE ${conditions.join(" AND ")}
    ORDER BY sra.created_at DESC
    `,
    params
  );

  return result.rows.map((r) => ({
    id: r.id,
    studentId: r.student_id,
    roleId: r.role_id,
    roleCode: r.role_code,
    roleName: r.role_name,
    roleIsActive: r.role_is_active,
    scopeType: r.scope_type,
    scopeId: r.scope_id,
    scopeName: r.scope_type === "PROJECT" ? r.project_name : r.scope_type === "DIVISION" ? r.division_name : "Laboratorium Global",
    assignedBy: r.assigned_by,
    assignedByName: r.assigned_by_name,
    assignedAt: r.assigned_at,
    expiresAt: r.expires_at,
    isActive: r.is_active && (!r.expires_at || new Date(r.expires_at) > new Date()) && !r.revoked_at && r.role_is_active,
    revokedAt: r.revoked_at,
    revokedByName: r.revoked_by_name,
    revocationReason: r.revocation_reason
  }));
}

// =============================================================================
// EFFECTIVE PERMISSION RESOLVER
// =============================================================================

async function resolveStudentEffectivePermissions(
  studentId,
  { projectId = null, divisionId = null } = {},
  executor = query
) {
  await ensureRbacTables(executor);
  const student = await resolveStudentRecord(studentId, executor);
  if (!student) throw createHttpError("Mahasiswa tidak ditemukan.", 404);

  // Inactive / withdrawn check
  if (student.status === "Mengundurkan Diri") {
    return {
      studentId: student.id,
      userId: student.user_id,
      accountRole: "mahasiswa",
      permissions: [],
      scopedPermissions: [],
      activeRoles: []
    };
  }

  // Active student role assignments
  const assignmentsRes = await runQuery(
    executor,
    `
    SELECT sra.id AS assignment_id, sra.scope_type, sra.scope_id, sra.expires_at,
           r.id AS role_id, r.code AS role_code, r.name AS role_name,
           p.code AS permission_code, p.module AS permission_module, p.allowed_scope_types
    FROM student_role_assignments sra
    JOIN rbac_roles r ON r.id = sra.role_id AND r.is_active = TRUE
    JOIN rbac_role_permissions rp ON rp.role_id = r.id
    JOIN rbac_permissions p ON p.id = rp.permission_id
    WHERE sra.student_id = $1
      AND sra.is_active = TRUE
      AND sra.revoked_at IS NULL
      AND (sra.expires_at IS NULL OR sra.expires_at > NOW())
    `,
    [student.id]
  );

  // If divisionId given, find its parent project
  let divisionProjectId = null;
  if (divisionId) {
    const divRes = await runQuery(executor, "SELECT project_id FROM research_divisions WHERE id = $1 LIMIT 1", [divisionId]);
    divisionProjectId = divRes.rows[0]?.project_id || null;
  }

  const effectivePermissionsSet = new Set();
  const scopedPermissions = [];
  const activeRolesMap = new Map();

  for (const row of assignmentsRes.rows) {
    activeRolesMap.set(row.assignment_id, {
      assignmentId: row.assignment_id,
      roleId: row.role_id,
      roleCode: row.role_code,
      roleName: row.role_name,
      scopeType: row.scope_type,
      scopeId: row.scope_id,
      expiresAt: row.expires_at
    });

    let applies = false;

    // Scope matching rules
    if (row.scope_type === "LAB") {
      applies = true;
    } else if (row.scope_type === "PROJECT") {
      if (projectId && row.scope_id === projectId) {
        applies = true;
      } else if (divisionProjectId && row.scope_id === divisionProjectId) {
        applies = true;
      } else if (!projectId && !divisionId) {
        // Global query returns all scoped permissions tagged with their scope
        applies = true;
      }
    } else if (row.scope_type === "DIVISION") {
      if (divisionId && row.scope_id === divisionId) {
        applies = true;
      } else if (projectId && divisionProjectId && row.scope_id === divisionId && divisionProjectId === projectId) {
        applies = true;
      } else if (!projectId && !divisionId) {
        applies = true;
      }
    }

    if (applies) {
      effectivePermissionsSet.add(row.permission_code);
      scopedPermissions.push({
        permission: row.permission_code,
        module: row.permission_module,
        roleCode: row.role_code,
        scopeType: row.scope_type,
        scopeId: row.scope_id
      });
    }
  }

  return {
    studentId: student.id,
    userId: student.user_id,
    accountRole: "mahasiswa",
    permissions: Array.from(effectivePermissionsSet).sort(),
    scopedPermissions,
    activeRoles: Array.from(activeRolesMap.values())
  };
}

async function resolveUserEffectivePermissions(
  userId,
  { projectId = null, divisionId = null } = {},
  executor = query
) {
  await ensureRbacTables(executor);
  if (!userId) {
    return {
      userId: null,
      accountRole: "anonymous",
      permissions: [],
      scopedPermissions: [],
      activeRoles: []
    };
  }

  const userRes = await runQuery(executor, "SELECT id, role, is_active FROM users WHERE id = $1 LIMIT 1", [userId]);
  if (userRes.rowCount === 0 || !userRes.rows[0].is_active) {
    return {
      userId,
      accountRole: "inactive",
      permissions: [],
      scopedPermissions: [],
      activeRoles: []
    };
  }

  const user = userRes.rows[0];

  // Operator / Admin
  if (user.role === "operator" || user.role === "admin") {
    // Admin has all registered capabilities plus admin boundary
    return {
      userId: user.id,
      studentId: null,
      accountRole: "operator",
      permissions: Array.from(REGISTERED_PERMISSION_CODES).sort(),
      scopedPermissions: Array.from(REGISTERED_PERMISSION_CODES).map((p) => ({
        permission: p,
        scopeType: "GLOBAL_ADMIN",
        scopeId: null,
        roleCode: "OPERATOR"
      })),
      activeRoles: [
        {
          assignmentId: "SYS-OPERATOR",
          roleId: "SYS-OPERATOR",
          roleCode: "OPERATOR",
          roleName: "Operator / Admin",
          scopeType: "LAB",
          scopeId: null,
          expiresAt: null
        }
      ]
    };
  }

  // Dosen
  if (user.role === "dosen") {
    const dosenPermissions = [
      "research.project.read",
      "scrum.sprint.view",
      "scrum.sprint.manage",
      "scrum.task.manage",
      "evaluation.recap.view"
    ];
    return {
      userId: user.id,
      studentId: null,
      accountRole: "dosen",
      permissions: dosenPermissions,
      scopedPermissions: dosenPermissions.map((p) => ({
        permission: p,
        scopeType: "FACULTY",
        scopeId: null,
        roleCode: "DOSEN"
      })),
      activeRoles: [
        {
          assignmentId: "SYS-DOSEN",
          roleId: "SYS-DOSEN",
          roleCode: "DOSEN",
          roleName: "Dosen / Pembimbing",
          scopeType: "LAB",
          scopeId: null,
          expiresAt: null
        }
      ]
    };
  }

  // Mahasiswa: resolve from student table
  const student = await resolveStudentRecord(userId, executor);
  if (!student) {
    return {
      userId: user.id,
      studentId: null,
      accountRole: "mahasiswa",
      permissions: [],
      scopedPermissions: [],
      activeRoles: []
    };
  }

  return resolveStudentEffectivePermissions(student.id, { projectId, divisionId }, executor);
}

async function hasEffectivePermission(
  { userId, permission, projectId = null, divisionId = null },
  executor = query
) {
  if (!userId || !permission) return false;
  const resolved = await resolveUserEffectivePermissions(userId, { projectId, divisionId }, executor);
  return resolved.permissions.includes(permission);
}

// =============================================================================
// LEGACY ROLE MAPPINGS
// =============================================================================

async function listLegacyRoleMappings(executor = query) {
  await ensureRbacTables(executor);
  const result = await runQuery(
    executor,
    `
    SELECT m.id, m.legacy_role_pattern, m.canonical_role_id, m.notes, m.created_at,
           r.code AS canonical_role_code, r.name AS canonical_role_name
    FROM rbac_legacy_role_mappings m
    JOIN rbac_roles r ON r.id = m.canonical_role_id
    ORDER BY m.legacy_role_pattern ASC
    `
  );
  return result.rows.map((r) => ({
    id: r.id,
    pattern: r.legacy_role_pattern,
    canonicalRoleId: r.canonical_role_id,
    canonicalRoleCode: r.canonical_role_code,
    canonicalRoleName: r.canonical_role_name,
    notes: r.notes,
    createdAt: r.created_at
  }));
}

async function resolveLegacyRole(peranString, executor = query) {
  const norm = String(peranString || "").trim().toLowerCase();
  if (!norm) return null;

  // Ambiguous subordinate / modified roles (Wakil Ketua, Asisten PM, Co-Leader, Sub-Lead, etc.)
  // MUST NOT receive CONTRIBUTOR or any role with permissions.
  // Must be marked as PENDING_RECONCILIATION without active RBAC assignment.
  const isAmbiguousSubordinate = /\b(wakil|asisten|assistant|vice|co-|sub-)\b/i.test(norm);
  if (isAmbiguousSubordinate) {
    return {
      roleId: null,
      roleCode: null,
      roleName: null,
      status: "PENDING_RECONCILIATION",
      isAmbiguous: true,
      reason: "Role ambigu memerlukan pemetaan manual oleh Admin"
    };
  }

  const mappings = await listLegacyRoleMappings(executor);
  for (const m of mappings) {
    const regex = new RegExp(`\\b${m.pattern}\\b`, "i");
    if (regex.test(norm)) {
      return {
        roleId: m.canonicalRoleId,
        roleCode: m.canonicalRoleCode,
        roleName: m.canonicalRoleName,
        status: "RESOLVED",
        isAmbiguous: false
      };
    }
  }

  return null;
}

// =============================================================================
// LEGACY RECONCILIATION SERVICES
// =============================================================================

async function listLegacyReconciliations(
  { status = null, limit = 50, offset = 0 } = {},
  executor = query
) {
  await ensureRbacTables(executor);
  const conditions = [];
  const params = [];

  if (status) {
    const rawStatus = String(status).trim().toUpperCase();
    if (rawStatus && rawStatus !== "ALL") {
      let normalizedStatus = rawStatus;
      if (rawStatus === "PENDING" || rawStatus === "PENDING_RECONCILIATION") {
        normalizedStatus = "PENDING_RECONCILIATION";
      } else if (rawStatus === "RECONCILED") {
        normalizedStatus = "RECONCILED";
      } else if (rawStatus === "IGNORED" || rawStatus === "IGNORE") {
        normalizedStatus = "IGNORED";
      }
      params.push(normalizedStatus);
      conditions.push(`lr.status = $${params.length}`);
    }
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const numericLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const numericOffset = Math.max(Number(offset) || 0, 0);
  params.push(numericLimit);
  const limitIdx = params.length;
  params.push(numericOffset);
  const offsetIdx = params.length;

  const result = await runQuery(
    executor,
    `
    SELECT lr.*,
           s.nim AS student_nim, u.name AS student_name,
           rp.title AS project_title,
           r.code AS reconciled_role_code, r.name AS reconciled_role_name,
           u_rec.name AS reconciled_by_name
    FROM rbac_legacy_reconciliations lr
    JOIN students s ON s.id = lr.student_id
    JOIN users u ON u.id = s.user_id
    JOIN research_projects rp ON rp.id = lr.project_id
    LEFT JOIN rbac_roles r ON r.id = lr.reconciled_role_id
    LEFT JOIN users u_rec ON u_rec.id = lr.reconciled_by
    ${whereClause}
    ORDER BY CASE WHEN lr.status = 'PENDING_RECONCILIATION' THEN 0 ELSE 1 END, lr.created_at DESC
    LIMIT $${limitIdx} OFFSET $${offsetIdx}
    `,
    params
  );

  return result.rows.map((r) => ({
    id: r.id,
    studentId: r.student_id,
    studentNim: r.student_nim,
    studentName: r.student_name,
    projectId: r.project_id,
    projectTitle: r.project_title,
    legacyPeran: r.legacy_peran,
    status: r.status,
    reconciledRoleId: r.reconciled_role_id,
    reconciledRoleCode: r.reconciled_role_code,
    reconciledRoleName: r.reconciled_role_name,
    reconciledBy: r.reconciled_by,
    reconciledByName: r.reconciled_by_name,
    reconciledAt: r.reconciled_at,
    notes: r.notes,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }));
}

async function reconcileLegacyRole(
  reconciliationId,
  payload = {},
  actorContext = {},
  executor = pool
) {
  await ensureRbacTables(executor);
  const actorRole = String(actorContext.actorRole || "").trim().toLowerCase();
  if (actorRole !== "operator" && actorRole !== "admin") {
    throw createHttpError("Akses ditolak. Hanya operator/admin yang dapat merekonsiliasi role legacy.", 403);
  }

  const client = typeof executor.connect === "function" ? await executor.connect() : executor;
  const ownsTransaction = typeof executor.connect === "function";

  try {
    if (ownsTransaction) await client.query("BEGIN");

    const recRes = await runQuery(
      client,
      "SELECT * FROM rbac_legacy_reconciliations WHERE id = $1 FOR UPDATE",
      [reconciliationId]
    );
    if (recRes.rowCount === 0) {
      throw createHttpError("Data rekonsiliasi role legacy tidak ditemukan.", 404);
    }
    const rec = recRes.rows[0];

    // Duplicate reconciliation check (Idempotency / State Handling)
    if (rec.status !== "PENDING_RECONCILIATION") {
      throw createHttpError(
        `Data rekonsiliasi role legacy ini sudah diselesaikan sebelumnya (status: ${rec.status}).`,
        409
      );
    }

    // Determine action intent
    const rawAction = payload.action ? String(payload.action).trim().toUpperCase() : null;
    const rawStatus = payload.status ? String(payload.status).trim().toUpperCase() : null;

    let action = null;
    if (rawAction) {
      if (rawAction === "ASSIGN_ROLE" || rawAction === "ASSIGN") {
        action = "ASSIGN_ROLE";
      } else if (rawAction === "IGNORE" || rawAction === "SKIP") {
        action = "IGNORE";
      } else {
        throw createHttpError(
          `Action '${payload.action}' tidak valid. Gunakan 'ASSIGN_ROLE' atau 'IGNORE'.`,
          400
        );
      }
    } else if (rawStatus) {
      if (rawStatus === "RECONCILED") {
        action = "ASSIGN_ROLE";
      } else if (rawStatus === "IGNORED") {
        action = "IGNORE";
      } else {
        throw createHttpError(
          `Status '${payload.status}' tidak valid untuk rekonsiliasi.`,
          400
        );
      }
    } else if (payload.roleId || payload.roleCode) {
      action = "ASSIGN_ROLE";
    } else {
      throw createHttpError(
        "Action rekonsiliasi wajib ditentukan ('ASSIGN_ROLE' atau 'IGNORE').",
        400
      );
    }

    let assignedRecord = null;
    let targetRoleId = null;
    let newStatus = "RECONCILED";

    if (action === "IGNORE") {
      newStatus = "IGNORED";
      targetRoleId = null;
    } else {
      // action === "ASSIGN_ROLE"
      const roleIdInput = payload.roleId ? String(payload.roleId).trim() : null;
      const roleCodeInput = payload.roleCode ? String(payload.roleCode).trim() : null;

      if (!roleIdInput && !roleCodeInput) {
        throw createHttpError("roleId atau roleCode wajib diisi untuk rekonsiliasi penugasan role.", 400);
      }

      let role = null;
      if (roleIdInput) {
        role = await getRoleById(roleIdInput, client);
        if (!role) {
          role = await getRoleByCode(roleIdInput, client);
        }
      } else if (roleCodeInput) {
        role = await getRoleByCode(roleCodeInput, client);
        if (!role) {
          role = await getRoleById(roleCodeInput, client);
        }
      }

      if (!role) {
        throw createHttpError("Role yang dipilih tidak ditemukan.", 404);
      }
      if (!role.isActive) {
        throw createHttpError(`Role '${role.name}' sedang dalam status nonaktif/diarsipkan.`, 400);
      }

      targetRoleId = role.id;

      // Assign role to student within transaction
      assignedRecord = await assignStudentRole(
        rec.student_id,
        {
          roleId: role.id,
          scopeType: "PROJECT",
          scopeId: rec.project_id
        },
        actorContext,
        client
      );
    }

    const notes = payload.notes != null ? String(payload.notes).trim() : null;

    const updatedRecRes = await runQuery(
      client,
      `
      UPDATE rbac_legacy_reconciliations
      SET status = $2,
          reconciled_role_id = $3,
          reconciled_by = $4,
          reconciled_at = NOW(),
          notes = COALESCE($5, notes),
          updated_at = NOW()
      WHERE id = $1
      RETURNING *
      `,
      [reconciliationId, newStatus, targetRoleId, actorContext.actorId || null, notes]
    );

    await logRbacAction(
      {
        actorId: actorContext.actorId,
        actorRole: actorContext.actorRole,
        action: "RECONCILE_LEGACY_ROLE",
        targetType: "LEGACY_RECONCILIATION",
        targetId: reconciliationId,
        detail: {
          studentId: rec.student_id,
          projectId: rec.project_id,
          legacyPeran: rec.legacy_peran,
          reconciledRoleId: targetRoleId,
          status: newStatus,
          notes
        },
        ip: actorContext.ip
      },
      client
    );

    if (ownsTransaction) await client.query("COMMIT");

    const updated = updatedRecRes.rows[0];
    return {
      reconciliation: {
        id: updated.id,
        studentId: updated.student_id,
        projectId: updated.project_id,
        legacyPeran: updated.legacy_peran,
        status: updated.status,
        reconciledRoleId: updated.reconciled_role_id,
        reconciledBy: updated.reconciled_by,
        reconciledAt: updated.reconciled_at,
        notes: updated.notes
      },
      assignment: assignedRecord
    };
  } catch (err) {
    if (ownsTransaction) await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    if (ownsTransaction) client.release();
  }
}

// =============================================================================
// CONTEXT ROLES FOR FRONTEND INTEGRATION
// =============================================================================

async function listContextRoles({ scopeType = null } = {}, executor = query) {
  await ensureRbacTables(executor);
  const roles = await listRoles({ includeArchived: false }, executor);

  const SUGGESTED_PERAN_MAP = {
    PROJECT_MANAGER: "Project Manager",
    KETUA_RISET: "Ketua Riset",
    CORE_RESEARCHER: "Core Researcher",
    CONTRIBUTOR: "Anggota Riset"
  };

  return roles.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    description: r.description,
    isSystem: r.isSystem,
    permissions: r.permissions || [],
    suggestedPeran: SUGGESTED_PERAN_MAP[r.code] || r.name
  }));
}

module.exports = {
  buildId,
  createHttpError,
  ensureRbacTables,
  REGISTERED_PERMISSIONS,
  REGISTERED_PERMISSION_CODES,
  CANONICAL_ROLES,
  LEGACY_ROLE_MAPPINGS,
  isProtectedPermission,
  logRbacAction,
  listRbacAuditLogs,
  listPermissions,
  listRoles,
  getRoleById,
  getRoleByCode,
  createRole,
  updateRole,
  archiveRole,
  restoreRole,
  getRolePermissions,
  updateRolePermissions,
  getRoleImpact,
  assignStudentRole,
  revokeStudentRoleAssignment,
  listStudentRoleAssignments,
  resolveStudentEffectivePermissions,
  resolveUserEffectivePermissions,
  hasEffectivePermission,
  listLegacyRoleMappings,
  resolveLegacyRole,
  listLegacyReconciliations,
  reconcileLegacyRole,
  listContextRoles
};
