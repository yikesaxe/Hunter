"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const NAV_LINKS = [
  { label: "Browse", href: "/" },
  { label: "Saved", href: "#" },
  { label: "Comparisons", href: "#" },
  { label: "Runs", href: "/runs" },
];

export function NavBar() {
  const pathname = usePathname();
  const [clickedLabel, setClickedLabel] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);
  const lastScrollY = useRef(0);

  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY;
      if (y < 80) {
        setHidden(false);
      } else if (y > lastScrollY.current + 8) {
        setHidden(true);
      } else if (y < lastScrollY.current - 4) {
        setHidden(false);
      }
      lastScrollY.current = y;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className="sticky top-0 z-40 h-16 pointer-events-none transition-transform duration-300"
      style={{ transform: hidden ? "translateY(calc(-100% - 40px))" : "translateY(0)" }}
    >
      <div className="relative h-full pl-14 pr-14 pt-5 flex items-center pointer-events-none">

        {/* H Badge */}
        <Link
          href="/"
          onClick={() => setClickedLabel(null)}
          className="pointer-events-auto shrink-0 w-[46px] h-[46px] flex items-center justify-center rounded-[13px] bg-[var(--accent)] shadow-[0_3px_14px_rgba(232,113,74,0.35)] hover:shadow-[0_5px_22px_rgba(232,113,74,0.48)] hover:-translate-y-0.5 transition-all duration-200"
        >
          <span
            className="font-serif font-bold text-white select-none"
            style={{ fontSize: "1.875rem", lineHeight: 1, display: "block" }}
          >
            H
          </span>
        </Link>

        {/* Centered floating pill nav */}
        <nav className="pointer-events-auto absolute left-1/2 -translate-x-1/2 hidden md:flex items-center gap-1.5 bg-[var(--card)] border border-[var(--border)] rounded-full px-2 py-2 shadow-[0_3px_24px_rgba(0,0,0,0.08),0_0_0_0.5px_rgba(0,0,0,0.03)]">
          {NAV_LINKS.map(({ label, href }) => {
            const isActive =
              href === "#"
                ? clickedLabel === label
                : pathname === href;

            return isActive ? (
              <span
                key={label}
                className="px-5 py-[9px] rounded-full bg-[var(--accent)] text-white text-[0.875rem] font-medium leading-none shadow-[0_1px_6px_rgba(232,113,74,0.3)] cursor-default select-none"
              >
                {label}
              </span>
            ) : (
              <Link
                key={label}
                href={href}
                onClick={() =>
                  setClickedLabel(href === "#" ? label : null)
                }
                className="px-5 py-[9px] rounded-full text-[var(--muted)] text-[0.875rem] font-medium leading-none hover:text-[var(--foreground)] hover:bg-[var(--surface)] transition-all duration-150"
              >
                {label}
              </Link>
            );
          })}
        </nav>

        {/* Right actions */}
        <div className="pointer-events-auto ml-auto flex items-center gap-2">
          {/* Bell */}
          <button
            type="button"
            aria-label="Notifications"
            className="w-10 h-10 flex items-center justify-center rounded-full text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--surface)] transition-colors"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
          </button>

          {/* Get Started */}
          <Link
            href="/onboarding"
            className="px-5 py-[9px] text-[0.875rem] font-medium rounded-full bg-[var(--foreground)] text-[var(--background)] hover:bg-[var(--accent)] hover:shadow-[0_2px_14px_rgba(232,113,74,0.38)] transition-all duration-200"
          >
            Get Started
          </Link>
        </div>

      </div>
    </header>
  );
}
