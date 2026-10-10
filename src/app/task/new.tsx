/**
 * Add a task by hand, or by photo: snap an assignment sheet, AI fills the
 * fields, the app asks about anything unclear, the student confirms each one.
 */
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, View } from 'react-native';

import { DEMO_PLACE, DemoBanner } from '@/components/demo-banner';
import { emptyDraft, TaskForm, type FormField, type TaskDraft } from '@/components/task-form';
import { Banner, Button, Card, Muted, Screen, tell } from '@/components/ui';
import { goBack } from '@/lib/nav';
import { extractTasksFromImage, pickAssignmentImage, type ExtractedTask } from '@/lib/ai';
import * as api from '@/lib/api';
import { draftToInput, extractedToDraft } from '@/lib/drafts';
import { C, S } from '@/lib/theme';
import { usePlanner } from '@/state/planner';

export default function NewTask() {
  const { scan, group } = useLocalSearchParams<{ scan?: string; group?: string }>();
  const { classes, refresh } = usePlanner();
  const [queue, setQueue] = useState<ExtractedTask[]>([]);
  const [index, setIndex] = useState(0);
  const [reading, setReading] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [formKey, setFormKey] = useState(0);
  const autoScanned = useRef(false);

  async function scanFrom(source: 'camera' | 'library') {
    setNote(null);
    try {
      const image = await pickAssignmentImage(source);
      if (!image) return;
      setReading(true);
      const result = await extractTasksFromImage(image, classes.map((c) => c.name));
      if (result.tasks.length === 0) {
        setNote(result.message ?? 'No assignments found in that photo.');
        return;
      }
      setQueue(result.tasks);
      setIndex(0);
      setFormKey((k) => k + 1);
    } catch (e) {
      tell('Could not read that photo', e instanceof Error ? e.message : undefined);
    } finally {
      setReading(false);
    }
  }

  useEffect(() => {
    if (scan === '1' && !autoScanned.current) {
      autoScanned.current = true;
      scanFrom(Platform.OS === 'web' ? 'library' : 'camera');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scan]);

  const current = queue[index];
  let initial: TaskDraft = { ...emptyDraft(), group_id: group ?? null };
  let flagged: FormField[] = [];
  if (current) {
    ({ draft: initial, flagged } = extractedToDraft(current, classes));
    initial.group_id = group ?? null;
  }

  function advance() {
    if (index + 1 < queue.length) {
      setIndex(index + 1);
      setFormKey((k) => k + 1);
    } else {
      goBack();
    }
  }

  async function save(d: TaskDraft) {
    const input = draftToInput(d);
    await api.createTask(input);
    await refresh();
    advance();
  }

  if (reading) {
    return (
      <View style={styles.reading}>
        <Text style={{ fontSize: 48 }}>🔎🌶️</Text>
        <ActivityIndicator color={C.primary} size="large" />
        <Text style={styles.readingText}>Reading your assignment…</Text>
        <Muted>This usually takes a few seconds.</Muted>
      </View>
    );
  }

  return (
    <Screen edges={['bottom']}>
      {!current && (
        <DemoBanner>
          {`Demo mode: photo reading is simulated. Your photo stays in ${DEMO_PLACE} and you get sample tasks to review.`}
        </DemoBanner>
      )}
      {!current ? (
        <Card>
          <Text style={styles.scanTitle}>📸 Scan an assignment sheet</Text>
          <Muted>Snap a photo of an assignment, syllabus or LMS page. AI fills in the fields; you check them.</Muted>
          <View style={styles.row}>
            {Platform.OS !== 'web' && (
              <Button title="Camera" icon="camera" onPress={() => scanFrom('camera')} style={{ flex: 1 }} />
            )}
            <Button title="Photo library" icon="images" kind="secondary" onPress={() => scanFrom('library')} style={{ flex: 1 }} />
          </View>
          {note && <Banner tone="warn" icon="information-circle">{note}</Banner>}
        </Card>
      ) : (
        <Banner tone="info" icon="sparkles">
          <Text style={{ color: C.text, fontWeight: '700' }}>
            AI found {queue.length} task{queue.length === 1 ? '' : 's'}. Reviewing {index + 1} of {queue.length}.
          </Text>
        </Banner>
      )}

      <TaskForm
        key={formKey}
        initial={initial}
        flagged={flagged}
        question={current?.question}
        timeChosen={!!current?.due_time}
        submitLabel={current ? 'Looks right, save it' : 'Save task'}
        onSubmit={save}
        secondary={
          current ? <Button title={index + 1 < queue.length ? 'Skip this one' : 'Skip and finish'} kind="ghost" onPress={advance} /> : null
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  reading: { flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center', gap: S.md, padding: S.xl },
  readingText: { fontSize: 18, fontWeight: '800', color: C.text },
  scanTitle: { fontSize: 17, fontWeight: '800', color: C.text },
  row: { flexDirection: 'row', gap: S.sm },
});
