import { describe, expect, it } from "vitest";
import {
  Permission,
  PERMISSION_CATALOG,
  assignGlobalRoleInput,
  createRoleInput,
  hasPermission,
  isPermission,
  updateRolePermissionsInput,
} from "./rbac.schema.js";

const ALL_PERMISSIONS = Object.values(Permission);

describe("hasPermission", () => {
  it("is true when the permission is in the set", () => {
    const set = new Set<Permission>([Permission.AdminUsersRead]);
    expect(hasPermission(set, Permission.AdminUsersRead)).toBe(true);
  });

  it("is false when the permission is absent", () => {
    const set = new Set<Permission>([Permission.AdminUsersRead]);
    expect(hasPermission(set, Permission.AdminRolesManage)).toBe(false);
  });

  it("is false for an empty set", () => {
    expect(hasPermission(new Set(), Permission.AdminUsersRead)).toBe(false);
  });
});

describe("PERMISSION_CATALOG integrity", () => {
  it("every key is a valid Permission enum value", () => {
    for (const meta of PERMISSION_CATALOG) {
      expect(isPermission(meta.key)).toBe(true);
    }
  });

  it("covers every Permission enum member", () => {
    const keys = PERMISSION_CATALOG.map((m) => m.key).sort();
    expect(keys).toEqual([...ALL_PERMISSIONS].sort());
  });

  it("has unique keys, each with a non-empty label", () => {
    const keys = PERMISSION_CATALOG.map((m) => m.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const meta of PERMISSION_CATALOG) {
      expect(meta.label.length).toBeGreaterThan(0);
    }
  });
});

describe("createRoleInput", () => {
  it("accepts name with optional description and permissions", () => {
    const parsed = createRoleInput.parse({
      name: "Support",
      description: "Helpers",
      permissions: [Permission.AdminUsersRead],
    });
    expect(parsed.name).toBe("Support");
    expect(parsed.permissions).toEqual([Permission.AdminUsersRead]);
  });

  it("accepts name only", () => {
    expect(createRoleInput.parse({ name: "Solo" }).name).toBe("Solo");
  });

  it("rejects an empty name", () => {
    expect(createRoleInput.safeParse({ name: "" }).success).toBe(false);
  });
});

describe("assignGlobalRoleInput", () => {
  it("accepts a roleId string", () => {
    expect(assignGlobalRoleInput.parse({ roleId: "abc" }).roleId).toBe("abc");
  });

  it("accepts a null roleId", () => {
    expect(assignGlobalRoleInput.parse({ roleId: null }).roleId).toBeNull();
  });
});

describe("updateRolePermissionsInput", () => {
  it("accepts a list of valid permissions", () => {
    const parsed = updateRolePermissionsInput.parse({
      permissions: [Permission.AdminRolesRead],
    });
    expect(parsed.permissions).toEqual([Permission.AdminRolesRead]);
  });

  it("rejects an unknown permission string", () => {
    expect(
      updateRolePermissionsInput.safeParse({ permissions: ["nope:nope"] }).success,
    ).toBe(false);
  });
});
