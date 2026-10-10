/** Day strip (Today screen) and month grid (Calendar tab + date picker). */
import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { addDays, dayKey, monthLong, sameDay, startOfDay, weekdayShort } from '@/lib/dates';
import { C, R, S } from '@/lib/theme';

/** Colored dots for a day: one per task (max 4), in class colors. */
export type DotsByDay = Map<string, string[]>;

export function DayStrip({
  selected,
  onSelect,
  today,
  dots,
}: {
  selected: Date;
  onSelect: (d: Date) => void;
  today: Date;
  dots: DotsByDay;
}) {
  const start = startOfDay(today);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  return (
    <View style={styles.strip}>
      {days.map((d) => {
        const isSel = sameDay(d, selected);
        const colors = dots.get(dayKey(d)) ?? [];
        return (
          <Pressable
            key={dayKey(d)}
            onPress={() => onSelect(d)}
            accessibilityLabel={`${weekdayShort(d)} ${d.getDate()}, ${colors.length} tasks`}
            style={[styles.stripDay, isSel && styles.stripSel]}>
            <Text style={[styles.stripWd, isSel && { color: '#fff' }]}>{sameDay(d, today) ? 'Today' : weekdayShort(d)}</Text>
            <Text style={[styles.stripNum, isSel && { color: '#fff' }]}>{d.getDate()}</Text>
            <Dots colors={colors} light={isSel} />
          </Pressable>
        );
      })}
    </View>
  );
}

function Dots({ colors, light }: { colors: string[]; light?: boolean }) {
  return (
    <View style={styles.dots}>
      {colors.slice(0, 4).map((c, i) => (
        <View key={i} style={[styles.dot, { backgroundColor: c }, light && { borderWidth: 1, borderColor: '#fff' }]} />
      ))}
      {colors.length > 4 && <Text style={[styles.more, light && { color: '#fff' }]}>+</Text>}
    </View>
  );
}

export function MonthGrid({
  month,
  onMonth,
  selected,
  onSelect,
  today,
  dots,
  minDate,
}: {
  month: Date;
  onMonth: (d: Date) => void;
  selected: Date | null;
  onSelect: (d: Date) => void;
  today: Date;
  dots?: DotsByDay;
  minDate?: Date;
}) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const gridStart = addDays(first, -first.getDay());
  const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const weeks = Array.from({ length: 6 }, (_, w) => cells.slice(w * 7, w * 7 + 7)).filter((wk) =>
    wk.some((d) => d.getMonth() === month.getMonth()),
  );
  return (
    <View style={styles.month}>
      <View style={styles.monthHead}>
        <Pressable hitSlop={10} onPress={() => onMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>
          <Ionicons name="chevron-back" size={22} color={C.text} />
        </Pressable>
        <Text style={styles.monthTitle}>
          {monthLong(month.getMonth())} {month.getFullYear()}
        </Text>
        <Pressable hitSlop={10} onPress={() => onMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>
          <Ionicons name="chevron-forward" size={22} color={C.text} />
        </Pressable>
      </View>
      <View style={styles.week}>
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((w, i) => (
          <Text key={i} style={styles.wd}>
            {w}
          </Text>
        ))}
      </View>
      {weeks.map((wk, wi) => (
        <View key={wi} style={styles.week}>
          {wk.map((d) => {
            const inMonth = d.getMonth() === month.getMonth();
            const isSel = selected && sameDay(d, selected);
            const isToday = sameDay(d, today);
            const disabled = minDate ? d < startOfDay(minDate) : false;
            return (
              <Pressable
                key={dayKey(d)}
                disabled={disabled}
                onPress={() => onSelect(d)}
                style={[styles.cell, isSel && styles.cellSel, disabled && { opacity: 0.3 }]}>
                <Text
                  style={[
                    styles.cellNum,
                    !inMonth && { color: C.faint },
                    isToday && !isSel && { color: C.primary, fontWeight: '900' },
                    isSel && { color: '#fff' },
                  ]}>
                  {d.getDate()}
                </Text>
                {dots && <Dots colors={dots.get(dayKey(d)) ?? []} light={!!isSel} />}
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  strip: { flexDirection: 'row', gap: 6 },
  stripDay: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: S.sm,
    borderRadius: R.md,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    gap: 2,
  },
  stripSel: { backgroundColor: C.primary, borderColor: C.primary },
  stripWd: { fontSize: 11, color: C.muted, fontWeight: '700' },
  stripNum: { fontSize: 18, fontWeight: '800', color: C.text },
  dots: { flexDirection: 'row', gap: 2, height: 8, alignItems: 'center' },
  dot: { width: 6, height: 6, borderRadius: 3 },
  more: { fontSize: 9, color: C.muted, lineHeight: 9 },
  month: { backgroundColor: C.card, borderRadius: R.lg, padding: S.md, borderWidth: 1, borderColor: C.border, gap: 4 },
  monthHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: S.sm },
  monthTitle: { fontSize: 17, fontWeight: '800', color: C.text },
  week: { flexDirection: 'row' },
  wd: { flex: 1, textAlign: 'center', fontSize: 12, color: C.muted, fontWeight: '700' },
  cell: { flex: 1, alignItems: 'center', paddingVertical: 6, borderRadius: R.sm, gap: 2, minHeight: 44 },
  cellSel: { backgroundColor: C.primary },
  cellNum: { fontSize: 15, color: C.text, fontWeight: '600' },
});
