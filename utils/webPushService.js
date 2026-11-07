const crypto = require("crypto");
const https = require("https");
const { query } = require("../db/pool");

let pushTablesReady = false;
let cachedVapidKeys = null;

function base64UrlEncode(buffer) {
  return Buffer.from(buffer)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlDecode(str) {
  const norm = String(str || "")
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const pad = norm.length % 4 === 0 ? "" : "=".repeat(4 - (norm.length % 4));
  return Buffer.from(norm + pad, "base64");
}

async function ensurePushTables() {
  if (pushTablesReady) return;

  await query(`
    CREATE TABLE IF NOT EXISTS app_settings (
      setting_key TEXT PRIMARY KEY,
      setting_value JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS user_push_subscriptions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      endpoint TEXT NOT NULL UNIQUE,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      user_agent TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_user_push_subscriptions_user
    ON user_push_subscriptions(user_id)
  `);

  pushTablesReady = true;
}

function generateVapidKeyPair() {
  const ecdh = crypto.createECDH("prime256v1");
  ecdh.generateKeys();
  const publicKeyUncompressed = ecdh.getPublicKey(); // 65 bytes (0x04 + X + Y)
  const privateKeyRaw = ecdh.getPrivateKey(); // 32 bytes

  // Create JWK to export PKCS8 PEM for crypto.sign ES256
  const x = base64UrlEncode(publicKeyUncompressed.subarray(1, 33));
  const y = base64UrlEncode(publicKeyUncompressed.subarray(33, 65));
  const d = base64UrlEncode(privateKeyRaw);

  const privateKeyObj = crypto.createPrivateKey({
    key: { kty: "EC", crv: "P-256", x, y, d },
    format: "jwk"
  });
  const privateKeyPem = privateKeyObj.export({ type: "pkcs8", format: "pem" });

  return {
    publicKey: base64UrlEncode(publicKeyUncompressed),
    privateKeyPem,
    jwk: { kty: "EC", crv: "P-256", x, y, d }
  };
}

async function getOrCreateVapidKeys() {
  if (cachedVapidKeys) return cachedVapidKeys;

  await ensurePushTables();

  const existing = await query(
    `SELECT setting_value FROM app_settings WHERE setting_key = 'web_push_vapid_keys' LIMIT 1`
  );

  if (existing.rowCount > 0 && existing.rows[0].setting_value?.publicKey && existing.rows[0].setting_value?.privateKeyPem) {
    cachedVapidKeys = existing.rows[0].setting_value;
    return cachedVapidKeys;
  }

  const generated = generateVapidKeyPair();
  await query(
    `
    INSERT INTO app_settings (setting_key, setting_value, updated_at)
    VALUES ('web_push_vapid_keys', $1::jsonb, NOW())
    ON CONFLICT (setting_key)
    DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = NOW()
    `,
    [JSON.stringify(generated)]
  );

  cachedVapidKeys = generated;
  return cachedVapidKeys;
}

function createVapidAuthHeader(endpoint, vapidKeys, subject = "mailto:admin@stas-rg.com") {
  const parsedUrl = new URL(endpoint);
  const audience = `${parsedUrl.protocol}//${parsedUrl.host}`;
  const exp = Math.floor(Date.now() / 1000) + 12 * 3600;

  const header = base64UrlEncode(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const payload = base64UrlEncode(JSON.stringify({ aud: audience, exp, sub: subject }));
  const unsignedToken = `${header}.${payload}`;

  const signature = crypto.sign("sha256", Buffer.from(unsignedToken), {
    key: vapidKeys.privateKeyPem,
    dsaEncoding: "ieee-p1363"
  });

  const jwt = `${unsignedToken}.${base64UrlEncode(signature)}`;
  return `vapid t=${jwt}, k=${vapidKeys.publicKey}`;
}

function encryptWebPushPayloadAes128Gcm(payloadString, clientPublicKeyB64, clientAuthB64) {
  const clientPublicKey = base64UrlDecode(clientPublicKeyB64);
  const userAuth = base64UrlDecode(clientAuthB64);
  const plaintext = Buffer.from(payloadString, "utf8");

  const salt = crypto.randomBytes(16);
  const serverEcdh = crypto.createECDH("prime256v1");
  const serverPublicKey = serverEcdh.generateKeys();
  const sharedSecret = serverEcdh.computeSecret(clientPublicKey);

  // RFC 8291 key derivation
  const keyInfo = Buffer.concat([
    Buffer.from("WebPush: info\0", "ascii"),
    clientPublicKey,
    serverPublicKey
  ]);
  const ikm = Buffer.from(crypto.hkdfSync("sha256", sharedSecret, userAuth, keyInfo, 32));

  const cekInfo = Buffer.from("Content-Encoding: aes128gcm\0", "ascii");
  const contentEncryptionKey = Buffer.from(crypto.hkdfSync("sha256", ikm, salt, cekInfo, 16));

  const nonceInfo = Buffer.from("Content-Encoding: nonce\0", "ascii");
  const nonce = Buffer.from(crypto.hkdfSync("sha256", ikm, salt, nonceInfo, 12));

  // Pad record with 0x02 delimiter
  const paddedPlaintext = Buffer.concat([plaintext, Buffer.from([2])]);

  const cipher = crypto.createCipheriv("aes-128-gcm", contentEncryptionKey, nonce);
  const encrypted = Buffer.concat([cipher.update(paddedPlaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  // aes128gcm header: salt (16) + rs (4, uint32BE = 4096) + idlen (1 = 65) + keyid (65, serverPublicKey)
  const header = Buffer.alloc(16 + 4 + 1 + serverPublicKey.length);
  salt.copy(header, 0);
  header.writeUInt32BE(4096, 16);
  header.writeUInt8(serverPublicKey.length, 20);
  serverPublicKey.copy(header, 21);

  return Buffer.concat([header, encrypted, tag]);
}

function postHttpsBinary(urlStr, headers, bodyBuffer) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const req = https.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || 443,
        path: `${u.pathname}${u.search || ""}`,
        method: "POST",
        headers: {
          ...headers,
          "Content-Length": bodyBuffer ? bodyBuffer.length : 0
        },
        timeout: 8000
      },
      (res) => {
        res.resume();
        resolve({ statusCode: res.statusCode || 500 });
      }
    );

    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy(new Error("WebPush request timeout"));
    });

    if (bodyBuffer && bodyBuffer.length > 0) {
      req.write(bodyBuffer);
    }
    req.end();
  });
}

