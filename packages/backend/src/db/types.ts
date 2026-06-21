import type { ColumnType, Generated } from "kysely";
import type {
  ActivityMeta,
  BackupStatus,
  BackupTrigger,
  OtpPurpose,
  Permission,
  ProjectPermission,
  ProjectVisibility,
  RetentionMode,
  ScheduleKind,
} from "shared";

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

export interface ProjectsTable {
  id: Generated<string>;
  owner_id: string;
  name: string;
  description: string | null;
  color: string;
  visibility: Generated<ProjectVisibility>;
  created_at: GeneratedTimestamp;
  updated_at: GeneratedTimestamp;
}

export interface ProjectAccessTable {
  project_id: string;
  user_id: string;
  permission: ProjectPermission;
}

export interface BoardsTable {
  id: Generated<string>;
  project_id: string;
  owner_id: string;
  name: string;
  description: string | null;
  color: string;
  created_at: GeneratedTimestamp;
  updated_at: GeneratedTimestamp;
}

export interface BoardAccessTable {
  board_id: string;
  user_id: string;
  permission: ProjectPermission;
}

export interface ColumnsTable {
  id: Generated<string>;
  board_id: string;
  name: string;
  position: number;
  created_at: GeneratedTimestamp;
  updated_at: GeneratedTimestamp;
}

export interface CardsTable {
  id: Generated<string>;
  column_id: string;
  title: string;
  description: string | null;
  position: number;
  due_at: Timestamp | null;
  reminder_minutes: number | null;
  reminder_sent_at: Timestamp | null;
  cover_color: string | null;
  cover_attachment_id: string | null;
  created_at: GeneratedTimestamp;
  updated_at: GeneratedTimestamp;
  search_vector: ColumnType<string, never, never>;
}

export interface LabelsTable {
  id: Generated<string>;
  board_id: string;
  name: string;
  color: string;
  created_at: GeneratedTimestamp;
  updated_at: GeneratedTimestamp;
}

export interface CardLabelsTable {
  card_id: string;
  label_id: string;
}

export interface ChecklistsTable {
  id: Generated<string>;
  card_id: string;
  title: string;
  position: number;
  created_at: GeneratedTimestamp;
  updated_at: GeneratedTimestamp;
}

export interface ChecklistItemsTable {
  id: Generated<string>;
  checklist_id: string;
  text: string;
  is_done: Generated<boolean>;
  position: number;
  created_at: GeneratedTimestamp;
  updated_at: GeneratedTimestamp;
}

export interface CommentsTable {
  id: Generated<string>;
  card_id: string;
  author_id: string;
  parent_id: string | null;
  body: string;
  created_at: GeneratedTimestamp;
  updated_at: GeneratedTimestamp;
}

export interface CommentMentionsTable {
  comment_id: string;
  user_id: string;
}

export interface CardAssigneesTable {
  card_id: string;
  user_id: string;
  assigned_at: GeneratedTimestamp;
}

export interface AttachmentsTable {
  id: Generated<string>;
  card_id: string;
  uploader_id: string;
  filename: string;
  mime_type: string;
  // bigint: node-pg returns it as string; parse with Number in the service.
  size_bytes: ColumnType<string, string | number, string | number>;
  storage_key: string;
  created_at: GeneratedTimestamp;
}

export interface BackupSettingsTable {
  id: number;
  enabled: Generated<boolean>;
  schedule_kind: Generated<ScheduleKind>;
  cron_expr: string | null;
  retention_mode: Generated<RetentionMode>;
  retention_days: number | null;
  gfs_daily: number | null;
  gfs_weekly: number | null;
  gfs_monthly: number | null;
  include_minio: Generated<boolean>;
  encryption_enabled: Generated<boolean>;
  gdrive_email: string | null;
  gdrive_refresh_token: string | null;
  gdrive_folder_id: string | null;
  gdrive_folder_name: string | null;
  maintenance: Generated<boolean>;
  updated_at: GeneratedTimestamp;
}

export interface BackupRunsTable {
  id: Generated<string>;
  started_at: GeneratedTimestamp;
  finished_at: Timestamp | null;
  status: BackupStatus;
  trigger: BackupTrigger;
  // bigint: node-pg returns it as string; parse in the service layer.
  size_bytes: ColumnType<string | null, string | number | null, string | number | null>;
  drive_file_id: string | null;
  file_name: string;
  checksum: string | null;
  error: string | null;
  expires_at: Timestamp | null;
  created_at: GeneratedTimestamp;
}

export interface ActivitiesTable {
  id: Generated<string>;
  board_id: string;
  card_id: string | null;
  actor_id: string | null;
  type: string;
  // jsonb: select returns a parsed object; INSERT MUST send JSON TEXT (the
  // recorder JSON.stringify's it — node-pg sends a raw object as
  // "[object Object]"). So the insert type is string.
  meta: ColumnType<ActivityMeta, string, string>;
  created_at: GeneratedTimestamp;
}

export interface Database {
  users: UsersTable;
  roles: RolesTable;
  role_permissions: RolePermissionsTable;
  otp_codes: OtpCodesTable;
  refresh_tokens: RefreshTokensTable;
  auth_events: AuthEventsTable;
  projects: ProjectsTable;
  project_access: ProjectAccessTable;
  boards: BoardsTable;
  board_access: BoardAccessTable;
  columns: ColumnsTable;
  cards: CardsTable;
  labels: LabelsTable;
  card_labels: CardLabelsTable;
  checklists: ChecklistsTable;
  checklist_items: ChecklistItemsTable;
  comments: CommentsTable;
  comment_mentions: CommentMentionsTable;
  card_assignees: CardAssigneesTable;
  attachments: AttachmentsTable;
  backup_settings: BackupSettingsTable;
  backup_runs: BackupRunsTable;
  activities: ActivitiesTable;
}
