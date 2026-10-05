import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Wayly NYC',
  description: 'A constrained NYC itinerary-planning MVP.',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
