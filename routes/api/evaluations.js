const express = require("express");
const asyncHandler = require("../../utils/asyncHandler");
const { extractRole } = require("../../utils/roleGuard");
const { requireSafeId } = require("../../utils/securityValidation");
const {
  listEvaluationPeriods,
  getEvaluationPeriodById,
  createEvaluationPeriod,
  updateEvaluationPeriod,
  migratePeriodScoringVersion,
  openEvaluationPeriod,
  closeEvaluationPeriod,
  deleteEvaluationPeriod,
  listEvaluationCriteria,
  getPeriodCriteria,
  listPmAssignments,
  getPmAssignmentById,
  createPmAssignment,
  savePmEvaluationSubmission,
  listPresentationSessions,
  getPresentationSessionById,
  createPresentationSession,
  updatePresentationSession,
  deletePresentationSession,
  addPresentationEvaluator,
  updatePresentationEvaluator,
  removePresentationEvaluator,
  listPresentationSlots,
  getPresentationSlotById,
  createPresentationSlot,
  updatePresentationSlot,
  updatePresentationSlotStatus,
  deletePresentationSlot,
  getPresentationSlotMyEvaluation,
  getPresentationSlotEvaluations,
  savePresentationEvaluationSubmission,
  getEvaluationPeriodProgress,
  getEvaluationPeriodRecap,
  getStudentEvaluationHistory,
  checkUserIsPm,
  listEvaluationGroups,
  getEvaluationGroupById,
  createEvaluationGroup,
  updateEvaluationGroup,
  addEvaluationGroupRole,
  removeEvaluationGroupRole,
  addEvaluationGroupStudent,
  removeEvaluationGroupStudent,
  getEligibleGroupStudents,
  listGroupEvaluators,
  addGroupEvaluator,
  removeGroupEvaluator,
  listPeriodEvaluators,
  addPeriodEvaluator,
  updatePeriodEvaluatorAttendance,
  removePeriodEvaluator,
  previewPeriodAssignments,
  syncPeriodAssignments,
  executeEmergencyActionOnPeriod,
  listEmergencyAudits,
  createMonitoringGrant,
  revokeMonitoringGrant,
  listMonitoringGrants,
  hasActiveMonitoringGrant
} = require("../../utils/evaluationService");
const { resolveStudentId, resolveStudentRecord } = require("../../utils/studentResolver");

const router = express.Router();

function getRequester(req) {
  const role = extractRole(req);
  const userId = req.authUser?.id || null;
  const isOperator = role === "operator";
  const isDosen = role === "dosen";
  const isStudent = role === "mahasiswa";
  return { role, userId, isOperator, isDosen, isStudent, isAdminOrLecturer: isOperator || isDosen };
}

function requireAuth(req, res) {
  const { userId } = getRequester(req);
  if (!userId) {
    res.status(401).json({ message: "Autentikasi diperlukan." });
    return false;
  }
  return true;
}

function requireAdmin(req, res) {
  if (!requireAuth(req, res)) return false;
  const { isOperator } = getRequester(req);
  if (!isOperator) {
    res.status(403).json({ message: "Akses ditolak. Hanya admin/operator yang diizinkan." });
    return false;
  }
  return true;
}

function requireStaff(req, res) {
  if (!requireAuth(req, res)) return false;
  const { isAdminOrLecturer } = getRequester(req);
  if (!isAdminOrLecturer) {
    res.status(403).json({ message: "Akses ditolak. Hanya staff yang diizinkan." });
    return false;
  }
  return true;
}

// =============================================================================
// PERIODS
// =============================================================================

router.get(
  "/periods",
  asyncHandler(async (req, res) => {
    if (!requireAuth(req, res)) return;
    const { type, status, limit, offset } = req.query;
    const periods = await listEvaluationPeriods({
      type: type || null,
      status: status || null,
      limit: limit ? Number(limit) : 50,
      offset: offset ? Number(offset) : 0
    });
    res.json({ periods });
  })
);

router.post(
  "/periods",
  asyncHandler(async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const { userId } = getRequester(req);
    const period = await createEvaluationPeriod(req.body, userId);
    res.status(201).json({ message: "Periode evaluasi berhasil dibuat.", period });
  })
);

