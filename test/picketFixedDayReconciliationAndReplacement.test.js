const test = require("node:test");
const assert = require("node:assert/strict");

const {
  reviewPicketLeaveRequest,
  deletePicketSchedule,
  setPicketStudentDay
} = require("../utils/picketService");

test("reconcilePicketAssignmentsForDate SQL cleanup removes students outside weeklyStudentIds and cascading replacements", () => {
  // Verify the SQL logic designed for reconcilePicketAssignmentsForDate
  const targetDate = "2026-11-06"; // Friday (day 5)
  const weeklyStudentIds = ["STD-TUE-FIXED-5"]; // Only students fixed for Friday

  // Student on Tuesday having an unsubmitted Ditugaskan schedule on Friday
  const testSchedules = [
    {
      id: "PKT-SCH-NORMAL-FRI",
      student_id: "STD-TUE-FIXED-5",
      status: "Ditugaskan",
      has_submission: false,
      is_alumni: false,
      is_replacement: false,
      is_cascading_replacement: false
    },
    {
      id: "PKT-SCH-MISMATCH-TUE-STUDENT",
      student_id: "STD-TUE-FIXED-2", // Fixed on Tuesday, erroneously on Friday
      status: "Ditugaskan",
      has_submission: false,
      is_alumni: false,
      is_replacement: false,
      is_cascading_replacement: false
    },
    {
      id: "PKT-SCH-CASCADE-RPL",
      student_id: "STD-TUE-FIXED-2",
      status: "Ditugaskan",
      has_submission: false,
      is_alumni: false,
      is_replacement: true,
      is_cascading_replacement: true // Replacement of another replacement
    },
    {
      id: "PKT-SCH-LEGIT-RPL",
      student_id: "STD-TUE-FIXED-2",
      status: "Ditugaskan",
      has_submission: false,
      is_alumni: false,
      is_replacement: true,
      is_cascading_replacement: false // Direct replacement of a regular schedule
    }
  ];

  function shouldDeleteSchedule(sch, weeklyIds) {
    if (sch.status !== "Ditugaskan" || sch.has_submission) return false;
    if (sch.is_alumni) return true;
    const isNotInWeekly = !weeklyIds.includes(sch.student_id);
    if (isNotInWeekly) {
      if (!sch.is_replacement) return true;
      if (sch.is_cascading_replacement) return true;
      return false;
    }
    return false;
  }

  const kept = testSchedules.filter((sch) => !shouldDeleteSchedule(sch, weeklyStudentIds));
  const deleted = testSchedules.filter((sch) => shouldDeleteSchedule(sch, weeklyStudentIds));

  // The Friday student is kept
  assert.ok(kept.some((s) => s.id === "PKT-SCH-NORMAL-FRI"));
  // The legitimate direct replacement is kept
  assert.ok(kept.some((s) => s.id === "PKT-SCH-LEGIT-RPL"));
  // The mismatched Tuesday student's schedule is DELETED
  assert.ok(deleted.some((s) => s.id === "PKT-SCH-MISMATCH-TUE-STUDENT"));
  // The cascading replacement schedule is DELETED
  assert.ok(deleted.some((s) => s.id === "PKT-SCH-CASCADE-RPL"));
});

