import crypto from "node:crypto";
import path from "node:path";
import { PassThrough } from "node:stream";
import { TRPCError } from "@trpc/server";
import {
  type Attachment,
  AttachmentError,
  ATTACHMENT_ALLOWED_MIME,
  ATTACHMENT_FILENAME_MAX,
  ATTACHMENT_MAX_BYTES,
  type DeleteAttachmentInput,
  type ListAttachmentsInput,
  type MyPermission,
} from "shared";
import type { CtxUser } from "../board/board.service.js";
import { loadBoardFor } from "../board/board.service.js";
import { logger } from "../../logger.js";
import * as cardRepo from "../card/card.repo.js";
import * as repo from "./attachment.repo.js";
import type { AttachmentRow, Db } from "./attachment.repo.js";
import type { Storage } from "./attachment.storage.js";

type ColumnRow = { id: string; board_id: string };

function err(code: AttachmentError, status: TRPCError["code"]): TRPCError {
  return new TRPCError({ code: status, message: code });
}

function cardNotFound() {
  return err(AttachmentError.CARD_NOT_FOUND, "NOT_FOUND");
}

// Resolve the card -> column -> board chain and enforce a board permission,
// mapping board NOT_FOUND/FORBIDDEN to CARD_NOT_FOUND (no existence leak).
async function loadCardBoard(
  db: Db,
  user: CtxUser,
  cardId: string,
  min: MyPermission,
): Promise<MyPermission> {
  const card = (await cardRepo.findCardById(db, cardId)) as { column_id: string } | undefined;
  if (!card) throw cardNotFound();
  const column = (await cardRepo.findColumnById(db, card.column_id)) as ColumnRow | undefined;
  if (!column) throw cardNotFound();
  try {
    const { perm } = await loadBoardFor(db, user, column.board_id, min);
    return perm;
  } catch (e) {
    if (e instanceof TRPCError && (e.code === "NOT_FOUND" || e.code === "FORBIDDEN")) {
      throw cardNotFound();
    }
    throw e;
  }
}

function toAttachment(row: AttachmentRow): Attachment {
  return {
    id: row.id,
    cardId: row.card_id,
    uploaderId: row.uploader_id,
    filename: row.filename,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    createdAt: row.created_at,
    downloadUrl: `/api/attachments/${row.id}/download`,
  };
}

// Build a sanitized storage key: cards/{cardId}/{uuid}{ext}. The raw filename
// never enters the key (prevents path traversal / ../ / NUL).
function buildStorageKey(cardId: string, id: string, filename: string): string {
  const raw = path.extname(filename).toLowerCase();
  const ext = /^\.[a-z0-9]+$/.test(raw) ? raw : "";
  return `cards/${cardId}/${id}${ext}`;
}

export async function createAttachment(
  db: Db,
  storage: Storage,
  user: CtxUser,
  input: {
    cardId: string;
    filename: string;
    mimeType: string;
    stream: NodeJS.ReadableStream;
  },
): Promise<Attachment> {
  if (!storage.isEnabled()) throw err(AttachmentError.STORAGE_UNAVAILABLE, "INTERNAL_SERVER_ERROR");
  await loadCardBoard(db, user, input.cardId, "edit");
  if (input.filename.length > ATTACHMENT_FILENAME_MAX) {
    throw err(AttachmentError.FILENAME_TOO_LONG, "BAD_REQUEST");
  }
  if (!(ATTACHMENT_ALLOWED_MIME as readonly string[]).includes(input.mimeType)) {
    throw err(AttachmentError.UNSUPPORTED_TYPE, "BAD_REQUEST");
  }

  const id = crypto.randomUUID();
  const key = buildStorageKey(input.cardId, id, input.filename);

  // Count bytes as they stream through; the DB size is the real count, never a
  // client-claimed length. The hard cap is enforced upstream (busboy fileSize).
  let sizeBytes = 0;
  const counter = new PassThrough();
  input.stream.on("data", (chunk: Buffer) => {
    sizeBytes += chunk.length;
  });
  input.stream.pipe(counter);
  await storage.putObject(key, counter, undefined, input.mimeType);

  if (sizeBytes > ATTACHMENT_MAX_BYTES) {
    await storage.removeObject(key).catch((rmErr) => logger.error({ err: rmErr, key }, "oversize attachment cleanup failed"));
    throw err(AttachmentError.FILE_TOO_LARGE, "BAD_REQUEST");
  }

  try {
    const row = await repo.create(db, {
      id,
      cardId: input.cardId,
      uploaderId: user.id,
      filename: input.filename,
      mimeType: input.mimeType,
      sizeBytes,
      storageKey: key,
    });
    return toAttachment(row as AttachmentRow);
  } catch (e) {
    // Avoid an orphan object if the row insert fails.
    await storage.removeObject(key).catch((rmErr) => logger.error({ err: rmErr, key }, "orphan attachment cleanup failed"));
    throw e;
  }
}

export async function listAttachments(
  db: Db,
  user: CtxUser,
  input: ListAttachmentsInput,
): Promise<Attachment[]> {
  await loadCardBoard(db, user, input.cardId, "view");
  const rows = (await repo.listByCard(db, input.cardId)) as AttachmentRow[];
  return rows.map(toAttachment);
}

// Load an attachment + its board permission for download/delete paths.
export async function loadAttachmentFor(
  db: Db,
  user: CtxUser,
  id: string,
): Promise<{ row: AttachmentRow; perm: MyPermission }> {
  const row = (await repo.findById(db, id)) as AttachmentRow | undefined;
  if (!row) throw err(AttachmentError.ATTACHMENT_NOT_FOUND, "NOT_FOUND");
  const perm = await loadCardBoard(db, user, row.card_id, "view");
  return { row, perm };
}

export async function deleteAttachment(
  db: Db,
  storage: Storage,
  user: CtxUser,
  input: DeleteAttachmentInput,
): Promise<{ ok: true }> {
  const { row, perm } = await loadAttachmentFor(db, user, input.id);
  if (row.uploader_id !== user.id && perm !== "owner") {
    throw err(AttachmentError.FORBIDDEN, "FORBIDDEN");
  }
  // Best-effort: a missing object must not block removing the row.
  await storage
    .removeObject(row.storage_key)
    .catch((rmErr) => logger.error({ err: rmErr, key: row.storage_key }, "attachment object remove failed"));
  await repo.deleteById(db, input.id);
  return { ok: true };
}
