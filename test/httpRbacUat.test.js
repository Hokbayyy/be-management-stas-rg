const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const dotenv = require("dotenv");

const envFile = ".env.test.local";
const config = fs.existsSync(envFile) ? dotenv.parse(fs.readFileSync(envFile)) : {};
const baseUrl = `http://localhost:${config.PORT || 3333}/api/v1`;

let operatorCookie = null;
let customRoleId = null;
let student2AssignmentId = null;
let pendingReconciliationId = null;

async function apiRequest(path, options = {}) {
  const url = `${baseUrl}${path}`;
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };

  const cookie = options.cookie !== undefined ? options.cookie : operatorCookie;
  if (cookie) {
    headers["Cookie"] = cookie;
  }

  const res = await fetch(url, {
    method: options.method || "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const setCookie = res.headers.get("set-cookie");
  if (setCookie) {
    const match = setCookie.match(/accessToken=[^;]+/);
    if (match) {
      operatorCookie = match[0];
    }
  }

  let data = null;
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    data = await res.json();
  } else {
    data = await res.text();
  }

  return { status: res.status, data, headers: res.headers };
}

const { Pool } = require("pg");

test("UAT RBAC End-to-End HTTP Integration Suite on localhost:3333", async (t) => {
  if (!config.DATABASE_URL) {
    t.skip("No .env.test.local configuration found. Skipping HTTP UAT suite.");
    return;
  }

  try {
    const health = await fetch(`${baseUrl}/health`).then((r) => r.json()).catch(() => null);
    if (!health || !health.ok) {
      t.skip("Local UAT server on port 3333 is not running. Start with node --env-file=.env.test.local ./bin/www to run this suite.");
      return;
    }
  } catch (err) {
    t.skip(`Local UAT server on port 3333 is unreachable (${err.message}). Skipping.`);
    return;
  }

  const pool = new Pool({ connectionString: config.DATABASE_URL });

  t.before(async () => {
    // Reset test student role assignments
    await pool.query(`
      DELETE FROM student_role_assignments WHERE student_id IN ('STD-UAT-1', 'STD-UAT-2');
      UPDATE rbac_legacy_reconciliations
      SET status = 'PENDING_RECONCILIATION', reconciled_role_id = NULL, reconciled_by = NULL, reconciled_at = NULL, notes = 'Legacy ambiguous role queued for RBAC UAT testing'
      WHERE student_id = 'STD-UAT-1' AND project_id = 'PRJ-UAT-RBAC-1';
    `);
  });

  t.after(async () => {
    await pool.end();
  });
  await t.test("1. Operator Login sets httpOnly JWT cookie", async () => {
    const res = await apiRequest("/auth/login", {
      method: "POST",
      body: {
        email: config.TEST_OP_EMAIL,
        password: config.TEST_OP_PASSWORD
      }
    });

    assert.equal(res.status, 200, "Login must return 200 OK");
    assert.ok(operatorCookie, "accessToken cookie must be set in response");
    assert.equal(res.data.user.role, "operator");
  });

  await t.test("2. Authenticated endpoint recognizes user via cookie alone without Bearer header", async () => {
    const res = await apiRequest("/rbac/me");
    assert.equal(res.status, 200);
    assert.equal(res.data.accountRole, "operator");
    assert.ok(Array.isArray(res.data.permissions));
  });

  // =========================================================================
  // 2. Role Catalog CRUD
  // =========================================================================
  await t.test("3. List Canonical Roles", async () => {
    const res = await apiRequest("/rbac/roles");
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.data));
    const codes = res.data.map(r => r.code);
    assert.ok(codes.includes("KETUA_RISET"));
    assert.ok(codes.includes("CONTRIBUTOR"));
  });

  await t.test("4. Create Custom Role", async () => {
    const roleCode = `UAT_SPECIALIST_${Date.now()}`;
    const res = await apiRequest("/rbac/roles", {
      method: "POST",
      body: {
        code: roleCode,
        name: "UAT QA Specialist",
        description: "Specialized role created during UAT",
        permissions: ["scrum.task.create", "scrum.task.edit_own"]
      }
    });

    assert.equal(res.status, 201);
    assert.equal(res.data.data.code, roleCode);
    customRoleId = res.data.data.id;
  });

  await t.test("5. Update Custom Role", async () => {
    assert.ok(customRoleId);
    const res = await apiRequest(`/rbac/roles/${customRoleId}`, {
      method: "PUT",
      body: {
        name: "UAT QA Lead Specialist",
        description: "Updated description for UAT QA Lead"
      }
    });

    assert.equal(res.status, 200);
    assert.equal(res.data.data.name, "UAT QA Lead Specialist");
  });

  await t.test("6. Archive and Restore Custom Role", async () => {
    assert.ok(customRoleId);
    const archiveRes = await apiRequest(`/rbac/roles/${customRoleId}/archive`, {
      method: "POST"
    });
    assert.equal(archiveRes.status, 200);
    assert.equal(archiveRes.data.data.isActive, false);

    const restoreRes = await apiRequest(`/rbac/roles/${customRoleId}/restore`, {
      method: "POST"
    });
    assert.equal(restoreRes.status, 200);
    assert.equal(restoreRes.data.data.isActive, true);
  });

  // =========================================================================
  // 3. Permission Matrix
  // =========================================================================
  await t.test("7. List Permissions Catalog with Capability Metadata", async () => {
    const res = await apiRequest("/rbac/permissions");
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.data));
    const sample = res.data.find(p => p.code === "scrum.task.create");
    assert.ok(sample);
    assert.equal(sample.enforcementStatus, "ENFORCED");
    assert.equal(sample.isDelegable, true);
  });

  await t.test("8. Update Role Permissions with Version Concurrency Control", async () => {
    assert.ok(customRoleId);
    const permRes = await apiRequest(`/rbac/roles/${customRoleId}/permissions`);
    assert.equal(permRes.status, 200);
    const currentVersion = permRes.data.version;

    const updateRes = await apiRequest(`/rbac/roles/${customRoleId}/permissions`, {
      method: "PUT",
      body: {
        permissions: ["scrum.task.create", "scrum.task.edit_own", "research.project.read"],
        version: currentVersion
      }
    });

    assert.equal(updateRes.status, 200);
    assert.equal(updateRes.data.data.version, currentVersion + 1);
  });

  await t.test("9. Get Role Impact Preview", async () => {
    assert.ok(customRoleId);
    const res = await apiRequest(`/rbac/roles/${customRoleId}/impact`);
    assert.equal(res.status, 200);
    assert.equal(res.data.roleId, customRoleId);
    assert.equal(typeof res.data.activeAssignments, "number");
    assert.equal(typeof res.data.totalAssignments, "number");
    assert.ok(res.data.scopeBreakdown);
  });

  // =========================================================================
  // 4. Student Role Assignment
  // =========================================================================
  await t.test("10. Assign Role to Student 2 (STD-UAT-2)", async () => {
    const res = await apiRequest("/rbac/students/STD-UAT-2/role-assignments", {
      method: "POST",
      body: {
        roleId: "ROL-CONTRIBUTOR",
        scopeType: "PROJECT",
        scopeId: "PRJ-UAT-RBAC-1"
      }
    });

    assert.equal(res.status, 201);
    assert.equal(res.data.data.studentId, "STD-UAT-2");
    assert.equal(res.data.data.roleId, "ROL-CONTRIBUTOR");
    student2AssignmentId = res.data.data.id;
  });

  await t.test("11. List Student Role Assignments", async () => {
    const res = await apiRequest("/rbac/students/STD-UAT-2/role-assignments");
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.data));
    const assigned = res.data.find(a => a.id === student2AssignmentId);
    assert.ok(assigned);
    assert.equal(assigned.isActive, true);
  });

  // =========================================================================
  // 5. Effective Permissions Resolution
  // =========================================================================
  await t.test("12. Resolve Student Effective Permissions (Project 1)", async () => {
    const res = await apiRequest("/rbac/students/STD-UAT-2/effective-permissions?projectId=PRJ-UAT-RBAC-1");
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.data.permissions));
    assert.ok(res.data.permissions.includes("research.project.read"));
    assert.ok(res.data.activeRoles.some(r => r.roleId === "ROL-CONTRIBUTOR"));
  });

  await t.test("13. Scope Isolation: Student has NO role permissions on Project 2", async () => {
    const res = await apiRequest("/rbac/students/STD-UAT-2/effective-permissions?projectId=PRJ-UAT-RBAC-2");
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.data.permissions));
    assert.deepEqual(res.data.permissions, [], "Must have 0 effective permissions on Project 2");
    assert.ok(!res.data.activeRoles.some(r => r.scopeId === "PRJ-UAT-RBAC-2"), "Must not have active role on Project 2");
  });

  // =========================================================================
  // 6. Revocation (DELETE & POST .../revoke)
  // =========================================================================
  await t.test("14. Revoke Role Assignment via DELETE", async () => {
    assert.ok(student2AssignmentId);
    const res = await apiRequest(`/rbac/students/STD-UAT-2/role-assignments/${student2AssignmentId}`, {
      method: "DELETE",
      body: {
        reason: "UAT testing revocation"
      }
    });

    assert.equal(res.status, 200);
    assert.equal(res.data.data.isActive, false);
    assert.equal(res.data.data.revocationReason, "UAT testing revocation");
  });

  // =========================================================================
  // 7. Legacy Role Reconciliation
  // =========================================================================
  await t.test("14. List Pending Legacy Reconciliations with ?status=PENDING", async () => {
    const res = await apiRequest("/rbac/legacy-reconciliations?status=PENDING");
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.data));
    const item = res.data.find(r => r.studentId === "STD-UAT-1");
    assert.ok(item, "STD-UAT-1 ambiguous role must be in pending reconciliations");
    assert.equal(item.status, "PENDING_RECONCILIATION");
    pendingReconciliationId = item.id;
  });

  await t.test("15. Execute Reconcile with ASSIGN_ROLE payload", async () => {
    assert.ok(pendingReconciliationId);
    const res = await apiRequest(`/rbac/legacy-reconciliations/${pendingReconciliationId}/reconcile`, {
      method: "POST",
      body: {
        action: "ASSIGN_ROLE",
        roleId: "ROL-CONTRIBUTOR",
        notes: "UAT verified contributor assignment"
      }
    });

    assert.equal(res.status, 200);
    assert.equal(res.data.data.reconciliation.status, "RECONCILED");
    assert.equal(res.data.data.assignment.roleId, "ROL-CONTRIBUTOR");
    assert.equal(res.data.data.assignment.studentId, "STD-UAT-1");
  });

  await t.test("16. Verify Pending List Decreased", async () => {
    const res = await apiRequest("/rbac/legacy-reconciliations?status=PENDING");
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.data));
    const item = res.data.find(r => r.studentId === "STD-UAT-1");
    assert.equal(item, undefined, "STD-UAT-1 must no longer be pending");
  });

  await t.test("17. Duplicate Reconcile returns 409 Conflict", async () => {
    assert.ok(pendingReconciliationId);
    const res = await apiRequest(`/rbac/legacy-reconciliations/${pendingReconciliationId}/reconcile`, {
      method: "POST",
      body: {
        action: "ASSIGN_ROLE",
        roleId: "ROL-CONTRIBUTOR"
      }
    });

    assert.equal(res.status, 409, "Duplicate reconciliation must return 409 Conflict");
  });

  // =========================================================================
  // 8. Audit Logs
  // =========================================================================
  await t.test("19. List RBAC Audit Logs", async () => {
    const res = await apiRequest("/rbac/audit");
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.data));
    const actions = res.data.map(l => l.action);
    assert.ok(actions.includes("ROLE_CREATED"));
    assert.ok(actions.includes("ROLE_ASSIGNED"));
    assert.ok(actions.includes("ROLE_REVOKED"));
    assert.ok(actions.includes("RECONCILE_LEGACY_ROLE"));
  });

  // =========================================================================
  // 9. Unified Role Management V2 (Discovery, Import, Replace & Archive)
  // =========================================================================
  let importedRoleId = null;
  let targetReplacementRoleId = null;

  await t.test("20. Discover role sources from research memberships", async () => {
    const res = await apiRequest("/rbac/roles/discovery");
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.data.sources));
  });

  await t.test("21. Import descriptive role with zero initial permissions", async () => {
    const timestamp = Date.now();
    const res = await apiRequest("/rbac/roles/import", {
      method: "POST",
      body: {
        sourcePeran: "Frontend Developer",
        code: `FE_DEV_${timestamp}`,
        name: `Frontend Developer ${timestamp}`,
        category: "FUNCTIONAL"
      }
    });

    assert.equal(res.status, 201);
    assert.equal(res.data.data.category, "FUNCTIONAL");
    assert.equal(res.data.data.isSystem, false);
    importedRoleId = res.data.data.id;
  });

  await t.test("22. Query Context Roles with category & scope filters", async () => {
    const res = await apiRequest("/rbac/context-roles?category=SYSTEM&scopeType=PROJECT");
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.data));
    for (const r of res.data) {
      assert.equal(r.category, "SYSTEM");
    }
  });

  await t.test("23. Role Retirement Impact Preview", async () => {
    assert.ok(importedRoleId);
    const targetRoleRes = await apiRequest("/rbac/roles", {
      method: "POST",
      body: {
        code: `TARGET_REPL_${Date.now()}`,
        name: `Target Replacement ${Date.now()}`,
        category: "FUNCTIONAL",
        allowedScopeTypes: ["PROJECT"]
      }
    });
    assert.equal(targetRoleRes.status, 201);
    targetReplacementRoleId = targetRoleRes.data.data.id;

    // Assign imported role to Student 2
    await apiRequest("/rbac/students/STD-UAT-2/role-assignments", {
      method: "POST",
      body: {
        roleId: importedRoleId,
        scopeType: "PROJECT",
        scopeId: "PRJ-UAT-RBAC-1"
      }
    });

    const res = await apiRequest(`/rbac/roles/${importedRoleId}/retirement-impact?replacementRoleId=${targetReplacementRoleId}`);
    assert.equal(res.status, 200);
    assert.equal(res.data.activeAssignmentsCount, 1);
    assert.equal(res.data.canProceed, true);
    assert.deepEqual(res.data.blockingIssues, []);
  });

  await t.test("24. Replace and Archive Role via HTTP", async () => {
    assert.ok(importedRoleId);
    assert.ok(targetReplacementRoleId);

    // Get source role to fetch its version
    const sourceRes = await apiRequest(`/rbac/roles/${importedRoleId}`);
    assert.equal(sourceRes.status, 200);

    const res = await apiRequest(`/rbac/roles/${importedRoleId}/replace-and-archive`, {
      method: "POST",
      body: {
        replacementRoleId: targetReplacementRoleId,
        sourceVersion: sourceRes.data.version,
        reason: "HTTP UAT replace and archive verification",
        migrateMembershipLabels: false
      }
    });

    assert.equal(res.status, 200);
    assert.equal(res.data.data.migratedAssignmentsCount, 1);

    // Verify source role is now archived
    const checkArchived = await apiRequest(`/rbac/roles/${importedRoleId}`);
    assert.equal(checkArchived.data.isActive, false);
  });

  // =========================================================================
  // 10. Unauthorized Access Protections
  // =========================================================================
  await t.test("25. Unauthenticated request without cookie returns 401", async () => {
    const res = await apiRequest("/rbac/me", { cookie: null });
    assert.equal(res.status, 401);
  });

  await t.test("26. Student account cannot perform operator actions (returns 403)", async () => {
    const loginRes = await apiRequest("/auth/login", {
      method: "POST",
      body: {
        email: config.TEST_STD1_EMAIL,
        password: config.TEST_STD1_PASSWORD
      },
      cookie: null
    });
    assert.equal(loginRes.status, 200);
    const setCookie = loginRes.headers.get("set-cookie");
    assert.ok(setCookie);
    const studentCookie = setCookie.match(/accessToken=[^;]+/)[0];

    // Student cannot create roles
    const createRoleRes = await apiRequest("/rbac/roles", {
      method: "POST",
      body: { code: "ILLEGAL_ROLE", name: "Illegal" },
      cookie: studentCookie
    });
    assert.equal(createRoleRes.status, 403);

    // Student cannot assign roles
    const assignRes = await apiRequest("/rbac/students/STD-UAT-2/role-assignments", {
      method: "POST",
      body: { roleId: "ROL-CONTRIBUTOR", scopeType: "PROJECT", scopeId: "PRJ-UAT-RBAC-1" },
      cookie: studentCookie
    });
    assert.equal(assignRes.status, 403);

    // Student cannot reconcile legacy roles
    const recRes = await apiRequest("/rbac/legacy-reconciliations/REC-UAT-STD-1/reconcile", {
      method: "POST",
      body: { action: "IGNORE" },
      cookie: studentCookie
    });
    assert.equal(recRes.status, 403);

    // Student cannot view audit logs
    const auditRes = await apiRequest("/rbac/audit", { cookie: studentCookie });
    assert.equal(auditRes.status, 403);

    // Student cannot view another student's permissions
    const otherPermsRes = await apiRequest("/rbac/students/STD-UAT-2/effective-permissions", { cookie: studentCookie });
    assert.equal(otherPermsRes.status, 403);

    // Student CAN view own permissions
    const ownPermsRes = await apiRequest("/rbac/students/STD-UAT-1/effective-permissions", { cookie: studentCookie });
    assert.equal(ownPermsRes.status, 200);
  });
});
