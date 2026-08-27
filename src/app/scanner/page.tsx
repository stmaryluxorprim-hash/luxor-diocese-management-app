'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  ScanLine, Camera, CameraOff, CheckCircle2, AlertCircle, Search, Star, Loader2, School, CalendarDays,
} from 'lucide-react';
import AppShell from '@/components/AppShell';
import { useAuth } from '@/lib/auth-context';
import { createClient } from '@/lib/supabase/client';
import type { EnrollmentWithPerson, Person, ClassRoom, AppEvent } from '@/lib/types';

type ScanResult = { type: 'ok' | 'dup' | 'err'; message: string };

export default function ScannerPage() {
  const { profile } = useAuth();
  const supabase = createClient();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanningRef = useRef(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [result, setResult] = useState<ScanResult | null>(null);
  const [search, setSearch] = useState('');
  const [enrollments, setEnrollments] = useState<EnrollmentWithPerson[]>([]);
  const [classes, setClasses] = useState<ClassRoom[]>([]);
  const [events, setEvents] = useState<AppEvent[]>([]);
  const [eventId, setEventId] = useState<string>('');
  const [busy, setBusy] = useState(false);

  // When a scanned person has multiple enrollments, let the servant pick
  const [picker, setPicker] = useState<{ person: Person; options: EnrollmentWithPerson[] } | null>(null);

  // Load enrollments (person-centric) for manual mode + scan resolution
  useEffect(() => {
    if (profile?.status !== 'approved') return;
    (async () => {
      const [{ data: enr }, { data: cls }, { data: evs }] = await Promise.all([
        supabase.from('enrollments').select('*, person:persons(*)'),
        supabase.from('classes').select('*'),
        supabase.from('events').select('*').order('event_date', { ascending: false, nullsFirst: false }),
      ]);
      const list = ((enr ?? []) as EnrollmentWithPerson[])
        .filter((e) => e.person)
        .sort((a, b) => a.person.name.localeCompare(b.person.name, 'ar'));
      setEnrollments(list);
      setClasses(cls ?? []);
      setEvents(evs ?? []);
    })();
  }, [profile, supabase]);

  const className = useCallback(
    (id: string) => classes.find((c) => c.id === id)?.name ?? 'فصل',
    [classes]
  );

  const recordAttendance = useCallback(
    async (e: EnrollmentWithPerson) => {
      // Attendance is registered against an EVENT of the enrollment's class
      const ev = events.find((x) => x.id === eventId);
      if (!ev) {
        setResult({ type: 'err', message: 'اختر المناسبة أولاً قبل المسح' });
        return;
      }
      if (ev.class_id !== e.class_id) {
        setResult({ type: 'err', message: `المناسبة المختارة لا تخص فصل ${e.person.name}` });
        return;
      }
      setBusy(true);
      setPicker(null);

      const { error } = await supabase.from('attendance_log').insert({
        enrollment_id: e.id,
        event_id: ev.id,
        points_delta: 1,
        recorded_by: profile?.id,
      });
      setBusy(false);
      if (error) {
        // unique (enrollment_id, event_id): one attendance per event
        if (error.code === '23505') {
          setResult({ type: 'dup', message: `${e.person.name} — حضوره مسجل بالفعل في هذه المناسبة` });
        } else {
          setResult({ type: 'err', message: 'تعذر تسجيل الحضور، حاول مجدداً' });
        }
        return;
      }
      setResult({ type: 'ok', message: `تم تسجيل حضور ${e.person.name} ✔ (${className(e.class_id)})` });
      // refresh local counters
      setEnrollments((prev) =>
        prev.map((x) =>
          x.id === e.id
            ? { ...x, attendance_count: x.attendance_count + 1, points: x.points + 1 }
            : x
        )
      );
    },
    [supabase, profile, className, events, eventId]
  );

  // Scan flow: national id (QR) -> person -> his enrollments in my scope
  const handleQr = useCallback(
    async (qrValue: string) => {
      const nationalId = qrValue.trim();
      const mine = enrollments.filter((e) => e.person.national_id === nationalId);
      if (mine.length === 0) {
        setResult({ type: 'err', message: 'رقم قومي غير معروف أو الشخص غير مسجل في نطاق صلاحيتك' });
        return;
      }
      if (mine.length === 1) {
        await recordAttendance(mine[0]);
        return;
      }
      // Person enrolled in multiple classes/services — let the servant pick
      setResult(null);
      setPicker({ person: mine[0].person, options: mine });
    },
    [enrollments, recordAttendance]
  );

  // BarcodeDetector-based scanning loop (native, no deps)
  const startCamera = async () => {
    setCameraError('');
    setResult(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraOn(true);

      const BD = (window as unknown as { BarcodeDetector?: new (opts: { formats: string[] }) => { detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]> } }).BarcodeDetector;
      if (!BD) {
        setCameraError('المتصفح لا يدعم المسح المباشر — استخدم البحث اليدوي بالأسفل');
        return;
      }
      const detector = new BD({ formats: ['qr_code'] });
      scanningRef.current = true;
      let lastCode = '';
      let lastAt = 0;

      const tick = async () => {
        if (!scanningRef.current || !videoRef.current) return;
        try {
          const codes = await detector.detect(videoRef.current);
          if (codes.length > 0) {
            const value = codes[0].rawValue;
            const now = Date.now();
            if (value !== lastCode || now - lastAt > 4000) {
              lastCode = value;
              lastAt = now;
              await handleQr(value);
            }
          }
        } catch {
          /* frame not ready */
        }
        if (scanningRef.current) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    } catch {
      setCameraError('تعذر فتح الكاميرا — تأكد من منح الإذن أو استخدم البحث اليدوي');
    }
  };

  const stopCamera = useCallback(() => {
    scanningRef.current = false;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraOn(false);
  }, []);

  useEffect(() => stopCamera, [stopCamera]);

  const filtered = search
    ? enrollments.filter(
        (e) =>
          e.person.name.includes(search) ||
          (e.person.phone ?? '').includes(search) ||
          e.person.national_id.includes(search)
      )
    : [];

  return (
    <AppShell>
      <section id="scanner-header" className="mb-4">
        <h2 className="flex items-center gap-2 text-lg font-extrabold">
          <ScanLine className="h-5 w-5 text-primary-600" />
          الماسح — تسجيل الحضور
        </h2>
        <p className="text-xs text-slate-500 mt-1">
          اختر المناسبة ثم امسح الرقم القومي (QR)، أو ابحث يدوياً لتسجيل الحضور (+1 نقطة)
        </p>
      </section>

      {/* Event selector — attendance is registered against an event */}
      <section id="event-select-section" className="card mb-4 flex items-center gap-2 !py-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-50">
          <CalendarDays className="h-5 w-5 text-violet-500" />
        </span>
        <select
          id="scanner-event-selector"
          aria-label="اختيار المناسبة"
          className="input-field flex-1 appearance-none text-sm font-bold"
          value={eventId}
          onChange={(e) => { setEventId(e.target.value); setResult(null); }}
        >
          <option value="">اختر المناسبة *</option>
          {events.map((ev) => (
            <option key={ev.id} value={ev.id}>
              {ev.name}{ev.event_date ? ` — ${ev.event_date}` : ''} ({className(ev.class_id)})
            </option>
          ))}
        </select>
      </section>
      {events.length === 0 && (
        <p className="mb-4 rounded-xl bg-violet-50 px-3 py-2 text-xs font-bold text-violet-600">
          لا توجد مناسبات — أضف مناسبة من الإعدادات ← إدارة المناسبات
        </p>
      )}

      {/* Camera area */}
      <section id="camera-section" className="card mb-4 overflow-hidden !p-0">
        <div className="relative aspect-[4/3] bg-slate-900 flex items-center justify-center">
          <video ref={videoRef} className={`h-full w-full object-cover ${cameraOn ? '' : 'hidden'}`} muted playsInline />
          {!cameraOn && (
            <div className="text-center text-slate-400">
              <Camera className="mx-auto mb-2 h-10 w-10" />
              <p className="text-sm font-bold">الكاميرا متوقفة</p>
            </div>
          )}
          {cameraOn && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="h-48 w-48 rounded-2xl border-4 border-gold-400/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
            </div>
          )}
        </div>
        <div className="p-3">
          {cameraError && (
            <p className="mb-2 rounded-xl bg-gold-50 px-3 py-2 text-xs font-bold text-gold-600 flex items-center gap-1">
              <AlertCircle className="h-4 w-4 shrink-0" /> {cameraError}
            </p>
          )}
          <button
            id="camera-toggle"
            onClick={cameraOn ? stopCamera : startCamera}
            className={`w-full flex items-center justify-center gap-2 ${cameraOn ? 'btn-secondary' : 'btn-primary'}`}
          >
            {cameraOn ? <CameraOff className="h-5 w-5" /> : <Camera className="h-5 w-5" />}
            {cameraOn ? 'إيقاف الكاميرا' : 'تشغيل الكاميرا'}
          </button>
        </div>
      </section>

      {/* Result banner */}
      {result && (
        <div
          id="scan-result"
          className={`mb-4 flex items-center gap-2 rounded-2xl px-4 py-3 font-bold ${
            result.type === 'ok'
              ? 'bg-emerald-100 text-emerald-700'
              : result.type === 'dup'
              ? 'bg-gold-100 text-gold-600'
              : 'bg-red-100 text-red-600'
          }`}
        >
          {result.type === 'ok' ? (
            <CheckCircle2 className="h-5 w-5 shrink-0" />
          ) : (
            <AlertCircle className="h-5 w-5 shrink-0" />
          )}
          <span className="text-sm">{result.message}</span>
        </div>
      )}

      {/* Multi-enrollment picker: person is registered in several classes */}
      {picker && (
        <div id="enrollment-picker" className="card mb-4">
          <p className="mb-2 text-sm font-extrabold text-slate-700">
            {picker.person.name} مسجل في أكثر من فصل — اختر مكان تسجيل الحضور:
          </p>
          <ul className="space-y-2">
            {picker.options.map((e) => (
              <li key={e.id}>
                <button
                  onClick={() => recordAttendance(e)}
                  disabled={busy}
                  className="btn-secondary w-full flex items-center justify-between !py-2.5"
                >
                  <span className="flex items-center gap-2 text-sm font-bold">
                    <School className="h-4 w-4 text-primary-600" />
                    {className(e.class_id)}
                  </span>
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                </button>
              </li>
            ))}
          </ul>
          <button
            onClick={() => setPicker(null)}
            className="mt-2 w-full text-xs font-bold text-slate-400"
          >
            إلغاء
          </button>
        </div>
      )}

      {/* Manual search */}
      <section id="manual-section">
        <h3 className="mb-2 text-sm font-extrabold text-slate-500">تسجيل يدوي</h3>
        <div className="relative mb-3">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            id="manual-search"
            className="input-field pr-9"
            placeholder="ابحث بالاسم أو الهاتف أو الرقم القومي..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <ul className="space-y-2">
          {filtered.slice(0, 8).map((e) => (
            <li key={e.id} className="card flex items-center justify-between gap-2 !py-3">
              <div className="min-w-0">
                <p className="font-bold truncate">{e.person.name}</p>
                <p className="text-xs text-slate-400 flex items-center gap-1">
                  <Star className="h-3 w-3 text-gold-500" /> {e.points} نقطة — {e.attendance_count} حضور — {className(e.class_id)}
                </p>
              </div>
              <button
                onClick={() => recordAttendance(e)}
                disabled={busy}
                className="btn-primary !py-2 !px-3 text-sm shrink-0 flex items-center gap-1"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                حضور
              </button>
            </li>
          ))}
        </ul>
      </section>
    </AppShell>
  );
}
