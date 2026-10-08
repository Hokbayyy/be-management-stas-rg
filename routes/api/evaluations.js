const express = require("express");
const asyncHandler = require("../../utils/asyncHandler");
const { extractRole } = require("../../utils/roleGuard");
const { requireSafeId } = require("../../utils/securityValidation");
const {
  listEvaluationPeriods,
  getEvaluationPeriodById,
  createEvaluationPeriod,
  updateEvaluationPeriod,
  openEvaluationPeriod,
  closeEvaluationPeriod,
  listEvaluationCriteria,
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
  checkUserIsPm
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
    const period = await closeEvaluationPeriod(id, userId);
    res.json({ message: "Periode evaluasi berhasil ditutup.", period });
  })
);

router.get(
  "/periods/:id/progress",
  asyncHandler(async (req, res) => {
    if (!requireAuth(req, res)) return;
    const { isStudent } = getRequester(req);
    if (isStudent) {
      return res.status(403).json({ message: "Akses ditolak. Mahasiswa tidak dapat melihat progres penilaian periode." });
    }
    const id = requireSafeId(req.params.id, "id");
    const progress = await getEvaluationPeriodProgress(id);
    res.json(progress);
  })
);

router.get(
  "/periods/:id/recap",
  asyncHandler(async (req, res) => {
    if (!requireAuth(req, res)) return;
    const { isStudent } = getRequester(req);
    if (isStudent) {
      return res.status(403).json({ message: "Akses ditolak. Mahasiswa tidak dapat melihat rekap penilaian periode." });
    }
    const id = requireSafeId(req.params.id, "id");
    const recap = await getEvaluationPeriodRecap(id);
    res.json(recap);
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
    const criteria = await listEvaluationCriteria(periodType);
    res.json({ criteria });
  })
);

// =============================================================================
// PM EVALUATION ASSIGNMENTS
// =============================================================================

router.get(
  "/pm/assignments",
  asyncHandler(async (req, res) => {
    if (!requireAuth(req, res)) return;
    const { isOperator, userId } = getRequester(req);
    const { periodId, divisionId, status } = req.query;
    if (!periodId) return res.status(400).json({ message: "periodId wajib diisi." });

    if (!isOperator) {
      const isPm = await checkUserIsPm(userId, String(periodId));
      if (!isPm) {
        return res.status(403).json({ message: "Akses ditolak. Anda tidak terdaftar sebagai Project Manager pada periode ini." });
      }
    }

    // Only operator can filter by another evaluatorId; PMs strictly see only their own
    const evaluatorId = isOperator ? (req.query.evaluatorId || null) : userId;

    const assignments = await listPmAssignments({
      periodId: String(periodId),
      evaluatorId,
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
    if (!isOperator && !isDosen && assignment.evaluator_id !== userId) {
      return res.status(403).json({ message: "Akses ditolak. Anda tidak berhak melihat penugasan ini." });
    }

    res.json({ assignment });
  })
);

router.put(
  "/pm/assignments/:id/submission",
  asyncHandler(async (req, res) => {
    if (!requireAuth(req, res)) return;
    const id = requireSafeId(req.params.id, "id");
    const { isOperator, userId } = getRequester(req);

    const assignment = await getPmAssignmentById(id);
    if (!assignment) return res.status(404).json({ message: "Penugasan evaluasi tidak ditemukan." });

    // PM only permitted to submit for their own assignment; operator can override
    if (!isOperator && assignment.evaluator_id !== userId) {
      return res.status(403).json({ message: "Akses ditolak. Anda tidak berhak menilai mahasiswa di luar divisi Anda." });
    }

    const updated = await savePmEvaluationSubmission(id, assignment.evaluator_id, req.body);
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
