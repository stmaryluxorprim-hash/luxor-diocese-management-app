'use client';

import Image from 'next/image';
import { Bell } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { ROLE_LABELS } from '@/lib/types';

export default function AppHeader() {
  const { profile, church, service } = useAuth();

  return (
    <header
      id="app-header"
      className="sticky top-0 z-40 bg-gradient-to-l from-primary-700 via-primary-600 to-accent-600 text-white shadow-lg"
    >
      <div className="flex items-center gap-3 px-4 py-3 max-w-3xl mx-auto">
        {/* Church logo (uploaded picture) */}
        <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-full bg-white ring-2 ring-gold-300/70">
          <Image
            src={church?.logo_url ?? '/icons/icon-96.png'}
            alt={church?.name ?? 'شعار الإيبارشية'}
            fill
            sizes="48px"
            className="object-cover"
          />
        </div>

        {/* Church name + service name below it */}
        <div className="flex-1 min-w-0">
          <h1 className="text-base font-extrabold truncate leading-tight">
            {church?.name ?? 'إيبارشية الأقصر وتوابعها'}
          </h1>
          <p className="text-xs text-indigo-100 truncate">
            {service?.name ?? (profile ? ROLE_LABELS[profile.role] : '')}
          </p>
        </div>

        <button
          id="notifications-btn"
          aria-label="الإشعارات"
          className="rounded-full p-2 hover:bg-white/15 transition"
        >
          <Bell className="h-5 w-5" />
        </button>
      </div>
    </header>
  );
}
