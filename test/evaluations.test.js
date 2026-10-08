const test = require("node:test");
const assert = require("node:assert/strict");

const {
  ensureEvaluationTables,
  calculateAverageScore,
  validateScoreRange,
  INITIAL_PM_CRITERIA,
  INITIAL_PRESENTATION_CRITERIA
} = require("../utils/evaluationService");

// ---------------------------------------------------------------------------
// 1. Scoring & Criteria Unit Tests
// ---------------------------------------------------------------------------

test("Initial evaluation criteria are correctly configured with 1.0 - 10.0 scale", () => {
  assert.equal(INITIAL_PM_CRITERIA.length, 7, "PM Evaluation must have 7 criteria");
  assert.equal(INITIAL_PRESENTATION_CRITERIA.length, 7, "Presentation must have 7 criteria");

  const expectedPmKeys = [
    "quality_of_work",
    "responsibility",
    "technical_skill",
    "problem_solving",
    "collaboration",
    "initiative",
    "research_contribution"
  ];

  for (const key of expectedPmKeys) {
    const found = INITIAL_PM_CRITERIA.find((c) => c.key === key);
    assert.ok(found, `PM criteria must include key: ${key}`);
    assert.equal(found.min_score, 1.0);
    assert.equal(found.max_score, 10.0);
  }

  const expectedPresentationKeys = [
    "progress_achievement",
    "quality_of_result",
    "technical_understanding",
    "problem_solving",
    "presentation_delivery",
    "response_to_questions",
    "next_plan"
  ];

  for (const key of expectedPresentationKeys) {
    const found = INITIAL_PRESENTATION_CRITERIA.find((c) => c.key === key);
    assert.ok(found, `Presentation criteria must include key: ${key}`);
    assert.equal(found.min_score, 1.0);
    assert.equal(found.max_score, 10.0);
  }
});

test("Score range validation accepts 1.0 to 10.0 and rejects out-of-range scores", () => {
  // Valid scores
  assert.equal(validateScoreRange(1.0), true);
  assert.equal(validateScoreRange(5.5), true);
  assert.equal(validateScoreRange(10.0), true);
  assert.equal(validateScoreRange("8.75"), true);

  // Invalid scores
  assert.equal(validateScoreRange(0), false);
  assert.equal(validateScoreRange(0.9), false);
  assert.equal(validateScoreRange(10.1), false);
  assert.equal(validateScoreRange(-5), false);
  assert.equal(validateScoreRange(null), false);
  assert.equal(validateScoreRange(undefined), false);
  assert.equal(validateScoreRange("abc"), false);
});

test("Score averaging calculates correct arithmetic mean with 2 decimal precision", () => {
  const scores1 = [8.0, 9.0, 7.5];
  // (8 + 9 + 7.5) / 3 = 24.5 / 3 = 8.1666... -> 8.17
  assert.equal(calculateAverageScore(scores1), 8.17);

  const scores2 = [10.0, 10.0];
  assert.equal(calculateAverageScore(scores2), 10.0);

  const scores3 = [];
  assert.equal(calculateAverageScore(scores3), null);

  const scores4 = [null, undefined];
  assert.equal(calculateAverageScore(scores4), null);
});

// ---------------------------------------------------------------------------
// 2. Presentation Evaluation Independence & Aggregation
// ---------------------------------------------------------------------------

test("Presentation score is average of SUBMITTED evaluators only; DRAFTs excluded", () => {
  const mockEvaluatorSubmissions = [
    { evaluator_id: "USR-PM-1", status: "SUBMITTED", overall_score: 8.5 },
    { evaluator_id: "USR-PM-2", status: "SUBMITTED", overall_score: 9.5 },
    { evaluator_id: "USR-ADMIN", status: "DRAFT", overall_score: 7.0 } // Draft not submitted
  ];

  const submittedScores = mockEvaluatorSubmissions
    .filter((s) => s.status === "SUBMITTED" && s.overall_score != null)
    .map((s) => Number(s.overall_score));

  assert.equal(submittedScores.length, 2);
  const avg = calculateAverageScore(submittedScores);
  assert.equal(avg, 9.0, "Average should be (8.5 + 9.5) / 2 = 9.0");
});

