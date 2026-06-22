import { google } from "googleapis";
import { env } from "../../config/env.config.js";

// openid+email+profile: identity only. We never store Google tokens; the id_token
// is verified once at callback to read the account's sub + verified email.
const SCOPES = [
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
];

function oauthClient() {
  const client = new google.auth.OAuth2(
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET,
    env.GOOGLE_REDIRECT_URI,
  );
  // gaxios's bundled node-fetch throws ERR_STREAM_PREMATURE_CLOSE gunzipping
  // Google's token response on this Node/Alpine image. Ask for an uncompressed
  // body to bypass that path (token payloads are tiny, so no real cost).
  client.transporter.defaults = {
    ...client.transporter.defaults,
    headers: {
      ...client.transporter.defaults?.headers,
      "Accept-Encoding": "identity",
    },
  };
  return client;
}

export const googleSignInEnabled = !!env.GOOGLE_CLIENT_ID;

/** Consent URL. `state` is a per-request nonce (double-submit cookie) that the
 * callback checks for CSRF, since SameSite cookies aren't sent on Google's POST. */
export function buildGoogleAuthUrl(state: string): string {
  return oauthClient().generateAuthUrl({
    scope: SCOPES,
    state,
    prompt: "select_account",
  });
}

export interface GoogleProfile {
  sub: string;
  email: string;
  emailVerified: boolean;
}

/** Exchange the auth code and verify the returned id_token (audience-bound). */
export async function exchangeGoogleCode(code: string): Promise<GoogleProfile> {
  const client = oauthClient();
  const { tokens } = await client.getToken(code);
  if (!tokens.id_token) throw new Error("Google did not return an id_token");
  const ticket = await client.verifyIdToken({
    idToken: tokens.id_token,
    audience: env.GOOGLE_CLIENT_ID,
  });
  const p = ticket.getPayload();
  if (!p?.sub || !p.email) throw new Error("Google id_token missing sub/email");
  return { sub: p.sub, email: p.email.toLowerCase(), emailVerified: !!p.email_verified };
}
