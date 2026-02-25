"use client";

type Props = {
  listingId: string;
  href: string;
  children: React.ReactNode;
  className?: string;
};

export function TrackOutbound({ listingId, href, children, className }: Props) {
  const handleClick = (e: React.MouseEvent) => {
    fetch("/api/events", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ listingId, type: "outbound" }),
    }).catch(() => {});
    // allow default (open link)
  };

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={handleClick}
      className={className}
    >
      {children}
    </a>
  );
}
