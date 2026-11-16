import type { Metadata } from "next";
import Link from "next/link";
import NavLinks from "./NavLinks";
import "./globals.css";

export const metadata: Metadata = {
  // Every page supplies its own short title; the template keeps the product name
  // and tells tabs apart (A2).
  title: {
    default: "JobPilot",
    template: "%s · JobPilot",
  },
  description: "AI job-search co-pilot",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        {/* First focusable element on every page, so keyboard users can skip the
            navigation (A6). */}
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2 focus:text-blue-700"
        >
          Skip to content
        </a>
        <div className="min-h-screen">
          <header className="border-b border-neutral-200 bg-white">
            <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-3">
              <Link href="/" className="text-lg font-bold text-blue-700">
                JobPilot
              </Link>
              <NavLinks />
            </div>
          </header>
          <main id="main" className="mx-auto max-w-6xl px-6 py-8">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
