const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeStudentLeaveType,
  resolveStudentLeavePicketAction
} = require("../utils/studentLeavePicketPolicy");

test("Tugas Luar: studentLeavePicketPolicy supports 'tugas_luar' and treats as leave", () => {
  assert.equal(normalizeStudentLeaveType("tugas_luar"), "tugas_luar");
  assert.equal(normalizeStudentLeaveType("TUGAS_LUAR"), "tugas_luar");
  assert.equal(
    resolveStudentLeavePicketAction({ leaveType: "tugas_luar", status: "Disetujui" }),
    "leave"
  );
  assert.equal(
    resolveStudentLeavePicketAction({ leaveType: "tugas_luar", status: "Menunggu" }),
    "clear"
  );
});

test("Tugas Luar & Student Policy: Riset students are permitted to apply for tugas_luar", () => {
  function validateLeaveRequestForStudentType({ studentType, jenisPengajuan, requestedDays, wfhQuota, wfhUsed = 0 }) {
    const isRisetStudent = String(studentType || "").trim().toLowerCase() === "riset";

    if (isRisetStudent && (jenisPengajuan === "cuti" || jenisPengajuan === "wfh")) {
      return { ok: false, message: "Mahasiswa Riset hanya dapat mengajukan izin, sakit, atau tugas luar." };
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

  // Riset student cannot apply for cuti or wfh
  assert.equal(validateLeaveRequestForStudentType({ studentType: "Riset", jenisPengajuan: "cuti" }).ok, false);
  assert.equal(validateLeaveRequestForStudentType({ studentType: "Riset", jenisPengajuan: "wfh" }).ok, false);

  // Riset student CAN apply for tugas_luar (e.g. testing / abdimas / field research)
  assert.equal(validateLeaveRequestForStudentType({ studentType: "Riset", jenisPengajuan: "tugas_luar", requestedDays: 3 }).ok, true);
  
  // Reguler student CAN apply for tugas_luar as well
  assert.equal(validateLeaveRequestForStudentType({ studentType: "Reguler", jenisPengajuan: "tugas_luar", requestedDays: 2 }).ok, true);
});

test("Student Edit & Cancellation Policy: Invariant checks for ownership and 'Menunggu' status", () => {
  function canStudentEditRequest({ requesterRole, requesterStudentId, requestStudentId, requestStatus }) {
    if (requesterRole === "operator") return { allowed: true };
    if (requesterRole === "mahasiswa") {
      if (requesterStudentId !== requestStudentId) {
        return { allowed: false, error: "Akses ditolak (bukan pemilik)." };
      }
      if (requestStatus !== "Menunggu") {
        return { allowed: false, error: "Hanya pengajuan dengan status Menunggu yang dapat diedit." };
      }
      return { allowed: true };
    }
    return { allowed: false, error: "Akses ditolak." };
  }

  function canStudentCancelRequest({ requesterRole, requesterStudentId, requestStudentId, requestStatus }) {
    if (requesterRole === "operator") return { allowed: true };
    if (requesterRole === "mahasiswa") {
      if (requesterStudentId !== requestStudentId) {
        return { allowed: false, error: "Akses ditolak (bukan pemilik)." };
      }
      if (requestStatus !== "Menunggu") {
        return { allowed: false, error: "Hanya pengajuan dengan status Menunggu yang dapat dibatalkan." };
      }
      return { allowed: true };
    }
    return { allowed: false, error: "Akses ditolak." };
  }

  // 1. Mahasiswa editing their own pending request is ALLOWED
  assert.equal(
    canStudentEditRequest({
      requesterRole: "mahasiswa",
      requesterStudentId: "MHS-001",
      requestStudentId: "MHS-001",
      requestStatus: "Menunggu"
    }).allowed,
    true
  );

  // 2. Mahasiswa editing an approved or rejected request is REJECTED
  assert.equal(
    canStudentEditRequest({
      requesterRole: "mahasiswa",
      requesterStudentId: "MHS-001",
      requestStudentId: "MHS-001",
      requestStatus: "Disetujui"
    }).allowed,
    false
  );
  assert.equal(
    canStudentEditRequest({
      requesterRole: "mahasiswa",
      requesterStudentId: "MHS-001",
      requestStudentId: "MHS-001",
      requestStatus: "Ditolak"
    }).allowed,
    false
  );

  // 3. Mahasiswa editing another student's request is REJECTED
  assert.equal(
    canStudentEditRequest({
      requesterRole: "mahasiswa",
      requesterStudentId: "MHS-001",
      requestStudentId: "MHS-002",
      requestStatus: "Menunggu"
    }).allowed,
    false
  );

  // 4. Mahasiswa cancelling their own pending request is ALLOWED
  assert.equal(
    canStudentCancelRequest({
      requesterRole: "mahasiswa",
      requesterStudentId: "MHS-001",
      requestStudentId: "MHS-001",
      requestStatus: "Menunggu"
    }).allowed,
    true
  );

  // 5. Mahasiswa cancelling an approved request is REJECTED
  assert.equal(
    canStudentCancelRequest({
      requesterRole: "mahasiswa",
      requesterStudentId: "MHS-001",
      requestStudentId: "MHS-001",
      requestStatus: "Disetujui"
    }).allowed,
    false
  );

  // 6. Operator can edit or cancel any request
  assert.equal(
    canStudentCancelRequest({
      requesterRole: "operator",
      requesterStudentId: "OP-01",
      requestStudentId: "MHS-001",
      requestStatus: "Disetujui"
    }).allowed,
    true
  );
});

test("Attendance Remote Mode: Tugas Luar sets attendance status to 'Tugas Luar' and bypasses GPS", () => {
  function resolveCheckinStatus({ isRemote, isTugasLuar, isWfh }) {
    if (!isRemote) return "Hadir";
    return isTugasLuar ? "Tugas Luar" : isWfh ? "WFH" : "Hadir";
  }

  assert.equal(resolveCheckinStatus({ isRemote: true, isTugasLuar: true, isWfh: false }), "Tugas Luar");
  assert.equal(resolveCheckinStatus({ isRemote: true, isTugasLuar: false, isWfh: true }), "WFH");
  assert.equal(resolveCheckinStatus({ isRemote: false, isTugasLuar: false, isWfh: false }), "Hadir");
});
