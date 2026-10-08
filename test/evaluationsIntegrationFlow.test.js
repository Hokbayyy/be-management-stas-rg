const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");

const { pool } = require("../db/pool");
const { ensureEvaluationTables } = require("../utils/evaluationService");
const evaluationsRouter = require("../routes/api/evaluations");

test("Final Integration Audit: End-to-End Evaluation Flows", async (t) => {
  // Check if DB is reachable
  try {
    await pool.query("SELECT 1");
  } catch (err) {
    t.skip(`Database is not reachable (${err.message}). Skipping database integration test.`);
    return;
  }

  // Ensure tables exist
  await ensureEvaluationTables();

  const prefix = `AUDIT-${Date.now()}`;
  const ids = {
    admin: `${prefix}-OP`,
    pmA: `${prefix}-PM-AI`,
    pmB: `${prefix}-PM-WEB`,
    mhs1: `${prefix}-MHS-1`,
    mhs2: `${prefix}-MHS-2`,
    mhs3: `${prefix}-MHS-3`,
    std1: `${prefix}-STD-1`,
    std2: `${prefix}-STD-2`,
    std3: `${prefix}-STD-3`,
    project: `${prefix}-PRJ`,
    divA: `${prefix}-DIV-AI`,
    divB: `${prefix}-DIV-WEB`
  };

  // Express Test Server
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    const roleHeader = req.headers["x-test-role"] || "operator";
    const userIdHeader = req.headers["x-test-user-id"] || ids.admin;
    req.authUser = {
      id: userIdHeader,
      role: roleHeader,
      name: `User ${userIdHeader}`
    };
    next();
  });
  app.use("/api/v1/evaluations", evaluationsRouter);

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}/api/v1/evaluations`;

  async function api(method, path, body = null, user = { id: ids.admin, role: "operator" }) {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        "x-test-user-id": user.id,
        "x-test-role": user.role
      },
      body: body ? JSON.stringify(body) : undefined
    });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text };
    }
    return { status: res.status, body: json };
  }

  const createdPeriodIds = [];

  // Clean up helper
  async function cleanup() {
    try {
      if (createdPeriodIds.length > 0) {
        await pool.query("DELETE FROM evaluation_score_items WHERE submission_id IN (SELECT id FROM evaluation_submissions WHERE period_id = ANY($1))", [createdPeriodIds]);
        await pool.query("DELETE FROM evaluation_submissions WHERE period_id = ANY($1)", [createdPeriodIds]);
        await pool.query("DELETE FROM evaluation_assignments WHERE period_id = ANY($1)", [createdPeriodIds]);
        await pool.query("DELETE FROM presentation_evaluators WHERE session_id IN (SELECT id FROM presentation_sessions WHERE period_id = ANY($1))", [createdPeriodIds]);
        await pool.query("DELETE FROM presentation_slots WHERE session_id IN (SELECT id FROM presentation_sessions WHERE period_id = ANY($1))", [createdPeriodIds]);
        await pool.query("DELETE FROM presentation_sessions WHERE period_id = ANY($1)", [createdPeriodIds]);
        await pool.query("DELETE FROM evaluation_periods WHERE id = ANY($1)", [createdPeriodIds]);
      }
      await pool.query("DELETE FROM evaluation_periods WHERE title LIKE 'Evaluasi PM%' OR title LIKE 'Evaluasi Presentasi%'");

      await pool.query("DELETE FROM research_memberships WHERE project_id = $1", [ids.project]);
      await pool.query("DELETE FROM research_divisions WHERE project_id = $1", [ids.project]);
      await pool.query("DELETE FROM research_projects WHERE id = $1", [ids.project]);

      await pool.query("DELETE FROM students WHERE id IN ($1, $2, $3)", [ids.std1, ids.std2, ids.std3]);
      await pool.query("DELETE FROM users WHERE id IN ($1, $2, $3, $4, $5, $6)", [
        ids.admin, ids.pmA, ids.pmB, ids.mhs1, ids.mhs2, ids.mhs3
      ]);
    } catch (e) {
      // ignore
    }
  }

  await cleanup();

  try {
    // -------------------------------------------------------------------------
    // 1. SEED FIXTURE
    // -------------------------------------------------------------------------
    // Users
    await pool.query(`
      INSERT INTO users (id, name, initials, role, email, is_active) VALUES
      ($1, 'Admin Audit', 'AA', 'operator', 'admin.audit@test.com', TRUE),
      ($2, 'PM Divisi AI', 'PA', 'mahasiswa', 'pm.ai@test.com', TRUE),
      ($3, 'PM Divisi Web', 'PW', 'mahasiswa', 'pm.web@test.com', TRUE),
      ($4, 'Mahasiswa 1 (AI)', 'M1', 'mahasiswa', 'mhs1@test.com', TRUE),
      ($5, 'Mahasiswa 2 (Web)', 'M2', 'mahasiswa', 'mhs2@test.com', TRUE),
      ($6, 'Mahasiswa 3 (Web)', 'M3', 'mahasiswa', 'mhs3@test.com', TRUE)
    `, [ids.admin, ids.pmA, ids.pmB, ids.mhs1, ids.mhs2, ids.mhs3]);

    // Students
    await pool.query(`
      INSERT INTO students (id, user_id, nim, status, angkatan, tipe, phone) VALUES
      ($1, $4, 'NIM-AI-01', 'Aktif', '2023', 'Riset', '08111'),
      ($2, $5, 'NIM-WEB-02', 'Aktif', '2023', 'Riset', '08222'),
      ($3, $6, 'NIM-WEB-03', 'Aktif', '2023', 'Riset', '08333')
    `, [ids.std1, ids.std2, ids.std3, ids.mhs1, ids.mhs2, ids.mhs3]);

    // Project
    await pool.query(`
      INSERT INTO research_projects (id, title, short_title, status) VALUES
      ($1, 'Audit Research Project', 'AuditPRJ', 'Aktif')
    `, [ids.project]);

    // Divisions
    await pool.query(`
      INSERT INTO research_divisions (id, project_id, name, coordinator_id, sort_order, is_active) VALUES
      ($1, $3, 'Artificial Intelligence', $4, 1, TRUE),
      ($2, $3, 'Web Development', $5, 2, TRUE)
    `, [ids.divA, ids.divB, ids.project, ids.pmA, ids.pmB]);

    // Memberships: PMs & Students
    await pool.query(`
      INSERT INTO research_memberships (project_id, user_id, member_type, peran, status, division_id) VALUES
      ($1, $2, 'Mahasiswa', 'Project Manager', 'Aktif', $4),
      ($1, $3, 'Mahasiswa', 'Project Manager', 'Aktif', $5),
      ($1, $6, 'Mahasiswa', 'Anggota', 'Aktif', $4),
      ($1, $7, 'Mahasiswa', 'Anggota', 'Aktif', $5),
      ($1, $8, 'Mahasiswa', 'Anggota', 'Aktif', $5)
    `, [ids.project, ids.pmA, ids.pmB, ids.divA, ids.divB, ids.mhs1, ids.mhs2, ids.mhs3]);

    // -------------------------------------------------------------------------
    // 2. PM_EVALUATION END-TO-END FLOW
    // -------------------------------------------------------------------------
    let pmPeriodId;
    let pmA_Assignment;
    let pmB_Assignment;

    // Step 1: Admin create DRAFT period
    {
      const res = await api("POST", "/periods", {
        title: "Evaluasi PM Bulanan Oktober",
        type: "PM_EVALUATION",
        startDate: "2026-10-01",
        endDate: "2026-10-31",
        description: "Periode evaluasi PM bulanan Oktober"
      }, { id: ids.admin, role: "operator" });

      assert.equal(res.status, 201);
      assert.equal(res.body.period.status, "DRAFT");
      assert.equal(res.body.period.type, "PM_EVALUATION");
      assert.equal(res.body.period.evaluationMonth, "2026-10");
      assert.equal(res.body.period.startDate, "2026-10-01");
      pmPeriodId = res.body.period.id;
      createdPeriodIds.push(pmPeriodId);

      // Duplicate check: cannot create second PM_EVALUATION in same month (2026-10)
      const dupRes = await api("POST", "/periods", {
        title: "Evaluasi PM Duplikat Oktober",
        type: "PM_EVALUATION",
        startDate: "2026-10-15",
        endDate: "2026-10-31"
      }, { id: ids.admin, role: "operator" });
      assert.equal(dupRes.status, 409, "Must reject duplicate PM_EVALUATION in same month with 409");
    }

    // Step 2: Admin OPEN period
    {
      const res = await api("POST", `/periods/${pmPeriodId}/open`, {}, { id: ids.admin, role: "operator" });
      assert.equal(res.status, 200);
      assert.equal(res.body.period.status, "OPEN");
    }

    // Step 3: Pastikan snapshot assignment terbentuk
    {
      const res = await api("GET", `/pm/assignments?periodId=${pmPeriodId}`, null, { id: ids.admin, role: "operator" });
      assert.equal(res.status, 200);
      const assignments = res.body.assignments;
      assert.equal(assignments.length, 3, "Snapshot should create 3 assignments for 3 students");
    }

    // Step 4: PM divisi A hanya melihat mahasiswa divisi A
    {
      const resA = await api("GET", `/pm/assignments?periodId=${pmPeriodId}`, null, { id: ids.pmA, role: "mahasiswa" });
      assert.equal(resA.status, 200);
      assert.equal(resA.body.assignments.length, 1, "PM A should only see 1 student (Divisi AI)");
      assert.equal(resA.body.assignments[0].studentId, ids.std1);
      assert.equal(resA.body.assignments[0].divisionName, "Artificial Intelligence");
      pmA_Assignment = resA.body.assignments[0];

      const resB = await api("GET", `/pm/assignments?periodId=${pmPeriodId}`, null, { id: ids.pmB, role: "mahasiswa" });
      assert.equal(resB.status, 200);
      assert.equal(resB.body.assignments.length, 2, "PM B should see 2 students (Divisi Web)");
      pmB_Assignment = resB.body.assignments[0];
    }

    // Step 5: PM A tidak dapat menilai mahasiswa divisi B (HTTP 403)
    {
      const res = await api("PUT", `/pm/assignments/${pmB_Assignment.assignmentId}/submission`, {
        status: "DRAFT",
        scores: [{ criteriaKey: "quality_of_work", score: 8.0 }]
      }, { id: ids.pmA, role: "mahasiswa" });

      assert.equal(res.status, 403, "PM A evaluating division B must return 403");
    }

    // Step 6: Save partial DRAFT
    {
      const res = await api("PUT", `/pm/assignments/${pmA_Assignment.assignmentId}/submission`, {
        status: "DRAFT",
        scores: [
          { criteriaKey: "quality_of_work", score: 8.5, notes: "Kode rapi" },
          { criteriaKey: "responsibility", score: 9.0, notes: "Selalu hadir on time" }
        ],
        strength: "Algoritma kuat",
        improvement: "Dokumentasi",
        notes: "Draft progress bagus"
      }, { id: ids.pmA, role: "mahasiswa" });

      assert.equal(res.status, 200);
      assert.equal(res.body.assignment.submissionStatus, "DRAFT");
    }

    // Step 7: Reload GET detail dan pastikan draft persist
    {
      const res = await api("GET", `/pm/assignments/${pmA_Assignment.assignmentId}`, null, { id: ids.pmA, role: "mahasiswa" });
      assert.equal(res.status, 200);
      assert.equal(res.body.assignment.submissionStatus, "DRAFT");
      assert.equal(res.body.assignment.strength, "Algoritma kuat");
      assert.equal(res.body.assignment.scores.length, 2);
    }

    // Step 8: SUBMIT seluruh 7 criteria
    {
      const allSevenScores = [
        { criteriaKey: "quality_of_work", score: 8.5 },
        { criteriaKey: "responsibility", score: 9.0 },
        { criteriaKey: "technical_skill", score: 8.0 },
        { criteriaKey: "problem_solving", score: 8.5 },
        { criteriaKey: "collaboration", score: 9.0 },
        { criteriaKey: "initiative", score: 8.0 },
        { criteriaKey: "research_contribution", score: 8.5 }
      ];
      const res = await api("PUT", `/pm/assignments/${pmA_Assignment.assignmentId}/submission`, {
        status: "SUBMITTED",
        scores: allSevenScores,
        strength: "Problem solving sangat cepat",
        improvement: "Penyusunan laporan",
        notes: "Pertahankan performa"
      }, { id: ids.pmA, role: "mahasiswa" });

      assert.equal(res.status, 200);
      assert.equal(res.body.assignment.submissionStatus, "SUBMITTED");
      assert.ok(res.body.assignment.overallScore != null);
    }

    // Step 9: Progress dan recap berubah benar
    {
      const progRes = await api("GET", `/periods/${pmPeriodId}/progress`, null, { id: ids.admin, role: "operator" });
      assert.equal(progRes.status, 200);
      assert.equal(progRes.body.summary.submittedCount, 1);
      assert.equal(progRes.body.summary.totalAssignments, 3);

      const recapRes = await api("GET", `/periods/${pmPeriodId}/recap`, null, { id: ids.admin, role: "operator" });
      assert.equal(recapRes.status, 200);
      assert.equal(recapRes.body.items.length, 3);
      const student1Item = recapRes.body.items.find((i) => i.studentId === ids.std1);
      assert.equal(student1Item.submissionStatus, "SUBMITTED");
    }

    // Step 9b: Result visibility gate while period is OPEN
    {
      const studentHistory = await api("GET", "/my-history", null, { id: ids.mhs1, role: "mahasiswa" });
      assert.equal(studentHistory.status, 200);
      const studentPmEval = studentHistory.body.pmEvaluations.find((e) => e.periodId === pmPeriodId);
      assert.ok(studentPmEval, "Student evaluation entry should exist in history");
      assert.equal(studentPmEval.periodType, "PM_EVALUATION");
      assert.equal(studentPmEval.evaluationMonth, "2026-10");
      assert.equal(studentPmEval.resultAvailable, false, "Result must not be available to student while period is OPEN");
      assert.equal(studentPmEval.overallScore, null, "Overall score must be null for student while period is OPEN");
      assert.equal(studentPmEval.strength, null, "Feedback must be null for student while period is OPEN");

      const adminRecap = await api("GET", `/students/${ids.std1}/recap`, null, { id: ids.admin, role: "operator" });
      assert.equal(adminRecap.status, 200);
      const adminPmEval = adminRecap.body.pmEvaluations.find((e) => e.periodId === pmPeriodId);
      assert.ok(adminPmEval);
      assert.equal(adminPmEval.periodType, "PM_EVALUATION");
      assert.equal(adminPmEval.evaluationMonth, "2026-10");
      assert.equal(adminPmEval.resultAvailable, true, "Admin should see resultAvailable = true while period is OPEN");
      assert.ok(adminPmEval.overallScore != null, "Admin should see score while period is OPEN");
    }

    // Step 10: CLOSE period
    {
      const res = await api("POST", `/periods/${pmPeriodId}/close`, {}, { id: ids.admin, role: "operator" });
      assert.equal(res.status, 200);
      assert.equal(res.body.period.status, "CLOSED");
    }

    // Step 10b: Result visibility gate after period is CLOSED
    {
      const studentHistory = await api("GET", "/my-history", null, { id: ids.mhs1, role: "mahasiswa" });
      assert.equal(studentHistory.status, 200);
      const studentPmEval = studentHistory.body.pmEvaluations.find((e) => e.periodId === pmPeriodId);
      assert.ok(studentPmEval);
      assert.equal(studentPmEval.periodType, "PM_EVALUATION");
      assert.equal(studentPmEval.evaluationMonth, "2026-10");
      assert.equal(studentPmEval.resultAvailable, true, "Result must be available to student after period is CLOSED");
      assert.ok(studentPmEval.overallScore != null, "Overall score must be visible after period is CLOSED");
      assert.equal(studentPmEval.strength, "Problem solving sangat cepat", "Strength must be visible after period is CLOSED");
    }

    // Step 11: Seluruh mutation setelah CLOSED ditolak
    {
      const updatePeriodRes = await api("PUT", `/periods/${pmPeriodId}`, { title: "New Title" }, { id: ids.admin, role: "operator" });
      assert.equal(updatePeriodRes.status, 409);

      const submitRes = await api("PUT", `/pm/assignments/${pmA_Assignment.assignmentId}/submission`, {
        status: "DRAFT",
        scores: [{ criteriaKey: "quality_of_work", score: 9.0 }]
      }, { id: ids.pmA, role: "mahasiswa" });
      assert.equal(submitRes.status, 409);
    }

    // -------------------------------------------------------------------------
    // 3. MONTHLY_PRESENTATION END-TO-END FLOW
    // -------------------------------------------------------------------------
    let presPeriodId;
    let sessionId;
    let slotStudent1Id;
    let slotStudent2Id;

    // Step 1: Create/open period
    {
      const createRes = await api("POST", "/periods", {
        title: "Evaluasi Presentasi Bulanan Oktober",
        type: "MONTHLY_PRESENTATION",
        startDate: "2026-10-15",
        endDate: "2026-10-15"
      }, { id: ids.admin, role: "operator" });
      assert.equal(createRes.status, 201);
      assert.equal(createRes.body.period.evaluationMonth, "2026-10");
      presPeriodId = createRes.body.period.id;
      createdPeriodIds.push(presPeriodId);

      // Duplicate check: cannot create second MONTHLY_PRESENTATION in same month (2026-10)
      const dupPresRes = await api("POST", "/periods", {
        title: "Evaluasi Presentasi Duplikat Oktober",
        type: "MONTHLY_PRESENTATION",
        startDate: "2026-10-20",
        endDate: "2026-10-20"
      }, { id: ids.admin, role: "operator" });
      assert.equal(dupPresRes.status, 409, "Must reject duplicate MONTHLY_PRESENTATION in same month with 409");

      const openRes = await api("POST", `/periods/${presPeriodId}/open`, {}, { id: ids.admin, role: "operator" });
      assert.equal(openRes.status, 200);
    }

    // Step 2: Create presentation session
    {
      const res = await api("POST", "/presentation-sessions", {
        periodId: presPeriodId,
        title: "Sesi Presentasi Riset Oktober",
        sessionDate: "2026-10-15",
        startTime: "09:00",
        endTime: "12:00",
        location: "Lab STAS-RG"
      }, { id: ids.admin, role: "operator" });
      assert.equal(res.status, 201);
      sessionId = res.body.session.id;
    }

    // Step 3: Add student slots
    {
      const slot1Res = await api("POST", `/presentation-sessions/${sessionId}/slots`, {
        studentId: ids.std1,
        slotOrder: 1,
        topic: "Penerapan LLM pada Automated Grading",
        divisionId: ids.divA,
        divisionName: "Artificial Intelligence"
      }, { id: ids.admin, role: "operator" });
      assert.equal(slot1Res.status, 201);
      slotStudent1Id = slot1Res.body.slot.id;

      const slot2Res = await api("POST", `/presentation-sessions/${sessionId}/slots`, {
        studentId: ids.std2,
        slotOrder: 2,
        topic: "Frontend Architecture Performance Optimization",
        divisionId: ids.divB,
        divisionName: "Web Development"
      }, { id: ids.admin, role: "operator" });
      assert.equal(slot2Res.status, 201);
      slotStudent2Id = slot2Res.body.slot.id;
    }

    // Step 4: Assign Admin + minimal 2 PM sebagai evaluator
    {
      await api("POST", `/presentation-sessions/${sessionId}/evaluators`, {
        evaluatorId: ids.admin,
        role: "Operator"
      }, { id: ids.admin, role: "operator" });

      await api("POST", `/presentation-sessions/${sessionId}/evaluators`, {
        evaluatorId: ids.pmA,
        role: "PM AI"
      }, { id: ids.admin, role: "operator" });

      await api("POST", `/presentation-sessions/${sessionId}/evaluators`, {
        evaluatorId: ids.pmB,
        role: "PM Web"
      }, { id: ids.admin, role: "operator" });

      const sessionDetail = await api("GET", `/presentation-sessions/${sessionId}`, null, { id: ids.admin, role: "operator" });
      assert.equal(sessionDetail.body.session.evaluators.length, 3);
    }

    // Step 5: Evaluator A save DRAFT (PM A for Student 1)
    {
      const res = await api("PUT", `/presentation-slots/${slotStudent1Id}/my-evaluation`, {
        status: "DRAFT",
        scores: [
          { criteriaKey: "progress_achievement", score: 8.0 },
          { criteriaKey: "quality_of_result", score: 8.0 }
        ],
        notes: "Draft evaluasi PM A"
      }, { id: ids.pmA, role: "mahasiswa" });
      assert.equal(res.status, 200);
      assert.equal(res.body.evaluation.status, "DRAFT");
    }

    // Step 6: Evaluator B SUBMIT (PM B for Student 1)
    {
      const allCriteriaScoresB = [
        { criteriaKey: "progress_achievement", score: 9.0 },
        { criteriaKey: "quality_of_result", score: 9.0 },
        { criteriaKey: "technical_understanding", score: 9.0 },
        { criteriaKey: "problem_solving", score: 9.0 },
        { criteriaKey: "presentation_delivery", score: 9.0 },
        { criteriaKey: "response_to_questions", score: 9.0 },
        { criteriaKey: "next_plan", score: 9.0 }
      ];
      const res = await api("PUT", `/presentation-slots/${slotStudent1Id}/my-evaluation`, {
        status: "SUBMITTED",
        scores: allCriteriaScoresB,
        notes: "Evaluasi PM B selesai"
      }, { id: ids.pmB, role: "mahasiswa" });
      assert.equal(res.status, 200);
      assert.equal(res.body.evaluation.status, "SUBMITTED");
      assert.equal(Number(res.body.evaluation.overallScore), 9.0);
    }

    // Step 7: Pastikan evaluator A/B tidak overwrite satu sama lain
    {
      const evalA = await api("GET", `/presentation-slots/${slotStudent1Id}/my-evaluation`, null, { id: ids.pmA, role: "mahasiswa" });
      assert.equal(evalA.status, 200);
      assert.equal(evalA.body.evaluation.status, "DRAFT");

      const evalB = await api("GET", `/presentation-slots/${slotStudent1Id}/my-evaluation`, null, { id: ids.pmB, role: "mahasiswa" });
      assert.equal(evalB.status, 200);
      assert.equal(evalB.body.evaluation.status, "SUBMITTED");

      // Check slot evaluator list
      const slotEvals = await api("GET", `/presentation-slots/${slotStudent1Id}/evaluations`, null, { id: ids.admin, role: "operator" });
      assert.equal(slotEvals.status, 200);
      assert.equal(slotEvals.body.evaluations.length, 2, "Both evaluators must exist independently");
    }

    // Step 8: Evaluator A kemudian SUBMIT (PM A for Student 1 with 8.0)
    {
      const allCriteriaScoresA = [
        { criteriaKey: "progress_achievement", score: 8.0 },
        { criteriaKey: "quality_of_result", score: 8.0 },
        { criteriaKey: "technical_understanding", score: 8.0 },
        { criteriaKey: "problem_solving", score: 8.0 },
        { criteriaKey: "presentation_delivery", score: 8.0 },
        { criteriaKey: "response_to_questions", score: 8.0 },
        { criteriaKey: "next_plan", score: 8.0 }
      ];
      const res = await api("PUT", `/presentation-slots/${slotStudent1Id}/my-evaluation`, {
        status: "SUBMITTED",
        scores: allCriteriaScoresA,
        notes: "Evaluasi PM A disubmit"
      }, { id: ids.pmA, role: "mahasiswa" });
      assert.equal(res.status, 200);
      assert.equal(res.body.evaluation.status, "SUBMITTED");
    }

    // Step 9: Presentation score = AVG hanya SUBMITTED ((8.0 + 9.0) / 2 = 8.5)
    {
      const slotEvals = await api("GET", `/presentation-slots/${slotStudent1Id}/evaluations`, null, { id: ids.admin, role: "operator" });
      assert.equal(slotEvals.status, 200);
      assert.equal(slotEvals.body.evaluatorCount, 2);
      assert.equal(Number(slotEvals.body.presentationScore), 8.5);
    }

    // Step 10: Tandai mahasiswa lain ABSENT (Student 2)
    {
      const res = await api("PATCH", `/presentation-slots/${slotStudent2Id}/status`, {
        status: "ABSENT"
      }, { id: ids.admin, role: "operator" });
      assert.equal(res.status, 200);
      assert.equal(res.body.slot.status, "ABSENT");
    }

    // Step 11: Score mahasiswa ABSENT harus null, bukan 0
    {
      const recapRes = await api("GET", `/periods/${presPeriodId}/recap`, null, { id: ids.admin, role: "operator" });
      assert.equal(recapRes.status, 200);
      const absentItem = recapRes.body.items.find((i) => i.slotId === slotStudent2Id);
      assert.ok(absentItem);
      assert.equal(absentItem.slotStatus, "ABSENT");
      assert.equal(absentItem.presentationScore, null, "Score for ABSENT student must be strictly null, never 0.00");
    }

    // Step 11b: Result visibility gate for presentation while OPEN
    {
      const studentHistory = await api("GET", "/my-history", null, { id: ids.mhs1, role: "mahasiswa" });
      assert.equal(studentHistory.status, 200);
      const studentSlot = studentHistory.body.presentationSlots.find((s) => s.slotId === slotStudent1Id);
      assert.ok(studentSlot);
      assert.equal(studentSlot.periodType, "MONTHLY_PRESENTATION");
      assert.equal(studentSlot.evaluationMonth, "2026-10");
      assert.equal(studentSlot.resultAvailable, false, "Presentation result should not be available while OPEN");
      assert.equal(studentSlot.presentationScore, null, "Presentation score masked to null while OPEN");

      const adminRecap = await api("GET", `/students/${ids.std1}/recap`, null, { id: ids.admin, role: "operator" });
      assert.equal(adminRecap.status, 200);
      const adminSlot = adminRecap.body.presentationSlots.find((s) => s.slotId === slotStudent1Id);
      assert.ok(adminSlot);
      assert.equal(adminSlot.periodType, "MONTHLY_PRESENTATION");
      assert.equal(adminSlot.evaluationMonth, "2026-10");
      assert.equal(adminSlot.resultAvailable, true, "Admin can see presentation result while OPEN");
      assert.equal(Number(adminSlot.presentationScore), 8.5);
    }

    // Step 12: CLOSE period dan pastikan immutable
    {
      const closeRes = await api("POST", `/periods/${presPeriodId}/close`, {}, { id: ids.admin, role: "operator" });
      assert.equal(closeRes.status, 200);
      assert.equal(closeRes.body.period.status, "CLOSED");

      const attemptRes = await api("PUT", `/presentation-slots/${slotStudent1Id}/my-evaluation`, {
        status: "SUBMITTED",
        scores: []
      }, { id: ids.pmA, role: "mahasiswa" });
      assert.equal(attemptRes.status, 409);
    }

    // Step 12b: Result visibility gate for presentation after CLOSED
    {
      const studentHistory = await api("GET", "/my-history", null, { id: ids.mhs1, role: "mahasiswa" });
      assert.equal(studentHistory.status, 200);
      const studentSlot = studentHistory.body.presentationSlots.find((s) => s.slotId === slotStudent1Id);
      assert.ok(studentSlot);
      assert.equal(studentSlot.periodType, "MONTHLY_PRESENTATION");
      assert.equal(studentSlot.evaluationMonth, "2026-10");
      assert.equal(studentSlot.resultAvailable, true, "Presentation result available to student after CLOSED");
      assert.equal(Number(studentSlot.presentationScore), 8.5);
    }

    // -------------------------------------------------------------------------
    // 4. PRIVACY & SECURITY GUARD FLOW
    // -------------------------------------------------------------------------
    // Student 1 can read own history
    {
      const res = await api("GET", "/my-history", null, { id: ids.mhs1, role: "mahasiswa" });
      assert.equal(res.status, 200);
      assert.equal(res.body.student.id, ids.std1);
      assert.ok(Array.isArray(res.body.pmEvaluations));
      assert.ok(Array.isArray(res.body.presentationSlots));
    }

    // Student 1 accessing Student 2 recap must be 403 Forbidden
    {
      const res = await api("GET", `/students/${ids.std2}/recap`, null, { id: ids.mhs1, role: "mahasiswa" });
      assert.equal(res.status, 403, "Student accessing other student recap must return 403");
    }

    // Student accessing global period progress must be 403 Forbidden
    {
      const res = await api("GET", `/periods/${pmPeriodId}/progress`, null, { id: ids.mhs1, role: "mahasiswa" });
      assert.equal(res.status, 403, "Student accessing global progress must return 403");
    }

    // Student accessing global period recap must be 403 Forbidden
    {
      const res = await api("GET", `/periods/${pmPeriodId}/recap`, null, { id: ids.mhs1, role: "mahasiswa" });
      assert.equal(res.status, 403, "Student accessing global recap must return 403");
    }

  } finally {
    await cleanup();
    server.close();
  }
});
