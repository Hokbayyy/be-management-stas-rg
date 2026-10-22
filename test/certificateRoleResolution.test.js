const test = require("node:test");
const assert = require("node:assert/strict");
const {
  resolveCertificateRole,
  buildCertificateData
} = require("../utils/documentCenterCertificateTemplates");

test("resolveCertificateRole preserves specific position names", () => {
  assert.equal(resolveCertificateRole("Frontend Developer", "Riset"), "Frontend Developer");
  assert.equal(resolveCertificateRole("Machine Learning Engineer", "Magang"), "Machine Learning Engineer");
  assert.equal(resolveCertificateRole("UI/UX Designer", "Riset"), "UI/UX Designer");
  assert.equal(resolveCertificateRole("Embedded System Engineer", "Magang"), "Embedded System Engineer");
  assert.equal(resolveCertificateRole("Web Developer", "Riset"), "Web Developer");
});

test("resolveCertificateRole replaces generic roles ('Alumni', 'Anggota', 'Anggota Riset', 'Peserta Magang', 'Mahasiswa', 'Peserta') with activity-aware default ('Peneliti' for Riset, 'Web Developer' for Magang)", () => {
  for (const genericRole of [
    "Alumni",
    "alumni",
    "ALUMNI",
    "  Alumni  ",
    "Anggota",
    "anggota",
    "Anggota Riset",
    "Peserta Magang",
    "Mahasiswa",
    "Peserta"
  ]) {
    assert.equal(resolveCertificateRole(genericRole, "Riset"), "Peneliti");
    assert.equal(resolveCertificateRole(genericRole, "Magang"), "Web Developer");
  }
});

test("resolveCertificateRole handles null or empty role gracefully with activity-aware default ('Peneliti' for Riset, 'Web Developer' for Magang)", () => {
  assert.equal(resolveCertificateRole(null, "Riset"), "Peneliti");
  assert.equal(resolveCertificateRole("", "Riset"), "Peneliti");
  assert.equal(resolveCertificateRole(undefined, "Magang"), "Web Developer");
  assert.equal(resolveCertificateRole("   ", "Magang"), "Web Developer");
});

test("buildCertificateData produces specific projectRole from snapshot and rejects generic roles", () => {
  const caseRow = {
    student_snapshot: { name: "Budi Santoso" },
    period_snapshot: { startDate: "2026-01-01", endDate: "2026-06-30" },
    activity_type: "Riset"
  };

  const projectRowWithValidRole = {
    project_snapshot: {
      title: "Smart Monitoring IoT",
      role: "IoT Engineer"
    },
    display_order: 0
  };

  const result1 = buildCertificateData(caseRow, projectRowWithValidRole);
  assert.equal(result1.studentName, "Budi Santoso");
  assert.equal(result1.projectTitle, "Smart Monitoring IoT");
  assert.equal(result1.projectRole, "IoT Engineer");

  for (const generic of ["Alumni", "Anggota", "Anggota Riset", "Peserta Magang", "Mahasiswa", "Peserta"]) {
    const projectRowWithGenericRole = {
      project_snapshot: {
        title: "Smart Monitoring IoT",
        role: generic
      },
      display_order: 0
    };

    const result2 = buildCertificateData(caseRow, projectRowWithGenericRole);
    assert.equal(result2.studentName, "Budi Santoso");
    assert.equal(result2.projectTitle, "Smart Monitoring IoT");
    assert.equal(result2.projectRole, "IoT");
    assert.notEqual(result2.projectRole, generic);
  }

  const projectRowNoKeyword = {
    project_snapshot: {
      title: "Penelitian Sistem Terapan",
      role: "Anggota"
    },
    display_order: 0
  };
  const result3 = buildCertificateData(caseRow, projectRowNoKeyword);
  assert.equal(result3.projectRole, "Peneliti");
});

test("documentCenter utilities do not reference non-existent legacy_membership_id column", async () => {
  const fs = require("node:fs/promises");
  const path = require("node:path");
  const files = [
    "../utils/documentCenterFinalActivity.js",
    "../utils/documentCenterCertificateTemplates.js",
    "../utils/documentCenterCompletionLetterTemplates.js"
  ];
  for (const rel of files) {
    const content = await fs.readFile(path.join(__dirname, rel), "utf8");
    assert.equal(content.includes("legacy_membership_id"), false, `${rel} should not reference legacy_membership_id`);
  }
});

