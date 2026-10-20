const { query } = require("../db/pool");

function normalizeStudentLookupInput(value) {
  return String(value || "").trim();
}

async function resolveStudentRecord(studentIdOrUserId, executor = query) {
  const lookupValue = normalizeStudentLookupInput(studentIdOrUserId);
  if (!lookupValue) return null;

  const run = typeof executor === "function" ? executor : (executor && typeof executor.query === "function" ? (sql, params) => executor.query(sql, params) : query);

  const result = await run(
    `
    SELECT s.id, s.user_id, s.nim, s.status, u.name
    FROM students s
    JOIN users u ON u.id = s.user_id
    WHERE s.id = $1 OR s.user_id = $1
    LIMIT 1
    `,
    [lookupValue]
  );

  if (result.rowCount === 0) return null;
  return result.rows[0];
}

async function resolveStudentId(studentIdOrUserId, executor = query) {
  const student = await resolveStudentRecord(studentIdOrUserId, executor);
  return student?.id || null;
}

module.exports = {
  resolveStudentId,
  resolveStudentRecord
};
