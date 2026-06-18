import { beforeEach } from "vitest";
import { resetRateLimits } from "./trpc/trpc.js";

// Rate-limit buckets are module-global; clear them between tests so per-IP
// counts don't leak across cases (tests run with no IP -> shared bucket).
beforeEach(() => {
  resetRateLimits();
});
