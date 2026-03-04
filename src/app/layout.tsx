// ============================================================
// src/app/layout.tsx
//
// PURPOSE: The root layout for the entire Next.js app.
// Every page is rendered INSIDE this layout's {children} slot.
// Put shared HTML structure, fonts, and global metadata here.
//
// This is a Server Component (no 'use client') — Next.js renders
// it on the server and sends the HTML to the browser. Pages that
// need interactivity will declare 'use client' themselves.
// ============================================================

import type { Metadata } from 'next';
import './globals.css';

/**
 * metadata is a Next.js App Router convention.
 * It sets the <title> and <meta name="description"> tags automatically.
 * You do not need to add a <head> tag manually.
 */
export const metadata: Metadata = {
  title: 'Mojong',
  description: 'A 2-player strategy board game',
};

/**
 * RootLayout wraps every page in the app.
 *
 * @param children - the current page's rendered output, injected by Next.js
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      {/*
       * Next.js automatically injects <head> content (meta, title, etc.)
       * based on the `metadata` export above — no manual <Head> needed.
       */}
      <body>{children}</body>
    </html>
  );
}
