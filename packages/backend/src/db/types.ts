import type { ColumnType, Generated } from "kysely";
import type { OtpPurpose, Permission } from "shared";

// Required timestamp (no DB default): insertable/updatable as Date or string.
export type Timestamp = ColumnType<Date, Date | string, Date | string>;
// Timestamp with a DB default: optional on insert.
export type GeneratedTimestamp = ColumnType<Date, Date | string | undefined, Date | string>;

export interface UsersTable {
  id: Generated<string>;
  email: string;
  password_hash: string;
  email_verified: Generated<boolean>;
  is_superuser: Generated<boolean>;
  role_id: string | null;
  failed_login_count: Generated<number>;
  locked_until: Timestamp | null;
  created_at: GeneratedTimestamp;
  updated_at: GeneratedTimestamp;
}

export interface RolesTable {
  id: Generated<string>;
  name: string;
  description: string | null;
  created_at: GeneratedTimestamp;
  updated_at: GeneratedTimestamp;
}

export interface RolePermissionsTable {
  role_id: string;
  permission: Permission;
}

export interface OtpCodesTable {
  id: Generated<string>;
  user_id: string;
  code_hash: string;
  purpose: OtpPurpose;
  expires_at: Timestamp;
  consumed_at: Timestamp | null;
  attempts: Generated<number>;
  created_at: GeneratedTimestamp;
}

export interface RefreshTokensTable {
  id: Generated<string>;
  user_id: string;
  token_hash: string;
  family_id: string;
  parent_id: string | null;
  expires_at: Timestamp;
  revoked_at: Timestamp | null;
  reused_at: Timestamp | null;
  created_at: GeneratedTimestamp;
}

export interface AuthEventsTable {
  id: Generated<string>;
  user_id: string | null;
  event: string;
  ip: string | null;
  user_agent: string | null;
  outcome: string;
  created_at: GeneratedTimestamp;
}

export interface Database {
  users: UsersTable;
  roles: RolesTable;
  role_permissions: RolePermissionsTable;
  otp_codes: OtpCodesTable;
  refresh_tokens: RefreshTokensTable;
  auth_events: AuthEventsTable;
}
