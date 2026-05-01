import { beforeEach, describe, expect, it, vi } from "vitest";

const hookMocks = vi.hoisted(() => ({
  runner: {
    hasHooks: vi.fn<(_hookName?: string) => boolean>(() => false),
    runMessageSending: vi.fn<(event: unknown, ctx: unknown) => Promise<unknown>>(
      async () => undefined,
    ),
  },
}));
vi.mock("../plugins/hook-runner-global.js", () => ({
  getGlobalHookRunner: () => hookMocks.runner,
}));

let applyChannelMessageSendingHook: typeof import("./channel-message-sending.js").applyChannelMessageSendingHook;

beforeEach(async () => {
  ({ applyChannelMessageSendingHook } = await import("./channel-message-sending.js"));
  hookMocks.runner.hasHooks.mockReset();
  hookMocks.runner.hasHooks.mockReturnValue(false);
  hookMocks.runner.runMessageSending.mockReset();
  hookMocks.runner.runMessageSending.mockResolvedValue(undefined);
});

describe("applyChannelMessageSendingHook", () => {
  it("returns the original content unchanged when no message_sending hook is registered", async () => {
    const result = await applyChannelMessageSendingHook({
      to: "C123",
      content: "hello",
      channel: "slack",
    });

    expect(hookMocks.runner.runMessageSending).not.toHaveBeenCalled();
    expect(result).toEqual({ cancel: false, content: "hello" });
  });

  it("forwards the hook event with all caller-provided identifiers", async () => {
    hookMocks.runner.hasHooks.mockImplementation((name?: string) => name === "message_sending");
    hookMocks.runner.runMessageSending.mockResolvedValue(undefined);

    await applyChannelMessageSendingHook({
      to: "C123",
      content: "hello",
      channel: "slack",
      accountId: "default",
      replyToId: "1234.5678",
      threadId: "9999.0001",
      sessionKey: "session-1",
      metadata: { recipientUserId: "U123" },
    });

    expect(hookMocks.runner.runMessageSending).toHaveBeenCalledOnce();
    const [event, ctx] = hookMocks.runner.runMessageSending.mock.calls[0];
    expect(event).toEqual({
      to: "C123",
      content: "hello",
      replyToId: "1234.5678",
      threadId: "9999.0001",
      metadata: { channel: "slack", accountId: "default", recipientUserId: "U123" },
    });
    expect(ctx).toEqual({
      channelId: "slack",
      accountId: "default",
      conversationId: "C123",
      sessionKey: "session-1",
    });
  });

  it("falls back to `to` when conversationId is omitted", async () => {
    hookMocks.runner.hasHooks.mockImplementation((name?: string) => name === "message_sending");
    hookMocks.runner.runMessageSending.mockResolvedValue(undefined);

    await applyChannelMessageSendingHook({
      to: "C123",
      content: "hello",
      channel: "slack",
    });

    const [, ctx] = hookMocks.runner.runMessageSending.mock.calls[0];
    expect(ctx).toMatchObject({ conversationId: "C123" });
  });

  it("prefers explicit conversationId over `to` when both are supplied", async () => {
    hookMocks.runner.hasHooks.mockImplementation((name?: string) => name === "message_sending");
    hookMocks.runner.runMessageSending.mockResolvedValue(undefined);

    await applyChannelMessageSendingHook({
      to: "C123",
      content: "hello",
      channel: "slack",
      conversationId: "thread-root",
    });

    const [, ctx] = hookMocks.runner.runMessageSending.mock.calls[0];
    expect(ctx).toMatchObject({ conversationId: "thread-root" });
  });

  it("returns cancel:true when any plugin asks to cancel", async () => {
    hookMocks.runner.hasHooks.mockImplementation((name?: string) => name === "message_sending");
    hookMocks.runner.runMessageSending.mockResolvedValue({ cancel: true });

    const result = await applyChannelMessageSendingHook({
      to: "C123",
      content: "hello",
      channel: "slack",
    });

    expect(result).toEqual({ cancel: true, content: "hello" });
  });

  it("returns the modified content when a plugin rewrites it", async () => {
    hookMocks.runner.hasHooks.mockImplementation((name?: string) => name === "message_sending");
    hookMocks.runner.runMessageSending.mockResolvedValue({ content: "redacted" });

    const result = await applyChannelMessageSendingHook({
      to: "C123",
      content: "secret",
      channel: "slack",
    });

    expect(result).toEqual({ cancel: false, content: "redacted" });
  });

  it("ignores plugin results that omit both cancel and content", async () => {
    hookMocks.runner.hasHooks.mockImplementation((name?: string) => name === "message_sending");
    hookMocks.runner.runMessageSending.mockResolvedValue({});

    const result = await applyChannelMessageSendingHook({
      to: "C123",
      content: "hello",
      channel: "slack",
    });

    expect(result).toEqual({ cancel: false, content: "hello" });
  });

  it("does not block delivery when the hook runner throws", async () => {
    hookMocks.runner.hasHooks.mockImplementation((name?: string) => name === "message_sending");
    hookMocks.runner.runMessageSending.mockRejectedValue(new Error("boom"));

    const result = await applyChannelMessageSendingHook({
      to: "C123",
      content: "hello",
      channel: "slack",
    });

    expect(result).toEqual({ cancel: false, content: "hello" });
  });
});
