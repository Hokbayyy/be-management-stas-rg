const crypto = require("crypto");
const { pool } = require("../db/pool");
const { resolveStudentRecord } = require("./studentResolver");
const {
  createStudentAccessLocks,
  deactivateAllAccessLocksForStudent,
  ACCESS_LOCK_REASON_SURVEY_UNFULFILLED,
} = require("./studentAccessLocks");

let surveyTablesEnsured = false;

function generateSurveyId(prefix = "srv") {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
}

/**
 * Ensures database schema tables for the lab survey system exist.
 */
async function ensureSurveyTables(executor = pool) {
  if (surveyTablesEnsured) return;

  await executor.query(`
    CREATE TABLE IF NOT EXISTS lab_surveys (
      id VARCHAR(64) PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      description TEXT,
      status VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
      start_date DATE NOT NULL,
      end_date DATE NOT NULL,
      enforcement_type VARCHAR(30) NOT NULL DEFAULT 'BANNER_ALERT',
      post_deadline_policy VARCHAR(30) NOT NULL DEFAULT 'EXPIRE_SOFT',
      target_audience VARCHAR(50) NOT NULL DEFAULT 'ALL',
      is_anonymous BOOLEAN NOT NULL DEFAULT FALSE,
      created_by VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS lab_survey_questions (
      id VARCHAR(64) PRIMARY KEY,
      survey_id VARCHAR(64) NOT NULL REFERENCES lab_surveys(id) ON DELETE CASCADE,
      question_type VARCHAR(30) NOT NULL,
      category VARCHAR(30) NOT NULL DEFAULT 'GENERAL',
      title TEXT NOT NULL,
      description TEXT,
      is_required BOOLEAN NOT NULL DEFAULT FALSE,
      sort_order INT NOT NULL DEFAULT 1,
      options JSONB DEFAULT '[]'::jsonb,
      scale_config JSONB DEFAULT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS lab_survey_submissions (
      id VARCHAR(64) PRIMARY KEY,
      survey_id VARCHAR(64) NOT NULL REFERENCES lab_surveys(id) ON DELETE CASCADE,
      student_id VARCHAR(64) NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT uq_lab_survey_student UNIQUE (survey_id, student_id)
    );

    CREATE TABLE IF NOT EXISTS lab_survey_answers (
      id VARCHAR(64) PRIMARY KEY,
      submission_id VARCHAR(64) NOT NULL REFERENCES lab_survey_submissions(id) ON DELETE CASCADE,
      question_id VARCHAR(64) NOT NULL REFERENCES lab_survey_questions(id) ON DELETE CASCADE,
      answer_text TEXT,
      answer_options JSONB DEFAULT '[]'::jsonb,
      answer_number NUMERIC(5, 2) DEFAULT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_lab_surveys_status ON lab_surveys(status);
    CREATE INDEX IF NOT EXISTS idx_lab_survey_questions_survey ON lab_survey_questions(survey_id, sort_order);
    CREATE INDEX IF NOT EXISTS idx_lab_survey_submissions_survey ON lab_survey_submissions(survey_id);
    CREATE INDEX IF NOT EXISTS idx_lab_survey_submissions_student ON lab_survey_submissions(student_id);
    CREATE INDEX IF NOT EXISTS idx_lab_survey_answers_submission ON lab_survey_answers(submission_id);
    CREATE INDEX IF NOT EXISTS idx_lab_survey_answers_question ON lab_survey_answers(question_id);
  `);

  surveyTablesEnsured = true;
}

/**
 * List all surveys with respondent metrics
 */
