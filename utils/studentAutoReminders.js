const { query } = require("../db/pool");
const { getJakartaDateIso } = require("./attendanceHistory");
const { addIsoDays } = require("./picketLeaveReplacement");
const {
  createNotification,
  hasNotificationDispatch,
  recordNotificationDispatch
} = require("./notificationService");

const lastCheckedByUserMap = new Map();
const CHECK_THROTTLE_MS = 60 * 1000;

const INDONESIAN_DAY_NAMES = [
  "Minggu",
  "Senin",
  "Selasa",
  "Rabu",
  "Kamis",
  "Jumat",
  "Sabtu"
];

function formatDateId(isoDate) {
  if (!isoDate) return "-";
  const str = String(isoDate).slice(0, 10);
  const [y, m, d] = str.split("-");
  if (!y || !m || !d) return str;
  return `${d}/${m}/${y}`;
}

function getDayOfWeekFromIso(isoDate) {
  const [y, m, d] = String(isoDate).slice(0, 10).split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCDay();
}

async function checkPicketRemindersForStudent({ userId, studentId, studentName, todayIso, tomorrowIso }) {
  const created = [];

  try {
    // 1. Check explicit picket_schedules for today and tomorrow
    const scheduleRes = await query(
      `
      SELECT
        ps.id,
        ps.schedule_date::text AS schedule_date,
        ps.status,
        pt.name AS task_name,
        sub.id AS submission_id
      FROM picket_schedules ps
      LEFT JOIN picket_tasks pt ON pt.id = ps.task_id
      LEFT JOIN picket_submissions sub ON sub.schedule_id = ps.id
      WHERE ps.student_id = $1
        AND ps.schedule_date IN ($2::date, $3::date)
      ORDER BY ps.schedule_date ASC
      `,
      [studentId, todayIso, tomorrowIso]
    );

    const scheduledDates = new Set();

    for (const row of scheduleRes.rows) {
      const dateStr = String(row.schedule_date || "").slice(0, 10);
      scheduledDates.add(dateStr);

      if (row.submission_id) continue;
      const statusNorm = String(row.status || "").toLowerCase();
      if (statusNorm.includes("izin") || statusNorm.includes("cuti") || statusNorm.includes("batal")) {
        continue;
      }

      const isToday = dateStr === todayIso;
      const slotKey = isToday ? `piket_h0_${todayIso}` : `piket_h1_${todayIso}`;
      const referenceKey = `picket:${studentId}:${dateStr}`;

      const alreadySent = await hasNotificationDispatch({
        eventId: "piket_reminder",
        recipientUserId: userId,
        referenceKey,
        scheduleSlot: slotKey
      });

      if (alreadySent) continue;

      const dayName = INDONESIAN_DAY_NAMES[getDayOfWeekFromIso(dateStr)] || "";
      const taskLabel = row.task_name ? ` (Tugas: ${row.task_name})` : "";
      const title = isToday
        ? `🧹 Jadwal Piket Lab Hari Ini (${dayName}, ${formatDateId(dateStr)})`
        : `📅 Pengingat Piket Besok (${dayName}, ${formatDateId(dateStr)})`;
      const body = isToday
        ? `Halo ${studentName}, hari ini Anda terjadwal piket lab${taskLabel}. Jangan lupa melaksanakan piket dan mengunggah foto bukti piket di menu Piket.`
        : `Halo ${studentName}, besok (${dayName}, ${formatDateId(dateStr)}) Anda memiliki jadwal piket lab${taskLabel}. Pastikan hadir tepat waktu.`;

      const notif = await createNotification({
        recipientUserId: userId,
        type: "piket",
        title,
        body
      });

      if (notif?.sent) {
        await recordNotificationDispatch({
          eventId: "piket_reminder",
          recipientUserId: userId,
          referenceKey,
          scheduleSlot: slotKey,
          notificationId: notif.id,
          payload: { scheduleDate: dateStr, isToday }
        });
        created.push(notif.id);
      }
    }

    // 2. Fallback: Check recurring picket_student_days if schedule table wasn't generated yet for today/tomorrow
    const todayDow = getDayOfWeekFromIso(todayIso);
    const tomorrowDow = getDayOfWeekFromIso(tomorrowIso);
    const dayAssignRes = await query(
      `
      SELECT psd.day_id, pd.name AS day_name
      FROM picket_student_days psd
      JOIN picket_days pd ON pd.id = psd.day_id
      WHERE psd.student_id = $1
        AND pd.active = TRUE
        AND psd.effective_from <= $2::date
      LIMIT 1
      `,
      [studentId, tomorrowIso]
    );

    if (dayAssignRes.rowCount > 0) {
      const assignedDayId = Number(dayAssignRes.rows[0].day_id);
      const candidates = [];
      if (assignedDayId === todayDow && !scheduledDates.has(todayIso)) {
        candidates.push({ dateStr: todayIso, isToday: true });
      }
      if (assignedDayId === tomorrowDow && !scheduledDates.has(tomorrowIso)) {
        candidates.push({ dateStr: tomorrowIso, isToday: false });
      }

      for (const item of candidates) {
        const slotKey = item.isToday ? `piket_h0_${todayIso}` : `piket_h1_${todayIso}`;
        const referenceKey = `picket:${studentId}:${item.dateStr}`;
        const alreadySent = await hasNotificationDispatch({
          eventId: "piket_reminder",
          recipientUserId: userId,
          referenceKey,
          scheduleSlot: slotKey
        });
        if (alreadySent) continue;

        const dayName = INDONESIAN_DAY_NAMES[getDayOfWeekFromIso(item.dateStr)] || "";
        const title = item.isToday
          ? `🧹 Jadwal Piket Lab Hari Ini (${dayName}, ${formatDateId(item.dateStr)})`
          : `📅 Pengingat Piket Besok (${dayName}, ${formatDateId(item.dateStr)})`;
        const body = item.isToday
          ? `Halo ${studentName}, hari ini adalah jadwal rutin piket lab Anda (${dayName}). Jangan lupa laksanakan piket dan unggah dokumentasinya.`
          : `Halo ${studentName}, besok (${dayName}, ${formatDateId(item.dateStr)}) adalah jadwal rutin piket lab Anda.`;

        const notif = await createNotification({
          recipientUserId: userId,
          type: "piket",
          title,
          body
        });

        if (notif?.sent) {
          await recordNotificationDispatch({
            eventId: "piket_reminder",
            recipientUserId: userId,
            referenceKey,
            scheduleSlot: slotKey,
            notificationId: notif.id,
            payload: { scheduleDate: item.dateStr, isToday: item.isToday }
          });
          created.push(notif.id);
        }
      }
    }
  } catch (_err) {
    // Non-blocking if picket tables are not yet initialized
  }

  return created;
}

