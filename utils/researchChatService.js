const crypto = require("crypto");
const EventEmitter = require("events");
const { pool, query } = require("../db/pool");
const { createNotification } = require("./notificationService");

const mqttBrokerEvents = new EventEmitter();
mqttBrokerEvents.setMaxListeners(500);

let ensureResearchChatTablesPromise = null;

function runQuery(executor, text, params) {
  if (typeof executor === "function") return executor(text, params);
  return (executor || pool).query(text, params);
}

function getProjectMqttTopic(projectId) {
  return `stasrg/research/${String(projectId || "").trim()}/chat`;
}

async function ensureResearchChatTables(clientOrPool = pool) {
  if (!ensureResearchChatTablesPromise) {
    ensureResearchChatTablesPromise = (async () => {
      await runQuery(
        clientOrPool,
        `
        CREATE TABLE IF NOT EXISTS research_chat_messages (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
          topic TEXT NOT NULL,
          sender_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          sender_name TEXT NOT NULL,
          sender_role TEXT NOT NULL,
          sender_peran TEXT,
          message TEXT NOT NULL,
          mqtt_qos INTEGER NOT NULL DEFAULT 1,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        `
      );

      await runQuery(
        clientOrPool,
        `
        CREATE INDEX IF NOT EXISTS idx_research_chat_project_created
        ON research_chat_messages (project_id, created_at DESC)
        `
      );
    })().catch((err) => {
      ensureResearchChatTablesPromise = null;
      throw err;
    });
  }

  return ensureResearchChatTablesPromise;
}

async function verifyResearchChatAccess({ userId, role, projectId }) {
  const normalizedUserId = String(userId || "").trim();
  const normalizedRole = String(role || "").trim().toLowerCase();
  const normalizedProjectId = String(projectId || "").trim();

  if (!normalizedUserId || !normalizedRole || !normalizedProjectId) {
    return { allowed: false, reason: "Identitas pengguna atau project tidak valid." };
  }

  const projectResult = await query(
    `
    SELECT rp.id, rp.title, rp.short_title, rp.status, rp.supervisor_lecturer_id
    FROM research_projects rp
    WHERE rp.id = $1
    LIMIT 1
    `,
    [normalizedProjectId]
  );

  if (projectResult.rowCount === 0) {
    return { allowed: false, notFound: true, reason: "Riset tidak ditemukan." };
  }

  const project = projectResult.rows[0];
  const userResult = await query(
    `SELECT id, name, role, photo_url FROM users WHERE id = $1 LIMIT 1`,
    [normalizedUserId]
  );
  const userRow = userResult.rows[0] || {
    id: normalizedUserId,
    name: normalizedUserId,
    role: normalizedRole,
    photo_url: null
  };

  if (normalizedRole === "operator" || normalizedRole === "admin") {
    return {
      allowed: true,
      project,
      user: userRow,
      senderName: userRow.name || "Operator STAS-RG",
      senderRole: "operator",
      senderPeran: "Operator Lab"
    };
  }

  if (normalizedRole === "dosen") {
    const accessResult = await query(
      `
      SELECT
        rm.peran AS membership_peran,
        l.id AS supervisor_id
      FROM research_projects rp
      LEFT JOIN research_memberships rm
        ON rm.project_id = rp.id
       AND rm.user_id = $1
       AND COALESCE(rm.status, 'Aktif') = 'Aktif'
       AND (rm.selesai IS NULL OR rm.selesai >= CURRENT_DATE)
      LEFT JOIN lecturers l
        ON l.id = rp.supervisor_lecturer_id
       AND l.user_id = $1
      WHERE rp.id = $2
        AND (rm.user_id IS NOT NULL OR l.user_id IS NOT NULL)
      LIMIT 1
      `,
      [normalizedUserId, normalizedProjectId]
    );

    if (accessResult.rowCount === 0) {
      return {
        allowed: false,
        reason: "Anda bukan dosen pembimbing atau anggota pada riset ini. Topik chat diisolasi per riset."
      };
    }

    const row = accessResult.rows[0];
    return {
      allowed: true,
      project,
      user: userRow,
      senderName: userRow.name || "Dosen",
      senderRole: "dosen",
      senderPeran: row.supervisor_id ? "Dosen Pembimbing" : (row.membership_peran || "Dosen Peneliti")
    };
  }

  const studentAccessResult = await query(
    `
    SELECT rm.peran, rm.status
    FROM research_memberships rm
    WHERE rm.project_id = $1
      AND rm.user_id = $2
    ORDER BY CASE WHEN COALESCE(rm.status, 'Aktif') = 'Aktif' THEN 0 ELSE 1 END
    LIMIT 1
    `,
    [normalizedProjectId, normalizedUserId]
  );

  if (studentAccessResult.rowCount === 0) {
    const boardAccessResult = await query(
      `
      SELECT 1
      FROM board_access ba
      WHERE ba.project_id = $1 AND ba.user_id = $2
      LIMIT 1
      `,
      [normalizedProjectId, normalizedUserId]
    );

    if (boardAccessResult.rowCount === 0) {
      return {
        allowed: false,
        reason: "Akses ditolak. Ruang diskusi MQTT ini hanya untuk anggota riset terkait agar topik tidak bercampur."
      };
    }
  }

  const memberRow = studentAccessResult.rows[0] || {};
  return {
    allowed: true,
    project,
    user: userRow,
    senderName: userRow.name || "Mahasiswa",
    senderRole: "mahasiswa",
    senderPeran: memberRow.peran || "Anggota Riset"
  };
}

