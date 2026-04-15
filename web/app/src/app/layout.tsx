import type { Metadata } from 'next';
import { Outfit } from 'next/font/google';
import './globals.css';
import { CommandPalette } from '@/components/command-palette';
import { ToastProvider } from '@/components/toast';
import { ConfirmProvider } from '@/components/confirm-dialog';

const outfit = Outfit({ subsets: ['latin'], variable: '--font-outfit' });

export const metadata: Metadata = {
  title: 'A1DE',
  description: 'Your personal AI assistant',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className={`${outfit.className} bg-bg text-fg antialiased`}>
        <ToastProvider>
          <ConfirmProvider>
            {children}
            <CommandPalette />
          </ConfirmProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
