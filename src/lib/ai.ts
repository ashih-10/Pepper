/**
 * Calls to the AI edge functions. The Claude API key lives only on the
 * server; the app sends the student's login token and gets results back.
 */
import { FunctionsHttpError } from '@supabase/supabase-js';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import { dayKey, timeZoneName, weekdayLong } from './dates';
import { supabase } from './supabase';
import type { TaskType, WeightTier } from './types';

export type UnclearField = 'title' | 'class' | 'due_date' | 'due_time' | 'task_type' | 'weight_pct';

export interface ExtractedTask {
  title: string;
  class_name: string | null;
  due_date: string | null;
  due_time: string | null;
  task_type: TaskType | null;
  custom_label: string | null;
  custom_tier: WeightTier | null;
  weight_pct: number | null;
  notes: string | null;
  unclear: UnclearField[];
  question: string | null;
}

export interface ExtractResult {
  tasks: ExtractedTask[];
  message: string | null;
}

export interface GamePlan {
  headline: string;
  steps: { task_id: string; tip: string; minutes: number }[];
  closing: string;
}

async function invoke<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>(name, { body });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const payload = await error.context.json().catch(() => null);
      throw new Error(payload?.error ?? 'The AI had a problem. Try again.');
    }
    throw new Error('Could not reach the AI. Check your connection.');
  }
  return data as T;
}

const MAX_SIDE = 1568;

/** Let the student take or choose a photo; returns a resized JPEG as base64. */
export async function pickAssignmentImage(source: 'camera' | 'library'): Promise<string | null> {
  if (source === 'camera') {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) throw new Error('Camera permission is needed to scan an assignment.');
  }
  const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1 };
  const result =
    source === 'camera' ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
  if (result.canceled || !result.assets[0]) return null;

  const asset = result.assets[0];
  const ctx = ImageManipulator.manipulate(asset.uri);
  const longest = Math.max(asset.width, asset.height);
  if (longest > MAX_SIDE) {
    ctx.resize(asset.width >= asset.height ? { width: MAX_SIDE } : { height: MAX_SIDE });
  }
  const ref = await ctx.renderAsync();
  const saved = await ref.saveAsync({ format: SaveFormat.JPEG, compress: 0.75, base64: true });
  if (!saved.base64) throw new Error('Could not read that image.');
  return saved.base64.replace(/^data:image\/\w+;base64,/, '');
}

export function extractTasksFromImage(imageBase64: string, classNames: string[], now = new Date()) {
  return invoke<ExtractResult>('extract-task', {
    image: imageBase64,
    media_type: 'image/jpeg',
    today: dayKey(now),
    weekday: weekdayLong(now),
    timezone: timeZoneName(),
    classes: classNames,
  });
}

export interface PlanTaskInput {
  id: string;
  title: string;
  kind: string;
  class_name: string | null;
  due: string;
  pepper: string;
}

export function fetchGamePlan(tasks: PlanTaskInput[], nowLabel: string) {
  return invoke<GamePlan>('plan-today', { now: nowLabel, timezone: timeZoneName(), tasks });
}
