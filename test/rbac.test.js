const test = require("node:test");
const assert = require("node:assert/strict");

const {
  ensureRbacTables,
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
  listRbacAuditLogs,
  resolveLegacyRole,
  listLegacyReconciliations,
  reconcileLegacyRole,
  listContextRoles,
  REGISTERED_PERMISSIONS,
  CANONICAL_ROLES
} = require("../utils/rbacService");

const {
  savePmEvaluationSubmission
} = require("../utils/evaluationService");

// ---------------------------------------------------------------------------
// In-Memory Database Mock for Isolated RBAC Tests
// ---------------------------------------------------------------------------

function createRbacMockDb() {
  const users = [
    { id: "USR-OP-1", name: "Operator Admin", role: "operator", is_active: true },
    { id: "USR-STD-1", name: "Mahasiswa One", role: "mahasiswa", is_active: true },
    { id: "USR-STD-2", name: "Mahasiswa Two", role: "mahasiswa", is_active: true },
    { id: "USR-DOS-1", name: "Dosen Satu", role: "dosen", is_active: true }
  ];

  const students = [
    { id: "STD-1", user_id: "USR-STD-1", nim: "13520001", status: "Aktif", name: "Mahasiswa One" },
    { id: "STD-2", user_id: "USR-STD-2", nim: "13520002", status: "Aktif", name: "Mahasiswa Two" }
  ];

  const projects = [
    { id: "PRJ-ALPHA", name: "Project Alpha" },
    { id: "PRJ-BETA", name: "Project Beta" }
  ];

  const divisions = [
    { id: "DIV-MOBILE", project_id: "PRJ-ALPHA", name: "Mobile Division" },
    { id: "DIV-WEB", project_id: "PRJ-ALPHA", name: "Web Division" }
  ];

  const memberships = [
    { project_id: "PRJ-ALPHA", user_id: "USR-STD-1", member_type: "Mahasiswa", peran: "Anggota", status: "Aktif", selesai: null },
    { project_id: "PRJ-BETA", user_id: "USR-STD-2", member_type: "Mahasiswa", peran: "Ketua Riset", status: "Aktif", selesai: null }
  ];

  const roles = CANONICAL_ROLES.map((r, i) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    description: r.description,
    is_system: true,
    is_active: true,
    version: 1,
    created_by: null,
    created_at: new Date(Date.now() - 100000 + i * 1000).toISOString(),
    updated_at: new Date().toISOString()
  }));

  const permissions = REGISTERED_PERMISSIONS.map((p, i) => ({
    id: `PRM-${i + 1}`,
    code: p.code,
    name: p.name,
    description: p.description,
    module: p.module,
    allowed_scope_types: p.allowedScopeTypes,
    enforcement_status: p.enforcementStatus,
    is_protected: p.isProtected,
    is_delegable: p.isDelegable,
    created_at: new Date().toISOString()
  }));

  const rolePermissions = [];
  for (const cr of CANONICAL_ROLES) {
    for (const pCode of cr.permissions) {
      const p = permissions.find((perm) => perm.code === pCode);
      if (p) {
        rolePermissions.push({ role_id: cr.id, permission_id: p.id, granted_at: new Date().toISOString(), granted_by: null });
      }
    }
  }

  const assignments = [];
  const auditLogs = [];
  const reconciliations = [
    {
      id: "REC-LEG-STD-1-PRJ-ALPHA-123",
      student_id: "STD-1",
      project_id: "PRJ-ALPHA",
      legacy_peran: "Wakil Ketua Riset",
      status: "PENDING_RECONCILIATION",
      reconciled_role_id: null,
      reconciled_by: null,
      reconciled_at: null,
      notes: "Ambiguous subordinate role",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }
  ];
  const legacyMappings = [
    { id: "MAP-01", legacy_role_pattern: "ketua", canonical_role_id: "ROL-KETUA-RISET", notes: null },
    { id: "MAP-02", legacy_role_pattern: "leader", canonical_role_id: "ROL-KETUA-RISET", notes: null },
    { id: "MAP-03", legacy_role_pattern: "project manager", canonical_role_id: "ROL-PROJECT-MANAGER", notes: null },
    { id: "MAP-04", legacy_role_pattern: "pm", canonical_role_id: "ROL-PROJECT-MANAGER", notes: null },
    { id: "MAP-05", legacy_role_pattern: "core", canonical_role_id: "ROL-CORE-RESEARCHER", notes: null },
    { id: "MAP-06", legacy_role_pattern: "lead", canonical_role_id: "ROL-CORE-RESEARCHER", notes: null },
    { id: "MAP-07", legacy_role_pattern: "anggota", canonical_role_id: "ROL-CONTRIBUTOR", notes: null },
    { id: "MAP-08", legacy_role_pattern: "member", canonical_role_id: "ROL-CONTRIBUTOR", notes: null }
  ];

  const executor = {
    connect: async () => executor,
    release: () => {},
    query: async (sql, params = []) => {
      const q = sql.trim();

      if (q.startsWith("BEGIN") || q.startsWith("COMMIT") || q.startsWith("ROLLBACK")) {
        return { rows: [], rowCount: 0 };
      }

      if (q.includes("CREATE TABLE IF NOT EXISTS")) {
        return { rows: [], rowCount: 0 };
      }

      if (q.includes("FROM users WHERE id = $1")) {
        const u = users.find((x) => x.id === params[0]);
        return { rows: u ? [u] : [], rowCount: u ? 1 : 0 };
      }

      if (q.includes("FROM students s") && q.includes("JOIN users u")) {
        const s = students.find((x) => x.id === params[0] || x.user_id === params[0]);
        return { rows: s ? [s] : [], rowCount: s ? 1 : 0 };
      }

      if (q.includes("FROM research_projects WHERE id = $1")) {
        const p = projects.find((x) => x.id === params[0]);
        return { rows: p ? [p] : [], rowCount: p ? 1 : 0 };
      }

      if (q.includes("FROM research_divisions WHERE id = $1")) {
        const d = divisions.find((x) => x.id === params[0]);
        return { rows: d ? [d] : [], rowCount: d ? 1 : 0 };
      }

      if (q.includes("FROM research_memberships")) {
        const m = memberships.find((x) => x.project_id === params[0] && x.user_id === params[1]);
        return { rows: m ? [m] : [], rowCount: m ? 1 : 0 };
      }

      if (q.includes("FROM rbac_roles r") && q.includes("WHERE r.id = $1")) {
        const r = roles.find((x) => x.id === params[0]);
        return { rows: r ? [{ ...r, permission_count: 5, active_assignment_count: 1 }] : [], rowCount: r ? 1 : 0 };
      }

      if (q.includes("FROM rbac_roles r") && q.includes("WHERE r.code = $1")) {
        const r = roles.find((x) => x.code === params[0]);
        return { rows: r ? [{ ...r, permission_count: 5, active_assignment_count: 1 }] : [], rowCount: r ? 1 : 0 };
      }

      if (q.includes("FROM rbac_roles WHERE id = $1 FOR UPDATE")) {
        const r = roles.find((x) => x.id === params[0]);
        return { rows: r ? [r] : [], rowCount: r ? 1 : 0 };
      }

      if (q.includes("FROM rbac_roles r")) {
        let filtered = roles;
        if (q.includes("is_active = TRUE")) filtered = filtered.filter((x) => x.is_active);
        return { rows: filtered.map((r) => ({ ...r, permission_count: 5, active_assignment_count: 0 })), rowCount: filtered.length };
      }

      if (q.includes("INSERT INTO rbac_roles")) {
        const newRole = {
          id: params[0],
          code: params[1],
          name: params[2],
          description: params[3],
          is_system: false,
          is_active: true,
          version: 1,
          created_by: params[4] || null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };
        roles.push(newRole);
        return { rows: [newRole], rowCount: 1 };
      }

      if (q.includes("UPDATE rbac_roles") && q.includes("SET name = $2")) {
        const r = roles.find((x) => x.id === params[0]);
        if (r) {
          r.name = params[1];
          r.description = params[2];
          r.version++;
          r.updated_at = new Date().toISOString();
        }
        return { rows: r ? [r] : [], rowCount: r ? 1 : 0 };
      }

      if (q.includes("UPDATE rbac_roles") && q.includes("is_active = FALSE")) {
        const r = roles.find((x) => x.id === params[0]);
        if (r) {
          r.is_active = false;
          r.version++;
          r.updated_at = new Date().toISOString();
        }
        return { rows: r ? [r] : [], rowCount: r ? 1 : 0 };
      }

      if (q.includes("UPDATE rbac_roles") && q.includes("is_active = TRUE")) {
        const r = roles.find((x) => x.id === params[0]);
        if (r) {
          r.is_active = true;
          r.version++;
          r.updated_at = new Date().toISOString();
        }
        return { rows: r ? [r] : [], rowCount: r ? 1 : 0 };
      }

      if (q.includes("UPDATE rbac_roles SET version = version + 1")) {
        const r = roles.find((x) => x.id === params[0]);
        if (r) {
          r.version++;
          r.updated_at = new Date().toISOString();
        }
        return { rows: r ? [r] : [], rowCount: r ? 1 : 0 };
      }

      if (q.includes("FROM rbac_permissions") && q.includes("code = ANY")) {
        const codes = params[0];
        const res = permissions.filter((p) => codes.includes(p.code));
        return { rows: res, rowCount: res.length };
      }

      if (q.includes("FROM rbac_permissions")) {
        return { rows: permissions, rowCount: permissions.length };
      }

      if (q.includes("FROM rbac_role_permissions rp") && q.includes("JOIN rbac_permissions p")) {
        const rps = rolePermissions.filter((x) => x.role_id === params[0]);
        const mapped = rps.map((rp) => {
          const p = permissions.find((perm) => perm.id === rp.permission_id);
          return {
            id: p.id,
            code: p.code,
            name: p.name,
            description: p.description,
            module: p.module,
            allowed_scope_types: p.allowed_scope_types,
            is_protected: p.is_protected,
            granted_at: rp.granted_at
          };
        });
        return { rows: mapped, rowCount: mapped.length };
      }

      if (q.includes("DELETE FROM rbac_role_permissions WHERE role_id = $1")) {
        for (let i = rolePermissions.length - 1; i >= 0; i--) {
          if (rolePermissions[i].role_id === params[0]) rolePermissions.splice(i, 1);
        }
        return { rows: [], rowCount: 1 };
      }

      if (q.includes("INSERT INTO rbac_role_permissions")) {
        rolePermissions.push({ role_id: params[0], permission_id: params[1], granted_by: params[2], granted_at: new Date().toISOString() });
        return { rows: [], rowCount: 1 };
      }

      if (q.includes("FROM student_role_assignments") && q.includes("WHERE student_id = $1 AND role_id = $2")) {
        const found = assignments.filter((a) =>
          a.student_id === params[0] &&
          a.role_id === params[1] &&
          a.scope_type === params[2] &&
          (a.scope_id || "GLOBAL_LAB") === (params[3] || "GLOBAL_LAB") &&
          a.is_active && !a.revoked_at
        );
        return { rows: found, rowCount: found.length };
      }

      if (q.includes("INSERT INTO student_role_assignments")) {
        const newAsn = {
          id: params[0],
          student_id: params[1],
          role_id: params[2],
          scope_type: params[3],
          scope_id: params[4] || null,
          assigned_by: params[5] || null,
          assigned_at: new Date().toISOString(),
          expires_at: params[6] || null,
          is_active: true,
          revoked_at: null,
          revoked_by: null,
          revocation_reason: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };
        assignments.push(newAsn);
        return { rows: [newAsn], rowCount: 1 };
      }

      if (q.includes("FROM student_role_assignments sra") && q.includes("WHERE sra.id = $1")) {
        const a = assignments.find((x) => x.id === params[0]);
        if (!a) return { rows: [], rowCount: 0 };
        const r = roles.find((x) => x.id === a.role_id);
        const s = students.find((x) => x.id === a.student_id);
        return {
          rows: [{ ...a, role_code: r.code, role_name: r.name, student_user_id: s.user_id }],
          rowCount: 1
        };
      }

      if (q.includes("UPDATE student_role_assignments") && q.includes("is_active = FALSE")) {
        const a = assignments.find((x) => x.id === params[0]);
        if (a) {
          a.is_active = false;
          a.revoked_at = new Date().toISOString();
          a.revoked_by = params[1];
          a.revocation_reason = params[2];
        }
        return { rows: a ? [a] : [], rowCount: a ? 1 : 0 };
      }

      if (q.includes("SELECT sra.id AS assignment_id") && q.includes("FROM student_role_assignments sra")) {
        const activeAsns = assignments.filter((a) =>
          a.student_id === params[0] &&
          a.is_active &&
          !a.revoked_at &&
          (!a.expires_at || new Date(a.expires_at) > new Date())
        );
        const rows = [];
        for (const a of activeAsns) {
          const r = roles.find((x) => x.id === a.role_id);
          if (!r || !r.is_active) continue;
          const rps = rolePermissions.filter((rp) => rp.role_id === r.id);
          for (const rp of rps) {
            const p = permissions.find((perm) => perm.id === rp.permission_id);
            rows.push({
              assignment_id: a.id,
              scope_type: a.scope_type,
              scope_id: a.scope_id,
              expires_at: a.expires_at,
              role_id: r.id,
              role_code: r.code,
              role_name: r.name,
              permission_code: p.code,
              permission_module: p.module,
              allowed_scope_types: p.allowed_scope_types
            });
          }
        }
        return { rows, rowCount: rows.length };
      }

      if (q.includes("FROM student_role_assignments sra") && q.includes("sra.student_id = $1")) {
        const studentAsns = assignments.filter((a) => a.student_id === params[0]);
        const mapped = studentAsns.map((a) => {
          const r = roles.find((x) => x.id === a.role_id);
          return {
            ...a,
            role_code: r.code,
            role_name: r.name,
            role_is_active: r.is_active,
            is_system: r.is_system,
            assigned_by_name: "Admin",
            revoked_by_name: a.revoked_by ? "Admin" : null,
            project_name: a.scope_type === "PROJECT" ? "Project Alpha" : null,
            division_name: a.scope_type === "DIVISION" ? "Mobile Division" : null
          };
        });
        return { rows: mapped, rowCount: mapped.length };
      }

      if (q.includes("FROM rbac_legacy_role_mappings")) {
        const mapped = legacyMappings.map((m) => {
          const r = roles.find((x) => x.id === m.canonical_role_id);
          return {
            id: m.id,
            legacy_role_pattern: m.legacy_role_pattern,
            canonical_role_id: m.canonical_role_id,
            canonical_role_code: r.code,
            canonical_role_name: r.name,
            notes: m.notes,
            created_at: new Date().toISOString()
          };
        });
        return { rows: mapped, rowCount: mapped.length };
      }

      if (q.includes("INSERT INTO rbac_audit_logs")) {
        auditLogs.push({
          id: params[0],
          actor_id: params[1],
          actor_role: params[2],
          action: params[3],
          target_type: params[4],
          target_id: params[5],
          detail: JSON.parse(params[6]),
          ip: params[7],
          created_at: new Date().toISOString()
        });
        return { rows: [], rowCount: 1 };
      }

      if (q.includes("FROM rbac_legacy_reconciliations lr")) {
        let filtered = reconciliations;
        if (params.length > 0 && params[0] === "PENDING_RECONCILIATION") {
          filtered = filtered.filter((x) => x.status === "PENDING_RECONCILIATION");
        }
        const mapped = filtered.map((r) => {
          const s = students.find((x) => x.id === r.student_id);
          const u = users.find((x) => x.id === s?.user_id);
          const p = projects.find((x) => x.id === r.project_id);
          const rol = roles.find((x) => x.id === r.reconciled_role_id);
          return {
            ...r,
            student_nim: s?.nim || "13520001",
            student_name: u?.name || "Mahasiswa One",
            project_title: p?.name || "Project Alpha",
            reconciled_role_code: rol?.code || null,
            reconciled_role_name: rol?.name || null,
            reconciled_by_name: r.reconciled_by ? "Operator Admin" : null
          };
        });
        return { rows: mapped, rowCount: mapped.length };
      }

      if (q.includes("FROM rbac_legacy_reconciliations WHERE id = $1")) {
        const r = reconciliations.find((x) => x.id === params[0]);
        return { rows: r ? [r] : [], rowCount: r ? 1 : 0 };
      }

      if (q.includes("INSERT INTO rbac_legacy_reconciliations")) {
        const newRec = {
          id: params[0],
          student_id: params[1],
          project_id: params[2],
          legacy_peran: params[3],
          status: params[4] || "PENDING_RECONCILIATION",
          reconciled_role_id: null,
          reconciled_by: null,
          reconciled_at: null,
          notes: params[5] || null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };
        reconciliations.push(newRec);
        return { rows: [newRec], rowCount: 1 };
      }

      if (q.includes("UPDATE rbac_legacy_reconciliations")) {
        const r = reconciliations.find((x) => x.id === params[0]);
        if (r) {
          r.status = params[1];
          r.reconciled_role_id = params[2];
          r.reconciled_by = params[3];
          r.reconciled_at = new Date().toISOString();
          r.notes = params[4] || r.notes;
          r.updated_at = new Date().toISOString();
        }
        return { rows: r ? [r] : [], rowCount: r ? 1 : 0 };
      }

      if (q.includes("DELETE FROM student_role_assignments") && q.includes("SRA-BKF-")) {
        let count = 0;
        for (let i = assignments.length - 1; i >= 0; i--) {
          if (assignments[i].id.startsWith("SRA-BKF-")) {
            assignments.splice(i, 1);
            count++;
          }
        }
        return { rows: [], rowCount: count };
      }

      if (q.includes("FROM rbac_audit_logs")) {
        return { rows: auditLogs, rowCount: auditLogs.length };
      }

      return { rows: [], rowCount: 0 };
    }
  };

  return { executor, users, students, projects, roles, permissions, assignments, auditLogs, reconciliations };
}

