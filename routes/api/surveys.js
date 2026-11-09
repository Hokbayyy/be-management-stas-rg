const express = require("express");
const asyncHandler = require("../../utils/asyncHandler");
const { extractRole } = require("../../utils/roleGuard");
const { requireSafeId } = require("../../utils/securityValidation");
const {
  listSurveys,
  getSurveyById,
  createSurvey,
  updateSurvey,
  updateSurveyStatus,
  deleteSurvey,
  getActiveStudentSurvey,
  getSurveyFormForStudent,
  submitSurveyAnswers,
  getSurveyStatistics,
  getSurveySubmissions,
  exportSurveyResponsesCsv,
  enforcePostDeadlineSurveyLocks,
} = require("../../utils/surveyService");

const router = express.Router();

function getRequester(req) {
  const role = extractRole(req);
  const userId = req.authUser?.id || null;
  const isOperator = role === "operator" || role === "admin";
  const isStudent = role === "mahasiswa";
  const isDosen = role === "dosen";
  return { role, userId, isOperator, isStudent, isDosen };
}

function requireOperator(req, res) {
  const { isOperator, userId } = getRequester(req);
  if (!userId) {
    res.status(401).json({ message: "Autentikasi diperlukan." });
    return false;
  }
  if (!isOperator) {
    res.status(403).json({ message: "Akses ditolak: Hanya admin atau operator yang dapat mengelola survey." });
    return false;
  }
  return true;
}

function requireStudent(req, res) {
  const { isStudent, userId } = getRequester(req);
  if (!userId) {
    res.status(401).json({ message: "Autentikasi diperlukan." });
    return false;
  }
  if (!isStudent) {
    res.status(403).json({ message: "Akses ditolak: Endpoint ini khusus untuk mahasiswa." });
    return false;
  }
  return true;
}

// =============================================================================
// MAHASISWA ROUTES
// =============================================================================

/**
 * GET /api/v1/surveys/active
 * Check active survey for currently logged in student
 */
router.get(
  "/active",
  asyncHandler(async (req, res) => {
    const { userId } = getRequester(req);
    if (!userId) {
      return res.status(401).json({ message: "Autentikasi diperlukan." });
    }
    const result = await getActiveStudentSurvey(userId);
    res.json(result);
  })
);

/**
 * GET /api/v1/surveys/:id/form
 * Get questions for student filling
 */
router.get(
  "/:id/form",
  asyncHandler(async (req, res) => {
    if (!requireStudent(req, res)) return;
    const { id } = req.params;
    requireSafeId(id, "ID Survey");
    const { userId } = getRequester(req);
    const result = await getSurveyFormForStudent(id, userId);
    res.json(result);
  })
);

/**
 * POST /api/v1/surveys/:id/submit
 * Submit survey answers from student
 */
router.post(
  "/:id/submit",
  asyncHandler(async (req, res) => {
    if (!requireStudent(req, res)) return;
    const { id } = req.params;
    requireSafeId(id, "ID Survey");
    const { userId } = getRequester(req);
    const { answers } = req.body;

    const result = await submitSurveyAnswers(id, userId, answers);
    res.status(201).json(result);
  })
);

// =============================================================================
// ADMIN / OPERATOR ROUTES
// =============================================================================

/**
 * GET /api/v1/surveys
 * List all surveys
 */
router.get(
  "/",
  asyncHandler(async (req, res) => {
    if (!requireOperator(req, res)) return;
    const { status } = req.query;
    const surveys = await listSurveys({ status });
    res.json(surveys);
  })
);

/**
 * POST /api/v1/surveys
 * Create a new survey
 */
router.post(
  "/",
  asyncHandler(async (req, res) => {
    if (!requireOperator(req, res)) return;
    const { userId } = getRequester(req);
    const created = await createSurvey(req.body, userId);
    res.status(201).json(created);
  })
);

/**
 * GET /api/v1/surveys/:id
 * Get survey detail with questions
 */
router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    if (!requireOperator(req, res)) return;
    const { id } = req.params;
    requireSafeId(id, "ID Survey");
    const survey = await getSurveyById(id);
    res.json(survey);
  })
);

/**
 * PUT /api/v1/surveys/:id
 * Update survey and questions
 */
router.put(
  "/:id",
  asyncHandler(async (req, res) => {
    if (!requireOperator(req, res)) return;
    const { id } = req.params;
    requireSafeId(id, "ID Survey");
    const { userId } = getRequester(req);
    const updated = await updateSurvey(id, req.body, userId);
    res.json(updated);
  })
);

/**
 * PATCH /api/v1/surveys/:id/status
 * Change survey lifecycle status (DRAFT, OPEN, CLOSED, ARCHIVED)
 */
router.patch(
  "/:id/status",
  asyncHandler(async (req, res) => {
    if (!requireOperator(req, res)) return;
    const { id } = req.params;
    requireSafeId(id, "ID Survey");
    const { userId } = getRequester(req);
    const { status } = req.body;

    const updated = await updateSurveyStatus(id, status, userId);
    res.json(updated);
  })
);

/**
 * DELETE /api/v1/surveys/:id
 * Delete draft survey
 */
router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    if (!requireOperator(req, res)) return;
    const { id } = req.params;
    requireSafeId(id, "ID Survey");
    const result = await deleteSurvey(id);
    res.json(result);
  })
);

/**
 * GET /api/v1/surveys/:id/results
 * Get survey analytics, LSI, Facility Score, Ecosystem Score, and question charts
 */
router.get(
  "/:id/results",
  asyncHandler(async (req, res) => {
    if (!requireOperator(req, res)) return;
    const { id } = req.params;
    requireSafeId(id, "ID Survey");
    const results = await getSurveyStatistics(id);
    res.json(results);
  })
);

/**
 * GET /api/v1/surveys/:id/submissions
 * Get list of student submissions / participation
 */
router.get(
  "/:id/submissions",
  asyncHandler(async (req, res) => {
    if (!requireOperator(req, res)) return;
    const { id } = req.params;
    requireSafeId(id, "ID Survey");
    const submissions = await getSurveySubmissions(id);
    res.json(submissions);
  })
);

/**
 * GET /api/v1/surveys/:id/export
 * Export survey responses to CSV
 */
router.get(
  "/:id/export",
  asyncHandler(async (req, res) => {
    if (!requireOperator(req, res)) return;
    const { id } = req.params;
    requireSafeId(id, "ID Survey");
    const csvContent = await exportSurveyResponsesCsv(id);

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="survey-hasil-${id}.csv"`);
    res.status(200).send(csvContent);
  })
);

/**
 * POST /api/v1/surveys/:id/enforce-locks
 * Trigger post-deadline access locks for unfulfilled students
 */
router.post(
  "/:id/enforce-locks",
  asyncHandler(async (req, res) => {
    if (!requireOperator(req, res)) return;
    const result = await enforcePostDeadlineSurveyLocks();
    res.json(result);
  })
);

module.exports = router;
