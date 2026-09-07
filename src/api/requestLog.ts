import { useSyncExternalStore } from 'react';

/**
 * In-memory ring buffer of API requests for the in-app debug screen. Captures
 * method, url, status, timing, request body and response data so failures (e.g.
 * a 500 on sign-up) can be inspected on-device. Auth headers/tokens are NEVER
 * stored, and the headless login POST doesn't go through apiRequest, so no
 * passwords are logged.
 */
export type LogEntry = {
  id: number;
  ts: number;
  method: string;
  url: string;
  status?: number;
  ok?: boolean;
  durationMs?: number;
  requestBody?: unknown;
  responseData?: unknown;
  error?: string;
};

const MAX = 200;
let logs: LogEntry[] = [];
let seq = 1;
const listeners = new Set<() => void>();

export function addLog(entry: Omit<LogEntry, 'id'>): void {
  const e: LogEntry = { ...entry, id: seq++ };
  logs = [e, ...logs].slice(0, MAX);
  listeners.forEach((l) => l());
}

export function getLogs(): LogEntry[] {
  return logs;
}

export function clearLogs(): void {
  logs = [];
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Live view of the request log for React components. */
export function useRequestLogs(): LogEntry[] {
  return useSyncExternalStore(subscribe, getLogs, getLogs);
}
