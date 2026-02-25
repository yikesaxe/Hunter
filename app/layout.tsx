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
          href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500;600;700&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen antialiased font-sans">
        <header className="bg-[var(--card)] border-b border-[var(--border)] sticky top-0 z-40">
          <div className="mx-auto max-w-6xl px-5 sm:px-8 h-14 flex items-center justify-between">
            <a href="/" className="font-serif text-xl font-semibold tracking-tight text-[var(--foreground)]">
              Hunter
            </a>
            <nav className="flex items-center gap-1">
              <a
                href="/"
                className="px-3 py-1.5 text-sm text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--surface)] rounded-md transition-colors"
              >
                Listings
              </a>
              <a
                href="/runs"
                className="px-3 py-1.5 text-sm text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--surface)] rounded-md transition-colors"
              >
                Runs
              </a>
              <a
                href="/onboarding"
                className="ml-2 px-3 py-1.5 text-sm font-medium rounded-md transition-colors"
                style={{ background: "var(--accent-light)", color: "var(--accent)" }}
              >
                Get started
              </a>
            </nav>
          </div>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
