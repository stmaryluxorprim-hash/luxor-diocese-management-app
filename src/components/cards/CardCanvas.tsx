'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import QRCode from 'qrcode';
import { User } from 'lucide-react';
import type {
  CardDesign,
  CardElement,
  ImageFit,
} from '@/lib/card-types';
import { ageFromBirthdate } from '@/lib/card-types';

// ---------- data fed into a card ----------
export interface CardPersonData {
  name: string;
  national_id: string;
  birthdate: string | null;
  phone: string | null;
  address: string | null;
  image_url: string | null;
}

export interface CardConstantsData {
  church_name: string;
  service_name: string;
  class_name: string;
  church_logo_url: string | null;
}

export const SAMPLE_PERSON: CardPersonData = {
  name: 'مينا جرجس عبد المسيح',
  national_id: '30001011234567',
  birthdate: '2015-06-15',
  phone: '01234567890',
  address: 'الأقصر — حي الكرنك',
  image_url: null,
};

// ---------- helpers ----------
const fitToCss = (fit: ImageFit): CSSProperties =>
  fit === 'tile'
    ? { backgroundRepeat: 'repeat', backgroundSize: 'auto' }
    : {
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'center',
        backgroundSize: fit === 'cover' ? 'cover' : fit === 'contain' ? 'contain' : '100% 100%',
      };

const resolveText = (
  el: CardElement,
  person: CardPersonData,
  constants: CardConstantsData
): string => {
  let value = '';
  if (el.type === 'text') value = el.text ?? '';
  else if (el.type === 'constant') {
    if (el.field === 'church_name') value = constants.church_name;
    else if (el.field === 'service_name') value = constants.service_name;
    else if (el.field === 'class_name') value = constants.class_name;
  } else if (el.type === 'variable') {
    switch (el.field) {
      case 'name': value = person.name; break;
      case 'age': value = ageFromBirthdate(person.birthdate); break;
      case 'birthdate': value = person.birthdate ?? '—'; break;
      case 'phone': value = person.phone ?? '—'; break;
      case 'national_id': value = person.national_id; break;
      case 'address': value = person.address ?? '—'; break;
    }
  }
  return el.label ? `${el.label} ${value}` : value;
};

// QR image as data-url (rendered async once per national_id)
function QrImage({ value, className }: { value: string; className?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(value || '—', { margin: 0, width: 256 })
      .then((u) => alive && setUrl(u))
      .catch(() => {});
    return () => { alive = false; };
  }, [value]);
  if (!url) return null;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt="QR" className={className} style={{ width: '100%', height: '100%' }} />;
}

// ---------- single element ----------
function ElementView({
  el,
  scale,
  person,
  constants,
}: {
  el: CardElement;
  scale: number;
  person: CardPersonData;
  constants: CardConstantsData;
}) {
  const base: CSSProperties = {
    position: 'absolute',
    left: el.x * scale,
    top: el.y * scale,
    width: el.w * scale,
    height: el.h * scale,
    transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
    opacity: el.opacity,
    borderRadius: el.borderRadius * scale,
    overflow: 'hidden',
  };

  if (el.type === 'photo' || el.type === 'logo' || el.type === 'image') {
    const url =
      el.type === 'photo' ? person.image_url
      : el.type === 'logo' ? constants.church_logo_url
      : el.imageUrl ?? null;
    return (
      <div style={base}>
        {url ? (
          <div style={{ width: '100%', height: '100%', backgroundImage: `url(${url})`, ...fitToCss(el.imageFit) }} />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-slate-100 text-slate-300">
            <User style={{ width: '60%', height: '60%' }} />
          </div>
        )}
      </div>
    );
  }

  if (el.type === 'qr') {
    return (
      <div style={{ ...base, background: '#fff' }}>
        <QrImage value={person.national_id} />
      </div>
    );
  }

  // text-like elements
  const s = el.style;
  return (
    <div
      style={{
        ...base,
        display: 'flex',
        alignItems: 'center',
        justifyContent: s.align === 'center' ? 'center' : s.align === 'left' ? 'flex-end' : 'flex-start',
        fontFamily: `'${s.fontFamily}', sans-serif`,
        // fontSize in pt → px: 1pt = 1/72in, screen mm scale: scale px per mm, 1in = 25.4mm
        fontSize: s.fontSize * (scale * 25.4 / 72),
        color: s.color,
        fontWeight: s.bold ? 800 : 400,
        fontStyle: s.italic ? 'italic' : 'normal',
        textAlign: s.align,
        lineHeight: 1.2,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        direction: 'rtl',
      }}
    >
      {resolveText(el, person, constants)}
    </div>
  );
}

// ---------- the card ----------
interface CardCanvasProps {
  design: CardDesign;
  scale: number; // px per mm
  person?: CardPersonData;
  constants: CardConstantsData;
  className?: string;
  // designer-mode extras
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  onMove?: (id: string, x: number, y: number) => void;
}

export default function CardCanvas({
  design,
  scale,
  person = SAMPLE_PERSON,
  constants,
  className,
  selectedId,
  onSelect,
  onMove,
}: CardCanvasProps) {
  const interactive = !!onSelect;
  const bg = design.background;

  // drag state (designer mode)
  const startDrag = (e: React.PointerEvent, el: CardElement) => {
    if (!interactive) return;
    e.stopPropagation();
    onSelect?.(el.id);
    if (!onMove) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const origX = el.x;
    const origY = el.y;
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - startX) / scale;
      const dy = (ev.clientY - startY) / scale;
      onMove(
        el.id,
        Math.round((origX + dx) * 2) / 2, // snap 0.5mm
        Math.round((origY + dy) * 2) / 2
      );
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div
      className={className}
      onPointerDown={() => interactive && onSelect?.(null)}
      style={{
        position: 'relative',
        width: design.width * scale,
        height: design.height * scale,
        borderRadius: design.cornerRadius * scale,
        backgroundColor: bg.color,
        border: design.border.enabled
          ? `${Math.max(design.border.width * scale, 0.5)}px solid ${design.border.color}`
          : undefined,
        overflow: 'hidden',
        flexShrink: 0,
        boxSizing: 'border-box',
      }}
    >
      {bg.imageUrl && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundImage: `url(${bg.imageUrl})`,
            opacity: bg.imageOpacity,
            ...fitToCss(bg.imageFit),
          }}
        />
      )}
      {design.elements.map((el) => (
        <div
          key={el.id}
          onPointerDown={(e) => startDrag(e, el)}
          style={interactive ? { cursor: 'move', touchAction: 'none' } : undefined}
        >
          <ElementView el={el} scale={scale} person={person} constants={constants} />
          {interactive && selectedId === el.id && (
            <div
              style={{
                position: 'absolute',
                left: el.x * scale - 2,
                top: el.y * scale - 2,
                width: el.w * scale + 4,
                height: el.h * scale + 4,
                border: '2px dashed #6366f1',
                borderRadius: 4,
                pointerEvents: 'none',
              }}
            />
          )}
        </div>
      ))}
    </div>
  );
}