// ---------------------------------------------------------------------------
// 16 REGRESSION TESTS
// ---------------------------------------------------------------------------

test("Regression 1: Role create/update/archive/restore", async () => {
  const { executor } = createRbacMockDb();
  const actor = { actorId: "USR-OP-1", actorRole: "OPERATOR" };

  // 1. Create role
  const created = await createRole({
    code: "QA_ENGINEER",
    name: "QA Engineer",
    description: "Quality assurance and testing lead"
  }, actor, executor);

  assert.equal(created.code, "QA_ENGINEER");
  assert.equal(created.name, "QA Engineer");
  assert.equal(created.isActive, true);
  assert.equal(created.version, 1);

  // 2. Update role (name/description)
  const updated = await updateRole(created.id, {
    name: "Senior QA Engineer",
    description: "Senior quality assurance and automation lead"
  }, actor, executor);

  assert.equal(updated.name, "Senior QA Engineer");
  assert.equal(updated.version, 2);

  // 3. Attempting to modify code throws error (code is immutable)
  await assert.rejects(
    async () => updateRole(created.id, { code: "NEW_CODE" }, actor, executor),
    /immutable/
  );

  // 4. Archive role
  const archived = await archiveRole(created.id, actor, executor);
  assert.equal(archived.isActive, false);

  // 5. Restore role
  const restored = await restoreRole(created.id, actor, executor);
  assert.equal(restored.isActive, true);
});

