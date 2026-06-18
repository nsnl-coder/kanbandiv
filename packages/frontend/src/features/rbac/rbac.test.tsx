import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { Permission, type PublicUser } from "shared";
import { useAuthStore } from "../../hooks/useAuthStore";
import { Can } from "./components/Can";
import { PermissionRoute } from "../../components/PermissionRoute";

function makeUser(over: Partial<PublicUser> = {}): PublicUser {
  return {
    id: "u1",
    email: "a@b.c",
    isSuperuser: false,
    roleId: null,
    emailVerified: true,
    permissions: [],
    ...over,
  };
}

beforeEach(() => useAuthStore.getState().clearAuth());

describe("Can", () => {
  it("renders children when the user holds the perm", () => {
    useAuthStore.getState().setAuth(makeUser({ permissions: [Permission.AdminRolesRead] }));
    render(
      <Can perm={Permission.AdminRolesRead}>
        <span>visible</span>
      </Can>,
    );
    expect(screen.getByText("visible")).toBeInTheDocument();
  });

  it("hides children and shows fallback when missing the perm", () => {
    useAuthStore.getState().setAuth(makeUser());
    render(
      <Can perm={Permission.AdminRolesRead} fallback={<span>nope</span>}>
        <span>visible</span>
      </Can>,
    );
    expect(screen.queryByText("visible")).not.toBeInTheDocument();
    expect(screen.getByText("nope")).toBeInTheDocument();
  });

  it("renders for a superuser regardless of explicit perms", () => {
    useAuthStore.getState().setAuth(makeUser({ isSuperuser: true }));
    render(
      <Can perm={Permission.AdminUsersManage}>
        <span>visible</span>
      </Can>,
    );
    expect(screen.getByText("visible")).toBeInTheDocument();
  });
});

function renderGuard(perm?: Permission) {
  return render(
    <MemoryRouter initialEntries={["/admin/roles"]}>
      <Routes>
        <Route element={<PermissionRoute perm={perm} />}>
          <Route path="/admin/roles" element={<div>admin-content</div>} />
        </Route>
        <Route path="/login" element={<div>login-page</div>} />
        <Route path="/" element={<div>home-page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("PermissionRoute", () => {
  it("redirects to /login when not authenticated", () => {
    renderGuard(Permission.AdminRolesRead);
    expect(screen.getByText("login-page")).toBeInTheDocument();
  });

  it("redirects home when authenticated but missing the perm", () => {
    useAuthStore.getState().setAuth(makeUser());
    renderGuard(Permission.AdminRolesRead);
    expect(screen.getByText("home-page")).toBeInTheDocument();
  });

  it("renders the route when the user holds the perm", () => {
    useAuthStore.getState().setAuth(makeUser({ permissions: [Permission.AdminRolesRead] }));
    renderGuard(Permission.AdminRolesRead);
    expect(screen.getByText("admin-content")).toBeInTheDocument();
  });

  it("superuser bypasses the perm check", () => {
    useAuthStore.getState().setAuth(makeUser({ isSuperuser: true }));
    renderGuard(Permission.AdminRolesRead);
    expect(screen.getByText("admin-content")).toBeInTheDocument();
  });

  it("allows any authenticated user when no perm is required", () => {
    useAuthStore.getState().setAuth(makeUser());
    renderGuard(undefined);
    expect(screen.getByText("admin-content")).toBeInTheDocument();
  });
});
