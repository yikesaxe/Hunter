import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Hunter — NYC Apartments",
  description: "Find NYC apartment listings",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen antialiased font-sans">
        <header className="bg-[var(--card)] border-b border-[var(--border)] sticky top-0 z-40">
          <div className="px-6 sm:px-10 h-14 flex items-center justify-between gap-6">
            {/* Logo */}
            <a href="/" className="font-serif text-[1.35rem] font-semibold tracking-tight text-[var(--foreground)] shrink-0">
              Hunter
            </a>

            {/* Nav links */}
            <nav className="hidden md:flex items-center gap-7">
              <a
                href="/"
                className="text-sm font-medium text-[var(--foreground)] pb-0.5 border-b-2 border-[var(--accent)]"
              >
                Browse
              </a>
              <a
                href="#"
                className="text-sm text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
              >
                Saved
              </a>
              <a
                href="#"
                className="text-sm text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
              >
                Comparisons
              </a>
              <a
                href="/runs"
                className="text-sm text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
              >
                Runs
              </a>
            </nav>

            {/* Right actions */}
            <div className="flex items-center gap-2 ml-auto">
              {/* Search icon */}
              <button
                type="button"
                aria-label="Search"
                className="w-9 h-9 flex items-center justify-center rounded-full text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--surface)] transition-colors"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
              </button>

              {/* Bell icon */}
              <button
                type="button"
                aria-label="Notifications"
                className="w-9 h-9 flex items-center justify-center rounded-full text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--surface)] transition-colors relative"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                  <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                </svg>
              </button>

              {/* Get Started */}
              <a
                href="/onboarding"
                className="ml-1 px-4 py-2 text-sm font-medium rounded-lg border border-[var(--accent)] text-[var(--accent)] bg-[var(--accent-light)] hover:bg-[var(--accent)] hover:text-white transition-colors"
              >
                Get Started
              </a>
            </div>
          </div>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