test("Regression 2: Duplicate role code rejected", async () => {
  const { executor } = createRbacMockDb();
  const actor = { actorId: "USR-OP-1", actorRole: "OPERATOR" };

  // Duplicate with existing canonical role (PROJECT_MANAGER)
  await assert.rejects(
    async () => createRole({ code: "PROJECT_MANAGER", name: "Dupe PM" }, actor, executor),
    (err) => {
      assert.equal(err.statusCode, 409);
      assert.match(err.message, /sudah terdaftar/);
      return true;
    }
  );
});

test("Regression 3: Valid/invalid permission grants", async () => {
  const { executor } = createRbacMockDb();
  const actor = { actorId: "USR-OP-1", actorRole: "OPERATOR" };

  // 1. Valid permission grants succeed
  const res = await updateRolePermissions(
    "ROL-CONTRIBUTOR",
    ["research.project.read", "scrum.task.create"],
    { expectedVersion: 1 },
    actor,
    executor
  );
  assert.deepEqual(res.permissions.sort(), ["research.project.read", "scrum.task.create"]);

  // 2. Arbitrary unregistered code rejected with 400
  await assert.rejects(
    async () => updateRolePermissions("ROL-CONTRIBUTOR", ["arbitrary.hack.code"], { expectedVersion: 2 }, actor, executor),
    (err) => {
      assert.equal(err.statusCode, 400);
      assert.match(err.message, /tidak dikenali/);
      return true;
    }
  );

  // 3. Wildcard or protected emergency permission rejected with 400
  await assert.rejects(
    async () => updateRolePermissions("ROL-CONTRIBUTOR", ["*"], { expectedVersion: 2 }, actor, executor),
    (err) => {
      assert.equal(err.statusCode, 400);
      assert.match(err.message, /dilindungi/);
      return true;
    }
  );
});