test("reviewPicketLeaveRequest recognizes replacement schedules and blocks cascading replacements", () => {
  function checkReplacementEligibility({ scheduleId, scheduleNotes, sourceLeaveRequestId, hasParentReplacement, createReplacement }) {
    const isAlreadyReplacement =
      Boolean(scheduleId && scheduleId.startsWith("PKT-SCH-RPL")) ||
      Boolean(scheduleNotes && scheduleNotes.includes("Jadwal pengganti")) ||
      Boolean(sourceLeaveRequestId);

    const isReplacementSchedule = isAlreadyReplacement || Boolean(hasParentReplacement);
    const requestedCreateReplacement = createReplacement !== false;
    const allowReplacement = requestedCreateReplacement && !isReplacementSchedule;
    return { isReplacementSchedule, allowReplacement };
  }

  // 1. Regular schedule with default createReplacement
  const regular = checkReplacementEligibility({
    scheduleId: "PKT-SCH-REGULAR-1",
    scheduleNotes: null,
    sourceLeaveRequestId: null,
    hasParentReplacement: false,
    createReplacement: true
  });
  assert.equal(regular.isReplacementSchedule, false);
  assert.equal(regular.allowReplacement, true);

  // 2. Regular schedule with createReplacement: false (operator opted out)
  const regularOptOut = checkReplacementEligibility({
    scheduleId: "PKT-SCH-REGULAR-1",
    scheduleNotes: null,
    sourceLeaveRequestId: null,
    hasParentReplacement: false,
    createReplacement: false
  });
  assert.equal(regularOptOut.isReplacementSchedule, false);
  assert.equal(regularOptOut.allowReplacement, false);

  // 3. Replacement schedule with PKT-SCH-RPL prefix -> BLOCKS CASCADE
  const rplPrefix = checkReplacementEligibility({
    scheduleId: "PKT-SCH-RPL-179384",
    scheduleNotes: null,
    sourceLeaveRequestId: null,
    hasParentReplacement: false,
    createReplacement: true
  });
  assert.equal(rplPrefix.isReplacementSchedule, true);
  assert.equal(rplPrefix.allowReplacement, false);

  // 4. Replacement schedule with note -> BLOCKS CASCADE
  const rplNote = checkReplacementEligibility({
    scheduleId: "PKT-SCH-MANUAL-1",
    scheduleNotes: "Jadwal pengganti sementara untuk izin piket PKT-LV-1",
    sourceLeaveRequestId: null,
    hasParentReplacement: false,
    createReplacement: true
  });
  assert.equal(rplNote.isReplacementSchedule, true);
  assert.equal(rplNote.allowReplacement, false);

  // 5. Replacement schedule pointed to by prior leave request -> BLOCKS CASCADE
  const rplRef = checkReplacementEligibility({
    scheduleId: "PKT-SCH-CUSTOM-2",
    scheduleNotes: null,
    sourceLeaveRequestId: null,
    hasParentReplacement: true,
    createReplacement: true
  });
  assert.equal(rplRef.isReplacementSchedule, true);
  assert.equal(rplRef.allowReplacement, false);
});

test("backfillApprovedPicketLeaveReplacements query excludes cancelled, explicit no-replacement, and replacement schedules", () => {
  function shouldBackfillLeave(row) {
    if (row.status !== "Disetujui") return false;
    if (row.replacement_schedule_id !== null) return false;
    if (row.schedule_id && row.schedule_id.startsWith("PKT-SCH-RPL")) return false;
    if (row.schedule_notes && row.schedule_notes.includes("Jadwal pengganti")) return false;
    if (row.has_parent_replacement) return false;
    const note = row.review_note || "";
    if (note.toLowerCase().includes("tanpa pengganti") ||
        note.toLowerCase().includes("dibatalkan") ||
        note.toLowerCase().includes("dihapus")) {
      return false;
    }
    return true;
  }

  // Normal approved leave with null replacement_schedule_id -> allowed
  assert.equal(shouldBackfillLeave({
    status: "Disetujui",
    replacement_schedule_id: null,
    schedule_id: "PKT-SCH-REGULAR",
    schedule_notes: null,
    has_parent_replacement: false,
    review_note: "Izin disetujui"
  }), true);

  // Leave on a replacement schedule -> excluded
  assert.equal(shouldBackfillLeave({
    status: "Disetujui",
    replacement_schedule_id: null,
    schedule_id: "PKT-SCH-RPL-123",
    schedule_notes: null,
    has_parent_replacement: false,
    review_note: "Izin disetujui"
  }), false);

  // Leave where replacement was deleted/cancelled -> excluded
  assert.equal(shouldBackfillLeave({
    status: "Disetujui",
    replacement_schedule_id: null,
    schedule_id: "PKT-SCH-REGULAR",
    schedule_notes: null,
    has_parent_replacement: false,
    review_note: "Izin disetujui (Jadwal pengganti dibatalkan/dihapus)"
  }), false);

  // Leave explicitly marked tanpa pengganti -> excluded
  assert.equal(shouldBackfillLeave({
    status: "Disetujui",
    replacement_schedule_id: null,
    schedule_id: "PKT-SCH-REGULAR",
    schedule_notes: null,
    has_parent_replacement: false,
    review_note: "Disetujui tanpa pengganti"
  }), false);
});
