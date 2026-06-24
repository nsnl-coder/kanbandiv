import { createReadStream, createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { google } from "googleapis";
import { env } from "../../config/env.config.js";

// drive.file: app only sees files it created (narrowest scope for backups).
// openid+email: so we can show which account is connected.
const SCOPES = [
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/userinfo.email",
  "openid",
];

function oauthClient() {
  const client = new google.auth.OAuth2(
    env.GDRIVE_CLIENT_ID,
    env.GDRIVE_CLIENT_SECRET,
    env.GDRIVE_REDIRECT_URI,
  );
  // gaxios's bundled node-fetch throws ERR_STREAM_PREMATURE_CLOSE gunzipping
  // Google's token response on this Node/Alpine image (broken IPv6 egress +
  // Happy-Eyeballs). Ask for an uncompressed body to bypass that path. Mirrors
  // the same workaround in auth.google.ts.
  client.transporter.defaults = {
    ...client.transporter.defaults,
    headers: {
      ...client.transporter.defaults?.headers,
      "Accept-Encoding": "identity",
    },
  };
  return client;
}

/** Consent URL: offline access + forced consent so we always get a refresh token.
 * `state` is a signed token that binds the callback to the initiating admin -
 * required because SameSite=strict cookies aren't sent on Google's redirect. */
export function buildAuthUrl(state: string): string {
  return oauthClient().generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
    state,
  });
}

export async function exchangeCode(
  code: string,
): Promise<{ refreshToken: string; email: string }> {
  const client = oauthClient();
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error("Google did not return a refresh token");
  }
  client.setCredentials(tokens);
  const oauth2 = google.oauth2({ version: "v2", auth: client });
  const me = await oauth2.userinfo.get();
  return { refreshToken: tokens.refresh_token, email: me.data.email ?? "" };
}

export async function revokeToken(refreshToken: string): Promise<void> {
  const client = oauthClient();
  client.setCredentials({ refresh_token: refreshToken });
  await client.revokeToken(refreshToken);
}

function driveFor(refreshToken: string) {
  const client = oauthClient();
  client.setCredentials({ refresh_token: refreshToken });
  return google.drive({ version: "v3", auth: client });
}

/** Find (or create) the named backup folder; returns its id. With the drive.file
 * scope the search only sees folders this app created, so it won't collide with
 * the user's own folders of the same name. */
export async function ensureBackupFolder(
  refreshToken: string,
  name: string,
): Promise<string> {
  const drive = driveFor(refreshToken);
  const escaped = name.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const found = await drive.files.list({
    q: `mimeType='application/vnd.google-apps.folder' and name='${escaped}' and trashed=false`,
    fields: "files(id)",
    spaces: "drive",
  });
  const existing = found.data.files?.[0]?.id;
  if (existing) return existing;
  const created = await drive.files.create({
    requestBody: { name, mimeType: "application/vnd.google-apps.folder" },
    fields: "id",
  });
  return created.data.id ?? "";
}

export async function uploadFile(
  refreshToken: string,
  opts: { filePath: string; name: string; folderId: string | null },
): Promise<{ id: string; size: number }> {
  const drive = driveFor(refreshToken);
  const res = await drive.files.create({
    requestBody: {
      name: opts.name,
      parents: opts.folderId ? [opts.folderId] : undefined,
    },
    media: { body: createReadStream(opts.filePath) },
    fields: "id,size",
  });
  return { id: res.data.id ?? "", size: Number(res.data.size ?? 0) };
}

export async function downloadFile(
  refreshToken: string,
  fileId: string,
  destPath: string,
): Promise<void> {
  const drive = driveFor(refreshToken);
  const res = await drive.files.get(
    { fileId, alt: "media" },
    { responseType: "stream" },
  );
  await pipeline(res.data as NodeJS.ReadableStream, createWriteStream(destPath));
}

export async function deleteFile(
  refreshToken: string,
  fileId: string,
): Promise<void> {
  const drive = driveFor(refreshToken);
  await drive.files.delete({ fileId });
}
