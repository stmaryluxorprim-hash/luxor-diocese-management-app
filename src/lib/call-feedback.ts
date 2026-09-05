// ---------- Call feedback — follow-up cycle logic (pure, no React) ----------
//
// A servant calls a child as a follow-up for an EVENT OCCURRENCE (e.g. the
// absentees of Friday's mass are called during the week). The outcome is a
// CALL FEEDBACK (migration 0023) stored in `contact_log` with
// `feedback_id` + `occurrence_on`.
//
// The follow-up CYCLE (فترة الافتقاد) of an occurrence runs from that
// occurrence's start until the NEXT occurrence starts.
//
// TWO CLOCKS decide the badge:
//   • the WORKING date (the frozen/override date the servant may set from the
//     header) is the SECONDARY player — it only chooses WHICH occurrence the
//     badge is about (the occurrence whose cycle contains the working time);
//   • the REAL date is the MAIN player — it decides whether that occurrence's
//     cycle is still OPEN (real time is inside it) or has CLOSED (the next
//     occurrence has already started in real time). A closed cycle is final:
//     its feedback can no longer be recorded or changed.
//
// The badge on a child's card shows:
//   feedback        → the latest feedback recorded for the occurrence
//   not_called_yet  → «لم يُفتقد بعد» — no feedback and the cycle is open
//                     (or hasn't started yet — working date in the future)
//   wasnt_called    → «لم يُفتقد» — no feedback and the cycle is CLOSED in
//                     real time (e.g. the working date is frozen before the
//                     last occurrence): the child was never followed up.

import type { CSSProperties } from 'react';
import type { AppEvent, CallFeedback } from './types';
import { cairoToday, currentOccurrence, previousOccurrenceDate } from './time';

export type CallFeedbackStateKind = 'not_called_yet' | 'wasnt_called' | 'feedback';

export type CallFeedbackState =
  | { kind: 'not_called_yet' }
  | { kind: 'wasnt_called' }
  | { kind: 'feedback'; feedback: CallFeedback };

export const CALL_STATE_LABELS: Record<Exclude<CallFeedbackStateKind, 'feedback'>, string> = {
  not_called_yet: 'لم يُفتقد بعد',
  wasnt_called: 'لم يُفتقد',
};
/** Compact labels for the card badge — 4 badges share one row on a phone, so
 *  «لم يُفتقد بعد» would be clipped; the full label stays in the tooltip,
 *  aria-label, filter chips and the modal. */
export const CALL_STATE_SHORT_LABELS: Record<Exclude<CallFeedbackStateKind, 'feedback'>, string> = {
  not_called_yet: 'بالانتظار',
  wasnt_called: 'لم يُفتقد',
};

/** Lifecycle of the occurrence's follow-up cycle, judged by the REAL clock. */
export type FollowUpStatus =
  | 'open'     // real time is inside this occurrence's cycle → feedback can be recorded / changed
  | 'closed'   // the next occurrence already started in real time → final, read-only
  | 'future';  // the occurrence hasn't started yet in real time → nothing to record yet

/** Which occurrence the badge refers to, and whether its cycle is still open. */
export interface FollowUpCycle {
  /** Cairo day of the occurrence the WORKING date falls in (feedbacks are read/recorded on it) */
  target: string;
  /** Cairo day of the occurrence whose cycle is open in REAL time */
  realTarget: string;
  /** open / closed / future — see FollowUpStatus */
  status: FollowUpStatus;
  /** true when `target` predates the event's creation day (the event didn't exist → no badge) */
  beforeCreation: boolean;
}

/**
 * The occurrence whose follow-up cycle contains instant `at`.
 *
 *  once   → the single occurrence, for its whole life (before, during, after).
 *  weekly → the latest occurrence that has STARTED. On an event day before
 *           start_time the previous week's occurrence is still the one
 *           ("the next event hasn't started yet").
 */
export function cycleOccurrence(ev: AppEvent, at: Date): string {
  const occ = currentOccurrence(ev, at);
  if (!occ) return cairoToday(at); // undated legacy event
  if (ev.recurrence === 'once') return occ.date;
  if (occ.phase === 'upcoming') return previousOccurrenceDate(ev, occ.date) ?? occ.date;
  return occ.date;
}

/**
 * Compute the follow-up cycle of `ev`:
 *  - `working` (the app's working / frozen date) picks the occurrence,
 *  - `real`    (the live clock) decides whether that cycle is open, closed
 *              or not started yet.
 * When the servant hasn't frozen the date both are the same instant and the
 * cycle is simply the open one.
 */
export function followUpCycle(ev: AppEvent, working: Date = new Date(), real: Date = new Date()): FollowUpCycle {
  const target = cycleOccurrence(ev, working);
  const realTarget = cycleOccurrence(ev, real);
  const status: FollowUpStatus =
    target === realTarget ? 'open' : target < realTarget ? 'closed' : 'future';
  const beforeCreation = !!ev.created_at && target < cairoToday(new Date(ev.created_at));
  return { target, realTarget, status, beforeCreation };
}

