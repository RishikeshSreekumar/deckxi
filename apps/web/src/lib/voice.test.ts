/**
 * The voice mesh (#89), driven with a fake peer connection.
 *
 * The parts worth pinning down are the ones that go wrong silently in a real
 * call: glare (both peers offering at once), an answer being produced for
 * every offer, tracks reaching every peer, and teardown actually stopping the
 * microphone. None of that needs a browser — it needs a connection object that
 * records what was asked of it.
 */
import { describe, expect, it, vi } from "vitest";
import { VoiceMesh, type VoiceSignal } from "./voice.js";

class FakeConnection {
  signalingState: RTCSignalingState = "stable";
  connectionState: RTCPeerConnectionState = "new";
  localDescription: { type: string; sdp: string } | null = null;
  remoteDescription: { type: string; sdp: string } | null = null;
  readonly senders: { track: MediaStreamTrack | null }[] = [];
  readonly candidates: RTCIceCandidateInit[] = [];
  closed = false;
  onicecandidate: ((event: { candidate: RTCIceCandidate | null }) => void) | null = null;
  ontrack: ((event: { streams: MediaStream[] }) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;

  createOffer(): Promise<{ type: string; sdp: string }> {
    return Promise.resolve({ type: "offer", sdp: "offer-sdp" });
  }
  createAnswer(): Promise<{ type: string; sdp: string }> {
    return Promise.resolve({ type: "answer", sdp: "answer-sdp" });
  }
  setLocalDescription(description: { type: string; sdp: string }): Promise<void> {
    this.localDescription = description;
    this.signalingState = description.type === "offer" ? "have-local-offer" : "stable";
    return Promise.resolve();
  }
  setRemoteDescription(description: { type: string; sdp: string }): Promise<void> {
    this.remoteDescription = description;
    this.signalingState = description.type === "offer" ? "have-remote-offer" : "stable";
    return Promise.resolve();
  }
  addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    this.candidates.push(candidate);
    return Promise.resolve();
  }
  addTrack(track: MediaStreamTrack): { track: MediaStreamTrack } {
    const sender = { track };
    this.senders.push(sender);
    return sender;
  }
  getSenders(): { track: MediaStreamTrack | null }[] {
    return this.senders;
  }
  close(): void {
    this.closed = true;
  }
}

function fakeStream(): { stream: MediaStream; track: { enabled: boolean; stopped: boolean } } {
  const track = { enabled: true, stopped: false, kind: "audio" };
  const stream = {
    getAudioTracks: () => [track],
    getTracks: () => [track],
  } as unknown as MediaStream;
  return { stream, track: track as unknown as { enabled: boolean; stopped: boolean } };
}

function mesh(selfId: string) {
  const connections = new Map<number, FakeConnection>();
  let made = 0;
  const signals: { to: string; signal: VoiceSignal }[] = [];
  const announced: boolean[] = [];
  const instance = new VoiceMesh({
    selfId,
    iceServers: [],
    transport: {
      signal: (to, signal) => signals.push({ to, signal }),
      announce: (live) => announced.push(live),
    },
    createConnection: () => {
      const connection = new FakeConnection();
      connections.set(made++, connection);
      return connection as unknown as RTCPeerConnection;
    },
  });
  return { instance, connections, signals, announced };
}

