'use client';

// ---------- Child login (دخول المخدوم) ----------
// Two ways in: scan the card QR with the camera, or pick a photo of the QR
// from the gallery. The decoded value (= national id) is validated through
// the child_portal_profile RPC and stored as the session token.

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import {
  Camera, CameraOff, Images, Loader2, ArrowRight, QrCode, AlertCircle, CheckCircle2, KeyRound,
} from 'lucide-react';
import { useChild } from '@/lib/child-context';
import { nativeDetector, decodeVideoFrame, decodeImageFile } from '@/lib/qr-decode';

export default function ChildLoginPage() {
  const router = useRouter();
  const { token, loading, login } = useChild();

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanningRef = useRef(false);
  const busyRef = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [cameraOn, setCameraOn] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState('');
  const [showManual, setShowManual] = useState(false);

  // Already logged in → go to the portal
  useEffect(() => {
    if (!loading && token) router.replace('/child');
  }, [loading, token, router]);

  const stopCamera = useCallback(() => {
    scanningRef.current = false;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraOn(false);
  }, []);
  useEffect(() => stopCamera, [stopCamera]);

  const handleCode = useCallback(
    async (code: string) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      setError('');
      const err = await login(code);
      if (err) {
        setError(err);
        busyRef.current = false;
        setBusy(false);
        return;
      }
      setSuccess('تم التعرف على الكارت ✔');
      stopCamera();
      router.replace('/child');
    },
    [login, router, stopCamera]
  );

  // ---------- Camera scan ----------
  const startCamera = async () => {
    setError('');
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
      scanningRef.current = true;

      const detector = nativeDetector();
      if (!canvasRef.current) canvasRef.current = document.createElement('canvas');
      let lastCode = '';
      let lastAt = 0;

      const tick = async () => {
        if (!scanningRef.current || !videoRef.current) return;
        try {
          let value: string | null = null;
          if (detector) {
            const codes = await detector.detect(videoRef.current);
            value = codes[0]?.rawValue ?? null;
          } else {
            value = decodeVideoFrame(videoRef.current, canvasRef.current!);
          }
          if (value) {
            const t = Date.now();
            if (value !== lastCode || t - lastAt > 4000) {
              lastCode = value;
              lastAt = t;
              await handleCode(value);
            }
          }
        } catch {
          /* frame not ready */
        }
        if (scanningRef.current) {
          // jsQR is CPU heavy — throttle to ~8 fps; native runs per frame
          if (detector) requestAnimationFrame(tick);
          else setTimeout(tick, 120);
        }
      };
      tick();
    } catch {
      setError('تعذر فتح الكاميرا — تأكد من منح الإذن أو اختر صورة الكود من المعرض');
    }
  };

  // ---------- Gallery ----------
  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError('');
    setBusy(true);
    try {
      const code = await decodeImageFile(file);
      if (!code) {
        setError('لم نجد كود QR واضحاً في هذه الصورة — جرّب صورة أقرب وأوضح');
        setBusy(false);
        return;
      }
      await handleCode(code);
    } catch {
      setError('تعذر قراءة الصورة');
      setBusy(false);
    }
  };

  const onManual = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manual.trim()) return;
    await handleCode(manual);
  };

  return (
    <main className="flex min-h-screen flex-col items-center px-5 py-8">
      <section className="w-full max-w-sm">
        <Link
          href="/login"
          className="mb-5 inline-flex items-center gap-1 text-sm font-bold text-slate-500 hover:text-primary-600"
        >
          <ArrowRight className="h-4 w-4" />
          رجوع لدخول الخدام
        </Link>

        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 h-24 w-24 overflow-hidden rounded-3xl shadow-lg ring-2 ring-gold-300/50">
            <Image src="/icons/icon-192.png" alt="شعار الإيبارشية" width={96} height={96} priority className="h-full w-full object-cover" />
          </div>
          <h1 className="text-2xl font-extrabold">دخول المخدوم</h1>
          <p className="mt-1 text-sm text-slate-500">امسح كود الـ QR على كارتك أو اختر صورته من المعرض</p>
        </div>

        {/* Camera viewport */}
        <div className="card !p-0 overflow-hidden mb-4">
          <div className="relative aspect-square bg-slate-900">
            <video ref={videoRef} playsInline muted className={`h-full w-full object-cover ${cameraOn ? '' : 'hidden'}`} />
            {!cameraOn && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white/80">
                <QrCode className="h-16 w-16" />
                <p className="text-sm font-bold">الكاميرا مغلقة</p>
              </div>
            )}
            {cameraOn && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="h-56 w-56 rounded-3xl border-4 border-gold-300/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
              </div>
            )}
            {busy && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                <Loader2 className="h-10 w-10 animate-spin text-white" />
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2 p-3">
            <button
              id="child-scan-btn"
              onClick={cameraOn ? stopCamera : startCamera}
              disabled={busy}
              className={`flex items-center justify-center gap-2 rounded-xl px-3 py-3 font-extrabold transition active:scale-[0.98] ${
                cameraOn ? 'bg-red-50 text-red-600 hover:bg-red-100' : 'btn-primary'
              }`}
            >
              {cameraOn ? <CameraOff className="h-5 w-5" /> : <Camera className="h-5 w-5" />}
              {cameraOn ? 'إيقاف الكاميرا' : 'مسح الكود'}
            </button>
            <button
              id="child-gallery-btn"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              className="btn-secondary flex items-center justify-center gap-2 !py-3"
            >
              <Images className="h-5 w-5" />
              من المعرض
            </button>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPickFile} />
          </div>
        </div>

        {error && (
          <p className="mb-3 flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2.5 text-sm font-bold text-red-600">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
          </p>
        )}
        {success && (
          <p className="mb-3 flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2.5 text-sm font-bold text-emerald-700">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            {success}
          </p>
        )}

        {/* Manual code entry (fallback) */}
        <button
          onClick={() => setShowManual((v) => !v)}
          className="mx-auto flex items-center gap-1.5 text-xs font-bold text-slate-400 hover:text-primary-600"
        >
          <KeyRound className="h-3.5 w-3.5" />
          {showManual ? 'إخفاء الإدخال اليدوي' : 'لا تستطيع المسح؟ أدخل الكود يدوياً'}
        </button>
        {showManual && (
          <form onSubmit={onManual} className="mt-3 flex gap-2">
            <input
              id="child-manual-code"
              className="input-field"
              dir="ltr"
              placeholder="كود الكارت"
              value={manual}
              onChange={(e) => setManual(e.target.value)}
            />
            <button type="submit" disabled={busy || !manual.trim()} className="btn-primary shrink-0 !px-4">
              دخول
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
