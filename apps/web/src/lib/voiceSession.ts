/**
 * The one live voice call this tab can be in (#89).
 *
 * `VoiceMesh` is the pure-ish machinery; this is the wiring — the socket, the
 * mic permission, the ICE config from the server, and the audio elements that
 * actually make a peer audible. It is loaded on demand: WebRTC is only ever
 * needed by a player who asks for voice, and the initial payload has a budget.
 */
import type { VoiceSignalView } from "@deckxi/shared";
import { API_URL, call } from "./socket.js";
import { requestMicrophone, VoiceMesh, type VoiceSignal } from "./voice.js";

let mesh: VoiceMesh | null = null;
/** One <audio> per peer, kept out of the DOM tree the app renders. */
const players = new Map<string, HTMLAudioElement>();

async function fetchIceServers(): Promise<RTCIceServer[]> {
  try {
    const response = await fetch(`${API_URL}/api/voice/ice`, { credentials: "include" });
    if (!response.ok) return [];
    const body = (await response.json()) as { iceServers: RTCIceServer[] };
    return body.iceServers;
  } catch {
    // No ICE config means STUN-less, which will fail for most peers — but
    // failing to connect is still better than not trying, and the UI shows
    // who actually connected.
    return [];
  }
}

function play(peerId: string, stream: MediaStream): void {
  let element = players.get(peerId);
  if (element === undefined) {
    element = new Audio();
    element.autoplay = true;
    players.set(peerId, element);
  }
  element.srcObject = stream;
  // Autoplay may be blocked until the player interacts with the page; they
  // just tapped a button to join the call, so this is nearly always allowed.
  void element.play().catch(() => undefined);
}

/** Returns false when the player refused the microphone. */
export async function startVoice(options: {
  selfId: string | null;
  peerIds: string[];
}): Promise<boolean> {
  if (options.selfId === null) return false;
  const stream = await requestMicrophone();
  if (stream === null) return false;

  const iceServers = await fetchIceServers();
  mesh = new VoiceMesh({
    selfId: options.selfId,
    iceServers,
    transport: {
      signal(to, signal) {
        // The wire schema requires a candidate string; the browser's
        // `RTCIceCandidateInit` has it optional, and an end-of-candidates
        // sentinel (no candidate) carries nothing a peer needs here.
        if (signal.kind === "candidate" && typeof signal.candidate.candidate !== "string") return;
        void call<"voice:signal", null>("voice:signal", {
          to,
          signal: signal as Parameters<typeof call<"voice:signal", null>>[1]["signal"],
        }).catch(() => undefined);
      },
      announce(live) {
        void call<"voice:state", null>("voice:state", { live }).catch(() => undefined);
      },
    },
    onRemoteStream: play,
    onPeerGone(peerId) {
      const element = players.get(peerId);
      if (element !== undefined) {
        element.srcObject = null;
        players.delete(peerId);
      }
    },
  });

  await mesh.start(stream);
  // Offer to everyone already at the table. Whoever joins later offers to us,
  // and the glare rule in VoiceMesh settles any overlap.
  for (const peerId of options.peerIds) await mesh.connect(peerId);
  return true;
}

export function handleSignal(message: VoiceSignalView): void {
  void mesh?.accept(message.from, message.signal as VoiceSignal).catch(() => undefined);
}

export function setMuted(muted: boolean): void {
  mesh?.setMuted(muted);
}

export function stopVoice(): void {
  mesh?.stop();
  mesh = null;
  for (const element of players.values()) element.srcObject = null;
  players.clear();
}