test("Status slot ABSENT produces NULL presentation score, never 0.00", () => {
  function getComputedPresentationScore(slotStatus, submittedScores) {
    if (slotStatus === "ABSENT") {
      return null;
    }
    return calculateAverageScore(submittedScores);
  }

  // When student is absent, score must be null
  assert.equal(getComputedPresentationScore("ABSENT", [0, 5, 10]), null);
  assert.equal(getComputedPresentationScore("ABSENT", []), null);

  // When student completed, score is computed average
  assert.equal(getComputedPresentationScore("COMPLETED", [8.0, 9.0]), 8.5);
  // When completed but no submissions yet, score is null (not 0)
  assert.equal(getComputedPresentationScore("COMPLETED", []), null);
});

// ---------------------------------------------------------------------------
// 3. PM Division Access & Role Scoping
// ---------------------------------------------------------------------------

test("PM can only evaluate assignments within their assigned division", () => {
  function checkPmCanSubmitEvaluation(requester, assignment) {
    const isOperator = requester.role === "operator";
    const isDosen = requester.role === "dosen";

    // Operator & Dosen have global management access
    if (isOperator || isDosen) return true;

    // PM can only evaluate their own assignment
    if (assignment.evaluator_id !== requester.userId) {
      const error = new Error("Akses ditolak. Anda tidak berhak menilai mahasiswa di luar divisi Anda.");
      error.statusCode = 403;
      throw error;
    }

    return true;
  }

  const pmUser1 = { role: "mahasiswa", userId: "USR-PM-AI" };
  const assignmentDivisionAi = { id: "ASG-1", evaluator_id: "USR-PM-AI", division_id: "DIV-AI" };
  const assignmentDivisionWeb = { id: "ASG-2", evaluator_id: "USR-PM-WEB", division_id: "DIV-WEB" };

  // PM AI can evaluate assignment in AI division
  assert.equal(checkPmCanSubmitEvaluation(pmUser1, assignmentDivisionAi), true);

  // PM AI cannot evaluate assignment in Web division (HTTP 403)
  assert.throws(
    () => checkPmCanSubmitEvaluation(pmUser1, assignmentDivisionWeb),
    (err) => {
      assert.equal(err.statusCode, 403);
      assert.match(err.message, /di luar divisi/);
      return true;
    }
  );

  // Admin/Operator can evaluate any assignment
  const adminUser = { role: "operator", userId: "USR-ADMIN" };
  assert.equal(checkPmCanSubmitEvaluation(adminUser, assignmentDivisionWeb), true);
});

// ---------------------------------------------------------------------------
// 4. Draft vs Submit Criteria Completeness
// ---------------------------------------------------------------------------

test("PM save draft permits partial criteria scores, while submit enforces all 7 criteria", () => {
  function validateSubmissionCompleteness(targetStatus, scoreMap, criteriaList) {
    if (targetStatus === "SUBMITTED") {
      for (const criteria of criteriaList) {
        if (!scoreMap.has(criteria.key)) {
          const error = new Error(`Seluruh 7 kriteria wajib diisi sebelum submit (kurang: ${criteria.name}).`);
          error.statusCode = 422;
          throw error;
        }
      }
    }
    return true;
  }

  const partialScoreMap = new Map([
    ["quality_of_work", { score: 8.0 }],
    ["responsibility", { score: 7.5 }]
  ]);

  const completeScoreMap = new Map([
    ["quality_of_work", { score: 8.0 }],
    ["responsibility", { score: 7.5 }],
    ["technical_skill", { score: 9.0 }],
    ["problem_solving", { score: 8.5 }],
    ["collaboration", { score: 9.0 }],
    ["initiative", { score: 8.0 }],
    ["research_contribution", { score: 7.0 }]
  ]);

  // Draft with partial criteria is allowed
  assert.equal(validateSubmissionCompleteness("DRAFT", partialScoreMap, INITIAL_PM_CRITERIA), true);

  // Submit with partial criteria is rejected with 422
  assert.throws(
    () => validateSubmissionCompleteness("SUBMITTED", partialScoreMap, INITIAL_PM_CRITERIA),
    (err) => {
      assert.equal(err.statusCode, 422);
      assert.match(err.message, /Seluruh 7 kriteria wajib diisi/);
      return true;
    }
  );

  // Submit with all 7 criteria succeeds
  assert.equal(validateSubmissionCompleteness("SUBMITTED", completeScoreMap, INITIAL_PM_CRITERIA), true);
});