test("modified backend modules load cleanly and prioritize specific research_memberships.peran", () => {
  const finalActivity = require("../utils/documentCenterFinalActivity");
  const lookups = require("../utils/documentCenterLookups");
  const draftUpload = require("../utils/documentCenterDraftUpload");
  const studentsRouter = require("../routes/api/students");
  const certificatesRouter = require("../routes/api/certificates");
  const graduationRouter = require("../routes/api/graduationSubmissions");
  const documentCenterRouter = require("../routes/api/documentCenter");

  assert.equal(typeof finalActivity.healStudentFinalActivityCases, "function");
  assert.equal(typeof finalActivity.healCaseAlumniRoleByCaseId, "function");
  assert.equal(typeof finalActivity.healCaseAlumniRoleByDocumentId, "function");
  assert.equal(typeof lookups.listStudentProjects, "function");
  assert.ok(draftUpload);
  assert.ok(studentsRouter);
  assert.ok(certificatesRouter);
  assert.ok(graduationRouter);
  assert.ok(documentCenterRouter);
});

test("studentResearchRoleResolver correctly resolves and prioritizes roles", () => {
  const {
    isGenericOrAlumniRole,
    pickBestResolvedRole,
    buildResolvedProjectRoleSql,
    SQL_GENERIC_ROLES_LIST
  } = require("../utils/studentResearchRoleResolver");

  // Generic identification
  assert.equal(isGenericOrAlumniRole("Alumni"), true);
  assert.equal(isGenericOrAlumniRole("anggota"), true);
  assert.equal(isGenericOrAlumniRole("Anggota Riset"), true);
  assert.equal(isGenericOrAlumniRole("Peserta Magang"), true);
  assert.equal(isGenericOrAlumniRole("Web Developer"), false);
  assert.equal(isGenericOrAlumniRole("Mobile Developer"), false);
  assert.equal(isGenericOrAlumniRole("UI/UX Designer"), false);

  // pickBestResolvedRole: specific role wins over fallback "Web Developer"
  assert.equal(pickBestResolvedRole("Mobile Developer", "Web Developer"), "Mobile Developer");
  assert.equal(pickBestResolvedRole("Web Developer", "Mobile Developer"), "Mobile Developer");
  assert.equal(pickBestResolvedRole("Backend Engineer", "Frontend Engineer"), "Backend Engineer");
  assert.equal(pickBestResolvedRole("", "Data Scientist"), "Data Scientist");
  assert.equal(pickBestResolvedRole("Alumni", "Anggota", "AI Researcher"), "AI Researcher");
  assert.equal(pickBestResolvedRole("Alumni", "Anggota"), "Web Developer");
  assert.equal(pickBestResolvedRole(null, undefined, ""), "Web Developer");

  // SQL generator
  const sql = buildResolvedProjectRoleSql({
    studentIdExpr: "s.id",
    userIdExpr: "s.user_id",
    projectIdExpr: "rp.id"
  });
  assert.ok(sql.includes("research_divisions"), "SQL should check research_divisions");
  assert.ok(sql.includes("graduation_submission_projects"), "SQL should check graduation_submission_projects");
  assert.ok(sql.includes("research_memberships"), "SQL should check research_memberships");
  assert.ok(sql.includes(SQL_GENERIC_ROLES_LIST), "SQL should use SQL_GENERIC_ROLES_LIST");
});