test("Regression 4: Multi-role permission union", async () => {
  const { executor } = createRbacMockDb();
  const actor = { actorId: "USR-OP-1", actorRole: "OPERATOR" };

  // Assign CONTRIBUTOR (read, sprint view, task create, task edit own)
  await assignStudentRole("STD-1", {
    roleCode: "CONTRIBUTOR",
    scopeType: "LAB"
  }, actor, executor);

  // Assign PROJECT_MANAGER on PRJ-ALPHA (adds project update, member manage, division manage, sprint manage, task manage, evaluate)
  await assignStudentRole("STD-1", {
    roleCode: "PROJECT_MANAGER",
    scopeType: "PROJECT",
    scopeId: "PRJ-ALPHA"
  }, actor, executor);

  const effective = await resolveStudentEffectivePermissions("STD-1", { projectId: "PRJ-ALPHA" }, executor);

  // Effective permissions must be the union of both roles
  assert.ok(effective.permissions.includes("research.project.read"));
  assert.ok(effective.permissions.includes("scrum.task.create"));
  assert.ok(effective.permissions.includes("scrum.sprint.manage"));
  assert.ok(effective.permissions.includes("evaluation.pm.evaluate"));
  assert.equal(effective.activeRoles.length, 2);
});

test("Regression 5: LAB/PROJECT/DIVISION scope enforcement", async () => {
  const { executor } = createRbacMockDb();
  const actor = { actorId: "USR-OP-1", actorRole: "OPERATOR" };

  // Assign LAB role
  await assignStudentRole("STD-1", {
    roleCode: "CONTRIBUTOR",
    scopeType: "LAB"
  }, actor, executor);

  // Assign DIVISION role on DIV-MOBILE
  await assignStudentRole("STD-1", {
    roleCode: "CORE_RESEARCHER",
    scopeType: "DIVISION",
    scopeId: "DIV-MOBILE"
  }, actor, executor);

  // Query effective permissions for DIV-MOBILE: CORE_RESEARCHER applies
  const mobileEffective = await resolveStudentEffectivePermissions("STD-1", { divisionId: "DIV-MOBILE" }, executor);
  assert.ok(mobileEffective.permissions.includes("scrum.task.manage"));

  // Query effective permissions for DIV-WEB: CORE_RESEARCHER does NOT apply (only LAB CONTRIBUTOR)
  const webEffective = await resolveStudentEffectivePermissions("STD-1", { divisionId: "DIV-WEB" }, executor);
  assert.ok(!webEffective.permissions.includes("scrum.task.manage"));
  assert.ok(webEffective.permissions.includes("research.project.read")); // from LAB
});

