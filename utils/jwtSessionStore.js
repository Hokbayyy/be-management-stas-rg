const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const env = require("../config/env");
const { query } = require("../db/pool");

const JWT_SESSION_TTL_HOURS = Number(env.jwtSessionTtlHours || 8);
const JWT_SESSION_TTL_MS = JWT_SESSION_TTL_HOURS * 60 * 60 * 1000; // default 8 jam
const JWT_SESSION_EXPIRES_IN = `${JWT_SESSION_TTL_HOURS}h`;

const PWA_PERMANENT_TTL_DAYS = 365;
const PWA_PERMANENT_TTL_MS = PWA_PERMANENT_TTL_DAYS * 24 * 60 * 60 * 1000; // 365 hari (1 tahun)
const PWA_PERMANENT_EXPIRES_IN = `${PWA_PERMANENT_TTL_DAYS}d`;

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

async function createJwtSession({ id, userId, token, expiresAt, userAgent = null, ip = null, ttlMs = JWT_SESSION_TTL_MS }) {
  if (!id || !userId || !token) {
    const error = new Error("id, userId, dan token wajib diisi.");
    error.statusCode = 400;
    throw error;
  }

  await ensureJwtSessionsTable();

  const effectiveTtlMs = Number(ttlMs) > 0 ? Number(ttlMs) : JWT_SESSION_TTL_MS;
  const effectiveTtlSeconds = Math.max(1, Math.floor(effectiveTtlMs / 1000));

  // Gunakan jam PostgreSQL NOW() + interval seconds (hindari integer overflow 32-bit pada milliseconds > 24 hari)
  await query(
    `
    INSERT INTO jwt_sessions (id, user_id, token_hash, user_agent, ip, expires_at)
    VALUES ($1, $2, $3, $4, $5, NOW() + ($6 || ' seconds')::interval)
    `,
    [id, userId, hashToken(token), userAgent, ip, effectiveTtlSeconds.toString()]
  );

  return {
    id,
    userId,
    expiresAt: expiresAt || new Date(Date.now() + effectiveTtlMs)
  };
}

async function upgradeSessionToPermanent({ id, userId, decodedUser }) {
  if (!id || !userId || !decodedUser || !env.jwtSecret) return null;

  await ensureJwtSessionsTable();

  const newToken = jwt.sign(
    {
      id: decodedUser.id,
      role: decodedUser.role,
      name: decodedUser.name,
      jti: id,
      pwa: true
    },
    env.jwtSecret,
    { expiresIn: PWA_PERMANENT_EXPIRES_IN }
  );
  const newHash = hashToken(newToken);

  const result = await query(
    `
    UPDATE jwt_sessions
    SET expires_at = NOW() + INTERVAL '365 days',
        last_seen_at = NOW(),
        prev_token_hash = CASE WHEN $3 <> token_hash THEN token_hash ELSE prev_token_hash END,
        prev_token_expires_at = NOW() + INTERVAL '365 days',
        token_hash = $3
    WHERE id = $1
      AND user_id = $2
      AND revoked_at IS NULL
    RETURNING id
    `,
    [id, userId, newHash]
  );

  if (result.rowCount > 0) {
    return newToken;
  }
  return null;
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

  const ttlSeconds = Math.max(1, Math.floor(JWT_SESSION_TTL_MS / 1000));
  const halfTtlSeconds = Math.max(1, Math.floor(ttlSeconds / 2));
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
    SET expires_at = GREATEST(expires_at, NOW() + ($4 || ' seconds')::interval),
        last_seen_at = NOW(),
        token_hash = $5,
        prev_token_hash = CASE WHEN $5 <> token_hash THEN token_hash ELSE prev_token_hash END,
        prev_token_expires_at = CASE WHEN $5 <> token_hash THEN NOW() + INTERVAL '30 days' ELSE prev_token_expires_at END
    WHERE id = $1
      AND user_id = $2
      AND (
        token_hash = $3
        OR (prev_token_hash = $3 AND prev_token_expires_at > NOW())
      )
      AND revoked_at IS NULL
      AND expires_at > NOW()
      AND expires_at < NOW() + ($6 || ' seconds')::interval
    RETURNING id
    `,
    [id, userId, currentHash, ttlSeconds.toString(), newHash, halfTtlSeconds.toString()]
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
  PWA_PERMANENT_TTL_DAYS,
  PWA_PERMANENT_TTL_MS,
  PWA_PERMANENT_EXPIRES_IN,
  createJwtSession,
  ensureJwtSessionsTable,
  extendJwtSessionIfNeeded,
  generateSessionId,
  getJwtSessionExpiresAt,
  revokeJwtSession,
  upgradeSessionToPermanent,
  verifyJwtSession
};
