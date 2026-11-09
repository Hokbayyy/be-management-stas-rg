const bcrypt = require("bcrypt");
const { pool } = require("../db/pool");

const PREFIX = "E2E-EVAL";

const ids = {
  adminUser: `${PREFIX}-ADMIN`,
  pmUser: `${PREFIX}-PM`,
  studentUser: `${PREFIX}-MHS-USER`,
  student: `${PREFIX}-MHS-STD`,
  student2User: `${PREFIX}-MHS2-USER`,
  student2: `${PREFIX}-MHS2-STD`,
  project: `${PREFIX}-PROJECT`,
  group: `${PREFIX}-GROUP`,
  groupRoleMap: `${PREFIX}-MAP-ROLE`,
  groupEvaluator: `${PREFIX}-GRP-EVAL`,
};

const credentials = {
  admin: { identifier: "admin.e2e@example.test", password: "Password123!" },
  pm: { identifier: "pm.e2e@example.test", password: "Password123!" },
  student: { identifier: "mhs.e2e@example.test", password: "Password123!" },
};

async function cleanup(client) {
  // Clean all evaluation assignments, submissions, scores created with E2E prefix
  await client.query("DELETE FROM evaluation_score_items WHERE submission_id IN (SELECT id FROM evaluation_submissions WHERE assignment_id IN (SELECT id FROM evaluation_assignments WHERE student_id = ANY($1::text[]) OR evaluator_id = $2))", [[ids.student, ids.student2], ids.pmUser]);
  await client.query("DELETE FROM evaluation_submissions WHERE assignment_id IN (SELECT id FROM evaluation_assignments WHERE student_id = ANY($1::text[]) OR evaluator_id = $2)", [[ids.student, ids.student2], ids.pmUser]);
  await client.query("DELETE FROM evaluation_assignments WHERE student_id = ANY($1::text[]) OR evaluator_id = $2", [[ids.student, ids.student2], ids.pmUser]);
  await client.query("DELETE FROM evaluation_period_evaluators WHERE evaluator_id = $1", [ids.pmUser]);
  await client.query("DELETE FROM evaluation_periods WHERE title LIKE $1", [`%${PREFIX}%`]);
  await client.query("DELETE FROM evaluation_group_evaluators WHERE group_id = $1", [ids.group]);
  await client.query("DELETE FROM evaluation_group_role_mappings WHERE group_id = $1", [ids.group]);
  await client.query("DELETE FROM evaluation_groups WHERE id = $1", [ids.group]);
  await client.query("DELETE FROM research_memberships WHERE project_id = $1", [ids.project]);
  await client.query("DELETE FROM research_projects WHERE id = $1", [ids.project]);
  await client.query("DELETE FROM students WHERE id = ANY($1::text[])", [[ids.student, ids.student2]]);
  await client.query("DELETE FROM users WHERE id = ANY($1::text[])", [[ids.adminUser, ids.pmUser, ids.studentUser, ids.student2User]]);
}

async function createFixture(client) {
  await cleanup(client);

  const passwordHash = await bcrypt.hash("Password123!", 10);

  // 1. Users
  await client.query(
    `INSERT INTO users (id, name, initials, role, email, password_hash, is_active)
     VALUES ($1, 'Admin E2E Tester', 'AE', 'operator', $5, $8, TRUE),
            ($2, 'PM E2E Evaluator', 'PE', 'mahasiswa', $6, $8, TRUE),
            ($3, 'Mahasiswa E2E Subjek', 'ME', 'mahasiswa', $7, $8, TRUE),
            ($4, 'Mahasiswa Salah Plotting', 'MS', 'mahasiswa', 'mhs2.e2e@example.test', $8, TRUE)`,
    [
      ids.adminUser,
      ids.pmUser,
      ids.studentUser,
      ids.student2User,
      credentials.admin.identifier,
      credentials.pm.identifier,
      credentials.student.identifier,
      passwordHash
    ]
  );

  // 2. Student records
  await client.query(
    `INSERT INTO students (id, user_id, nim, status, tipe, bergabung)
     VALUES ($1, $2, '1301219999', 'Aktif', 'Riset', CURRENT_DATE),
            ($3, $4, '1301218888', 'Aktif', 'Riset', CURRENT_DATE)`,
    [ids.student, ids.studentUser, ids.student2, ids.student2User]
  );

  // 3. Research Project & Memberships
  await client.query(
    `INSERT INTO research_projects (id, title, short_title, status, description)
     VALUES ($1, 'E2E Evaluation Synthetic Research', 'E2E Res', 'Aktif', 'Used exclusively for Playwright E2E tests')`,
    [ids.project]
  );

  await client.query(
    `INSERT INTO research_memberships (project_id, user_id, member_type, peran, status)
     VALUES ($1, $2, 'Mahasiswa', 'Project Manager', 'Aktif'),
            ($1, $3, 'Mahasiswa', 'E2E-Unique-Developer', 'Aktif'),
            ($1, $4, 'Mahasiswa', 'E2E-Unique-Developer', 'Aktif')`,
    [ids.project, ids.pmUser, ids.studentUser, ids.student2User]
  );

  // 4. Evaluation Group & Mappings
  await client.query(
    `INSERT INTO evaluation_groups (id, name, description, is_active)
     VALUES ($1, 'E2E Software Group', 'Synthetic group for E2E testing', TRUE)`,
    [ids.group]
  );

  await client.query(
    `INSERT INTO evaluation_group_role_mappings (id, group_id, role_pattern, is_active)
     VALUES ($1, $2, '%E2E-Unique-Developer%', TRUE)`,
    [ids.groupRoleMap, ids.group]
  );

  await client.query(
    `INSERT INTO evaluation_group_evaluators (id, group_id, evaluator_id, is_active)
     VALUES ($1, $2, $3, TRUE)`,
    [ids.groupEvaluator, ids.group, ids.pmUser]
  );
}

async function main() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (process.argv.includes("--cleanup")) {
      await cleanup(client);
      await client.query("COMMIT");
      console.log(`[Fixture] Successfully cleaned up ${PREFIX}`);
      return;
    }
    await createFixture(client);
    await client.query("COMMIT");
    console.log(`[Fixture] Successfully created ${PREFIX} with users:`);
    console.log(`  Admin  : ${credentials.admin.identifier}`);
    console.log(`  PM     : ${credentials.pm.identifier}`);
    console.log(`  Student: ${credentials.student.identifier}`);
    console.log(`  Password: Password123!`);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error("[Fixture] Error:", err.message);
    process.exitCode = 1;
  });
}

module.exports = {
  PREFIX,
  ids,
  credentials,
  createFixture,
  cleanup
};
