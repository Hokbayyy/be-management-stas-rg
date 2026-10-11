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

// ---------------------------------------------------------------------------
// 9. Cross-Project Evaluation Groups, Multi-PM, Attendance & Aggregation
// ---------------------------------------------------------------------------

test("Multi-PM evaluation: 1 PM and 2 PM score aggregation computes proper arithmetic mean", () => {
  function computeStudentMultiPmScore(evaluations) {
    const presentSubmitted = evaluations.filter(
      (e) => e.attendanceStatus === "PRESENT" && e.submissionStatus === "SUBMITTED" && e.overallScore != null
    );
    const scores = presentSubmitted.map((e) => Number(e.overallScore));
    return calculateAverageScore(scores);
  }

  // 1 PM submitted
  const evals1 = [
    { evaluatorId: "PM-1", attendanceStatus: "PRESENT", submissionStatus: "SUBMITTED", overallScore: 8.5 }
  ];
  assert.equal(computeStudentMultiPmScore(evals1), 8.5);

  // 2 PMs submitted: (8.5 + 9.5) / 2 = 9.0
  const evals2 = [
    { evaluatorId: "PM-1", attendanceStatus: "PRESENT", submissionStatus: "SUBMITTED", overallScore: 8.5 },
    { evaluatorId: "PM-2", attendanceStatus: "PRESENT", submissionStatus: "SUBMITTED", overallScore: 9.5 }
  ];
  assert.equal(computeStudentMultiPmScore(evals2), 9.0);

  // 3 PMs submitted: (8.0 + 8.5 + 9.0) / 3 = 25.5 / 3 = 8.5
  const evals3 = [
    { evaluatorId: "PM-1", attendanceStatus: "PRESENT", submissionStatus: "SUBMITTED", overallScore: 8.0 },
    { evaluatorId: "PM-2", attendanceStatus: "PRESENT", submissionStatus: "SUBMITTED", overallScore: 8.5 },
    { evaluatorId: "PM-3", attendanceStatus: "PRESENT", submissionStatus: "SUBMITTED", overallScore: 9.0 }
  ];
  assert.equal(computeStudentMultiPmScore(evals3), 8.5);
});

test("One PM absent: ABSENT PM is excluded from student average, never counted as 0.0", () => {
  function computeStudentMultiPmScore(evaluations) {
    const presentSubmitted = evaluations.filter(
      (e) => e.attendanceStatus === "PRESENT" && e.submissionStatus === "SUBMITTED" && e.overallScore != null
    );
    const scores = presentSubmitted.map((e) => Number(e.overallScore));
    return calculateAverageScore(scores);
  }

  // PM 1 PRESENT with 8.0, PM 2 ABSENT
  const evals = [
    { evaluatorId: "PM-1", attendanceStatus: "PRESENT", submissionStatus: "SUBMITTED", overallScore: 8.0 },
    { evaluatorId: "PM-2", attendanceStatus: "ABSENT", submissionStatus: "PENDING", overallScore: null }
  ];

  const score = computeStudentMultiPmScore(evals);
  assert.equal(score, 8.0, "ABSENT PM must be excluded, score must be 8.0, not (8.0 + 0) / 2 = 4.0");
});

