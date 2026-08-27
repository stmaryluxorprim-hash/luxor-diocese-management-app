import type { Metadata, Viewport } from 'next';
import './globals.css';
import { AuthProvider } from '@/lib/auth-context';
import { AppDateProvider } from '@/lib/app-date-context';
import PwaRegister from '@/components/PwaRegister';

export const metadata: Metadata = {
  title: 'إيبارشية الأقصر وتوابعها',
  description: 'تطبيق إدارة كنائس وخدمات إيبارشية الأقصر وتوابعها',
  manifest: '/manifest.json',
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/favicon-16.png', sizes: '16x16', type: 'image/png' },
    ],
    apple: '/icons/apple-touch-icon.png',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'الإيبارشية',
  },
};

export const viewport: Viewport = {
  themeColor: '#1e3a8a',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Cairo:wght@300;400;600;700;800&display=swap"
          rel="stylesheet"
        />
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
      </head>
      <body className="font-arabic bg-gradient-to-b from-slate-50 to-indigo-50/40 min-h-screen text-slate-800 antialiased">
        <AuthProvider>
          <AppDateProvider>{children}</AppDateProvider>
        </AuthProvider>
        <PwaRegister />
      </body>
    </html>
  );
}