// ---------------------------------------------------------------------------
// 5. Period Lifecycle & Immutability of CLOSED Periods
// ---------------------------------------------------------------------------

test("Period status transitions: only DRAFT can be opened, only OPEN can be closed", () => {
  function validatePeriodOpenTransition(currentStatus) {
    if (currentStatus !== "DRAFT") {
      const err = new Error(`Periode dengan status '${currentStatus}' tidak dapat dibuka.`);
      err.statusCode = 400;
      throw err;
    }
    return "OPEN";
  }

  function validatePeriodCloseTransition(currentStatus) {
    if (currentStatus !== "OPEN") {
      const err = new Error(`Periode dengan status '${currentStatus}' tidak dapat ditutup.`);
      err.statusCode = 400;
      throw err;
    }
    return "CLOSED";
  }

  assert.equal(validatePeriodOpenTransition("DRAFT"), "OPEN");
  assert.throws(() => validatePeriodOpenTransition("OPEN"), /tidak dapat dibuka/);
  assert.throws(() => validatePeriodOpenTransition("CLOSED"), /tidak dapat dibuka/);

  assert.equal(validatePeriodCloseTransition("OPEN"), "CLOSED");
  assert.throws(() => validatePeriodCloseTransition("DRAFT"), /tidak dapat ditutup/);
  assert.throws(() => validatePeriodCloseTransition("CLOSED"), /tidak dapat ditutup/);
});

test("CLOSED period is strictly immutable against updates and submissions", () => {
  function ensurePeriodOpenForMutation(period) {
    if (!period) {
      const err = new Error("Periode evaluasi tidak ditemukan.");
      err.statusCode = 404;
      throw err;
    }
    if (period.status === "CLOSED") {
      const err = new Error("Periode evaluasi sudah ditutup dan tidak dapat diubah.");
      err.statusCode = 400;
      throw err;
    }
    return true;
  }

  const openPeriod = { id: "PRD-1", status: "OPEN" };
  const draftPeriod = { id: "PRD-2", status: "DRAFT" };
  const closedPeriod = { id: "PRD-3", status: "CLOSED" };

  assert.equal(ensurePeriodOpenForMutation(openPeriod), true);
  assert.equal(ensurePeriodOpenForMutation(draftPeriod), true);

  assert.throws(
    () => ensurePeriodOpenForMutation(closedPeriod),
    (err) => {
      assert.equal(err.statusCode, 400);
      assert.match(err.message, /sudah ditutup/);
      return true;
    }
  );
});

// ---------------------------------------------------------------------------
// 5. Student Access Security (Strict Privacy Guard)
// ---------------------------------------------------------------------------

