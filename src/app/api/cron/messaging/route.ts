// ---------- Cron endpoint — يشغّل محرك الرسائل التلقائية ----------
// Calls `messaging_tick(true)` with the service role so time-based automations
// (birthdays, absence follow-ups, reminders…) and deferred quiet-hour deliveries
// are processed even when nobody has the app open.
//
// Schedule: `vercel.json` hits this every 5 minutes. When pg_cron is available on
// the Supabase project it already runs the tick — this route is a safe fallback
// (the tick is advisory-locked and idempotent, so double-runs are harmless).
//
// Security: requires `Authorization: Bearer <CRON_SECRET>` (Vercel adds it
// automatically for scheduled invocations) or `?secret=<CRON_SECRET>`.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get('authorization') ?? '';
  if (header === `Bearer ${secret}`) return true;
  return req.nextUrl.searchParams.get('secret') === secret;
}

async function run(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return NextResponse.json({ ok: false, error: 'supabase env missing' }, { status: 500 });
  }
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const started = Date.now();
  const { data, error } = await supabase.rpc('messaging_tick', { p_force: true });
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, ms: Date.now() - started, result: data ?? null });
}

export async function GET(req: NextRequest) { return run(req); }
export async function POST(req: NextRequest) { return run(req); }