router.get(
  "/periods/:id",
  asyncHandler(async (req, res) => {
    if (!requireAuth(req, res)) return;
    const id = requireSafeId(req.params.id, "id");
    const period = await getEvaluationPeriodById(id);
    if (!period) return res.status(404).json({ message: "Periode evaluasi tidak ditemukan." });
    res.json({ period });
  })
);

const handleUpdatePeriod = asyncHandler(async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const id = requireSafeId(req.params.id, "id");
  const period = await updateEvaluationPeriod(id, req.body);
  res.json({ message: "Periode evaluasi berhasil diperbarui.", period });
});

router.patch("/periods/:id", handleUpdatePeriod);
router.put("/periods/:id", handleUpdatePeriod);

router.get(
  "/periods/:id/criteria",
  asyncHandler(async (req, res) => {
    if (!requireAuth(req, res)) return;
    const id = requireSafeId(req.params.id, "id");
    const criteriaData = await getPeriodCriteria(id);
    res.json(criteriaData);
  })
);

router.post(
  "/periods/:id/migrate-scoring-version",
  asyncHandler(async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const id = requireSafeId(req.params.id, "id");
    const { targetVersion, scoringVersion, reason } = req.body || {};
    const versionToApply = targetVersion || scoringVersion;
    if (!versionToApply) {
      return res.status(400).json({ message: "targetVersion wajib diisi." });
    }
    const period = await migratePeriodScoringVersion(id, versionToApply, { reason }, req.authUser);
    res.json({ message: "Versi penilaian periode berhasil diperbarui.", period });
  })
);

router.post(
  "/periods/:id/open",
  asyncHandler(async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const id = requireSafeId(req.params.id, "id");
    const { userId } = getRequester(req);
    const period = await openEvaluationPeriod(id, userId);
    res.json({ message: "Periode evaluasi berhasil dibuka.", period });
  })
);

router.post(
  "/periods/:id/close",
  asyncHandler(async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const id = requireSafeId(req.params.id, "id");
    const { userId } = getRequester(req);
    const period = await closeEvaluationPeriod(id, userId, req.body);
    res.json({ message: "Periode evaluasi berhasil ditutup.", period });
  })
);

router.delete(
  "/periods/:id",
  asyncHandler(async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const id = requireSafeId(req.params.id, "id");
    const force = req.query.force === "true" || req.body?.force === true;
    const result = await deleteEvaluationPeriod(id, { force });
    res.json(result);
  })
);

router.post(
  "/periods/:id/emergency-action",
  asyncHandler(async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const id = requireSafeId(req.params.id, "id");
    const result = await executeEmergencyActionOnPeriod(id, req.body, req.authUser);
    res.json(result);
  })
);

router.get(
  "/emergency-audits",
  asyncHandler(async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const periodId = req.query.periodId ? String(req.query.periodId) : null;
    const audits = await listEmergencyAudits({ periodId });
    res.json({ audits });
  })
);

router.get(
  "/monitoring-grants",
  asyncHandler(async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const { userId, periodId, groupId, isActive } = req.query;
    const grants = await listMonitoringGrants({
      userId: userId ? String(userId) : null,
      periodId: periodId ? String(periodId) : null,
      groupId: groupId ? String(groupId) : null,
      isActive: isActive !== undefined ? isActive === "true" : null
    });
    res.json({ grants });
  })
);

router.post(
  "/monitoring-grants",
  asyncHandler(async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const { userId, periodId, groupId, reason } = req.body;
    if (!userId) return res.status(400).json({ message: "userId wajib diisi." });
    const grant = await createMonitoringGrant({
      userId,
      periodId: periodId ? String(periodId) : null,
      groupId: groupId ? String(groupId) : null,
      reason: reason ? String(reason).trim() : null,
      grantedBy: req.authUser?.id || null
    });
    res.status(201).json({ message: "Izin monitoring berhasil diberikan.", grant });
  })
);

router.delete(
  "/monitoring-grants/:id",
  asyncHandler(async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const id = requireSafeId(req.params.id, "id");
    const grant = await revokeMonitoringGrant(id, req.authUser?.id || null);
    res.json({ message: "Izin monitoring berhasil dicabut.", grant });
  })
);

