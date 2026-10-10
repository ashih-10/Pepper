/** Add, rename, recolor, reorder and delete classes. */
import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import * as api from '@/lib/api';
import { errorMessage } from '@/lib/supabase';
import { C, CLASS_COLORS, R, S } from '@/lib/theme';
import type { ClassRow } from '@/lib/types';
import { usePlanner } from '@/state/planner';

import { Button, confirm, Muted, tell } from './ui';

export function ColorSwatches({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <View style={styles.swatches}>
      {CLASS_COLORS.map((c) => (
        <Pressable
          key={c}
          onPress={() => onChange(c)}
          accessibilityLabel={`Color ${c}`}
          accessibilityState={{ selected: value === c }}
          style={[styles.swatch, { backgroundColor: c }, value === c && styles.swatchSel]}>
          {value === c && <Ionicons name="checkmark" size={16} color="#fff" />}
        </Pressable>
      ))}
    </View>
  );
}

export function ClassEditor() {
  const { classes, refresh } = usePlanner();
  const nextColor = CLASS_COLORS.find((c) => !classes.some((k) => k.color === c)) ?? CLASS_COLORS[classes.length % CLASS_COLORS.length];
  const [name, setName] = useState('');
  const [color, setColor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  async function add() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await api.addClass(name, color ?? nextColor, classes.length);
      setName('');
      setColor(null);
      await refresh();
    } catch (e) {
      tell('Could not add class', errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function move(c: ClassRow, dir: -1 | 1) {
    const i = classes.findIndex((k) => k.id === c.id);
    const j = i + dir;
    if (j < 0 || j >= classes.length) return;
    const order = [...classes];
    [order[i], order[j]] = [order[j], order[i]];
    await Promise.all(order.map((k, idx) => (k.position === idx ? null : api.updateClass(k.id, { position: idx }))));
    await refresh();
  }

  async function remove(c: ClassRow) {
    if (!(await confirm(`Delete ${c.name}?`, 'Tasks in this class stay, but lose their color.', 'Delete', true))) return;
    try {
      await api.deleteClass(c.id);
      await refresh();
    } catch (e) {
      tell('Could not delete class', errorMessage(e));
    }
  }

  return (
    <View style={{ gap: S.sm }}>
      {classes.map((c, i) => (
        <View key={c.id} style={styles.rowWrap}>
          <View style={styles.row}>
            <Pressable onPress={() => setEditing(editing === c.id ? null : c.id)} accessibilityLabel={`Change ${c.name} color`}>
              <View style={[styles.bigDot, { backgroundColor: c.color }]} />
            </Pressable>
            <ClassName cls={c} onSaved={refresh} />
            <Pressable hitSlop={8} disabled={i === 0} onPress={() => move(c, -1)} accessibilityLabel="Move up">
              <Ionicons name="chevron-up" size={20} color={i === 0 ? C.border : C.muted} />
            </Pressable>
            <Pressable hitSlop={8} disabled={i === classes.length - 1} onPress={() => move(c, 1)} accessibilityLabel="Move down">
              <Ionicons name="chevron-down" size={20} color={i === classes.length - 1 ? C.border : C.muted} />
            </Pressable>
            <Pressable hitSlop={8} onPress={() => remove(c)} accessibilityLabel={`Delete ${c.name}`}>
              <Ionicons name="trash-outline" size={20} color={C.danger} />
            </Pressable>
          </View>
          {editing === c.id && (
            <ColorSwatches
              value={c.color}
              onChange={(col) => {
                setEditing(null);
                api.updateClass(c.id, { color: col }).then(refresh).catch(() => {});
              }}
            />
          )}
        </View>
      ))}
      {classes.length === 0 && <Muted>No classes yet. Add your first one below.</Muted>}

      <View style={styles.addBox}>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Class name, e.g. AP Chemistry"
          placeholderTextColor={C.faint}
          style={styles.input}
          onSubmitEditing={add}
          returnKeyType="done"
        />
        <ColorSwatches value={color ?? nextColor} onChange={setColor} />
        <Button title="Add class" icon="add" onPress={add} busy={busy} disabled={!name.trim()} />
      </View>
    </View>
  );
}

function ClassName({ cls, onSaved }: { cls: ClassRow; onSaved: () => Promise<void> }) {
  const [value, setValue] = useState(cls.name);
  function save() {
    const v = value.trim();
    if (!v) return setValue(cls.name);
    if (v !== cls.name) api.updateClass(cls.id, { name: v }).then(onSaved).catch(() => setValue(cls.name));
  }
  return (
    <TextInput
      value={value}
      onChangeText={setValue}
      onBlur={save}
      onSubmitEditing={save}
      accessibilityLabel="Class name"
      style={styles.nameInput}
    />
  );
}

const styles = StyleSheet.create({
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: S.sm },
  swatch: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  swatchSel: { borderWidth: 3, borderColor: C.text },
  rowWrap: { backgroundColor: C.card, borderRadius: R.md, borderWidth: 1, borderColor: C.border, padding: S.md, gap: S.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: S.md },
  bigDot: { width: 24, height: 24, borderRadius: 12 },
  nameInput: { flex: 1, fontSize: 16, fontWeight: '600', color: C.text, paddingVertical: 4 },
  addBox: { gap: S.sm, padding: S.md, borderRadius: R.md, borderWidth: 1, borderStyle: 'dashed', borderColor: C.faint },
  input: {
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: R.md,
    paddingHorizontal: S.md,
    paddingVertical: 12,
    fontSize: 16,
    color: C.text,
  },
});
