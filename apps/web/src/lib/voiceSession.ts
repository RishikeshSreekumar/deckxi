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
/**
 * One <audio> per peer. It has to be *in* the document: iOS Safari will not
 * play a remote MediaStream from a detached element, which is the difference
 * between a working call and a silent one on half our players' phones. They
 * live in a hidden holder outside React's tree so a re-render cannot drop
 * them mid-sentence.
 */
const players = new Map<string, HTMLAudioElement>();
let holder: HTMLElement | null = null;

function audioHolder(): HTMLElement {
  if (holder !== null) return holder;
  const element = document.createElement("div");
  element.id = "voice-audio";
  element.style.display = "none";
  document.body.appendChild(element);
  holder = element;
  return element;
}

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
    element = document.createElement("audio");
    element.autoplay = true;
    // iOS refuses to play audio from an element it thinks wants fullscreen.
    element.setAttribute("playsinline", "");
    audioHolder().appendChild(element);
    players.set(peerId, element);
  }
  element.srcObject = stream;
  // Autoplay may be blocked until the player interacts with the page; they
  // just tapped a button to join the call, so this is nearly always allowed.
  void element.play().catch(() => undefined);
}

/** Returns false when the player refused the microphone. */
export async function startVoice(options: { selfId: string | null }): Promise<boolean> {
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
      announce(live, inCall) {
        void call<"voice:state", null>("voice:state", { live, inCall }).catch(() => undefined);
      },
    },
    onRemoteStream: play,
    onPeerGone(peerId) {
      const element = players.get(peerId);
      if (element !== undefined) {
        element.srcObject = null;
        element.remove();
        players.delete(peerId);
      }
    },
  });

  await mesh.start(stream);
  // No offers here: starting announces us, the server tells the table who is
  // in the call, and `syncPeers` builds the mesh from that. Offering to a
  // player who has not joined voice yet only wedges the connection — they
  // have no mesh to answer with, and the offer we are left holding makes us
  // ignore theirs when they do join.
  return true;
}

/**
 * Reconcile the mesh with who the server says is in the call. Both sides run
 * this and may offer at once; that is ordinary glare, and `VoiceMesh` settles
 * it by id order.
 */
export async function syncPeers(inCall: string[]): Promise<void> {
  const current = mesh;
  if (current === null) return;
  const wanted = new Set(inCall);
  for (const peerId of current.peerIds()) {
    if (!wanted.has(peerId)) current.disconnect(peerId);
  }
  for (const peerId of wanted) {
    if (!current.has(peerId)) await current.connect(peerId);
  }
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
  for (const element of players.values()) {
    element.srcObject = null;
    element.remove();
  }
  players.clear();
}
