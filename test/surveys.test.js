const test = require("node:test");
const assert = require("node:assert/strict");
const {
  ensureSurveyTables,
  createSurvey,
  updateSurvey,
  updateSurveyStatus,
  deleteSurvey,
  getSurveyById,
  submitSurveyAnswers,
  getSurveyStatistics,
  exportSurveyResponsesCsv,
  enforcePostDeadlineSurveyLocks,
} = require("../utils/surveyService");

// Mock database helper for unit testing survey logic
function createMockDb() {
  const tables = {
    lab_surveys: [],
    lab_survey_questions: [],
    lab_survey_submissions: [],
    lab_survey_answers: [],
    students: [
      { id: "std-1", user_id: "usr-1", nim: "1301210001", status: "Aktif", tipe: "Riset" },
      { id: "std-2", user_id: "usr-2", nim: "1301210002", status: "Aktif", tipe: "Riset" },
      { id: "std-3", user_id: "usr-3", nim: "1301210003", status: "Aktif", tipe: "Magang" },
    ],
    users: [
      { id: "usr-1", name: "Mahasiswa Satu" },
      { id: "usr-2", name: "Mahasiswa Dua" },
      { id: "usr-3", name: "Mahasiswa Tiga" },
    ],
    student_access_locks: [],
  };

  return {
    tables,
    query: async (sql, params = []) => {
      const lower = sql.toLowerCase();

      if (lower.includes("create table") || lower.includes("create index")) {
        return { rows: [] };
      }

      if (lower.includes("insert into lab_surveys")) {
        const row = {
          id: params[0],
          title: params[1],
          description: params[2],
          status: "DRAFT",
          start_date: params[3],
          end_date: params[4],
          enforcement_type: params[5],
          post_deadline_policy: params[6],
          target_audience: params[7],
          is_anonymous: params[8],
          created_by: params[9],
          created_at: new Date(),
          updated_at: new Date(),
        };
        tables.lab_surveys.push(row);
        return { rows: [row] };
      }

      if (lower.includes("insert into lab_survey_questions")) {
        const row = {
          id: params[0],
          survey_id: params[1],
          question_type: params[2],
          category: params[3],
          title: params[4],
          description: params[5],
          is_required: params[6],
          sort_order: params[7],
          options: typeof params[8] === "string" ? JSON.parse(params[8]) : params[8],
          scale_config: typeof params[9] === "string" ? JSON.parse(params[9]) : params[9],
          created_at: new Date(),
        };
        tables.lab_survey_questions.push(row);
        return { rows: [row] };
      }

      if (lower.includes("insert into lab_survey_submissions")) {
        const row = {
          id: params[0],
          survey_id: params[1],
          student_id: params[2],
          user_id: params[3],
          submitted_at: new Date(),
          created_at: new Date(),
        };
        tables.lab_survey_submissions.push(row);
        return { rows: [row] };
      }

      if (lower.includes("insert into lab_survey_answers")) {
        const row = {
          id: params[0],
          submission_id: params[1],
          question_id: params[2],
          answer_text: params[3],
          answer_options: typeof params[4] === "string" ? JSON.parse(params[4]) : params[4],
          answer_number: params[5],
          created_at: new Date(),
        };
        tables.lab_survey_answers.push(row);
        return { rows: [row] };
      }

      if (lower.includes("select * from lab_surveys where id =")) {
        const s = tables.lab_surveys.find((x) => x.id === params[0]);
        return { rows: s ? [s] : [] };
      }

      if (lower.includes("from lab_survey_questions where survey_id =")) {
        const qs = tables.lab_survey_questions.filter((x) => x.survey_id === params[0]);
        return { rows: qs };
      }

      if (lower.includes("count(id) as respondent_count from lab_survey_submissions")) {
        const count = tables.lab_survey_submissions.filter((x) => x.survey_id === params[0]).length;
        return { rows: [{ respondent_count: count }] };
      }

      if (lower.includes("count(st.id) as target_count")) {
        const targetAudience = params[0];
        let count = tables.students.length;
        if (targetAudience === "RISET_ONLY") count = tables.students.filter((s) => s.tipe === "Riset").length;
        if (targetAudience === "MAGANG_ONLY") count = tables.students.filter((s) => s.tipe === "Magang").length;
        return { rows: [{ target_count: count }] };
      }

      if (lower.includes("avg(a.answer_number) as lsi_score")) {
        const surveyId = params[0];
        const subIds = tables.lab_survey_submissions.filter((s) => s.survey_id === surveyId).map((s) => s.id);
        const scaleAnswers = tables.lab_survey_answers.filter(
          (a) => subIds.includes(a.submission_id) && a.answer_number !== null
        );

        if (scaleAnswers.length === 0) {
          return { rows: [{ lsi_score: null, facility_score: null, ecosystem_score: null }] };
        }

        const lsi = scaleAnswers.reduce((sum, a) => sum + Number(a.answer_number), 0) / scaleAnswers.length;

        const facAnswers = scaleAnswers.filter((a) => {
          const q = tables.lab_survey_questions.find((x) => x.id === a.question_id);
          return q?.category === "FACILITY";
        });
        const facScore = facAnswers.length > 0
          ? facAnswers.reduce((sum, a) => sum + Number(a.answer_number), 0) / facAnswers.length
          : null;

        const ecoAnswers = scaleAnswers.filter((a) => {
          const q = tables.lab_survey_questions.find((x) => x.id === a.question_id);
          return q?.category === "ECOSYSTEM";
        });
        const ecoScore = ecoAnswers.length > 0
          ? ecoAnswers.reduce((sum, a) => sum + Number(a.answer_number), 0) / ecoAnswers.length
          : null;

        return { rows: [{ lsi_score: lsi, facility_score: facScore, ecosystem_score: ecoScore }] };
      }

      if (lower.includes("select a.answer_number, count(a.id) as count")) {
        const surveyId = params[0];
        const qId = params[1];
        const subIds = tables.lab_survey_submissions.filter((s) => s.survey_id === surveyId).map((s) => s.id);
        const ans = tables.lab_survey_answers.filter((a) => subIds.includes(a.submission_id) && a.question_id === qId);

        const counts = {};
        ans.forEach((a) => {
          const val = a.answer_number;
          counts[val] = (counts[val] || 0) + 1;
        });

        return {
          rows: Object.entries(counts).map(([k, v]) => ({ answer_number: Number(k), count: v })),
        };
      }

      if (lower.includes("select a.answer_text, count(a.id) as count")) {
        const surveyId = params[0];
        const qId = params[1];
        const subIds = tables.lab_survey_submissions.filter((s) => s.survey_id === surveyId).map((s) => s.id);
        const ans = tables.lab_survey_answers.filter((a) => subIds.includes(a.submission_id) && a.question_id === qId);

        const counts = {};
        ans.forEach((a) => {
          const val = a.answer_text;
          counts[val] = (counts[val] || 0) + 1;
        });

        return {
          rows: Object.entries(counts).map(([k, v]) => ({ answer_text: k, count: v })),
        };
      }

      if (lower.includes("jsonb_array_elements_text(a.answer_options) as opt_label")) {
        const surveyId = params[0];
        const qId = params[1];
        const subIds = tables.lab_survey_submissions.filter((s) => s.survey_id === surveyId).map((s) => s.id);
        const ans = tables.lab_survey_answers.filter((a) => subIds.includes(a.submission_id) && a.question_id === qId);

        const counts = {};
        ans.forEach((a) => {
          (a.answer_options || []).forEach((opt) => {
            counts[opt] = (counts[opt] || 0) + 1;
          });
        });

        return {
          rows: Object.entries(counts).map(([k, v]) => ({ opt_label: k, count: v })),
        };
      }

      if (lower.includes("select count(distinct a.id) as total_responses")) {
        const surveyId = params[0];
        const qId = params[1];
        const subIds = tables.lab_survey_submissions.filter((s) => s.survey_id === surveyId).map((s) => s.id);
        const ans = tables.lab_survey_answers.filter((a) => subIds.includes(a.submission_id) && a.question_id === qId);
        return { rows: [{ total_responses: ans.length }] };
      }

      if (lower.includes("from lab_survey_answers a") && lower.includes("join students st")) {
        const surveyId = params[0];
        const qId = params[1];
        const subIds = tables.lab_survey_submissions.filter((s) => s.survey_id === surveyId).map((s) => s.id);
        const ans = tables.lab_survey_answers.filter((a) => subIds.includes(a.submission_id) && a.question_id === qId);

        return {
          rows: ans.map((a) => {
            const sub = tables.lab_survey_submissions.find((s) => s.id === a.submission_id);
            const st = tables.students.find((s) => s.id === sub?.student_id);
            const u = tables.users.find((x) => x.id === sub?.user_id);
            return {
              answer_text: a.answer_text,
              created_at: a.created_at,
              student_id: st?.id,
              student_name: u?.name,
              nim: st?.nim,
            };
          }),
        };
      }

      if (lower.includes("select id from lab_survey_submissions where survey_id =") || lower.includes("select id, submitted_at from lab_survey_submissions")) {
        const surveyId = params[0];
        const studentId = params[1];
        const found = tables.lab_survey_submissions.find((s) => s.survey_id === surveyId && s.student_id === studentId);
        return { rows: found ? [found] : [] };
      }

      if (lower.includes("from students s") || lower.includes("from students st") || lower.includes("from students where")) {
        const val = params[0];
        const found = tables.students.find((s) => s.id === val || s.user_id === val);
        if (!found) return { rowCount: 0, rows: [] };
        const u = tables.users.find((x) => x.id === found.user_id);
        return {
          rowCount: 1,
          rows: [{ ...found, name: u?.name || "Nama Mahasiswa" }],
        };
      }

      if (lower.includes("update lab_surveys set status =")) {
        const s = tables.lab_surveys.find((x) => x.id === params[0]);
        if (s) s.status = params[1];
        return { rows: [s] };
      }

      if (lower.includes("update student_access_locks")) {
        return { rows: [] };
      }

      if (lower.includes("from lab_survey_submissions sub") && lower.includes("order by sub.submitted_at asc")) {
        const surveyId = params[0];
        const subs = tables.lab_survey_submissions.filter((s) => s.survey_id === surveyId);
        return {
          rows: subs.map((sub) => {
            const st = tables.students.find((s) => s.id === sub.student_id);
            const u = tables.users.find((x) => x.id === sub.user_id);
            return {
              submission_id: sub.id,
              submitted_at: sub.submitted_at,
              nim: st?.nim,
              tipe: st?.tipe,
              student_name: u?.name,
            };
          }),
        };
      }

      if (lower.includes("from lab_survey_answers a") && lower.includes("where sub.survey_id = $1")) {
        const surveyId = params[0];
        const subIds = tables.lab_survey_submissions.filter((s) => s.survey_id === surveyId).map((s) => s.id);
        const ans = tables.lab_survey_answers.filter((a) => subIds.includes(a.submission_id));
        return { rows: ans };
      }

      return { rows: [] };
    },
  };
}

