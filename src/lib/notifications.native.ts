/**
 * Phone notifications. Pepper alerts are LOCAL notifications scheduled on the
 * device (they work in Expo Go and fire even when the app is closed). The
 * queue is rebuilt from scratch whenever tasks change or the app opens.
 */
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import type { PlannedAlert } from './alert-plan';

export const notificationsSupported = true;

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

let ready: Promise<boolean> | null = null;

/** Ask permission once and create the Android channels. */
export function setupNotifications(): Promise<boolean> {
  if (!ready) {
    ready = (async () => {
      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('pepper-hot', {
          name: 'Hot tasks (Habanero & Ghost Pepper)',
          importance: Notifications.AndroidImportance.MAX,
          vibrationPattern: [0, 300, 200, 300],
        });
        // LOW importance: shows in the shade and on the lock screen, no sound.
        await Notifications.setNotificationChannelAsync('pepper-mild', {
          name: 'Reminders (Jalapeño & Serrano)',
          importance: Notifications.AndroidImportance.LOW,
        });
        await Notifications.setNotificationChannelAsync('group', {
          name: 'Group deadline changes',
          importance: Notifications.AndroidImportance.HIGH,
        });
      }
      const current = await Notifications.getPermissionsAsync();
      if (current.granted) return true;
      const asked = await Notifications.requestPermissionsAsync();
      return asked.granted;
    })();
  }
  return ready;
}

// Rebuilds run one at a time; if several are requested while one is running,
// only the newest runs next. Two overlapping cancel-then-schedule passes would
// otherwise leave duplicate alerts behind.
let queue: Promise<unknown> = Promise.resolve();
let latest = 0;

export function schedulePepperAlerts(alerts: PlannedAlert[]): Promise<number> {
  const mine = ++latest;
  const run = queue.then(() => (mine === latest ? replaceAlerts(alerts) : 0));
  queue = run.catch(() => 0);
  return run;
}

async function replaceAlerts(alerts: PlannedAlert[]): Promise<number> {
  if (!(await setupNotifications())) return 0;
  await Notifications.cancelAllScheduledNotificationsAsync();
  for (const a of alerts) {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: a.title,
        body: a.body,
        sound: a.sound ? 'default' : undefined,
        data: { kind: 'pepper', taskIds: a.taskIds },
        ...(Platform.OS === 'android' ? {} : { interruptionLevel: a.level === 'ghost' ? 'timeSensitive' : 'active' }),
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: a.at,
        ...(Platform.OS === 'android' ? { channelId: a.sound ? 'pepper-hot' : 'pepper-mild' } : {}),
      },
    });
  }
  return alerts.length;
}

/** Show a notification right away (used for group deadline changes). */
export async function notifyNow(title: string, body: string): Promise<void> {
  if (!(await setupNotifications())) return;
  await Notifications.scheduleNotificationAsync({
    content: { title, body, sound: 'default', data: { kind: 'group' } },
    trigger: Platform.OS === 'android' ? { channelId: 'group' } : null,
  });
}