router.get(
  "/periods/:id/preview-assignments",
  asyncHandler(async (req, res) => {
    if (!requireStaff(req, res)) return;
    const id = requireSafeId(req.params.id, "id");
    const preview = await previewPeriodAssignments(id);
    res.json(preview);
  })
);

router.post(
  "/periods/:id/sync-assignments",
  asyncHandler(async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const id = requireSafeId(req.params.id, "id");
    const { userId } = getRequester(req);
    const result = await syncPeriodAssignments(id, userId);
    res.json(result);
  })
);

router.get(
  "/periods/:id/evaluators",
  asyncHandler(async (req, res) => {
    if (!requireAuth(req, res)) return;
    const id = requireSafeId(req.params.id, "id");
    const evaluators = await listPeriodEvaluators(id);
    res.json({ evaluators });
  })
);

router.post(
  "/periods/:id/evaluators",
  asyncHandler(async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const id = requireSafeId(req.params.id, "id");
    const { evaluatorId, groupId } = req.body;
    if (!evaluatorId) return res.status(400).json({ message: "evaluatorId wajib diisi." });
    const evaluator = await addPeriodEvaluator(id, evaluatorId, groupId || null);
    res.status(201).json({ message: "Evaluator periode berhasil ditambahkan.", evaluator });
  })
);

const handleUpdatePeriodEvaluatorAttendance = asyncHandler(async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const id = requireSafeId(req.params.id, "id");
  const evaluatorId = requireSafeId(req.params.evaluatorId, "evaluatorId");
  const { userId } = getRequester(req);
  const evaluator = await updatePeriodEvaluatorAttendance(id, evaluatorId, req.body, userId);
  res.json({ message: "Kehadiran evaluator periode berhasil diperbarui.", evaluator });
});

router.patch("/periods/:id/evaluators/:evaluatorId/attendance", handleUpdatePeriodEvaluatorAttendance);
router.put("/periods/:id/evaluators/:evaluatorId/attendance", handleUpdatePeriodEvaluatorAttendance);

router.delete(
  "/periods/:id/evaluators/:evaluatorId",
  asyncHandler(async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const id = requireSafeId(req.params.id, "id");
    const evaluatorId = requireSafeId(req.params.evaluatorId, "evaluatorId");
    const result = await removePeriodEvaluator(id, evaluatorId);
    res.json(result);
  })
);

router.get(
  "/periods/:id/progress",
  asyncHandler(async (req, res) => {
    if (!requireAuth(req, res)) return;
    const { isOperator, isDosen, isStudent, userId } = getRequester(req);
    if (isStudent) {
      return res.status(403).json({ message: "Akses ditolak. Mahasiswa tidak dapat melihat progres penilaian periode." });
    }
    const id = requireSafeId(req.params.id, "id");
    const period = await getEvaluationPeriodById(id);
    if (!period) return res.status(404).json({ message: "Periode evaluasi tidak ditemukan." });

    if (isOperator) {
      const progress = await getEvaluationPeriodProgress(id);
      return res.json(progress);
    }

    if (isDosen) {
      if (period.status !== "CLOSED") {
        return res.status(403).json({
          message: "Akses ditolak. Progres penilaian periode hanya dapat diakses oleh dosen setelah periode berstatus CLOSED."
        });
      }
      const hasGrant = await hasActiveMonitoringGrant(userId, {
        periodId: id,
        groupId: period.group_id
      });
      if (!hasGrant) {
        return res.status(403).json({
          message: "Akses ditolak. Anda tidak memiliki izin monitoring untuk periode ini."
        });
      }
      const progress = await getEvaluationPeriodProgress(id);
      return res.json(progress);
    }

    return res.status(403).json({ message: "Akses ditolak." });
  })
);

