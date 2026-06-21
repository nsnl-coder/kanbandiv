import { Readable } from "node:stream";
import type { Storage } from "../attachment.storage.js";

export {
  authedCaller,
  createCaller,
  makeContext,
  newTestDb,
  seedAccess,
  seedBoard,
  seedBoardAccess,
  seedCard,
  seedColumn,
  seedProject,
  seedUser,
  seedUserCaller,
  superuserCaller,
  type TestDb,
} from "../../board/test/helpers.js";

export interface FakeStorage extends Storage {
  objects: Map<string, Buffer>;
  puts: { key: string; size: number | undefined }[];
  removed: string[];
  removedPrefixes: string[];
  enabled: boolean;
  failNextRemove: boolean;
}

export function fakeStorage(opts: { enabled?: boolean } = {}): FakeStorage {
  const objects = new Map<string, Buffer>();
  const puts: { key: string; size: number | undefined }[] = [];
  const removed: string[] = [];
  const removedPrefixes: string[] = [];
  const store: FakeStorage = {
    objects,
    puts,
    removed,
    removedPrefixes,
    enabled: opts.enabled ?? true,
    failNextRemove: false,
    isEnabled() {
      return store.enabled;
    },
    async putObject(key, stream, size) {
      const chunks: Buffer[] = [];
      for await (const c of stream as AsyncIterable<Buffer>) chunks.push(Buffer.from(c));
      objects.set(key, Buffer.concat(chunks));
      puts.push({ key, size });
    },
    async getObject(key) {
      const buf = objects.get(key);
      if (!buf) throw new Error("not found");
      return Readable.from(buf);
    },
    async statObject(key) {
      const buf = objects.get(key);
      if (!buf) throw new Error("not found");
      return { size: buf.length };
    },
    async removeObject(key) {
      if (store.failNextRemove) {
        store.failNextRemove = false;
        throw new Error("remove failed");
      }
      removed.push(key);
      objects.delete(key);
    },
    async removePrefix(prefix) {
      removedPrefixes.push(prefix);
      for (const k of [...objects.keys()]) {
        if (k.startsWith(prefix)) objects.delete(k);
      }
    },
    async ensureBucket() {},
  };
  return store;
}
