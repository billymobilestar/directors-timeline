import './globals.css';
import type { Metadata } from 'next';
import React from 'react';

export const metadata: Metadata = {
  title: "Director's Timeline (MVP)",
  description: 'Waveform notes and script plotting tool'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="h-screen bg-neutral-950 text-neutral-100">{children}</body>
    </html>
  );
}
