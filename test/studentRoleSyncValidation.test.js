const test = require("node:test");
const assert = require("node:assert/strict");
const { pool } = require("../db/pool");
const studentsRouter = require("../routes/api/students");
const researchRouter = require("../routes/api/research");
const syncStudentResearchMemberships = studentsRouter._syncStudentResearchMemberships;

test("STUDENT ROLE SYNC VALIDATION: syncStudentResearchMemberships enforces active RBAC catalog", async (t) => {
  const client = await pool.connect();
  const userId = `USR-TEST-${Date.now()}`;
  const projectId = `PRJ-QA-${Date.now()}`;

  try {
    await client.query("BEGIN");

    // Create a temporary student user
    await client.query(`
      INSERT INTO users (id, username, name, initials, email, role, is_active)
      VALUES ($1, $2, 'Test Student', 'TS', $3, 'mahasiswa', true)
    `, [userId, `user_${Date.now()}`, `test_${Date.now()}@stas.rg`]);

    // Create a temporary research project with title containing QA
    await client.query(`
      INSERT INTO research_projects (id, title, short_title, description, status)
      VALUES ($1, 'QA Automation Testing Lab', 'QA Lab', 'Testing project', 'Aktif')
    `, [projectId]);

    // Subtest 1: Allows active PROJECT-eligible role ('Contributor / Member')
    await t.test("Allows active PROJECT-eligible role", async () => {
      await syncStudentResearchMemberships({
        userId,
        studentStatus: "Aktif",
        researchMemberships: [
          { projectId, peran: "Contributor / Member", bergabung: "2026-01-01" }
        ],
        executor: client
      });

      const memRes = await client.query(
        "SELECT peran FROM research_memberships WHERE user_id = $1 AND project_id = $2",
        [userId, projectId]
      );
      assert.equal(memRes.rows.length, 1);
      assert.equal(memRes.rows[0].peran, "Contributor / Member");
    });

    // Subtest 2: Allows preserving unchanged historical role
    await t.test("Allows preserving unchanged historical role on student update", async () => {
      // Manually simulate an existing historical role directly in DB
      await client.query(
        "UPDATE research_memberships SET peran = 'Legacy Tester' WHERE user_id = $1 AND project_id = $2",
        [userId, projectId]
      );

      // Updating student without changing historical role must succeed
      await syncStudentResearchMemberships({
        userId,
        studentStatus: "Aktif",
        researchMemberships: [
          { projectId, peran: "Legacy Tester", bergabung: "2026-01-01" }
        ],
        executor: client
      });

      const memRes = await client.query(
        "SELECT peran FROM research_memberships WHERE user_id = $1 AND project_id = $2",
        [userId, projectId]
      );
      assert.equal(memRes.rows[0].peran, "Legacy Tester");
    });

    // Subtest 3: Rejects new assignment to inactive / non-catalog role
    await t.test("Rejects new assignment to inactive / non-catalog role (e.g. 'QA')", async () => {
      await assert.rejects(
        async () => {
          await syncStudentResearchMemberships({
            userId,
            studentStatus: "Aktif",
            researchMemberships: [
              { projectId, peran: "QA", bergabung: "2026-01-01" }
            ],
            executor: client
          });
        },
        (err) => {
          assert.equal(err.status || err.statusCode, 400);
          assert.match(err.message, /Peran "QA" tidak aktif atau tidak diizinkan/);
          return true;
        }
      );
    });

    // Subtest 4: Rejects assignment to Dosen-exclusive role ('Ketua Riset')
    await t.test("Rejects assignment to Dosen-exclusive role ('Ketua Riset')", async () => {
      await assert.rejects(
        async () => {
          await syncStudentResearchMemberships({
            userId,
            studentStatus: "Aktif",
            researchMemberships: [
              { projectId, peran: "Ketua Riset", bergabung: "2026-01-01" }
            ],
            executor: client
          });
        },
        (err) => {
          assert.equal(err.status || err.statusCode, 400);
          assert.match(err.message, /Peran "Ketua Riset" tidak aktif atau tidak diizinkan/);
          return true;
        }
      );
    });

    // Subtest 5: Empty role on new assignment is strictly rejected (no silent fallback)
    await t.test("Empty role on new assignment is rejected with HTTP 400", async () => {
      // First clear the membership so it's a new assignment
      await client.query("DELETE FROM research_memberships WHERE user_id = $1", [userId]);

      await assert.rejects(
        async () => {
          await syncStudentResearchMemberships({
            userId,
            studentStatus: "Aktif",
            researchMemberships: [
              { projectId, peran: "", bergabung: "2026-01-01" }
            ],
            executor: client
          });
        },
        (err) => {
          assert.equal(err.status || err.statusCode, 400);
          assert.match(err.message, /Peran riset mahasiswa wajib dipilih/);
          return true;
        }
      );
    });

    // Subtest 6: Preserves existing 'Nonaktif' status when student profile is updated
    await t.test("Preserves existing 'Nonaktif' membership status when student profile is updated", async () => {
      // Set existing membership to Nonaktif
      await client.query(
        "INSERT INTO research_memberships (project_id, user_id, member_type, peran, status, bergabung) VALUES ($1, $2, 'Mahasiswa', 'Contributor / Member', 'Nonaktif', '2026-01-01') ON CONFLICT (project_id, user_id) DO UPDATE SET status = 'Nonaktif'",
        [projectId, userId]
      );

      // Updating student profile must not silently reactivate the membership
      await syncStudentResearchMemberships({
        userId,
        studentStatus: "Aktif",
        researchMemberships: [
          { projectId, peran: "Contributor / Member", bergabung: "2026-01-01" }
        ],
        executor: client
      });

      const memRes = await client.query(
        "SELECT status FROM research_memberships WHERE user_id = $1 AND project_id = $2",
        [userId, projectId]
      );
      assert.equal(memRes.rows.length, 1);
      assert.equal(memRes.rows[0].status, "Nonaktif", "Must preserve Nonaktif status and not silently reactivate");
    });

    // Subtest 7: isKetuaPeran accurately differentiates leaders and rejects deputy/assistant
    await t.test("isKetuaPeran differentiates leaders and rejects deputy/assistant titles", () => {
      const isKetuaPeran = researchRouter._isKetuaPeran;
      assert.equal(typeof isKetuaPeran, "function");

      // Canonical and historical leaders
      assert.equal(isKetuaPeran("Ketua Riset"), true);
      assert.equal(isKetuaPeran("Ketua Peneliti"), true);
      assert.equal(isKetuaPeran("Ketua Pembimbing"), true);
      assert.equal(isKetuaPeran("Project Manager"), true);
      assert.equal(isKetuaPeran("Mahasiswa Ketua Riset"), true);
      assert.equal(isKetuaPeran("Ketua Riset Mahasiswa"), true);
      assert.equal(isKetuaPeran("Ketua Tim Riset"), true);
      assert.equal(isKetuaPeran("Ketua"), true);

      // Must NOT treat deputy or assistant as leader
      assert.equal(isKetuaPeran("Wakil Ketua"), false);
      assert.equal(isKetuaPeran("Wakil Ketua Riset"), false);
      assert.equal(isKetuaPeran("Asisten Ketua"), false);
      assert.equal(isKetuaPeran("Asisten Ketua Riset"), false);
      assert.equal(isKetuaPeran("Vice Project Manager"), false);
      assert.equal(isKetuaPeran("Assistant Project Manager"), false);
      assert.equal(isKetuaPeran("Co-Ketua"), false);

      // Non-leaders
      assert.equal(isKetuaPeran("Contributor / Member"), false);
      assert.equal(isKetuaPeran("Core Researcher"), false);
      assert.equal(isKetuaPeran("Anggota"), false);
      assert.equal(isKetuaPeran(""), false);
      assert.equal(isKetuaPeran(null), false);
    });

    // Subtest 8: validateMemberRoleAssignment validates role and preserves historical role
    await t.test("validateMemberRoleAssignment validates active catalog and preserves historical roles", async () => {
      const validateMemberRoleAssignment = researchRouter._validateMemberRoleAssignment;
      assert.equal(typeof validateMemberRoleAssignment, "function");

      // Active role passes
      const validRole = await validateMemberRoleAssignment({
        memberType: "Mahasiswa",
        peran: "Contributor / Member",
        isNew: true
      });
      assert.equal(validRole, "Contributor / Member");

      // Inactive / uncataloged role rejected
      await assert.rejects(
        async () => {
          await validateMemberRoleAssignment({
            memberType: "Mahasiswa",
            peran: "QA",
            isNew: true
          });
        },
        /Peran "QA" tidak aktif atau tidak diizinkan untuk mahasiswa/
      );

      // Dosen role rejected for Mahasiswa
      await assert.rejects(
        async () => {
          await validateMemberRoleAssignment({
            memberType: "Mahasiswa",
            peran: "Ketua Riset",
            isNew: true
          });
        },
        /Peran "Ketua Riset" tidak aktif atau tidak diizinkan untuk mahasiswa/
      );

      // Empty role on new assignment rejected
      await assert.rejects(
        async () => {
          await validateMemberRoleAssignment({
            memberType: "Mahasiswa",
            peran: "",
            isNew: true
          });
        },
        /Peran riset wajib dipilih/
      );

      // Preserving unchanged historical role on existing member succeeds
      const preserved = await validateMemberRoleAssignment({
        memberType: "Mahasiswa",
        peran: "QA",
        isNew: false,
        existingPeran: "QA"
      });
      assert.equal(preserved, "QA");
    });

  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});
