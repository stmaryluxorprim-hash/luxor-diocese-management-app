'use client';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { EnrollmentWithPerson } from '@/lib/types';

export const ALL = 'all';

/**
 * Columns the list screens (and their view/edit modals) actually use.
 * Audit columns (created_by / edited_*) are excluded — ~30% smaller rows.
 */
export const ENROLLMENT_LIST_SELECT =
  'id, person_id, church_id, service_id, class_id, attendance_count, points, created_at, ' +
  'person:persons(id, national_id, name, birthdate, gender, phone, address, notes, image_url)';

export interface ScopeSelection {
  church?: string; // ALL | uuid
  service?: string;
  class?: string;
}

/** Hard cap so a runaway query can never pull the whole diocese. */
export const PAGE_SIZE = 200;

/**
 * Fetch enrollments (with the embedded person) for the selected scope,
 * paginated. Filtering happens IN THE DATABASE (indexed columns), so a class
 * servant transfers ~30 rows instead of the entire table.
 *
 * `search` uses PostgREST `or` over the FK-embedded table via `!inner`, so
 * name / phone / national-id search is also server-side.
 */
export async function fetchEnrollmentsPage(
  supabase: SupabaseClient,
  scope: ScopeSelection,
  opts: { page?: number; pageSize?: number; search?: string } = {}
): Promise<{ rows: EnrollmentWithPerson[]; hasMore: boolean }> {
  const page = opts.page ?? 0;
  const size = opts.pageSize ?? PAGE_SIZE;
  const search = (opts.search ?? '').trim();

  const select = search
    ? ENROLLMENT_LIST_SELECT.replace('person:persons(', 'person:persons!inner(')
    : ENROLLMENT_LIST_SELECT;

  let q = supabase.from('enrollments').select(select);
  if (scope.church && scope.church !== ALL) q = q.eq('church_id', scope.church);
  if (scope.service && scope.service !== ALL) q = q.eq('service_id', scope.service);
  if (scope.class && scope.class !== ALL) q = q.eq('class_id', scope.class);
  if (search) {
    const s = search.replace(/[,()]/g, ' ');
    // Filters on an embedded resource address it by its ALIAS (`person`).
    q = q.or(`name.ilike.%${s}%,phone.ilike.%${s}%,national_id.ilike.%${s}%`, {
      referencedTable: 'person',
    });
  }
  // Server-side sort by class then person name keeps the per-class groups
  // contiguous; fetch one extra row to know whether there is a next page.
  // `person(name)` orders the PARENT rows by the to-one embedded column
  // (PostgREST ≥ 9); `id` last makes the order total → stable pagination.
  q = q
    .order('class_id')
    .order('person(name)')
    .order('id')
    .range(page * size, page * size + size);

  const { data, error } = await q;
  if (error) throw error;
  const list = ((data ?? []) as unknown as EnrollmentWithPerson[]).filter((e) => e.person);
  const hasMore = list.length > size;
  return { rows: hasMore ? list.slice(0, size) : list, hasMore };
}

/**
 * Fetch ALL enrollments of a scope in pages (used by the printing tabs,
 * which genuinely need the complete scoped set). Still filtered
 * server-side, and never more than `maxRows`.
 */
export async function fetchAllEnrollments(
  supabase: SupabaseClient,
  scope: ScopeSelection,
  maxRows = 5000
): Promise<EnrollmentWithPerson[]> {
  const out: EnrollmentWithPerson[] = [];
  let page = 0;
  // 1000 is PostgREST's default max-rows; stay under it.
  const size = 1000;
  while (out.length < maxRows) {
    const { rows, hasMore } = await fetchEnrollmentsPage(supabase, scope, { page, pageSize: size });
    out.push(...rows);
    if (!hasMore) break;
    page++;
  }
  return out.slice(0, maxRows);
}

/**
 * Tiny lookup tables (churches / services / classes) rarely change; cache
 * them per session so navigating between tabs doesn't re-request them.
 */
const lookupCache = new Map<string, { at: number; data: unknown[] }>();
const LOOKUP_TTL_MS = 60_000;

export async function cachedLookup<T>(
  supabase: SupabaseClient,
  table: 'churches' | 'services' | 'classes' | 'events' | 'causes',
  orderBy: { column: string; ascending?: boolean; nullsFirst?: boolean } = { column: 'name' },
  force = false
): Promise<T[]> {
  const key = table;
  const hit = lookupCache.get(key);
  if (!force && hit && Date.now() - hit.at < LOOKUP_TTL_MS) return hit.data as T[];
  const { data } = await supabase
    .from(table)
    .select('*')
    .order(orderBy.column, { ascending: orderBy.ascending ?? true, nullsFirst: orderBy.nullsFirst });
  const rows = (data ?? []) as T[];
  lookupCache.set(key, { at: Date.now(), data: rows });
  return rows;
}

export function invalidateLookup(table?: string) {
  if (table) lookupCache.delete(table);
  else lookupCache.clear();
}
