const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const { assertStagingEquivalentTarget } = require("../scripts/scrumV2DatabaseSafety");
const {
  ensureRbacTables,
  listLegacyReconciliations,
  reconcileLegacyRole,
  resolveStudentEffectivePermissions
} = require("../utils/rbacService");

const testDbUrl = process.env.TEST_DATABASE_URL || "postgres://postgres:postgres@127.0.0.1:5433/stasrg_test";

test("PostgreSQL Isolated Integration: RBAC Migrations 041 -> 042 -> Repeated Bootstrap Row Count Audit", async (t) => {
  let pool;
  try {
    assertStagingEquivalentTarget(testDbUrl);
    pool = new Pool({ connectionString: testDbUrl });
    await pool.query("SELECT 1");
  } catch (err) {
    t.skip(`Isolated PostgreSQL test database unavailable (${err.message}). Marking integration test as BLOCKED.`);
    return;
  }

  try {
    // 1. Reset Schema for a clean run
    await pool.query("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
    const schemaSql = fs.readFileSync(path.join(__dirname, "..", "db", "schema.sql"), "utf8");
    await pool.query(schemaSql);

    // 2. Seed Baseline Data
    await pool.query(`
      INSERT INTO users (id, name, initials, email, role, is_active)
      VALUES
        ('USR-OP-TEST', 'Operator Test', 'OT', 'operator@test.local', 'operator', true),
        ('USR-STD-AMB-1', 'Student Wakil', 'SW', 'amb1@test.local', 'mahasiswa', true),
        ('USR-STD-AMB-2', 'Student Asisten', 'SA', 'amb2@test.local', 'mahasiswa', true),
        ('USR-STD-VAL-1', 'Student Ketua', 'SK', 'val1@test.local', 'mahasiswa', true),
        ('USR-STD-VAL-2', 'Student Member', 'SM', 'val2@test.local', 'mahasiswa', true)
      ON CONFLICT DO NOTHING;

      INSERT INTO students (id, user_id, nim, status, tipe)
      VALUES
        ('STD-AMB-1', 'USR-STD-AMB-1', '10001', 'Aktif', 'Riset'),
        ('STD-AMB-2', 'USR-STD-AMB-2', '10002', 'Aktif', 'Riset'),
        ('STD-VAL-1', 'USR-STD-VAL-1', '10003', 'Aktif', 'Riset'),
        ('STD-VAL-2', 'USR-STD-VAL-2', '10004', 'Aktif', 'Riset')
      ON CONFLICT DO NOTHING;

      INSERT INTO research_projects (id, title, status)
      VALUES ('PRJ-TEST-1', 'Riset AI Testing', 'Aktif')
      ON CONFLICT DO NOTHING;

      INSERT INTO research_memberships (project_id, user_id, member_type, peran, status)
      VALUES
        ('PRJ-TEST-1', 'USR-STD-AMB-1', 'Mahasiswa', 'Wakil Ketua Riset', 'Aktif'),
        ('PRJ-TEST-1', 'USR-STD-AMB-2', 'Mahasiswa', 'Asisten PM', 'Aktif'),
        ('PRJ-TEST-1', 'USR-STD-VAL-1', 'Mahasiswa', 'Ketua Riset', 'Aktif'),
        ('PRJ-TEST-1', 'USR-STD-VAL-2', 'Mahasiswa', 'Anggota Frontend', 'Aktif')
      ON CONFLICT DO NOTHING;
    `);

    // 3. Apply Migration 041
    const migration041Sql = fs.readFileSync(path.join(__dirname, "..", "db", "migrations", "041_dynamic_student_rbac.sql"), "utf8");
    await pool.query(migration041Sql);

    // Audit Row Counts After Migration 041
    const rolesCount041 = await pool.query("SELECT COUNT(*)::int AS count FROM rbac_roles");
    assert.equal(rolesCount041.rows[0].count, 4, "Should seed 4 canonical roles");

    const permsCount041 = await pool.query("SELECT COUNT(*)::int AS count FROM rbac_permissions");
    assert.equal(permsCount041.rows[0].count, 13, "Should seed 13 registered capabilities");

    const reconciliations041 = await pool.query("SELECT student_id, legacy_peran, status FROM rbac_legacy_reconciliations ORDER BY student_id");
    assert.equal(reconciliations041.rowCount, 2, "Should record exactly 2 ambiguous roles");
    assert.equal(reconciliations041.rows[0].status, "PENDING_RECONCILIATION");
    assert.equal(reconciliations041.rows[1].status, "PENDING_RECONCILIATION");

    const backfilledAssignments041 = await pool.query("SELECT student_id, role_id FROM student_role_assignments ORDER BY student_id");
    assert.equal(backfilledAssignments041.rowCount, 2, "Only non-ambiguous roles should be backfilled in 041");
    assert.equal(backfilledAssignments041.rows[0].student_id, "STD-VAL-1");
    assert.equal(backfilledAssignments041.rows[0].role_id, "ROL-KETUA-RISET");
    assert.equal(backfilledAssignments041.rows[1].student_id, "STD-VAL-2");
    assert.equal(backfilledAssignments041.rows[1].role_id, "ROL-CONTRIBUTOR");

    // 4. Simulate Pre-042 State: Flawed auto-backfill on ambiguous role + Valid manual assignment in same project
    await pool.query(`
      -- Flawed auto-backfill for STD-AMB-1 (as existed before 042)
      INSERT INTO student_role_assignments (id, student_id, role_id, scope_type, scope_id, assigned_by, is_active)
      VALUES ('SRA-BKF-STD-AMB-1-PRJ-TEST-1', 'STD-AMB-1', 'ROL-CONTRIBUTOR', 'PROJECT', 'PRJ-TEST-1', NULL, TRUE);

      -- Legitimate manual assignment for STD-AMB-1 by Operator
      INSERT INTO student_role_assignments (id, student_id, role_id, scope_type, scope_id, assigned_by, is_active)
      VALUES ('SRA-MANUAL-OP-999', 'STD-AMB-1', 'ROL-CORE-RESEARCHER', 'PROJECT', 'PRJ-TEST-1', 'USR-OP-TEST', TRUE);
    `);

    // Row counts BEFORE Migration 042
    const beforeCount = await pool.query(`
      SELECT
        COUNT(*)::int AS total_assignments,
        COUNT(CASE WHEN id LIKE 'SRA-BKF-%' THEN 1 END)::int AS backfill_assignments,
        COUNT(CASE WHEN id NOT LIKE 'SRA-BKF-%' THEN 1 END)::int AS manual_assignments
      FROM student_role_assignments
    `);

    assert.equal(beforeCount.rows[0].total_assignments, 4, "Total before 042 should be 4");
    assert.equal(beforeCount.rows[0].backfill_assignments, 3, "Backfills before 042 should be 3");
    assert.equal(beforeCount.rows[0].manual_assignments, 1, "Manual before 042 should be 1");

    // 5. Apply Migration 042
    const migration042Sql = fs.readFileSync(path.join(__dirname, "..", "db", "migrations", "042_reconcile_ambiguous_legacy_roles.sql"), "utf8");
    await pool.query(migration042Sql);

    // Row counts AFTER Migration 042
    const afterCount = await pool.query(`
      SELECT
        COUNT(*)::int AS total_assignments,
        COUNT(CASE WHEN id LIKE 'SRA-BKF-%' THEN 1 END)::int AS backfill_assignments,
        COUNT(CASE WHEN id NOT LIKE 'SRA-BKF-%' THEN 1 END)::int AS manual_assignments
      FROM student_role_assignments
    `);

    assert.equal(afterCount.rows[0].total_assignments, 3, "Total after 042 should be exactly 3 (1 ambiguous backfill deleted)");
    assert.equal(afterCount.rows[0].backfill_assignments, 2, "Only legitimate backfills remain");
    assert.equal(afterCount.rows[0].manual_assignments, 1, "Manual assignment MUST be preserved");

    // Verify manual assignment is preserved with exact role
    const preservedManual = await pool.query("SELECT * FROM student_role_assignments WHERE id = 'SRA-MANUAL-OP-999'");
    assert.equal(preservedManual.rowCount, 1);
    assert.equal(preservedManual.rows[0].role_id, "ROL-CORE-RESEARCHER");

    // Verify capability metadata updated in rbac_permissions
    const memberManagePerm = await pool.query("SELECT enforcement_status, is_delegable FROM rbac_permissions WHERE code = 'research.member.manage'");
    assert.equal(memberManagePerm.rows[0].enforcement_status, "NOT_ENFORCED");
    assert.equal(memberManagePerm.rows[0].is_delegable, false);

    const picketPerm = await pool.query("SELECT enforcement_status, is_delegable FROM rbac_permissions WHERE code = 'lab.picket.manage'");
    assert.equal(picketPerm.rows[0].enforcement_status, "PARTIAL");
    assert.equal(picketPerm.rows[0].is_delegable, true);

    const taskCreatePerm = await pool.query("SELECT enforcement_status, is_delegable FROM rbac_permissions WHERE code = 'scrum.task.create'");
    assert.equal(taskCreatePerm.rows[0].enforcement_status, "ENFORCED");
    assert.equal(taskCreatePerm.rows[0].is_delegable, true);

    // 6. Repeated Bootstrap Idempotency Check
    await ensureRbacTables(pool);
    const postBootstrapCount = await pool.query("SELECT COUNT(*)::int AS count FROM student_role_assignments");
    assert.equal(postBootstrapCount.rows[0].count, 3, "Repeated bootstrap must not alter role assignments count");

    // Check effective permissions for STD-AMB-2 (ambiguous role, zero permissions)
    const effectiveAmb2 = await resolveStudentEffectivePermissions("STD-AMB-2", { projectId: "PRJ-TEST-1" }, pool);
    assert.deepEqual(effectiveAmb2.permissions, [], "Ambiguous role without manual assignment must have 0 permissions");

    // Check effective permissions for STD-AMB-1 (has manual CORE_RESEARCHER assignment only)
    const effectiveAmb1 = await resolveStudentEffectivePermissions("STD-AMB-1", { projectId: "PRJ-TEST-1" }, pool);
    assert.ok(effectiveAmb1.permissions.includes("scrum.task.create"));
    assert.ok(!effectiveAmb1.permissions.includes("scrum.sprint.manage"), "Must not inherit elevated sprint management from ambiguous Wakil Ketua");
  } finally {
    if (pool) await pool.end();
  }
});

test("PostgreSQL Isolated Integration: RBAC Reconciliation API Contract & Invariants", async (t) => {
  let pool;
  try {
    assertStagingEquivalentTarget(testDbUrl);
    pool = new Pool({ connectionString: testDbUrl });
    await pool.query("SELECT 1");
  } catch (err) {
    t.skip(`Isolated PostgreSQL test database unavailable (${err.message}). Marking integration test as BLOCKED.`);
    return;
  }

  try {
    // 1. Reset Schema and Seed Database
    await pool.query("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
    const schemaSql = fs.readFileSync(path.join(__dirname, "..", "db", "schema.sql"), "utf8");
    await pool.query(schemaSql);

    // Baseline Users, Students, Project, and Memberships
    await pool.query(`
      INSERT INTO users (id, name, initials, email, role, is_active)
      VALUES
        ('USR-OP-TEST', 'Operator Test', 'OT', 'operator@test.local', 'operator', true),
        ('USR-STD-AMB-1', 'Student Wakil', 'SW', 'amb1@test.local', 'mahasiswa', true),
        ('USR-STD-AMB-2', 'Student Asisten', 'SA', 'amb2@test.local', 'mahasiswa', true),
        ('USR-STD-AMB-3', 'Student CoLead', 'SC', 'amb3@test.local', 'mahasiswa', true)
      ON CONFLICT DO NOTHING;

      INSERT INTO students (id, user_id, nim, status, tipe)
      VALUES
        ('STD-AMB-1', 'USR-STD-AMB-1', '10001', 'Aktif', 'Riset'),
        ('STD-AMB-2', 'USR-STD-AMB-2', '10002', 'Aktif', 'Riset'),
        ('STD-AMB-3', 'USR-STD-AMB-3', '10003', 'Aktif', 'Riset')
      ON CONFLICT DO NOTHING;

      INSERT INTO research_projects (id, title, status)
      VALUES ('PRJ-TEST-1', 'Riset AI Testing', 'Aktif')
      ON CONFLICT DO NOTHING;

      INSERT INTO research_memberships (project_id, user_id, member_type, peran, status)
      VALUES
        ('PRJ-TEST-1', 'USR-STD-AMB-1', 'Mahasiswa', 'Wakil Ketua Riset', 'Aktif'),
        ('PRJ-TEST-1', 'USR-STD-AMB-2', 'Mahasiswa', 'Asisten PM', 'Aktif'),
        ('PRJ-TEST-1', 'USR-STD-AMB-3', 'Mahasiswa', 'Co-Leader Riset', 'Aktif')
      ON CONFLICT DO NOTHING;
    `);

    // Run Migration 041 & 042
    const migration041Sql = fs.readFileSync(path.join(__dirname, "..", "db", "migrations", "041_dynamic_student_rbac.sql"), "utf8");
    await pool.query(migration041Sql);
    const migration042Sql = fs.readFileSync(path.join(__dirname, "..", "db", "migrations", "042_reconcile_ambiguous_legacy_roles.sql"), "utf8");
    await pool.query(migration042Sql);

    // Pre-existing manual role assignment for STD-AMB-1 in PRJ-TEST-1
    await pool.query(`
      INSERT INTO student_role_assignments (id, student_id, role_id, scope_type, scope_id, assigned_by, is_active)
      VALUES ('SRA-MANUAL-EXISTING', 'STD-AMB-1', 'ROL-CORE-RESEARCHER', 'PROJECT', 'PRJ-TEST-1', 'USR-OP-TEST', TRUE)
    `);

    const operatorActor = { actorId: "USR-OP-TEST", actorRole: "OPERATOR", ip: "127.0.0.1" };
    const studentActor = { actorId: "USR-STD-AMB-1", actorRole: "MAHASISWA", ip: "127.0.0.1" };

    // Initial pending list check
    const initialPending = await listLegacyReconciliations({ status: "PENDING_RECONCILIATION" }, pool);
    assert.equal(initialPending.length, 3, "Initially 3 ambiguous roles must be queued for reconciliation");

    const recItem1 = initialPending.find((r) => r.studentId === "STD-AMB-1");
    const recItem2 = initialPending.find((r) => r.studentId === "STD-AMB-2");
    const recItem3 = initialPending.find((r) => r.studentId === "STD-AMB-3");
    assert.ok(recItem1 && recItem2 && recItem3);

    // =========================================================================
    // 1. ASSIGN_ROLE berhasil
    // =========================================================================
    const assignPayload = {
      action: "ASSIGN_ROLE",
      roleId: "ROL-CONTRIBUTOR",
      notes: "Disetujui sebagai Contributor oleh Operator"
    };

    const assignResult = await reconcileLegacyRole(recItem2.id, assignPayload, operatorActor, pool);
    assert.equal(assignResult.reconciliation.status, "RECONCILED");
    assert.equal(assignResult.reconciliation.reconciledRoleId, "ROL-CONTRIBUTOR");
    assert.equal(assignResult.reconciliation.reconciledBy, "USR-OP-TEST");
    assert.ok(assignResult.reconciliation.reconciledAt);
    assert.equal(assignResult.reconciliation.notes, assignPayload.notes);
    assert.ok(assignResult.assignment);
    assert.equal(assignResult.assignment.studentId, "STD-AMB-2");
    assert.equal(assignResult.assignment.roleId, "ROL-CONTRIBUTOR");
    assert.equal(assignResult.assignment.scopeType, "PROJECT");
    assert.equal(assignResult.assignment.scopeId, "PRJ-TEST-1");

    // Verify DB persistence of ASSIGN
    const rec2Db = await pool.query("SELECT * FROM rbac_legacy_reconciliations WHERE id = $1", [recItem2.id]);
    assert.equal(rec2Db.rows[0].status, "RECONCILED");
    assert.equal(rec2Db.rows[0].reconciled_role_id, "ROL-CONTRIBUTOR");

    const sra2Db = await pool.query(
      "SELECT * FROM student_role_assignments WHERE student_id = 'STD-AMB-2' AND role_id = 'ROL-CONTRIBUTOR'"
    );
    assert.equal(sra2Db.rowCount, 1);
    assert.equal(sra2Db.rows[0].is_active, true);

    const auditAssign = await pool.query(
      "SELECT * FROM rbac_audit_logs WHERE target_id = $1 AND action = 'RECONCILE_LEGACY_ROLE'",
      [recItem2.id]
    );
    assert.equal(auditAssign.rowCount, 1);
    assert.equal(auditAssign.rows[0].detail.status, "RECONCILED");

    // =========================================================================
    // 2. IGNORE berhasil tanpa assignment
    // =========================================================================
    const ignorePayload = {
      action: "IGNORE",
      notes: "Tidak memerlukan akses khusus ke project ini"
    };

    const ignoreResult = await reconcileLegacyRole(recItem3.id, ignorePayload, operatorActor, pool);
    assert.equal(ignoreResult.reconciliation.status, "IGNORED");
    assert.equal(ignoreResult.reconciliation.reconciledRoleId, null);
    assert.equal(ignoreResult.reconciliation.reconciledBy, "USR-OP-TEST");
    assert.ok(ignoreResult.reconciliation.reconciledAt);
    assert.equal(ignoreResult.assignment, null);

    // Verify DB persistence of IGNORE (NO assignment created)
    const rec3Db = await pool.query("SELECT * FROM rbac_legacy_reconciliations WHERE id = $1", [recItem3.id]);
    assert.equal(rec3Db.rows[0].status, "IGNORED");
    assert.equal(rec3Db.rows[0].reconciled_role_id, null);

    const sra3Db = await pool.query("SELECT * FROM student_role_assignments WHERE student_id = 'STD-AMB-3'");
    assert.equal(sra3Db.rowCount, 0, "IGNORE action must NEVER create any role assignments");

    const auditIgnore = await pool.query(
      "SELECT * FROM rbac_audit_logs WHERE target_id = $1 AND action = 'RECONCILE_LEGACY_ROLE'",
      [recItem3.id]
    );
    assert.equal(auditIgnore.rowCount, 1);
    assert.equal(auditIgnore.rows[0].detail.status, "IGNORED");

    // =========================================================================
    // 3. List pending berkurang setelah rekonsiliasi (dengan filter status)
    // =========================================================================
    // Both 'PENDING' and 'PENDING_RECONCILIATION' should return identical remaining 1 item
    const listPendingShort = await listLegacyReconciliations({ status: "PENDING" }, pool);
    assert.equal(listPendingShort.length, 1);
    assert.equal(listPendingShort[0].studentId, "STD-AMB-1");

    const listPendingFull = await listLegacyReconciliations({ status: "PENDING_RECONCILIATION" }, pool);
    assert.equal(listPendingFull.length, 1);
    assert.equal(listPendingFull[0].studentId, "STD-AMB-1");

    // Test filter RECONCILED
    const listReconciled = await listLegacyReconciliations({ status: "RECONCILED" }, pool);
    assert.equal(listReconciled.length, 1);
    assert.equal(listReconciled[0].studentId, "STD-AMB-2");

    // Test filter IGNORED
    const listIgnored = await listLegacyReconciliations({ status: "IGNORED" }, pool);
    assert.equal(listIgnored.length, 1);
    assert.equal(listIgnored[0].studentId, "STD-AMB-3");

    // Test filter ALL
    const listAll = await listLegacyReconciliations({ status: "ALL" }, pool);
    assert.equal(listAll.length, 3);

    // =========================================================================
    // 4. Invalid request ditolak tanpa perubahan database
    // =========================================================================
    // a. Invalid action
    await assert.rejects(
      async () => reconcileLegacyRole(recItem1.id, { action: "INVALID_ACTION" }, operatorActor, pool),
      (err) => {
        assert.equal(err.statusCode, 400);
        return true;
      }
    );

    // b. Missing role in assign
    await assert.rejects(
      async () => reconcileLegacyRole(recItem1.id, { action: "ASSIGN_ROLE" }, operatorActor, pool),
      (err) => {
        assert.equal(err.statusCode, 400);
        return true;
      }
    );

    // c. Non-existent role
    await assert.rejects(
      async () => reconcileLegacyRole(recItem1.id, { action: "ASSIGN_ROLE", roleId: "ROL-DOES-NOT-EXIST" }, operatorActor, pool),
      (err) => {
        assert.equal(err.statusCode, 404);
        return true;
      }
    );

    // d. Unauthorized non-operator caller
    await assert.rejects(
      async () => reconcileLegacyRole(recItem1.id, { action: "IGNORE" }, studentActor, pool),
      (err) => {
        assert.equal(err.statusCode, 403);
        return true;
      }
    );

    // Verify recItem1 is STILL PENDING and completely unmodified
    const rec1DbAfterFails = await pool.query("SELECT * FROM rbac_legacy_reconciliations WHERE id = $1", [recItem1.id]);
    assert.equal(rec1DbAfterFails.rows[0].status, "PENDING_RECONCILIATION");
    assert.equal(rec1DbAfterFails.rows[0].reconciled_role_id, null);
    assert.equal(rec1DbAfterFails.rows[0].reconciled_by, null);

    // STD-AMB-1 assignments count is still exactly 1 (the initial manual assignment)
    const sra1DbAfterFails = await pool.query("SELECT COUNT(*)::int AS count FROM student_role_assignments WHERE student_id = 'STD-AMB-1'");
    assert.equal(sra1DbAfterFails.rows[0].count, 1);

    // =========================================================================
    // 5. Reconcile ganda ditolak dengan benar (409 Conflict)
    // =========================================================================
    // Already RECONCILED item
    await assert.rejects(
      async () => reconcileLegacyRole(recItem2.id, { action: "ASSIGN_ROLE", roleId: "ROL-CONTRIBUTOR" }, operatorActor, pool),
      (err) => {
        assert.equal(err.statusCode, 409);
        return true;
      }
    );

    await assert.rejects(
      async () => reconcileLegacyRole(recItem2.id, { action: "IGNORE" }, operatorActor, pool),
      (err) => {
        assert.equal(err.statusCode, 409);
        return true;
      }
    );

    // Already IGNORED item
    await assert.rejects(
      async () => reconcileLegacyRole(recItem3.id, { action: "ASSIGN_ROLE", roleId: "ROL-CONTRIBUTOR" }, operatorActor, pool),
      (err) => {
        assert.equal(err.statusCode, 409);
        return true;
      }
    );

    // =========================================================================
    // 6. Role assignment existing tidak ditimpa
    // =========================================================================
    // STD-AMB-1 had 'ROL-CORE-RESEARCHER' assigned manually ('SRA-MANUAL-EXISTING').
    // Now reconcile with 'ROL-CONTRIBUTOR'.
    const assignMultiResult = await reconcileLegacyRole(
      recItem1.id,
      { action: "ASSIGN_ROLE", roleCode: "CONTRIBUTOR", notes: "Multi-role contributor granted" },
      operatorActor,
      pool
    );

    assert.equal(assignMultiResult.reconciliation.status, "RECONCILED");

    // Check DB: Both roles must exist and remain active
    const sra1All = await pool.query(
      "SELECT id, role_id, is_active FROM student_role_assignments WHERE student_id = 'STD-AMB-1' ORDER BY id"
    );
    assert.equal(sra1All.rowCount, 2, "STD-AMB-1 must now have both active assignments");

    const manualExisting = sra1All.rows.find((r) => r.id === "SRA-MANUAL-EXISTING");
    assert.ok(manualExisting);
    assert.equal(manualExisting.role_id, "ROL-CORE-RESEARCHER");
    assert.equal(manualExisting.is_active, true);

    const reconciledNew = sra1All.rows.find((r) => r.role_id === "ROL-CONTRIBUTOR");
    assert.ok(reconciledNew);
    assert.equal(reconciledNew.is_active, true);

    // Effective permissions must be the union of both roles
    const effectiveStd1 = await resolveStudentEffectivePermissions("STD-AMB-1", { projectId: "PRJ-TEST-1" }, pool);
    assert.ok(effectiveStd1.activeRoles.some((r) => r.roleId === "ROL-CORE-RESEARCHER"));
    assert.ok(effectiveStd1.activeRoles.some((r) => r.roleId === "ROL-CONTRIBUTOR"));
    assert.ok(effectiveStd1.permissions.includes("scrum.task.create"));
    assert.ok(effectiveStd1.permissions.includes("research.project.read"));
  } finally {
    if (pool) await pool.end();
  }
});
