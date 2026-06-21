import { appDb } from "../db/index.js";
import { seedSuperAdmin } from "./seedSuperAdmin.js";

await seedSuperAdmin(appDb);
await appDb.destroy();