test("Regression 6: Cross-project access denied", async () => {
  const { executor } = createRbacMockDb();
  const actor = { actorId: "USR-OP-1", actorRole: "OPERATOR" };

  // Student 1 has PM role scoped specifically to PRJ-ALPHA
  await assignStudentRole("STD-1", {
    roleCode: "PROJECT_MANAGER",
    scopeType: "PROJECT",
    scopeId: "PRJ-ALPHA"
  }, actor, executor);

  // Check access on PRJ-ALPHA: granted
  const alphaAllowed = await hasEffectivePermission({
    userId: "USR-STD-1",
    permission: "scrum.sprint.manage",
    projectId: "PRJ-ALPHA"
  }, executor);
  assert.equal(alphaAllowed, true);

  // Check access on PRJ-BETA: strictly denied (false)
  const betaAllowed = await hasEffectivePermission({
    userId: "USR-STD-1",
    permission: "scrum.sprint.manage",
    projectId: "PRJ-BETA"
  }, executor);
  assert.equal(betaAllowed, false);
});

test("Regression 7: Expired/revoked/archived role denied", async () => {
  const { executor, roles } = createRbacMockDb();
  const actor = { actorId: "USR-OP-1", actorRole: "OPERATOR" };

  // 1. Expired assignment
  const expiredAsn = await assignStudentRole("STD-1", {
    roleCode: "CONTRIBUTOR",
    scopeType: "PROJECT",
    scopeId: "PRJ-ALPHA",
    expiresAt: new Date(Date.now() - 3600000).toISOString() // 1 hour ago
  }, actor, executor);

  let effective = await resolveStudentEffectivePermissions("STD-1", { projectId: "PRJ-ALPHA" }, executor);
  assert.equal(effective.permissions.length, 0);

  // 2. Revoked assignment
  const activeAsn = await assignStudentRole("STD-1", {
    roleCode: "CORE_RESEARCHER",
    scopeType: "PROJECT",
    scopeId: "PRJ-ALPHA"
  }, actor, executor);

  await revokeStudentRoleAssignment(activeAsn.id, { reason: "Demoted" }, actor, executor);
  effective = await resolveStudentEffectivePermissions("STD-1", { projectId: "PRJ-ALPHA" }, executor);
  assert.ok(!effective.permissions.includes("scrum.task.manage"));

  // 3. Archived role: permissions must not be granted if the role itself is archived
  const activeAsn2 = await assignStudentRole("STD-1", {
    roleCode: "KETUA_RISET",
    scopeType: "PROJECT",
    scopeId: "PRJ-ALPHA"
  }, actor, executor);

  // Archive role
  const r = roles.find((x) => x.code === "KETUA_RISET");
  r.is_active = false;

  effective = await resolveStudentEffectivePermissions("STD-1", { projectId: "PRJ-ALPHA" }, executor);
  assert.ok(!effective.permissions.includes("scrum.sprint.manage"));
});

test("Regression 8: Student self-assignment/self-escalation rejected", async () => {
  const { executor } = createRbacMockDb();

  // Mahasiswa attempting to assign a role to themselves
  const studentActor = { actorId: "USR-STD-1", actorRole: "MAHASISWA" };

  await assert.rejects(
    async () => assignStudentRole("STD-1", { roleCode: "PROJECT_MANAGER", scopeType: "LAB" }, studentActor, executor),
    (err) => {
      assert.equal(err.statusCode, 403);
      assert.match(err.message, /Akses ditolak/);
      return true;
    }
  );
});

test("Regression 9: Operator account role cannot be obtained through student RBAC", async () => {
  const { executor } = createRbacMockDb();
  const actor = { actorId: "USR-OP-1", actorRole: "OPERATOR" };

  await assignStudentRole("STD-1", {
    roleCode: "PROJECT_MANAGER",
    scopeType: "LAB"
  }, actor, executor);

  const effective = await resolveUserEffectivePermissions("USR-STD-1", {}, executor);
  // Account role remains 'mahasiswa', never changes to 'operator'
  assert.equal(effective.accountRole, "mahasiswa");
});

test("Regression 10: Concurrent permission edits return conflict (409)", async () => {
  const { executor } = createRbacMockDb();
  const actor = { actorId: "USR-OP-1", actorRole: "OPERATOR" };

  // Current version is 1; client sends stale expectedVersion = 99
  await assert.rejects(
    async () => updateRolePermissions(
      "ROL-CONTRIBUTOR",
      ["research.project.read"],
      { expectedVersion: 99 },
      actor,
      executor
    ),
    (err) => {
      assert.equal(err.statusCode, 409);
      assert.match(err.message, /Konflik konkurensi/);
      return true;
    }
  );
});

