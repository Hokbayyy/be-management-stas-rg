const { pool, query } = require("../db/pool");

const GENERIC_ROLE_VALUES = Object.freeze([
  "",
  "alumni",
  "anggota",
  "anggota riset",
  "peserta magang",
  "mahasiswa",
  "peserta",
  "contributor",
  "contributor / member",
  "member",
  "tanpa divisi",
  "belum ada divisi"
]);

const SQL_GENERIC_ROLES_LIST =
  "'', 'alumni', 'anggota', 'anggota riset', 'peserta magang', 'mahasiswa', 'peserta', 'contributor', 'contributor / member', 'member', 'tanpa divisi', 'belum ada divisi'";

function isGenericOrAlumniRole(role) {
  const normalized = typeof role === "string" ? role.trim().toLowerCase() : "";
  return GENERIC_ROLE_VALUES.includes(normalized);
}

function pickBestResolvedRole(...candidates) {
  let webDevCandidate = null;
  for (const raw of candidates) {
    const trimmed = typeof raw === "string" ? raw.trim() : "";
    if (!trimmed || isGenericOrAlumniRole(trimmed)) continue;
    if (trimmed.toLowerCase() === "web developer") {
      if (!webDevCandidate) webDevCandidate = trimmed;
      continue;
    }
    return trimmed;
  }
  return webDevCandidate || "Web Developer";
}

function inferRoleFromProjectTitle(projectTitle, divisionName) {
  const div = typeof divisionName === "string" ? divisionName.trim() : "";
  if (div && !isGenericOrAlumniRole(div)) {
    return div;
  }
  const title = typeof projectTitle === "string" ? projectTitle.trim().toLowerCase() : "";
  if (!title) return null;
  if (/creative|konten|content|desain|design|figma|canva/.test(title)) return "Creative Content";
  if (/sosial\s*media|social\s*media|medsos/.test(title)) return "Sosial Media";
  if (/data\s*science|machine\s*learning|\bml\b|artificial\s*intelligence|\bai\b|deep\s*learning|nlp|analitik|analytics/.test(title)) return "Data Science";
  if (/\biot\b|internet\s*of\s*things|hardware|sensor|robot|embedded/.test(title)) return "IoT";
  if (/\bqa\b|quality\s*assurance|tester|testing/.test(title)) return "QA";
  if (/mobile|android|flutter|ios/.test(title)) return "Mobile Developer";
  if (/web|frontend|front-end|backend|back-end|fullstack|full-stack/.test(title)) return "Web Developer";
  return null;
}

