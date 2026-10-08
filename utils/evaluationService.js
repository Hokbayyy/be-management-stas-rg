const crypto = require("crypto");
const { pool, query } = require("../db/pool");
const { resolveStudentId, resolveStudentRecord } = require("./studentResolver");

function buildId(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
}

function runQuery(executor, text, params) {
  if (typeof executor === "function") return executor(text, params);
  return executor.query(text, params);
}

function normalizeIsoDate(value, fallback = null) {
  const text = String(value || fallback || "").trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const error = new Error("Format tanggal harus YYYY-MM-DD.");
    error.statusCode = 400;
    throw error;
  }
  return text;
}

function createHttpError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

const INITIAL_PM_CRITERIA = [
  { key: "quality_of_work", name: "Quality of Work", sort_order: 1, min_score: 1.0, max_score: 10.0 },
  { key: "responsibility", name: "Responsibility", sort_order: 2, min_score: 1.0, max_score: 10.0 },
  { key: "technical_skill", name: "Technical Skill", sort_order: 3, min_score: 1.0, max_score: 10.0 },
  { key: "problem_solving", name: "Problem Solving", sort_order: 4, min_score: 1.0, max_score: 10.0 },
  { key: "collaboration", name: "Collaboration", sort_order: 5, min_score: 1.0, max_score: 10.0 },
  { key: "initiative", name: "Initiative", sort_order: 6, min_score: 1.0, max_score: 10.0 },
  { key: "research_contribution", name: "Research Contribution", sort_order: 7, min_score: 1.0, max_score: 10.0 }
];

const INITIAL_PRESENTATION_CRITERIA = [
  { key: "progress_achievement", name: "Progress Achievement", sort_order: 1, min_score: 1.0, max_score: 10.0 },
  { key: "quality_of_result", name: "Quality of Result", sort_order: 2, min_score: 1.0, max_score: 10.0 },
  { key: "technical_understanding", name: "Technical Understanding", sort_order: 3, min_score: 1.0, max_score: 10.0 },
  { key: "problem_solving", name: "Problem Solving", sort_order: 4, min_score: 1.0, max_score: 10.0 },
  { key: "presentation_delivery", name: "Presentation Delivery", sort_order: 5, min_score: 1.0, max_score: 10.0 },
  { key: "response_to_questions", name: "Response to Questions", sort_order: 6, min_score: 1.0, max_score: 10.0 },
  { key: "next_plan", name: "Next Plan", sort_order: 7, min_score: 1.0, max_score: 10.0 }
];

function validateScoreRange(score) {
  if (score === null || score === undefined || score === "") return false;
  const num = Number(score);
  return !isNaN(num) && num >= 1.0 && num <= 10.0;
}

function calculateAverageScore(scores) {
  if (!Array.isArray(scores)) return null;
  const validScores = scores
    .map((s) => (s == null ? null : Number(s)))
    .filter((s) => s !== null && !isNaN(s));
  if (validScores.length === 0) return null;
  const sum = validScores.reduce((acc, curr) => acc + curr, 0);
  return Math.round((sum / validScores.length) * 100) / 100;
}