async function checkTaskDeadlineRemindersForStudent({ userId, studentName, todayIso }) {
  const created = [];

  try {
    const twoDaysAheadIso = addIsoDays(todayIso, 2);
    const threeDaysAgoIso = addIsoDays(todayIso, -3);

    const tasksRes = await query(
      `
      SELECT DISTINCT
        t.id,
        t.task_key,
        t.title,
        t.status,
        t.deadline::text AS deadline_iso,
        t.priority,
        rp.id AS project_id,
        COALESCE(rp.short_title, rp.title) AS project_name
      FROM research_board_tasks t
      JOIN research_projects rp ON rp.id = t.project_id
      LEFT JOIN research_board_task_assignees ta ON ta.task_id = t.id
      LEFT JOIN research_memberships rm
        ON rm.project_id = rp.id
       AND rm.user_id = $1
       AND COALESCE(rm.status, 'Aktif') = 'Aktif'
      WHERE t.status <> 'DONE'
        AND t.cancelled_at IS NULL
        AND t.deadline IS NOT NULL
        AND t.deadline >= $2::date
        AND t.deadline <= $3::date
        AND (
          ta.user_id = $1
          OR (
            rm.user_id = $1
            AND NOT EXISTS (
              SELECT 1 FROM research_board_task_assignees ta2 WHERE ta2.task_id = t.id
            )
          )
        )
      ORDER BY t.deadline ASC
      LIMIT 15
      `,
      [userId, threeDaysAgoIso, twoDaysAheadIso]
    );

    for (const task of tasksRes.rows) {
      const deadlineStr = String(task.deadline_iso || "").slice(0, 10);
      if (!deadlineStr) continue;

      const referenceKey = `task_deadline:${task.id}:${deadlineStr}`;
      const slotKey = `remind_on_${todayIso}`;

      const alreadySent = await hasNotificationDispatch({
        eventId: "task_deadline_reminder",
        recipientUserId: userId,
        referenceKey,
        scheduleSlot: slotKey
      });

      if (alreadySent) continue;

      const isOverdue = deadlineStr < todayIso;
      const isDueToday = deadlineStr === todayIso;
      const taskCode = task.task_key ? `[${task.task_key}] ` : "";

      let title;
      let body;

      if (isOverdue) {
        title = `⚠️ Tugas Melewati Deadline: ${taskCode}${task.title}`;
        body = `Halo ${studentName}, tugas "${task.title}" pada riset "${task.project_name}" telah melewati batas waktu (${formatDateId(deadlineStr)}) dengan status saat ini ${task.status}. Segera perbarui progres Anda di Scrum Board.`;
      } else if (isDueToday) {
        title = `⏰ Deadline Tugas Hari Ini: ${taskCode}${task.title}`;
        body = `Halo ${studentName}, hari ini (${formatDateId(deadlineStr)}) adalah batas waktu pengumpulan tugas "${task.title}" pada riset "${task.project_name}" (Status: ${task.status}).`;
      } else {
        title = `📌 Pengingat Deadline Tugas (${formatDateId(deadlineStr)}): ${taskCode}${task.title}`;
        body = `Halo ${studentName}, tugas "${task.title}" pada riset "${task.project_name}" memiliki deadline pada ${formatDateId(deadlineStr)} (Status saat ini: ${task.status}).`;
      }

      const notif = await createNotification({
        recipientUserId: userId,
        type: "deadline",
        title,
        body
      });

      if (notif?.sent) {
        await recordNotificationDispatch({
          eventId: "task_deadline_reminder",
          recipientUserId: userId,
          referenceKey,
          scheduleSlot: slotKey,
          notificationId: notif.id,
          payload: {
            taskId: task.id,
            projectId: task.project_id,
            deadline: deadlineStr,
            status: task.status
          }
        });
        created.push(notif.id);
      }
    }
  } catch (_err) {
    // Non-blocking if board tables are not yet initialized
  }

  return created;
}

