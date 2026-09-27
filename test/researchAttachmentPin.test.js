const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const storeFile = path.join(__dirname, "../utils/researchBoardStore.js");
const routeFile = path.join(__dirname, "../routes/api/research.js");

test("researchBoardStore.js includes schema alterations for pinned attachments and captions", () => {
  const content = fs.readFileSync(storeFile, "utf-8");

  assert.ok(
    content.includes("is_pinned BOOLEAN NOT NULL DEFAULT FALSE"),
    "Must create or alter research_board_task_attachments with is_pinned column"
  );
  assert.ok(
    content.includes("pin_caption TEXT"),
    "Must create or alter research_board_task_attachments with pin_caption column"
  );
  assert.ok(
    content.includes("pinned_by TEXT"),
    "Must create or alter research_board_task_attachments with pinned_by column"
  );
  assert.ok(
    content.includes("pinned_at TIMESTAMPTZ"),
    "Must create or alter research_board_task_attachments with pinned_at column"
  );
  assert.ok(
    content.includes("idx_research_board_attachments_pinned"),
    "Must define index for pinned attachments"
  );

  // Must map in fetchTaskDetailBatch
  assert.ok(
    content.includes("is_pinned: Boolean(row.is_pinned)"),
    "Must map is_pinned boolean in fetchTaskDetailBatch"
  );
  assert.ok(
    content.includes("pin_caption: row.pin_caption || null"),
    "Must map pin_caption in fetchTaskDetailBatch"
  );
});

test("routes/api/research.js includes pin endpoint and queries pin metadata", () => {
  const content = fs.readFileSync(routeFile, "utf-8");

  // GET board attachments query
  assert.ok(
    content.includes("is_pinned, pin_caption, pinned_by, pinned_at FROM research_board_task_attachments"),
    "GET board query must select is_pinned and pin_caption from attachments table"
  );

  // PATCH endpoint
  assert.ok(
    content.includes("/:id/board/tasks/:taskId/attachments/:attachmentId/pin"),
    "Must declare PATCH endpoint for attachment pin"
  );
  assert.ok(
    content.includes("access.isManager"),
    "Pin endpoint must restrict access using access.isManager"
  );
  assert.ok(
    content.includes("SET is_pinned = $1"),
    "Pin endpoint must update is_pinned and caption in database"
  );
});
