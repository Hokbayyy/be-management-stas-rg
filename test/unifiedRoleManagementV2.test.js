const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const dotenv = require("dotenv");
const { Pool } = require("pg");

const envFile = ".env.test.local";
const config = fs.existsSync(envFile) ? dotenv.parse(fs.readFileSync(envFile)) : {};
const dbUrl = config.DATABASE_URL || process.env.DATABASE_URL;

const {
  ensureRbacTables,
  createRole,
  updateRole,
  archiveRole,
  restoreRole,
  listRoles,
  getRoleById,
  getRoleByCode,
  discoverRoleSources,
  importRoleDefinition,
  getRoleRetirementImpact,
  replaceAndArchiveRole,
  assignStudentRole,
  listStudentRoleAssignments,
  resolveStudentEffectivePermissions,
  updateRolePermissions,
  listContextRoles,
  buildId
} = require("../utils/rbacService");

test("Unified Role Management V2 - 15 Test Scenarios", async (t) => {
  if (!dbUrl) {
    t.skip("Database URL not found in .env.test.local or process.env. Skipping integration suite.");
    return;
  }

  const pool = new Pool({ connectionString: dbUrl });

  t.before(async () => {
    // Ensure migrations up to 043 are applied
    const sql043 = fs.readFileSync("db/migrations/043_unified_role_management_v2.sql", "utf8");
    await pool.query(sql043).catch(() => {});
    await ensureRbacTables(pool);
  });

  t.after(async () => {
    await pool.end();
  });

  const actorContext = { actorId: "USR-OP-UAT", actorRole: "OPERATOR", ip: "127.0.0.1" };

  // Scenario 1: Create/edit role per kategori (SYSTEM, FUNCTIONAL, DIVISION)
  await t.test("1. Create/edit role per category (SYSTEM, FUNCTIONAL, DIVISION)", async () => {
    const timestamp = Date.now();

    // 1.1 Create FUNCTIONAL role
    const funcRole = await createRole(
      {
        code: `FUNC_TEST_${timestamp}`,
        name: `Functional Test Role ${timestamp}`,
        category: "FUNCTIONAL",
        description: "Test functional role"
      },
      actorContext,
      pool
    );
    assert.equal(funcRole.category, "FUNCTIONAL");
    assert.deepEqual(funcRole.allowedScopeTypes, ["LAB", "PROJECT", "DIVISION"]);

    // 1.2 Create DIVISION role
    const divRole = await createRole(
      {
        code: `DIV_TEST_${timestamp}`,
        name: `Division Test Role ${timestamp}`,
        category: "DIVISION",
        allowedScopeTypes: ["DIVISION"]
      },
      actorContext,
      pool
    );
    assert.equal(divRole.category, "DIVISION");
    assert.deepEqual(divRole.allowedScopeTypes, ["DIVISION"]);

    // 1.3 Attempt to create SYSTEM role directly should be rejected
    await assert.rejects(
      async () => {
        await createRole(
          {
            code: `SYS_TEST_${timestamp}`,
            name: `System Test Role ${timestamp}`,
            category: "SYSTEM"
          },
          actorContext,
          pool
        );
      },
      (err) => err.statusCode === 400 && err.message.includes("SYSTEM")
    );

    // 1.4 Edit functional role metadata and allowed scopes
    const updated = await updateRole(
      funcRole.id,
      {
        name: `Updated Functional Role ${timestamp}`,
        description: "Updated description",
        allowedScopeTypes: ["PROJECT", "DIVISION"]
      },
      actorContext,
      pool
    );
    assert.equal(updated.name, `Updated Functional Role ${timestamp}`);
    assert.deepEqual(updated.allowedScopeTypes, ["PROJECT", "DIVISION"]);
  });

  // Scenario 2: Role kind/scope validation
  await t.test("2. Role kind and scope validation", async () => {
    const timestamp = Date.now();

    // DIVISION role with scope outside DIVISION must be rejected
    await assert.rejects(
      async () => {
        await createRole(
          {
            code: `DIV_BAD_${timestamp}`,
            name: `Bad Division Role ${timestamp}`,
            category: "DIVISION",
            allowedScopeTypes: ["PROJECT"]
          },
          actorContext,
          pool
        );
      },
      (err) => err.statusCode === 400 && err.message.includes("DIVISION")
    );

    // Role with empty allowedScopeTypes rejected
    await assert.rejects(
      async () => {
        await createRole(
          {
            code: `EMPTY_SCOPE_${timestamp}`,
            name: `Empty Scope Role ${timestamp}`,
            allowedScopeTypes: []
          },
          actorContext,
          pool
        );
      },
      (err) => err.statusCode === 400
    );
  });

  // Scenario 3: Import descriptive role dengan zero permissions
  await t.test("3. Import descriptive role with zero initial permissions", async () => {
    const timestamp = Date.now();
    const imported = await importRoleDefinition(
      {
        sourcePeran: "Web Developer",
        code: `WEB_DEV_${timestamp}`,
        name: `Web Developer ${timestamp}`,
        category: "FUNCTIONAL"
      },
      actorContext,
      pool
    );

    assert.equal(imported.code, `WEB_DEV_${timestamp}`);
    assert.equal(imported.category, "FUNCTIONAL");
    assert.equal(imported.isSystem, false);
    assert.equal(imported.isActive, true);

    // Verify 0 permissions in database
    const permsRes = await pool.query("SELECT COUNT(*)::int AS count FROM rbac_role_permissions WHERE role_id = $1", [imported.id]);
    assert.equal(permsRes.rows[0].count, 0, "Imported role must have 0 initial permissions");

    // Verify 0 student assignments
    const assignRes = await pool.query("SELECT COUNT(*)::int AS count FROM student_role_assignments WHERE role_id = $1", [imported.id]);
    assert.equal(assignRes.rows[0].count, 0, "Imported role must not automatically assign any students");
  });

  // Scenario 4: Rename role tanpa merusak assignment
  await t.test("4. Rename role without breaking assignments", async () => {
    const timestamp = Date.now();
    const role = await createRole(
      {
        code: `RENAME_TEST_${timestamp}`,
        name: `Original Name ${timestamp}`,
        category: "FUNCTIONAL",
        allowedScopeTypes: ["PROJECT"]
      },
      actorContext,
      pool
    );

    // Assign to student STD-UAT-2 on PRJ-UAT-RBAC-1
    const assign = await assignStudentRole(
      "STD-UAT-2",
      {
        roleId: role.id,
        scopeType: "PROJECT",
        scopeId: "PRJ-UAT-RBAC-1"
      },
      actorContext,
      pool
    );

    // Rename role
    const updated = await updateRole(
      role.id,
      {
        name: `New Display Name ${timestamp}`
      },
      actorContext,
      pool
    );

    assert.equal(updated.name, `New Display Name ${timestamp}`);
    assert.equal(updated.code, role.code);

    // Verify assignment still exists and references role ID
    const studentAssigns = await listStudentRoleAssignments("STD-UAT-2", {}, pool);
    const found = studentAssigns.find((a) => a.id === assign.id);
    assert.ok(found, "Assignment must remain intact after role rename");
    assert.equal(found.roleName, `New Display Name ${timestamp}`);

    // Clean up assignment
    await pool.query("DELETE FROM student_role_assignments WHERE id = $1", [assign.id]);
  });

  // Scenario 5: Archive unused role
  await t.test("5. Archive and restore unused role", async () => {
    const timestamp = Date.now();
    const role = await createRole(
      {
        code: `ARCHIVE_TEST_${timestamp}`,
        name: `Role to Archive ${timestamp}`,
        category: "FUNCTIONAL"
      },
      actorContext,
      pool
    );

    const archived = await archiveRole(role.id, actorContext, pool);
    assert.equal(archived.isActive, false);
    assert.ok(archived.archivedAt != null);

    // Attempting to assign archived role should be rejected
    await assert.rejects(
      async () => {
        await assignStudentRole(
          "STD-UAT-2",
          {
            roleId: role.id,
            scopeType: "PROJECT",
            scopeId: "PRJ-UAT-RBAC-1"
          },
          actorContext,
          pool
        );
      },
      (err) => err.statusCode === 400 && err.message.includes("diarsipkan")
    );

    // Restore role
    const restored = await restoreRole(role.id, actorContext, pool);
    assert.equal(restored.isActive, true);
    assert.equal(restored.archivedAt, null);
  });

  // Scenario 6: Replace active role A ke role B
  await t.test("6. Replace active role A to role B with full assignment migration", async () => {
    const timestamp = Date.now();

    const roleA = await createRole(
      {
        code: `ROLE_A_${timestamp}`,
        name: `Source Role A ${timestamp}`,
        category: "FUNCTIONAL",
        allowedScopeTypes: ["PROJECT"]
      },
      actorContext,
      pool
    );

    const roleB = await createRole(
      {
        code: `ROLE_B_${timestamp}`,
        name: `Target Role B ${timestamp}`,
        category: "FUNCTIONAL",
        allowedScopeTypes: ["PROJECT"]
      },
      actorContext,
      pool
    );

    // Assign Role A to Student 2
    const assignA = await assignStudentRole(
      "STD-UAT-2",
      {
        roleId: roleA.id,
        scopeType: "PROJECT",
        scopeId: "PRJ-UAT-RBAC-1"
      },
      actorContext,
      pool
    );

    // Execute replace and archive
    const res = await replaceAndArchiveRole(
      roleA.id,
      {
        replacementRoleId: roleB.id,
        sourceVersion: roleA.version,
        reason: "Testing complete role retirement workflow",
        migrateMembershipLabels: false
      },
      actorContext,
      pool
    );

    assert.equal(res.migratedAssignmentsCount, 1);
    assert.equal(res.duplicateAssignmentsSkipped, 0);

    // Verify Role A is archived
    const checkA = await getRoleById(roleA.id, pool);
    assert.equal(checkA.isActive, false);

    // Verify assignA is revoked
    const checkAssignA = await pool.query("SELECT is_active, revoked_at, revocation_reason FROM student_role_assignments WHERE id = $1", [assignA.id]);
    assert.equal(checkAssignA.rows[0].is_active, false);
    assert.ok(checkAssignA.rows[0].revoked_at != null);
    assert.ok(checkAssignA.rows[0].revocation_reason.includes(roleB.name));

    // Verify Student 2 has active assignment for Role B
    const checkAssignB = await pool.query(
      "SELECT id, role_id, scope_type, scope_id FROM student_role_assignments WHERE student_id = 'STD-UAT-2' AND role_id = $1 AND is_active = TRUE",
      [roleB.id]
    );
    assert.equal(checkAssignB.rowCount, 1);
    assert.equal(checkAssignB.rows[0].scope_id, "PRJ-UAT-RBAC-1");

    // Clean up
    await pool.query("DELETE FROM student_role_assignments WHERE role_id IN ($1, $2)", [roleA.id, roleB.id]);
  });

  // Scenario 7: Duplicate assignment ditangani tanpa kehilangan histori
  await t.test("7. Duplicate assignment handled gracefully during role replacement", async () => {
    const timestamp = Date.now();

    const roleA = await createRole(
      {
        code: `ROLE_DUP_A_${timestamp}`,
        name: `Source Dup A ${timestamp}`,
        category: "FUNCTIONAL",
        allowedScopeTypes: ["PROJECT"]
      },
      actorContext,
      pool
    );

    const roleB = await createRole(
      {
        code: `ROLE_DUP_B_${timestamp}`,
        name: `Target Dup B ${timestamp}`,
        category: "FUNCTIONAL",
        allowedScopeTypes: ["PROJECT"]
      },
      actorContext,
      pool
    );

    // Assign BOTH Role A and Role B to Student 2 on same project
    const assignA = await assignStudentRole(
      "STD-UAT-2",
      { roleId: roleA.id, scopeType: "PROJECT", scopeId: "PRJ-UAT-RBAC-1" },
      actorContext,
      pool
    );
    const assignB = await assignStudentRole(
      "STD-UAT-2",
      { roleId: roleB.id, scopeType: "PROJECT", scopeId: "PRJ-UAT-RBAC-1" },
      actorContext,
      pool
    );

    // Replace Role A to Role B
    const res = await replaceAndArchiveRole(
      roleA.id,
      {
        replacementRoleId: roleB.id,
        sourceVersion: roleA.version,
        reason: "Duplicate assignment test"
      },
      actorContext,
      pool
    );

    // SRA-A was revoked, duplicate SRA-B skipped
    assert.equal(res.duplicateAssignmentsSkipped, 1);
    assert.equal(res.migratedAssignmentsCount, 0);

    // Verify assignA is revoked
    const checkA = await pool.query("SELECT is_active, revoked_at FROM student_role_assignments WHERE id = $1", [assignA.id]);
    assert.equal(checkA.rows[0].is_active, false);

    // Verify exactly 1 active assignment for Role B exists
    const activeB = await pool.query(
      "SELECT id FROM student_role_assignments WHERE student_id = 'STD-UAT-2' AND role_id = $1 AND is_active = TRUE",
      [roleB.id]
    );
    assert.equal(activeB.rowCount, 1);
    assert.equal(activeB.rows[0].id, assignB.id);

    // Clean up
    await pool.query("DELETE FROM student_role_assignments WHERE role_id IN ($1, $2)", [roleA.id, roleB.id]);
  });

  // Scenario 8: Permission gain/loss preview
  // Scenario 8: Permission gain/loss preview & privilege escalation confirmation guard
  await t.test("8. Permission gain and loss preview calculation", async () => {
    const timestamp = Date.now();

    const roleA = await createRole({ code: `PREV_A_${timestamp}`, name: `Prev A ${timestamp}`, category: "FUNCTIONAL" }, actorContext, pool);
    const roleB = await createRole({ code: `PREV_B_${timestamp}`, name: `Prev B ${timestamp}`, category: "FUNCTIONAL" }, actorContext, pool);

    // Configure permissions
    const updatedA = await updateRolePermissions(roleA.id, ["scrum.task.create", "scrum.task.edit_own"], {}, actorContext, pool);
    await updateRolePermissions(roleB.id, ["scrum.task.create", "scrum.task.manage", "scrum.sprint.view"], {}, actorContext, pool);

    const impact = await getRoleRetirementImpact(roleA.id, roleB.id, pool);
    assert.deepEqual(impact.permissionDiff.gainedPermissions.sort(), ["scrum.sprint.view", "scrum.task.manage"].sort());
    assert.deepEqual(impact.permissionDiff.lostPermissions, ["scrum.task.edit_own"]);
    assert.equal(impact.permissionDiff.requiresGainConfirmation, true);

    // Attempting replaceAndArchiveRole without confirmPermissionGains must be rejected with 400
    await assert.rejects(
      async () => {
        await replaceAndArchiveRole(
          roleA.id,
          {
            replacementRoleId: roleB.id,
            sourceVersion: updatedA.version,
            reason: "Attempt unconfirmed privilege escalation"
          },
          actorContext,
          pool
        );
      },
      (err) => err.statusCode === 400 && err.message.includes("confirmPermissionGains: true")
    );

    // With explicit confirmPermissionGains: true, replaceAndArchive succeeds
    const result = await replaceAndArchiveRole(
      roleA.id,
      {
        replacementRoleId: roleB.id,
        sourceVersion: updatedA.version,
        reason: "Confirmed privilege escalation",
        confirmPermissionGains: true
      },
      actorContext,
      pool
    );
    assert.ok(result.sourceRoleId === roleA.id);
    assert.deepEqual(result.gainedPermissions.sort(), ["scrum.sprint.view", "scrum.task.manage"].sort());

    // Verify audit log recorded confirmPermissionGains and gainedPermissions
    const auditRes = await pool.query(
      "SELECT detail FROM rbac_audit_logs WHERE target_id = $1 AND action = 'ROLE_REPLACE_AND_ARCHIVE' ORDER BY created_at DESC LIMIT 1",
      [roleA.id]
    );
    assert.equal(auditRes.rows[0].detail.confirmPermissionGains, true);
    assert.deepEqual(auditRes.rows[0].detail.gainedPermissions.sort(), ["scrum.sprint.view", "scrum.task.manage"].sort());
  });

  // Scenario 9: Protected system role cannot be deleted/archived/replaced
  await t.test("9. Protected canonical system roles cannot be archived or replaced", async () => {
    const sysRole = await getRoleByCode("KETUA_RISET", pool);
    assert.ok(sysRole);
    assert.equal(sysRole.isSystem, true);
    assert.equal(sysRole.isProtected, true);

    // Attempt archive
    await assert.rejects(
      async () => {
        await archiveRole(sysRole.id, actorContext, pool);
      },
      (err) => err.statusCode === 403 && err.message.includes("dilindungi")
    );

    // Attempt replace and archive
    await assert.rejects(
      async () => {
        await replaceAndArchiveRole(
          sysRole.id,
          {
            replacementRoleId: "ROL-CONTRIBUTOR",
            sourceVersion: sysRole.version,
            reason: "Should fail"
          },
          actorContext,
          pool
        );
      },
      (err) => err.statusCode === 403 && err.message.includes("dilindungi")
    );

    // Impact preview shows blocking issues
    const impact = await getRoleRetirementImpact(sysRole.id, "ROL-CONTRIBUTOR", pool);
    assert.equal(impact.canProceed, false);
    assert.ok(impact.blockingIssues.some((issue) => issue.includes("dilindungi")));
  });

  // Scenario 10: Cross-project/division isolation
  await t.test("10. Cross-project isolation maintained during replacement", async () => {
    const timestamp = Date.now();

    const roleA = await createRole({ code: `ISOL_A_${timestamp}`, name: `Isol A ${timestamp}`, category: "FUNCTIONAL", allowedScopeTypes: ["PROJECT"] }, actorContext, pool);
    const roleB = await createRole({ code: `ISOL_B_${timestamp}`, name: `Isol B ${timestamp}`, category: "FUNCTIONAL", allowedScopeTypes: ["PROJECT"] }, actorContext, pool);

    await updateRolePermissions(roleB.id, ["scrum.task.create"], {}, actorContext, pool);

    // Assign Role A to Student 2 on PRJ-UAT-RBAC-1
    await assignStudentRole("STD-UAT-2", { roleId: roleA.id, scopeType: "PROJECT", scopeId: "PRJ-UAT-RBAC-1" }, actorContext, pool);

    // Replace A with B
    await replaceAndArchiveRole(roleA.id, { replacementRoleId: roleB.id, sourceVersion: roleA.version, reason: "Isolation test", confirmPermissionGains: true }, actorContext, pool);

    // Check effective permissions on Project 1
    const p1Perms = await resolveStudentEffectivePermissions("STD-UAT-2", { projectId: "PRJ-UAT-RBAC-1" }, pool);
    assert.ok(p1Perms.permissions.includes("scrum.task.create"));

    // Check effective permissions on Project 2 (must be empty for this role)
    const p2Perms = await resolveStudentEffectivePermissions("STD-UAT-2", { projectId: "PRJ-UAT-RBAC-2" }, pool);
    assert.equal(p2Perms.permissions.includes("scrum.task.create"), false);

    // Clean up
    await pool.query("DELETE FROM student_role_assignments WHERE role_id IN ($1, $2)", [roleA.id, roleB.id]);
  });

  // Scenario 11: Failed transaction full rollback
  await t.test("11. Failed transaction rolls back all changes", async () => {
    const timestamp = Date.now();

    const roleA = await createRole({ code: `TX_A_${timestamp}`, name: `Tx A ${timestamp}`, category: "FUNCTIONAL" }, actorContext, pool);
    const roleB = await createRole({ code: `TX_B_${timestamp}`, name: `Tx B ${timestamp}`, category: "FUNCTIONAL" }, actorContext, pool);

    await assignStudentRole("STD-UAT-2", { roleId: roleA.id, scopeType: "PROJECT", scopeId: "PRJ-UAT-RBAC-1" }, actorContext, pool);

    // Attempt replace with invalid payload that fails after transaction starts (e.g. wrong version)
    await assert.rejects(
      async () => {
        await replaceAndArchiveRole(
          roleA.id,
          {
            replacementRoleId: roleB.id,
            sourceVersion: 99999, // mismatch version
            reason: "Should trigger rollback"
          },
          actorContext,
          pool
        );
      },
      (err) => err.statusCode === 409
    );

    // Role A must still be active and not archived
    const checkA = await getRoleById(roleA.id, pool);
    assert.equal(checkA.isActive, true);

    // Student assignment for Role A must still be active
    const checkAssign = await pool.query("SELECT is_active FROM student_role_assignments WHERE role_id = $1", [roleA.id]);
    assert.equal(checkAssign.rows[0].is_active, true);

    // Clean up
    await pool.query("DELETE FROM student_role_assignments WHERE role_id IN ($1, $2)", [roleA.id, roleB.id]);
  });

  // Scenario 12: Concurrent mutation 409
  await t.test("12. Concurrent mutation returns 409 Conflict", async () => {
    const timestamp = Date.now();

    const roleA = await createRole({ code: `CONC_A_${timestamp}`, name: `Conc A ${timestamp}`, category: "FUNCTIONAL" }, actorContext, pool);
    const roleB = await createRole({ code: `CONC_B_${timestamp}`, name: `Conc B ${timestamp}`, category: "FUNCTIONAL" }, actorContext, pool);

    // 12.1 Stale source version test
    await assert.rejects(
      async () => {
        await replaceAndArchiveRole(
          roleA.id,
          {
            replacementRoleId: roleB.id,
            sourceVersion: roleA.version - 1,
            expectedReplacementVersion: roleB.version,
            reason: "Stale version test"
          },
          actorContext,
          pool
        );
      },
      (err) => err.statusCode === 409 && err.message.includes("Konflik konkurensi")
    );

    // 12.2 Stale replacement role version test (targetVersion changed since preview)
    await assert.rejects(
      async () => {
        await replaceAndArchiveRole(
          roleA.id,
          {
            replacementRoleId: roleB.id,
            sourceVersion: roleA.version,
            expectedReplacementVersion: roleB.version + 99,
            reason: "Stale replacement version test"
          },
          actorContext,
          pool
        );
      },
      (err) => err.statusCode === 409 && err.message.includes("Konflik konkurensi role pengganti")
    );

    // 12.3 Changed active assignment count since preview (impact changed)
    await assert.rejects(
      async () => {
        await replaceAndArchiveRole(
          roleA.id,
          {
            replacementRoleId: roleB.id,
            sourceVersion: roleA.version,
            expectedReplacementVersion: roleB.version,
            expectedActiveAssignmentsCount: 999,
            reason: "Changed assignment count test"
          },
          actorContext,
          pool
        );
      },
      (err) => err.statusCode === 409 && err.message.includes("Konflik penugasan aktif")
    );

    // 12.4 Swapped assignment identity with identical count
    await assert.rejects(
      async () => {
        await replaceAndArchiveRole(
          roleA.id,
          {
            replacementRoleId: roleB.id,
            sourceVersion: roleA.version,
            expectedReplacementVersion: roleB.version,
            expectedAssignmentIds: ["SRA-GHOST-ID-1"],
            reason: "Swapped identity test"
          },
          actorContext,
          pool
        );
      },
      (err) => err.statusCode === 409 && err.message.includes("identitas penugasan mahasiswa telah berubah")
    );
  });

  // Scenario 13: Legacy labels dan Evaluation KSA tidak rusak
  await t.test("13. Membership labels migration option preserves membership history & KSA evaluation", async () => {
    const timestamp = Date.now();

    const roleA = await createRole({ code: `LBL_A_${timestamp}`, name: `Label A ${timestamp}`, category: "FUNCTIONAL" }, actorContext, pool);
    const roleB = await createRole({ code: `LBL_B_${timestamp}`, name: `Label B ${timestamp}`, category: "FUNCTIONAL" }, actorContext, pool);

    // Insert synthetic membership with Role A name
    await pool.query(`
      INSERT INTO research_memberships (project_id, user_id, member_type, peran, status, bergabung)
      VALUES ('PRJ-UAT-RBAC-1', 'USR-STD-UAT-1', 'Mahasiswa', $1, 'Aktif', '2026-01-01')
      ON CONFLICT (project_id, user_id) DO UPDATE SET peran = EXCLUDED.peran
    `, [`Label A ${timestamp}`]);

    // 13.1 Replace WITHOUT migrateMembershipLabels
    await replaceAndArchiveRole(
      roleA.id,
      {
        replacementRoleId: roleB.id,
        sourceVersion: roleA.version,
        reason: "Without label migration",
        migrateMembershipLabels: false
      },
      actorContext,
      pool
    );

    // Label should remain unchanged
    const checkMem1 = await pool.query("SELECT peran, status, bergabung FROM research_memberships WHERE project_id = 'PRJ-UAT-RBAC-1' AND user_id = 'USR-STD-UAT-1'");
    assert.equal(checkMem1.rows[0].peran, `Label A ${timestamp}`);
    assert.equal(checkMem1.rows[0].status, "Aktif");

    // 13.2 Create another role C and replace B with C WITH migrateMembershipLabels: true
    const roleC = await createRole({ code: `LBL_C_${timestamp}`, name: `Label C ${timestamp}`, category: "FUNCTIONAL" }, actorContext, pool);

    // Set peran to roleB.name
    await pool.query("UPDATE research_memberships SET peran = $1 WHERE project_id = 'PRJ-UAT-RBAC-1' AND user_id = 'USR-STD-UAT-1'", [roleB.name]);

    await replaceAndArchiveRole(
      roleB.id,
      {
        replacementRoleId: roleC.id,
        sourceVersion: roleB.version,
        reason: "With label migration",
        migrateMembershipLabels: true
      },
      actorContext,
      pool
    );

    // Label updated to roleC.name, but joined date and status preserved
    const checkMem2 = await pool.query("SELECT peran, status, bergabung FROM research_memberships WHERE project_id = 'PRJ-UAT-RBAC-1' AND user_id = 'USR-STD-UAT-1'");
    assert.equal(checkMem2.rows[0].peran, roleC.name);
    assert.equal(checkMem2.rows[0].status, "Aktif");
  });

  // Scenario 14: Canonical seed tidak mereset perubahan role (custom metadata / permissions)
  await t.test("14. Canonical seed does not overwrite custom metadata or restore revoked permissions", async () => {
    const role = await getRoleByCode("CONTRIBUTOR", pool);
    assert.ok(role);

    // Admin updates role name and description
    await updateRole(
      role.id,
      {
        name: "Contributor (Custom Admin Name)",
        description: "Custom description by admin"
      },
      actorContext,
      pool
    );

    // Admin revokes 'scrum.task.edit_own' permission from CONTRIBUTOR
    await updateRolePermissions(role.id, ["research.project.read", "scrum.sprint.view"], {}, actorContext, pool);

    // Re-run ensureRbacTables (simulating server restart or auto-migrate)
    await ensureRbacTables(pool);

    // Verify custom name & description are NOT overwritten
    const checkRole = await getRoleById(role.id, pool);
    assert.equal(checkRole.name, "Contributor (Custom Admin Name)");
    assert.equal(checkRole.description, "Custom description by admin");

    // Verify revoked permission was NOT resurrected
    const perms = await pool.query(
      `SELECT p.code FROM rbac_role_permissions rp JOIN rbac_permissions p ON p.id = rp.permission_id WHERE rp.role_id = $1`,
      [role.id]
    );
    const codes = perms.rows.map((r) => r.code);
    assert.equal(codes.includes("scrum.task.edit_own"), false, "Revoked permission must not be re-inserted on bootstrap");

    // Restore original name & permissions for standard test suite consistency
    await updateRole(role.id, { name: "Contributor / Member", description: "Anggota riset yang berfokus pada pengerjaan tugas dan kolaborasi." }, actorContext, pool);
    await updateRolePermissions(role.id, ["research.project.read", "scrum.sprint.view", "scrum.task.create", "scrum.task.edit_own"], {}, actorContext, pool);
  });

  // Scenario 15: PostgreSQL 12 compatibility
  await t.test("15. PostgreSQL 12 query compatibility and discovery sources", async () => {
    // Run discoverRoleSources to verify discovery query executes cleanly on PostgreSQL engine
    const discovery = await discoverRoleSources(pool);
    assert.ok(Array.isArray(discovery.sources));

    // Verify listContextRoles with category and scopeType filters
    const contextRoles = await listContextRoles({ scopeType: "PROJECT", category: "SYSTEM" }, pool);
    assert.ok(contextRoles.length >= 4);
    for (const r of contextRoles) {
      assert.equal(r.category, "SYSTEM");
      assert.ok(r.allowedScopeTypes.includes("PROJECT"));
    }
  });
});