function mapChatMessageRow(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    topic: row.topic,
    senderUserId: row.sender_user_id,
    senderName: row.sender_name,
    senderRole: row.sender_role,
    senderPeran: row.sender_peran || null,
    senderPhotoUrl: row.sender_photo_url || null,
    message: row.message,
    qos: Number(row.mqtt_qos ?? 1),
    createdAt: row.created_at
  };
}

async function listProjectChatMembers(projectId) {
  const result = await query(
    `
    SELECT DISTINCT ON (u.id)
      u.id AS user_id,
      u.name,
      u.role,
      u.photo_url,
      COALESCE(rm.peran, CASE WHEN l.id IS NOT NULL THEN 'Dosen Pembimbing' ELSE u.role END) AS peran,
      COALESCE(rm.status, 'Aktif') AS status
    FROM research_projects rp
    LEFT JOIN research_memberships rm
      ON rm.project_id = rp.id
     AND COALESCE(rm.status, 'Aktif') = 'Aktif'
    LEFT JOIN lecturers l
      ON l.id = rp.supervisor_lecturer_id
    JOIN users u
      ON u.id = rm.user_id OR u.id = l.user_id
    WHERE rp.id = $1
    ORDER BY u.id, CASE WHEN u.role = 'dosen' THEN 0 ELSE 1 END
    `,
    [projectId]
  );

  return result.rows.map((row) => ({
    userId: row.user_id,
    name: row.name,
    role: row.role,
    photoUrl: row.photo_url || null,
    peran: row.peran || row.role,
    status: row.status || "Aktif"
  }));
}

async function listResearchChatHistory({ projectId, limit = 100, after = null }) {
  await ensureResearchChatTables();
  const boundedLimit = Math.min(Math.max(Number(limit) || 100, 1), 300);
  const params = [projectId];
  let afterClause = "";

  if (after) {
    const parsedDate = new Date(String(after));
    if (!Number.isNaN(parsedDate.getTime())) {
      params.push(parsedDate.toISOString());
      afterClause = `AND m.created_at > $${params.length}`;
    }
  }

  params.push(boundedLimit);

  const result = await query(
    `
    SELECT *
    FROM (
      SELECT
        m.id,
        m.project_id,
        m.topic,
        m.sender_user_id,
        m.sender_name,
        m.sender_role,
        m.sender_peran,
        m.message,
        m.mqtt_qos,
        m.created_at,
        u.photo_url AS sender_photo_url
      FROM research_chat_messages m
      LEFT JOIN users u ON u.id = m.sender_user_id
      WHERE m.project_id = $1
      ${afterClause}
      ORDER BY m.created_at DESC
      LIMIT $${params.length}
    ) recent
    ORDER BY recent.created_at ASC
    `,
    params
  );

  const members = await listProjectChatMembers(projectId);

  return {
    topic: getProjectMqttTopic(projectId),
    messages: result.rows.map(mapChatMessageRow),
    members
  };
}