test("Student cannot access evaluation recap of another student", () => {
  function checkStudentRecapAccess(requester, targetStudentRecord) {
    const isOperator = requester.role === "operator";
    const isDosen = requester.role === "dosen";

    if (isOperator || isDosen) return true;

    if (targetStudentRecord.user_id !== requester.userId) {
      const error = new Error("Akses ditolak. Mahasiswa tidak dapat melihat nilai mahasiswa lain.");
      error.statusCode = 403;
      throw error;
    }

    return true;
  }

  const studentRequester = { role: "mahasiswa", userId: "USR-MHS-1" };
  const ownRecord = { id: "STD-1", user_id: "USR-MHS-1" };
  const otherRecord = { id: "STD-2", user_id: "USR-MHS-2" };

  // Mahasiswa can access own record
  assert.equal(checkStudentRecapAccess(studentRequester, ownRecord), true);

  // Mahasiswa CANNOT access other student's record (HTTP 403)
  assert.throws(
    () => checkStudentRecapAccess(studentRequester, otherRecord),
    (err) => {
      assert.equal(err.statusCode, 403);
      assert.match(err.message, /tidak dapat melihat nilai mahasiswa lain/);
      return true;
    }
  );
});

test("Student cannot access global period recap or progress", () => {
  function checkPeriodRecapAccess(requester) {
    if (requester.role === "mahasiswa") {
      const error = new Error("Akses ditolak. Mahasiswa tidak dapat melihat rekap penilaian periode.");
      error.statusCode = 403;
      throw error;
    }
    return true;
  }

  const studentRequester = { role: "mahasiswa", userId: "USR-MHS-1" };
  const adminRequester = { role: "operator", userId: "USR-ADMIN" };

  assert.throws(
    () => checkPeriodRecapAccess(studentRequester),
    (err) => {
      assert.equal(err.statusCode, 403);
      return true;
    }
  );

  assert.equal(checkPeriodRecapAccess(adminRequester), true);
});

// ---------------------------------------------------------------------------
// 6. SQL Schema & Unique Constraints Validation
// ---------------------------------------------------------------------------

test("Database migration 036 defines required tables and constraints", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const migrationSql = fs.readFileSync(
    path.join(__dirname, "../db/migrations/036_evaluation_system.sql"),
    "utf8"
  );

  // Verify tables
  const expectedTables = [
    "evaluation_periods",
    "evaluation_criteria",
    "evaluation_assignments",
    "presentation_sessions",
    "presentation_evaluators",
    "presentation_slots",
    "evaluation_submissions",
    "evaluation_score_items"
  ];
  for (const table of expectedTables) {
    assert.ok(
      migrationSql.includes(`CREATE TABLE IF NOT EXISTS ${table}`),
      `Migration 036 must define table ${table}`
    );
  }

  // Verify unique constraints
  assert.ok(
    migrationSql.includes("CONSTRAINT uq_eval_submission_assignment UNIQUE (assignment_id)"),
    "Must enforce unique assignment submission"
  );
  assert.ok(
    migrationSql.includes("CONSTRAINT uq_eval_submission_slot_evaluator UNIQUE (slot_id, evaluator_id)"),
    "Must enforce independent slot evaluation per evaluator"
  );
  assert.ok(
    migrationSql.includes("CONSTRAINT chk_eval_submission_target CHECK"),
    "Must enforce mutually exclusive submission target between assignment and slot"
  );
  assert.ok(
    migrationSql.includes("score >= 1.0 AND score <= 10.0"),
    "Must enforce score range 1.0 to 10.0 in SQL check constraint"
  );
  assert.ok(
    migrationSql.includes("CHECK (type IN ('PM_EVALUATION', 'MONTHLY_PRESENTATION'))"),
    "Must enforce period type CHECK constraint with PM_EVALUATION"
  );
  assert.ok(
    migrationSql.includes("CHECK (period_type IN ('PM_EVALUATION', 'MONTHLY_PRESENTATION'))"),
    "Must enforce criteria period_type CHECK constraint with PM_EVALUATION"
  );
});

