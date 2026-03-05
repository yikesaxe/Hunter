"use client";

import { useEffect, useState } from "react";

const CHAR_LIMIT = 360;

export function ListingDescription({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const needsTruncation = text.length > CHAR_LIMIT;
  const displayText = needsTruncation ? text.slice(0, CHAR_LIMIT).trimEnd() : text;

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  return (
    <>
      <div>
        <p className="text-[var(--foreground)] text-base leading-relaxed whitespace-pre-line">
          {displayText}{needsTruncation && "…"}
        </p>
        {needsTruncation && (
          <button
            onClick={() => setOpen(true)}
            className="mt-3 text-base font-semibold underline underline-offset-2 hover:text-[var(--muted)] transition-colors"
          >
            Show more →
          </button>
        )}
      </div>

      {open && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center p-6"
          style={{ backgroundColor: "rgba(0,0,0,0.55)" }}
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-[var(--card)] rounded-2xl w-full max-w-xl max-h-[82vh] flex flex-col shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-8 pt-6 pb-5 border-b border-[var(--border)] shrink-0">
              <h3 className="font-semibold text-base text-[var(--foreground)]">About this listing</h3>
              <button
                onClick={() => setOpen(false)}
                className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-[var(--surface)] transition-colors text-[var(--foreground)]"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="overflow-y-auto px-8 py-6 scrollbar-thin">
              <p className="text-[var(--foreground)] text-base leading-relaxed whitespace-pre-line">
                {text}
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