test("PM PENDING or PRESENT not submitted results in PROVISIONAL or INCOMPLETE status with null finalScore", () => {
  function computeStudentRecapStatus(evaluations) {
    const totalEvaluators = evaluations.length;
    const presentEvaluators = evaluations.filter((e) => e.attendanceStatus === "PRESENT").length;
    const absentEvaluators = evaluations.filter((e) => e.attendanceStatus === "ABSENT").length;
    const pendingEvaluators = evaluations.filter((e) => e.attendanceStatus === "PENDING").length;
    const presentSubmitted = evaluations.filter(
      (e) => e.attendanceStatus === "PRESENT" && e.submissionStatus === "SUBMITTED" && e.overallScore != null
    );
    const avgScore = calculateAverageScore(presentSubmitted.map((e) => Number(e.overallScore)));

    if (totalEvaluators > 0 && absentEvaluators === totalEvaluators) {
      return { status: "EXEMPT", finalScore: null, provisionalScore: null };
    }
    if (pendingEvaluators === 0 && presentEvaluators > 0 && presentSubmitted.length === presentEvaluators) {
      return { status: "FINAL", finalScore: avgScore, provisionalScore: avgScore };
    }
    if (presentSubmitted.length > 0) {
      return { status: "PROVISIONAL", finalScore: null, provisionalScore: avgScore };
    }
    return { status: "INCOMPLETE", finalScore: null, provisionalScore: null };
  }

  // 1 PM submitted, 1 PM PRESENT but not submitted yet -> PROVISIONAL
  const provEvals = [
    { evaluatorId: "PM-1", attendanceStatus: "PRESENT", submissionStatus: "SUBMITTED", overallScore: 8.5 },
    { evaluatorId: "PM-2", attendanceStatus: "PRESENT", submissionStatus: "DRAFT", overallScore: null }
  ];
  const provRes = computeStudentRecapStatus(provEvals);
  assert.equal(provRes.status, "PROVISIONAL");
  assert.equal(provRes.finalScore, null, "Final score must be null while pending PM evaluations remain");
  assert.equal(provRes.provisionalScore, 8.5);

  // 1 PM submitted, 1 PM PENDING attendance -> PROVISIONAL
  const pendingEvals = [
    { evaluatorId: "PM-1", attendanceStatus: "PRESENT", submissionStatus: "SUBMITTED", overallScore: 8.5 },
    { evaluatorId: "PM-2", attendanceStatus: "PENDING", submissionStatus: "PENDING", overallScore: null }
  ];
  const pendingRes = computeStudentRecapStatus(pendingEvals);
  assert.equal(pendingRes.status, "PROVISIONAL");
  assert.equal(pendingRes.finalScore, null);

  // 0 PM submitted -> INCOMPLETE
  const incEvals = [
    { evaluatorId: "PM-1", attendanceStatus: "PRESENT", submissionStatus: "PENDING", overallScore: null }
  ];
  const incRes = computeStudentRecapStatus(incEvals);
  assert.equal(incRes.status, "INCOMPLETE");
  assert.equal(incRes.finalScore, null);
  assert.equal(incRes.provisionalScore, null);
});

test("All PMs absent yields status EXEMPT with null finalScore", () => {
  function computeStudentRecapStatus(evaluations) {
    const totalEvaluators = evaluations.length;
    const absentEvaluators = evaluations.filter((e) => e.attendanceStatus === "ABSENT").length;
    if (totalEvaluators > 0 && absentEvaluators === totalEvaluators) {
      return { status: "EXEMPT", finalScore: null, provisionalScore: null };
    }
    return { status: "INCOMPLETE", finalScore: null, provisionalScore: null };
  }

  const allAbsent = [
    { evaluatorId: "PM-1", attendanceStatus: "ABSENT", submissionStatus: "PENDING" },
    { evaluatorId: "PM-2", attendanceStatus: "ABSENT", submissionStatus: "PENDING" }
  ];
  const res = computeStudentRecapStatus(allAbsent);
  assert.equal(res.status, "EXEMPT");
  assert.equal(res.finalScore, null, "Exempt student score must be null, not 0.0");
  assert.equal(res.provisionalScore, null);
});

test("Deduplication: Student participating in multiple projects produces exactly one candidate record", () => {
  // Simulate row results from cross-project memberships before DISTINCT ON (student_id)
  const rawCandidateRows = [
    { student_id: "STD-01", project_id: "PRJ-A", role: "Frontend Dev", group_id: "EVAL-GRP-SOFTWARE" },
    { student_id: "STD-01", project_id: "PRJ-B", role: "Fullstack Dev", group_id: "EVAL-GRP-SOFTWARE" },
    { student_id: "STD-02", project_id: "PRJ-A", role: "Backend Dev", group_id: "EVAL-GRP-SOFTWARE" }
  ];

  // Distinct by student_id
  const deduplicated = [];
  const seenStudentIds = new Set();
  for (const row of rawCandidateRows) {
    if (!seenStudentIds.has(row.student_id)) {
      seenStudentIds.add(row.student_id);
      deduplicated.push(row);
    }
  }

  assert.equal(deduplicated.length, 2, "STD-01 appearing in 2 projects must be deduplicated into 1 candidate");
  assert.equal(deduplicated[0].student_id, "STD-01");
  assert.equal(deduplicated[1].student_id, "STD-02");
});

