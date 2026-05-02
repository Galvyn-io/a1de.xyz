import type { Metadata, Viewport } from 'next';
import { Geist, Newsreader } from 'next/font/google';
import './globals.css';
import { CommandPalette } from '@/components/command-palette';
import { ToastProvider } from '@/components/toast';
import { ConfirmProvider } from '@/components/confirm-dialog';
import { ThemeProvider, ThemeScript } from '@/components/theme-provider';

const geist = Geist({ subsets: ['latin'], variable: '--font-geist' });
const newsreader = Newsreader({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  style: ['normal', 'italic'],
  variable: '--font-newsreader',
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'https://app.a1de.xyz'),
  title: {
    default: 'A1DE',
    template: '%s · A1DE',
  },
  description: 'Your personal family AI assistant — calendar, email, health, and golf, all remembered.',
  applicationName: 'A1DE',
  appleWebApp: { title: 'A1DE', capable: true, statusBarStyle: 'black-translucent' },
  // Icons are auto-discovered from src/app/icon.svg + apple-icon.svg via Next's
  // file conventions — no explicit `icons` config needed.
  manifest: '/manifest.webmanifest',
  openGraph: {
    title: 'A1DE',
    description: 'Your personal family AI assistant.',
    siteName: 'A1DE',
    type: 'website',
  },
  twitter: { card: 'summary_large_image', title: 'A1DE' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#0a0a0a' },
    { media: '(prefers-color-scheme: light)', color: '#fafafa' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} ${newsreader.variable}`} suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body className={`${geist.className} bg-bg text-fg antialiased`}>
        <ThemeProvider>
          <ToastProvider>
            <ConfirmProvider>
              {children}
              <CommandPalette />
            </ConfirmProvider>
          </ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