function buildResolvedProjectRoleSql({
  studentIdExpr,
  userIdExpr,
  projectIdExpr
}) {
  return `COALESCE(
    (
      SELECT COALESCE(
        CASE
          WHEN LOWER(BTRIM(COALESCE(rm_cur.peran, ''))) IN (${SQL_GENERIC_ROLES_LIST}, 'web developer') THEN NULL
          ELSE BTRIM(rm_cur.peran)
        END,
        CASE
          WHEN LOWER(BTRIM(COALESCE(rd_mem.name, ''))) IN (${SQL_GENERIC_ROLES_LIST}) THEN NULL
          ELSE BTRIM(rd_mem.name)
        END,
        CASE
          WHEN LOWER(BTRIM(COALESCE(gsp_cur.position_label, ''))) IN (${SQL_GENERIC_ROLES_LIST}, 'web developer') THEN NULL
          ELSE BTRIM(gsp_cur.position_label)
        END,
        CASE
          WHEN COALESCE(BTRIM(gsp_cur.dataset_model_url), '') <> '' THEN 'Data Science'
          WHEN COALESCE(BTRIM(gsp_cur.design_documentation_url), '') <> '' THEN 'Creative Content'
          ELSE NULL
        END,
        CASE
          WHEN LOWER(BTRIM(COALESCE(rm_pri.peran, ''))) IN (${SQL_GENERIC_ROLES_LIST}, 'web developer') THEN NULL
          ELSE BTRIM(rm_pri.peran)
        END,
        CASE
          WHEN LOWER(BTRIM(COALESCE(rd_pri.name, ''))) IN (${SQL_GENERIC_ROLES_LIST}) THEN NULL
          ELSE BTRIM(rd_pri.name)
        END,
        CASE
          WHEN LOWER(COALESCE(rp_cur.title, rp_cur.short_title, '')) LIKE '%creative%'
            OR LOWER(COALESCE(rp_cur.title, rp_cur.short_title, '')) LIKE '%konten%'
            OR LOWER(COALESCE(rp_cur.title, rp_cur.short_title, '')) LIKE '%desain%'
            THEN 'Creative Content'
          WHEN LOWER(COALESCE(rp_cur.title, rp_cur.short_title, '')) LIKE '%social media%'
            OR LOWER(COALESCE(rp_cur.title, rp_cur.short_title, '')) LIKE '%sosial media%'
            THEN 'Sosial Media'
          WHEN LOWER(COALESCE(rp_cur.title, rp_cur.short_title, '')) LIKE '%data%'
            OR LOWER(COALESCE(rp_cur.title, rp_cur.short_title, '')) LIKE '%machine learning%'
            OR LOWER(COALESCE(rp_cur.title, rp_cur.short_title, '')) LIKE '%analitik%'
            THEN 'Data Science'
          WHEN LOWER(COALESCE(rp_cur.title, rp_cur.short_title, '')) LIKE '%iot%'
            OR LOWER(COALESCE(rp_cur.title, rp_cur.short_title, '')) LIKE '%sensor%'
            OR LOWER(COALESCE(rp_cur.title, rp_cur.short_title, '')) LIKE '%hardware%'
            THEN 'IoT'
          WHEN LOWER(COALESCE(rp_cur.title, rp_cur.short_title, '')) LIKE '%qa%'
            OR LOWER(COALESCE(rp_cur.title, rp_cur.short_title, '')) LIKE '%testing%'
            OR LOWER(COALESCE(rp_cur.title, rp_cur.short_title, '')) LIKE '%quality%'
            THEN 'QA'
          WHEN LOWER(COALESCE(rp_cur.title, rp_cur.short_title, '')) LIKE '%mobile%'
            OR LOWER(COALESCE(rp_cur.title, rp_cur.short_title, '')) LIKE '%android%'
            OR LOWER(COALESCE(rp_cur.title, rp_cur.short_title, '')) LIKE '%flutter%'
            THEN 'Mobile Developer'
          ELSE NULL
        END,
        CASE
          WHEN LOWER(BTRIM(COALESCE(rm_cur.peran, ''))) IN (${SQL_GENERIC_ROLES_LIST}) THEN NULL
          ELSE BTRIM(rm_cur.peran)
        END,
        CASE
          WHEN LOWER(BTRIM(COALESCE(gsp_cur.position_label, ''))) IN (${SQL_GENERIC_ROLES_LIST}) THEN NULL
          ELSE BTRIM(gsp_cur.position_label)
        END,
        CASE
          WHEN LOWER(BTRIM(COALESCE(rm_pri.peran, ''))) IN (${SQL_GENERIC_ROLES_LIST}) THEN NULL
          ELSE BTRIM(rm_pri.peran)
        END,
        'Web Developer'
      )
      FROM (SELECT 1) AS _seed
      LEFT JOIN research_projects rp_cur
        ON rp_cur.id = ${projectIdExpr}
      LEFT JOIN research_memberships rm_cur
        ON rm_cur.user_id = ${userIdExpr}
       AND rm_cur.project_id = ${projectIdExpr}
       AND rm_cur.member_type = 'Mahasiswa'
      LEFT JOIN research_divisions rd_mem
        ON rd_mem.id = rm_cur.division_id
      LEFT JOIN graduation_submission_projects gsp_cur
        ON gsp_cur.student_id = ${studentIdExpr}
       AND gsp_cur.project_id = ${projectIdExpr}
      LEFT JOIN LATERAL (
        SELECT rm_f.peran, rm_f.division_id
        FROM research_memberships rm_f
        WHERE rm_f.user_id = ${userIdExpr}
          AND rm_f.member_type = 'Mahasiswa'
        ORDER BY
          CASE
            WHEN LOWER(BTRIM(COALESCE(rm_f.peran, ''))) NOT IN (${SQL_GENERIC_ROLES_LIST}, 'web developer') THEN 0
            WHEN rm_f.division_id IS NOT NULL THEN 1
            WHEN LOWER(BTRIM(COALESCE(rm_f.peran, ''))) NOT IN (${SQL_GENERIC_ROLES_LIST}) THEN 2
            ELSE 3
          END ASC,
          rm_f.id ASC
        LIMIT 1
      ) rm_pri ON TRUE
      LEFT JOIN research_divisions rd_pri
        ON rd_pri.id = rm_pri.division_id
      LIMIT 1
    ),
    'Web Developer'
  )`;
}

