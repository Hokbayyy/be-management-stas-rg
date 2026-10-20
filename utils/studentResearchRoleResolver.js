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

async function ensureSpecificStudentResearchRoles() {
  if (!ensureSpecificRolesPromise) {
    ensureSpecificRolesPromise = (async () => {
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
    })().finally(() => {
      // Allow re-evaluation after 5 seconds if roles/divisions were modified externally
      setTimeout(() => {
        ensureSpecificRolesPromise = null;
      }, 5000).unref?.();
    });
  }
  await ensureSpecificRolesPromise;
}

function invalidateSpecificStudentResearchRolesCache() {
  ensureSpecificRolesPromise = null;
}

module.exports = {
  GENERIC_ROLE_VALUES,
  SQL_GENERIC_ROLES_LIST,
  isGenericOrAlumniRole,
  pickBestResolvedRole,
  buildResolvedProjectRoleSql,
  ensureSpecificStudentResearchRoles,
  invalidateSpecificStudentResearchRolesCache
};
