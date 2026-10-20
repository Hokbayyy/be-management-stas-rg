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

test("resolveCertificateRole replaces generic roles ('Alumni', 'Anggota', 'Anggota Riset', 'Peserta Magang', 'Mahasiswa', 'Peserta') with specific role 'Web Developer'", () => {
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
    assert.equal(resolveCertificateRole(genericRole, "Riset"), "Web Developer");
    assert.equal(resolveCertificateRole(genericRole, "Magang"), "Web Developer");
  }
});

test("resolveCertificateRole handles null or empty role gracefully with specific role 'Web Developer'", () => {
  assert.equal(resolveCertificateRole(null, "Riset"), "Web Developer");
  assert.equal(resolveCertificateRole("", "Riset"), "Web Developer");
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
    assert.equal(result2.projectRole, "Web Developer");
    assert.notEqual(result2.projectRole, generic);
  }
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