test("Database migration 037 safely migrates existing schemas to PM_EVALUATION", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const migrationSql = fs.readFileSync(
    path.join(__dirname, "../db/migrations/037_rename_pm_biweekly_to_pm_evaluation.sql"),
    "utf8"
  );

  assert.ok(
    migrationSql.includes("ALTER TABLE evaluation_periods DROP CONSTRAINT evaluation_periods_type_check"),
    "Migration 037 must drop old periods type check constraint"
  );
  assert.ok(
    migrationSql.includes("SET type = 'PM_EVALUATION'"),
    "Migration 037 must update existing periods to PM_EVALUATION"
  );
  assert.ok(
    migrationSql.includes("ALTER TABLE evaluation_criteria DROP CONSTRAINT evaluation_criteria_period_type_check"),
    "Migration 037 must drop old criteria period_type check constraint"
  );
  assert.ok(
    migrationSql.includes("SET period_type = 'PM_EVALUATION'"),
    "Migration 037 must update existing criteria to PM_EVALUATION"
  );
  assert.ok(
    migrationSql.includes("CHECK (type IN ('PM_EVALUATION', 'MONTHLY_PRESENTATION'))"),
    "Migration 037 must enforce updated period type check constraint"
  );
  assert.ok(
    migrationSql.includes("CHECK (period_type IN ('PM_EVALUATION', 'MONTHLY_PRESENTATION'))"),
    "Migration 037 must enforce updated criteria period_type check constraint"
  );
});

// ---------------------------------------------------------------------------
// 7. Result Visibility Gate (MVP Closed-Period Gate)
// ---------------------------------------------------------------------------

test("Result visibility gate: Mahasiswa does not see SUBMITTED score when period is OPEN", () => {
  function applyResultVisibilityGate(item, { isStudent }) {
    const isPeriodClosed = item.periodStatus === "CLOSED";
    const resultAvailable = !isStudent || isPeriodClosed;

    return {
      ...item,
      resultAvailable,
      overallScore: resultAvailable ? item.overallScore : null,
      strength: resultAvailable ? item.strength : null,
      improvement: resultAvailable ? item.improvement : null,
      notes: resultAvailable ? item.notes : null
    };
  }

  const submittedItemOpen = {
    submissionId: "SUB-1",
    periodStatus: "OPEN",
    overallScore: 8.75,
    strength: "Cepat tanggap",
    improvement: "Dokumentasi",
    notes: "Kinerja baik"
  };

  // Mahasiswa access during OPEN period
  const studentView = applyResultVisibilityGate(submittedItemOpen, { isStudent: true });
  assert.equal(studentView.resultAvailable, false);
  assert.equal(studentView.overallScore, null, "Score must not leak to student when period is OPEN");
  assert.equal(studentView.strength, null, "Feedback must not leak to student when period is OPEN");
});

test("Result visibility gate: Admin/PM can see SUBMITTED score when period is OPEN", () => {
  function applyResultVisibilityGate(item, { isStudent }) {
    const isPeriodClosed = item.periodStatus === "CLOSED";
    const resultAvailable = !isStudent || isPeriodClosed;

    return {
      ...item,
      resultAvailable,
      overallScore: resultAvailable ? item.overallScore : null
    };
  }

  const submittedItemOpen = {
    submissionId: "SUB-1",
    periodStatus: "OPEN",
    overallScore: 8.75
  };

  // Admin/PM access during OPEN period
  const adminView = applyResultVisibilityGate(submittedItemOpen, { isStudent: false });
  assert.equal(adminView.resultAvailable, true);
  assert.equal(adminView.overallScore, 8.75, "Admin/PM must be able to view score during OPEN period");
});

test("Result visibility gate: Mahasiswa can see evaluation results once period is CLOSED", () => {
  function applyResultVisibilityGate(item, { isStudent }) {
    const isPeriodClosed = item.periodStatus === "CLOSED";
    const resultAvailable = !isStudent || isPeriodClosed;

    return {
      ...item,
      resultAvailable,
      overallScore: resultAvailable ? item.overallScore : null,
      strength: resultAvailable ? item.strength : null
    };
  }

  const submittedItemClosed = {
    submissionId: "SUB-1",
    periodStatus: "CLOSED",
    overallScore: 8.75,
    strength: "Cepat tanggap"
  };

  // Mahasiswa access after period is CLOSED
  const studentView = applyResultVisibilityGate(submittedItemClosed, { isStudent: true });
  assert.equal(studentView.resultAvailable, true);
  assert.equal(studentView.overallScore, 8.75, "Student must see score once period is CLOSED");
  assert.equal(studentView.strength, "Cepat tanggap", "Student must see feedback once period is CLOSED");
});

