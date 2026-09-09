/** Invite links and the copy button behind them, shared by the lobby and its sheets. */
import { useState } from "react";

export function inviteUrl(code: string): string {
  return `${location.origin}/join/${code}`;
}

/**
 * Copy with a fallback for browsers that refuse the async clipboard (no
 * permission, insecure context), and a "Copied!" either way — a copy button
 * that says nothing back looks broken.
 */
export function useCopy(text: string): { copied: boolean; copy: () => void } {
  const [copied, setCopied] = useState(false);
  const done = () => {
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return {
    copied,
    copy: () => {
      const legacy = () => {
        const area = document.createElement("textarea");
        area.value = text;
        area.setAttribute("readonly", "");
        area.style.position = "fixed";
        area.style.opacity = "0";
        document.body.append(area);
        area.select();
        try {
          document.execCommand("copy");
        } finally {
          area.remove();
        }
        done();
      };
      if (navigator.clipboard === undefined) {
        legacy();
        return;
      }
      void navigator.clipboard.writeText(text).then(done).catch(legacy);
    },
  };
}