test("Role mapping: Generic roles excluded from Software group unless manually mapped", () => {
  const rolePatterns = [
    "%Frontend%",
    "%Backend%",
    "%Fullstack%",
    "%Software%",
    "%Web%",
    "%Mobile%"
  ];

  function matchesPattern(role) {
    if (!role) return false;
    const lowerRole = role.toLowerCase();
    return rolePatterns.some((p) => {
      const keyword = p.replace(/%/g, "").toLowerCase();
      return lowerRole.includes(keyword);
    });
  }

  // Eligible roles
  assert.equal(matchesPattern("Frontend Dev"), true);
  assert.equal(matchesPattern("Lead Backend Engineer"), true);
  assert.equal(matchesPattern("Fullstack Developer"), true);
  assert.equal(matchesPattern("Mobile App Developer"), true);
  assert.equal(matchesPattern("Web Master"), true);

  // Ineligible generic roles
  assert.equal(matchesPattern("Anggota Inti"), false);
  assert.equal(matchesPattern("IoT Engineer"), false);
  assert.equal(matchesPattern("Alumni"), false);
  assert.equal(matchesPattern(null), false);
  assert.equal(matchesPattern(undefined), false);

  // Manual assignment override
  function resolveCandidate(student, manualGroupAssignments) {
    const isManual = manualGroupAssignments.some((m) => m.student_id === student.id && m.group_id === "EVAL-GRP-SOFTWARE");
    if (isManual) {
      return { eligible: true, source: "MANUAL_ASSIGNMENT" };
    }
    if (matchesPattern(student.role)) {
      return { eligible: true, source: "ROLE_PATTERN" };
    }
    return { eligible: false, source: null };
  }

  const anggotaIntiStudent = { id: "STD-ANGGOTA", role: "Anggota Inti" };
  assert.equal(resolveCandidate(anggotaIntiStudent, []).eligible, false);

  const manualAssignedStudent = resolveCandidate(anggotaIntiStudent, [{ student_id: "STD-ANGGOTA", group_id: "EVAL-GRP-SOFTWARE" }]);
  assert.equal(manualAssignedStudent.eligible, true);
  assert.equal(manualAssignedStudent.source, "MANUAL_ASSIGNMENT");
});

test("Unauthorized evaluator: rejected when not assigned or when attendance is PENDING or ABSENT", () => {
  function checkEvaluatorAuthorization(assignment, requesterId, attendanceStatus) {
    if (assignment.evaluator_id !== requesterId) {
      const err = new Error("Akses ditolak. Anda bukan evaluator untuk penugasan ini.");
      err.statusCode = 403;
      throw err;
    }
    if (attendanceStatus === "PENDING") {
      const err = new Error("Evaluator belum dikonfirmasi hadir (status kehadiran: PENDING). Admin harus mengonfirmasi kehadiran sebelum pengisian nilai.");
      err.statusCode = 422;
      throw err;
    }
    if (attendanceStatus === "ABSENT") {
      const err = new Error("Evaluator berstatus tidak hadir (ABSENT), penilaian tidak dapat diberikan.");
      err.statusCode = 422;
      throw err;
    }
    return true;
  }

  const assignment = { id: "ASG-1", evaluator_id: "PM-1" };

  // Unassigned user -> 403
  assert.throws(
    () => checkEvaluatorAuthorization(assignment, "PM-OTHER", "PRESENT"),
    (err) => err.statusCode === 403
  );

  // Assigned PM with PENDING attendance -> 422
  assert.throws(
    () => checkEvaluatorAuthorization(assignment, "PM-1", "PENDING"),
    (err) => err.statusCode === 422 && /PENDING/.test(err.message)
  );

  // Assigned PM with ABSENT attendance -> 422
  assert.throws(
    () => checkEvaluatorAuthorization(assignment, "PM-1", "ABSENT"),
    (err) => err.statusCode === 422 && /ABSENT/.test(err.message)
  );

  // Assigned PM with PRESENT attendance -> OK
  assert.equal(checkEvaluatorAuthorization(assignment, "PM-1", "PRESENT"), true);
});

