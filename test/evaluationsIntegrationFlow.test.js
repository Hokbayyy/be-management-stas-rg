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
    divB: `${prefix}-DIV-WEB`,
    dosenA: `${prefix}-DSN-A`,
    dosenB: `${prefix}-DSN-B`
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
  app.use((err, req, res, next) => {
    const status = err.statusCode || err.status || 500;
    res.status(status).json({
      message: err.message || "Terjadi kesalahan pada server."
    });
  });

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
        await pool.query("DELETE FROM evaluation_period_evaluators WHERE period_id = ANY($1)", [createdPeriodIds]);
        await pool.query("DELETE FROM evaluation_emergency_audits WHERE period_id = ANY($1)", [createdPeriodIds]);
        await pool.query("DELETE FROM evaluation_periods WHERE id = ANY($1)", [createdPeriodIds]);
      }
      await pool.query("DELETE FROM evaluation_monitoring_grants WHERE user_id IN ($1, $2)", [ids.dosenA, ids.dosenB]);
      await pool.query("DELETE FROM evaluation_periods WHERE title LIKE 'Evaluasi PM%' OR title LIKE 'Evaluasi Presentasi%'");

      await pool.query("DELETE FROM research_memberships WHERE project_id = $1", [ids.project]);
      await pool.query("DELETE FROM research_divisions WHERE project_id = $1", [ids.project]);
      await pool.query("DELETE FROM research_projects WHERE id = $1", [ids.project]);

      await pool.query("DELETE FROM students WHERE id IN ($1, $2, $3)", [ids.std1, ids.std2, ids.std3]);
      await pool.query("DELETE FROM users WHERE id IN ($1, $2, $3, $4, $5, $6, $7, $8)", [
        ids.admin, ids.pmA, ids.pmB, ids.mhs1, ids.mhs2, ids.mhs3, ids.dosenA, ids.dosenB
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
      ($6, 'Mahasiswa 3 (Web)', 'M3', 'mahasiswa', 'mhs3@test.com', TRUE),
      ($7, 'Dosen Reviewer A', 'DA', 'dosen', 'dosen.a@test.com', TRUE),
      ($8, 'Dosen Reviewer B', 'DB', 'dosen', 'dosen.b@test.com', TRUE)
    `, [ids.admin, ids.pmA, ids.pmB, ids.mhs1, ids.mhs2, ids.mhs3, ids.dosenA, ids.dosenB]);

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
        scoringVersion: "PM_V1_7CRITERIA",
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

    // Step 3b: Evaluators initialized with PENDING attendance
    {
      const evalListRes = await api("GET", `/periods/${pmPeriodId}/evaluators`, null, { id: ids.admin, role: "operator" });
      assert.equal(evalListRes.status, 200);
      assert.ok(evalListRes.body.evaluators.length >= 2, "Both PMs should be registered as period evaluators");
      for (const ev of evalListRes.body.evaluators) {
        assert.equal(ev.attendanceStatus, "PENDING", "Initial attendance must be PENDING");
      }
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

    // Step 4b: Evaluator cannot submit while attendance is PENDING (HTTP 422)
    {
      const pendingTry = await api("PUT", `/pm/assignments/${pmA_Assignment.assignmentId}/submission`, {
        status: "DRAFT",
        scores: [{ criteriaKey: "quality_of_work", score: 8.0 }]
      }, { id: ids.pmA, role: "mahasiswa" });
      assert.equal(pendingTry.status, 422, "Draft must be rejected when PM attendance is PENDING");
    }

    // Step 4c: Admin confirms PM attendance (PM A -> PRESENT, PM B -> ABSENT)
    {
      const attResA = await api("PATCH", `/periods/${pmPeriodId}/evaluators/${ids.pmA}/attendance`, {
        attendanceStatus: "PRESENT"
      }, { id: ids.admin, role: "operator" });
      assert.equal(attResA.status, 200);
      assert.equal(attResA.body.evaluator.attendanceStatus, "PRESENT");

      const attResB = await api("PATCH", `/periods/${pmPeriodId}/evaluators/${ids.pmB}/attendance`, {
        attendanceStatus: "ABSENT"
      }, { id: ids.admin, role: "operator" });
      assert.equal(attResB.status, 200);
      assert.equal(attResB.body.evaluator.attendanceStatus, "ABSENT");

      // PM B (ABSENT) cannot draft or submit
      const absentTry = await api("PUT", `/pm/assignments/${pmB_Assignment.assignmentId}/submission`, {
        status: "DRAFT",
        scores: [{ criteriaKey: "quality_of_work", score: 8.0 }]
      }, { id: ids.pmB, role: "mahasiswa" });
      assert.equal(absentTry.status, 422, "Draft must be rejected when PM attendance is ABSENT");
    }

    // Step 5: PM A tidak dapat menilai mahasiswa divisi B (HTTP 403)
    {
      const res = await api("PUT", `/pm/assignments/${pmB_Assignment.assignmentId}/submission`, {
        status: "DRAFT",
        scores: [{ criteriaKey: "quality_of_work", score: 8.0 }]
      }, { id: ids.pmA, role: "mahasiswa" });

      assert.equal(res.status, 403, "PM A evaluating division B must return 403");

      // Admin/Operator attempting to submit for PM assignment must also be rejected (HTTP 403)
      const adminSubmitRes = await api("PUT", `/pm/assignments/${pmA_Assignment.assignmentId}/submission`, {
        status: "DRAFT",
        scores: [{ criteriaKey: "quality_of_work", score: 8.0 }]
      }, { id: ids.admin, role: "operator" });
      assert.equal(adminSubmitRes.status, 403, "Admin attempting to submit PM assignment must return 403");

      // PM A cannot read private assignment details of PM B (HTTP 403)
      const pmReadRes = await api("GET", `/pm/assignments/${pmB_Assignment.assignmentId}`, null, { id: ids.pmA, role: "mahasiswa" });
      assert.equal(pmReadRes.status, 403, "PM A cannot read PM B assignment details");

      // Admin CAN read assignment details for oversight (HTTP 200)
      const adminReadRes = await api("GET", `/pm/assignments/${pmA_Assignment.assignmentId}`, null, { id: ids.admin, role: "operator" });
      assert.equal(adminReadRes.status, 200, "Admin can read PM assignment details for oversight");
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

    // Step 8b: Assignment SUBMITTED tidak dapat diubah kembali (HTTP 409)
    {
      const resubmitTry = await api("PUT", `/pm/assignments/${pmA_Assignment.assignmentId}/submission`, {
        status: "DRAFT",
        scores: [{ criteriaKey: "quality_of_work", score: 9.0 }]
      }, { id: ids.pmA, role: "mahasiswa" });
      assert.equal(resubmitTry.status, 409, "Modifying an already SUBMITTED assignment must return 409");
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
        scoringVersion: "PRESENTATION_V1_7CRITERIA",
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

    // -------------------------------------------------------------------------
    // 5. CROSS-PROJECT SOFTWARE GROUP, MULTI-PM & RECAP INTEGRATION FLOW
    // -------------------------------------------------------------------------
    let novPeriodId;
    {
      // 1. Create November PM_EVALUATION period
      const createRes = await api("POST", "/periods", {
        title: "Evaluasi PM Bulanan November",
        type: "PM_EVALUATION",
        scoringVersion: "PM_V1_7CRITERIA",
        startDate: "2026-11-01",
        endDate: "2026-11-30",
        description: "Periode evaluasi PM bulanan November"
      }, { id: ids.admin, role: "operator" });
      assert.equal(createRes.status, 201);
      novPeriodId = createRes.body.period.id;
      createdPeriodIds.push(novPeriodId);

      // 2. Configure Software Evaluation Group: assign PM A and PM B
      const addPmARes = await api("POST", "/groups/EVAL-GRP-SOFTWARE/evaluators", {
        evaluatorId: ids.pmA
      }, { id: ids.admin, role: "operator" });
      assert.ok([200, 201].includes(addPmARes.status));

      const addPmBRes = await api("POST", "/groups/EVAL-GRP-SOFTWARE/evaluators", {
        evaluatorId: ids.pmB
      }, { id: ids.admin, role: "operator" });
      assert.ok([200, 201].includes(addPmBRes.status));

      // 3. Map students to Software group (manual mapping for student 2 and 3)
      await api("POST", "/groups/EVAL-GRP-SOFTWARE/students", {
        studentId: ids.std2,
        notes: "Frontend Developer"
      }, { id: ids.admin, role: "operator" });

      await api("POST", "/groups/EVAL-GRP-SOFTWARE/students", {
        studentId: ids.std3,
        notes: "Backend Developer"
      }, { id: ids.admin, role: "operator" });

      // 4. Preview assignments before opening
      const previewRes = await api("GET", `/periods/${novPeriodId}/preview-assignments`, null, {
        id: ids.admin,
        role: "operator"
      });
      assert.equal(previewRes.status, 200);
      assert.ok(previewRes.body.uniqueStudents >= 2, "Preview should contain at least 2 unique students");
      assert.ok(previewRes.body.totalAssignments >= 4, "Preview should contain at least 4 assignments (2 students x 2 PMs)");

      // 5. Open November period
      const openRes = await api("POST", `/periods/${novPeriodId}/open`, {}, {
        id: ids.admin,
        role: "operator"
      });
      assert.equal(openRes.status, 200);
      assert.equal(openRes.body.period.status, "OPEN");

      // 6. Idempotent backfill / sync
      const syncRes = await api("POST", `/periods/${novPeriodId}/sync-assignments`, {}, {
        id: ids.admin,
        role: "operator"
      });
      assert.equal(syncRes.status, 200);
      assert.equal(syncRes.body.syncedCount, 0, "Second sync must add 0 assignments (idempotent)");

      // 7. Admin confirms attendance: PM A -> PRESENT, PM B -> PRESENT
      await api("PATCH", `/periods/${novPeriodId}/evaluators/${ids.pmA}/attendance`, {
        attendanceStatus: "PRESENT"
      }, { id: ids.admin, role: "operator" });

      await api("PATCH", `/periods/${novPeriodId}/evaluators/${ids.pmB}/attendance`, {
        attendanceStatus: "PRESENT"
      }, { id: ids.admin, role: "operator" });

      // 8. Fetch assignments for PM A and PM B
      const pmAAsnRes = await api("GET", `/pm/assignments?periodId=${novPeriodId}`, null, {
        id: ids.pmA,
        role: "mahasiswa"
      });
      assert.equal(pmAAsnRes.status, 200);
      const pmAStudent2Asn = pmAAsnRes.body.assignments.find((a) => a.studentId === ids.std2);
      assert.ok(pmAStudent2Asn, "PM A should have an assignment for Student 2");

      const pmBAsnRes = await api("GET", `/pm/assignments?periodId=${novPeriodId}`, null, {
        id: ids.pmB,
        role: "mahasiswa"
      });
      assert.equal(pmBAsnRes.status, 200);
      const pmBStudent2Asn = pmBAsnRes.body.assignments.find((a) => a.studentId === ids.std2);
      assert.ok(pmBStudent2Asn, "PM B should have an assignment for Student 2");

      // 9. PM A submits 8.0 for Student 2
      const scoresA = [
        { criteriaKey: "quality_of_work", score: 8.0 },
        { criteriaKey: "responsibility", score: 8.0 },
        { criteriaKey: "technical_skill", score: 8.0 },
        { criteriaKey: "problem_solving", score: 8.0 },
        { criteriaKey: "collaboration", score: 8.0 },
        { criteriaKey: "initiative", score: 8.0 },
        { criteriaKey: "research_contribution", score: 8.0 }
      ];
      await api("PUT", `/pm/assignments/${pmAStudent2Asn.assignmentId}/submission`, {
        status: "SUBMITTED",
        scores: scoresA,
        strength: "Solid code quality"
      }, { id: ids.pmA, role: "mahasiswa" });

      // Check recap: Student 2 status should be PROVISIONAL with provisionalScore 8.0
      const midRecapRes = await api("GET", `/periods/${novPeriodId}/recap`, null, {
        id: ids.admin,
        role: "operator"
      });
      assert.equal(midRecapRes.status, 200);
      const std2Mid = midRecapRes.body.items.find((i) => i.studentId === ids.std2);
      assert.ok(std2Mid);
      assert.equal(std2Mid.status, "PROVISIONAL");
      assert.equal(std2Mid.finalScore, null, "Final score must be null while PM B has not submitted yet");
      assert.equal(Number(std2Mid.provisionalScore), 8.0);

      // 10. PM B submits 9.0 for Student 2
      const scoresB = [
        { criteriaKey: "quality_of_work", score: 9.0 },
        { criteriaKey: "responsibility", score: 9.0 },
        { criteriaKey: "technical_skill", score: 9.0 },
        { criteriaKey: "problem_solving", score: 9.0 },
        { criteriaKey: "collaboration", score: 9.0 },
        { criteriaKey: "initiative", score: 9.0 },
        { criteriaKey: "research_contribution", score: 9.0 }
      ];
      await api("PUT", `/pm/assignments/${pmBStudent2Asn.assignmentId}/submission`, {
        status: "SUBMITTED",
        scores: scoresB,
        strength: "Great initiative"
      }, { id: ids.pmB, role: "mahasiswa" });

      // Check recap: Student 2 status should now be FINAL with score (8.0 + 9.0) / 2 = 8.50!
      const finalRecapRes = await api("GET", `/periods/${novPeriodId}/recap`, null, {
        id: ids.admin,
        role: "operator"
      });
      assert.equal(finalRecapRes.status, 200);
      const std2Final = finalRecapRes.body.items.find((i) => i.studentId === ids.std2);
      assert.ok(std2Final);
      assert.equal(std2Final.status, "FINAL");
      assert.equal(Number(std2Final.finalScore), 8.5);

      // 11. Close November period (using force: true since student 3 was not scored)
      const closeNovRes = await api("POST", `/periods/${novPeriodId}/close`, {
        force: true
      }, { id: ids.admin, role: "operator" });
      assert.equal(closeNovRes.status, 200);
      assert.equal(closeNovRes.body.period.status, "CLOSED");

      // 12. Student 2 views their history: finalScore is visible as 8.5
      const mhs2History = await api("GET", "/my-history", null, {
        id: ids.mhs2,
        role: "mahasiswa"
      });
      assert.equal(mhs2History.status, 200);
      const novEval = mhs2History.body.pmEvaluations.find((e) => e.periodId === novPeriodId);
      assert.ok(novEval);
      assert.equal(novEval.resultAvailable, true);
      assert.equal(Number(novEval.overallScore), 8.5);
    }

    // -------------------------------------------------------------------------
    // 4. POLICY 1 & 2 SECURITY POLICIES: EMERGENCY CLOSED & DOSEN VISIBILITY
    // -------------------------------------------------------------------------
    {
      // Scenario 1: CLOSED period cannot be edited via normal operations (409)
      const normalEditRes = await api("PUT", `/periods/${novPeriodId}`, {
        title: "Edit Periode CLOSED Ilegal"
      }, { id: ids.admin, role: "operator" });
      assert.equal(normalEditRes.status, 409);
      assert.match(normalEditRes.body.message, /sudah ditutup dan tidak dapat diubah/);

      const normalSyncRes = await api("POST", `/periods/${novPeriodId}/sync-assignments`, {}, {
        id: ids.admin,
        role: "operator"
      });
      assert.equal(normalSyncRes.status, 409);
      assert.match(normalSyncRes.body.message, /sudah ditutup/);

      // Scenario 2: Generic force-delete without emergency procedure is rejected (409)
      const genericDelRes = await api("DELETE", `/periods/${novPeriodId}?force=true`, null, {
        id: ids.admin,
        role: "operator"
      });
      assert.equal(genericDelRes.status, 409);
      assert.match(genericDelRes.body.message, /sudah ditutup dan tidak dapat dihapus melalui operasi reguler/);

      // Scenario 3: Emergency action without admin/operator permission is rejected (403)
      const dosenEmgRes = await api("POST", `/periods/${novPeriodId}/emergency-action`, {
        action: "EMERGENCY_ARCHIVE",
        reason: "Dosen trying to perform emergency archive",
        confirmPeriodTitle: "Evaluasi PM Bulanan November"
      }, { id: ids.dosenA, role: "dosen" });
      assert.equal(dosenEmgRes.status, 403);

      const mhsEmgRes = await api("POST", `/periods/${novPeriodId}/emergency-action`, {
        action: "EMERGENCY_ARCHIVE",
        reason: "Mahasiswa trying to perform emergency archive",
        confirmPeriodTitle: "Evaluasi PM Bulanan November"
      }, { id: ids.mhs1, role: "mahasiswa" });
      assert.equal(mhsEmgRes.status, 403);

      // Scenario 4: Emergency action validation (reason >= 10 chars, valid action, title confirmation) (422)
      const shortReasonRes = await api("POST", `/periods/${novPeriodId}/emergency-action`, {
        action: "EMERGENCY_ARCHIVE",
        reason: "pendek",
        confirmPeriodTitle: "Evaluasi PM Bulanan November"
      }, { id: ids.admin, role: "operator" });
      assert.equal(shortReasonRes.status, 422);
      assert.match(shortReasonRes.body.message, /minimal 10 karakter/);

      const invalidActionRes = await api("POST", `/periods/${novPeriodId}/emergency-action`, {
        action: "INVALID_ACTION",
        reason: "Alasan yang cukup panjang tetapi aksi tidak valid",
        confirmPeriodTitle: "Evaluasi PM Bulanan November"
      }, { id: ids.admin, role: "operator" });
      assert.equal(invalidActionRes.status, 422);

      const wrongTitleRes = await api("POST", `/periods/${novPeriodId}/emergency-action`, {
        action: "EMERGENCY_ARCHIVE",
        reason: "Alasan yang cukup panjang tetapi salah konfirmasi judul",
        confirmPeriodTitle: "Judul Yang Salah"
      }, { id: ids.admin, role: "operator" });
      assert.equal(wrongTitleRes.status, 422);

      // Scenario 5: Valid emergency action creates persistent audit record (200)
      const validArchiveRes = await api("POST", `/periods/${novPeriodId}/emergency-action`, {
        action: "EMERGENCY_ARCHIVE",
        reason: "Instruksi audit darurat dekanat untuk pembekuan periode",
        confirmPeriodTitle: "Evaluasi PM Bulanan November"
      }, { id: ids.admin, role: "operator" });
      assert.equal(validArchiveRes.status, 200);
      assert.equal(validArchiveRes.body.success, true);
      assert.ok(validArchiveRes.body.auditId);

      // Verify audit list endpoint
      const auditListRes = await api("GET", `/emergency-audits?periodId=${novPeriodId}`, null, {
        id: ids.admin,
        role: "operator"
      });
      assert.equal(auditListRes.status, 200);
      assert.ok(auditListRes.body.audits.length > 0);
      assert.equal(auditListRes.body.audits[0].action_type, "EMERGENCY_ARCHIVE");
      assert.equal(auditListRes.body.audits[0].execution_status, "SUCCESS");

      // Scenario 6: Historical audit survives physical EMERGENCY_DELETE of period
      // Create a temporary period, close it, then emergency delete it
      const delPeriodRes = await api("POST", "/periods", {
        title: "Evaluasi PM Darurat Delete",
        type: "PM_EVALUATION",
        startDate: "2026-12-01",
        endDate: "2026-12-31"
      }, { id: ids.admin, role: "operator" });
      assert.equal(delPeriodRes.status, 201);
      const emgDelPeriodId = delPeriodRes.body.period.id;
      createdPeriodIds.push(emgDelPeriodId);

      // Explicitly transition to CLOSED status for emergency deletion scenario
      await pool.query("UPDATE evaluation_periods SET status = 'CLOSED' WHERE id = $1", [emgDelPeriodId]);

      const emgDeleteRes = await api("POST", `/periods/${emgDelPeriodId}/emergency-action`, {
        action: "EMERGENCY_DELETE",
        reason: "Pembatalan darurat periode akibat kesalahan administrasi fatal",
        confirmPeriodTitle: "Evaluasi PM Darurat Delete"
      }, { id: ids.admin, role: "operator" });
      assert.equal(emgDeleteRes.status, 200);
      assert.equal(emgDeleteRes.body.success, true);

      // Period is now deleted from DB
      const checkDeletedPeriod = await api("GET", `/periods/${emgDelPeriodId}`, null, { id: ids.admin, role: "operator" });
      assert.equal(checkDeletedPeriod.status, 404);

      // BUT audit record is PRESERVED!
      const checkSurvivingAudit = await api("GET", `/emergency-audits?periodId=${emgDelPeriodId}`, null, {
        id: ids.admin,
        role: "operator"
      });
      assert.equal(checkSurvivingAudit.status, 200);
      assert.equal(checkSurvivingAudit.body.audits.length, 1);
      assert.equal(checkSurvivingAudit.body.audits[0].action_type, "EMERGENCY_DELETE");
      assert.equal(checkSurvivingAudit.body.audits[0].period_id, emgDelPeriodId);

      // -------------------------------------------------------------------------
      // POLICY 2: DOSEN PM VISIBILITY & MONITORING GRANTS FLOW
      // -------------------------------------------------------------------------
      // Create January 2027 period where Dosen A is a PM evaluator
      const janPeriodRes = await api("POST", "/periods", {
        title: "Evaluasi PM Bulanan Januari 2027",
        type: "PM_EVALUATION",
        startDate: "2027-01-01",
        endDate: "2027-01-31"
      }, { id: ids.admin, role: "operator" });
      assert.equal(janPeriodRes.status, 201);
      const janPeriodId = janPeriodRes.body.period.id;
      createdPeriodIds.push(janPeriodId);

      // Set period status to OPEN
      await pool.query("UPDATE evaluation_periods SET status = 'OPEN' WHERE id = $1", [janPeriodId]);

      // Add Dosen A and PM B as evaluators
      await api("POST", `/periods/${janPeriodId}/evaluators`, { evaluatorId: ids.dosenA }, { id: ids.admin, role: "operator" });
      await api("POST", `/periods/${janPeriodId}/evaluators`, { evaluatorId: ids.pmB }, { id: ids.admin, role: "operator" });

      // Set attendance to PRESENT for both
      await api("PUT", `/periods/${janPeriodId}/evaluators/${ids.dosenA}/attendance`, { attendanceStatus: "PRESENT" }, { id: ids.admin, role: "operator" });
      await api("PUT", `/periods/${janPeriodId}/evaluators/${ids.pmB}/attendance`, { attendanceStatus: "PRESENT" }, { id: ids.admin, role: "operator" });

      // Create assignments:
      // Dosen A -> Student 1
      // PM B -> Student 2
      const asnDosenRes = await api("POST", "/pm/assignments", {
        periodId: janPeriodId,
        studentId: ids.std1,
        evaluatorId: ids.dosenA,
        divisionId: ids.divA
      }, { id: ids.admin, role: "operator" });
      assert.equal(asnDosenRes.status, 201);
      const dosenAssignmentId = asnDosenRes.body.assignment.id;

      const asnPmBRes = await api("POST", "/pm/assignments", {
        periodId: janPeriodId,
        studentId: ids.std2,
        evaluatorId: ids.pmB,
        divisionId: ids.divB
      }, { id: ids.admin, role: "operator" });
      assert.equal(asnPmBRes.status, 201);
      const pmBAssignmentId = asnPmBRes.body.assignment.id;

      // Scenario 8: Dosen PM reading own assignment when OPEN is allowed (200)
      const dosenReadOwnRes = await api("GET", `/pm/assignments/${dosenAssignmentId}`, null, {
        id: ids.dosenA,
        role: "dosen"
      });
      assert.equal(dosenReadOwnRes.status, 200);
      assert.equal(dosenReadOwnRes.body.assignment.id, dosenAssignmentId);

      const dosenListOwnRes = await api("GET", `/pm/assignments?periodId=${janPeriodId}`, null, {
        id: ids.dosenA,
        role: "dosen"
      });
      assert.equal(dosenListOwnRes.status, 200);
      assert.equal(dosenListOwnRes.body.assignments.length, 1);
      assert.equal(dosenListOwnRes.body.assignments[0].evaluatorId, ids.dosenA);

      // Scenario 9: Dosen PM reading other PM assignment when OPEN is rejected (403)
      const dosenReadOtherOpenRes = await api("GET", `/pm/assignments/${pmBAssignmentId}`, null, {
        id: ids.dosenA,
        role: "dosen"
      });
      assert.equal(dosenReadOtherOpenRes.status, 403);
      assert.match(dosenReadOtherOpenRes.body.message, /belum CLOSED/);

      const dosenFilterOtherOpenRes = await api("GET", `/pm/assignments?periodId=${janPeriodId}&evaluatorId=${ids.pmB}`, null, {
        id: ids.dosenA,
        role: "dosen"
      });
      assert.equal(dosenFilterOtherOpenRes.status, 403);
      assert.match(dosenFilterOtherOpenRes.body.message, /belum CLOSED/);

      // Scenario 14: Admin monitoring works, but Admin submit on PM assignment returns 403
      const adminReadPmRes = await api("GET", `/pm/assignments/${pmBAssignmentId}`, null, {
        id: ids.admin,
        role: "operator"
      });
      assert.equal(adminReadPmRes.status, 200);

      const adminSubmitRes = await api("PUT", `/pm/assignments/${pmBAssignmentId}/submission`, {
        status: "SUBMITTED",
        scores: [
          { criteriaKey: "quality_of_work", score: 8.0 },
          { criteriaKey: "responsibility", score: 8.0 },
          { criteriaKey: "technical_skill", score: 8.0 },
          { criteriaKey: "problem_solving", score: 8.0 },
          { criteriaKey: "collaboration", score: 8.0 },
          { criteriaKey: "initiative", score: 8.0 },
          { criteriaKey: "research_contribution", score: 8.0 }
        ]
      }, { id: ids.admin, role: "operator" });
      assert.equal(adminSubmitRes.status, 403);
      assert.match(adminSubmitRes.body.message, /tidak berhak menilai/);

      // Now PM B submits evaluation for Student 2
      await api("PUT", `/pm/assignments/${pmBAssignmentId}/submission`, {
        status: "SUBMITTED",
        scores: [
          { criteriaKey: "quality_of_work", score: 8.5 },
          { criteriaKey: "responsibility", score: 8.5 },
          { criteriaKey: "technical_skill", score: 8.5 },
          { criteriaKey: "problem_solving", score: 8.5 },
          { criteriaKey: "collaboration", score: 8.5 },
          { criteriaKey: "initiative", score: 8.5 },
          { criteriaKey: "research_contribution", score: 8.5 }
        ]
      }, { id: ids.pmB, role: "mahasiswa" });

      // Dosen A submits evaluation for Student 1
      await api("PUT", `/pm/assignments/${dosenAssignmentId}/submission`, {
        status: "SUBMITTED",
        scores: [
          { criteriaKey: "quality_of_work", score: 9.0 },
          { criteriaKey: "responsibility", score: 9.0 },
          { criteriaKey: "technical_skill", score: 9.0 },
          { criteriaKey: "problem_solving", score: 9.0 },
          { criteriaKey: "collaboration", score: 9.0 },
          { criteriaKey: "initiative", score: 9.0 },
          { criteriaKey: "research_contribution", score: 9.0 }
        ]
      }, { id: ids.dosenA, role: "dosen" });

      // Close January period
      await api("POST", `/periods/${janPeriodId}/close`, { force: true }, { id: ids.admin, role: "operator" });

      // Scenario 10: Dosen PM reading other PM after CLOSED WITHOUT grant returns 403
      const dosenReadWithoutGrant = await api("GET", `/pm/assignments/${pmBAssignmentId}`, null, {
        id: ids.dosenA,
        role: "dosen"
      });
      assert.equal(dosenReadWithoutGrant.status, 403);
      assert.match(dosenReadWithoutGrant.body.message, /izin monitoring/);

      const dosenRecapWithoutGrant = await api("GET", `/periods/${janPeriodId}/recap`, null, {
        id: ids.dosenA,
        role: "dosen"
      });
      assert.equal(dosenRecapWithoutGrant.status, 403);

      const dosenProgressWithoutGrant = await api("GET", `/periods/${janPeriodId}/progress`, null, {
        id: ids.dosenA,
        role: "dosen"
      });
      assert.equal(dosenProgressWithoutGrant.status, 403);

      // Scenario 11: Dosen PM reading other PM after CLOSED WITH active grant returns 200
      const grantCreateRes = await api("POST", "/monitoring-grants", {
        userId: ids.dosenA,
        periodId: janPeriodId,
        reason: "Pemberian izin monitoring resmi dewan dosen"
      }, { id: ids.admin, role: "operator" });
      assert.equal(grantCreateRes.status, 201);
      const grantId = grantCreateRes.body.grant.id;

      const dosenReadWithGrant = await api("GET", `/pm/assignments/${pmBAssignmentId}`, null, {
        id: ids.dosenA,
        role: "dosen"
      });
      assert.equal(dosenReadWithGrant.status, 200);
      assert.equal(dosenReadWithGrant.body.assignment.id, pmBAssignmentId);

      const dosenRecapWithGrant = await api("GET", `/periods/${janPeriodId}/recap`, null, {
        id: ids.dosenA,
        role: "dosen"
      });
      assert.equal(dosenRecapWithGrant.status, 200);

      const dosenProgressWithGrant = await api("GET", `/periods/${janPeriodId}/progress`, null, {
        id: ids.dosenA,
        role: "dosen"
      });
      assert.equal(dosenProgressWithGrant.status, 200);

      // Scenario 12: Dosen with REVOKED grant returns 403
      const revokeGrantRes = await api("DELETE", `/monitoring-grants/${grantId}`, null, {
        id: ids.admin,
        role: "operator"
      });
      assert.equal(revokeGrantRes.status, 200);

      const dosenReadRevoked = await api("GET", `/pm/assignments/${pmBAssignmentId}`, null, {
        id: ids.dosenA,
        role: "dosen"
      });
      assert.equal(dosenReadRevoked.status, 403);
      assert.match(dosenReadRevoked.body.message, /izin monitoring/);

      const dosenRecapRevoked = await api("GET", `/periods/${janPeriodId}/recap`, null, {
        id: ids.dosenA,
        role: "dosen"
      });
      assert.equal(dosenRecapRevoked.status, 403);

      // Scenario 13: Dosen cannot access results OUT OF SCOPE of grant (403)
      // Grant given specifically for novPeriodId
      await api("POST", "/monitoring-grants", {
        userId: ids.dosenB,
        periodId: novPeriodId,
        reason: "Izin khusus periode November saja"
      }, { id: ids.admin, role: "operator" });

      // Dosen B attempts to access janPeriodId -> 403
      const dosenOutScopeRes = await api("GET", `/periods/${janPeriodId}/recap`, null, {
        id: ids.dosenB,
        role: "dosen"
      });
      assert.equal(dosenOutScopeRes.status, 403);

      // Dosen B attempts to access novPeriodId (within scope) -> 200
      const dosenInScopeRes = await api("GET", `/periods/${novPeriodId}/recap`, null, {
        id: ids.dosenB,
        role: "dosen"
      });
      assert.equal(dosenInScopeRes.status, 200);
    }

  } finally {
    await cleanup();
    server.close();
  }
});