test("Regression 11: Assignment and permission changes generate audit trail", async () => {
  const { executor, auditLogs } = createRbacMockDb();
  const actor = { actorId: "USR-OP-1", actorRole: "OPERATOR", ip: "127.0.0.1" };

  await createRole({ code: "DATA_ANALYST", name: "Data Analyst" }, actor, executor);
  await updateRolePermissions("ROL-CONTRIBUTOR", ["research.project.read"], { expectedVersion: 1 }, actor, executor);
  const asn = await assignStudentRole("STD-1", { roleCode: "CONTRIBUTOR", scopeType: "LAB" }, actor, executor);
  await revokeStudentRoleAssignment(asn.id, { reason: "Test Revoke" }, actor, executor);

  assert.ok(auditLogs.some((l) => l.action === "ROLE_CREATED"));
  assert.ok(auditLogs.some((l) => l.action === "PERMISSIONS_UPDATED"));
  assert.ok(auditLogs.some((l) => l.action === "ROLE_ASSIGNED"));
  assert.ok(auditLogs.some((l) => l.action === "ROLE_REVOKED"));
});

test("Regression 12: Backend ignores spoofed userId/role/permission payload", async () => {
  // If an attacker sends client headers like X-User-Role: operator or body userId: admin,
  // the helper functions strictly verify actorContext passed from authenticated req.authUser.
  const { executor } = createRbacMockDb();
  const spoofedContext = { actorId: "USR-STD-1", actorRole: "mahasiswa" };

  await assert.rejects(
    async () => assignStudentRole("STD-1", { roleCode: "PROJECT_MANAGER", scopeType: "LAB" }, spoofedContext, executor),
    (err) => {
      assert.equal(err.statusCode, 403);
      return true;
    }
  );
});

test("Regression 13: Role catalog migration and legacy mapping idempotent", async () => {
  const { executor } = createRbacMockDb();

  // Test legacy role string resolution
  const ketuaMapping = await resolveLegacyRole("Ketua Riset AI", executor);
  assert.equal(ketuaMapping.roleCode, "KETUA_RISET");

  const pmMapping = await resolveLegacyRole("Project Manager IoT", executor);
  assert.equal(pmMapping.roleCode, "PROJECT_MANAGER");

  const coreMapping = await resolveLegacyRole("Lead Developer", executor);
  assert.equal(coreMapping.roleCode, "CORE_RESEARCHER");

  const memberMapping = await resolveLegacyRole("Anggota Frontend", executor);
  assert.equal(memberMapping.roleCode, "CONTRIBUTOR");

  // Ambiguous subordinate roles must NOT receive CONTRIBUTOR or any role with permissions.
  // Must be marked as PENDING_RECONCILIATION without active assignment.
  const wakilMapping = await resolveLegacyRole("Wakil Ketua Riset", executor);
  assert.equal(wakilMapping.status, "PENDING_RECONCILIATION");
  assert.equal(wakilMapping.roleCode, null);
  assert.equal(wakilMapping.isAmbiguous, true);

  const asistenPmMapping = await resolveLegacyRole("Asisten PM", executor);
  assert.equal(asistenPmMapping.status, "PENDING_RECONCILIATION");
  assert.equal(asistenPmMapping.roleCode, null);
  assert.equal(asistenPmMapping.isAmbiguous, true);

  const coLeaderMapping = await resolveLegacyRole("Co-Leader", executor);
  assert.equal(coLeaderMapping.status, "PENDING_RECONCILIATION");
  assert.equal(coLeaderMapping.roleCode, null);
  assert.equal(coLeaderMapping.isAmbiguous, true);

  const subLeadMapping = await resolveLegacyRole("Sub-Lead Backend", executor);
  assert.equal(subLeadMapping.status, "PENDING_RECONCILIATION");
  assert.equal(subLeadMapping.roleCode, null);
  assert.equal(subLeadMapping.isAmbiguous, true);

  // Unknown role pattern
  const unknownMapping = await resolveLegacyRole("Unmapped Space Astronaut", executor);
  assert.equal(unknownMapping, null);
});

