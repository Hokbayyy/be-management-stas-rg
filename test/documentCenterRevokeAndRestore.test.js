const test = require("node:test");
const assert = require("node:assert/strict");
const { revokeDocument, unrevokeDocument } = require("../utils/documentCenterRevocation");
const { resetCertificateProject, resetCompletionCase } = require("../utils/documentCenterFinalActivity");

test("documentCenterRevocation exports revokeDocument and unrevokeDocument functions", () => {
  assert.equal(typeof revokeDocument, "function");
  assert.equal(typeof unrevokeDocument, "function");
});

test("documentCenterFinalActivity exports resetCertificateProject and resetCompletionCase functions", () => {
  assert.equal(typeof resetCertificateProject, "function");
  assert.equal(typeof resetCompletionCase, "function");
});

test("unrevokeDocument validates documentId parameter", async () => {
  await assert.rejects(
    async () => {
      await unrevokeDocument({ documentId: "", authUser: { id: "USR-01" }, ip: "127.0.0.1" });
    },
    (err) => err.statusCode === 400 || err.message.includes("Input tidak valid")
  );
});

test("resetCertificateProject validates id parameter", async () => {
  await assert.rejects(
    async () => {
      await resetCertificateProject({ id: "", authUser: { id: "USR-01" }, ip: "127.0.0.1" });
    },
    (err) => err.statusCode === 400 || err.message.includes("Input tidak valid")
  );
});

test("resetCompletionCase validates id parameter", async () => {
  await assert.rejects(
    async () => {
      await resetCompletionCase({ id: "", authUser: { id: "USR-01" }, ip: "127.0.0.1" });
    },
    (err) => err.statusCode === 400 || err.message.includes("Input tidak valid")
  );
});