// -----------------------------------------------------------------------------
// SURVEY SYSTEM UNIT TESTS
// -----------------------------------------------------------------------------

test("1. Survey Creation: creates survey with categories, scale config, and enforcement options", async () => {
  const db = createMockDb();

  const survey = await createSurvey(
    {
      title: "Survey Fasilitas & Ekosistem Lab Semester Genap",
      description: "Evaluasi kenyamanan berkegiatan di lab STAS-RG",
      startDate: "2026-11-01",
      endDate: "2026-11-20",
      enforcementType: "MANDATORY_REDIRECT",
      postDeadlinePolicy: "BLOCK_ACCESS",
      targetAudience: "ALL",
      isAnonymous: true,
      questions: [
        {
          questionType: "LINEAR_SCALE",
          category: "FACILITY",
          title: "Kenyamanan suhu AC dan udara lab",
          isRequired: true,
          scaleConfig: { min: 1, max: 5, min_label: "Sangat Buruk", max_label: "Sangat Baik" },
        },
        {
          questionType: "LINEAR_SCALE",
          category: "ECOSYSTEM",
          title: "Kenyamanan komunikasi dan bimbingan PM/Dosen",
          isRequired: true,
          scaleConfig: { min: 1, max: 5, min_label: "Sangat Sulit", max_label: "Sangat Mudah" },
        },
        {
          questionType: "CHECKBOX",
          category: "FACILITY",
          title: "Fasilitas yang paling mendesak diperbaiki",
          isRequired: false,
          options: ["Stopkontak", "Kursi Ergonomis", "Kebersihan", "Wi-Fi"],
        },
        {
          questionType: "PARAGRAPH",
          category: "GENERAL",
          title: "Kritik & Saran",
          isRequired: false,
        },
      ],
    },
    "operator-1",
    db
  );

  assert.ok(survey.id);
  assert.equal(survey.title, "Survey Fasilitas & Ekosistem Lab Semester Genap");
  assert.equal(survey.enforcementType, "MANDATORY_REDIRECT");
  assert.equal(survey.postDeadlinePolicy, "BLOCK_ACCESS");
  assert.equal(survey.isAnonymous, true);
  assert.equal(survey.questions.length, 4);
  assert.equal(survey.questions[0].category, "FACILITY");
  assert.equal(survey.questions[1].category, "ECOSYSTEM");
});

