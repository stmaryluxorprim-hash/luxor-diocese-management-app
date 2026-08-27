'use client';

// ---------- Header date button + working-date modal ----------
// An interactive date pill next to the side-menu button. Tapping it opens
// a modal with date + time pickers. Once changed, ALL date-based operations
// (attendance register, event availability, "today") use the chosen instant
// until it is reset back to the live clock.

import { useState } from 'react';
import { CalendarDays, X, Clock, RotateCcw, Check } from 'lucide-react';
import { useAppDate } from '@/lib/app-date-context';
import { cairoToday, cairoTimeHM, formatCairoDate, formatCairoTime } from '@/lib/time';

export default function AppDateButton() {
  const { appDate, isOverridden, setAppDate, now } = useAppDate();
  const [open, setOpen] = useState(false);
  const [dateStr, setDateStr] = useState('');
  const [timeStr, setTimeStr] = useState('');

  const openModal = () => {
    const base = now();
    setDateStr(cairoToday(base));
    setTimeStr(cairoTimeHM(base));
    setOpen(true);
  };

  const apply = () => {
    if (!dateStr) return;
    // Interpret the picked date+time as Cairo wall clock.
    // Cairo is UTC+2 (standard) / UTC+3 (DST); probe and adjust.
    const guess = new Date(`${dateStr}T${timeStr || '00:00'}:00+02:00`);
    const rendered = `${cairoToday(guess)}T${cairoTimeHM(guess)}`;
    const wanted = `${dateStr}T${timeStr || '00:00'}`;
    let instant = guess;
    if (rendered !== wanted) {
      const diff = new Date(`${wanted}:00Z`).getTime() - new Date(`${rendered}:00Z`).getTime();
      instant = new Date(guess.getTime() + diff);
    }
    setAppDate(instant);
    setOpen(false);
  };

  const reset = () => {
    setAppDate(null);
    setOpen(false);
  };

  return (
    <>
      <button
        id="app-date-btn"
        aria-label="تغيير تاريخ العمل"
        onClick={openModal}
        className={`flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-extrabold transition active:scale-95 ${
          isOverridden
            ? 'bg-gold-400 text-primary-900 shadow ring-2 ring-gold-200 animate-pulse'
            : 'bg-white/15 text-white hover:bg-white/25'
        }`}
      >
        <CalendarDays className="h-4 w-4" />
        <span className="hidden xs:inline tabular-nums">
          {isOverridden && appDate ? cairoToday(appDate) : cairoToday()}
        </span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-6"
          onClick={() => setOpen(false)}
        >
          <div
            id="app-date-modal"
            className="w-full max-w-sm rounded-t-3xl sm:rounded-3xl bg-white p-5 text-slate-800 animate-[slideUp_0.2s_ease-out]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-lg font-extrabold">
                <CalendarDays className="h-5 w-5 text-primary-600" />
                تاريخ العمل
              </h3>
              <button onClick={() => setOpen(false)} aria-label="إغلاق" className="rounded-full p-1.5 hover:bg-slate-100">
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Current state */}
            <div
              className={`mb-4 rounded-2xl px-4 py-3 text-xs font-bold ${
                isOverridden ? 'bg-gold-50 text-gold-700' : 'bg-slate-50 text-slate-500'
              }`}
            >
              {isOverridden && appDate ? (
                <>
                  ⏱ تاريخ العمل الحالي: {formatCairoDate(appDate)} — {formatCairoTime(appDate)}
                  <br />
                  كل العمليات (تسجيل الحضور وغيرها) تستخدم هذا التاريخ.
                </>
              ) : (
                <>التطبيق يتبع الساعة الحية بتوقيت القاهرة. اختر تاريخاً لتسجيل عمليات بأثر رجعي أو مستقبلي.</>
              )}
            </div>

            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-bold text-slate-500">التاريخ</label>
                <input
                  id="app-date-input"
                  type="date"
                  className="input-field"
                  value={dateStr}
                  onChange={(e) => setDateStr(e.target.value)}
                />
              </div>
              <div>
                <label className="mb-1 flex items-center gap-1 text-xs font-bold text-slate-500">
                  <Clock className="h-3.5 w-3.5" /> الوقت
                </label>
                <input
                  id="app-time-input"
                  type="time"
                  className="input-field"
                  value={timeStr}
                  onChange={(e) => setTimeStr(e.target.value)}
                />
              </div>
            </div>

            <div className="mt-4 flex gap-2">
              {isOverridden && (
                <button
                  id="app-date-reset"
                  type="button"
                  onClick={reset}
                  className="btn-secondary flex-none flex items-center gap-1.5 !px-4"
                >
                  <RotateCcw className="h-4 w-4" />
                  الساعة الحية
                </button>
              )}
              <button
                id="app-date-apply"
                type="button"
                onClick={apply}
                className="btn-primary flex-1 flex items-center justify-center gap-2"
              >
                <Check className="h-5 w-5" />
                اعتماد التاريخ
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