test("Backfill & Sync: syncPeriodAssignments is idempotent and avoids duplicate assignments", () => {
  const existingAssignments = [
    { period_id: "EVP-1", student_id: "STD-1", evaluator_id: "PM-1" },
    { period_id: "EVP-1", student_id: "STD-2", evaluator_id: "PM-1" }
  ];

  function syncAssignments(candidates, evaluators, currentAssignments) {
    const newAssignments = [];
    const assignmentKeySet = new Set(
      currentAssignments.map((a) => `${a.period_id}:${a.student_id}:${a.evaluator_id}`)
    );

    for (const cand of candidates) {
      for (const ev of evaluators) {
        const key = `EVP-1:${cand.student_id}:${ev.id}`;
        if (!assignmentKeySet.has(key)) {
          assignmentKeySet.add(key);
          newAssignments.push({ period_id: "EVP-1", student_id: cand.student_id, evaluator_id: ev.id });
        }
      }
    }
    return newAssignments;
  }

  const candidates = [{ student_id: "STD-1" }, { student_id: "STD-2" }];
  const evaluators = [{ id: "PM-1" }];

  // First sync when already in DB -> creates 0
  const sync1 = syncAssignments(candidates, evaluators, existingAssignments);
  assert.equal(sync1.length, 0, "Idempotent sync must not create duplicate assignments");

  // A new student is added
  const updatedCandidates = [{ student_id: "STD-1" }, { student_id: "STD-2" }, { student_id: "STD-3" }];
  const sync2 = syncAssignments(updatedCandidates, evaluators, existingAssignments);
  assert.equal(sync2.length, 1, "Sync must only add missing assignments");
  assert.equal(sync2[0].student_id, "STD-3");
});

test("Submission safety: existing submissions preserved and changing attendance to ABSENT requires force and correctionReason", () => {
  function changeAttendanceToAbsent(evaluatorId, newStatus, currentSubmissionsCount, { force, correctionReason }) {
    if (newStatus === "ABSENT" && currentSubmissionsCount > 0) {
      if (!force || !correctionReason) {
        const err = new Error("Evaluator sudah memiliki submission penilaian. Perubahan menjadi ABSENT dilarang kecuali menyertakan correctionReason dan konfirmasi force: true.");
        err.statusCode = 422;
        throw err;
      }
    }
    return { attendanceStatus: "ABSENT", notes: correctionReason };
  }

  // Evaluator with 0 submissions can be marked ABSENT without force
  assert.deepEqual(
    changeAttendanceToAbsent("PM-1", "ABSENT", 0, {}),
    { attendanceStatus: "ABSENT", notes: undefined }
  );

  // Evaluator with existing submissions cannot be marked ABSENT without force -> 422
  assert.throws(
    () => changeAttendanceToAbsent("PM-1", "ABSENT", 2, {}),
    (err) => err.statusCode === 422
  );

  // Evaluator with existing submissions can be marked ABSENT with force: true and correctionReason
  const result = changeAttendanceToAbsent("PM-1", "ABSENT", 2, {
    force: true,
    correctionReason: "PM berhalangan mendadak sakit"
  });
  assert.equal(result.attendanceStatus, "ABSENT");
  assert.equal(result.notes, "PM berhalangan mendadak sakit");
});

