import { type ReactNode } from "react";
import type { Permission } from "shared";
import { useCan } from "../hooks/useCan";

interface CanProps {
  perm: Permission;
  fallback?: ReactNode;
  children: ReactNode;
}

// Renders children only when the user holds `perm`; otherwise `fallback`.
export function Can({ perm, fallback = null, children }: CanProps) {
  return useCan(perm) ? <>{children}</> : <>{fallback}</>;
}