describe("VoiceMesh", () => {
  it("offers to a peer and sends its own description", async () => {
    const { instance, signals } = mesh("aaa");
    await instance.connect("bbb");
    expect(signals).toHaveLength(1);
    expect(signals[0]?.to).toBe("bbb");
    expect(signals[0]?.signal).toMatchObject({
      kind: "description",
      description: { type: "offer" },
    });
  });

  it("answers an offer", async () => {
    const { instance, signals } = mesh("aaa");
    await instance.accept("bbb", {
      kind: "description",
      description: { type: "offer", sdp: "theirs" },
    });
    expect(signals[0]?.signal).toMatchObject({
      kind: "description",
      description: { type: "answer" },
    });
  });

  it("settles glare by id order — the lower id yields", async () => {
    // "aaa" < "bbb", so aaa is polite: it accepts the colliding offer.
    const polite = mesh("aaa");
    await polite.instance.connect("bbb");
    await polite.instance.accept("bbb", {
      kind: "description",
      description: { type: "offer", sdp: "theirs" },
    });
    expect(polite.signals.at(-1)?.signal).toMatchObject({
      description: { type: "answer" },
    });

    // "zzz" > "bbb", so it is impolite: the colliding offer is ignored and it
    // keeps its own, which is what stops both sides backing down at once.
    const impolite = mesh("zzz");
    await impolite.instance.connect("bbb");
    const before = impolite.signals.length;
    await impolite.instance.accept("bbb", {
      kind: "description",
      description: { type: "offer", sdp: "theirs" },
    });
    expect(impolite.signals).toHaveLength(before);
  });

  it("adds the local mic to every peer, including ones opened later", async () => {
    const { instance, connections } = mesh("aaa");
    const { stream } = fakeStream();
    await instance.connect("bbb");
    await instance.start(stream);
    await instance.connect("ccc");

    expect(connections.get(0)?.senders).toHaveLength(1);
    expect(connections.get(1)?.senders).toHaveLength(1);
  });

  it("mutes by disabling the track, not by dropping the connection", async () => {
    const { instance, connections, announced } = mesh("aaa");
    const { stream, track } = fakeStream();
    await instance.connect("bbb");
    await instance.start(stream);

    instance.setMuted(true);
    expect(track.enabled).toBe(false);
    expect(connections.get(0)?.closed).toBe(false);
    // The table is told, because a live mic must always be visible.
    expect(announced.at(-1)).toBe(false);

    instance.setMuted(false);
    expect(announced.at(-1)).toBe(true);
  });

  it("relays ICE candidates out and in", async () => {
    const { instance, connections, signals } = mesh("aaa");
    await instance.connect("bbb");
    const connection = connections.get(0);
    connection?.onicecandidate?.({
      candidate: { toJSON: () => ({ candidate: "candidate:1" }) } as unknown as RTCIceCandidate,
    });
    expect(signals.at(-1)?.signal).toMatchObject({ kind: "candidate" });

    await instance.accept("bbb", { kind: "candidate", candidate: { candidate: "candidate:2" } });
    expect(connection?.candidates).toHaveLength(1);
  });

  it("drops a peer whose connection fails", async () => {
    const gone = vi.fn();
    const connections = new Map<number, FakeConnection>();
    const instance = new VoiceMesh({
      selfId: "aaa",
      iceServers: [],
      transport: { signal: () => undefined, announce: () => undefined },
      createConnection: () => {
        const connection = new FakeConnection();
        connections.set(connections.size, connection);
        return connection as unknown as RTCPeerConnection;
      },
      onPeerGone: gone,
    });
    await instance.connect("bbb");
    const connection = connections.get(0);
    if (connection !== undefined) {
      connection.connectionState = "failed";
      connection.onconnectionstatechange?.();
    }
    expect(gone).toHaveBeenCalledWith("bbb");
    expect(instance.peerIds()).toEqual([]);
  });

  it("stops the microphone when the mesh is torn down", async () => {
    const { instance, connections, announced } = mesh("aaa");
    const stopped = vi.fn();
    const track = { enabled: true, stop: stopped };
    const stream = {
      getAudioTracks: () => [track],
      getTracks: () => [track],
    } as unknown as MediaStream;
    await instance.connect("bbb");
    await instance.start(stream);

    instance.stop();
    expect(connections.get(0)?.closed).toBe(true);
    expect(stopped).toHaveBeenCalled();
    expect(announced.at(-1)).toBe(false);
    expect(instance.peerIds()).toEqual([]);
  });
});
