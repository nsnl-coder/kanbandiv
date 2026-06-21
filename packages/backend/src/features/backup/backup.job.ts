import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { env } from "../../config/env.config.js";

function workRoot(): string {
  return env.BACKUP_WORK_DIR || os.tmpdir();
}

/** Spawn a command, inheriting no stdin; reject with stderr on non-zero exit. */
function run(
  cmd: string,
  args: string[],
  extraEnv?: Record<string, string>,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      env: { ...process.env, ...extraEnv },
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr?.on("data", (d) => {
      stderr += String(d);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited ${code}: ${stderr.slice(0, 500)}`));
    });
  });
}

async function sha256(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

function minioBuckets(): string[] {
  return env.MINIO_BACKUP_BUCKETS.split(",").map((s) => s.trim()).filter(Boolean);
}

// MC_HOST_* lets `mc` authenticate without writing a persistent config file.
function mcEnv(): Record<string, string> {
  const user = encodeURIComponent(env.MINIO_ACCESS_KEY);
  const pass = encodeURIComponent(env.MINIO_SECRET_KEY);
  const endpoint = env.MINIO_ENDPOINT.replace(/^https?:\/\//, "");
  const scheme = env.MINIO_ENDPOINT.startsWith("https") ? "https" : "http";
  return { MC_HOST_backup: `${scheme}://${user}:${pass}@${endpoint}` };
}

export interface Archive {
  filePath: string;
  fileName: string;
  checksum: string;
  sizeBytes: number;
  cleanup: () => Promise<void>;
}

/**
 * Build a backup archive: pg_dump (custom format) + optional MinIO mirror, tarred
 * and gzipped, optionally gpg-encrypted. Returns the final file + sha256 + size.
 */
export async function createArchive(opts: {
  includeMinio: boolean;
  encrypt: boolean;
}): Promise<Archive> {
  const root = workRoot();
  const dir = await mkdtemp(path.join(root, "backup-"));
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  let filePath = path.join(root, `backup-${ts}.tar.gz`);
  let fileName = `backup-${ts}.tar.gz`;

  const cleanup = async () => {
    await rm(dir, { recursive: true, force: true });
    await rm(filePath, { force: true });
  };

  try {
    await run("pg_dump", [
      "--format=custom",
      `--file=${path.join(dir, "db.dump")}`,
      env.DATABASE_URL,
    ]);

    if (opts.includeMinio) {
      for (const bucket of minioBuckets()) {
        await run(
          "mc",
          ["mirror", "--overwrite", `backup/${bucket}`, path.join(dir, "minio", bucket)],
          mcEnv(),
        );
      }
    }

    // --force-local: treat a Windows "C:\..." archive path as a local file, not
    // a remote host:path (GNU tar). No-op/harmless on Linux.
    await run("tar", ["--force-local", "-czf", filePath, "-C", dir, "."]);

    if (opts.encrypt) {
      const enc = `${filePath}.gpg`;
      await run("gpg", [
        "--batch",
        "--yes",
        "--passphrase",
        env.BACKUP_ENCRYPTION_PASSPHRASE,
        "--symmetric",
        "--cipher-algo",
        "AES256",
        "-o",
        enc,
        filePath,
      ]);
      await rm(filePath, { force: true });
      filePath = enc;
      fileName = `${fileName}.gpg`;
    }

    const checksum = await sha256(filePath);
    const { size } = await stat(filePath);
    return { filePath, fileName, checksum, sizeBytes: size, cleanup };
  } catch (err) {
    await cleanup();
    throw err;
  }
}

/**
 * Restore from a downloaded archive: verify checksum, decrypt if needed, extract,
 * pg_restore (clean), and mirror MinIO buckets back.
 */
export async function restoreArchive(opts: {
  filePath: string;
  expectedChecksum: string | null;
  encrypted: boolean;
  includeMinio: boolean;
}): Promise<void> {
  if (opts.expectedChecksum) {
    const actual = await sha256(opts.filePath);
    if (actual !== opts.expectedChecksum) {
      throw new Error("CHECKSUM_MISMATCH");
    }
  }

  const root = workRoot();
  const dir = await mkdtemp(path.join(root, "restore-"));
  try {
    let tarPath = opts.filePath;
    if (opts.encrypted) {
      tarPath = path.join(dir, "archive.tar.gz");
      await run("gpg", [
        "--batch",
        "--yes",
        "--passphrase",
        env.BACKUP_ENCRYPTION_PASSPHRASE,
        "-o",
        tarPath,
        "-d",
        opts.filePath,
      ]);
    }

    await run("tar", ["--force-local", "-xzf", tarPath, "-C", dir]);

    await run("pg_restore", [
      "--clean",
      "--if-exists",
      "--no-owner",
      `--dbname=${env.DATABASE_URL}`,
      path.join(dir, "db.dump"),
    ]);

    if (opts.includeMinio) {
      for (const bucket of minioBuckets()) {
        await run(
          "mc",
          [
            "mirror",
            "--overwrite",
            "--remove",
            path.join(dir, "minio", bucket),
            `backup/${bucket}`,
          ],
          mcEnv(),
        );
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