async function syncStudentAutoReminders({ userId, role, forceCheck = false }) {
  const normalizedUserId = String(userId || "").trim();
  const normalizedRole = String(role || "").trim().toLowerCase();

  if (!normalizedUserId || normalizedRole !== "mahasiswa") {
    return { checked: false, createdCount: 0 };
  }

  const nowMs = Date.now();
  const lastChecked = lastCheckedByUserMap.get(normalizedUserId) || 0;
  if (!forceCheck && nowMs - lastChecked < CHECK_THROTTLE_MS) {
    return { checked: false, throttled: true, createdCount: 0 };
  }
  lastCheckedByUserMap.set(normalizedUserId, nowMs);

  try {
    const studentRes = await query(
      `
      SELECT s.id AS student_id, COALESCE(u.name, s.name, 'Mahasiswa') AS student_name, s.status
      FROM students s
      LEFT JOIN users u ON u.id = s.user_id
      WHERE s.user_id = $1
      LIMIT 1
      `,
      [normalizedUserId]
    );

    if (studentRes.rowCount === 0) {
      return { checked: true, createdCount: 0 };
    }

    const student = studentRes.rows[0];
    const studentStatus = String(student.status || "Aktif").toLowerCase();
    if (studentStatus === "lulus" || studentStatus === "nonaktif" || studentStatus === "alumni") {
      return { checked: true, createdCount: 0 };
    }

    const todayIso = getJakartaDateIso();
    const tomorrowIso = addIsoDays(todayIso, 1);

    const picketCreated = await checkPicketRemindersForStudent({
      userId: normalizedUserId,
      studentId: student.student_id,
      studentName: student.student_name,
      todayIso,
      tomorrowIso
    });

    const deadlineCreated = await checkTaskDeadlineRemindersForStudent({
      userId: normalizedUserId,
      studentName: student.student_name,
      todayIso
    });

    return {
      checked: true,
      createdCount: picketCreated.length + deadlineCreated.length,
      picketCreated,
      deadlineCreated
    };
  } catch (_err) {
    return { checked: false, createdCount: 0 };
  }
}

module.exports = {
  syncStudentAutoReminders
};