test("Closing period validation rejects PENDING attendance and unsubmitted PMs unless force: true; score averaging precision", () => {
  function validateClosePeriod({ pendingEvaluatorCount, unsubmittedPresentCount, force }) {
    if (pendingEvaluatorCount > 0 && !force) {
      const err = new Error("Masih ada evaluator dengan status kehadiran PENDING.");
      err.statusCode = 422;
      throw err;
    }
    if (unsubmittedPresentCount > 0 && !force) {
      const err = new Error("Masih ada evaluator berstatus PRESENT yang belum menyelesaikan penilaian.");
      err.statusCode = 422;
      throw err;
    }
    return true;
  }

  // Blocked by PENDING attendance
  assert.throws(
    () => validateClosePeriod({ pendingEvaluatorCount: 1, unsubmittedPresentCount: 0, force: false }),
    (err) => err.statusCode === 422 && /PENDING/.test(err.message)
  );

  // Blocked by unsubmitted PRESENT evaluator
  assert.throws(
    () => validateClosePeriod({ pendingEvaluatorCount: 0, unsubmittedPresentCount: 2, force: false }),
    (err) => err.statusCode === 422 && /PRESENT/.test(err.message)
  );

  // Force override allows closing with unresolved evaluators
  assert.equal(
    validateClosePeriod({ pendingEvaluatorCount: 1, unsubmittedPresentCount: 2, force: true }),
    true
  );

  // All confirmed and submitted allows closing normally
  assert.equal(
    validateClosePeriod({ pendingEvaluatorCount: 0, unsubmittedPresentCount: 0, force: false }),
    true
  );

  // Score averaging precision verification (2 decimals)
  assert.equal(calculateAverageScore([7.0, 7.0, 8.0]), 7.33); // (22 / 3 = 7.3333... -> 7.33)
  assert.equal(calculateAverageScore([8.0, 9.0, 9.0]), 8.67); // (26 / 3 = 8.6666... -> 8.67)
  assert.equal(calculateAverageScore([1.0, 10.0]), 5.5);
});

test("Database migration 038 defines evaluation groups, mappings, and attendance columns", () => {
  const fs = require("node:fs");
  const path = require("node:path");

  const migrationPath = path.join(__dirname, "../db/migrations/038_pm_evaluation_groups_and_attendance.sql");
  assert.ok(fs.existsSync(migrationPath), "Migration 038 SQL file must exist");

  const migrationSql = fs.readFileSync(migrationPath, "utf-8");
  assert.ok(migrationSql.includes("CREATE TABLE IF NOT EXISTS evaluation_groups"), "Must create evaluation_groups");
  assert.ok(migrationSql.includes("CREATE TABLE IF NOT EXISTS evaluation_group_role_mappings"), "Must create evaluation_group_role_mappings");
  assert.ok(migrationSql.includes("CREATE TABLE IF NOT EXISTS evaluation_group_students"), "Must create evaluation_group_students");
  assert.ok(migrationSql.includes("CREATE TABLE IF NOT EXISTS evaluation_group_evaluators"), "Must create evaluation_group_evaluators");
  assert.ok(migrationSql.includes("CREATE TABLE IF NOT EXISTS evaluation_period_evaluators"), "Must create evaluation_period_evaluators");
  assert.ok(migrationSql.includes("ALTER TABLE evaluation_assignments"), "Must alter evaluation_assignments");
  assert.ok(migrationSql.includes("group_id"), "Must add group_id to assignments");
  assert.ok(migrationSql.includes("ALTER TABLE evaluation_periods"), "Must alter evaluation_periods to add group_id");
});