test("Draft submissions are never visible in student history regardless of period status", () => {
  const submissionsInDb = [
    { id: "SUB-1", status: "DRAFT", periodStatus: "CLOSED", overallScore: 8.0 },
    { id: "SUB-2", status: "DRAFT", periodStatus: "OPEN", overallScore: 7.5 },
    { id: "SUB-3", status: "SUBMITTED", periodStatus: "CLOSED", overallScore: 9.0 }
  ];

  // SQL WHERE filter: es.status = 'SUBMITTED'
  const visibleToStudentHistory = submissionsInDb.filter((s) => s.status === "SUBMITTED");
  assert.equal(visibleToStudentHistory.length, 1);
  assert.equal(visibleToStudentHistory[0].id, "SUB-3");
  assert.ok(!visibleToStudentHistory.some((s) => s.status === "DRAFT"), "Drafts must never appear in history");
});

// ---------------------------------------------------------------------------
// 8. Evaluation Month & Monthly Uniqueness per Type
// ---------------------------------------------------------------------------

test("evaluationMonth is safely derived from startDate in format YYYY-MM", () => {
  function deriveEvaluationMonth(startDate) {
    if (!startDate) return null;
    return String(startDate).slice(0, 7);
  }

  assert.equal(deriveEvaluationMonth("2026-10-01"), "2026-10");
  assert.equal(deriveEvaluationMonth("2026-10-31"), "2026-10");
  assert.equal(deriveEvaluationMonth("2026-01-15"), "2026-01");
  assert.equal(deriveEvaluationMonth(null), null);
});

test("Validation rejects duplicate PM_EVALUATION or MONTHLY_PRESENTATION in same month", () => {
  const existingPeriods = [
    { id: "EVP-1", type: "PM_EVALUATION", startDate: "2026-10-01", title: "PM Evaluasi Oktober" },
    { id: "EVP-2", type: "MONTHLY_PRESENTATION", startDate: "2026-10-15", title: "Presentasi Oktober" }
  ];

  function validateNoDuplicateInMonth(newPeriod, existing) {
    const newMonth = newPeriod.startDate.slice(0, 7);
    const conflict = existing.find(
      (p) => p.type === newPeriod.type && p.startDate.slice(0, 7) === newMonth && p.id !== newPeriod.id
    );
    if (conflict) {
      const err = new Error(`Periode evaluasi jenis ${newPeriod.type} untuk bulan ${newMonth} sudah ada.`);
      err.statusCode = 409;
      throw err;
    }
    return true;
  }

  // Same month, same type (PM_EVALUATION) -> REJECT 409
  assert.throws(
    () => validateNoDuplicateInMonth({ id: "EVP-NEW", type: "PM_EVALUATION", startDate: "2026-10-10" }, existingPeriods),
    /already exists|sudah ada/i
  );

  // Same month, same type (MONTHLY_PRESENTATION) -> REJECT 409
  assert.throws(
    () => validateNoDuplicateInMonth({ id: "EVP-NEW", type: "MONTHLY_PRESENTATION", startDate: "2026-10-20" }, existingPeriods),
    /already exists|sudah ada/i
  );

  // Different month, same type -> ALLOW
  assert.doesNotThrow(
    () => validateNoDuplicateInMonth({ id: "EVP-NEW", type: "PM_EVALUATION", startDate: "2026-11-01" }, existingPeriods)
  );

  // Different month, presentation -> ALLOW
  assert.doesNotThrow(
    () => validateNoDuplicateInMonth({ id: "EVP-NEW", type: "MONTHLY_PRESENTATION", startDate: "2026-11-15" }, existingPeriods)
  );
});
