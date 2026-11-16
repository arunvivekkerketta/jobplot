"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const LINKS = [
  { href: "/profile", label: "Profile" },
  { href: "/documents", label: "Documents" },
  { href: "/jobs", label: "Jobs" },
  { href: "/matches", label: "Matches" },
  { href: "/tailor", label: "Tailor" },
  { href: "/answers", label: "Answers" },
  { href: "/skills", label: "Skills" },
  { href: "/applications", label: "Applications" },
  { href: "/autopilot", label: "Auto-Pilot" },
  { href: "/audit", label: "Audit" },
  { href: "/settings", label: "Settings" },
] as const;

/**
 * The main navigation: the current page is marked with aria-current, and under
 * 768px the row collapses behind a Menu button so it cannot overflow (A6).
 */
export default function NavLinks() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const linkClass = (href: string): string => {
    const active = pathname === href || pathname.startsWith(`${href}/`);
    return [
      "block py-2 hover:text-blue-700",
      active ? "font-semibold text-blue-700" : "text-neutral-800",
    ].join(" ");
  };

  return (
    <nav aria-label="Main" className="relative">
      <button
        type="button"
        className="btn-secondary md:hidden"
        aria-expanded={open}
        aria-controls="main-menu"
        onClick={() => setOpen((current) => !current)}
      >
        Menu
      </button>

      <ul
        id="main-menu"
        className={`${open ? "mt-2 block" : "hidden"} space-y-1 border-t border-neutral-200 pt-2 text-sm md:mt-0 md:flex md:flex-wrap md:items-center md:gap-5 md:space-y-0 md:border-0 md:pt-0`}
      >
        {LINKS.map((link) => {
          const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
          return (
            <li key={link.href}>
              <Link
                href={link.href}
                className={linkClass(link.href)}
                {...(active ? { "aria-current": "page" as const } : {})}
              >
                {link.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