test("2. Survey Lifecycle: cannot open survey with 0 questions; status transitions properly", async () => {
  const db = createMockDb();

  const emptySurvey = await createSurvey(
    {
      title: "Survey Tanpa Pertanyaan",
      startDate: "2026-11-01",
      endDate: "2026-11-15",
      questions: [],
    },
    "operator-1",
    db
  );

  await assert.rejects(
    () => updateSurveyStatus(emptySurvey.id, "OPEN", "operator-1", db),
    /belum memiliki daftar pertanyaan/
  );

  // Add a question
  await updateSurvey(
    emptySurvey.id,
    {
      questions: [
        {
          questionType: "SHORT_TEXT",
          title: "Nama Project",
          isRequired: true,
        },
      ],
    },
    "operator-1",
    db
  );

  const opened = await updateSurveyStatus(emptySurvey.id, "OPEN", "operator-1", db);
  assert.equal(opened.status, "OPEN");

  const closed = await updateSurveyStatus(emptySurvey.id, "CLOSED", "operator-1", db);
  assert.equal(closed.status, "CLOSED");
});

test("3. Student Submission: validates required questions and blocks duplicate submissions", async () => {
  const db = createMockDb();

  const survey = await createSurvey(
    {
      title: "Survey Kenyamanan Lab",
      startDate: "2026-11-01",
      endDate: "2026-11-30",
      questions: [
        {
          questionType: "LINEAR_SCALE",
          category: "FACILITY",
          title: "Kenyamanan Suhu AC",
          isRequired: true,
        },
        {
          questionType: "PARAGRAPH",
          category: "GENERAL",
          title: "Saran Tambahan",
          isRequired: false,
        },
      ],
    },
    "operator-1",
    db
  );

  // Open the survey
  await updateSurveyStatus(survey.id, "OPEN", "operator-1", db);

  const q1 = survey.questions[0];
  const q2 = survey.questions[1];

  // Attempt submit without filling required question -> rejected
  await assert.rejects(
    () =>
      submitSurveyAnswers(
        survey.id,
        "usr-1",
        [
          { questionId: q2.id, answerText: "Saran saja tanpa rating" },
        ],
        db
      ),
    /belum diisi/
  );

  // Valid submission
  const res = await submitSurveyAnswers(
    survey.id,
    "usr-1",
    [
      { questionId: q1.id, answerText: "4" },
      { questionId: q2.id, answerText: "AC ruangan mohon diservis berkala" },
    ],
    db
  );

  assert.equal(res.success, true);
  assert.ok(res.submissionId);

  // Attempt duplicate submission by same student -> rejected with 409
  await assert.rejects(
    () =>
      submitSurveyAnswers(
        survey.id,
        "usr-1",
        [
          { questionId: q1.id, answerText: "5" },
        ],
        db
      ),
    /hanya dapat dilakukan satu kali/
  );
});