async function publishResearchChatMessage({
  projectId,
  senderUserId,
  senderRole,
  message,
  qos = 1
}) {
  await ensureResearchChatTables();

  const access = await verifyResearchChatAccess({
    userId: senderUserId,
    role: senderRole,
    projectId
  });

  if (!access.allowed) {
    const err = new Error(access.reason || "Akses ditolak.");
    err.statusCode = access.notFound ? 404 : 403;
    throw err;
  }

  const trimmedMessage = String(message || "").trim();
  if (!trimmedMessage) {
    const err = new Error("Pesan tidak boleh kosong.");
    err.statusCode = 400;
    throw err;
  }

  if (trimmedMessage.length > 2000) {
    const err = new Error("Pesan maksimal 2000 karakter.");
    err.statusCode = 400;
    throw err;
  }

  const normalizedQos = [0, 1, 2].includes(Number(qos)) ? Number(qos) : 1;
  const topic = getProjectMqttTopic(projectId);
  const messageId = `MSG-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;

  const insertResult = await query(
    `
    INSERT INTO research_chat_messages (
      id, project_id, topic, sender_user_id, sender_name, sender_role, sender_peran, message, mqtt_qos
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING *
    `,
    [
      messageId,
      projectId,
      topic,
      senderUserId,
      access.senderName,
      access.senderRole,
      access.senderPeran,
      trimmedMessage,
      normalizedQos
    ]
  );

  const savedRow = {
    ...insertResult.rows[0],
    sender_photo_url: access.user?.photo_url || null
  };
  const messageDto = mapChatMessageRow(savedRow);

  const mqttPacket = {
    packetType: "PUBLISH",
    protocol: "MQTT/3.1.1",
    topic,
    qos: normalizedQos,
    retain: false,
    packetId: crypto.randomInt(1, 65535),
    timestamp: new Date().toISOString(),
    payload: messageDto
  };

  mqttBrokerEvents.emit(`topic:${topic}`, mqttPacket);

  // Dispatch push / in-app notifications asynchronously to other active project members
  setImmediate(async () => {
    try {
      const members = await listProjectChatMembers(projectId);
      const projectLabel = access.project.short_title || access.project.title || "Riset";
      const preview = trimmedMessage.length > 110 ? `${trimmedMessage.slice(0, 107)}...` : trimmedMessage;

      for (const member of members) {
        if (!member.userId || member.userId === senderUserId) continue;
        await createNotification({
          recipientUserId: member.userId,
          senderUserId,
          type: "riset",
          title: `💬 [${projectLabel}] ${access.senderName}`,
          body: preview
        }).catch(() => {});
      }
    } catch (_err) {
      // Non-blocking notification fanout
    }
  });

  return {
    packet: mqttPacket,
    message: messageDto
  };
}

function subscribeProjectMqttTopic(projectId, listener) {
  const topic = getProjectMqttTopic(projectId);
  const eventKey = `topic:${topic}`;
  mqttBrokerEvents.on(eventKey, listener);
  return () => {
    mqttBrokerEvents.off(eventKey, listener);
  };
}

module.exports = {
  ensureResearchChatTables,
  getProjectMqttTopic,
  listProjectChatMembers,
  listResearchChatHistory,
  publishResearchChatMessage,
  subscribeProjectMqttTopic,
  verifyResearchChatAccess
};
