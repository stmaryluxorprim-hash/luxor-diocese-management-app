'use client';

// Messaging module gate (الرسائل والإشعارات) — every /messaging/* page
// renders only when the `messaging` module is granted to the caller's scope.

import { type ReactNode } from 'react';
import { ModuleGate } from '@/components/ModuleGate';

export default function MessagingModuleLayout({ children }: { children: ReactNode }) {
  return (
    <ModuleGate module="messaging" shell>
      {children}
    </ModuleGate>
  );
}
