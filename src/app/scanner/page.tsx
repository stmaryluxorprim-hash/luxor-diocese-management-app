'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  ScanLine, Camera, CameraOff, CheckCircle2, AlertCircle, Search, Star, Loader2,
} from 'lucide-react';
import AppShell from '@/components/AppShell';
import { useAuth } from '@/lib/auth-context';
import { createClient } from '@/lib/supabase/client';
import type { Child } from '@/lib/types';

type ScanResult = { type: 'ok' | 'dup' | 'err'; message: string; child?: Child };

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
  const [children, setChildren] = useState<Child[]>([]);
  const [busy, setBusy] = useState(false);

  // Load children for manual mode
  useEffect(() => {
    if (profile?.status !== 'approved') return;
    supabase.from('children').select('*').order('name').then(({ data }) => setChildren(data ?? []));
  }, [profile, supabase]);

  const recordAttendance = useCallback(
    async (child: Child) => {
      setBusy(true);
      const { error } = await supabase.from('attendance').insert({
        child_id: child.id,
        church_id: child.church_id,
        service_id: child.service_id,
        class_id: child.class_id,
        recorded_by: profile?.id,
        points_awarded: 1,
      });
      setBusy(false);
      if (error) {
        if (error.code === '23505') {
          setResult({ type: 'dup', message: `${child.name} — مسجل حضوره اليوم بالفعل`, child });
        } else {
          setResult({ type: 'err', message: 'تعذر تسجيل الحضور، حاول مجدداً' });
        }
        return;
      }
      setResult({ type: 'ok', message: `تم تسجيل حضور ${child.name} ✔`, child });
      // refresh local counters
      setChildren((prev) =>
        prev.map((c) =>
          c.id === child.id
            ? { ...c, attendance_count: c.attendance_count + 1, points: c.points + 1 }
            : c
        )
      );
    },
    [supabase, profile]
  );

  const handleQr = useCallback(
    async (qrValue: string) => {
      const code = qrValue.trim();
      const { data: child } = await supabase
        .from('children')
        .select('*')
        .eq('qr_code', code)
        .maybeSingle();
      if (!child) {
        setResult({ type: 'err', message: 'رمز غير معروف أو خارج نطاق صلاحيتك' });
        return;
      }
      await recordAttendance(child);
    },
    [supabase, recordAttendance]
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
    ? children.filter((c) => c.name.includes(search) || (c.phone ?? '').includes(search))
    : [];

  return (
    <AppShell>
      <section id="scanner-header" className="mb-4">
        <h2 className="flex items-center gap-2 text-lg font-extrabold">
          <ScanLine className="h-5 w-5 text-primary-600" />
          الماسح — تسجيل الحضور
        </h2>
        <p className="text-xs text-slate-500 mt-1">
          امسح رمز QR الخاص بالمخدوم، أو ابحث يدوياً لتسجيل الحضور (+1 نقطة)
        </p>
      </section>

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

      {/* Manual search */}
      <section id="manual-section">
        <h3 className="mb-2 text-sm font-extrabold text-slate-500">تسجيل يدوي</h3>
        <div className="relative mb-3">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            id="manual-search"
            className="input-field pr-9"
            placeholder="ابحث عن مخدوم بالاسم..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <ul className="space-y-2">
          {filtered.slice(0, 8).map((child) => (
            <li key={child.id} className="card flex items-center justify-between gap-2 !py-3">
              <div className="min-w-0">
                <p className="font-bold truncate">{child.name}</p>
                <p className="text-xs text-slate-400 flex items-center gap-1">
                  <Star className="h-3 w-3 text-gold-500" /> {child.points} نقطة — {child.attendance_count} حضور
                </p>
              </div>
              <button
                onClick={() => recordAttendance(child)}
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
