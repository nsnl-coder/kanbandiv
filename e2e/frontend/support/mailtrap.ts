// Fetch real OTP codes from the Mailtrap sandbox inbox, so e2e exercises the
// actual email -> code path (no DB peeking). Requires MAILTRAP_API_TOKEN; the
// account/inbox default to the project's sandbox but are env-overridable.

const ACCOUNT_ID = process.env.MAILTRAP_ACCOUNT_ID ?? "1334917";
const INBOX_ID = process.env.MAILTRAP_INBOX_ID ?? "3716831";
const BASE = "https://mailtrap.io/api";

function token(): string {
  const t = process.env.MAILTRAP_API_TOKEN;
  if (!t) throw new Error("MAILTRAP_API_TOKEN not set (add it to packages/backend/.env.test)");
  return t;
}

interface Message {
  id: number;
  subject: string;
  to_email: string;
  sent_at: string;
}

async function api<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Api-Token": token(), Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Mailtrap ${path} -> ${res.status}`);
  return res.json() as Promise<T>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Poll the inbox for the newest message to `email` sent at/after `since`, then
// pull `len` consecutive digits (6 = verify, 8 = reset) from its HTML body.
export async function fetchOtp(
  email: string,
  len: 6 | 8,
  since: number,
  timeoutMs = 20_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  const wanted = email.toLowerCase();
  const re = new RegExp(`(?<!\\d)(\\d{${len}})(?!\\d)`);

  while (Date.now() < deadline) {
    const msgs = await api<Message[]>(
      `/accounts/${ACCOUNT_ID}/inboxes/${INBOX_ID}/messages?search=${encodeURIComponent(email)}`,
    );
    const match = msgs
      .filter((m) => m.to_email.toLowerCase() === wanted && Date.parse(m.sent_at) >= since - 1000)
      .sort((a, b) => Date.parse(b.sent_at) - Date.parse(a.sent_at))[0];

    if (match) {
      const html = await fetch(
        `${BASE}/accounts/${ACCOUNT_ID}/inboxes/${INBOX_ID}/messages/${match.id}/body.html`,
        { headers: { "Api-Token": token() } },
      ).then((r) => r.text());
      const text = html.replace(/<[^>]+>/g, " ");
      const found = re.exec(text);
      if (found) return found[1];
    }
    await sleep(1000);
  }
  throw new Error(`No ${len}-digit OTP email for ${email} within ${timeoutMs}ms`);
}