function formatDateOnly(value) {
  if (!value) return null;
  if (typeof value === "string") return value.slice(0, 10);
  if (value instanceof Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  return String(value).slice(0, 10);
}

function mapPeriodRow(row) {
  if (!row) return null;
  const startDate = formatDateOnly(row.start_date);
  const endDate = formatDateOnly(row.end_date);
  const evaluationMonth = startDate ? startDate.slice(0, 7) : null;
  const type = row.type === "PM_BIWEEKLY" ? "PM_EVALUATION" : row.type;
  return {
    ...row,
    type,
    startDate,
    endDate,
    start_date: startDate,
    end_date: endDate,
    evaluationMonth,
    evaluation_month: evaluationMonth,
    periodType: type,
    period_type: type,
    createdBy: row.created_by,
    creatorName: row.creator_name || null,
    openedAt: row.opened_at || null,
    closedAt: row.closed_at || null,
    totalAssignments: row.total_assignments != null ? Number(row.total_assignments) : undefined,
    totalSessions: row.total_sessions != null ? Number(row.total_sessions) : undefined
  };
}

function mapAssignmentRow(row) {
  if (!row) return null;
  return {
    ...row,
    assignmentId: row.id,
    periodId: row.period_id,
    studentId: row.student_id,
    studentName: row.student_name,
    evaluatorId: row.evaluator_id,
    evaluatorName: row.evaluator_name,
    divisionId: row.division_id || null,
    divisionName: row.division_name || "Tanpa Divisi",
    projectId: row.project_id || null,
    submissionId: row.submission_id || null,
    submissionStatus: row.submission_status || row.status || "PENDING",
    overallScore: row.overall_score != null ? Number(row.overall_score) : null,
    submittedAt: row.submitted_at || null
  };
}

function mapScoreItemRow(row) {
  if (!row) return null;
  return {
    ...row,
    criteriaId: row.criteria_id,
    criteriaKey: row.criteria_key,
    criteriaName: row.criteria_name,
    criteriaDescription: row.criteria_description || null,
    score: Number(row.score),
    notes: row.notes || null
  };
}

function mapSubmissionRow(row) {
  if (!row) return null;
  return {
    ...row,
    submissionId: row.id,
    periodId: row.period_id,
    studentId: row.student_id,
    evaluatorId: row.evaluator_id,
    assignmentId: row.assignment_id || null,
    slotId: row.slot_id || null,
    overallScore: row.overall_score != null ? Number(row.overall_score) : null,
    overall_score: row.overall_score != null ? Number(row.overall_score) : null,
    submittedAt: row.submitted_at || null,
    submitted_at: row.submitted_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function checkUserIsPm(userId, periodId = null, executor = query) {
  if (!userId) return false;
  if (periodId) {
    const res = await runQuery(
      executor,
      `SELECT 1 FROM evaluation_assignments WHERE period_id = $1 AND evaluator_id = $2 LIMIT 1`,
      [periodId, userId]
    );
    if (res.rowCount > 0) return true;
  }
  const divRes = await runQuery(
    executor,
    `SELECT 1 FROM research_divisions WHERE coordinator_id = $1 AND is_active = TRUE LIMIT 1`,
    [userId]
  );
  if (divRes.rowCount > 0) return true;

  const memRes = await runQuery(
    executor,
    `SELECT 1 FROM research_memberships WHERE user_id = $1 AND status = 'Aktif' AND (peran ILIKE '%PM%' OR peran ILIKE '%Project Manager%' OR peran ILIKE '%Koordinator%') LIMIT 1`,
    [userId]
  );
  return memRes.rowCount > 0;
}

// =============================================================================
// ENSURE TABLES & CRITERIA (Idempotent Migration Assurance)
// =============================================================================
async function ensureEvaluationTables(executor = query) {
  await runQuery(
    executor,
    `
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'evaluation_periods'::regclass AND conname = 'evaluation_periods_type_check'
      ) THEN
        ALTER TABLE evaluation_periods DROP CONSTRAINT evaluation_periods_type_check;
      END IF;
      UPDATE evaluation_periods SET type = 'PM_EVALUATION' WHERE type = 'PM_BIWEEKLY';
      ALTER TABLE evaluation_periods ADD CONSTRAINT evaluation_periods_type_check
        CHECK (type IN ('PM_EVALUATION', 'MONTHLY_PRESENTATION'));

      IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'evaluation_criteria'::regclass AND conname = 'evaluation_criteria_period_type_check'
      ) THEN
        ALTER TABLE evaluation_criteria DROP CONSTRAINT evaluation_criteria_period_type_check;
      END IF;
      UPDATE evaluation_criteria SET period_type = 'PM_EVALUATION' WHERE period_type = 'PM_BIWEEKLY';
      ALTER TABLE evaluation_criteria ADD CONSTRAINT evaluation_criteria_period_type_check
        CHECK (period_type IN ('PM_EVALUATION', 'MONTHLY_PRESENTATION'));
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END $$;

    CREATE TABLE IF NOT EXISTS evaluation_periods (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('PM_EVALUATION', 'MONTHLY_PRESENTATION')),
      status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'OPEN', 'CLOSED')),
      start_date DATE NOT NULL,
      end_date DATE NOT NULL,
      description TEXT,
      created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      opened_at TIMESTAMPTZ,
      closed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS evaluation_criteria (
      id TEXT PRIMARY KEY,
      period_type TEXT NOT NULL CHECK (period_type IN ('PM_EVALUATION', 'MONTHLY_PRESENTATION')),
      key TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      min_score NUMERIC(4, 2) NOT NULL DEFAULT 1.0,
      max_score NUMERIC(4, 2) NOT NULL DEFAULT 10.0,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (period_type, key)
    );

    INSERT INTO evaluation_criteria (id, period_type, key, name, sort_order, min_score, max_score, is_active)
    VALUES
      ('CRT-PM-01', 'PM_EVALUATION', 'quality_of_work', 'Quality of Work', 1, 1.0, 10.0, TRUE),
      ('CRT-PM-02', 'PM_EVALUATION', 'responsibility', 'Responsibility', 2, 1.0, 10.0, TRUE),
      ('CRT-PM-03', 'PM_EVALUATION', 'technical_skill', 'Technical Skill', 3, 1.0, 10.0, TRUE),
      ('CRT-PM-04', 'PM_EVALUATION', 'problem_solving', 'Problem Solving', 4, 1.0, 10.0, TRUE),
      ('CRT-PM-05', 'PM_EVALUATION', 'collaboration', 'Collaboration', 5, 1.0, 10.0, TRUE),
      ('CRT-PM-06', 'PM_EVALUATION', 'initiative', 'Initiative', 6, 1.0, 10.0, TRUE),
      ('CRT-PM-07', 'PM_EVALUATION', 'research_contribution', 'Research Contribution', 7, 1.0, 10.0, TRUE),

      ('CRT-PR-01', 'MONTHLY_PRESENTATION', 'progress_achievement', 'Progress Achievement', 1, 1.0, 10.0, TRUE),
      ('CRT-PR-02', 'MONTHLY_PRESENTATION', 'quality_of_result', 'Quality of Result', 2, 1.0, 10.0, TRUE),
      ('CRT-PR-03', 'MONTHLY_PRESENTATION', 'technical_understanding', 'Technical Understanding', 3, 1.0, 10.0, TRUE),
      ('CRT-PR-04', 'MONTHLY_PRESENTATION', 'problem_solving', 'Problem Solving', 4, 1.0, 10.0, TRUE),
      ('CRT-PR-05', 'MONTHLY_PRESENTATION', 'presentation_delivery', 'Presentation Delivery', 5, 1.0, 10.0, TRUE),
      ('CRT-PR-06', 'MONTHLY_PRESENTATION', 'response_to_questions', 'Response to Questions', 6, 1.0, 10.0, TRUE),
      ('CRT-PR-07', 'MONTHLY_PRESENTATION', 'next_plan', 'Next Plan', 7, 1.0, 10.0, TRUE)
    ON CONFLICT (period_type, key) DO UPDATE SET
      name = EXCLUDED.name,
      sort_order = EXCLUDED.sort_order;

    CREATE TABLE IF NOT EXISTS evaluation_assignments (
      id TEXT PRIMARY KEY,
      period_id TEXT NOT NULL REFERENCES evaluation_periods(id) ON DELETE CASCADE,
      student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      evaluator_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      division_id TEXT REFERENCES research_divisions(id) ON DELETE SET NULL,
      division_name TEXT,
      project_id TEXT REFERENCES research_projects(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'DRAFT', 'SUBMITTED')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (period_id, student_id, evaluator_id)
    );

    CREATE TABLE IF NOT EXISTS presentation_sessions (
      id TEXT PRIMARY KEY,
      period_id TEXT NOT NULL REFERENCES evaluation_periods(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      session_date DATE NOT NULL,
      start_time TIME,
      end_time TIME,
      location TEXT,
      notes TEXT,
      created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS presentation_evaluators (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES presentation_sessions(id) ON DELETE CASCADE,
      evaluator_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT,
      is_present BOOLEAN NOT NULL DEFAULT TRUE,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (session_id, evaluator_id)
    );

    CREATE TABLE IF NOT EXISTS presentation_slots (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES presentation_sessions(id) ON DELETE CASCADE,
      student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      slot_order INTEGER NOT NULL DEFAULT 1,
      start_time TIME,
      end_time TIME,
      status TEXT NOT NULL DEFAULT 'SCHEDULED'
        CHECK (status IN ('SCHEDULED', 'PRESENTING', 'COMPLETED', 'ABSENT', 'RESCHEDULED')),
      division_id TEXT REFERENCES research_divisions(id) ON DELETE SET NULL,
      division_name TEXT,
      project_id TEXT REFERENCES research_projects(id) ON DELETE SET NULL,
      topic TEXT,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (session_id, student_id)
    );

    CREATE TABLE IF NOT EXISTS evaluation_submissions (
      id TEXT PRIMARY KEY,
      period_id TEXT NOT NULL REFERENCES evaluation_periods(id) ON DELETE CASCADE,
      student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      evaluator_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      assignment_id TEXT REFERENCES evaluation_assignments(id) ON DELETE CASCADE,
      slot_id TEXT REFERENCES presentation_slots(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED')),
      overall_score NUMERIC(4, 2),
      strength TEXT,
      improvement TEXT,
      notes TEXT,
      submitted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT chk_eval_submission_target CHECK (
        (assignment_id IS NOT NULL AND slot_id IS NULL) OR
        (slot_id IS NOT NULL AND assignment_id IS NULL)
      ),
      CONSTRAINT uq_eval_submission_assignment UNIQUE (assignment_id),
      CONSTRAINT uq_eval_submission_slot_evaluator UNIQUE (slot_id, evaluator_id)
    );

    CREATE TABLE IF NOT EXISTS evaluation_score_items (
      id TEXT PRIMARY KEY,
      submission_id TEXT NOT NULL REFERENCES evaluation_submissions(id) ON DELETE CASCADE,
      criteria_id TEXT NOT NULL REFERENCES evaluation_criteria(id) ON DELETE CASCADE,
      criteria_key TEXT NOT NULL,
      score NUMERIC(4, 2) NOT NULL CHECK (score >= 1.0 AND score <= 10.0),
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (submission_id, criteria_id)
    );

    ALTER TABLE research_divisions
      ADD COLUMN IF NOT EXISTS coordinator_id TEXT REFERENCES users(id) ON DELETE SET NULL;

    ALTER TABLE research_memberships
      ADD COLUMN IF NOT EXISTS division_id TEXT REFERENCES research_divisions(id) ON DELETE SET NULL;
    `
  );
}

// =============================================================================
// EVALUATION PERIODS
// =============================================================================

async function listEvaluationPeriods({ type = null, status = null, limit = 50, offset = 0 } = {}, executor = query) {
  await ensureEvaluationTables(executor);
  const conditions = [];
  const params = [];

  if (type) {
    const normalizedType = type === "PM_BIWEEKLY" ? "PM_EVALUATION" : type;
    params.push(normalizedType);
    conditions.push(`type = $${params.length}`);
  }
  if (status) {
    params.push(status);
    conditions.push(`status = $${params.length}`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  params.push(limit);
  const limitIndex = params.length;
  params.push(offset);
  const offsetIndex = params.length;

  const result = await runQuery(
    executor,
    `
    SELECT ep.*, u.name AS creator_name,
           (SELECT COUNT(*)::int FROM evaluation_assignments ea WHERE ea.period_id = ep.id) AS total_assignments,
           (SELECT COUNT(*)::int FROM presentation_sessions ps WHERE ps.period_id = ep.id) AS total_sessions
    FROM evaluation_periods ep
    LEFT JOIN users u ON u.id = ep.created_by
    ${whereClause}
    ORDER BY ep.start_date DESC, ep.created_at DESC
    LIMIT $${limitIndex} OFFSET $${offsetIndex}
    `,
    params
  );

  return result.rows.map(mapPeriodRow);
}

async function getEvaluationPeriodById(id, executor = query) {
  await ensureEvaluationTables(executor);
  const result = await runQuery(
    executor,
    `
    SELECT ep.*, u.name AS creator_name,
           (SELECT COUNT(*)::int FROM evaluation_assignments ea WHERE ea.period_id = ep.id) AS total_assignments,
           (SELECT COUNT(*)::int FROM presentation_sessions ps WHERE ps.period_id = ep.id) AS total_sessions
    FROM evaluation_periods ep
    LEFT JOIN users u ON u.id = ep.created_by
    WHERE ep.id = $1
    LIMIT 1
    `,
    [id]
  );
  return result.rows[0] ? mapPeriodRow(result.rows[0]) : null;
}

async function createEvaluationPeriod(payload = {}, createdBy = null, executor = query) {
  await ensureEvaluationTables(executor);
  const title = String(payload.title || "").trim();
  let type = String(payload.type || "").trim();
  if (type === "PM_BIWEEKLY") {
    type = "PM_EVALUATION";
  }
  const startDate = normalizeIsoDate(payload.startDate || payload.start_date);
  const endDate = normalizeIsoDate(payload.endDate || payload.end_date);
  const description = payload.description ? String(payload.description).trim() : null;

  if (!title) throw createHttpError("Judul periode evaluasi wajib diisi.", 400);
  if (!["PM_EVALUATION", "MONTHLY_PRESENTATION"].includes(type)) {
    throw createHttpError("type periode harus PM_EVALUATION atau MONTHLY_PRESENTATION.", 400);
  }
  if (startDate > endDate) {
    throw createHttpError("start_date tidak boleh lebih besar dari end_date.", 400);
  }

  const evaluationMonth = startDate.slice(0, 7);

  // Validate: dalam scope bulan yang sama tidak dibuat lebih dari 1 PM_EVALUATION dan 1 MONTHLY_PRESENTATION
  const duplicateRes = await runQuery(
    executor,
    `
    SELECT id, title, type, start_date
    FROM evaluation_periods
    WHERE type = $1 AND TO_CHAR(start_date, 'YYYY-MM') = $2
    LIMIT 1
    `,
    [type, evaluationMonth]
  );

  if (duplicateRes.rowCount > 0) {
    const existing = duplicateRes.rows[0];
    throw createHttpError(
      `Periode evaluasi jenis ${type} untuk bulan ${evaluationMonth} sudah ada (${existing.title}). Dalam 1 bulan hanya diperbolehkan 1 ${type}.`,
      409
    );
  }

  const id = buildId("EVP");
  const result = await runQuery(
    executor,
    `
    INSERT INTO evaluation_periods (id, title, type, status, start_date, end_date, description, created_by)
    VALUES ($1, $2, $3, 'DRAFT', $4::date, $5::date, $6, $7)
    RETURNING *
    `,
    [id, title, type, startDate, endDate, description, createdBy]
  );

  return mapPeriodRow(result.rows[0]);
}

async function updateEvaluationPeriod(id, payload = {}, executor = query) {
  await ensureEvaluationTables(executor);
  const period = await getEvaluationPeriodById(id, executor);
  if (!period) throw createHttpError("Periode evaluasi tidak ditemukan.", 404);
  if (period.status === "CLOSED") {
    throw createHttpError("Periode evaluasi sudah ditutup dan tidak dapat diubah.", 409);
  }

  const title = payload.title !== undefined ? String(payload.title).trim() : period.title;
  const description = payload.description !== undefined ? String(payload.description).trim() : period.description;
  const startDate = payload.startDate || payload.start_date
    ? normalizeIsoDate(payload.startDate || payload.start_date)
    : period.start_date;
  const endDate = payload.endDate || payload.end_date
    ? normalizeIsoDate(payload.endDate || payload.end_date)
    : period.end_date;

  if (startDate > endDate) {
    throw createHttpError("start_date tidak boleh lebih besar dari end_date.", 400);
  }

  if (payload.startDate || payload.start_date) {
    const targetMonth = startDate.slice(0, 7);
    const duplicateRes = await runQuery(
      executor,
      `
      SELECT id, title, type
      FROM evaluation_periods
      WHERE type = $1 AND TO_CHAR(start_date, 'YYYY-MM') = $2 AND id != $3
      LIMIT 1
      `,
      [period.type, targetMonth, id]
    );
    if (duplicateRes.rowCount > 0) {
      throw createHttpError(
        `Periode evaluasi jenis ${period.type} untuk bulan ${targetMonth} sudah ada (${duplicateRes.rows[0].title}). Dalam 1 bulan hanya diperbolehkan 1 ${period.type}.`,
        409
      );
    }
  }

  const result = await runQuery(
    executor,
    `
    UPDATE evaluation_periods
    SET title = $2, description = $3, start_date = $4::date, end_date = $5::date, updated_at = NOW()
    WHERE id = $1
    RETURNING *
    `,
    [id, title, description, startDate, endDate]
  );

  return mapPeriodRow(result.rows[0]);
}

async function openEvaluationPeriod(id, openedBy = null, executor = pool) {
  await ensureEvaluationTables(executor);
  const client = typeof executor.connect === "function" ? await executor.connect() : executor;
  const ownsTransaction = typeof executor.connect === "function";

  try {
    if (ownsTransaction) await client.query("BEGIN");

    const periodRes = await client.query(
      "SELECT * FROM evaluation_periods WHERE id = $1 FOR UPDATE",
      [id]
    );
    if (periodRes.rowCount === 0) throw createHttpError("Periode evaluasi tidak ditemukan.", 404);
    const period = periodRes.rows[0];

    if (period.status === "CLOSED") {
      throw createHttpError("Periode evaluasi sudah ditutup dan tidak dapat dibuka kembali.", 409);
    }
    if (period.status === "OPEN") {
      if (ownsTransaction) await client.query("COMMIT");
      return period;
    }

    // Snapshot target students if period is PM_EVALUATION
    if (period.type === "PM_EVALUATION" || period.type === "PM_BIWEEKLY") {
      // Find active students enrolled in research projects and divisions with their designated coordinator
      const targetStudents = await client.query(
        `
        SELECT s.id AS student_id, s.user_id, u.name AS student_name, s.nim,
               rm.project_id, rp.title AS project_title,
               COALESCE(rm.division_id, rd.id) AS division_id,
               rd.name AS division_name,
               COALESCE(rd.coordinator_id, (
                 SELECT pm_m.user_id
                 FROM research_memberships pm_m
                 WHERE pm_m.project_id = rm.project_id
                   AND (pm_m.peran ILIKE '%PM%' OR pm_m.peran ILIKE '%Project Manager%' OR pm_m.peran ILIKE '%Koordinator%')
                   AND pm_m.status = 'Aktif'
                 LIMIT 1
               )) AS coordinator_id
        FROM students s
        JOIN users u ON u.id = s.user_id
        JOIN research_memberships rm ON rm.user_id = u.id AND rm.member_type = 'Mahasiswa' AND rm.status = 'Aktif'
        JOIN research_projects rp ON rp.id = rm.project_id
        LEFT JOIN research_divisions rd ON (
          (rm.division_id IS NOT NULL AND rd.id = rm.division_id)
          OR (rm.division_id IS NULL AND rd.project_id = rm.project_id AND rd.is_active = TRUE)
        )
        WHERE s.status = 'Aktif'
          AND s.status NOT IN ('Alumni', 'Lulus', 'Mengundurkan Diri')
        ORDER BY s.id, rd.sort_order ASC
        `
      );

      // Create snapshot assignments for students who have an assigned coordinator
      const seen = new Set();
      for (const row of targetStudents.rows) {
        if (!row.coordinator_id) continue;
        const key = `${period.id}:${row.student_id}:${row.coordinator_id}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const assignmentId = buildId("EVA-ASN");
        await client.query(
          `
          INSERT INTO evaluation_assignments (
            id, period_id, student_id, evaluator_id, division_id, division_name, project_id, status
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, 'PENDING')
          ON CONFLICT (period_id, student_id, evaluator_id) DO NOTHING
          `,
          [
            assignmentId,
            period.id,
            row.student_id,
            row.coordinator_id,
            row.division_id || null,
            row.division_name || null,
            row.project_id || null
          ]
        );
      }
    }

    const updatedRes = await client.query(
      `
      UPDATE evaluation_periods
      SET status = 'OPEN', opened_at = NOW(), updated_at = NOW()
      WHERE id = $1
      RETURNING *
      `,
      [id]
    );

    if (ownsTransaction) await client.query("COMMIT");
    return mapPeriodRow(updatedRes.rows[0]);
  } catch (error) {
    if (ownsTransaction) await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    if (ownsTransaction) client.release();
  }
}

async function closeEvaluationPeriod(id, closedBy = null, executor = pool) {
  await ensureEvaluationTables(executor);
  const client = typeof executor.connect === "function" ? await executor.connect() : executor;
  const ownsTransaction = typeof executor.connect === "function";

  try {
    if (ownsTransaction) await client.query("BEGIN");

    const periodRes = await client.query(
      "SELECT * FROM evaluation_periods WHERE id = $1 FOR UPDATE",
      [id]
    );
    if (periodRes.rowCount === 0) throw createHttpError("Periode evaluasi tidak ditemukan.", 404);
    const period = periodRes.rows[0];

    if (period.status === "CLOSED") {
      if (ownsTransaction) await client.query("COMMIT");
      return mapPeriodRow(period);
    }

    const updatedRes = await client.query(
      `
      UPDATE evaluation_periods
      SET status = 'CLOSED', closed_at = NOW(), updated_at = NOW()
      WHERE id = $1
      RETURNING *
      `,
      [id]
    );

    if (ownsTransaction) await client.query("COMMIT");
    return mapPeriodRow(updatedRes.rows[0]);
  } catch (error) {
    if (ownsTransaction) await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    if (ownsTransaction) client.release();
  }
}

// =============================================================================
// EVALUATION CRITERIA
// =============================================================================

async function listEvaluationCriteria(periodType = null, executor = query) {
  await ensureEvaluationTables(executor);
  const params = [];
  let where = "WHERE is_active = TRUE";
  if (periodType) {
    const normalizedType = periodType === "PM_BIWEEKLY" ? "PM_EVALUATION" : periodType;
    params.push(normalizedType);
    where += ` AND (period_type = $1 OR ($1 = 'PM_EVALUATION' AND period_type = 'PM_BIWEEKLY'))`;
  }
  const result = await runQuery(
    executor,
    `
    SELECT *
    FROM evaluation_criteria
    ${where}
    ORDER BY period_type ASC, sort_order ASC
    `,
    params
  );
  return result.rows;
}

// =============================================================================
// PM EVALUATION ASSIGNMENTS
// =============================================================================

async function listPmAssignments({ periodId, evaluatorId = null, divisionId = null, status = null } = {}, executor = query) {
  await ensureEvaluationTables(executor);
  if (!periodId) throw createHttpError("periodId wajib diisi.", 400);

  const conditions = ["ea.period_id = $1"];
  const params = [periodId];

  if (evaluatorId) {
    params.push(evaluatorId);
    conditions.push(`ea.evaluator_id = $${params.length}`);
  }
  if (divisionId) {
    params.push(divisionId);
    conditions.push(`ea.division_id = $${params.length}`);
  }
  if (status) {
    params.push(status);
    conditions.push(`ea.status = $${params.length}`);
  }

  const result = await runQuery(
    executor,
    `
    SELECT ea.*,
           s.nim, u_student.name AS student_name,
           u_evaluator.name AS evaluator_name,
           es.id AS submission_id,
           es.status AS submission_status,
           es.overall_score,
           es.strength,
           es.improvement,
           es.submitted_at
    FROM evaluation_assignments ea
    JOIN students s ON s.id = ea.student_id
    JOIN users u_student ON u_student.id = s.user_id
    JOIN users u_evaluator ON u_evaluator.id = ea.evaluator_id
    LEFT JOIN evaluation_submissions es ON es.assignment_id = ea.id
    WHERE ${conditions.join(" AND ")}
    ORDER BY ea.division_name ASC NULLS LAST, u_student.name ASC
    `,
    params
  );

  return result.rows.map(mapAssignmentRow);
}

async function getPmAssignmentById(id, executor = query) {
  await ensureEvaluationTables(executor);
  const result = await runQuery(
    executor,
    `
    SELECT ea.*,
           ep.title AS period_title, ep.status AS period_status, ep.type AS period_type,
           s.nim, u_student.name AS student_name,
           u_evaluator.name AS evaluator_name,
           es.id AS submission_id,
           es.status AS submission_status,
           es.overall_score,
           es.strength,
           es.improvement,
           es.notes AS submission_notes,
           es.submitted_at
    FROM evaluation_assignments ea
    JOIN evaluation_periods ep ON ep.id = ea.period_id
    JOIN students s ON s.id = ea.student_id
    JOIN users u_student ON u_student.id = s.user_id
    JOIN users u_evaluator ON u_evaluator.id = ea.evaluator_id
    LEFT JOIN evaluation_submissions es ON es.assignment_id = ea.id
    WHERE ea.id = $1
    LIMIT 1
    `,
    [id]
  );
  if (result.rowCount === 0) return null;
  const assignment = result.rows[0];
  const mapped = mapAssignmentRow(assignment);

  if (assignment.submission_id) {
    const scores = await runQuery(
      executor,
      `
      SELECT esi.*, ec.name AS criteria_name, ec.description AS criteria_description, ec.sort_order
      FROM evaluation_score_items esi
      JOIN evaluation_criteria ec ON ec.id = esi.criteria_id
      WHERE esi.submission_id = $1
      ORDER BY ec.sort_order ASC
      `,
      [assignment.submission_id]
    );
    mapped.scores = scores.rows.map(mapScoreItemRow);
  } else {
    mapped.scores = [];
  }

  return mapped;
}

async function createPmAssignment(payload = {}, executor = query) {
  await ensureEvaluationTables(executor);
  const { periodId, studentId, evaluatorId, divisionId, divisionName, projectId } = payload;
  if (!periodId || !studentId || !evaluatorId) {
    throw createHttpError("periodId, studentId, dan evaluatorId wajib diisi.", 400);
  }

  const period = await getEvaluationPeriodById(periodId, executor);
  if (!period) throw createHttpError("Periode evaluasi tidak ditemukan.", 404);
  if (period.status === "CLOSED") {
    throw createHttpError("Periode evaluasi sudah ditutup dan tidak dapat diubah.", 409);
  }

  const resolvedStdId = await resolveStudentId(studentId);
  if (!resolvedStdId) throw createHttpError("Mahasiswa tidak ditemukan.", 404);

  let finalDivisionName = divisionName || null;
  if (divisionId && !finalDivisionName) {
    const divRes = await runQuery(executor, "SELECT name FROM research_divisions WHERE id = $1 LIMIT 1", [divisionId]);
    finalDivisionName = divRes.rows[0]?.name || null;
  }

  const id = buildId("EVA-ASN");
  const result = await runQuery(
    executor,
    `
    INSERT INTO evaluation_assignments (
      id, period_id, student_id, evaluator_id, division_id, division_name, project_id, status
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, 'PENDING')
    ON CONFLICT (period_id, student_id, evaluator_id)
    DO UPDATE SET division_id = EXCLUDED.division_id,
                  division_name = EXCLUDED.division_name,
                  project_id = EXCLUDED.project_id,
                  updated_at = NOW()
    RETURNING *
    `,
    [id, periodId, resolvedStdId, evaluatorId, divisionId || null, finalDivisionName, projectId || null]
  );

  return result.rows[0];
}

// =============================================================================
// SUBMISSION: PM BIWEEKLY EVALUATION (Draft & Submit)
// =============================================================================

async function savePmEvaluationSubmission(assignmentId, evaluatorId, payload = {}, executor = pool) {
  await ensureEvaluationTables(executor);
  const client = typeof executor.connect === "function" ? await executor.connect() : executor;
  const ownsTransaction = typeof executor.connect === "function";

  try {
    if (ownsTransaction) await client.query("BEGIN");

    const asnRes = await client.query(
      `
      SELECT ea.*, ep.status AS period_status, ep.type AS period_type
      FROM evaluation_assignments ea
      JOIN evaluation_periods ep ON ep.id = ea.period_id
      WHERE ea.id = $1
      FOR UPDATE OF ea
      `,
      [assignmentId]
    );

    if (asnRes.rowCount === 0) throw createHttpError("Penugasan evaluasi tidak ditemukan.", 404);
    const assignment = asnRes.rows[0];

    if (assignment.period_status === "CLOSED") {
      throw createHttpError("Periode evaluasi sudah ditutup dan tidak dapat diubah.", 409);
    }

    // Permission: Evaluator must be assigned evaluator (or caller handled admin bypass)
    if (evaluatorId && assignment.evaluator_id !== evaluatorId) {
      throw createHttpError("Akses ditolak. Anda tidak berhak menilai penugasan ini.", 403);
    }

    const targetStatus = String(payload.status || "DRAFT").toUpperCase();
    if (!["DRAFT", "SUBMITTED"].includes(targetStatus)) {
      throw createHttpError("Status evaluasi harus DRAFT atau SUBMITTED.", 400);
    }

    const rawScores = Array.isArray(payload.scores) ? payload.scores : [];
    const strength = payload.strength != null ? String(payload.strength).trim() : null;
    const improvement = payload.improvement != null ? String(payload.improvement).trim() : null;
    const notes = payload.notes != null ? String(payload.notes).trim() : null;

    // Fetch active criteria for PM_EVALUATION
    const criteriaList = (await client.query(
      "SELECT * FROM evaluation_criteria WHERE (period_type = 'PM_EVALUATION' OR period_type = 'PM_BIWEEKLY') AND is_active = TRUE ORDER BY sort_order ASC"
    )).rows;
    const criteriaByKey = new Map(criteriaList.map((c) => [c.key, c]));

    // Validate score values (must be between 1.0 and 10.0)
    const scoreMap = new Map();
    for (const item of rawScores) {
      const key = String(item.criteriaKey || item.criteria_key || "").trim();
      const numScore = Number(item.score);
      if (item.score != null && (isNaN(numScore) || numScore < 1.0 || numScore > 10.0)) {
        throw createHttpError(`Nilai untuk kriteria '${key}' harus berupa angka antara 1.0 dan 10.0.`, 400);
      }
      if (key && criteriaByKey.has(key)) {
        scoreMap.set(key, {
          criteria: criteriaByKey.get(key),
          score: Math.round(numScore * 100) / 100,
          notes: item.notes ? String(item.notes).trim() : null
        });
      }
    }

    // If SUBMITTED: all 7 criteria are mandatory
    if (targetStatus === "SUBMITTED") {
      for (const criteria of criteriaList) {
        if (!scoreMap.has(criteria.key)) {
          throw createHttpError(`Seluruh 7 kriteria wajib diisi sebelum submit (kurang: ${criteria.name}).`, 422);
        }
      }
    }

    // Calculate overall score (average of provided scores)
    let overallScore = null;
    if (scoreMap.size > 0) {
      const sum = Array.from(scoreMap.values()).reduce((acc, curr) => acc + curr.score, 0);
      overallScore = Math.round((sum / scoreMap.size) * 100) / 100;
    }

    // Check existing submission for this assignment
    const existingSubRes = await client.query(
      "SELECT id FROM evaluation_submissions WHERE assignment_id = $1 LIMIT 1",
      [assignmentId]
    );

    let submissionId;
    if (existingSubRes.rowCount > 0) {
      submissionId = existingSubRes.rows[0].id;
      await client.query(
        `
        UPDATE evaluation_submissions
        SET status = $2, overall_score = $3, strength = $4, improvement = $5, notes = $6,
            submitted_at = CASE WHEN $2 = 'SUBMITTED' THEN NOW() ELSE submitted_at END,
            updated_at = NOW()
        WHERE id = $1
        `,
        [submissionId, targetStatus, overallScore, strength, improvement, notes]
      );
    } else {
      submissionId = buildId("EVA-SUB");
      await client.query(
        `
        INSERT INTO evaluation_submissions (
          id, period_id, student_id, evaluator_id, assignment_id, slot_id, status,
          overall_score, strength, improvement, notes, submitted_at
        )
        VALUES ($1, $2, $3, $4, $5, NULL, $6, $7, $8, $9, $10, CASE WHEN $6 = 'SUBMITTED' THEN NOW() ELSE NULL END)
        `,
        [
          submissionId,
          assignment.period_id,
          assignment.student_id,
          assignment.evaluator_id,
          assignmentId,
          targetStatus,
          overallScore,
          strength,
          improvement,
          notes
        ]
      );
    }

    // Save individual score items
    for (const [key, item] of scoreMap.entries()) {
      const scoreItemId = buildId("EVA-SCR");
      await client.query(
        `
        INSERT INTO evaluation_score_items (id, submission_id, criteria_id, criteria_key, score, notes)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (submission_id, criteria_id)
        DO UPDATE SET score = EXCLUDED.score,
                      notes = EXCLUDED.notes,
                      updated_at = NOW()
        `,
        [scoreItemId, submissionId, item.criteria.id, key, item.score, item.notes]
      );
    }

    // Update assignment status
    await client.query(
      "UPDATE evaluation_assignments SET status = $2, updated_at = NOW() WHERE id = $1",
      [assignmentId, targetStatus]
    );

    if (ownsTransaction) await client.query("COMMIT");

    return await getPmAssignmentById(assignmentId, client);
  } catch (error) {
    if (ownsTransaction) await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    if (ownsTransaction) client.release();
  }
}

// =============================================================================
// PRESENTATION SESSIONS
// =============================================================================

async function listPresentationSessions(periodId, executor = query) {
  await ensureEvaluationTables(executor);
  if (!periodId) throw createHttpError("periodId wajib diisi.", 400);

  const result = await runQuery(
    executor,
    `
    SELECT ps.*,
           (SELECT COUNT(*)::int FROM presentation_slots slot WHERE slot.session_id = ps.id) AS total_slots,
           (SELECT COUNT(*)::int FROM presentation_evaluators pe WHERE pe.session_id = ps.id) AS total_evaluators
    FROM presentation_sessions ps
    WHERE ps.period_id = $1
    ORDER BY ps.session_date ASC, ps.start_time ASC NULLS LAST
    `,
    [periodId]
  );
  return result.rows;
}

async function getPresentationSessionById(sessionId, executor = query) {
  await ensureEvaluationTables(executor);
  const result = await runQuery(
    executor,
    `
    SELECT ps.*, ep.status AS period_status, ep.title AS period_title
    FROM presentation_sessions ps
    JOIN evaluation_periods ep ON ep.id = ps.period_id
    WHERE ps.id = $1
    LIMIT 1
    `,
    [sessionId]
  );
  if (result.rowCount === 0) return null;
  const session = result.rows[0];

  const evaluators = await runQuery(
    executor,
    `
    SELECT pe.*, u.name AS evaluator_name, u.role AS user_role, u.email
    FROM presentation_evaluators pe
    JOIN users u ON u.id = pe.evaluator_id
    WHERE pe.session_id = $1
    ORDER BY u.name ASC
    `,
    [sessionId]
  );
  session.evaluators = evaluators.rows;

  return session;
}

async function createPresentationSession(periodId, payload = {}, createdBy = null, executor = query) {
  await ensureEvaluationTables(executor);
  const period = await getEvaluationPeriodById(periodId, executor);
  if (!period) throw createHttpError("Periode evaluasi tidak ditemukan.", 404);
  if (period.status === "CLOSED") {
    throw createHttpError("Periode evaluasi sudah ditutup dan tidak dapat diubah.", 409);
  }

  const title = String(payload.title || "").trim();
  const sessionDate = normalizeIsoDate(payload.sessionDate || payload.session_date);
  const startTime = payload.startTime || payload.start_time || null;
  const endTime = payload.endTime || payload.end_time || null;
  const location = payload.location ? String(payload.location).trim() : null;
  const notes = payload.notes ? String(payload.notes).trim() : null;

  if (!title) throw createHttpError("Judul sesi presentasi wajib diisi.", 400);

  const id = buildId("PRS-SES");
  const result = await runQuery(
    executor,
    `
    INSERT INTO presentation_sessions (
      id, period_id, title, session_date, start_time, end_time, location, notes, created_by
    )
    VALUES ($1, $2, $3, $4::date, $5, $6, $7, $8, $9)
    RETURNING *
    `,
    [id, periodId, title, sessionDate, startTime, endTime, location, notes, createdBy]
  );

  return result.rows[0];
}

async function updatePresentationSession(sessionId, payload = {}, executor = query) {
  await ensureEvaluationTables(executor);
  const session = await getPresentationSessionById(sessionId, executor);
  if (!session) throw createHttpError("Sesi presentasi tidak ditemukan.", 404);
  if (session.period_status === "CLOSED") {
    throw createHttpError("Periode evaluasi sudah ditutup dan tidak dapat diubah.", 409);
  }

  const title = payload.title !== undefined ? String(payload.title).trim() : session.title;
  const sessionDate = payload.sessionDate || payload.session_date
    ? normalizeIsoDate(payload.sessionDate || payload.session_date)
    : session.session_date;
  const startTime = payload.startTime !== undefined ? payload.startTime : session.start_time;
  const endTime = payload.endTime !== undefined ? payload.endTime : session.end_time;
  const location = payload.location !== undefined ? (payload.location ? String(payload.location).trim() : null) : session.location;
  const notes = payload.notes !== undefined ? (payload.notes ? String(payload.notes).trim() : null) : session.notes;

  const result = await runQuery(
    executor,
    `
    UPDATE presentation_sessions
    SET title = $2, session_date = $3::date, start_time = $4, end_time = $5, location = $6, notes = $7, updated_at = NOW()
    WHERE id = $1
    RETURNING *
    `,
    [sessionId, title, sessionDate, startTime, endTime, location, notes]
  );

  return result.rows[0];
}

async function deletePresentationSession(sessionId, executor = query) {
  await ensureEvaluationTables(executor);
  const session = await getPresentationSessionById(sessionId, executor);
  if (!session) throw createHttpError("Sesi presentasi tidak ditemukan.", 404);
  if (session.period_status === "CLOSED") {
    throw createHttpError("Periode evaluasi sudah ditutup dan tidak dapat diubah.", 409);
  }

  await runQuery(executor, "DELETE FROM presentation_sessions WHERE id = $1", [sessionId]);
  return { id: sessionId, message: "Sesi presentasi berhasil dihapus." };
}

// =============================================================================
// PRESENTATION EVALUATORS
// =============================================================================

async function addPresentationEvaluator(sessionId, payload = {}, executor = query) {
  await ensureEvaluationTables(executor);
  const session = await getPresentationSessionById(sessionId, executor);
  if (!session) throw createHttpError("Sesi presentasi tidak ditemukan.", 404);
  if (session.period_status === "CLOSED") {
    throw createHttpError("Periode evaluasi sudah ditutup dan tidak dapat diubah.", 409);
  }

  const evaluatorId = String(payload.evaluatorId || payload.evaluator_id || "").trim();
  if (!evaluatorId) throw createHttpError("evaluatorId wajib diisi.", 400);

  const role = payload.role ? String(payload.role).trim() : null;
  const isPresent = payload.isPresent !== undefined ? Boolean(payload.isPresent) : true;
  const notes = payload.notes ? String(payload.notes).trim() : null;

  const id = buildId("PRS-EVL");
  const result = await runQuery(
    executor,
    `
    INSERT INTO presentation_evaluators (id, session_id, evaluator_id, role, is_present, notes)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (session_id, evaluator_id)
    DO UPDATE SET role = EXCLUDED.role, is_present = EXCLUDED.is_present, notes = EXCLUDED.notes
    RETURNING *
    `,
    [id, sessionId, evaluatorId, role, isPresent, notes]
  );

  return result.rows[0];
}

async function updatePresentationEvaluator(id, payload = {}, executor = query) {
  await ensureEvaluationTables(executor);
  const result = await runQuery(
    executor,
    `
    UPDATE presentation_evaluators pe
    SET is_present = COALESCE($2, is_present),
        role = COALESCE($3, role),
        notes = COALESCE($4, notes)
    FROM presentation_sessions ps
    JOIN evaluation_periods ep ON ep.id = ps.period_id
    WHERE pe.id = $1 AND ps.id = pe.session_id AND ep.status <> 'CLOSED'
    RETURNING pe.*
    `,
    [
      id,
      payload.isPresent !== undefined ? Boolean(payload.isPresent) : null,
      payload.role !== undefined ? String(payload.role).trim() : null,
      payload.notes !== undefined ? String(payload.notes).trim() : null
    ]
  );

  if (result.rowCount === 0) {
    throw createHttpError("Evaluator tidak ditemukan atau periode sudah ditutup.", 404);
  }
  return result.rows[0];
}

async function removePresentationEvaluator(id, executor = query) {
  await ensureEvaluationTables(executor);
  const result = await runQuery(
    executor,
    `
    DELETE FROM presentation_evaluators pe
    USING presentation_sessions ps, evaluation_periods ep
    WHERE pe.id = $1 AND ps.id = pe.session_id AND ep.id = ps.period_id AND ep.status <> 'CLOSED'
    RETURNING pe.id
    `,
    [id]
  );
  if (result.rowCount === 0) {
    throw createHttpError("Evaluator tidak ditemukan atau periode sudah ditutup.", 404);
  }
  return { id, message: "Evaluator sesi presentasi berhasil dihapus." };
}

// =============================================================================
// PRESENTATION SLOTS
// =============================================================================

async function listPresentationSlots(sessionId, executor = query) {
  await ensureEvaluationTables(executor);
  if (!sessionId) throw createHttpError("sessionId wajib diisi.", 400);

  const result = await runQuery(
    executor,
    `
    SELECT slot.*,
           s.nim, u.name AS student_name,
           (
             SELECT COUNT(*)::int
             FROM evaluation_submissions sub
             WHERE sub.slot_id = slot.id AND sub.status = 'SUBMITTED'
           ) AS submitted_evaluators_count,
           (
             SELECT ROUND(AVG(sub.overall_score)::numeric, 2)
             FROM evaluation_submissions sub
             WHERE sub.slot_id = slot.id AND sub.status = 'SUBMITTED'
           ) AS average_score
    FROM presentation_slots slot
    JOIN students s ON s.id = slot.student_id
    JOIN users u ON u.id = s.user_id
    WHERE slot.session_id = $1
    ORDER BY slot.slot_order ASC, slot.start_time ASC NULLS LAST
    `,
    [sessionId]
  );

  return result.rows.map((row) => {
    // ABSENT status: score must NOT be 0 or populated; it must be null!
    if (row.status === "ABSENT") {
      row.average_score = null;
    }
    return row;
  });
}

async function getPresentationSlotById(slotId, executor = query) {
  await ensureEvaluationTables(executor);
  const result = await runQuery(
    executor,
    `
    SELECT slot.*,
           ps.title AS session_title, ps.session_date,
           ep.id AS period_id, ep.title AS period_title, ep.status AS period_status,
           s.nim, u.name AS student_name,
           (
             SELECT COUNT(*)::int
             FROM evaluation_submissions sub
             WHERE sub.slot_id = slot.id AND sub.status = 'SUBMITTED'
           ) AS submitted_evaluators_count,
           (
             SELECT ROUND(AVG(sub.overall_score)::numeric, 2)
             FROM evaluation_submissions sub
             WHERE sub.slot_id = slot.id AND sub.status = 'SUBMITTED'
           ) AS average_score
    FROM presentation_slots slot
    JOIN presentation_sessions ps ON ps.id = slot.session_id
    JOIN evaluation_periods ep ON ep.id = ps.period_id
    JOIN students s ON s.id = slot.student_id
    JOIN users u ON u.id = s.user_id
    WHERE slot.id = $1
    LIMIT 1
    `,
    [slotId]
  );
  if (result.rowCount === 0) return null;
  const slot = result.rows[0];
  if (slot.status === "ABSENT") {
    slot.average_score = null;
  }
  return slot;
}

async function createPresentationSlot(sessionId, payload = {}, executor = query) {
  await ensureEvaluationTables(executor);
  const session = await getPresentationSessionById(sessionId, executor);
  if (!session) throw createHttpError("Sesi presentasi tidak ditemukan.", 404);
  if (session.period_status === "CLOSED") {
    throw createHttpError("Periode evaluasi sudah ditutup dan tidak dapat diubah.", 409);
  }

  const studentId = await resolveStudentId(payload.studentId || payload.student_id);
  if (!studentId) throw createHttpError("Mahasiswa tidak ditemukan.", 404);

  const slotOrder = Number(payload.slotOrder || payload.slot_order || 1);
  const startTime = payload.startTime || payload.start_time || null;
  const endTime = payload.endTime || payload.end_time || null;
  const topic = payload.topic ? String(payload.topic).trim() : null;
  const notes = payload.notes ? String(payload.notes).trim() : null;
  const status = String(payload.status || "SCHEDULED").toUpperCase();

  const VALID_SLOT_STATUSES = ["SCHEDULED", "PRESENTING", "COMPLETED", "ABSENT", "RESCHEDULED"];
  if (!VALID_SLOT_STATUSES.includes(status)) {
    throw createHttpError(`Status slot harus salah satu dari: ${VALID_SLOT_STATUSES.join(", ")}.`, 400);
  }

  // Look up division snapshot if available
  let divisionId = payload.divisionId || payload.division_id || null;
  let divisionName = payload.divisionName || payload.division_name || null;
  let projectId = payload.projectId || payload.project_id || null;

  if (!divisionId || !divisionName) {
    const memRes = await runQuery(
      executor,
      `
      SELECT rm.project_id, rm.division_id, rd.name AS division_name
      FROM research_memberships rm
      JOIN students s ON s.user_id = rm.user_id
      LEFT JOIN research_divisions rd ON rd.id = rm.division_id
      WHERE s.id = $1 AND rm.status = 'Aktif'
      LIMIT 1
      `,
      [studentId]
    );
    if (memRes.rowCount > 0) {
      divisionId = divisionId || memRes.rows[0].division_id;
      divisionName = divisionName || memRes.rows[0].division_name;
      projectId = projectId || memRes.rows[0].project_id;
    }
  }

  const id = buildId("PRS-SLT");
  const result = await runQuery(
    executor,
    `
    INSERT INTO presentation_slots (
      id, session_id, student_id, slot_order, start_time, end_time, status,
      division_id, division_name, project_id, topic, notes
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    ON CONFLICT (session_id, student_id)
    DO UPDATE SET slot_order = EXCLUDED.slot_order,
                  start_time = EXCLUDED.start_time,
                  end_time = EXCLUDED.end_time,
                  status = EXCLUDED.status,
                  topic = EXCLUDED.topic,
                  notes = EXCLUDED.notes,
                  updated_at = NOW()
    RETURNING *
    `,
    [id, sessionId, studentId, slotOrder, startTime, endTime, status, divisionId, divisionName, projectId, topic, notes]
  );

  return result.rows[0];
}

async function updatePresentationSlot(slotId, payload = {}, executor = query) {
  await ensureEvaluationTables(executor);
  const slot = await getPresentationSlotById(slotId, executor);
  if (!slot) throw createHttpError("Slot presentasi tidak ditemukan.", 404);
  if (slot.period_status === "CLOSED") {
    throw createHttpError("Periode evaluasi sudah ditutup dan tidak dapat diubah.", 409);
  }

  const slotOrder = payload.slotOrder !== undefined ? Number(payload.slotOrder) : slot.slot_order;
  const startTime = payload.startTime !== undefined ? payload.startTime : slot.start_time;
  const endTime = payload.endTime !== undefined ? payload.endTime : slot.end_time;
  const topic = payload.topic !== undefined ? (payload.topic ? String(payload.topic).trim() : null) : slot.topic;
  const notes = payload.notes !== undefined ? (payload.notes ? String(payload.notes).trim() : null) : slot.notes;

  const result = await runQuery(
    executor,
    `
    UPDATE presentation_slots
    SET slot_order = $2, start_time = $3, end_time = $4, topic = $5, notes = $6, updated_at = NOW()
    WHERE id = $1
    RETURNING *
    `,
    [slotId, slotOrder, startTime, endTime, topic, notes]
  );

  return result.rows[0];
}

async function updatePresentationSlotStatus(slotId, status, executor = query) {
  await ensureEvaluationTables(executor);
  const slot = await getPresentationSlotById(slotId, executor);
  if (!slot) throw createHttpError("Slot presentasi tidak ditemukan.", 404);
  if (slot.period_status === "CLOSED") {
    throw createHttpError("Periode evaluasi sudah ditutup dan tidak dapat diubah.", 409);
  }

  const normalizedStatus = String(status || "").trim().toUpperCase();
  const VALID_STATUSES = ["SCHEDULED", "PRESENTING", "COMPLETED", "ABSENT", "RESCHEDULED"];
  if (!VALID_STATUSES.includes(normalizedStatus)) {
    throw createHttpError(`Status slot harus salah satu dari: ${VALID_STATUSES.join(", ")}.`, 400);
  }

  const result = await runQuery(
    executor,
    `
    UPDATE presentation_slots
    SET status = $2, updated_at = NOW()
    WHERE id = $1
    RETURNING *
    `,
    [slotId, normalizedStatus]
  );

  return result.rows[0];
}

async function deletePresentationSlot(slotId, executor = query) {
  await ensureEvaluationTables(executor);
  const slot = await getPresentationSlotById(slotId, executor);
  if (!slot) throw createHttpError("Slot presentasi tidak ditemukan.", 404);
  if (slot.period_status === "CLOSED") {
    throw createHttpError("Periode evaluasi sudah ditutup dan tidak dapat diubah.", 409);
  }

  await runQuery(executor, "DELETE FROM presentation_slots WHERE id = $1", [slotId]);
  return { id: slotId, message: "Slot presentasi berhasil dihapus." };
}

// =============================================================================
// SUBMISSION: MONTHLY PRESENTATION EVALUATION (Independent Evaluators)
// =============================================================================

async function getPresentationSlotMyEvaluation(slotId, evaluatorId, executor = query) {
  await ensureEvaluationTables(executor);
  const subRes = await runQuery(
    executor,
    `
    SELECT es.*, u.name AS evaluator_name
    FROM evaluation_submissions es
    JOIN users u ON u.id = es.evaluator_id
    WHERE es.slot_id = $1 AND es.evaluator_id = $2
    LIMIT 1
    `,
    [slotId, evaluatorId]
  );

  if (subRes.rowCount === 0) return null;
  const submission = subRes.rows[0];
  const mapped = mapSubmissionRow(submission);

  const scores = await runQuery(
    executor,
    `
    SELECT esi.*, ec.name AS criteria_name, ec.description AS criteria_description, ec.sort_order
    FROM evaluation_score_items esi
    JOIN evaluation_criteria ec ON ec.id = esi.criteria_id
    WHERE esi.submission_id = $1
    ORDER BY ec.sort_order ASC
    `,
    [submission.id]
  );
  mapped.scores = scores.rows.map(mapScoreItemRow);

  return mapped;
}

async function getPresentationSlotEvaluations(slotId, executor = query) {
  await ensureEvaluationTables(executor);
  const slot = await getPresentationSlotById(slotId, executor);
  if (!slot) throw createHttpError("Slot presentasi tidak ditemukan.", 404);

  const subRes = await runQuery(
    executor,
    `
    SELECT es.*, u.name AS evaluator_name, u.role AS evaluator_role
    FROM evaluation_submissions es
    JOIN users u ON u.id = es.evaluator_id
    WHERE es.slot_id = $1
    ORDER BY u.name ASC
    `,
    [slotId]
  );

  const submissions = [];
  for (const sub of subRes.rows) {
    const mapped = mapSubmissionRow(sub);
    const scores = await runQuery(
      executor,
      `
      SELECT esi.*, ec.name AS criteria_name, ec.sort_order
      FROM evaluation_score_items esi
      JOIN evaluation_criteria ec ON ec.id = esi.criteria_id
      WHERE esi.submission_id = $1
      ORDER BY ec.sort_order ASC
      `,
      [sub.id]
    );
    mapped.scores = scores.rows.map(mapScoreItemRow);
    submissions.push(mapped);
  }

  // Aggregate only from SUBMITTED submissions
  const submittedSubs = submissions.filter((s) => s.status === "SUBMITTED" && s.overallScore != null);
  let presentationScore = null;
  if (slot.status !== "ABSENT" && submittedSubs.length > 0) {
    const sum = submittedSubs.reduce((acc, curr) => acc + Number(curr.overallScore), 0);
    presentationScore = Math.round((sum / submittedSubs.length) * 100) / 100;
  }

  return {
    slot,
    submissions,
    evaluations: submissions,
    evaluatorCount: submissions.length,
    submittedCount: submittedSubs.length,
    presentationScore
  };
}

async function savePresentationEvaluationSubmission(slotId, evaluatorId, payload = {}, executor = pool) {
  await ensureEvaluationTables(executor);
  const client = typeof executor.connect === "function" ? await executor.connect() : executor;
  const ownsTransaction = typeof executor.connect === "function";

  try {
    if (ownsTransaction) await client.query("BEGIN");

    const slotRes = await client.query(
      `
      SELECT slot.*, ps.id AS session_id, ep.id AS period_id, ep.status AS period_status
      FROM presentation_slots slot
      JOIN presentation_sessions ps ON ps.id = slot.session_id
      JOIN evaluation_periods ep ON ep.id = ps.period_id
      WHERE slot.id = $1
      FOR UPDATE OF slot
      `,
      [slotId]
    );

    if (slotRes.rowCount === 0) throw createHttpError("Slot presentasi tidak ditemukan.", 404);
    const slot = slotRes.rows[0];

    if (slot.period_status === "CLOSED") {
      throw createHttpError("Periode evaluasi sudah ditutup dan tidak dapat diubah.", 409);
    }

    if (slot.status === "ABSENT") {
      throw createHttpError("Mahasiswa berstatus tidak hadir (ABSENT), penilaian tidak dapat diberikan.", 400);
    }

    const targetStatus = String(payload.status || "DRAFT").toUpperCase();
    if (!["DRAFT", "SUBMITTED"].includes(targetStatus)) {
      throw createHttpError("Status evaluasi harus DRAFT atau SUBMITTED.", 400);
    }

    const rawScores = Array.isArray(payload.scores) ? payload.scores : [];
    const strength = payload.strength != null ? String(payload.strength).trim() : null;
    const improvement = payload.improvement != null ? String(payload.improvement).trim() : null;
    const notes = payload.notes != null ? String(payload.notes).trim() : null;

    // Fetch active criteria for MONTHLY_PRESENTATION
    const criteriaList = (await client.query(
      "SELECT * FROM evaluation_criteria WHERE period_type = 'MONTHLY_PRESENTATION' AND is_active = TRUE ORDER BY sort_order ASC"
    )).rows;
    const criteriaByKey = new Map(criteriaList.map((c) => [c.key, c]));

    const scoreMap = new Map();
    for (const item of rawScores) {
      const key = String(item.criteriaKey || item.criteria_key || "").trim();
      const numScore = Number(item.score);
      if (item.score != null && (isNaN(numScore) || numScore < 1.0 || numScore > 10.0)) {
        throw createHttpError(`Nilai untuk kriteria '${key}' harus berupa angka antara 1.0 dan 10.0.`, 400);
      }
      if (key && criteriaByKey.has(key)) {
        scoreMap.set(key, {
          criteria: criteriaByKey.get(key),
          score: Math.round(numScore * 100) / 100,
          notes: item.notes ? String(item.notes).trim() : null
        });
      }
    }

    // If SUBMITTED: all 7 criteria are mandatory
    if (targetStatus === "SUBMITTED") {
      for (const criteria of criteriaList) {
        if (!scoreMap.has(criteria.key)) {
          throw createHttpError(`Seluruh 7 kriteria presentasi wajib diisi sebelum submit (kurang: ${criteria.name}).`, 422);
        }
      }
    }

    let overallScore = null;
    if (scoreMap.size > 0) {
      const sum = Array.from(scoreMap.values()).reduce((acc, curr) => acc + curr.score, 0);
      overallScore = Math.round((sum / scoreMap.size) * 100) / 100;
    }

    // Independent submission per evaluator (UNIQUE per slot_id, evaluator_id)
    const existingSubRes = await client.query(
      "SELECT id FROM evaluation_submissions WHERE slot_id = $1 AND evaluator_id = $2 LIMIT 1",
      [slotId, evaluatorId]
    );

    let submissionId;
    if (existingSubRes.rowCount > 0) {
      submissionId = existingSubRes.rows[0].id;
      await client.query(
        `
        UPDATE evaluation_submissions
        SET status = $2, overall_score = $3, strength = $4, improvement = $5, notes = $6,
            submitted_at = CASE WHEN $2 = 'SUBMITTED' THEN NOW() ELSE submitted_at END,
            updated_at = NOW()
        WHERE id = $1
        `,
        [submissionId, targetStatus, overallScore, strength, improvement, notes]
      );
    } else {
      submissionId = buildId("EVA-SUB");
      await client.query(
        `
        INSERT INTO evaluation_submissions (
          id, period_id, student_id, evaluator_id, assignment_id, slot_id, status,
          overall_score, strength, improvement, notes, submitted_at
        )
        VALUES ($1, $2, $3, $4, NULL, $5, $6, $7, $8, $9, $10, CASE WHEN $6 = 'SUBMITTED' THEN NOW() ELSE NULL END)
        `,
        [
          submissionId,
          slot.period_id,
          slot.student_id,
          evaluatorId,
          slotId,
          targetStatus,
          overallScore,
          strength,
          improvement,
          notes
        ]
      );
    }

    for (const [key, item] of scoreMap.entries()) {
      const scoreItemId = buildId("EVA-SCR");
      await client.query(
        `
        INSERT INTO evaluation_score_items (id, submission_id, criteria_id, criteria_key, score, notes)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (submission_id, criteria_id)
        DO UPDATE SET score = EXCLUDED.score,
                      notes = EXCLUDED.notes,
                      updated_at = NOW()
        `,
        [scoreItemId, submissionId, item.criteria.id, key, item.score, item.notes]
      );
    }

    if (ownsTransaction) await client.query("COMMIT");

    return await getPresentationSlotMyEvaluation(slotId, evaluatorId, client);
  } catch (error) {
    if (ownsTransaction) await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    if (ownsTransaction) client.release();
  }
}

// =============================================================================
// PROGRESS & RECAP
// =============================================================================

async function getEvaluationPeriodProgress(periodId, executor = query) {
  await ensureEvaluationTables(executor);
  const period = await getEvaluationPeriodById(periodId, executor);
  if (!period) throw createHttpError("Periode evaluasi tidak ditemukan.", 404);

  if (period.type === "PM_EVALUATION" || period.type === "PM_BIWEEKLY") {
    const summaryRes = await runQuery(
      executor,
      `
      SELECT
        COUNT(*)::int AS total_assignments,
        COUNT(CASE WHEN ea.status = 'SUBMITTED' THEN 1 END)::int AS submitted_count,
        COUNT(CASE WHEN ea.status = 'DRAFT' THEN 1 END)::int AS draft_count,
        COUNT(CASE WHEN ea.status = 'PENDING' THEN 1 END)::int AS pending_count
      FROM evaluation_assignments ea
      WHERE ea.period_id = $1
      `,
      [periodId]
    );

    const divisionRes = await runQuery(
      executor,
      `
      SELECT
        COALESCE(ea.division_name, 'Tanpa Divisi') AS division_name,
        COUNT(*)::int AS total,
        COUNT(CASE WHEN ea.status = 'SUBMITTED' THEN 1 END)::int AS submitted,
        COUNT(CASE WHEN ea.status = 'DRAFT' THEN 1 END)::int AS draft,
        COUNT(CASE WHEN ea.status = 'PENDING' THEN 1 END)::int AS pending
      FROM evaluation_assignments ea
      WHERE ea.period_id = $1
      GROUP BY ea.division_name
      ORDER BY ea.division_name ASC NULLS LAST
      `,
      [periodId]
    );

    const summary = summaryRes.rows[0];
    const total = summary.total_assignments || 0;
    const submitted = summary.submitted_count || 0;
    const progressPct = total > 0 ? Math.round((submitted / total) * 100) : 0;

    return {
      period,
      summary: {
        totalAssignments: total,
        submittedCount: submitted,
        draftCount: summary.draft_count,
        pendingCount: summary.pending_count,
        progressPct
      },
      divisionBreakdown: divisionRes.rows
    };
  } else {
    // MONTHLY_PRESENTATION
    const slotSummaryRes = await runQuery(
      executor,
      `
      SELECT
        COUNT(*)::int AS total_slots,
        COUNT(CASE WHEN slot.status = 'COMPLETED' THEN 1 END)::int AS completed_count,
        COUNT(CASE WHEN slot.status = 'PRESENTING' THEN 1 END)::int AS presenting_count,
        COUNT(CASE WHEN slot.status = 'SCHEDULED' THEN 1 END)::int AS scheduled_count,
        COUNT(CASE WHEN slot.status = 'ABSENT' THEN 1 END)::int AS absent_count,
        COUNT(CASE WHEN slot.status = 'RESCHEDULED' THEN 1 END)::int AS rescheduled_count
      FROM presentation_slots slot
      JOIN presentation_sessions ps ON ps.id = slot.session_id
      WHERE ps.period_id = $1
      `,
      [periodId]
    );

    const submissionSummaryRes = await runQuery(
      executor,
      `
      SELECT
        COUNT(*)::int AS total_submissions,
        COUNT(CASE WHEN es.status = 'SUBMITTED' THEN 1 END)::int AS submitted_evaluations,
        COUNT(CASE WHEN es.status = 'DRAFT' THEN 1 END)::int AS draft_evaluations
      FROM evaluation_submissions es
      WHERE es.period_id = $1 AND es.slot_id IS NOT NULL
      `,
      [periodId]
    );

    const slotSummary = slotSummaryRes.rows[0];
    const subSummary = submissionSummaryRes.rows[0];
    const totalSlots = slotSummary.total_slots || 0;
    const completed = slotSummary.completed_count || 0;
    const progressPct = totalSlots > 0 ? Math.round((completed / totalSlots) * 100) : 0;

    return {
      period,
      slotsSummary: {
        totalSlots,
        completedCount: completed,
        presentingCount: slotSummary.presenting_count,
        scheduledCount: slotSummary.scheduled_count,
        absentCount: slotSummary.absent_count,
        rescheduledCount: slotSummary.rescheduled_count,
        progressPct
      },
      evaluationsSummary: {
        totalEvaluations: subSummary.total_submissions || 0,
        submittedCount: subSummary.submitted_evaluations || 0,
        draftCount: subSummary.draft_evaluations || 0
      }
    };
  }
}

async function getEvaluationPeriodRecap(periodId, executor = query) {
  await ensureEvaluationTables(executor);
  const period = await getEvaluationPeriodById(periodId, executor);
  if (!period) throw createHttpError("Periode evaluasi tidak ditemukan.", 404);

  if (period.type === "PM_EVALUATION" || period.type === "PM_BIWEEKLY") {
    const rows = await runQuery(
      executor,
      `
      SELECT ea.id AS assignment_id, ea.student_id, ea.division_name, ea.status AS assignment_status,
             s.nim, u_student.name AS student_name,
             u_evaluator.name AS evaluator_name,
             es.id AS submission_id,
             es.status AS submission_status,
             es.overall_score,
             es.strength,
             es.improvement,
             es.notes,
             es.submitted_at
      FROM evaluation_assignments ea
      JOIN students s ON s.id = ea.student_id
      JOIN users u_student ON u_student.id = s.user_id
      JOIN users u_evaluator ON u_evaluator.id = ea.evaluator_id
      LEFT JOIN evaluation_submissions es ON es.assignment_id = ea.id
      WHERE ea.period_id = $1
      ORDER BY ea.division_name ASC NULLS LAST, u_student.name ASC
      `,
      [periodId]
    );

    return {
      period,
      items: rows.rows.map((row) => ({
        assignmentId: row.assignment_id,
        studentId: row.student_id,
        studentName: row.student_name,
        nim: row.nim,
        divisionName: row.division_name || "Tanpa Divisi",
        evaluatorName: row.evaluator_name,
        assignmentStatus: row.assignment_status,
        submissionStatus: row.submission_status || "PENDING",
        overallScore: row.overall_score != null ? Number(row.overall_score) : null,
        strength: row.strength || null,
        improvement: row.improvement || null,
        notes: row.notes || null,
        submittedAt: row.submitted_at || null
      }))
    };
  } else {
    // MONTHLY_PRESENTATION
    const slotsRes = await runQuery(
      executor,
      `
      SELECT slot.id AS slot_id, slot.session_id, slot.student_id, slot.status AS slot_status,
             slot.slot_order, slot.topic, slot.division_name,
             ps.title AS session_title, ps.session_date,
             s.nim, u.name AS student_name,
             (
               SELECT COUNT(*)::int
               FROM evaluation_submissions sub
               WHERE sub.slot_id = slot.id AND sub.status = 'SUBMITTED'
             ) AS evaluator_count,
             (
               SELECT ROUND(AVG(sub.overall_score)::numeric, 2)
               FROM evaluation_submissions sub
               WHERE sub.slot_id = slot.id AND sub.status = 'SUBMITTED'
             ) AS average_score
      FROM presentation_slots slot
      JOIN presentation_sessions ps ON ps.id = slot.session_id
      JOIN students s ON s.id = slot.student_id
      JOIN users u ON u.id = s.user_id
      WHERE ps.period_id = $1
      ORDER BY ps.session_date ASC, slot.slot_order ASC
      `,
      [periodId]
    );

    return {
      period,
      items: slotsRes.rows.map((row) => {
        // Crucial rule: ABSENT != 0, score is null
        const finalScore = row.slot_status === "ABSENT" ? null : (row.average_score != null ? Number(row.average_score) : null);
        return {
          slotId: row.slot_id,
          sessionId: row.session_id,
          sessionTitle: row.session_title,
          sessionDate: row.session_date,
          studentId: row.student_id,
          studentName: row.student_name,
          nim: row.nim,
          divisionName: row.division_name || "Tanpa Divisi",
          slotOrder: row.slot_order,
          slotStatus: row.slot_status,
          topic: row.topic || null,
          evaluatorCount: row.evaluator_count,
          presentationScore: finalScore
        };
      })
    };
  }
}

async function getStudentEvaluationHistory(studentIdOrUserId, optionsOrExecutor = {}, possibleExecutor = query) {
  let isStudent = false;
  let executor = query;

  if (typeof optionsOrExecutor === "function" || (optionsOrExecutor && typeof optionsOrExecutor.query === "function")) {
    executor = optionsOrExecutor;
  } else if (typeof optionsOrExecutor === "object" && optionsOrExecutor !== null) {
    if (optionsOrExecutor.isStudent !== undefined) {
      isStudent = Boolean(optionsOrExecutor.isStudent);
    }
    if (possibleExecutor && (typeof possibleExecutor === "function" || typeof possibleExecutor.query === "function")) {
      executor = possibleExecutor;
    }
  }

  await ensureEvaluationTables(executor);
  const student = await resolveStudentRecord(studentIdOrUserId);
  if (!student) throw createHttpError("Mahasiswa tidak ditemukan.", 404);

  // PM evaluations
  const pmEvaluations = await runQuery(
    executor,
    `
    SELECT es.*, ep.id AS period_id, ep.title AS period_title, ep.status AS period_status,
           ep.type AS period_type, ep.start_date, ep.end_date,
           ea.division_name, u.name AS evaluator_name
    FROM evaluation_submissions es
    JOIN evaluation_periods ep ON ep.id = es.period_id
    JOIN evaluation_assignments ea ON ea.id = es.assignment_id
    JOIN users u ON u.id = es.evaluator_id
    WHERE es.student_id = $1 AND es.status = 'SUBMITTED'
    ORDER BY ep.start_date DESC
    `,
    [student.id]
  );

  // Presentation evaluations
  const presentationSlots = await runQuery(
    executor,
    `
    SELECT slot.*, ps.title AS session_title, ps.session_date,
           ep.id AS period_id, ep.title AS period_title, ep.status AS period_status, ep.start_date AS period_start_date,
           (
             SELECT ROUND(AVG(sub.overall_score)::numeric, 2)
             FROM evaluation_submissions sub
             WHERE sub.slot_id = slot.id AND sub.status = 'SUBMITTED'
           ) AS presentation_score,
           (
             SELECT COUNT(*)::int
             FROM evaluation_submissions sub
             WHERE sub.slot_id = slot.id AND sub.status = 'SUBMITTED'
           ) AS evaluator_count
    FROM presentation_slots slot
    JOIN presentation_sessions ps ON ps.id = slot.session_id
    JOIN evaluation_periods ep ON ep.id = ps.period_id
    WHERE slot.student_id = $1
    ORDER BY ps.session_date DESC
    `,
    [student.id]
  );

  return {
    student: {
      id: student.id,
      userId: student.user_id,
      name: student.name,
      nim: student.nim
    },
    pmEvaluations: pmEvaluations.rows.map((row) => {
      const isPeriodClosed = row.period_status === "CLOSED";
      const resultAvailable = !isStudent || isPeriodClosed;
      const startDate = formatDateOnly(row.start_date);
      const endDate = formatDateOnly(row.end_date);
      const evaluationMonth = startDate ? startDate.slice(0, 7) : null;
      const periodType = row.period_type === "PM_BIWEEKLY" ? "PM_EVALUATION" : (row.period_type || "PM_EVALUATION");

      return {
        submissionId: row.id,
        periodId: row.period_id,
        periodTitle: row.period_title,
        periodType,
        periodStatus: row.period_status,
        evaluationMonth,
        resultAvailable,
        startDate,
        endDate,
        divisionName: row.division_name,
        evaluatorName: row.evaluator_name,
        overallScore: resultAvailable ? (row.overall_score != null ? Number(row.overall_score) : null) : null,
        strength: resultAvailable ? (row.strength || null) : null,
        improvement: resultAvailable ? (row.improvement || null) : null,
        notes: resultAvailable ? (row.notes || null) : null,
        submittedAt: resultAvailable ? (row.submitted_at || null) : null
      };
    }),
    presentationEvaluations: presentationSlots.rows.map((row) => {
      const isPeriodClosed = row.period_status === "CLOSED";
      const resultAvailable = !isStudent || isPeriodClosed;
      const sessionDate = formatDateOnly(row.session_date);
      const periodStartDate = formatDateOnly(row.period_start_date);
      const evaluationMonth = sessionDate ? sessionDate.slice(0, 7) : (periodStartDate ? periodStartDate.slice(0, 7) : null);

      return {
        slotId: row.id,
        sessionId: row.session_id,
        sessionTitle: row.session_title,
        sessionDate,
        periodId: row.period_id,
        periodTitle: row.period_title,
        periodType: "MONTHLY_PRESENTATION",
        periodStatus: row.period_status,
        evaluationMonth,
        slotStatus: row.status,
        status: row.status,
        topic: row.topic,
        resultAvailable,
        evaluatorCount: resultAvailable ? row.evaluator_count : 0,
        presentationScore: resultAvailable
          ? (row.status === "ABSENT" ? null : (row.presentation_score != null ? Number(row.presentation_score) : null))
          : null
      };
    }),
    get presentationSlots() {
      return this.presentationEvaluations;
    }
  };
}

module.exports = {
  buildId,
  ensureEvaluationTables,
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
  INITIAL_PM_CRITERIA,
  INITIAL_PRESENTATION_CRITERIA,
  validateScoreRange,
  calculateAverageScore,
  checkUserIsPm,
  formatDateOnly,
  mapPeriodRow,
  mapAssignmentRow,
  mapScoreItemRow
};
