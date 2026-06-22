import {
  ATTACHMENT_ALLOWED_MIME,
  ATTACHMENT_MAX_BYTES,
  BugSeverity,
  BugStatus,
  type BugSeverityValue,
  type BugStatusValue,
} from "shared";

export const ATTACHMENT_ACCEPT = (ATTACHMENT_ALLOWED_MIME as readonly string[]).join(",");

export function isWithinSize(file: File): boolean {
  return file.size <= ATTACHMENT_MAX_BYTES;
}

export function isAllowedType(file: File): boolean {
  return (ATTACHMENT_ALLOWED_MIME as readonly string[]).includes(file.type);
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB"];
  let value = n / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[i]}`;
}

export const SEVERITY_LABEL: Record<BugSeverityValue, string> = {
  [BugSeverity.LOW]: "Low",
  [BugSeverity.MEDIUM]: "Medium",
  [BugSeverity.HIGH]: "High",
  [BugSeverity.CRITICAL]: "Critical",
};

export const SEVERITY_BADGE: Record<BugSeverityValue, string> = {
  [BugSeverity.LOW]: "bg-slate-100 text-slate-700",
  [BugSeverity.MEDIUM]: "bg-blue-100 text-blue-700",
  [BugSeverity.HIGH]: "bg-amber-100 text-amber-800",
  [BugSeverity.CRITICAL]: "bg-red-100 text-red-700",
};

export const STATUS_LABEL: Record<BugStatusValue, string> = {
  [BugStatus.OPEN]: "Open",
  [BugStatus.IN_PROGRESS]: "In progress",
  [BugStatus.RESOLVED]: "Resolved",
  [BugStatus.CLOSED]: "Closed",
};

export const STATUS_BADGE: Record<BugStatusValue, string> = {
  [BugStatus.OPEN]: "bg-emerald-100 text-emerald-700",
  [BugStatus.IN_PROGRESS]: "bg-indigo-100 text-indigo-700",
  [BugStatus.RESOLVED]: "bg-slate-100 text-slate-700",
  [BugStatus.CLOSED]: "bg-slate-200 text-slate-600",
};

export const severityList: readonly BugSeverityValue[] =
  Object.values(BugSeverity);
export const statusList: readonly BugStatusValue[] = Object.values(BugStatus);

export function severityLabel(s: BugSeverityValue): string {
  return SEVERITY_LABEL[s];
}

export function formatStatus(s: BugStatusValue): string {
  return STATUS_LABEL[s];
}
