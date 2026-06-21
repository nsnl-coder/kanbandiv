// In-memory mirror of backup_settings.maintenance so the tRPC guard avoids a DB
// hit per request. Loaded on boot and updated whenever the flag is toggled.
let cached = false;

export function isMaintenance(): boolean {
  return cached;
}

export function setMaintenanceCache(value: boolean): void {
  cached = value;
}
