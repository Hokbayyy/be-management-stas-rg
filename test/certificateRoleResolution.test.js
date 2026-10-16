const test = require("node:test");
const assert = require("node:assert/strict");
const {
  resolveCertificateRole,
  buildCertificateData
} = require("../utils/documentCenterCertificateTemplates");

test("resolveCertificateRole preserves valid position names", () => {
  assert.equal(resolveCertificateRole("Frontend Developer", "Riset"), "Frontend Developer");
  assert.equal(resolveCertificateRole("Machine Learning Engineer", "Magang"), "Machine Learning Engineer");
  assert.equal(resolveCertificateRole("UI/UX Designer", "Riset"), "UI/UX Designer");
  assert.equal(resolveCertificateRole("Embedded System Engineer", "Magang"), "Embedded System Engineer");
  assert.equal(resolveCertificateRole("Anggota", "Riset"), "Anggota");
});

test("resolveCertificateRole replaces 'Alumni' with appropriate position based on activity type", () => {
  assert.equal(resolveCertificateRole("Alumni", "Riset"), "Anggota Riset");
  assert.equal(resolveCertificateRole("alumni", "Riset"), "Anggota Riset");
  assert.equal(resolveCertificateRole("ALUMNI", "Riset"), "Anggota Riset");
  assert.equal(resolveCertificateRole("  Alumni  ", "Riset"), "Anggota Riset");

  assert.equal(resolveCertificateRole("Alumni", "Magang"), "Peserta Magang");
  assert.equal(resolveCertificateRole("alumni", "Magang"), "Peserta Magang");
  assert.equal(resolveCertificateRole("ALUMNI", "Magang"), "Peserta Magang");
});

test("resolveCertificateRole handles null or empty role gracefully", () => {
  assert.equal(resolveCertificateRole(null, "Riset"), "Anggota Riset");
  assert.equal(resolveCertificateRole("", "Riset"), "Anggota Riset");
  assert.equal(resolveCertificateRole(undefined, "Magang"), "Peserta Magang");
  assert.equal(resolveCertificateRole("   ", "Magang"), "Peserta Magang");
});

test("buildCertificateData produces correct projectRole from snapshot", () => {
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

  const projectRowWithAlumniRole = {
    project_snapshot: {
      title: "Smart Monitoring IoT",
      role: "Alumni"
    },
    display_order: 0
  };

  const result2 = buildCertificateData(caseRow, projectRowWithAlumniRole);
  assert.equal(result2.studentName, "Budi Santoso");
  assert.equal(result2.projectTitle, "Smart Monitoring IoT");
  assert.equal(result2.projectRole, "Anggota Riset");
  assert.notEqual(result2.projectRole, "Alumni");
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