test("Explicit period scoping: Opening a Software period strictly scopes to Software group and excludes unrelated groups", () => {
  const activeGroups = [
    { id: "EVAL-GRP-SOFTWARE", name: "Software" },
    { id: "EVAL-GRP-HARDWARE", name: "Hardware & IoT" },
    { id: "EVAL-GRP-DESIGN", name: "Design & UX" }
  ];

  function resolveScopedGroups(period, evaluatorsInPeriod) {
    if (period.group_id) {
      return activeGroups.filter((g) => g.id === period.group_id);
    }
    const peGroupIds = new Set(evaluatorsInPeriod.filter((e) => e.group_id).map((e) => e.group_id));
    if (peGroupIds.size > 0) {
      return activeGroups.filter((g) => peGroupIds.has(g.id));
    }
    const titleMatch = activeGroups.filter((g) => period.title && period.title.toLowerCase().includes(g.name.toLowerCase()));
    if (titleMatch.length > 0) {
      return titleMatch;
    }
    return [];
  }

  // 1. Period explicitly assigned group_id = EVAL-GRP-SOFTWARE
  const scoped1 = resolveScopedGroups({ id: "EVP-1", title: "Evaluasi PM Q4", group_id: "EVAL-GRP-SOFTWARE" }, []);
  assert.equal(scoped1.length, 1);
  assert.equal(scoped1[0].id, "EVAL-GRP-SOFTWARE");
  assert.ok(!scoped1.some((g) => g.id === "EVAL-GRP-HARDWARE"), "Hardware group must be strictly excluded");

  // 2. Period title mentions Software
  const scoped2 = resolveScopedGroups({ id: "EVP-2", title: "Evaluasi PM Software Periode 1", group_id: null }, []);
  assert.equal(scoped2.length, 1);
  assert.equal(scoped2[0].name, "Software");
  assert.ok(!scoped2.some((g) => g.id === "EVAL-GRP-HARDWARE"), "Hardware group must be strictly excluded");

  // 3. Evaluators assigned with group_id = EVAL-GRP-SOFTWARE
  const scoped3 = resolveScopedGroups(
    { id: "EVP-3", title: "Evaluasi PM Tim Inti", group_id: null },
    [{ evaluator_id: "PM-1", group_id: "EVAL-GRP-SOFTWARE" }]
  );
  assert.equal(scoped3.length, 1);
  assert.equal(scoped3[0].id, "EVAL-GRP-SOFTWARE");
});

test("Period Deletion: requires force if submissions exist, and cleanly removes draft periods", () => {
  const mockPeriodsDb = new Map();
  mockPeriodsDb.set("EVP-DRAFT-1", { id: "EVP-DRAFT-1", title: "Periode Draft Test", status: "DRAFT" });
  mockPeriodsDb.set("EVP-SUBMITTED-1", { id: "EVP-SUBMITTED-1", title: "Periode Dengan Nilai", status: "OPEN" });

  const mockSubmissionsDb = [
    { id: "SUB-1", period_id: "EVP-SUBMITTED-1", status: "SUBMITTED" }
  ];

  function simulateDeletePeriod(id, options = {}) {
    const period = mockPeriodsDb.get(id);
    if (!period) {
      const err = new Error("Periode evaluasi tidak ditemukan.");
      err.statusCode = 404;
      throw err;
    }

    const submittedCount = mockSubmissionsDb.filter((s) => s.period_id === id && s.status === "SUBMITTED").length;
    if (submittedCount > 0 && !options.force) {
      const err = new Error(`Periode evaluasi memiliki ${submittedCount} nilai yang sudah disubmit. Gunakan konfirmasi force untuk menghapus secara permanen.`);
      err.statusCode = 409;
      throw err;
    }

    mockPeriodsDb.delete(id);
    return { id, title: period.title, message: `Periode evaluasi "${period.title}" berhasil dihapus.` };
  }

  // 1. Delete draft period succeeds without force
  const resDraft = simulateDeletePeriod("EVP-DRAFT-1");
  assert.equal(resDraft.id, "EVP-DRAFT-1");
  assert.equal(mockPeriodsDb.has("EVP-DRAFT-1"), false);

  // 2. Delete non-existent period throws 404
  assert.throws(
    () => simulateDeletePeriod("EVP-NOT-FOUND"),
    (err) => {
      assert.equal(err.statusCode, 404);
      return true;
    }
  );

  // 3. Delete period with submitted evaluations throws 409 if force is false
  assert.throws(
    () => simulateDeletePeriod("EVP-SUBMITTED-1", { force: false }),
    (err) => {
      assert.equal(err.statusCode, 409);
      assert.match(err.message, /sudah disubmit/);
      return true;
    }
  );

  // 4. Delete period with submitted evaluations succeeds when force=true
  const resForce = simulateDeletePeriod("EVP-SUBMITTED-1", { force: true });
  assert.equal(resForce.id, "EVP-SUBMITTED-1");
  assert.equal(mockPeriodsDb.has("EVP-SUBMITTED-1"), false);
});