let ensureSpecificRolesPromise = null;
let backgroundHealTimer = null;

async function executeRoleRecoveryQueries() {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS research_divisions (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          sort_order INTEGER NOT NULL DEFAULT 0,
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          coordinator_id TEXT REFERENCES users(id) ON DELETE SET NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        ALTER TABLE research_memberships
          ADD COLUMN IF NOT EXISTS selesai DATE,
          ADD COLUMN IF NOT EXISTS division_id TEXT;
      `).catch(() => {});

      // 1. Recover from research_divisions via rm.division_id or coordinator_id
      await pool.query(`
        UPDATE research_memberships rm
        SET peran = BTRIM(rd.name)
        FROM research_divisions rd
        WHERE rm.member_type = 'Mahasiswa'
          AND (rm.division_id = rd.id OR (rd.project_id = rm.project_id AND rd.coordinator_id = rm.user_id))
          AND LOWER(BTRIM(COALESCE(rd.name, ''))) NOT IN (${SQL_GENERIC_ROLES_LIST})
          AND LOWER(BTRIM(COALESCE(rm.peran, ''))) IN (${SQL_GENERIC_ROLES_LIST}, 'web developer')
      `).catch(() => {});

      // 2. Recover from rbac_legacy_reconciliations
      await pool.query(`
        UPDATE research_memberships rm
        SET peran = BTRIM(lr.legacy_peran)
        FROM students s
        JOIN rbac_legacy_reconciliations lr
          ON lr.student_id = s.id
        WHERE s.user_id = rm.user_id
          AND lr.project_id = rm.project_id
          AND rm.member_type = 'Mahasiswa'
          AND LOWER(BTRIM(COALESCE(lr.legacy_peran, ''))) NOT IN (${SQL_GENERIC_ROLES_LIST}, 'web developer')
          AND LOWER(BTRIM(COALESCE(rm.peran, ''))) IN (${SQL_GENERIC_ROLES_LIST}, 'web developer')
      `).catch(() => {});

      // 3. Recover from student_role_assignments (DIVISION scope -> division name, PROJECT/LAB scope -> role name)
      await pool.query(`
        UPDATE research_memberships rm
        SET peran = resolved.role_label
        FROM (
          SELECT DISTINCT ON (s.user_id, rm_inner.project_id)
            s.user_id,
            rm_inner.project_id,
            COALESCE(
              CASE
                WHEN sra.scope_type = 'DIVISION'
                 AND LOWER(BTRIM(COALESCE(rd.name, ''))) NOT IN (${SQL_GENERIC_ROLES_LIST})
                THEN BTRIM(rd.name)
                ELSE NULL
              END,
              CASE
                WHEN r.code <> 'CONTRIBUTOR'
                 AND LOWER(BTRIM(COALESCE(r.name, ''))) NOT IN (${SQL_GENERIC_ROLES_LIST})
                THEN BTRIM(r.name)
                ELSE NULL
              END
            ) AS role_label
          FROM students s
          JOIN research_memberships rm_inner
            ON rm_inner.user_id = s.user_id
           AND rm_inner.member_type = 'Mahasiswa'
          JOIN student_role_assignments sra
            ON sra.student_id = s.id
           AND sra.is_active = TRUE
           AND sra.revoked_at IS NULL
          JOIN rbac_roles r
            ON r.id = sra.role_id
           AND r.is_active = TRUE
          LEFT JOIN research_divisions rd
            ON rd.id = sra.scope_id
           AND sra.scope_type = 'DIVISION'
          WHERE (
            (sra.scope_type = 'DIVISION' AND rd.project_id = rm_inner.project_id)
            OR (sra.scope_type = 'PROJECT' AND sra.scope_id = rm_inner.project_id)
            OR sra.scope_type = 'LAB'
          )
          ORDER BY s.user_id, rm_inner.project_id,
            CASE sra.scope_type WHEN 'DIVISION' THEN 0 WHEN 'PROJECT' THEN 1 ELSE 2 END ASC,
            sra.created_at DESC
        ) resolved
        WHERE rm.user_id = resolved.user_id
          AND rm.project_id = resolved.project_id
          AND rm.member_type = 'Mahasiswa'
          AND resolved.role_label IS NOT NULL
          AND LOWER(BTRIM(COALESCE(rm.peran, ''))) IN (${SQL_GENERIC_ROLES_LIST}, 'web developer')
      `).catch(() => {});

      // 4. Recover from Scrum Board tasks assigned to the student with a division
      await pool.query(`
        UPDATE research_memberships rm
        SET peran = task_div.division_name,
            division_id = COALESCE(rm.division_id, task_div.division_id)
        FROM (
          SELECT DISTINCT ON (ta.user_id, t.project_id)
            ta.user_id,
            t.project_id,
            rd.id AS division_id,
            BTRIM(rd.name) AS division_name
          FROM research_board_task_assignees ta
          JOIN research_board_tasks t ON t.id = ta.task_id
          JOIN research_divisions rd ON rd.id = t.division_id
          WHERE LOWER(BTRIM(COALESCE(rd.name, ''))) NOT IN (${SQL_GENERIC_ROLES_LIST})
          ORDER BY ta.user_id, t.project_id, t.updated_at DESC NULLS LAST
        ) task_div
        WHERE rm.user_id = task_div.user_id
          AND rm.project_id = task_div.project_id
          AND rm.member_type = 'Mahasiswa'
          AND LOWER(BTRIM(COALESCE(rm.peran, ''))) IN (${SQL_GENERIC_ROLES_LIST}, 'web developer')
      `).catch(() => {});

      // 5. Recover from evaluation_assignments and presentation_slots division_name
      await pool.query(`
        UPDATE research_memberships rm
        SET peran = eval_div.division_name
        FROM (
          SELECT DISTINCT ON (s.user_id, COALESCE(ea.project_id, ''))
            s.user_id,
            ea.project_id,
            BTRIM(ea.division_name) AS division_name
          FROM evaluation_assignments ea
          JOIN students s ON s.id = ea.student_id
          WHERE LOWER(BTRIM(COALESCE(ea.division_name, ''))) NOT IN (${SQL_GENERIC_ROLES_LIST}, 'software')
          ORDER BY s.user_id, COALESCE(ea.project_id, ''), ea.updated_at DESC NULLS LAST
        ) eval_div
        WHERE rm.user_id = eval_div.user_id
          AND (eval_div.project_id IS NULL OR eval_div.project_id = rm.project_id)
          AND rm.member_type = 'Mahasiswa'
          AND LOWER(BTRIM(COALESCE(rm.peran, ''))) IN (${SQL_GENERIC_ROLES_LIST}, 'web developer')
      `).catch(() => {});

      await pool.query(`
        UPDATE research_memberships rm
        SET peran = slot_div.division_name
        FROM (
          SELECT DISTINCT ON (s.user_id, COALESCE(ps.project_id, ''))
            s.user_id,
            ps.project_id,
            BTRIM(ps.division_name) AS division_name
          FROM presentation_slots ps
          JOIN students s ON s.id = ps.student_id
          WHERE LOWER(BTRIM(COALESCE(ps.division_name, ''))) NOT IN (${SQL_GENERIC_ROLES_LIST}, 'software')
          ORDER BY s.user_id, COALESCE(ps.project_id, ''), ps.updated_at DESC NULLS LAST
        ) slot_div
        WHERE rm.user_id = slot_div.user_id
          AND (slot_div.project_id IS NULL OR slot_div.project_id = rm.project_id)
          AND rm.member_type = 'Mahasiswa'
          AND LOWER(BTRIM(COALESCE(rm.peran, ''))) IN (${SQL_GENERIC_ROLES_LIST}, 'web developer')
      `).catch(() => {});

      // 6. Recover from graduation_submission_projects (specific position_label or special URL columns)
      await pool.query(`
        UPDATE research_memberships rm
        SET peran = COALESCE(
          CASE
            WHEN LOWER(BTRIM(COALESCE(gsp.position_label, ''))) NOT IN (${SQL_GENERIC_ROLES_LIST}, 'web developer')
            THEN BTRIM(gsp.position_label)
            ELSE NULL
          END,
          CASE
            WHEN COALESCE(BTRIM(gsp.dataset_model_url), '') <> '' THEN 'Data Science'
            WHEN COALESCE(BTRIM(gsp.design_documentation_url), '') <> '' THEN 'Creative Content'
            ELSE NULL
          END,
          CASE
            WHEN LOWER(BTRIM(COALESCE(rm.peran, ''))) IN (${SQL_GENERIC_ROLES_LIST})
             AND LOWER(BTRIM(COALESCE(gsp.position_label, ''))) NOT IN (${SQL_GENERIC_ROLES_LIST})
            THEN BTRIM(gsp.position_label)
            ELSE NULL
          END
        )
        FROM students s
        JOIN graduation_submission_projects gsp
          ON gsp.student_id = s.id
        WHERE s.user_id = rm.user_id
          AND gsp.project_id = rm.project_id
          AND rm.member_type = 'Mahasiswa'
          AND LOWER(BTRIM(COALESCE(rm.peran, ''))) IN (${SQL_GENERIC_ROLES_LIST}, 'web developer')
          AND COALESCE(
            CASE
              WHEN LOWER(BTRIM(COALESCE(gsp.position_label, ''))) NOT IN (${SQL_GENERIC_ROLES_LIST}, 'web developer')
              THEN BTRIM(gsp.position_label)
              ELSE NULL
            END,
            CASE
              WHEN COALESCE(BTRIM(gsp.dataset_model_url), '') <> '' THEN 'Data Science'
              WHEN COALESCE(BTRIM(gsp.design_documentation_url), '') <> '' THEN 'Creative Content'
              ELSE NULL
            END,
            CASE
              WHEN LOWER(BTRIM(COALESCE(rm.peran, ''))) IN (${SQL_GENERIC_ROLES_LIST})
               AND LOWER(BTRIM(COALESCE(gsp.position_label, ''))) NOT IN (${SQL_GENERIC_ROLES_LIST})
              THEN BTRIM(gsp.position_label)
              ELSE NULL
            END
          ) IS NOT NULL
      `).catch(() => {});

      // 7. Propagate a student's specific non-Web-Developer role from their primary/other project membership if another membership was left generic or Web Developer
      await pool.query(`
        UPDATE research_memberships rm
        SET peran = other_rm.peran
        FROM (
          SELECT DISTINCT ON (rm_o.user_id)
            rm_o.user_id,
            BTRIM(rm_o.peran) AS peran
          FROM research_memberships rm_o
          WHERE rm_o.member_type = 'Mahasiswa'
            AND LOWER(BTRIM(COALESCE(rm_o.peran, ''))) NOT IN (${SQL_GENERIC_ROLES_LIST}, 'web developer')
          ORDER BY rm_o.user_id, rm_o.id ASC
        ) other_rm
        WHERE rm.user_id = other_rm.user_id
          AND rm.member_type = 'Mahasiswa'
          AND LOWER(BTRIM(COALESCE(rm.peran, ''))) IN (${SQL_GENERIC_ROLES_LIST}, 'web developer')
      `).catch(() => {});

      // 8. Sync graduation_submission_projects.position_label from research_memberships.peran
      await pool.query(`
        UPDATE graduation_submission_projects gsp
        SET position_label = BTRIM(rm.peran),
            updated_at = NOW()
        FROM students s
        JOIN research_memberships rm
          ON rm.user_id = s.user_id
         AND rm.member_type = 'Mahasiswa'
        WHERE s.id = gsp.student_id
          AND rm.project_id = gsp.project_id
          AND LOWER(BTRIM(COALESCE(rm.peran, ''))) NOT IN (${SQL_GENERIC_ROLES_LIST})
          AND (
            LOWER(BTRIM(COALESCE(gsp.position_label, ''))) IN (${SQL_GENERIC_ROLES_LIST})
            OR (
              LOWER(BTRIM(COALESCE(gsp.position_label, ''))) = 'web developer'
              AND LOWER(BTRIM(COALESCE(rm.peran, ''))) <> 'web developer'
            )
          )
      `).catch(() => {});

      // 9. Recover specific roles for projects based on project title (e.g. Creative and Social Media -> Creative Content / Sosial Media)
      await pool.query(`
        UPDATE research_memberships rm
        SET peran = CASE
              WHEN LOWER(COALESCE(rp.title, rp.short_title, '')) LIKE '%creative%'
                OR LOWER(COALESCE(rp.title, rp.short_title, '')) LIKE '%konten%'
                OR LOWER(COALESCE(rp.title, rp.short_title, '')) LIKE '%desain%'
                THEN 'Creative Content'
              WHEN LOWER(COALESCE(rp.title, rp.short_title, '')) LIKE '%social media%'
                OR LOWER(COALESCE(rp.title, rp.short_title, '')) LIKE '%sosial media%'
                THEN 'Sosial Media'
              WHEN LOWER(COALESCE(rp.title, rp.short_title, '')) LIKE '%data%'
                OR LOWER(COALESCE(rp.title, rp.short_title, '')) LIKE '%machine learning%'
                OR LOWER(COALESCE(rp.title, rp.short_title, '')) LIKE '%analitik%'
                THEN 'Data Science'
              WHEN LOWER(COALESCE(rp.title, rp.short_title, '')) LIKE '%iot%'
                OR LOWER(COALESCE(rp.title, rp.short_title, '')) LIKE '%sensor%'
                OR LOWER(COALESCE(rp.title, rp.short_title, '')) LIKE '%hardware%'
                THEN 'IoT'
              WHEN LOWER(COALESCE(rp.title, rp.short_title, '')) LIKE '%qa%'
                OR LOWER(COALESCE(rp.title, rp.short_title, '')) LIKE '%testing%'
                OR LOWER(COALESCE(rp.title, rp.short_title, '')) LIKE '%quality%'
                THEN 'QA'
              WHEN LOWER(COALESCE(rp.title, rp.short_title, '')) LIKE '%mobile%'
                OR LOWER(COALESCE(rp.title, rp.short_title, '')) LIKE '%android%'
                OR LOWER(COALESCE(rp.title, rp.short_title, '')) LIKE '%flutter%'
                THEN 'Mobile Developer'
              ELSE rm.peran
            END
        FROM research_projects rp
        WHERE rp.id = rm.project_id
          AND rm.member_type = 'Mahasiswa'
          AND (
            LOWER(BTRIM(COALESCE(rm.peran, ''))) IN (${SQL_GENERIC_ROLES_LIST})
            OR (
              LOWER(BTRIM(COALESCE(rm.peran, ''))) = 'web developer'
              AND (
                LOWER(COALESCE(rp.title, rp.short_title, '')) LIKE '%creative%'
                OR LOWER(COALESCE(rp.title, rp.short_title, '')) LIKE '%social media%'
                OR LOWER(COALESCE(rp.title, rp.short_title, '')) LIKE '%sosial media%'
                OR LOWER(COALESCE(rp.title, rp.short_title, '')) LIKE '%konten%'
                OR LOWER(COALESCE(rp.title, rp.short_title, '')) LIKE '%desain%'
              )
            )
          )
      `).catch(() => {});

      // 10. Heal final activity case project snapshots that erroneously have 'Web Developer' on Creative / Social Media projects
      await pool.query(`
        UPDATE dc_final_activity_case_projects cp
        SET project_snapshot = jsonb_set(
          cp.project_snapshot,
          '{role}',
          to_jsonb(
            CASE
              WHEN LOWER(COALESCE(cp.project_snapshot->>'title', '')) LIKE '%creative%'
                OR LOWER(COALESCE(cp.project_snapshot->>'title', '')) LIKE '%konten%'
                OR LOWER(COALESCE(cp.project_snapshot->>'title', '')) LIKE '%desain%'
                THEN 'Creative Content'::text
              WHEN LOWER(COALESCE(cp.project_snapshot->>'title', '')) LIKE '%social media%'
                OR LOWER(COALESCE(cp.project_snapshot->>'title', '')) LIKE '%sosial media%'
                THEN 'Sosial Media'::text
              ELSE 'Creative Content'::text
            END
          )
        ),
        updated_at = NOW()
        WHERE (
          LOWER(COALESCE(cp.project_snapshot->>'title', '')) LIKE '%creative%'
          OR LOWER(COALESCE(cp.project_snapshot->>'title', '')) LIKE '%social media%'
          OR LOWER(COALESCE(cp.project_snapshot->>'title', '')) LIKE '%sosial media%'
        )
        AND LOWER(BTRIM(COALESCE(cp.project_snapshot->>'role', ''))) IN (${SQL_GENERIC_ROLES_LIST}, 'web developer')
      `).catch(() => {});

      // 11. Heal certificate participant role in dc_official_document_students to match snapshot role
      await pool.query(`
        UPDATE dc_official_document_students ods
        SET participant_role = cp.project_snapshot->>'role'
        FROM dc_final_activity_case_projects cp
        WHERE ods.document_id = cp.certificate_document_id
          AND cp.project_snapshot->>'role' IS NOT NULL
          AND LOWER(BTRIM(cp.project_snapshot->>'role')) NOT IN (${SQL_GENERIC_ROLES_LIST}, 'web developer')
          AND (ods.participant_role IS DISTINCT FROM (cp.project_snapshot->>'role') OR LOWER(BTRIM(COALESCE(ods.participant_role, ''))) IN (${SQL_GENERIC_ROLES_LIST}, 'web developer'))
      `).catch(() => {});

      // 12. Heal completion letter participant role in dc_official_document_students to match first project snapshot role
      await pool.query(`
        UPDATE dc_official_document_students ods
        SET participant_role = primary_p.role
        FROM dc_final_activity_cases c
        JOIN LATERAL (
          SELECT cp.project_snapshot->>'role' AS role,
                 cp.project_snapshot->>'title' AS title
          FROM dc_final_activity_case_projects cp
          WHERE cp.final_activity_case_id = c.id
          ORDER BY cp.display_order ASC
          LIMIT 1
        ) primary_p ON TRUE
        WHERE ods.document_id = c.completion_document_id
          AND primary_p.role IS NOT NULL
          AND LOWER(BTRIM(primary_p.role)) NOT IN (${SQL_GENERIC_ROLES_LIST}, 'web developer')
          AND (ods.participant_role IS DISTINCT FROM primary_p.role OR LOWER(BTRIM(COALESCE(ods.participant_role, ''))) IN (${SQL_GENERIC_ROLES_LIST}, 'web developer'))
      `).catch(() => {});
}

async function ensureSpecificStudentResearchRoles() {
  if (!ensureSpecificRolesPromise) {
    ensureSpecificRolesPromise = executeRoleRecoveryQueries().catch((err) => {
      console.warn("[studentResearchRoleResolver] Role recovery queries failed:", err?.message);
    });
  }
  await ensureSpecificRolesPromise;
}

function invalidateSpecificStudentResearchRolesCache() {
  if (backgroundHealTimer) clearTimeout(backgroundHealTimer);
  backgroundHealTimer = setTimeout(() => {
    executeRoleRecoveryQueries().catch(() => {});
  }, 1000).unref?.();
}

module.exports = {
  GENERIC_ROLE_VALUES,
  SQL_GENERIC_ROLES_LIST,
  isGenericOrAlumniRole,
  inferRoleFromProjectTitle,
  pickBestResolvedRole,
  buildResolvedProjectRoleSql,
  ensureSpecificStudentResearchRoles,
  invalidateSpecificStudentResearchRolesCache
};
