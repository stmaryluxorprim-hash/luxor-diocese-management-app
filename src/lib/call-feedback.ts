// ---------- Call feedback — follow-up cycle logic (pure, no React) ----------
//
// A servant calls a child as a follow-up for an EVENT OCCURRENCE (e.g. the
// absentees of Friday's mass are called during the week). The outcome is a
// CALL FEEDBACK (migration 0023) stored in `contact_log` with
// `feedback_id` + `occurrence_on`.
//
// The follow-up CYCLE of an occurrence runs from that occurrence's start
// until the NEXT occurrence starts. The badge on a child's card shows:
//
//   feedback        → the latest feedback recorded for the cycle's occurrence
//   wasnt_called    → «لم يُتصل به» — the PREVIOUS cycle closed (the next
//                     occurrence has started) and nobody ever recorded a
//                     feedback for it. A warning carried into the new cycle
//                     until a feedback is recorded for the current occurrence.
//   not_called_yet  → «لم يُتصل به بعد» — the normal open state.

import type { CSSProperties } from 'react';
import type { AppEvent, CallFeedback } from './types';
import { cairoToday, currentOccurrence, previousOccurrenceDate } from './time';

export type CallFeedbackStateKind = 'not_called_yet' | 'wasnt_called' | 'feedback';

export type CallFeedbackState =
  | { kind: 'not_called_yet' }
  | { kind: 'wasnt_called' }
  | { kind: 'feedback'; feedback: CallFeedback };

export const CALL_STATE_LABELS: Record<Exclude<CallFeedbackStateKind, 'feedback'>, string> = {
  not_called_yet: 'لم يُتصل به بعد',
  wasnt_called: 'لم يُتصل به',
};

/** Which occurrences the badge refers to right now. */
export interface FollowUpCycle {
  /** Cairo day of the occurrence whose follow-up is OPEN (feedbacks are recorded on it) */
  target: string;
  /** Cairo day of the previous occurrence — a missing feedback there = «wasn't called».
   *  null for one-time events or when that occurrence predates the event itself. */
  previous: string | null;
}

/**
 * Compute the follow-up cycle of `ev` at instant `now`.
 *
 *  once   → the single occurrence is the target for its whole life
 *           (before, during and after the event); no previous.
 *  weekly → the latest occurrence that has STARTED is the target. On an
 *           event day before start_time the previous week's occurrence is
 *           still the target ("we haven't started the next event yet").
 *           `previous` is the occurrence before the target, ignored when it
 *           is older than the event's creation day (the event didn't exist
 *           → nobody could have been called).
 */
export function followUpCycle(ev: AppEvent, now: Date = new Date()): FollowUpCycle {
  const occ = currentOccurrence(ev, now);
  if (!occ) return { target: cairoToday(now), previous: null }; // undated legacy event
  if (ev.recurrence === 'once') return { target: occ.date, previous: null };

  let target = occ.date;
  if (occ.phase === 'upcoming') {
    target = previousOccurrenceDate(ev, occ.date) ?? occ.date;
  }
  let previous = previousOccurrenceDate(ev, target);
  if (previous && ev.created_at) {
    const createdDay = cairoToday(new Date(ev.created_at));
    if (previous < createdDay) previous = null;
  }
  return { target, previous };
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
  if (cycle.previous && !recorded?.[cycle.previous]) return { kind: 'wasnt_called' };
  return { kind: 'not_called_yet' };
}

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
