// ─── types ──────────────────────────────────────────────────────────────────

export type EventType =
  | "auth_success"
  | "auth_failed"
  | "tool_allowed"
  | "tool_denied"
  | "policy_updated"
  | "agent_added"
  | "agent_removed";

export type EventResult = "allowed" | "denied" | "info";

export interface EventEntry {
  timestamp: string;
  type: EventType;
  ensName?: string;
  address?: string;
  tool?: string;
  result: EventResult;
  reason?: string;
}

// ─── store ──────────────────────────────────────────────────────────────────

const MAX_EVENTS = 500;
const events: EventEntry[] = [];

// ─── public API ─────────────────────────────────────────────────────────────

export function addEvent(
  entry: Omit<EventEntry, "timestamp"> & { timestamp?: string },
): void {
  const full: EventEntry = {
    timestamp: entry.timestamp ?? new Date().toISOString(),
    ...entry,
  };
  events.push(full);
  // keep bounded
  if (events.length > MAX_EVENTS) {
    events.splice(0, events.length - MAX_EVENTS);
  }
}

export function getRecentEvents(limit = 50): EventEntry[] {
  return events.slice(-limit).reverse();
}
