import { describe, expect, it } from "vitest";
import { openApiDocument } from "../../../openapi.js";

describe("openapi document", () => {
  it("generates without throwing and exposes the auth paths", () => {
    const paths = Object.keys(openApiDocument.paths ?? {});
    expect(paths).toContain("/auth/register");
    expect(paths).toContain("/auth/login");
    expect(paths).toContain("/auth/me");
    expect(paths.length).toBeGreaterThanOrEqual(10);
  });

  it("marks protected endpoints with a security requirement", () => {
    const me = openApiDocument.paths?.["/auth/me"]?.get;
    expect(me?.security).toBeTruthy();
  });
});
