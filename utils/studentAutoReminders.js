const { query } = require("../db/pool");
const { getSettingsAsync } = require("../config/systemSettingsStore");
const { getJakartaDateIso } = require("./attendanceHistory");
const { findNonWorkingDayForDate } = require("./holidays");
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

function formatJakartaTimeHm(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    hourCycle: "h23"
  });
  const parts = formatter.formatToParts(date).reduce((acc, item) => {
    acc[item.type] = item.value;
    return acc;
  }, {});
  const hour = parts.hour === "24" ? "00" : parts.hour;
  return `${hour}:${parts.minute}`;
}

function parseHmToMinutes(hmString) {
  const [h, m] = String(hmString || "").trim().split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

function formatHoursClean(hoursValue) {
  const num = Number(hoursValue || 0);
  const fixed = num.toFixed(1);
  return fixed.endsWith(".0") ? fixed.slice(0, -2) : fixed;
}

async function checkCheckoutRemindersForActiveStudents({ userId = null } = {}) {
  const created = [];

  try {
    const settings = await getSettingsAsync();
    const attendanceRules = settings?.attendanceRules || {};
    const magangMinCheckoutHours =
      Number(attendanceRules.magangMinCheckoutHours || 8) > 0
        ? Number(attendanceRules.magangMinCheckoutHours || 8)
        : 8;
    const risetTargetWeeklyHours =
      Number(attendanceRules.risetTargetWeeklyHours || 6) > 0
        ? Number(attendanceRules.risetTargetWeeklyHours || 6)
        : 6;
    const autoCheckoutTime = /^\d{2}:\d{2}$/.test(String(attendanceRules.autoCheckoutTime || "").trim())
      ? String(attendanceRules.autoCheckoutTime).trim()
      : "22:00";

    const params = [];
    let userFilterSql = "";
    if (userId) {
      params.push(String(userId).trim());
      userFilterSql = `AND s.user_id = $1`;
    }

    const activeRowsRes = await query(
      `
      SELECT
        ar.id AS attendance_id,
        ar.student_id,
        ar.check_in_at,
        EXTRACT(EPOCH FROM (NOW() - ar.check_in_at)) / 60.0 AS elapsed_minutes,
        s.user_id,
        s.tipe AS student_tipe,
        COALESCE(s.jam_minggu_target, 0)::numeric AS student_weekly_target,
        COALESCE(u.name, s.name, 'Mahasiswa') AS student_name,
        COALESCE(
          (
            SELECT SUM(
              GREATEST(
                EXTRACT(EPOCH FROM (ar_prev.check_out_at - ar_prev.check_in_at)) / 60.0,
                0
              )
            )
            FROM attendance_records ar_prev
            WHERE ar_prev.student_id = ar.student_id
              AND ar_prev.id <> ar.id
              AND ar_prev.status IN ('Hadir', 'WFH', 'Tugas Luar')
              AND ar_prev.check_in_at IS NOT NULL
              AND ar_prev.check_out_at IS NOT NULL
              AND ar_prev.attendance_date >= date_trunc('week', (NOW() AT TIME ZONE 'Asia/Jakarta')::date)::date
              AND ar_prev.attendance_date <= (NOW() AT TIME ZONE 'Asia/Jakarta')::date
          ),
          0
        )::numeric AS prior_week_minutes
      FROM attendance_records ar
      JOIN students s ON s.id = ar.student_id
      JOIN users u ON u.id = s.user_id
      WHERE ar.attendance_date = (NOW() AT TIME ZONE 'Asia/Jakarta')::date
        AND ar.status IN ('Hadir', 'WFH', 'Tugas Luar')
        AND ar.check_in_at IS NOT NULL
        AND ar.check_out_at IS NULL
        AND s.status = 'Aktif'
        AND u.is_active = TRUE
        ${userFilterSql}
      `,
      params
    );

    const nowHm = formatJakartaTimeHm(new Date());
    const nowMinutesOfDay = parseHmToMinutes(nowHm);
    const cutoffMinutesOfDay = parseHmToMinutes(autoCheckoutTime);

    for (const row of activeRowsRes.rows) {
      const elapsedMinutes = Math.max(0, Number(row.elapsed_minutes || 0));
      const studentType = String(row.student_tipe || "").trim();
      const isMagang = studentType.toLowerCase() === "magang";
      const studentName = row.student_name || "Mahasiswa";
      const checkInDate = new Date(row.check_in_at);

      let targetSessionMinutes = 0;
      let targetLabelHours = "";

      if (isMagang) {
        targetSessionMinutes = magangMinCheckoutHours * 60;
        targetLabelHours = formatHoursClean(magangMinCheckoutHours);
      } else {
        const weeklyTargetHours =
          Number(row.student_weekly_target) > 0
            ? Number(row.student_weekly_target)
            : risetTargetWeeklyHours;
        const weeklyTargetMinutes = weeklyTargetHours * 60;
        const priorWeekMinutes = Math.max(0, Number(row.prior_week_minutes || 0));

        if (priorWeekMinutes < weeklyTargetMinutes) {
          targetSessionMinutes = weeklyTargetMinutes - priorWeekMinutes;
        } else {
          targetSessionMinutes = weeklyTargetMinutes;
        }
        targetLabelHours = formatHoursClean(weeklyTargetHours);
      }

      const remainingMinutes = targetSessionMinutes - elapsedMinutes;

      // 1. Notifikasi 10 menit sebelum jam terpenuhi (untuk Mahasiswa Magang maupun Mahasiswa Riset)
      if (targetSessionMinutes > 0 && remainingMinutes <= 10) {
        const referenceKey = `checkout_10m:${row.attendance_id}`;
        const slotKey = "target_10m";

        const alreadySent = await hasNotificationDispatch({
          eventId: "checkout_reminder_10m",
          recipientUserId: row.user_id,
          referenceKey,
          scheduleSlot: slotKey
        });

        if (!alreadySent) {
          const targetTimestamp = new Date(checkInDate.getTime() + targetSessionMinutes * 60 * 1000);
          const targetTimeWib = formatJakartaTimeHm(targetTimestamp);
          const minsLeft = Math.max(1, Math.ceil(remainingMinutes));

          let title;
          let body;

          if (isMagang) {
            if (remainingMinutes > 0) {
              title = `⏰ ${minsLeft} Menit Lagi Jam Magang Terpenuhi — Jangan Lupa Check-Out!`;
              body = `Halo ${studentName}, sekitar ${minsLeft} menit lagi (pukul ${targetTimeWib} WIB) durasi absensi magang Anda mencapai ${targetLabelHours} jam. Pastikan logbook hari ini sudah diisi dan jangan lupa melakukan Check-Out!`;
            } else {
              title = `✅ Jam Magang (${targetLabelHours} Jam) Terpenuhi — Jangan Lupa Check-Out!`;
              body = `Halo ${studentName}, durasi absensi magang Anda hari ini telah memenuhi target ${targetLabelHours} jam. Pastikan logbook sudah diisi dan segera lakukan Check-Out!`;
            }
          } else {
            if (remainingMinutes > 0) {
              title = `⏰ ${minsLeft} Menit Lagi Jam Riset Terpenuhi — Jangan Lupa Check-Out!`;
              body = `Halo ${studentName}, sekitar ${minsLeft} menit lagi (pukul ${targetTimeWib} WIB) target jam kehadiran riset Anda (${targetLabelHours} jam/minggu) akan terpenuhi. Pastikan logbook hari ini sudah diisi dan jangan lupa melakukan Check-Out!`;
            } else {
              title = `✅ Target Jam Riset (${targetLabelHours} Jam) Terpenuhi — Jangan Lupa Check-Out!`;
              body = `Halo ${studentName}, target jam kehadiran riset Anda (${targetLabelHours} jam/minggu) sudah terpenuhi. Pastikan logbook hari ini sudah diisi dan segera lakukan Check-Out!`;
            }
          }

          const notif = await createNotification({
            recipientUserId: row.user_id,
            type: "absensi",
            title,
            body
          });

          if (notif?.sent) {
            await recordNotificationDispatch({
              eventId: "checkout_reminder_10m",
              recipientUserId: row.user_id,
              referenceKey,
              scheduleSlot: slotKey,
              notificationId: notif.id,
              payload: {
                attendanceId: row.attendance_id,
                studentType,
                elapsedMinutes: Math.round(elapsedMinutes),
                targetSessionMinutes: Math.round(targetSessionMinutes)
              }
            });
            created.push(notif.id);
          }
        }
      }

      // 2. Pengingat tambahan 10 menit sebelum batas auto-checkout malam (21:50 WIB) jika belum checkout
      if (
        nowMinutesOfDay != null &&
        cutoffMinutesOfDay != null &&
        cutoffMinutesOfDay - nowMinutesOfDay >= 0 &&
        cutoffMinutesOfDay - nowMinutesOfDay <= 10
      ) {
        const referenceKey = `checkout_cutoff:${row.attendance_id}`;
        const slotKey = "cutoff_10m";

        const alreadySentCutoff = await hasNotificationDispatch({
          eventId: "checkout_reminder_10m",
          recipientUserId: row.user_id,
          referenceKey,
          scheduleSlot: slotKey
        });

        if (!alreadySentCutoff) {
          const minsToCutoff = Math.max(1, cutoffMinutesOfDay - nowMinutesOfDay);
          const notif = await createNotification({
            recipientUserId: row.user_id,
            type: "absensi",
            title: `⚠️ ${minsToCutoff} Menit Sebelum Batas Akhir Check-Out (${autoCheckoutTime} WIB)!`,
            body: `Halo ${studentName}, Anda belum melakukan Check-Out hari ini. Segera isi logbook dan lakukan Check-Out sebelum absensi ditutup otomatis pada pukul ${autoCheckoutTime} WIB.`
          });

          if (notif?.sent) {
            await recordNotificationDispatch({
              eventId: "checkout_reminder_10m",
              recipientUserId: row.user_id,
              referenceKey,
              scheduleSlot: slotKey,
              notificationId: notif.id,
              payload: {
                attendanceId: row.attendance_id,
                autoCheckoutTime
              }
            });
            created.push(notif.id);
          }
        }
      }
    }
  } catch (_err) {
    // Non-blocking if attendance tables are not yet initialized
  }

  return created;
}

async function checkMagangMorningCheckinReminders({ userId = null } = {}) {
  const created = [];

  try {
    const todayIso = getJakartaDateIso();
    const nowHm = formatJakartaTimeHm(new Date());
    const nowMinutesOfDay = parseHmToMinutes(nowHm);

    // Batas check-in mahasiswa magang adalah pukul 10:00 WIB (600 menit).
    // Kirim pengingat mulai pukul 08:00 WIB (480) hingga 09:59 WIB (599).
    if (nowMinutesOfDay == null || nowMinutesOfDay < 480 || nowMinutesOfDay >= 600) {
      return created;
    }

    const settings = await getSettingsAsync();
    const nonWorkingDay = findNonWorkingDayForDate(settings, todayIso);
    if (nonWorkingDay) {
      return created;
    }

    const isUrgent10Min = nowMinutesOfDay >= 590; // 09:50 - 09:59 WIB (10 menit sebelum jam 10:00)
    const slotKey = isUrgent10Min
      ? "magang_checkin_before_10_urgent"
      : "magang_checkin_before_10_morning";

    const params = [todayIso];
    let userFilterSql = "";
    if (userId) {
      params.push(String(userId).trim());
      userFilterSql = `AND s.user_id = $2`;
    }

    const missingCheckinRes = await query(
      `
      SELECT
        s.id AS student_id,
        s.user_id,
        COALESCE(u.name, s.name, 'Mahasiswa') AS student_name
      FROM students s
      JOIN users u ON u.id = s.user_id
      WHERE s.status = 'Aktif'
        AND u.is_active = TRUE
        AND s.tipe = 'Magang'
        ${userFilterSql}
        AND NOT EXISTS (
          SELECT 1
          FROM attendance_records ar
          WHERE ar.student_id = s.id
            AND ar.attendance_date = $1::date
            AND ar.check_in_at IS NOT NULL
        )
        AND NOT EXISTS (
          SELECT 1
          FROM leave_requests lr
          WHERE lr.student_id = s.id
            AND lr.status = 'Disetujui'
            AND COALESCE(LOWER(lr.jenis_pengajuan), 'cuti') NOT IN ('wfh', 'tugas_luar')
            AND $1::date BETWEEN lr.periode_start AND lr.periode_end
        )
      `,
      params
    );

    const minsLeftToTen = Math.max(1, 600 - nowMinutesOfDay);

    for (const row of missingCheckinRes.rows) {
      const referenceKey = `magang_checkin:${row.student_id}:${todayIso}`;
      const alreadySent = await hasNotificationDispatch({
        eventId: "magang_checkin_reminder",
        recipientUserId: row.user_id,
        referenceKey,
        scheduleSlot: slotKey
      });

      if (alreadySent) continue;

      const studentName = row.student_name || "Mahasiswa";
      const title = isUrgent10Min
        ? `⚠️ ${minsLeftToTen} Menit Lagi Batas Check-In Magang (10:00 WIB)!`
        : `📍 Jangan Lupa Check-In Magang Sebelum Pukul 10:00 WIB!`;
      const body = isUrgent10Min
        ? `Halo ${studentName}, Anda belum melakukan Check-In hari ini! Wajib Check-In sebelum pukul 10:00 WIB (${minsLeftToTen} menit lagi) agar tidak tercatat Tidak Hadir dan akun tidak terkunci otomatis.`
        : `Halo ${studentName}, Anda belum melakukan Check-In absensi magang hari ini. Pastikan melakukan Check-In sebelum pukul 10:00 WIB di menu Absensi.`;

      const notif = await createNotification({
        recipientUserId: row.user_id,
        type: "absensi",
        title,
        body
      });

      if (notif?.sent) {
        await recordNotificationDispatch({
          eventId: "magang_checkin_reminder",
          recipientUserId: row.user_id,
          referenceKey,
          scheduleSlot: slotKey,
          notificationId: notif.id,
          payload: {
            studentId: row.student_id,
            date: todayIso,
            slot: slotKey
          }
        });
        created.push(notif.id);
      }
    }
  } catch (_err) {
    // Non-blocking if attendance tables are not yet initialized
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

    const checkoutCreated = await checkCheckoutRemindersForActiveStudents({
      userId: normalizedUserId
    });

    const checkinCreated = await checkMagangMorningCheckinReminders({
      userId: normalizedUserId
    });

    return {
      checked: true,
      createdCount:
        picketCreated.length +
        deadlineCreated.length +
        checkoutCreated.length +
        checkinCreated.length,
      picketCreated,
      deadlineCreated,
      checkoutCreated,
      checkinCreated
    };
  } catch (_err) {
    return { checked: false, createdCount: 0 };
  }
}

module.exports = {
  checkCheckoutRemindersForActiveStudents,
  checkMagangMorningCheckinReminders,
  syncStudentAutoReminders
};