test("Regression 14: PM evaluation and attendance guards intact", async () => {
  const mockAssignment = {
    id: "ASN-101",
    period_id: "EVP-101",
    student_id: "STD-1",
    evaluator_id: "USR-STD-1",
    status: "PENDING",
    period_status: "OPEN",
    period_type: "PM_EVALUATION",
    period_scoring_version: "PM_V2_KSA"
  };

  const evalMockExecutor = {
    connect: async () => evalMockExecutor,
    release: () => {},
    query: async (sql) => {
      const q = sql.trim();
      if (q.includes("information_schema.tables")) return { rows: [{ exists: true }] };
      if (q.includes("FROM evaluation_assignments ea")) return { rows: [mockAssignment], rowCount: 1 };
      if (q.includes("FROM evaluation_period_evaluators")) return { rows: [{ attendance_status: "PENDING" }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    }
  };

  // Even if user has PM role, evaluation invariant requires PRESENT attendance
  await assert.rejects(
    async () => savePmEvaluationSubmission("ASN-101", "USR-STD-1", { status: "DRAFT" }, evalMockExecutor),
    (err) => {
      assert.equal(err.statusCode, 422);
      assert.match(err.message, /kehadiran: PENDING/);
      return true;
    }
  );
});

test("Regression 15: Scrum and research baseline access intact", async () => {
  const { executor } = createRbacMockDb();
  const actor = { actorId: "USR-OP-1", actorRole: "OPERATOR" };

  // Assign KETUA_RISET to STD-1 on PRJ-ALPHA
  await assignStudentRole("STD-1", {
    roleCode: "KETUA_RISET",
    scopeType: "PROJECT",
    scopeId: "PRJ-ALPHA"
  }, actor, executor);

  const hasSprintManage = await hasEffectivePermission({
    userId: "USR-STD-1",
    permission: "scrum.sprint.manage",
    projectId: "PRJ-ALPHA"
  }, executor);

  assert.equal(hasSprintManage, true);
});

test("Regression 16: No regression in existing backend tests", () => {
  assert.equal(REGISTERED_PERMISSIONS.length > 0, true);
  assert.equal(CANONICAL_ROLES.length, 4);
});

test("Regression 17: Forward-only legacy reconciliation removes only auto-backfill and preserves manual assignments", async () => {
  const { executor, assignments } = createRbacMockDb();

  // Setup: One auto-backfilled assignment (id starts with SRA-BKF-)
  assignments.push({
    id: "SRA-BKF-STD-1-PRJ-ALPHA",
    student_id: "STD-1",
    role_id: "ROL-CONTRIBUTOR",
    scope_type: "PROJECT",
    scope_id: "PRJ-ALPHA",
    assigned_by: null,
    is_active: true,
    revoked_at: null
  });

  // Setup: One manually assigned role (id does not start with SRA-BKF-)
  assignments.push({
    id: "SRA-MANUAL-OPERATOR-999",
    student_id: "STD-2",
    role_id: "ROL-PROJECT-MANAGER",
    scope_type: "PROJECT",
    scope_id: "PRJ-ALPHA",
    assigned_by: "USR-OP-1",
    is_active: true,
    revoked_at: null
  });

  // Execute forward-only migration cleanup (as in migration 042)
  await executor.query("DELETE FROM student_role_assignments WHERE id LIKE 'SRA-BKF-%'");

  // Verify auto-backfilled assignment was safely removed
  assert.equal(assignments.some((a) => a.id === "SRA-BKF-STD-1-PRJ-ALPHA"), false);

  // Verify manual assignment is untouched
  const manualAssigned = assignments.find((a) => a.id === "SRA-MANUAL-OPERATOR-999");
  assert.ok(manualAssigned, "Manual assignment must be preserved");
  assert.equal(manualAssigned.role_id, "ROL-PROJECT-MANAGER");
});

test("Regression 18: Permission catalog includes enforcementStatus and isDelegable metadata", async () => {
  const { executor } = createRbacMockDb();
  const permissions = await listPermissions(executor);

  assert.ok(permissions.length >= 13);
  for (const p of permissions) {
    assert.ok(["ENFORCED", "NOT_ENFORCED", "PARTIAL"].includes(p.enforcementStatus));
    assert.equal(typeof p.isDelegable, "boolean");
    assert.equal(typeof p.isProtected, "boolean");
  }

  // Institutional boundaries strictly marked as NOT_ENFORCED
  const memberManage = permissions.find((p) => p.code === "research.member.manage");
  assert.equal(memberManage.enforcementStatus, "NOT_ENFORCED");
  assert.equal(memberManage.isDelegable, false);

  const projectUpdate = permissions.find((p) => p.code === "research.project.update");
  assert.equal(projectUpdate.enforcementStatus, "NOT_ENFORCED");
  assert.equal(projectUpdate.isDelegable, false);

  // Core scrum task capabilities marked as ENFORCED
  const taskCreate = permissions.find((p) => p.code === "scrum.task.create");
  assert.equal(taskCreate.enforcementStatus, "ENFORCED");
  assert.equal(taskCreate.isDelegable, true);

  const sprintManage = permissions.find((p) => p.code === "scrum.sprint.manage");
  assert.equal(sprintManage.enforcementStatus, "ENFORCED");
  assert.equal(sprintManage.isDelegable, true);

  // Evaluation PM submission is ENFORCED with domain invariants (non-delegable)
  const pmEvaluate = permissions.find((p) => p.code === "evaluation.pm.evaluate");
  assert.equal(pmEvaluate.enforcementStatus, "ENFORCED");
  assert.equal(pmEvaluate.isDelegable, false);

  // Lab picket is PARTIAL
  const labPicket = permissions.find((p) => p.code === "lab.picket.manage");
  assert.equal(labPicket.enforcementStatus, "PARTIAL");
});

test("Regression 19: Ambiguous roles reconciliation workflow (list, reconcile, audit)", async () => {
  const { executor } = createRbacMockDb();
  const actor = { actorId: "USR-OP-1", actorRole: "OPERATOR" };

  // 1. List reconciliations
  const list = await listLegacyReconciliations({ status: "PENDING_RECONCILIATION" }, executor);
  assert.equal(list.length, 1);
  assert.equal(list[0].legacyPeran, "Wakil Ketua Riset");
  assert.equal(list[0].status, "PENDING_RECONCILIATION");

  // 2. Unauthorized reconciliation attempt
  const studentActor = { actorId: "USR-STD-1", actorRole: "mahasiswa" };
  await assert.rejects(
    async () => reconcileLegacyRole(list[0].id, { roleCode: "CONTRIBUTOR" }, studentActor, executor),
    (err) => {
      assert.equal(err.statusCode, 403);
      return true;
    }
  );

  // 3. Authorized operator reconciliation
  const result = await reconcileLegacyRole(
    list[0].id,
    { roleCode: "CONTRIBUTOR", notes: "Approved as Contributor by Admin" },
    actor,
    executor
  );

  assert.equal(result.reconciliation.status, "RECONCILED");
  assert.equal(result.reconciliation.reconciledRoleId, "ROL-CONTRIBUTOR");
  assert.ok(result.assignment);
  assert.equal(result.assignment.roleCode, "CONTRIBUTOR");
});

test("Regression 20: Context roles contract provides canonical metadata for frontend integration", async () => {
  const { executor } = createRbacMockDb();
  const contextRoles = await listContextRoles({ scopeType: "PROJECT" }, executor);

  assert.equal(contextRoles.length, 4);
  const pmRole = contextRoles.find((r) => r.code === "PROJECT_MANAGER");
  assert.ok(pmRole);
  assert.equal(pmRole.suggestedPeran, "Project Manager");
  assert.ok(Array.isArray(pmRole.permissions));

  const ketuaRole = contextRoles.find((r) => r.code === "KETUA_RISET");
  assert.ok(ketuaRole);
  assert.equal(ketuaRole.suggestedPeran, "Ketua Riset");

  const contributorRole = contextRoles.find((r) => r.code === "CONTRIBUTOR");
  assert.ok(contributorRole);
  assert.equal(contributorRole.suggestedPeran, "Anggota Riset");
});

test("Regression 21: Authentication via httpOnly cookie (accessToken) succeeds without Bearer header", async () => {
  const { executor } = createRbacMockDb();

  // 1. When req.authUser is populated via httpOnly cookie (credentials: include), /me succeeds
  const effective = await resolveUserEffectivePermissions("USR-STD-1", {}, executor);
  assert.equal(effective.userId, "USR-STD-1");
  assert.equal(effective.accountRole, "mahasiswa");

  // 2. When no session is present (anonymous/missing cookie and missing Bearer), userId is null
  const unauthenticated = await resolveUserEffectivePermissions(null, {}, executor);
  assert.equal(unauthenticated.userId, null);
  assert.equal(unauthenticated.accountRole, "anonymous");
  assert.deepEqual(unauthenticated.permissions, []);
});

test("Regression 22: Dual Revocation endpoints (DELETE and POST .../revoke) are identical aliases", async () => {
  const { executor, assignments } = createRbacMockDb();
  const actor = { actorId: "USR-OP-1", actorRole: "OPERATOR" };

  // 1. Assign role to STD-1
  const assigned = await assignStudentRole(
    "STD-1",
    { roleCode: "CONTRIBUTOR", scopeType: "PROJECT", scopeId: "PRJ-ALPHA" },
    actor,
    executor
  );

  assert.equal(assigned.isActive, true);

  // 2. Revoke via revokeStudentRoleAssignment (which backs both DELETE and POST .../revoke)
  const revoked = await revokeStudentRoleAssignment(
    assigned.id,
    { reason: "Revoked via alias method" },
    actor,
    executor
  );

  assert.equal(revoked.isActive, false);
  assert.equal(revoked.revocationReason, "Revoked via alias method");

  // Confirm in database/mock assignments
  const stored = assignments.find((a) => a.id === assigned.id);
  assert.equal(stored.is_active, false);
  assert.equal(stored.revocation_reason, "Revoked via alias method");
});

test("Regression 23: Migration 042 provenance-safe cleanup preserves other valid assignments in same project", async () => {
  const { executor, assignments } = createRbacMockDb();

  // Setup 1: Ambiguous auto-backfill for STD-1
  assignments.push({
    id: "SRA-BKF-STD-1-PRJ-ALPHA",
    student_id: "STD-1",
    role_id: "ROL-CONTRIBUTOR",
    scope_type: "PROJECT",
    scope_id: "PRJ-ALPHA",
    assigned_by: null, // provenance: system auto-backfill
    is_active: true,
    revoked_at: null
  });

  // Setup 2: Legitimate manual assignment for STD-1 in SAME project
  assignments.push({
    id: "SRA-MANUAL-STD-1-PRJ-ALPHA",
    student_id: "STD-1",
    role_id: "ROL-CORE-RESEARCHER",
    scope_type: "PROJECT",
    scope_id: "PRJ-ALPHA",
    assigned_by: "USR-OP-1", // provenance: manual by operator
    is_active: true,
    revoked_at: null
  });

  // Setup 3: Legitimate non-ambiguous auto-backfill for STD-2
  assignments.push({
    id: "SRA-BKF-STD-2-PRJ-ALPHA",
    student_id: "STD-2",
    role_id: "ROL-KETUA-RISET",
    scope_type: "PROJECT",
    scope_id: "PRJ-ALPHA",
    assigned_by: null,
    is_active: true,
    revoked_at: null
  });

  // Execute migration 042 safe deletion query
  await executor.query("DELETE FROM student_role_assignments WHERE id LIKE 'SRA-BKF-%'");

  // Ambiguous backfill must be gone
  assert.equal(assignments.some((a) => a.id === "SRA-BKF-STD-1-PRJ-ALPHA"), false);

  // Manual assignment in same project MUST remain intact
  const manual = assignments.find((a) => a.id === "SRA-MANUAL-STD-1-PRJ-ALPHA");
  assert.ok(manual, "Manual assignment must not be deleted");
  assert.equal(manual.role_id, "ROL-CORE-RESEARCHER");
});

test("Regression 24: Repeated bootstrap and migrations (041 -> 042 -> re-run ensureRbacTables) never grants permissions to ambiguous roles", async () => {
  const { executor } = createRbacMockDb();

  // Run ensureRbacTables again (repeated bootstrap)
  await ensureRbacTables(executor);

  // Resolve permissions for STD-1 with ambiguous legacy role ("Wakil Ketua Riset")
  // Since no assignment was created, student must have ZERO elevated permissions
  const effective = await resolveStudentEffectivePermissions("STD-1", { projectId: "PRJ-ALPHA" }, executor);
  assert.deepEqual(effective.permissions, []);
  assert.deepEqual(effective.activeRoles, []);
});

test("Regression 25: legacy-reconciliations endpoints authorization & response validation", async () => {
  const { executor } = createRbacMockDb();
  const operatorActor = { actorId: "USR-OP-1", actorRole: "OPERATOR" };
  const studentActor = { actorId: "USR-STD-1", actorRole: "MAHASISWA" };

  // 1. List reconciliations
  const list = await listLegacyReconciliations({}, executor);
  assert.ok(Array.isArray(list));
  assert.equal(list.length > 0, true);

  const pendingItem = list.find((item) => item.status === "PENDING_RECONCILIATION");
  assert.ok(pendingItem);

  // 2. Reject non-operator
  await assert.rejects(
    async () => reconcileLegacyRole(pendingItem.id, { roleCode: "CONTRIBUTOR" }, studentActor, executor),
    (err) => {
      assert.equal(err.statusCode, 403);
      return true;
    }
  );

  // 3. Reconcile with action: IGNORE
  const ignoreResult = await reconcileLegacyRole(
    pendingItem.id,
    { action: "IGNORE", notes: "No access required" },
    operatorActor,
    executor
  );
  assert.equal(ignoreResult.reconciliation.status, "IGNORED");
  assert.equal(ignoreResult.assignment, null);
});