router.get(
  "/periods/:id/recap",
  asyncHandler(async (req, res) => {
    if (!requireAuth(req, res)) return;
    const { isOperator, isDosen, isStudent, userId } = getRequester(req);
    if (isStudent) {
      return res.status(403).json({ message: "Akses ditolak. Mahasiswa tidak dapat melihat rekap penilaian periode." });
    }
    const id = requireSafeId(req.params.id, "id");
    const period = await getEvaluationPeriodById(id);
    if (!period) return res.status(404).json({ message: "Periode evaluasi tidak ditemukan." });

    if (isOperator) {
      const recap = await getEvaluationPeriodRecap(id);
      return res.json(recap);
    }

    if (isDosen) {
      if (period.status !== "CLOSED") {
        return res.status(403).json({
          message: "Akses ditolak. Rekap penilaian periode hanya dapat diakses oleh dosen setelah periode berstatus CLOSED."
        });
      }
      const hasGrant = await hasActiveMonitoringGrant(userId, {
        periodId: id,
        groupId: period.group_id
      });
      if (!hasGrant) {
        return res.status(403).json({
          message: "Akses ditolak. Anda tidak memiliki izin monitoring untuk periode ini."
        });
      }
      const recap = await getEvaluationPeriodRecap(id);
      return res.json(recap);
    }

    return res.status(403).json({ message: "Akses ditolak." });
  })
);

// =============================================================================
// CRITERIA
// =============================================================================

router.get(
  "/criteria",
  asyncHandler(async (req, res) => {
    if (!requireAuth(req, res)) return;
    const periodType = req.query.periodType || req.query.type || null;
    const scoringVersion = req.query.scoringVersion || req.query.scoring_version || null;
    const criteria = await listEvaluationCriteria({ periodType, scoringVersion });
    res.json({ criteria });
  })
);

// =============================================================================
// EVALUATION GROUPS & ROLE/STUDENT MAPPINGS
// =============================================================================

router.get(
  "/groups",
  asyncHandler(async (req, res) => {
    if (!requireAuth(req, res)) return;
    const { isActive } = req.query;
    const groups = await listEvaluationGroups({ isActive: isActive !== undefined ? isActive === "true" : null });
    res.json({ groups });
  })
);

router.post(
  "/groups",
  asyncHandler(async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const group = await createEvaluationGroup(req.body);
    res.status(201).json({ message: "Kelompok evaluasi berhasil dibuat.", group });
  })
);

router.get(
  "/groups/:groupId",
  asyncHandler(async (req, res) => {
    if (!requireAuth(req, res)) return;
    const groupId = requireSafeId(req.params.groupId, "groupId");
    const group = await getEvaluationGroupById(groupId);
    if (!group) return res.status(404).json({ message: "Kelompok evaluasi tidak ditemukan." });
    res.json({ group });
  })
);

const handleUpdateGroup = asyncHandler(async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const groupId = requireSafeId(req.params.groupId, "groupId");
  const group = await updateEvaluationGroup(groupId, req.body);
  res.json({ message: "Kelompok evaluasi berhasil diperbarui.", group });
});

router.patch("/groups/:groupId", handleUpdateGroup);
router.put("/groups/:groupId", handleUpdateGroup);

router.post(
  "/groups/:groupId/roles",
  asyncHandler(async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const groupId = requireSafeId(req.params.groupId, "groupId");
    const { rolePattern } = req.body;
    if (!rolePattern) return res.status(400).json({ message: "rolePattern wajib diisi." });
    const mapping = await addEvaluationGroupRole(groupId, rolePattern);
    res.status(201).json({ message: "Mapping role berhasil ditambahkan.", mapping });
  })
);

router.delete(
  "/groups/:groupId/roles/:mappingId",
  asyncHandler(async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const mappingId = requireSafeId(req.params.mappingId, "mappingId");
    const result = await removeEvaluationGroupRole(mappingId);
    res.json(result);
  })
);

router.post(
  "/groups/:groupId/students",
  asyncHandler(async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const groupId = requireSafeId(req.params.groupId, "groupId");
    const { studentId, notes } = req.body;
    if (!studentId) return res.status(400).json({ message: "studentId wajib diisi." });
    const mapping = await addEvaluationGroupStudent(groupId, studentId, notes);
    res.status(201).json({ message: "Mahasiswa berhasil ditambahkan ke kelompok.", mapping });
  })
);

