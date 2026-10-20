const express = require("express");
const asyncHandler = require("../../utils/asyncHandler");
const { requireRoleStrict, extractRole } = require("../../utils/roleGuard");
const { requireSafeId } = require("../../utils/securityValidation");
const { resolveStudentRecord } = require("../../utils/studentResolver");
const {
  listPermissions,
  listRoles,
  getRoleById,
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
  listRbacAuditLogs,
  listLegacyReconciliations,
  reconcileLegacyRole,
  listContextRoles
} = require("../../utils/rbacService");

const router = express.Router();
const requireOperator = requireRoleStrict(["operator", "admin"]);

function getActorContext(req) {
  return {
    actorId: req.authUser?.id || null,
    actorRole: extractRole(req) || "ANONYMOUS",
    ip: req.ip || null
  };
}

// =============================================================================
// CURRENT USER RBAC (/rbac/me)
// =============================================================================

router.get(
  "/me",
  asyncHandler(async (req, res) => {
    const userId = req.authUser?.id;
    if (!userId) {
      return res.status(401).json({ message: "Sesi tidak valid atau belum login." });
    }

    const { projectId, divisionId } = req.query;
    const effective = await resolveUserEffectivePermissions(userId, {
      projectId: projectId ? String(projectId).trim() : null,
      divisionId: divisionId ? String(divisionId).trim() : null
    });

    res.json({
      userId: effective.userId,
      studentId: effective.studentId,
      accountRole: effective.accountRole,
      permissions: effective.permissions,
      scopedPermissions: effective.scopedPermissions,
      activeRoles: effective.activeRoles
    });
  })
);

// =============================================================================
// PERMISSION CATALOG (/rbac/permissions)
// =============================================================================

router.get(
  "/permissions",
  asyncHandler(async (req, res) => {
    const permissions = await listPermissions();
    res.json(permissions);
  })
);

// =============================================================================
// AUDIT LOGS (/rbac/audit)
// =============================================================================

router.get(
  "/audit",
  requireOperator,
  asyncHandler(async (req, res) => {
    const { limit, offset, action, targetType } = req.query;
    const logs = await listRbacAuditLogs({ limit, offset, action, targetType });
    res.json(logs);
  })
);

// =============================================================================
// LEGACY ROLE RECONCILIATIONS (/rbac/legacy-reconciliations)
// =============================================================================

router.get(
  "/legacy-reconciliations",
  requireOperator,
  asyncHandler(async (req, res) => {
    const { status, limit, offset } = req.query;
    const reconciliations = await listLegacyReconciliations({ status, limit, offset });
    res.json(reconciliations);
  })
);

router.post(
  "/legacy-reconciliations/:id/reconcile",
  requireOperator,
  asyncHandler(async (req, res) => {
    const id = requireSafeId(req.params.id);
    const result = await reconcileLegacyRole(id, req.body, getActorContext(req));
    res.json({
      message: "Role legacy berhasil direkonsiliasi.",
      data: result
    });
  })
);

// =============================================================================
// CONTEXT ROLES FOR FRONTEND INTEGRATION (/rbac/context-roles)
// =============================================================================

router.get(
  "/context-roles",
  asyncHandler(async (req, res) => {
    const { scopeType } = req.query;
    const roles = await listContextRoles({ scopeType });
    res.json(roles);
  })
);

// =============================================================================
// ROLE CATALOG (/rbac/roles)
// =============================================================================

router.get(
  "/roles",
  asyncHandler(async (req, res) => {
    const includeArchived = req.query.includeArchived === "true";
    const limit = req.query.limit;
    const offset = req.query.offset;
    const roles = await listRoles({ includeArchived, limit, offset });
    res.json(roles);
  })
);

router.post(
  "/roles",
  requireOperator,
  asyncHandler(async (req, res) => {
    const role = await createRole(req.body, getActorContext(req));
    res.status(201).json({
      message: "Role berhasil dibuat.",
      data: role
    });
  })
);

router.get(
  "/roles/:id",
  asyncHandler(async (req, res) => {
    const id = requireSafeId(req.params.id);
    const role = await getRoleById(id);
    if (!role) {
      return res.status(404).json({ message: "Role tidak ditemukan." });
    }
    res.json(role);
  })
);

router.put(
  "/roles/:id",
  requireOperator,
  asyncHandler(async (req, res) => {
    const id = requireSafeId(req.params.id);
    const role = await updateRole(id, req.body, getActorContext(req));
    res.json({
      message: "Role berhasil diperbarui.",
      data: role
    });
  })
);

