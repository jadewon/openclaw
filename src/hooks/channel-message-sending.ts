// Channel-side helper for firing the `message_sending` plugin hook from
// channel dispatcher delivery paths (Slack `deliverReplies`, the various
// stream-fallback flows, and equivalent dispatchers in other channels) that
// bypass `deliverOutboundPayloads`.
//
// `deliverOutboundPayloads` is the canonical path that fires `message_sending`
// via its private `applyMessageSendingHook` wrapper. Channel dispatchers like
// `extensions/slack/src/monitor/replies.ts` `deliverReplies` historically call
// the low-level send (`sendMessageSlack`, etc.) directly, bypassing this hook.
// Plugins listening on `message_sending` (content filters, reply guards) then
// silently miss those messages.
//
// Surfacing a public helper lets each dispatcher fire the hook itself with the
// minimum context needed for the existing hook contract — without exposing the
// global hook runner or duplicating the cancel / content-modify / error-swallow
// logic at every call site.

import { getGlobalHookRunner } from "../plugins/hook-runner-global.js";

export type ChannelMessageSendingHookParams = {
  to: string;
  content: string;
  channel: string;
  accountId?: string;
  replyToId?: string | number;
  threadId?: string | number;
  conversationId?: string;
  sessionKey?: string;
  /**
   * Free-form metadata forwarded to the plugin hook event. Channel
   * dispatchers that fan one outbound payload into multiple sends (per-URL
   * media chunks, per-chunk text) should pass per-call metadata here — e.g.
   * a single-element `mediaUrls` array per media send rather than the
   * payload's full mediaUrls list — so plugins observe one
   * `message_sending` event per actual delivery attempt.
   */
  metadata?: Record<string, unknown>;
};

export type ChannelMessageSendingHookOutcome = {
  cancel: boolean;
  content: string;
};

/**
 * Fire the `message_sending` plugin hook for a single outbound message
 * delivered by a channel dispatcher path that bypasses
 * `deliverOutboundPayloads`.
 *
 * Returns `{ cancel: true }` when any plugin asked to cancel — callers must
 * skip the underlying send. Otherwise returns the (possibly modified) content
 * the caller should send.
 *
 * Hook failures never block delivery (matches the in-pipeline behavior of
 * `applyMessageSendingHook` in `src/infra/outbound/deliver.ts`).
 */
export async function applyChannelMessageSendingHook(
  params: ChannelMessageSendingHookParams,
): Promise<ChannelMessageSendingHookOutcome> {
  const hookRunner = getGlobalHookRunner();
  if (!hookRunner?.hasHooks("message_sending")) {
    return { cancel: false, content: params.content };
  }
  try {
    const result = await hookRunner.runMessageSending(
      {
        to: params.to,
        content: params.content,
        replyToId: params.replyToId,
        threadId: params.threadId,
        metadata: {
          channel: params.channel,
          accountId: params.accountId,
          ...params.metadata,
        },
      },
      {
        channelId: params.channel,
        accountId: params.accountId,
        conversationId: params.conversationId ?? params.to,
        sessionKey: params.sessionKey,
      },
    );
    if (result?.cancel === true) {
      return { cancel: true, content: params.content };
    }
    if (typeof result?.content === "string") {
      return { cancel: false, content: result.content };
    }
    return { cancel: false, content: params.content };
  } catch {
    // Don't block delivery on hook failure.
    return { cancel: false, content: params.content };
  }
}