router.delete(
  "/groups/:groupId/students/:studentId",
  asyncHandler(async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const groupId = requireSafeId(req.params.groupId, "groupId");
    const studentId = requireSafeId(req.params.studentId, "studentId");
    const result = await removeEvaluationGroupStudent(groupId, studentId);
    res.json(result);
  })
);

router.get(
  "/groups/:groupId/eligible-students",
  asyncHandler(async (req, res) => {
    if (!requireStaff(req, res)) return;
    const groupId = requireSafeId(req.params.groupId, "groupId");
    const eligibleStudents = await getEligibleGroupStudents(groupId);
    res.json({ students: eligibleStudents, eligibleStudents, count: eligibleStudents.length });
  })
);

router.get(
  "/groups/:groupId/evaluators",
  asyncHandler(async (req, res) => {
    if (!requireAuth(req, res)) return;
    const groupId = requireSafeId(req.params.groupId, "groupId");
    const evaluators = await listGroupEvaluators(groupId);
    res.json({ evaluators });
  })
);

router.post(
  "/groups/:groupId/evaluators",
  asyncHandler(async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const groupId = requireSafeId(req.params.groupId, "groupId");
    const { evaluatorId } = req.body;
    if (!evaluatorId) return res.status(400).json({ message: "evaluatorId wajib diisi." });
    const evaluator = await addGroupEvaluator(groupId, evaluatorId);
    res.status(201).json({ message: "Evaluator berhasil ditambahkan ke kelompok.", evaluator });
  })
);

router.delete(
  "/groups/:groupId/evaluators/:evaluatorId",
  asyncHandler(async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const groupId = requireSafeId(req.params.groupId, "groupId");
    const evaluatorId = requireSafeId(req.params.evaluatorId, "evaluatorId");
    const result = await removeGroupEvaluator(groupId, evaluatorId);
    res.json(result);
  })
);

// =============================================================================
// PM EVALUATION ASSIGNMENTS
// =============================================================================

router.get(
  "/pm/assignments",
  asyncHandler(async (req, res) => {
    if (!requireAuth(req, res)) return;
    const { isOperator, isDosen, userId } = getRequester(req);
    const { periodId, groupId, divisionId, status } = req.query;
    if (!periodId) return res.status(400).json({ message: "periodId wajib diisi." });

    const period = await getEvaluationPeriodById(String(periodId));
    if (!period) return res.status(404).json({ message: "Periode evaluasi tidak ditemukan." });

    let targetEvaluatorId = null;

    if (isOperator) {
      targetEvaluatorId = req.query.evaluatorId || null;
    } else if (isDosen) {
      const isPm = await checkUserIsPm(userId, String(periodId));
      const requestedOtherEvaluator = Boolean(req.query.evaluatorId && req.query.evaluatorId !== userId);

      if (period.status !== "CLOSED") {
        if (requestedOtherEvaluator) {
          return res.status(403).json({
            message: "Akses ditolak. Dosen tidak dapat melihat penugasan PM lain saat periode belum CLOSED."
          });
        }
        if (!isPm) {
          return res.status(403).json({
            message: "Akses ditolak. Anda tidak terdaftar sebagai Project Manager pada periode ini."
          });
        }
        targetEvaluatorId = userId;
      } else {
        const hasGrant = await hasActiveMonitoringGrant(userId, {
          periodId: String(periodId),
          groupId: period.group_id
        });

        if (requestedOtherEvaluator || !isPm) {
          if (!hasGrant) {
            return res.status(403).json({
              message: "Akses ditolak. Anda tidak memiliki izin monitoring untuk periode ini."
            });
          }
          targetEvaluatorId = req.query.evaluatorId || null;
        } else {
          targetEvaluatorId = hasGrant ? (req.query.evaluatorId || null) : userId;
        }
      }
    } else {
      const isPm = await checkUserIsPm(userId, String(periodId));
      if (!isPm) {
        return res.status(403).json({
          message: "Akses ditolak. Anda tidak terdaftar sebagai Project Manager pada periode ini."
        });
      }
      if (req.query.evaluatorId && req.query.evaluatorId !== userId) {
        return res.status(403).json({
          message: "Akses ditolak. Anda tidak berhak melihat penugasan PM lain."
        });
      }
      targetEvaluatorId = userId;
    }

    const assignments = await listPmAssignments({
      periodId: String(periodId),
      evaluatorId: targetEvaluatorId,
      groupId: groupId || null,
      divisionId: divisionId || null,
      status: status || null
    });

    res.json({ assignments });
  })
);

