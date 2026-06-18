import type { PublicUser } from "shared";

export type AuthUser = PublicUser;

export interface AuthFormState {
  topError: string | null;
  submitting: boolean;
}