test("4. Analytics & KPIs: computes LSI, Facility Score, Ecosystem Score, and masks identity when is_anonymous is true", async () => {
  const db = createMockDb();

  const survey = await createSurvey(
    {
      title: "Survey Kepuasan Lab",
      startDate: "2026-11-01",
      endDate: "2026-11-30",
      isAnonymous: true,
      questions: [
        {
          questionType: "LINEAR_SCALE",
          category: "FACILITY",
          title: "Kenyamanan Fasilitas",
          scaleConfig: { min: 1, max: 5 },
        },
        {
          questionType: "LINEAR_SCALE",
          category: "ECOSYSTEM",
          title: "Kenyamanan Budaya Riset",
          scaleConfig: { min: 1, max: 5 },
        },
        {
          questionType: "PARAGRAPH",
          category: "GENERAL",
          title: "Masukan Terbuka",
        },
      ],
    },
    "operator-1",
    db
  );

  await updateSurveyStatus(survey.id, "OPEN", "operator-1", db);

  const [qFac, qEco, qText] = survey.questions;

  // Student 1 submits: Facility 4, Ecosystem 5
  await submitSurveyAnswers(
    survey.id,
    "usr-1",
    [
      { questionId: qFac.id, answerText: "4" },
      { questionId: qEco.id, answerText: "5" },
      { questionId: qText.id, answerText: "Ruang lab sangat nyaman untuk fokus riset." },
    ],
    db
  );

  // Student 2 submits: Facility 2, Ecosystem 3
  await submitSurveyAnswers(
    survey.id,
    "usr-2",
    [
      { questionId: qFac.id, answerText: "2" },
      { questionId: qEco.id, answerText: "3" },
      { questionId: qText.id, answerText: "Wi-Fi sering putus saat sore hari." },
    ],
    db
  );

  const stats = await getSurveyStatistics(survey.id, db);

  // Overall LSI: avg(4, 5, 2, 3) = 14 / 4 = 3.50
  assert.equal(stats.kpis.labSatisfactionIndex, 3.5);
  // Facility Score: avg(4, 2) = 3.00
  assert.equal(stats.kpis.facilityScore, 3.0);
  // Ecosystem Score: avg(5, 3) = 4.00
  assert.equal(stats.kpis.ecosystemScore, 4.0);

  // Total Respondents = 2, Target = 3 students -> 66.7%
  assert.equal(stats.kpis.respondentsCount, 2);
  assert.equal(stats.kpis.responseRate, 66.7);

  // ANONYMITY VERIFICATION:
  // For paragraph feedback, student name and NIM must be masked as 'Responden #1', 'Responden #2'
  const textQuestionStats = stats.questions.find((q) => q.id === qText.id);
  assert.ok(textQuestionStats);
  assert.equal(textQuestionStats.responses.length, 2);
  assert.equal(textQuestionStats.responses[0].respondentLabel, "Responden #1");
  assert.equal(textQuestionStats.responses[0].nim, null);
  assert.equal(textQuestionStats.responses[1].respondentLabel, "Responden #2");
  assert.equal(textQuestionStats.responses[1].nim, null);
});

test("5. CSV Export: masks student identities into 'ID Responden (Anonim)' when is_anonymous is true", async () => {
  const db = createMockDb();

  const survey = await createSurvey(
    {
      title: "Survey Lab Anonim",
      startDate: "2026-11-01",
      endDate: "2026-11-30",
      isAnonymous: true,
      questions: [
        { questionType: "SHORT_TEXT", title: "Divisi Anda" },
      ],
    },
    "operator-1",
    db
  );

  await updateSurveyStatus(survey.id, "OPEN", "operator-1", db);

  await submitSurveyAnswers(
    survey.id,
    "usr-1",
    [{ questionId: survey.questions[0].id, answerText: "Software Engineer" }],
    db
  );

  const csv = await exportSurveyResponsesCsv(survey.id, db);

  // Header must contain 'ID Responden (Anonim)' and NOT 'Nama Mahasiswa'
  assert.ok(csv.includes("ID Responden (Anonim)"));
  assert.ok(!csv.includes("Nama Mahasiswa"));
  assert.ok(csv.includes("Responden #1"));
  assert.ok(csv.includes("Software Engineer"));
  assert.ok(!csv.includes("Mahasiswa Satu")); // User name must NOT appear in anonymous export
});