router.post(
  "/pm/assignments",
  asyncHandler(async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const assignment = await createPmAssignment(req.body);
    res.status(201).json({ message: "Penugasan evaluasi berhasil disimpan.", assignment });
  })
);

router.get(
  "/pm/assignments/:id",
  asyncHandler(async (req, res) => {
    if (!requireAuth(req, res)) return;
    const id = requireSafeId(req.params.id, "id");
    const assignment = await getPmAssignmentById(id);
    if (!assignment) return res.status(404).json({ message: "Penugasan evaluasi tidak ditemukan." });

    const { isOperator, isDosen, userId } = getRequester(req);

    // 1. Evaluator reads own assignment: always allowed
    if (assignment.evaluator_id === userId) {
      return res.json({ assignment });
    }

    // 2. Admin / Operator monitoring: allowed
    if (isOperator) {
      return res.json({ assignment });
    }

    // 3. Dosen reading other PM's assignment:
    // Only allowed if period is CLOSED AND has active monitoring grant
    if (isDosen) {
      if (assignment.period_status !== "CLOSED") {
        return res.status(403).json({
          message: "Akses ditolak. Dosen tidak dapat melihat penugasan PM lain saat periode belum CLOSED."
        });
      }

      const hasGrant = await hasActiveMonitoringGrant(userId, {
        periodId: assignment.period_id,
        groupId: assignment.group_id || assignment.groupId
      });

      if (!hasGrant) {
        return res.status(403).json({
          message: "Akses ditolak. Anda tidak memiliki izin monitoring untuk melihat penugasan ini."
        });
      }

      return res.json({ assignment });
    }

    // 4. Mahasiswa or others attempting to read other's assignment: 403
    return res.status(403).json({ message: "Akses ditolak. Anda tidak berhak melihat penugasan ini." });
  })
);

router.put(
  "/pm/assignments/:id/submission",
  asyncHandler(async (req, res) => {
    if (!requireAuth(req, res)) return;
    const id = requireSafeId(req.params.id, "id");
    const { userId } = getRequester(req);

    const assignment = await getPmAssignmentById(id);
    if (!assignment) return res.status(404).json({ message: "Penugasan evaluasi tidak ditemukan." });

    // Strictly enforce: only the assigned PM evaluator can draft or submit evaluation (no admin/operator bypass)
    if (assignment.evaluator_id !== userId) {
      return res.status(403).json({ message: "Akses ditolak. Anda tidak berhak menilai penugasan ini." });
    }

    const updated = await savePmEvaluationSubmission(id, userId, req.body);
    const isSubmitted = req.body?.status === "SUBMITTED";
    res.json({
      message: isSubmitted ? "Evaluasi berhasil disubmit." : "Draft evaluasi berhasil disimpan.",
      assignment: updated
    });
  })
);

// =============================================================================
// PRESENTATION SESSIONS
// =============================================================================

router.get(
  "/presentation-sessions",
  asyncHandler(async (req, res) => {
    if (!requireAuth(req, res)) return;
    const periodId = req.query.periodId || null;
    if (!periodId) return res.status(400).json({ message: "periodId wajib diisi." });

    const sessions = await listPresentationSessions(String(periodId));
    res.json({ sessions });
  })
);

router.post(
  "/presentation-sessions",
  asyncHandler(async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const { periodId } = req.body;
    if (!periodId) return res.status(400).json({ message: "periodId wajib diisi." });

    const { userId } = getRequester(req);
    const session = await createPresentationSession(periodId, req.body, userId);
    res.status(201).json({ message: "Sesi presentasi berhasil dibuat.", session });
  })
);