/** Feedbacks recorded for one enrollment: occurrence day → feedback id (latest) */
export type EnrollmentFeedbackDays = Record<string, string>;

/** Resolve the badge state of one child from the recorded feedbacks. */
export function callFeedbackState(
  cycle: FollowUpCycle,
  recorded: EnrollmentFeedbackDays | undefined,
  feedbacksById: Map<string, CallFeedback>
): CallFeedbackState {
  const currentId = recorded?.[cycle.target];
  if (currentId) {
    const fb = feedbacksById.get(currentId);
    if (fb) return { kind: 'feedback', feedback: fb };
    // feedback deleted from settings → fall through as if not recorded
  }
  // No feedback: the REAL clock decides — a closed cycle means the child was
  // never followed up for that occurrence; open / future = still pending.
  if (cycle.status === 'closed') return { kind: 'wasnt_called' };
  return { kind: 'not_called_yet' };
}

/** Can a feedback be recorded / changed for this cycle? Only while it is open in real time. */
export const canRecordFeedback = (cycle: FollowUpCycle) => cycle.status === 'open' && !cycle.beforeCreation;

/** Build the per-enrollment map from contact_log rows (newest first wins). */
export function indexFeedbackRows(
  rows: { enrollment_id: string; occurrence_on: string | null; feedback_id: string | null; created_at: string }[]
): Record<string, EnrollmentFeedbackDays> {
  const out: Record<string, EnrollmentFeedbackDays> = {};
  const seenAt: Record<string, string> = {};
  for (const r of rows) {
    if (!r.feedback_id || !r.occurrence_on) continue;
    const key = `${r.enrollment_id}|${r.occurrence_on}`;
    if (seenAt[key] && seenAt[key] >= r.created_at) continue;
    seenAt[key] = r.created_at;
    (out[r.enrollment_id] ??= {})[r.occurrence_on] = r.feedback_id;
  }
  return out;
}

/** Key used by the feedback filter chips: 'all' | state kind | 'fb:<id>' */
export type CallFeedbackFilter = 'all' | 'not_called_yet' | 'wasnt_called' | `fb:${string}`;

export function matchesCallFilter(state: CallFeedbackState | null, filter: CallFeedbackFilter): boolean {
  if (filter === 'all') return true;
  if (!state) return false;
  if (filter.startsWith('fb:')) return state.kind === 'feedback' && state.feedback.id === filter.slice(3);
  return state.kind === filter;
}

// ---------- Icon registry (keys stored in call_feedbacks.icon) ----------
// The component layer maps these keys to lucide icons; keeping the list
// here lets settings validate a key without importing React.
export const CALL_FEEDBACK_ICON_KEYS = [
  'phone', 'phone-call', 'phone-missed', 'phone-off', 'voicemail',
  'check', 'x', 'circle-help', 'triangle-alert', 'ban', 'clock', 'hourglass', 'refresh-cw',
  'thumbs-up', 'thumbs-down', 'heart', 'smile', 'meh', 'frown',
  'thermometer', 'stethoscope', 'pill', 'bed', 'hospital',
  'plane', 'car', 'bus', 'map-pin', 'house', 'moon',
  'graduation-cap', 'book-open', 'briefcase', 'users', 'baby',
  'church', 'gift', 'party-popper', 'sparkles', 'message-circle',
] as const;
export type CallFeedbackIconKey = (typeof CALL_FEEDBACK_ICON_KEYS)[number];

export const isFeedbackIconKey = (k: string): k is CallFeedbackIconKey =>
  (CALL_FEEDBACK_ICON_KEYS as readonly string[]).includes(k);

// ---------- Presentation helpers (colors) ----------

/** Preset palette offered in the settings color picker */
export const CALL_FEEDBACK_COLORS: string[] = [
  '#10b981', '#22c55e', '#84cc16', '#eab308', '#f59e0b', '#f97316',
  '#ef4444', '#e11d48', '#ec4899', '#d946ef', '#a855f7', '#6366f1',
  '#3b82f6', '#0ea5e9', '#06b6d4', '#14b8a6', '#64748b', '#334155',
];

export const isHexColor = (c: string) => /^#[0-9a-f]{6}$/i.test(c.trim());

/** Is the color dark enough to need white text on top of it? */
export function isDarkColor(hex: string): boolean {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return true;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; // sRGB approximation
  return lum < 0.6;
}

/** Inline style for a solid badge / button in the feedback color */
export function feedbackStyle(color: string): CSSProperties {
  return { backgroundColor: color, color: isDarkColor(color) ? '#ffffff' : '#0f172a' };
}

/** Inline style for a pale (tinted) surface in the feedback color */
export function feedbackTintStyle(color: string): CSSProperties {
  return { backgroundColor: `${color}1f`, color, borderColor: `${color}66` };
}
