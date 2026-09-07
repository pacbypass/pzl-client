import React, { useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import {
  Appbar,
  Card,
  Chip,
  Divider,
  Text,
  useTheme,
} from 'react-native-paper';
import { clearLogs, useRequestLogs, type LogEntry } from '@/api/requestLog';

function statusColor(e: LogEntry, primary: string, outline: string): string {
  if (e.error) return '#b00020';
  const s = e.status ?? 0;
  if (s >= 500) return '#b00020';
  if (s >= 400) return '#e65100';
  if (s >= 200 && s < 300) return primary;
  return outline;
}

function time(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function shortUrl(url: string): string {
  return url.replace(/^https?:\/\/[^/]+/, '').split('?')[0];
}

function pretty(v: unknown): string {
  if (v == null) return '—';
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function LogRow({ entry }: { entry: LogEntry }) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const color = statusColor(entry, theme.colors.primary, theme.colors.outline);
  const label = entry.error ? 'ERR' : String(entry.status ?? '—');

  return (
    <Card mode="outlined" style={styles.card} onPress={() => setOpen((o) => !o)}>
      <Card.Content style={styles.rowContent}>
        <View style={styles.headerRow}>
          <Chip compact textStyle={styles.statusText} style={[styles.statusChip, { backgroundColor: color }]}>
            {label}
          </Chip>
          <Text variant="labelLarge" style={styles.method}>
            {entry.method}
          </Text>
          <Text variant="bodySmall" style={styles.time}>
            {time(entry.ts)}
            {entry.durationMs != null ? ` · ${entry.durationMs}ms` : ''}
          </Text>
        </View>
        <Text variant="bodyMedium" style={styles.url} numberOfLines={open ? undefined : 1}>
          {open ? entry.url : shortUrl(entry.url)}
        </Text>

        {open ? (
          <View style={styles.details}>
            {entry.error ? (
              <>
                <Text variant="labelSmall" style={styles.sectionLabel}>
                  BŁĄD
                </Text>
                <Text variant="bodySmall" style={styles.mono} selectable>
                  {entry.error}
                </Text>
              </>
            ) : null}
            {entry.requestBody !== undefined ? (
              <>
                <Divider style={styles.divider} />
                <Text variant="labelSmall" style={styles.sectionLabel}>
                  REQUEST BODY
                </Text>
                <Text variant="bodySmall" style={styles.mono} selectable>
                  {pretty(entry.requestBody)}
                </Text>
              </>
            ) : null}
            <Divider style={styles.divider} />
            <Text variant="labelSmall" style={styles.sectionLabel}>
              RESPONSE
            </Text>
            <Text variant="bodySmall" style={styles.mono} selectable>
              {pretty(entry.responseData)}
            </Text>
          </View>
        ) : null}
      </Card.Content>
    </Card>
  );
}

export default function DebugScreen() {
  const theme = useTheme();
  const logs = useRequestLogs();

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
      <Appbar.Header mode="small" elevated>
        <Appbar.Content title="Debug — zapytania" subtitle={`${logs.length} ostatnich`} />
        <Appbar.Action icon="trash-can-outline" onPress={clearLogs} disabled={logs.length === 0} />
      </Appbar.Header>

      {logs.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.muted}>
            Brak zapytań. Wykonaj akcję w aplikacji, a pojawią się tutaj.
          </Text>
        </View>
      ) : (
        <FlatList
          data={logs}
          keyExtractor={(e) => String(e.id)}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => <LogRow entry={item} />}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  list: { padding: 12, gap: 8 },
  card: { borderRadius: 12 },
  rowContent: { gap: 4, paddingVertical: 8 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusChip: { height: 26 },
  statusText: { color: '#fff', fontWeight: '700', fontSize: 12, lineHeight: 16 },
  method: { fontWeight: '700' },
  time: { flex: 1, textAlign: 'right', opacity: 0.6 },
  url: { fontFamily: 'monospace' },
  details: { marginTop: 6, gap: 2 },
  sectionLabel: { opacity: 0.6, marginTop: 6 },
  divider: { marginTop: 6 },
  mono: { fontFamily: 'monospace', fontSize: 12 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  muted: { opacity: 0.6, textAlign: 'center' },
});
