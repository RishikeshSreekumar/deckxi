/**
 * Per-tab persistence: the resume token (survives reloads, not tab close) and
 * small localStorage conveniences (name, mute, haptics). All guarded — storage access
 * can throw in private windows.
 */
export interface StoredSession {
  roomId: string;
  resumeToken: string;
}

const SESSION_KEY = "deckxi:session";
const NAME_KEY = "deckxi:name";
const MUTE_KEY = "deckxi:muted";
const HAPTICS_KEY = "deckxi:haptics";

export function saveSession(session: StoredSession): void {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    /* private window */
  }
}

export function loadSession(): StoredSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as StoredSession).roomId === "string" &&
      typeof (parsed as StoredSession).resumeToken === "string"
    ) {
      return parsed as StoredSession;
    }
  } catch {
    /* corrupted or unavailable */
  }
  return null;
}

export function clearSession(): void {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

export function savePlayerName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    /* ignore */
  }
}

export function loadPlayerName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

export function saveMuted(muted: boolean): void {
  try {
    localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
  } catch {
    /* ignore */
  }
}

export function loadMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

export function saveHaptics(enabled: boolean): void {
  try {
    localStorage.setItem(HAPTICS_KEY, enabled ? "1" : "0");
  } catch {
    /* ignore */
  }
}

/** Defaults to on: the pulses are short, and a setting nobody finds is off forever. */
export function loadHaptics(): boolean {
  try {
    return localStorage.getItem(HAPTICS_KEY) !== "0";
  } catch {
    return true;
  }
}
