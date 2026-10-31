const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const env = require("../config/env");
const { query } = require("../db/pool");

const JWT_SESSION_TTL_HOURS = Number(env.jwtSessionTtlHours || 8);
const JWT_SESSION_TTL_MS = JWT_SESSION_TTL_HOURS * 60 * 60 * 1000; // default 8 jam
const JWT_SESSION_EXPIRES_IN = `${JWT_SESSION_TTL_HOURS}h`;

let ensureJwtSessionsTablePromise = null;

function generateSessionId() {
  return `JTS-${crypto.randomUUID()}`;
}

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function getJwtSessionExpiresAt(date = new Date()) {
  return new Date(date.getTime() + JWT_SESSION_TTL_MS);
}

async function ensureJwtSessionsTable() {
  if (!ensureJwtSessionsTablePromise) {
    ensureJwtSessionsTablePromise = (async () => {
      await query(`
        CREATE TABLE IF NOT EXISTS jwt_sessions (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          token_hash TEXT NOT NULL UNIQUE,
          user_agent TEXT,
          ip TEXT,
          expires_at TIMESTAMPTZ NOT NULL,
          revoked_at TIMESTAMPTZ,
          last_seen_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);

      await query(`
        ALTER TABLE jwt_sessions
        ADD COLUMN IF NOT EXISTS prev_token_hash TEXT,
        ADD COLUMN IF NOT EXISTS prev_token_expires_at TIMESTAMPTZ
      `);

      await query(`
        CREATE INDEX IF NOT EXISTS idx_jwt_sessions_user_active
        ON jwt_sessions(user_id, expires_at DESC)
        WHERE revoked_at IS NULL
      `);

      await query(`
        CREATE INDEX IF NOT EXISTS idx_jwt_sessions_expires_at
        ON jwt_sessions(expires_at)
      `);

      await query(`
        CREATE INDEX IF NOT EXISTS idx_jwt_sessions_prev_token
        ON jwt_sessions(prev_token_hash)
        WHERE prev_token_hash IS NOT NULL
      `);
    })();
  }

  await ensureJwtSessionsTablePromise;
}

async function createJwtSession({ id, userId, token, expiresAt, userAgent = null, ip = null }) {
  if (!id || !userId || !token) {
    const error = new Error("id, userId, dan token wajib diisi.");
    error.statusCode = 400;
    throw error;
  }

  await ensureJwtSessionsTable();

  // Gunakan jam PostgreSQL NOW() + interval agar kebal terhadap clock skew antara Node.js dan DB
  await query(
    `
    INSERT INTO jwt_sessions (id, user_id, token_hash, user_agent, ip, expires_at)
    VALUES ($1, $2, $3, $4, $5, NOW() + ($6 || ' milliseconds')::interval)
    `,
    [id, userId, hashToken(token), userAgent, ip, JWT_SESSION_TTL_MS.toString()]
  );

  return {
    id,
    userId,
    expiresAt: expiresAt || getJwtSessionExpiresAt()
  };
}

async function verifyJwtSession({ id, userId, token }) {
  if (!id || !userId || !token) return false;

  await ensureJwtSessionsTable();

  const currentHash = hashToken(token);
  const result = await query(
    `
    UPDATE jwt_sessions
    SET last_seen_at = NOW()
    WHERE id = $1
      AND user_id = $2
      AND (
        token_hash = $3
        OR (prev_token_hash = $3 AND prev_token_expires_at > NOW())
      )
      AND revoked_at IS NULL
      AND expires_at > NOW()
    RETURNING id
    `,
    [id, userId, currentHash]
  );

  return result.rowCount > 0;
}

// Perpanjang expires_at session jika sudah melewati setengah TTL (sliding window)
async function extendJwtSessionIfNeeded({ id, userId, token, decodedUser = null }) {
  if (!id || !userId || !token) return { extended: false };

  await ensureJwtSessionsTable();

  const halfTtl = JWT_SESSION_TTL_MS / 2;
  const currentHash = hashToken(token);

  let newToken = null;
  let newHash = currentHash;

  if (decodedUser && env.jwtSecret) {
    newToken = jwt.sign(
      {
        id: decodedUser.id,
        role: decodedUser.role,
        name: decodedUser.name,
        jti: id
      },
      env.jwtSecret,
      { expiresIn: JWT_SESSION_EXPIRES_IN }
    );
    newHash = hashToken(newToken);
  }

  const result = await query(
    `
    UPDATE jwt_sessions
    SET expires_at = NOW() + ($4 || ' milliseconds')::interval,
        last_seen_at = NOW(),
        token_hash = $5,
        prev_token_hash = CASE WHEN $5 <> token_hash THEN token_hash ELSE prev_token_hash END,
        prev_token_expires_at = CASE WHEN $5 <> token_hash THEN NOW() + INTERVAL '5 minutes' ELSE prev_token_expires_at END
    WHERE id = $1
      AND user_id = $2
      AND (
        token_hash = $3
        OR (prev_token_hash = $3 AND prev_token_expires_at > NOW())
      )
      AND revoked_at IS NULL
      AND expires_at > NOW()
      AND expires_at < NOW() + ($6 || ' milliseconds')::interval
    RETURNING id
    `,
    [id, userId, currentHash, JWT_SESSION_TTL_MS.toString(), newHash, halfTtl.toString()]
  );

  if (result.rowCount > 0) {
    return {
      extended: true,
      token: newToken || token
    };
  }

  return { extended: false };
}

async function revokeJwtSession({ id, userId = null, token = null }) {
  if (!id && !token) return false;

  await ensureJwtSessionsTable();

  const currentHash = token ? hashToken(token) : null;
  const params = [id || null, userId || null, currentHash];
  const result = await query(
    `
    UPDATE jwt_sessions
    SET revoked_at = COALESCE(revoked_at, NOW())
    WHERE ($1::text IS NULL OR id = $1)
      AND ($2::text IS NULL OR user_id = $2)
      AND ($3::text IS NULL OR token_hash = $3 OR prev_token_hash = $3)
      AND revoked_at IS NULL
    `,
    params
  );

  return result.rowCount > 0;
}

module.exports = {
  JWT_SESSION_TTL_HOURS,
  JWT_SESSION_TTL_MS,
  JWT_SESSION_EXPIRES_IN,
  createJwtSession,
  ensureJwtSessionsTable,
  extendJwtSessionIfNeeded,
  generateSessionId,
  getJwtSessionExpiresAt,
  revokeJwtSession,
  verifyJwtSession
};
