import type { Metadata } from 'next';
import { Geist, Geist_Mono, Plus_Jakarta_Sans } from 'next/font/google';
import { PwaRegister } from '@/components/pwa-register';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const jakarta = Plus_Jakarta_Sans({
  variable: '--font-jakarta',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const viewport = {
  themeColor: '#185e56',
  viewportFit: 'cover',
};

export const metadata: Metadata = {
  title: 'Wayly | Trusted NYC exploration',
  description: 'A source-linked planning preview for short New York City trips.',
  manifest: '/manifest.webmanifest',
  openGraph: {
    title: 'Wayly | Trusted NYC exploration',
    description: 'A source-linked planning preview for short New York City trips.',
  },
  twitter: {
    card: 'summary',
    title: 'Wayly | Trusted NYC exploration',
    description: 'A source-linked planning preview for short New York City trips.',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${jakarta.variable} ${geistSans.variable} ${geistMono.variable} antialiased`}
        suppressHydrationWarning
      >
        <PwaRegister />
        {children}
      </body>
    </html>
  );
}
