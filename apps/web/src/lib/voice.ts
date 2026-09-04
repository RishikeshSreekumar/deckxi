/**
 * Voice chat (#89): a WebRTC mesh, no media server.
 *
 * Rooms cap at six players, so a full mesh is about thirty audio streams —
 * fine for voice, and it avoids running an SFU we would have to operate and
 * pay for. If the room cap ever rises, this decision has to be revisited
 * rather than stretched.
 *
 * Signalling rides the existing socket: the peers already share a room and are
 * already authenticated, so there is nothing new to stand up. Audio itself
 * never touches our servers, which is good for privacy and means there is no
 * recording to hand anyone — see the privacy page.
 *
 * The glare rule (two peers offering at once) is settled by comparing player
 * ids: the lower id is the "polite" peer and rolls back its own offer. That is
 * the perfect-negotiation pattern, and it is why this file never queues
 * offers or invents a turn-taking protocol of its own.
 */

export interface VoiceTransport {
  /** Send a signalling blob to one peer. */
  signal(to: string, signal: VoiceSignal): void;
  /**
   * Tell the table whether this mic is live, and whether we are in the call
   * at all. Mute is not leave: a muted peer still has to be connected to.
   */
  announce(live: boolean, inCall: boolean): void;
}

export type VoiceSignal =
  | { kind: "description"; description: { type: "offer" | "answer"; sdp: string } }
  | { kind: "candidate"; candidate: RTCIceCandidateInit };

export interface VoiceMeshOptions {
  selfId: string;
  transport: VoiceTransport;
  iceServers: RTCIceServer[];
  /** Injected by tests; production uses the browser's own. */
  createConnection?: (config: RTCConfiguration) => RTCPeerConnection;
  /** Called whenever a remote track arrives, so the UI can play it. */
  onRemoteStream?: (peerId: string, stream: MediaStream) => void;
  onPeerGone?: (peerId: string) => void;
}

interface Peer {
  connection: RTCPeerConnection;
  /** Perfect negotiation bookkeeping. */
  makingOffer: boolean;
  ignoreOffer: boolean;
  polite: boolean;
}

export class VoiceMesh {
  private readonly peers = new Map<string, Peer>();
  private local: MediaStream | null = null;
  private readonly createConnection: (config: RTCConfiguration) => RTCPeerConnection;

  constructor(private readonly options: VoiceMeshOptions) {
    this.createConnection = options.createConnection ?? ((config) => new RTCPeerConnection(config));
  }

  get micLive(): boolean {
    return this.local !== null && this.local.getAudioTracks().some((track) => track.enabled);
  }

  /**
   * Ask for the mic. Rejects when the player says no, which is a normal
   * answer and not an error state: the caller shows the table without voice
   * rather than nagging.
   */
  async start(stream: MediaStream): Promise<void> {
    this.local = stream;
    for (const [, peer] of this.peers) this.addLocalTracks(peer.connection);
    this.options.transport.announce(this.micLive, true);
  }

  /** Mute without tearing the mesh down — push-to-talk toggles this. */
  setMuted(muted: boolean): void {
    for (const track of this.local?.getAudioTracks() ?? []) track.enabled = !muted;
    this.options.transport.announce(this.micLive, true);
  }

  /** Whether we already hold a connection to this peer. */
  has(peerId: string): boolean {
    return this.peers.has(peerId);
  }

  /** Open (or reuse) a connection to a peer and offer. */
  async connect(peerId: string): Promise<void> {
    const peer = this.peerFor(peerId);
    try {
      peer.makingOffer = true;
      const offer = await peer.connection.createOffer();
      await peer.connection.setLocalDescription(offer);
      const description = peer.connection.localDescription;
      if (description !== null) {
        this.options.transport.signal(peerId, {
          kind: "description",
          description: { type: description.type as "offer", sdp: description.sdp },
        });
      }
    } finally {
      peer.makingOffer = false;
    }
  }

  /** Handle one signalling message from a peer. */
  async accept(peerId: string, signal: VoiceSignal): Promise<void> {
    const peer = this.peerFor(peerId);
    const connection = peer.connection;

    if (signal.kind === "candidate") {
      try {
        await connection.addIceCandidate(signal.candidate);
      } catch (error) {
        // A candidate arriving for an offer we rolled back is expected, not a
        // failure; anything else is worth surfacing to the console only.
        if (!peer.ignoreOffer) console.warn("[voice] candidate rejected", error);
      }
      return;
    }

    const description = signal.description;
    const offerCollision =
      description.type === "offer" && (peer.makingOffer || connection.signalingState !== "stable");
    peer.ignoreOffer = !peer.polite && offerCollision;
    if (peer.ignoreOffer) return;

    await connection.setRemoteDescription(description);
    if (description.type !== "offer") return;
    const answer = await connection.createAnswer();
    await connection.setLocalDescription(answer);
    const local = connection.localDescription;
    if (local !== null) {
      this.options.transport.signal(peerId, {
        kind: "description",
        description: { type: local.type as "answer", sdp: local.sdp },
      });
    }
  }

  /** Drop one peer (they left the room, or their socket died). */
  disconnect(peerId: string): void {
    const peer = this.peers.get(peerId);
    if (peer === undefined) return;
    peer.connection.close();
    this.peers.delete(peerId);
    this.options.onPeerGone?.(peerId);
  }

  /** Tear the whole mesh down: leaving the room, or turning voice off. */
  stop(): void {
    for (const peerId of [...this.peers.keys()]) this.disconnect(peerId);
    for (const track of this.local?.getTracks() ?? []) track.stop();
    this.local = null;
    this.options.transport.announce(false, false);
  }

  /** Peer ids currently connected — the UI reads this for its indicators. */
  peerIds(): string[] {
    return [...this.peers.keys()];
  }

  private peerFor(peerId: string): Peer {
    const existing = this.peers.get(peerId);
    if (existing !== undefined) return existing;

    const connection = this.createConnection({ iceServers: this.options.iceServers });
    const peer: Peer = {
      connection,
      makingOffer: false,
      ignoreOffer: false,
      // Glare is settled by id order rather than by who asked first: both
      // peers can compute it, so neither has to be told.
      polite: this.options.selfId < peerId,
    };
    this.peers.set(peerId, peer);

    connection.onicecandidate = (event) => {
      if (event.candidate === null) return;
      this.options.transport.signal(peerId, {
        kind: "candidate",
        candidate: event.candidate.toJSON(),
      });
    };
    connection.ontrack = (event) => {
      const stream = event.streams[0];
      if (stream !== undefined) this.options.onRemoteStream?.(peerId, stream);
    };
    connection.onconnectionstatechange = () => {
      // "failed" is terminal for that peer; the room's own reconnect path
      // rebuilds the mesh, so there is nothing clever to do here.
      if (connection.connectionState === "failed") this.disconnect(peerId);
    };
    this.addLocalTracks(connection);
    return peer;
  }

  private addLocalTracks(connection: RTCPeerConnection): void {
    const stream = this.local;
    if (stream === null) return;
    const existing = new Set(connection.getSenders().map((sender) => sender.track));
    for (const track of stream.getAudioTracks()) {
      if (!existing.has(track)) connection.addTrack(track, stream);
    }
  }
}

/**
 * Ask the browser for a microphone. Separated so the permission flow is one
 * place: a denial is a normal answer, and the caller shows the table without
 * voice rather than treating it as a failure.
 */
export async function requestMicrophone(): Promise<MediaStream | null> {
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });
  } catch {
    return null;
  }
}