async function listSurveys(filters = {}, executor = pool) {
  await ensureSurveyTables(executor);

  const conditions = [];
  const params = [];

  if (filters.status) {
    params.push(filters.status);
    conditions.push(`s.status = $${params.length}`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const sql = `
    SELECT
      s.*,
      COUNT(DISTINCT q.id) AS question_count,
      COUNT(DISTINCT sub.id) AS respondent_count,
      (
        SELECT COUNT(st.id)
        FROM students st
        JOIN users u ON st.user_id = u.id
        WHERE st.status = 'Aktif'
          AND (
            s.target_audience = 'ALL'
            OR (s.target_audience = 'RISET_ONLY' AND st.tipe = 'Riset')
            OR (s.target_audience = 'MAGANG_ONLY' AND st.tipe = 'Magang')
          )
      ) AS target_count
    FROM lab_surveys s
    LEFT JOIN lab_survey_questions q ON q.survey_id = s.id
    LEFT JOIN lab_survey_submissions sub ON sub.survey_id = s.id
    ${whereClause}
    GROUP BY s.id
    ORDER BY s.created_at DESC
  `;

  const { rows } = await executor.query(sql, params);
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description,
    status: r.status,
    startDate: r.start_date,
    endDate: r.end_date,
    enforcementType: r.enforcement_type,
    postDeadlinePolicy: r.post_deadline_policy,
    targetAudience: r.target_audience,
    isAnonymous: Boolean(r.is_anonymous),
    questionCount: Number(r.question_count || 0),
    respondentCount: Number(r.respondent_count || 0),
    targetCount: Number(r.target_count || 0),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

/**
 * Get survey details including questions
 */
async function getSurveyById(surveyId, executor = pool) {
  await ensureSurveyTables(executor);

  const { rows: surveyRows } = await executor.query(
    `SELECT * FROM lab_surveys WHERE id = $1`,
    [surveyId]
  );

  if (surveyRows.length === 0) {
    const err = new Error(`Survey dengan ID ${surveyId} tidak ditemukan.`);
    err.status = 404;
    throw err;
  }

  const survey = surveyRows[0];

  const { rows: questionRows } = await executor.query(
    `SELECT * FROM lab_survey_questions WHERE survey_id = $1 ORDER BY sort_order ASC, created_at ASC`,
    [surveyId]
  );

  const { rows: countRows } = await executor.query(
    `SELECT COUNT(id) AS respondent_count FROM lab_survey_submissions WHERE survey_id = $1`,
    [surveyId]
  );

  return {
    id: survey.id,
    title: survey.title,
    description: survey.description,
    status: survey.status,
    startDate: survey.start_date,
    endDate: survey.end_date,
    enforcementType: survey.enforcement_type,
    postDeadlinePolicy: survey.post_deadline_policy,
    targetAudience: survey.target_audience,
    isAnonymous: Boolean(survey.is_anonymous),
    respondentCount: Number(countRows[0]?.respondent_count || 0),
    createdAt: survey.created_at,
    updatedAt: survey.updated_at,
    questions: questionRows.map((q) => ({
      id: q.id,
      surveyId: q.survey_id,
      questionType: q.question_type,
      category: q.category,
      title: q.title,
      description: q.description,
      isRequired: Boolean(q.is_required),
      sortOrder: Number(q.sort_order),
      options: Array.isArray(q.options) ? q.options : [],
      scaleConfig: q.scale_config || null,
      createdAt: q.created_at,
    })),
  };
}

/**
 * Create a new survey
 */
async function createSurvey(payload, actorId, executor = pool) {
  await ensureSurveyTables(executor);

  const {
    title,
    description,
    startDate,
    endDate,
    enforcementType = "BANNER_ALERT",
    postDeadlinePolicy = "EXPIRE_SOFT",
    targetAudience = "ALL",
    isAnonymous = false,
    questions = [],
  } = payload;

  if (!title || !title.trim()) {
    const err = new Error("Judul survey wajib diisi.");
    err.status = 400;
    throw err;
  }
  if (!startDate || !endDate) {
    const err = new Error("Tanggal mulai dan batas akhir (deadline) survey wajib ditentukan.");
    err.status = 400;
    throw err;
  }

  const surveyId = generateSurveyId("srv");

  const client = executor.connect ? await executor.connect() : executor;
  const isTransactionOwner = Boolean(executor.connect);

  try {
    if (isTransactionOwner) await client.query("BEGIN");

    await client.query(
      `INSERT INTO lab_surveys (
        id, title, description, status, start_date, end_date,
        enforcement_type, post_deadline_policy, target_audience,
        is_anonymous, created_by, created_at, updated_at
      ) VALUES ($1, $2, $3, 'DRAFT', $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())`,
      [
        surveyId,
        title.trim(),
        description ? description.trim() : null,
        startDate,
        endDate,
        enforcementType,
        postDeadlinePolicy,
        targetAudience,
        Boolean(isAnonymous),
        actorId,
      ]
    );

    if (Array.isArray(questions) && questions.length > 0) {
      for (let i = 0; i < questions.length; i++) {
        const q = questions[i];
        const qId = generateSurveyId("q");
        await client.query(
          `INSERT INTO lab_survey_questions (
            id, survey_id, question_type, category, title, description,
            is_required, sort_order, options, scale_config, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
          [
            qId,
            surveyId,
            q.questionType || "SHORT_TEXT",
            q.category || "GENERAL",
            q.title ? q.title.trim() : `Pertanyaan ${i + 1}`,
            q.description ? q.description.trim() : null,
            Boolean(q.isRequired),
            q.sortOrder || i + 1,
            JSON.stringify(Array.isArray(q.options) ? q.options : []),
            q.scaleConfig ? JSON.stringify(q.scaleConfig) : null,
          ]
        );
      }
    }

    if (isTransactionOwner) await client.query("COMMIT");
    return getSurveyById(surveyId, executor);
  } catch (err) {
    if (isTransactionOwner) await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    if (isTransactionOwner) client.release();
  }
}

/**
 * Update an existing survey and its questions
 */
async function updateSurvey(surveyId, payload, actorId, executor = pool) {
  await ensureSurveyTables(executor);

  const existing = await getSurveyById(surveyId, executor);
  if (existing.status === "CLOSED" && payload.status === undefined) {
    const err = new Error("Survey yang telah DITUTUP (CLOSED) tidak dapat diedit kembali.");
    err.status = 409;
    throw err;
  }

  const {
    title,
    description,
    startDate,
    endDate,
    enforcementType,
    postDeadlinePolicy,
    targetAudience,
    isAnonymous,
    questions,
  } = payload;

  const client = executor.connect ? await executor.connect() : executor;
  const isTransactionOwner = Boolean(executor.connect);

  try {
    if (isTransactionOwner) await client.query("BEGIN");

    await client.query(
      `UPDATE lab_surveys SET
        title = COALESCE($2, title),
        description = CASE WHEN $3 IS NOT NULL THEN $3 ELSE description END,
        start_date = COALESCE($4, start_date),
        end_date = COALESCE($5, end_date),
        enforcement_type = COALESCE($6, enforcement_type),
        post_deadline_policy = COALESCE($7, post_deadline_policy),
        target_audience = COALESCE($8, target_audience),
        is_anonymous = CASE WHEN $9 IS NOT NULL THEN $9 ELSE is_anonymous END,
        updated_at = NOW()
      WHERE id = $1`,
      [
        surveyId,
        title ? title.trim() : null,
        description !== undefined ? (description ? description.trim() : null) : null,
        startDate || null,
        endDate || null,
        enforcementType || null,
        postDeadlinePolicy || null,
        targetAudience || null,
        isAnonymous !== undefined ? Boolean(isAnonymous) : null,
      ]
    );

    // If questions array is provided, replace questions only if respondentCount is 0
    if (Array.isArray(questions)) {
      if (existing.respondentCount > 0) {
        // Only update question titles and descriptions if already has submissions to protect response integrity
        for (const q of questions) {
          if (q.id) {
            await client.query(
              `UPDATE lab_survey_questions SET
                title = COALESCE($2, title),
                description = $3,
                is_required = COALESCE($4, is_required),
                sort_order = COALESCE($5, sort_order)
               WHERE id = $1 AND survey_id = $6`,
              [q.id, q.title ? q.title.trim() : null, q.description || null, q.isRequired, q.sortOrder, surveyId]
            );
          }
        }
      } else {
        // Safe full replacement
        await client.query(`DELETE FROM lab_survey_questions WHERE survey_id = $1`, [surveyId]);
        for (let i = 0; i < questions.length; i++) {
          const q = questions[i];
          const qId = q.id || generateSurveyId("q");
          await client.query(
            `INSERT INTO lab_survey_questions (
              id, survey_id, question_type, category, title, description,
              is_required, sort_order, options, scale_config, created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
            [
              qId,
              surveyId,
              q.questionType || "SHORT_TEXT",
              q.category || "GENERAL",
              q.title ? q.title.trim() : `Pertanyaan ${i + 1}`,
              q.description ? q.description.trim() : null,
              Boolean(q.isRequired),
              q.sortOrder || i + 1,
              JSON.stringify(Array.isArray(q.options) ? q.options : []),
              q.scaleConfig ? JSON.stringify(q.scaleConfig) : null,
            ]
          );
        }
      }
    }

    if (isTransactionOwner) await client.query("COMMIT");
    return getSurveyById(surveyId, executor);
  } catch (err) {
    if (isTransactionOwner) await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    if (isTransactionOwner) client.release();
  }
}

/**
 * Update survey lifecycle status (DRAFT, OPEN, CLOSED, ARCHIVED)
 */
async function updateSurveyStatus(surveyId, newStatus, actorId, executor = pool) {
  await ensureSurveyTables(executor);

  const allowed = ["DRAFT", "OPEN", "CLOSED", "ARCHIVED"];
  if (!allowed.includes(newStatus)) {
    const err = new Error(`Status tidak valid. Harus salah satu dari: ${allowed.join(", ")}`);
    err.status = 400;
    throw err;
  }

  const existing = await getSurveyById(surveyId, executor);

  if (newStatus === "OPEN") {
    if (existing.questions.length === 0) {
      const err = new Error("Survey tidak dapat dibuka karena belum memiliki daftar pertanyaan.");
      err.status = 400;
      throw err;
    }
  }

  await executor.query(
    `UPDATE lab_surveys SET status = $2, updated_at = NOW() WHERE id = $1`,
    [surveyId, newStatus]
  );

  return getSurveyById(surveyId, executor);
}

/**
 * Delete a survey (only if in DRAFT or 0 submissions)
 */
async function deleteSurvey(surveyId, executor = pool) {
  await ensureSurveyTables(executor);

  const existing = await getSurveyById(surveyId, executor);
  if (existing.respondentCount > 0) {
    const err = new Error("Survey yang telah memiliki respon pengisian tidak dapat dihapus. Anda dapat menutup (CLOSED) atau mengarsipkannya.");
    err.status = 409;
    throw err;
  }

  await executor.query(`DELETE FROM lab_surveys WHERE id = $1`, [surveyId]);
  return { success: true, message: "Survey berhasil dihapus." };
}

/**
 * Get active survey targeted for the current student
 */
async function getActiveStudentSurvey(userId, executor = pool) {
  await ensureSurveyTables(executor);

  const student = await resolveStudentRecord(userId, executor);
  if (!student) {
    return { activeSurvey: null, hasSubmitted: false };
  }

  // Find OPEN surveys that target this student's tipe
  const sql = `
    SELECT s.*,
           (sub.id IS NOT NULL) AS has_submitted,
           sub.submitted_at
    FROM lab_surveys s
    LEFT JOIN lab_survey_submissions sub ON sub.survey_id = s.id AND sub.student_id = $1
    WHERE s.status = 'OPEN'
      AND (
        s.target_audience = 'ALL'
        OR (s.target_audience = 'RISET_ONLY' AND $2 = 'Riset')
        OR (s.target_audience = 'MAGANG_ONLY' AND $2 = 'Magang')
      )
    ORDER BY s.created_at DESC
    LIMIT 1
  `;

  const { rows } = await executor.query(sql, [student.id, student.tipe || "Riset"]);
  if (rows.length === 0) {
    return { activeSurvey: null, hasSubmitted: false };
  }

  const s = rows[0];
  const today = new Date().toISOString().slice(0, 10);
  const isPastDeadline = Boolean(s.end_date && s.end_date < today);

  return {
    activeSurvey: {
      id: s.id,
      title: s.title,
      description: s.description,
      status: s.status,
      startDate: s.start_date,
      endDate: s.end_date,
      enforcementType: s.enforcement_type,
      postDeadlinePolicy: s.post_deadline_policy,
      targetAudience: s.target_audience,
      isAnonymous: Boolean(s.is_anonymous),
      isPastDeadline,
    },
    hasSubmitted: Boolean(s.has_submitted),
    submittedAt: s.submitted_at || null,
  };
}

/**
 * Get question form for a student to answer
 */
async function getSurveyFormForStudent(surveyId, userId, executor = pool) {
  await ensureSurveyTables(executor);

  const student = await resolveStudentRecord(userId, executor);
  if (!student) {
    const err = new Error("Profil mahasiswa tidak ditemukan.");
    err.status = 404;
    throw err;
  }

  const survey = await getSurveyById(surveyId, executor);
  if (survey.status !== "OPEN") {
    const err = new Error("Survey ini sedang tidak dibuka untuk pengisian.");
    err.status = 403;
    throw err;
  }

  // Check if student has already submitted
  const { rows: subRows } = await executor.query(
    `SELECT id, submitted_at FROM lab_survey_submissions WHERE survey_id = $1 AND student_id = $2`,
    [surveyId, student.id]
  );

  return {
    ...survey,
    hasSubmitted: subRows.length > 0,
    submittedAt: subRows[0]?.submitted_at || null,
  };
}

/**
 * Submit survey answers for a student
 */
async function submitSurveyAnswers(surveyId, userId, answers, executor = pool) {
  await ensureSurveyTables(executor);

  const student = await resolveStudentRecord(userId, executor);
  if (!student) {
    const err = new Error("Profil mahasiswa tidak ditemukan.");
    err.status = 404;
    throw err;
  }

  const survey = await getSurveyById(surveyId, executor);
  if (survey.status !== "OPEN") {
    const err = new Error("Survey tidak sedang dibuka untuk pengisian.");
    err.status = 403;
    throw err;
  }

  // Check duplicate submission
  const { rows: dupRows } = await executor.query(
    `SELECT id FROM lab_survey_submissions WHERE survey_id = $1 AND student_id = $2`,
    [surveyId, student.id]
  );
  if (dupRows.length > 0) {
    const err = new Error("Anda telah mengisi survey ini. Pengisian hanya dapat dilakukan satu kali.");
    err.status = 409;
    throw err;
  }

  // Validate required questions
  const answerMap = new Map();
  if (Array.isArray(answers)) {
    for (const a of answers) {
      if (a && a.questionId) {
        answerMap.set(a.questionId, a);
      }
    }
  }

  for (const q of survey.questions) {
    if (q.isRequired) {
      const a = answerMap.get(q.id);
      const val = a?.answerText;
      const opts = a?.answerOptions;

      const hasVal = val !== undefined && val !== null && String(val).trim().length > 0;
      const hasOpts = Array.isArray(opts) && opts.length > 0;

      if (!hasVal && !hasOpts) {
        const err = new Error(`Pertanyaan wajib "${q.title}" belum diisi.`);
        err.status = 400;
        throw err;
      }
    }
  }

  const client = executor.connect ? await executor.connect() : executor;
  const isTransactionOwner = Boolean(executor.connect);
  const submissionId = generateSurveyId("sub");

  try {
    if (isTransactionOwner) await client.query("BEGIN");

    await client.query(
      `INSERT INTO lab_survey_submissions (id, survey_id, student_id, user_id, submitted_at, created_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW())`,
      [submissionId, surveyId, student.id, userId]
    );

    for (const q of survey.questions) {
      const a = answerMap.get(q.id);
      if (!a) continue;

      let answerText = a.answerText !== undefined && a.answerText !== null ? String(a.answerText).trim() : null;
      let answerOptions = Array.isArray(a.answerOptions) ? a.answerOptions : [];
      let answerNumber = null;

      if (q.questionType === "LINEAR_SCALE" && answerText !== null) {
        const parsed = Number(answerText);
        if (!Number.isNaN(parsed)) {
          answerNumber = parsed;
        }
      }

      if (answerText || answerOptions.length > 0 || answerNumber !== null) {
        const ansId = generateSurveyId("ans");
        await client.query(
          `INSERT INTO lab_survey_answers (id, submission_id, question_id, answer_text, answer_options, answer_number, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
          [ansId, submissionId, q.id, answerText, JSON.stringify(answerOptions), answerNumber]
        );
      }
    }

    // Auto-release any SURVEY_UNFULFILLED access lock for this student
    await client.query(
      `UPDATE student_access_locks
       SET is_active = FALSE, unlocked_at = NOW(), unlock_reason = 'SURVEY_SUBMITTED'
       WHERE student_id = $1 AND reason = $2 AND is_active = TRUE`,
      [student.id, ACCESS_LOCK_REASON_SURVEY_UNFULFILLED]
    ).catch(() => {});

    if (isTransactionOwner) await client.query("COMMIT");

    return {
      success: true,
      submissionId,
      message: "Respon survey berhasil disimpan. Terima kasih atas feedback Anda!",
    };
  } catch (err) {
    if (isTransactionOwner) await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    if (isTransactionOwner) client.release();
  }
}

/**
 * Get comprehensive analytics, KPIs, and question charts for a survey
 */
async function getSurveyStatistics(surveyId, executor = pool) {
  await ensureSurveyTables(executor);

  const survey = await getSurveyById(surveyId, executor);

  // 1. Target Students Count
  const { rows: targetRows } = await executor.query(
    `SELECT COUNT(st.id) AS target_count
     FROM students st
     JOIN users u ON st.user_id = u.id
     WHERE st.status = 'Aktif'
       AND (
         $1 = 'ALL'
         OR ($1 = 'RISET_ONLY' AND st.tipe = 'Riset')
         OR ($1 = 'MAGANG_ONLY' AND st.tipe = 'Magang')
       )`,
    [survey.targetAudience]
  );
  const targetCount = Number(targetRows[0]?.target_count || 0);
  const respondentCount = survey.respondentCount;
  const responseRate = targetCount > 0 ? Number(((respondentCount / targetCount) * 100).toFixed(1)) : 0;

  // 2. High Level Scores: Overall LSI, Facility Score, Ecosystem Score
  const { rows: lsiRows } = await executor.query(
    `SELECT
       AVG(a.answer_number) AS lsi_score,
       AVG(CASE WHEN q.category = 'FACILITY' THEN a.answer_number END) AS facility_score,
       AVG(CASE WHEN q.category = 'ECOSYSTEM' THEN a.answer_number END) AS ecosystem_score,
       COUNT(a.answer_number) AS total_scale_ratings
     FROM lab_survey_answers a
     JOIN lab_survey_questions q ON q.id = a.question_id
     JOIN lab_survey_submissions sub ON sub.id = a.submission_id
     WHERE sub.survey_id = $1 AND q.question_type = 'LINEAR_SCALE' AND a.answer_number IS NOT NULL`,
    [surveyId]
  );

  const lsi = lsiRows[0]?.lsi_score != null ? Number(Number(lsiRows[0].lsi_score).toFixed(2)) : null;
  const facilityScore = lsiRows[0]?.facility_score != null ? Number(Number(lsiRows[0].facility_score).toFixed(2)) : null;
  const ecosystemScore = lsiRows[0]?.ecosystem_score != null ? Number(Number(lsiRows[0].ecosystem_score).toFixed(2)) : null;

  // 3. Question-level aggregation
  const questionAnalytics = [];

  for (let i = 0; i < survey.questions.length; i++) {
    const q = survey.questions[i];

    if (q.questionType === "LINEAR_SCALE") {
      const { rows: distRows } = await executor.query(
        `SELECT a.answer_number, COUNT(a.id) AS count
         FROM lab_survey_answers a
         JOIN lab_survey_submissions sub ON sub.id = a.submission_id
         WHERE sub.survey_id = $1 AND a.question_id = $2 AND a.answer_number IS NOT NULL
         GROUP BY a.answer_number
         ORDER BY a.answer_number ASC`,
        [surveyId, q.id]
      );

      const min = q.scaleConfig?.min || 1;
      const max = q.scaleConfig?.max || 5;
      const countMap = new Map();
      distRows.forEach((r) => countMap.set(Number(r.answer_number), Number(r.count)));

      const distribution = [];
      let totalScoreSum = 0;
      let totalRatingCount = 0;

      for (let s = min; s <= max; s++) {
        const c = countMap.get(s) || 0;
        distribution.push({ score: s, count: c });
        totalScoreSum += s * c;
        totalRatingCount += c;
      }

      const avg = totalRatingCount > 0 ? Number((totalScoreSum / totalRatingCount).toFixed(2)) : null;

      questionAnalytics.push({
        id: q.id,
        title: q.title,
        questionType: q.questionType,
        category: q.category,
        totalResponses: totalRatingCount,
        average: avg,
        scaleConfig: q.scaleConfig,
        distribution,
      });
    } else if (q.questionType === "MULTIPLE_CHOICE" || q.questionType === "DROPDOWN") {
      const { rows: optRows } = await executor.query(
        `SELECT a.answer_text, COUNT(a.id) AS count
         FROM lab_survey_answers a
         JOIN lab_survey_submissions sub ON sub.id = a.submission_id
         WHERE sub.survey_id = $1 AND a.question_id = $2 AND a.answer_text IS NOT NULL
         GROUP BY a.answer_text
         ORDER BY count DESC`,
        [surveyId, q.id]
      );

      const total = optRows.reduce((sum, r) => sum + Number(r.count), 0);
      const breakdown = (q.options || []).map((opt) => {
        const found = optRows.find((r) => r.answer_text === opt);
        const count = found ? Number(found.count) : 0;
        const percentage = total > 0 ? Number(((count / total) * 100).toFixed(1)) : 0;
        return { label: opt, count, percentage };
      });

      // Include others if any custom answers were saved
      optRows.forEach((r) => {
        if (!q.options?.includes(r.answer_text)) {
          const count = Number(r.count);
          const percentage = total > 0 ? Number(((count / total) * 100).toFixed(1)) : 0;
          breakdown.push({ label: r.answer_text, count, percentage });
        }
      });

      questionAnalytics.push({
        id: q.id,
        title: q.title,
        questionType: q.questionType,
        category: q.category,
        totalResponses: total,
        breakdown,
      });
    } else if (q.questionType === "CHECKBOX") {
      const { rows: cbRows } = await executor.query(
        `SELECT jsonb_array_elements_text(a.answer_options) AS opt_label, COUNT(a.id) AS count
         FROM lab_survey_answers a
         JOIN lab_survey_submissions sub ON sub.id = a.submission_id
         WHERE sub.survey_id = $1 AND a.question_id = $2 AND jsonb_array_length(a.answer_options) > 0
         GROUP BY opt_label
         ORDER BY count DESC`,
        [surveyId, q.id]
      );

      const countMap = new Map();
      cbRows.forEach((r) => countMap.set(r.opt_label, Number(r.count)));

      const breakdown = (q.options || []).map((opt) => {
        const count = countMap.get(opt) || 0;
        return { label: opt, count };
      });

      // Total respondents who answered this question
      const { rows: ansCountRows } = await executor.query(
        `SELECT COUNT(DISTINCT a.id) AS total_responses
         FROM lab_survey_answers a
         JOIN lab_survey_submissions sub ON sub.id = a.submission_id
         WHERE sub.survey_id = $1 AND a.question_id = $2`,
        [surveyId, q.id]
      );

      questionAnalytics.push({
        id: q.id,
        title: q.title,
        questionType: q.questionType,
        category: q.category,
        totalResponses: Number(ansCountRows[0]?.total_responses || 0),
        breakdown,
      });
    } else {
      // SHORT_TEXT / PARAGRAPH
      const { rows: textRows } = await executor.query(
        `SELECT
           a.answer_text,
           a.created_at,
           sub.student_id,
           u.name AS student_name,
           st.nim
         FROM lab_survey_answers a
         JOIN lab_survey_submissions sub ON sub.id = a.submission_id
         JOIN students st ON st.id = sub.student_id
         JOIN users u ON u.id = sub.user_id
         WHERE sub.survey_id = $1 AND a.question_id = $2 AND a.answer_text IS NOT NULL AND a.answer_text != ''
         ORDER BY a.created_at DESC`,
        [surveyId, q.id]
      );

      // ANONYMITY POLICY: Mask student identity if survey is anonymous
      const responses = textRows.map((r, idx) => ({
        answer: r.answer_text,
        submittedAt: r.created_at,
        respondentLabel: survey.isAnonymous ? `Responden #${idx + 1}` : r.student_name,
        nim: survey.isAnonymous ? null : r.nim,
      }));

      questionAnalytics.push({
        id: q.id,
        title: q.title,
        questionType: q.questionType,
        category: q.category,
        totalResponses: responses.length,
        responses,
      });
    }
  }

  return {
    survey: {
      id: survey.id,
      title: survey.title,
      description: survey.description,
      status: survey.status,
      startDate: survey.startDate,
      endDate: survey.endDate,
      enforcementType: survey.enforcementType,
      postDeadlinePolicy: survey.postDeadlinePolicy,
      isAnonymous: survey.isAnonymous,
    },
    kpis: {
      targetStudentsCount: targetCount,
      respondentsCount: respondentCount,
      responseRate,
      labSatisfactionIndex: lsi,
      facilityScore,
      ecosystemScore,
    },
    questions: questionAnalytics,
  };
}

/**
 * Get individual participation and response sheets
 */
async function getSurveySubmissions(surveyId, executor = pool) {
  await ensureSurveyTables(executor);

  const survey = await getSurveyById(surveyId, executor);

  // Fetch all target active students and whether they submitted
  const sql = `
    SELECT
      st.id AS student_id,
      st.nim,
      st.tipe,
      u.name AS student_name,
      sub.id AS submission_id,
      sub.submitted_at,
      (sub.id IS NOT NULL) AS has_submitted
    FROM students st
    JOIN users u ON st.user_id = u.id
    LEFT JOIN lab_survey_submissions sub ON sub.student_id = st.id AND sub.survey_id = $1
    WHERE st.status = 'Aktif'
      AND (
        $2 = 'ALL'
        OR ($2 = 'RISET_ONLY' AND st.tipe = 'Riset')
        OR ($2 = 'MAGANG_ONLY' AND st.tipe = 'Magang')
      )
    ORDER BY sub.submitted_at DESC NULLS LAST, u.name ASC
  `;

  const { rows } = await executor.query(sql, [surveyId, survey.targetAudience]);

  return rows.map((r, idx) => ({
    studentId: r.student_id,
    studentName: r.student_name,
    nim: r.nim,
    tipe: r.tipe,
    hasSubmitted: Boolean(r.has_submitted),
    submittedAt: r.submitted_at || null,
    // When anonymous, individual respondent identifier is masked for sheet tracking
    anonymousRespondentLabel: survey.isAnonymous ? `Responden #${idx + 1}` : r.student_name,
  }));
}

/**
 * Export responses as CSV string
 */
async function exportSurveyResponsesCsv(surveyId, executor = pool) {
  await ensureSurveyTables(executor);

  const survey = await getSurveyById(surveyId, executor);

  const { rows: subRows } = await executor.query(
    `SELECT
       sub.id AS submission_id,
       sub.submitted_at,
       st.nim,
       st.tipe,
       u.name AS student_name
     FROM lab_survey_submissions sub
     JOIN students st ON st.id = sub.student_id
     JOIN users u ON u.id = sub.user_id
     WHERE sub.survey_id = $1
     ORDER BY sub.submitted_at ASC`,
    [surveyId]
  );

  const { rows: ansRows } = await executor.query(
    `SELECT
       a.submission_id,
       a.question_id,
       a.answer_text,
       a.answer_options,
       a.answer_number
     FROM lab_survey_answers a
     JOIN lab_survey_submissions sub ON sub.id = a.submission_id
     WHERE sub.survey_id = $1`,
    [surveyId]
  );

  // Group answers by submissionId
  const submissionAnsMap = new Map();
  ansRows.forEach((a) => {
    if (!submissionAnsMap.has(a.submission_id)) {
      submissionAnsMap.set(a.submission_id, new Map());
    }
    const qMap = submissionAnsMap.get(a.submission_id);

    let displayAnswer = "";
    if (a.answer_number !== null) {
      displayAnswer = String(a.answer_number);
    } else if (Array.isArray(a.answer_options) && a.answer_options.length > 0) {
      displayAnswer = a.answer_options.join("; ");
    } else if (a.answer_text) {
      displayAnswer = a.answer_text;
    }
    qMap.set(a.question_id, displayAnswer);
  });

  // Construct CSV Header
  const headers = ["Waktu Pengisian"];
  if (survey.isAnonymous) {
    headers.push("ID Responden (Anonim)");
  } else {
    headers.push("Nama Mahasiswa", "NIM", "Tipe");
  }

  survey.questions.forEach((q) => {
    headers.push(`"${q.title.replace(/"/g, '""')}"`);
  });

  const lines = [headers.join(",")];

  subRows.forEach((sub, idx) => {
    const row = [
      sub.submitted_at ? new Date(sub.submitted_at).toISOString() : "-",
    ];

    if (survey.isAnonymous) {
      row.push(`"Responden #${idx + 1}"`);
    } else {
      row.push(`"${sub.student_name.replace(/"/g, '""')}"`, `"${sub.nim || "-"}"`, `"${sub.tipe || "-"}"`);
    }

    const qMap = submissionAnsMap.get(sub.submission_id) || new Map();
    survey.questions.forEach((q) => {
      const val = qMap.get(q.id) || "";
      row.push(`"${String(val).replace(/"/g, '""')}"`);
    });

    lines.push(row.join(","));
  });

  return lines.join("\n");
}

/**
 * Enforce post-deadline access locks for unfulfilled surveys
 */
async function enforcePostDeadlineSurveyLocks(executor = pool) {
  await ensureSurveyTables(executor);

  // Find OPEN surveys that have passed deadline with BLOCK_ACCESS policy
  const today = new Date().toISOString().slice(0, 10);
  const { rows: expiredSurveys } = await executor.query(
    `SELECT * FROM lab_surveys
     WHERE status = 'OPEN' AND end_date < $1 AND post_deadline_policy = 'BLOCK_ACCESS'`,
    [today]
  );

  let totalLocked = 0;

  for (const s of expiredSurveys) {
    // Find unsubmitted active students
    const { rows: unsubmitted } = await executor.query(
      `SELECT st.id, st.user_id, u.name
       FROM students st
       JOIN users u ON st.user_id = u.id
       LEFT JOIN lab_survey_submissions sub ON sub.student_id = st.id AND sub.survey_id = $1
       WHERE st.status = 'Aktif'
         AND sub.id IS NULL
         AND (
           $2 = 'ALL'
           OR ($2 = 'RISET_ONLY' AND st.tipe = 'Riset')
           OR ($2 = 'MAGANG_ONLY' AND st.tipe = 'Magang')
         )`,
      [s.id, s.target_audience]
    );

    if (unsubmitted.length > 0) {
      await createStudentAccessLocks(
        unsubmitted.map((st) => ({
          studentId: st.id,
          reason: ACCESS_LOCK_REASON_SURVEY_UNFULFILLED,
          date: today,
          message: `Akses akun dibatasi karena belum mengisi Survey Evaluasi Lab: "${s.title}" yang telah melewati batas deadline (${s.end_date}). Silakan selesaikan pengisian survey untuk membuka kembali akses sistem.`,
        })),
        { executor }
      ).catch(() => {});

      totalLocked += unsubmitted.length;
    }
  }

  return { success: true, expiredSurveysCount: expiredSurveys.length, totalLocked };
}

module.exports = {
  ensureSurveyTables,
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
};
