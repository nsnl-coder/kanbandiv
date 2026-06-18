import type { PublicUser, AuthRole } from "shared";

export type AuthUser = PublicUser;

export type { AuthRole };

export interface AuthFormState {
  topError: string | null;
  submitting: boolean;
}