router.post(
  "/roles/:id/archive",
  requireOperator,
  asyncHandler(async (req, res) => {
    const id = requireSafeId(req.params.id);
    const role = await archiveRole(id, getActorContext(req));
    res.json({
      message: "Role berhasil diarsipkan.",
      data: role
    });
  })
);

router.delete(
  "/roles/:id",
  requireOperator,
  asyncHandler(async (req, res) => {
    const id = requireSafeId(req.params.id);
    const role = await archiveRole(id, getActorContext(req));
    res.json({
      message: "Role berhasil diarsipkan.",
      data: role
    });
  })
);

router.post(
  "/roles/:id/restore",
  requireOperator,
  asyncHandler(async (req, res) => {
    const id = requireSafeId(req.params.id);
    const role = await restoreRole(id, getActorContext(req));
    res.json({
      message: "Role berhasil dipulihkan.",
      data: role
    });
  })
);

router.get(
  "/roles/:id/permissions",
  asyncHandler(async (req, res) => {
    const id = requireSafeId(req.params.id);
    const result = await getRolePermissions(id);
    res.json(result);
  })
);

router.put(
  "/roles/:id/permissions",
  requireOperator,
  asyncHandler(async (req, res) => {
    const id = requireSafeId(req.params.id);
    const permissionCodes = req.body.permissions || req.body.permissionCodes || [];
    const expectedVersion = req.body.version !== undefined ? req.body.version : req.headers["if-match"];

    const result = await updateRolePermissions(
      id,
      permissionCodes,
      { expectedVersion: expectedVersion != null ? Number(expectedVersion) : null },
      getActorContext(req)
    );

    res.json({
      message: "Permissions role berhasil diperbarui.",
      data: result
    });
  })
);

router.get(
  "/roles/:id/impact",
  requireOperator,
  asyncHandler(async (req, res) => {
    const id = requireSafeId(req.params.id);
    const impact = await getRoleImpact(id);
    res.json(impact);
  })
);

// =============================================================================
// STUDENT ROLE ASSIGNMENTS & EFFECTIVE PERMISSIONS (/rbac/students/:id/...)
// =============================================================================

async function assertCanReadStudentPermissions(req, studentId) {
  const actorRole = extractRole(req);
  if (actorRole === "operator" || actorRole === "admin" || actorRole === "dosen") {
    return;
  }
  const student = await resolveStudentRecord(studentId);
  if (!student || student.user_id !== req.authUser?.id) {
    const err = new Error("Akses ditolak. Anda hanya dapat melihat hak akses milik sendiri.");
    err.statusCode = 403;
    throw err;
  }
}

router.get(
  "/students/:id/role-assignments",
  asyncHandler(async (req, res) => {
    const studentId = requireSafeId(req.params.id);
    await assertCanReadStudentPermissions(req, studentId);

    const includeRevoked = req.query.includeRevoked === "true";
    const assignments = await listStudentRoleAssignments(studentId, { includeRevoked });
    res.json(assignments);
  })
);

router.post(
  "/students/:id/role-assignments",
  requireOperator,
  asyncHandler(async (req, res) => {
    const studentId = requireSafeId(req.params.id);
    const result = await assignStudentRole(studentId, req.body, getActorContext(req));
    res.status(201).json({
      message: "Penugasan role berhasil disimpan.",
      data: result
    });
  })
);

router.delete(
  "/students/:id/role-assignments/:assignmentId",
  requireOperator,
  asyncHandler(async (req, res) => {
    const assignmentId = requireSafeId(req.params.assignmentId);
    const reason = req.body?.reason || req.query?.reason;
    const result = await revokeStudentRoleAssignment(assignmentId, { reason }, getActorContext(req));
    res.json({
      message: "Penugasan role berhasil dicabut.",
      data: result
    });
  })
);

router.post(
  "/students/:id/role-assignments/:assignmentId/revoke",
  requireOperator,
  asyncHandler(async (req, res) => {
    const assignmentId = requireSafeId(req.params.assignmentId);
    const reason = req.body?.reason || req.query?.reason;
    const result = await revokeStudentRoleAssignment(assignmentId, { reason }, getActorContext(req));
    res.json({
      message: "Penugasan role berhasil dicabut.",
      data: result
    });
  })
);

router.get(
  "/students/:id/effective-permissions",
  asyncHandler(async (req, res) => {
    const studentId = requireSafeId(req.params.id);
    await assertCanReadStudentPermissions(req, studentId);

    const { projectId, divisionId } = req.query;
    const effective = await resolveStudentEffectivePermissions(studentId, {
      projectId: projectId ? String(projectId).trim() : null,
      divisionId: divisionId ? String(divisionId).trim() : null
    });
    res.json(effective);
  })
);

module.exports = router;