router.get(
  "/presentation-sessions/:id",
  asyncHandler(async (req, res) => {
    if (!requireAuth(req, res)) return;
    const id = requireSafeId(req.params.id, "id");
    const session = await getPresentationSessionById(id);
    if (!session) return res.status(404).json({ message: "Sesi presentasi tidak ditemukan." });
    res.json({ session });
  })
);

const handleUpdateSession = asyncHandler(async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const id = requireSafeId(req.params.id, "id");
  const session = await updatePresentationSession(id, req.body);
  res.json({ message: "Sesi presentasi berhasil diperbarui.", session });
});

router.patch("/presentation-sessions/:id", handleUpdateSession);
router.put("/presentation-sessions/:id", handleUpdateSession);

router.delete(
  "/presentation-sessions/:id",
  asyncHandler(async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const id = requireSafeId(req.params.id, "id");
    const result = await deletePresentationSession(id);
    res.json(result);
  })
);

// =============================================================================
// PRESENTATION EVALUATORS
// =============================================================================

router.get(
  "/presentation-sessions/:sessionId/evaluators",
  asyncHandler(async (req, res) => {
    if (!requireAuth(req, res)) return;
    const sessionId = requireSafeId(req.params.sessionId, "sessionId");
    const session = await getPresentationSessionById(sessionId);
    if (!session) return res.status(404).json({ message: "Sesi presentasi tidak ditemukan." });
    res.json({ evaluators: session.evaluators || [] });
  })
);

router.post(
  "/presentation-sessions/:sessionId/evaluators",
  asyncHandler(async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const sessionId = requireSafeId(req.params.sessionId, "sessionId");
    const evaluator = await addPresentationEvaluator(sessionId, req.body);
    res.status(201).json({ message: "Evaluator sesi presentasi berhasil ditambahkan.", evaluator });
  })
);

router.patch(
  "/presentation-evaluators/:id",
  asyncHandler(async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const id = requireSafeId(req.params.id, "id");
    const evaluator = await updatePresentationEvaluator(id, req.body);
    res.json({ message: "Status evaluator berhasil diperbarui.", evaluator });
  })
);

router.delete(
  "/presentation-evaluators/:id",
  asyncHandler(async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const id = requireSafeId(req.params.id, "id");
    const result = await removePresentationEvaluator(id);
    res.json(result);
  })
);

// =============================================================================
// PRESENTATION SLOTS
// =============================================================================

router.get(
  "/presentation-sessions/:sessionId/slots",
  asyncHandler(async (req, res) => {
    if (!requireAuth(req, res)) return;
    const sessionId = requireSafeId(req.params.sessionId, "sessionId");
    const slots = await listPresentationSlots(sessionId);
    res.json({ slots });
  })
);

router.post(
  "/presentation-sessions/:sessionId/slots",
  asyncHandler(async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const sessionId = requireSafeId(req.params.sessionId, "sessionId");
    const slot = await createPresentationSlot(sessionId, req.body);
    res.status(201).json({ message: "Slot presentasi berhasil dibuat.", slot });
  })
);

router.get(
  "/presentation-slots/:id",
  asyncHandler(async (req, res) => {
    if (!requireAuth(req, res)) return;
    const id = requireSafeId(req.params.id, "id");
    const slot = await getPresentationSlotById(id);
    if (!slot) return res.status(404).json({ message: "Slot presentasi tidak ditemukan." });
    res.json({ slot });
  })
);

const handleUpdateSlot = asyncHandler(async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const id = requireSafeId(req.params.id, "id");
  const slot = await updatePresentationSlot(id, req.body);
  res.json({ message: "Slot presentasi berhasil diperbarui.", slot });
});

router.patch("/presentation-slots/:id", handleUpdateSlot);
router.put("/presentation-slots/:id", handleUpdateSlot);

const handleUpdateSlotStatus = asyncHandler(async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const id = requireSafeId(req.params.id, "id");
  const { status } = req.body;
  if (!status) return res.status(400).json({ message: "status wajib diisi." });
  const slot = await updatePresentationSlotStatus(id, status);
  res.json({ message: "Status slot presentasi berhasil diperbarui.", slot });
});

router.patch("/presentation-slots/:id/status", handleUpdateSlotStatus);
router.put("/presentation-slots/:id/status", handleUpdateSlotStatus);

