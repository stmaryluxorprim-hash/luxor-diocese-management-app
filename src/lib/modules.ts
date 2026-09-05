// ---------- MODULES REGISTRY (الوحدات) ----------
// The app = a fixed CORE (the 5 main pages) + optional MODULES.
// Each module is declared ONCE here; the side menu, the settings hub and the
// owner module (صلاحيات الوحدات) all read from this list. Visibility per
// church / service / class is decided by the OWNER in `/owner/modules` and
// stored in `module_access` (migration 0024).
//
// To add a module later: add one entry here + guard its pages with
// `useModuleVisible(key)` (or `<ModuleGate module="key">`).

import { IdCard, Crown, type LucideIcon } from 'lucide-react';
import type { Profile } from '@/lib/types';

export type ModuleKey = 'cards';

export interface AppModule {
  key: ModuleKey;
  label: string;
  desc: string;
  href: string;          // entry page
  icon: LucideIcon;
  color: string;         // tailwind text color for the icon
  /** every path prefix that belongs to the module (used for active state + guards) */
  paths: string[];
}

export const MODULES: AppModule[] = [
  {
    key: 'cards',
    label: 'تصميم الكروت',
    desc: 'تصميم وطباعة كروت المخدومين',
    href: '/settings/cards',
    icon: IdCard,
    color: 'text-rose-600',
    paths: ['/settings/cards'],
  },
];

export const MODULE_BY_KEY: Record<ModuleKey, AppModule> = Object.fromEntries(
  MODULES.map((m) => [m.key, m])
) as Record<ModuleKey, AppModule>;

// The OWNER MODULE — unique, never granted; only `role = owner` sees it.
export const OWNER_MODULE = {
  key: 'owner' as const,
  label: 'وحدة المالك',
  desc: 'تحكم خاص بمالك التطبيق — صلاحيات الوحدات وأكثر',
  href: '/owner',
  icon: Crown,
  color: 'text-gold-500',
  paths: ['/owner'],
};

// ---------- module_access rows (migration 0024) ----------
export interface ModuleAccess {
  id: string;
  module_key: string;
  church_id: string | null;   // null = every church
  service_id: string | null;  // null = all services of the church
  class_id: string | null;    // null = all classes of the service
  created_at: string;
  created_by: string | null;
}

/**
 * Mirror of the SQL `scope_overlaps` + `module_visible` rules so the UI can
 * decide instantly from the (RLS-filtered) grant rows it already has.
 */
export function grantOverlapsProfile(g: ModuleAccess, p: Profile): boolean {
  if (p.role === 'owner') return true;
  if (g.church_id === null) return true;
  if (g.church_id !== p.church_id) return false;
  if (p.role === 'church_manager') return true;
  if (p.service_id !== null && g.service_id !== null && g.service_id !== p.service_id) return false;
  if (p.role === 'service_manager') return true;
  if (p.class_id !== null && g.class_id !== null && g.class_id !== p.class_id) return false;
  return true;
}

export function visibleModuleKeys(grants: ModuleAccess[], profile: Profile | null): Set<string> {
  const out = new Set<string>();
  if (!profile) return out;
  if (profile.role === 'owner') {
    MODULES.forEach((m) => out.add(m.key));
    return out;
  }
  for (const g of grants) {
    if (grantOverlapsProfile(g, profile)) out.add(g.module_key);
  }
  return out;
}
