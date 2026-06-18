import { appDb } from "../db/index.js";
import { cleanupExpired } from "../features/auth/auth.service.js";

const result = await cleanupExpired(appDb);
console.log(`Cleanup done. Removed ${result.otps} OTPs, ${result.tokens} refresh tokens.`);
await appDb.destroy();