router.delete(
  "/presentation-slots/:id",
  asyncHandler(async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const id = requireSafeId(req.params.id, "id");
    const result = await deletePresentationSlot(id);
    res.json(result);
  })
);

// =============================================================================
// PRESENTATION SLOT EVALUATIONS
// =============================================================================

router.get(
  "/presentation-slots/:id/my-evaluation",
  asyncHandler(async (req, res) => {
    if (!requireAuth(req, res)) return;
    const id = requireSafeId(req.params.id, "id");
    const { userId } = getRequester(req);
    const evaluation = await getPresentationSlotMyEvaluation(id, userId);
    res.json({ evaluation });
  })
);

router.put(
  "/presentation-slots/:id/my-evaluation",
  asyncHandler(async (req, res) => {
    if (!requireAuth(req, res)) return;
    const id = requireSafeId(req.params.id, "id");
    const { userId, isOperator } = getRequester(req);

    const slot = await getPresentationSlotById(id);
    if (!slot) return res.status(404).json({ message: "Slot presentasi tidak ditemukan." });

    if (slot.status === "ABSENT") {
      return res.status(400).json({ message: "Mahasiswa berstatus tidak hadir (ABSENT), penilaian tidak dapat diberikan." });
    }

    // Verify evaluator is assigned to the session (or operator)
    if (!isOperator) {
      const session = await getPresentationSessionById(slot.session_id);
      const isAssigned = (session?.evaluators || []).some((e) => e.evaluator_id === userId);
      if (!isAssigned) {
        return res.status(403).json({ message: "Akses ditolak. Anda tidak terdaftar sebagai evaluator pada sesi ini." });
      }
    }

    const updated = await savePresentationEvaluationSubmission(id, userId, req.body);
    const isSubmitted = req.body?.status === "SUBMITTED";
    res.json({
      message: isSubmitted ? "Penilaian presentasi berhasil disubmit." : "Draft penilaian presentasi berhasil disimpan.",
      evaluation: updated
    });
  })
);

router.get(
  "/presentation-slots/:id/evaluations",
  asyncHandler(async (req, res) => {
    if (!requireAuth(req, res)) return;
    const id = requireSafeId(req.params.id, "id");
    const { isOperator, isDosen, userId } = getRequester(req);

    const slot = await getPresentationSlotById(id);
    if (!slot) return res.status(404).json({ message: "Slot presentasi tidak ditemukan." });

    // Students cannot view individual evaluator sheets
    if (!isOperator && !isDosen) {
      const session = await getPresentationSessionById(slot.session_id);
      const isAssigned = (session?.evaluators || []).some((e) => e.evaluator_id === userId);
      if (!isAssigned) {
        return res.status(403).json({ message: "Akses ditolak melihat lembar penilaian." });
      }
    }

    const data = await getPresentationSlotEvaluations(id);
    res.json(data);
  })
);

// =============================================================================
// STUDENT RECAP & HISTORY
// =============================================================================

router.get(
  "/my-history",
  asyncHandler(async (req, res) => {
    if (!requireAuth(req, res)) return;
    const { userId, isStudent } = getRequester(req);
    const history = await getStudentEvaluationHistory(userId, { isStudent });
    res.json(history);
  })
);

router.get(
  "/students/:studentId/recap",
  asyncHandler(async (req, res) => {
    if (!requireAuth(req, res)) return;
    const studentIdParam = requireSafeId(req.params.studentId, "studentId");
    const { isOperator, isDosen, isStudent, userId } = getRequester(req);

    const studentRecord = await resolveStudentRecord(studentIdParam);
    if (!studentRecord) return res.status(404).json({ message: "Mahasiswa tidak ditemukan." });

    // Strict rule: Mahasiswa can ONLY access their own recap
    if (!isOperator && !isDosen && studentRecord.user_id !== userId) {
      return res.status(403).json({ message: "Akses ditolak. Mahasiswa tidak dapat melihat nilai mahasiswa lain." });
    }

    const history = await getStudentEvaluationHistory(studentRecord.id, { isStudent });
    res.json(history);
  })
);

module.exports = router;
