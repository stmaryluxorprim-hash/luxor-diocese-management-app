'use client';

import { useEffect } from 'react';

export default function PwaRegister() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    // `updateViaCache: 'none'` → the browser re-fetches sw.js on every check
    // instead of trusting the HTTP cache, so a fixed worker reaches phones
    // that are still running a broken one.
    navigator.serviceWorker
      .register('/sw.js', { updateViaCache: 'none' })
      .then((reg) => { reg.update().catch(() => {}); })
      .catch(() => {});
  }, []);
  return null;
}