async function saveUserPushSubscription({ userId, subscription, userAgent = null }) {
  await ensurePushTables();
  const endpoint = String(subscription?.endpoint || "").trim();
  const p256dh = String(subscription?.keys?.p256dh || "").trim();
  const auth = String(subscription?.keys?.auth || "").trim();

  if (!userId || !endpoint || !p256dh || !auth) {
    const err = new Error("Data push subscription tidak lengkap.");
    err.statusCode = 400;
    throw err;
  }

  const subId = `PSUB-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  await query(
    `
    INSERT INTO user_push_subscriptions (id, user_id, endpoint, p256dh, auth, user_agent, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, NOW())
    ON CONFLICT (endpoint)
    DO UPDATE SET
      user_id = EXCLUDED.user_id,
      p256dh = EXCLUDED.p256dh,
      auth = EXCLUDED.auth,
      user_agent = EXCLUDED.user_agent,
      updated_at = NOW()
    `,
    [subId, userId, endpoint, p256dh, auth, userAgent]
  );

  return { subscribed: true };
}

async function sendWebPushToUser(recipientUserId, payloadObj) {
  if (!recipientUserId) return { sentCount: 0 };

  try {
    await ensurePushTables();
    const subsRes = await query(
      `SELECT id, endpoint, p256dh, auth FROM user_push_subscriptions WHERE user_id = $1`,
      [recipientUserId]
    );

    if (subsRes.rowCount === 0) return { sentCount: 0 };

    const unreadRes = await query(
      `SELECT COUNT(*)::int AS cnt FROM notifications WHERE recipient_user_id = $1 AND read_at IS NULL`,
      [recipientUserId]
    );
    const unreadCount = Number(unreadRes.rows[0]?.cnt || 1);

    const vapidKeys = await getOrCreateVapidKeys();
    const payloadJson = JSON.stringify({
      ...payloadObj,
      unreadCount
    });

    let sentCount = 0;

    for (const sub of subsRes.rows) {
      try {
        const encryptedBody = encryptWebPushPayloadAes128Gcm(payloadJson, sub.p256dh, sub.auth);
        const authHeader = createVapidAuthHeader(sub.endpoint, vapidKeys);

        const resp = await postHttpsBinary(
          sub.endpoint,
          {
            Authorization: authHeader,
            "Content-Encoding": "aes128gcm",
            "Content-Type": "application/octet-stream",
            TTL: "86400",
            Urgency: "high"
          },
          encryptedBody
        );

        if (resp.statusCode >= 200 && resp.statusCode < 300) {
          sentCount += 1;
        } else if (resp.statusCode === 404 || resp.statusCode === 410) {
          await query(`DELETE FROM user_push_subscriptions WHERE id = $1`, [sub.id]).catch(() => {});
        }
      } catch (_err) {
        // Ignore single subscription delivery failure
      }
    }

    return { sentCount };
  } catch (_err) {
    return { sentCount: 0 };
  }
}

module.exports = {
  ensurePushTables,
  getOrCreateVapidKeys,
  saveUserPushSubscription,
  sendWebPushToUser
};
