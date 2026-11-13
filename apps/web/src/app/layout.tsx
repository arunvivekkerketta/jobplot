import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "JobPilot",
  description: "AI job-search co-pilot",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <div className="min-h-screen">
          <header className="border-b border-neutral-200 bg-white">
            <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
              <Link href="/" className="text-lg font-bold text-blue-700">
                JobPilot
              </Link>
              <nav className="flex items-center gap-5 text-sm">
                <Link href="/profile" className="hover:text-blue-700">Profile</Link>
                <Link href="/documents" className="hover:text-blue-700">
                  Documents
                </Link>
                <Link href="/jobs" className="hover:text-blue-700">
                  Jobs
                </Link>
                <Link href="/matches" className="hover:text-blue-700">
                  Matches
                </Link>
                <Link href="/audit" className="hover:text-blue-700">Audit</Link>
                <Link href="/settings" className="hover:text-blue-700">Settings</Link>
              </nav>
            </div>
          </header>
          <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
        </div>
      </body>
    </html>
  );
}
