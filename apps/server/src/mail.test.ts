/**
 * #93 — magic-link email actually leaves the building.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMagicLinkSender, MailNotConfiguredError } from "./mail.js";
import { nullLogger } from "./logging.js";
import { startTestServer, type TestServer } from "./testkit.js";

const mail = {
  email: "fan@example.com",
  url: "https://api.deckxi.example/api/auth/magic-link/verify?token=abc",
  token: "abc",
};

const configured = {
  apiKey: "re_test_key",
  from: "DeckXI <play@deckxi.example>",
  isDeployment: true,
  log: nullLogger,
};

let server: TestServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

describe("magic-link sender", () => {
  it("posts the recipient and the link to the provider", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = vi.fn((url: string, init: RequestInit) => {
      calls.push({ url, init });
      return Promise.resolve(new Response("{}", { status: 200 }));
    });
    const send = createMagicLinkSender({
      ...configured,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await send?.(mail);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://api.resend.com/emails");
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers["authorization"]).toBe("Bearer re_test_key");
    const body = JSON.parse(calls[0]?.init.body as string) as {
      from: string;
      to: string[];
      subject: string;
      html: string;
      text: string;
    };
    expect(body.to).toEqual(["fan@example.com"]);
    expect(body.from).toBe("DeckXI <play@deckxi.example>");
    expect(body.subject).toContain("sign-in link");
    // Both parts carry the link — a text-only client must still be able to
    // sign in.
    expect(body.html).toContain(mail.url);
    expect(body.text).toContain(mail.url);
  });

  it("throws when the provider refuses, so the sign-in request fails loudly", async () => {
    const send = createMagicLinkSender({
      ...configured,
      fetchImpl: (() =>
        Promise.resolve(new Response("domain not verified", { status: 403 }))) as typeof fetch,
    });
    await expect(send?.(mail)).rejects.toThrow(/403/);
  });

  it("keeps the dev default locally, where logging the link is a usable flow", () => {
    expect(
      createMagicLinkSender({
        apiKey: undefined,
        from: undefined,
        isDeployment: false,
        log: nullLogger,
      }),
    ).toBeUndefined();
  });

  it("fails every send when a deployment has no mail configured", async () => {
    const send = createMagicLinkSender({
      apiKey: undefined,
      from: undefined,
      isDeployment: true,
      log: nullLogger,
    });
    expect(send).toBeDefined();
    await expect(send?.(mail)).rejects.toBeInstanceOf(MailNotConfiguredError);
  });
});

describe("the auth flow calls the hook", () => {
  it("hands it the address that asked and a link that verifies", async () => {
    const sent: { email: string; url: string }[] = [];
    server = await startTestServer({
      auth: { sendMagicLink: (m) => void sent.push({ email: m.email, url: m.url }) },
    });

    const response = await fetch(`${server.url}/api/auth/sign-in/magic-link`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "player@example.com" }),
    });
    expect(response.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.email).toBe("player@example.com");
    expect(sent[0]?.url).toContain("/api/auth/magic-link/verify");

    // The link in the mail is the one that signs you in.
    const verified = await fetch(
      (sent[0]?.url ?? "").replace("http://localhost:3001", server.url),
      { redirect: "manual" },
    );
    expect([200, 302]).toContain(verified.status);
  });
});
