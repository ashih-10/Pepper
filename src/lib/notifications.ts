// Web: browsers can't schedule phone-style local notifications, so these are
// no-ops. The phone version lives in notifications.native.ts.
import type { PlannedAlert } from './alert-plan';

export const notificationsSupported = false;

export async function setupNotifications(): Promise<boolean> {
  return false;
}

export async function schedulePepperAlerts(_alerts: PlannedAlert[]): Promise<number> {
  return 0;
}

export async function notifyNow(_title: string, _body: string): Promise<void> {}
