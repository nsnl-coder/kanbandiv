import { Client as MinioClient } from "minio";
import { env } from "../../config/env.config.js";

export interface Storage {
  putObject(key: string, stream: NodeJS.ReadableStream, size: number | undefined, mime: string): Promise<void>;
  getObject(key: string): Promise<NodeJS.ReadableStream>;
  statObject(key: string): Promise<{ size: number }>;
  removeObject(key: string): Promise<void>;
  removePrefix(prefix: string): Promise<void>;
  ensureBucket(): Promise<void>;
  isEnabled(): boolean;
}

class MinioStorage implements Storage {
  private client: MinioClient | null = null;
  private readonly bucket = env.MINIO_ATTACHMENTS_BUCKET;

  isEnabled(): boolean {
    return env.MINIO_ENDPOINT.length > 0;
  }

  // Lazily build the client so an empty/invalid endpoint never throws at boot.
  private c(): MinioClient {
    if (!this.client) {
      this.client = new MinioClient({
        endPoint: env.MINIO_ENDPOINT,
        port: env.MINIO_PORT,
        useSSL: env.MINIO_USE_SSL,
        accessKey: env.MINIO_ACCESS_KEY,
        secretKey: env.MINIO_SECRET_KEY,
      });
    }
    return this.client;
  }

  async putObject(key: string, stream: NodeJS.ReadableStream, size: number | undefined, mime: string): Promise<void> {
    await this.c().putObject(this.bucket, key, stream as never, size, { "Content-Type": mime });
  }

  async getObject(key: string): Promise<NodeJS.ReadableStream> {
    return this.c().getObject(this.bucket, key);
  }

  async statObject(key: string): Promise<{ size: number }> {
    const stat = await this.c().statObject(this.bucket, key);
    return { size: stat.size };
  }

  async removeObject(key: string): Promise<void> {
    await this.c().removeObject(this.bucket, key);
  }

  async removePrefix(prefix: string): Promise<void> {
    if (!this.isEnabled()) return;
    const keys = await new Promise<string[]>((resolve, reject) => {
      const out: string[] = [];
      const stream = this.c().listObjectsV2(this.bucket, prefix, true);
      stream.on("data", (obj) => {
        if (obj.name) out.push(obj.name);
      });
      stream.on("end", () => resolve(out));
      stream.on("error", reject);
    });
    if (keys.length) await this.c().removeObjects(this.bucket, keys);
  }

  async ensureBucket(): Promise<void> {
    if (!this.isEnabled()) return;
    try {
      const exists = await this.c().bucketExists(this.bucket);
      if (!exists) await this.c().makeBucket(this.bucket);
    } catch (err) {
      // Swallow "already owned/exists" races; rethrow anything else.
      const code = (err as { code?: string }).code ?? "";
      if (code === "BucketAlreadyOwnedByYou" || code === "BucketAlreadyExists") return;
      throw err;
    }
  }
}

export const storage: Storage = new MinioStorage();
