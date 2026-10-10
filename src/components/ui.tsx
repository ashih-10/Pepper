/** Small shared UI kit: buttons, chips, fields, cards, dialogs. */
import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps, ReactNode } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { C, R, S } from '@/lib/theme';

export type IconName = ComponentProps<typeof Ionicons>['name'];

export function Screen({
  children,
  scroll = true,
  padded = true,
  edges = ['top'],
}: {
  children: ReactNode;
  scroll?: boolean;
  padded?: boolean;
  edges?: ('top' | 'bottom')[];
}) {
  const inner = <View style={[styles.inner, padded && styles.padded]}>{children}</View>;
  return (
    <SafeAreaView style={styles.screen} edges={edges}>
      {scroll ? (
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {inner}
        </ScrollView>
      ) : (
        inner
      )}
    </SafeAreaView>
  );
}

export function H1({ children }: { children: ReactNode }) {
  return <Text style={styles.h1}>{children}</Text>;
}

export function H2({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <View style={styles.h2Row}>
      <Text style={styles.h2}>{children}</Text>
      {right}
    </View>
  );
}

export function Muted({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <Text style={[styles.muted, style as object]}>{children}</Text>;
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Button({
  title,
  onPress,
  kind = 'primary',
  icon,
  busy,
  disabled,
  style,
}: {
  title: string;
  onPress: () => void;
  kind?: 'primary' | 'secondary' | 'ghost' | 'danger';
  icon?: IconName;
  busy?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const fg = kind === 'primary' || kind === 'danger' ? '#fff' : kind === 'ghost' ? C.primary : C.text;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [
        styles.button,
        styles[`btn_${kind}`],
        (pressed || disabled) && { opacity: disabled ? 0.45 : 0.8 },
        style,
      ]}>
      {busy ? (
        <ActivityIndicator color={fg} />
      ) : (
        <>
          {icon && <Ionicons name={icon} size={18} color={fg} />}
          <Text style={[styles.buttonText, { color: fg }]}>{title}</Text>
        </>
      )}
    </Pressable>
  );
}

export function Chip({
  label,
  selected,
  onPress,
  color,
  icon,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  color?: string;
  icon?: IconName;
}) {
  const accent = color ?? C.primary;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.chip, selected && { backgroundColor: accent, borderColor: accent }]}>
      {color && !selected && <View style={[styles.dot, { backgroundColor: color }]} />}
      {icon && <Ionicons name={icon} size={14} color={selected ? '#fff' : C.muted} />}
      <Text style={[styles.chipText, selected && { color: '#fff' }]}>{label}</Text>
    </Pressable>
  );
}

export function ChipRow({ children }: { children: ReactNode }) {
  return <View style={styles.chipRow}>{children}</View>;
}

export function Field({
  label,
  flagged,
  hint,
  ...props
}: TextInputProps & { label: string; flagged?: boolean; hint?: string }) {
  return (
    <View style={styles.field}>
      <Label flagged={flagged}>{label}</Label>
      <TextInput
        placeholderTextColor={C.faint}
        {...props}
        style={[styles.input, flagged && styles.flagged, props.multiline && { minHeight: 80, textAlignVertical: 'top' }]}
      />
      {hint && <Muted>{hint}</Muted>}
    </View>
  );
}

export function Label({ children, flagged }: { children: ReactNode; flagged?: boolean }) {
  return (
    <Text style={[styles.label, flagged && { color: C.warn }]}>
      {children}
      {flagged ? '  ⚠️ check this' : ''}
    </Text>
  );
}

export function Banner({
  tone = 'info',
  icon,
  children,
  action,
}: {
  tone?: 'info' | 'warn' | 'hot';
  icon?: IconName;
  children: ReactNode;
  action?: ReactNode;
}) {
  const bg = tone === 'warn' ? C.warnSoft : tone === 'hot' ? C.primarySoft : C.infoSoft;
  const fg = tone === 'warn' ? C.warn : tone === 'hot' ? C.primaryDark : C.info;
  return (
    <View style={[styles.banner, { backgroundColor: bg }]}>
      <View style={styles.bannerRow}>
        {icon && <Ionicons name={icon} size={18} color={fg} />}
        <View style={{ flex: 1 }}>{typeof children === 'string' ? <Text style={{ color: C.text }}>{children}</Text> : children}</View>
      </View>
      {action}
    </View>
  );
}

export function Empty({ emoji, title, body }: { emoji: string; title: string; body?: string }) {
  return (
    <View style={styles.empty}>
      <Text style={{ fontSize: 40 }}>{emoji}</Text>
      <Text style={styles.emptyTitle}>{title}</Text>
      {body && <Muted style={{ textAlign: 'center' } as ViewStyle}>{body}</Muted>}
    </View>
  );
}

export function Loading() {
  return (
    <View style={[styles.screen, { justifyContent: 'center', alignItems: 'center' }]}>
      <Text style={{ fontSize: 40, marginBottom: S.md }}>🌶️</Text>
      <ActivityIndicator color={C.primary} />
    </View>
  );
}

/** Cross-platform yes/no dialog. */
export function confirm(title: string, message: string, okLabel = 'OK', destructive = false): Promise<boolean> {
  if (Platform.OS === 'web') return Promise.resolve(window.confirm(`${title}\n\n${message}`));
  return new Promise((resolve) =>
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: okLabel, style: destructive ? 'destructive' : 'default', onPress: () => resolve(true) },
    ]),
  );
}

/** Cross-platform message dialog. */
export function tell(title: string, message?: string) {
  if (Platform.OS === 'web') window.alert(message ? `${title}\n\n${message}` : title);
  else Alert.alert(title, message);
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  scroll: { flexGrow: 1 },
  inner: { flex: 1, width: '100%', maxWidth: 720, alignSelf: 'center' },
  padded: { padding: S.lg, gap: S.md },
  h1: { fontSize: 28, fontWeight: '800', color: C.text },
  h2Row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: S.sm },
  h2: { fontSize: 17, fontWeight: '700', color: C.text },
  muted: { color: C.muted, fontSize: 14, lineHeight: 20 },
  card: {
    backgroundColor: C.card,
    borderRadius: R.lg,
    padding: S.lg,
    borderWidth: 1,
    borderColor: C.border,
    gap: S.sm,
  },
  button: {
    minHeight: 48,
    borderRadius: R.md,
    paddingHorizontal: S.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: S.sm,
  },
  btn_primary: { backgroundColor: C.primary },
  btn_secondary: { backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  btn_ghost: { backgroundColor: 'transparent' },
  btn_danger: { backgroundColor: C.danger },
  buttonText: { fontSize: 16, fontWeight: '700' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: S.md,
    minHeight: 36,
    borderRadius: R.pill,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.card,
  },
  chipText: { color: C.text, fontWeight: '600', fontSize: 14 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: S.sm },
  dot: { width: 10, height: 10, borderRadius: 5 },
  field: { gap: 6 },
  label: { fontWeight: '700', color: C.text, fontSize: 14 },
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
  flagged: { borderColor: C.warn, borderWidth: 2, backgroundColor: C.warnSoft },
  banner: { borderRadius: R.md, padding: S.md, gap: S.sm },
  bannerRow: { flexDirection: 'row', gap: S.sm, alignItems: 'flex-start' },
  empty: { alignItems: 'center', padding: S.xl, gap: S.sm },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: C.text },
});
