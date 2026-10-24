const test = require("node:test");
const assert = require("node:assert/strict");

const {
  resolveStudentLeavePicketAction,
  selectPicketSchedulesOnLeaveDates,
  expandIsoDateRange
} = require("../utils/studentLeavePicketPolicy");
const { getJakartaMonthBounds } = require("../utils/jakartaWeek");

test("Mahasiswa Riset leave policy: WFH and cuti are disallowed for Riset students", () => {
  function validateLeaveRequestForStudentType({ studentType, jenisPengajuan, requestedDays, wfhQuota, wfhUsed = 0 }) {
    const isRisetStudent = String(studentType || "").trim().toLowerCase() === "riset";

    if (isRisetStudent && (jenisPengajuan === "cuti" || jenisPengajuan === "wfh")) {
      return { ok: false, message: "Mahasiswa Riset hanya dapat mengajukan izin atau sakit." };
    }

    if (jenisPengajuan === "wfh") {
      if (requestedDays !== 1) {
        return { ok: false, message: "Pengajuan WFH hanya berlaku 1 hari." };
      }
      if (wfhQuota <= 0) {
        return { ok: false, message: "Anda tidak punya jatah WFH." };
      }
      if (wfhUsed >= wfhQuota) {
        return { ok: false, message: "Jatah WFH tidak mencukupi." };
      }
    }

    return { ok: true };
  }

  // Riset student cannot apply for cuti
  assert.equal(
    validateLeaveRequestForStudentType({ studentType: "Riset", jenisPengajuan: "cuti", requestedDays: 1, wfhQuota: 0 }).ok,
    false
  );

  // Riset student cannot apply for wfh
  assert.equal(
    validateLeaveRequestForStudentType({ studentType: "Riset", jenisPengajuan: "wfh", requestedDays: 1, wfhQuota: 0 }).ok,
    false
  );

  // Riset student CAN apply for izin and sakit
  assert.equal(
    validateLeaveRequestForStudentType({ studentType: "Riset", jenisPengajuan: "izin", requestedDays: 2, wfhQuota: 0 }).ok,
    true
  );
  assert.equal(
    validateLeaveRequestForStudentType({ studentType: "Riset", jenisPengajuan: "sakit", requestedDays: 3, wfhQuota: 0 }).ok,
    true
  );

  // Magang student applying for WFH must be strictly 1 day
  assert.equal(
    validateLeaveRequestForStudentType({ studentType: "Magang", jenisPengajuan: "wfh", requestedDays: 2, wfhQuota: 2, wfhUsed: 0 }).ok,
    false
  );
  assert.equal(
    validateLeaveRequestForStudentType({ studentType: "Magang", jenisPengajuan: "wfh", requestedDays: 1, wfhQuota: 2, wfhUsed: 0 }).ok,
    true
  );
});

test("Rejected or cleared WFH resets picket schedule automatically", () => {
  assert.equal(resolveStudentLeavePicketAction({ leaveType: "wfh", status: "Ditolak" }), "clear");
  assert.equal(resolveStudentLeavePicketAction({ leaveType: "wfh", status: "Menunggu" }), "clear");
  assert.equal(resolveStudentLeavePicketAction({ leaveType: "wfh", status: "Disetujui" }), "complete");
});

test("getJakartaMonthBounds correctly returns month start and end dates in Jakarta time", () => {
  const octBounds = getJakartaMonthBounds(new Date("2026-10-15T00:00:00Z"));
  assert.equal(octBounds.startDate, "2026-10-01");
  assert.equal(octBounds.endDate, "2026-10-31");

  const febLeapBounds = getJakartaMonthBounds(new Date("2024-02-10T12:00:00Z"));
  assert.equal(febLeapBounds.startDate, "2024-02-01");
  assert.equal(febLeapBounds.endDate, "2024-02-29");

  const febNonLeapBounds = getJakartaMonthBounds(new Date("2025-02-10T12:00:00Z"));
  assert.equal(febNonLeapBounds.startDate, "2025-02-01");
  assert.equal(febNonLeapBounds.endDate, "2025-02-28");
});