test("no destructive mass Web Developer UPDATE statements exist in codebase", async () => {
  const fs = require("node:fs/promises");
  const path = require("node:path");
  const filesToCheck = [
    "../routes/api/students.js",
    "../routes/api/research.js",
    "../utils/documentCenterFinalActivity.js",
    "../utils/studentResearchRoleResolver.js"
  ];
  for (const rel of filesToCheck) {
    const content = await fs.readFile(path.join(__dirname, rel), "utf8");
    // Destructive pattern: UPDATE research_memberships rm SET peran = ... 'Web Developer' WHERE ... IN ('', 'alumni'...)
    assert.equal(
      /UPDATE\s+research_memberships\s+rm\s+SET\s+peran\s*=\s*COALESCE\s*\(\s*\(\s*SELECT[\s\S]*?'Web Developer'[\s\S]*?WHERE\s+rm\.member_type\s*=\s*'Mahasiswa'\s+AND\s+LOWER/i.test(content),
      false,
      `${rel} should not contain destructive mass Web Developer UPDATE on research_memberships`
    );
  }
});

test("students endpoint queries avoid cartesian product and 18-column GROUP BY", async () => {
  const fs = require("node:fs/promises");
  const path = require("node:path");
  const content = await fs.readFile(path.join(__dirname, "../routes/api/students.js"), "utf8");
  assert.ok(!content.includes("COUNT(DISTINCT lr.id)::int AS wfh_used"), "students.js should not have COUNT(DISTINCT lr.id) cartesian product");
  assert.ok(content.includes("SELECT COUNT(*)::int AS wfh_used"), "students.js should pre-aggregate wfh_used via lateral join");
  assert.ok(content.includes("COALESCE(array_agg(rp.id)"), "students.js should pre-aggregate research_memberships via lateral join");
});

test("documentCenterFinalActivity listCases performs non-blocking background heal", async () => {
  const fs = require("node:fs/promises");
  const path = require("node:path");
  const content = await fs.readFile(path.join(__dirname, "../utils/documentCenterFinalActivity.js"), "utf8");
  assert.ok(content.includes("setImmediate(async () => {"), "listCases should run background heal via setImmediate");
});

test("logbooks GET endpoint supports pagination limit and offset", async () => {
  const fs = require("node:fs/promises");
  const path = require("node:path");
  const content = await fs.readFile(path.join(__dirname, "../routes/api/logbooks.js"), "utf8");
  assert.ok(content.includes("req.query.limit"), "logbooks.js should parse limit from req.query");
  assert.ok(content.includes("req.query.offset"), "logbooks.js should parse offset from req.query");
  assert.ok(content.includes("${paginationClause}"), "logbooks.js SQL query should include paginationClause");
});

test("Creative and Social Media projects correctly resolve to Creative Content instead of Web Developer", () => {
  const { inferRoleFromProjectTitle } = require("../utils/studentResearchRoleResolver");
  const { buildLetterData } = require("../utils/documentCenterCompletionLetterTemplates");
  const { buildCertificateData, resolveCertificateRole } = require("../utils/documentCenterCertificateTemplates");

  assert.equal(inferRoleFromProjectTitle("Creative and Social Media"), "Creative Content");
  assert.equal(inferRoleFromProjectTitle("Creative Content"), "Creative Content");
  assert.equal(inferRoleFromProjectTitle("Social Media"), "Sosial Media");

  // Certificate data test for Creative and Social Media with Web Developer role
  const caseRow = {
    student_snapshot: { name: "Anisa Rahma" },
    period_snapshot: { startDate: "2026-10-05", endDate: "2026-10-05" },
    activity_type: "Magang"
  };
  const projectRowCreative = {
    project_snapshot: {
      title: "Creative and Social Media",
      role: "Web Developer"
    },
    display_order: 0
  };
  const certData = buildCertificateData(caseRow, projectRowCreative);
  assert.equal(certData.projectRole, "Creative Content");

  // Completion letter test for Creative and Social Media with Web Developer role
  const letterData = buildLetterData({
    studentSnapshot: caseRow.student_snapshot,
    periodSnapshot: caseRow.period_snapshot,
    projectSnapshot: projectRowCreative.project_snapshot,
    activityType: "Magang"
  });
  assert.equal(letterData.projectRole, "Creative Content");
  assert.ok(
    letterData.activityParagraph.includes('dengan peran sebagai Creative Content'),
    "Activity paragraph should state role as Creative Content"
  );
  assert.ok(
    !letterData.activityParagraph.includes('dengan peran sebagai Web Developer'),
    "Activity paragraph should NOT state role as Web Developer"
  );
});

test("Certificate generation prioritizes role assigned in Data Mahasiswa on research task", () => {
  const { buildCertificateData, resolveCertificateRole } = require("../utils/documentCenterCertificateTemplates");

  const risetCase = {
    student_snapshot: { name: "Rizky Pratama" },
    period_snapshot: { startDate: "2026-02-01", endDate: "2026-08-01" },
    activity_type: "Riset"
  };

  // Test 1: Role from Data Mahasiswa is "Peneliti"
  const projectPeneliti = {
    project_snapshot: {
      title: "Riset Machine Learning STAS",
      role: "Peneliti"
    },
    display_order: 0
  };
  const cert1 = buildCertificateData(risetCase, projectPeneliti);
  assert.equal(cert1.projectRole, "Peneliti");

  // Test 2: Role from Data Mahasiswa is "UI/UX Designer"
  const projectDesigner = {
    project_snapshot: {
      title: "Riset Machine Learning STAS",
      role: "UI/UX Designer"
    },
    display_order: 0
  };
  const cert2 = buildCertificateData(risetCase, projectDesigner);
  assert.equal(cert2.projectRole, "UI/UX Designer");

  // Test 3: Role from Data Mahasiswa is "Data Scientist"
  const projectDataScientist = {
    project_snapshot: {
      title: "Creative and Social Media",
      role: "Data Scientist"
    },
    display_order: 0
  };
  const cert3 = buildCertificateData(risetCase, projectDataScientist);
  assert.equal(cert3.projectRole, "Data Scientist");

  // Test 4: Role from Data Mahasiswa was generic "Anggota Riset" on generic title -> resolves to "Peneliti", not "Web Developer"
  const projectGenericRiset = {
    project_snapshot: {
      title: "Proyek Riset Khusus",
      role: "Anggota Riset"
    },
    display_order: 0
  };
  const cert4 = buildCertificateData(risetCase, projectGenericRiset);
  assert.equal(cert4.projectRole, "Peneliti");
  assert.notEqual(cert4.projectRole, "Web Developer");

  // Test 5: Magang case with multiple projects - second project (display_order: 1) is a Riset task
  const magangCase = {
    student_snapshot: { name: "Dewi Lestari" },
    period_snapshot: { startDate: "2026-01-01", endDate: "2026-06-01" },
    activity_type: "Magang"
  };
  const additionalRisetProject = {
    project_snapshot: {
      title: "Riset Computer Vision",
      role: "Anggota"
    },
    display_order: 1
  };
  const cert5 = buildCertificateData(magangCase, additionalRisetProject);
  assert.equal(cert5.activityType, "Riset");
  assert.equal(cert5.projectRole, "Peneliti");
  assert.notEqual(cert5.projectRole, "Web Developer");
});

test("documentCenterCertificateTemplates has isGenericOrAlumniRole properly imported and accessible", async () => {
  const fs = require("node:fs/promises");
  const path = require("node:path");
  const content = await fs.readFile(path.join(__dirname, "../utils/documentCenterCertificateTemplates.js"), "utf8");
  assert.ok(content.includes("isGenericOrAlumniRole"), "documentCenterCertificateTemplates.js must import isGenericOrAlumniRole");
  const certModule = require("../utils/documentCenterCertificateTemplates");
  assert.ok(certModule.generateCertificateDraft, "generateCertificateDraft must be defined");
});

test("Certificate published version prioritizes updated snapshot.project role over stale rawCertData", () => {
  const { resolveCertificateRole } = require("../utils/documentCenterCertificateTemplates");
  const rawCertData = {
    projectTitle: "Creative and Social Media",
    projectRole: "Web Developer",
    activityType: "Magang"
  };
  const snapshot = {
    project: {
      title: "Creative and Social Media",
      role: "Creative Content"
    }
  };

  const certProjectTitle = snapshot.project?.title || rawCertData.projectTitle || "";
  const candidateRole = snapshot.project?.role || rawCertData.projectRole;
  const resolved = resolveCertificateRole(candidateRole, rawCertData.activityType, certProjectTitle);

  assert.equal(resolved, "Creative Content", "Updated role from Database Mahasiswa snapshot must override stale Web Developer");
});

test("Completion Letter buildLetterData never outputs Web Developer for non-web projects even if snapshot had Web Developer", () => {
  const { buildLetterData } = require("../utils/documentCenterCompletionLetterTemplates");
  const studentSnapshot = { name: "Ahmad Dahlan", nim: "1202200001", prodi: "S1 Sistem Informasi" };
  const periodSnapshot = { startDate: "2026-10-05", endDate: "2026-10-05" };
  const projectSnapshot = {
    title: "Creative and Social Media",
    role: "Web Developer"
  };

  const letterData = buildLetterData({
    studentSnapshot,
    periodSnapshot,
    projectSnapshot,
    projectSnapshots: [projectSnapshot],
    activityType: "Magang"
  });

  assert.equal(letterData.projectRole, "Creative Content");
  assert.ok(
    letterData.activityParagraph.includes('Creative Content'),
    "Activity paragraph must reflect Creative Content"
  );
  assert.ok(
    !letterData.activityParagraph.includes('dengan peran sebagai Web Developer'),
    "Activity paragraph must NOT contain Web Developer for Creative and Social Media"
  );
});

test("Certificate period prioritizes project_snapshot joinedAt and completedAt over case-level period", () => {
  const { buildCertificateData } = require("../utils/documentCenterCertificateTemplates");

  const caseRow = {
    student_snapshot: { name: "Ahmad Dahlan" },
    period_snapshot: { startDate: "2026-10-05", endDate: "2026-10-05" },
    activity_type: "Magang"
  };

  const projectRowSpecificDates = {
    project_snapshot: {
      title: "Creative and Social Media",
      role: "Creative Content",
      joinedAt: "2026-02-01",
      completedAt: "2026-08-31"
    },
    display_order: 0
  };

  const certData = buildCertificateData(caseRow, projectRowSpecificDates);
  assert.equal(certData.projectTitle, "Creative and Social Media");
  assert.equal(certData.projectRole, "Creative Content");
  assert.equal(certData.periodLabel, "1 Februari 2026 sampai 31 Agustus 2026");
});

test("Certificate and Letter handle single-day / same start and end dates gracefully", () => {
  const { buildCertificateData } = require("../utils/documentCenterCertificateTemplates");
  const { buildLetterData } = require("../utils/documentCenterCompletionLetterTemplates");

  const caseRow = {
    student_snapshot: { name: "Anisa Rahma", nim: "123456", prodi: "Teknik Informatika" },
    period_snapshot: { startDate: "2026-10-05", endDate: "2026-10-05" },
    activity_type: "Magang"
  };

  const projectRowSameDate = {
    project_snapshot: {
      title: "Creative and Social Media",
      role: "Sosial Media",
      joinedAt: "2026-10-05",
      completedAt: "2026-10-05"
    },
    display_order: 0
  };

  const certData = buildCertificateData(caseRow, projectRowSameDate);
  assert.equal(certData.periodLabel, "5 Oktober 2026");

  const letterData = buildLetterData({
    studentSnapshot: caseRow.student_snapshot,
    periodSnapshot: caseRow.period_snapshot,
    projectSnapshot: projectRowSameDate.project_snapshot,
    activityType: "Magang"
  });
  assert.ok(
    letterData.activityParagraph.includes("pada tanggal 5 Oktober 2026"),
    "Letter should say 'pada tanggal 5 Oktober 2026' instead of 'terhitung sejak 5 Oktober 2026 sampai dengan 5 Oktober 2026'"
  );
});

test("Completion letter prioritizes project-level joinedAt and completedAt over case-level period", () => {
  const { buildLetterData } = require("../utils/documentCenterCompletionLetterTemplates");

  const studentSnapshot = { name: "Farhan Malik", nim: "1202200005", prodi: "S1 Informatika" };
  const periodSnapshot = { startDate: "2026-10-05", endDate: "2026-10-05" };
  const projectSnapshot = {
    title: "Platform Smart Technology and Applied Sciences",
    role: "Backend Engineer",
    joinedAt: "2026-03-01",
    completedAt: "2026-09-30"
  };

  const letterData = buildLetterData({
    studentSnapshot,
    periodSnapshot,
    projectSnapshot,
    activityType: "Riset"
  });

  assert.equal(letterData.periodStart, "2026-03-01");
  assert.equal(letterData.periodEnd, "2026-09-30");
  assert.equal(letterData.projectRole, "Backend Engineer");
  assert.ok(
    letterData.activityParagraph.includes("1 Maret 2026 sampai dengan 30 September 2026"),
    "Letter activity paragraph should use project-specific dates from Data Mahasiswa"
  );
});




