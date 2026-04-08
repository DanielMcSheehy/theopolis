// ============================================================================
// THEOPOLIS — Channel Configuration
// Slack, Discord, and Telegram adapters with multimodal support,
// thread context, tool approval cards, and multi-user awareness.
// ============================================================================

import { createSlackAdapter } from '@chat-adapter/slack';
import { createDiscordAdapter } from '@chat-adapter/discord';
import { createTelegramAdapter } from '@chat-adapter/telegram';

// ---------------------------------------------------------------------------
// Slack Adapter — Workspace integration with thread context
// ---------------------------------------------------------------------------
export const slackAdapter = createSlackAdapter({
  // Credentials from environment:
  // SLACK_BOT_TOKEN, SLACK_SIGNING_SECRET, SLACK_APP_TOKEN
});

// ---------------------------------------------------------------------------
// Discord Adapter — Server integration with multimodal
// ---------------------------------------------------------------------------
export const discordAdapter = createDiscordAdapter({
  // Credentials from environment:
  // DISCORD_TOKEN, DISCORD_APPLICATION_ID, DISCORD_PUBLIC_KEY
});

// ---------------------------------------------------------------------------
// Telegram Adapter
// ---------------------------------------------------------------------------
export const telegramAdapter = createTelegramAdapter({
  // Credentials from environment:
  // TELEGRAM_BOT_TOKEN
});

// ---------------------------------------------------------------------------
// Channel Configuration for the Supervisor Agent
// ---------------------------------------------------------------------------
export const channelConfig = {
  adapters: {
    slack: slackAdapter,
    discord: discordAdapter,
    telegram: telegramAdapter,
  },
  // Fetch last 15 messages on first mention in a thread
  threadContext: {
    maxMessages: 15,
  },
  // Inline images and videos for vision-capable models
  inlineMedia: ['image/*', 'video/*', 'audio/*'] as string[],
  // Recognize YouTube and common image hosts
  inlineLinks: [
    { match: 'youtube.com', mimeType: 'video/*' },
    { match: 'youtu.be', mimeType: 'video/*' },
    'imgur.com',
    'i.redd.it',
  ] as Array<string | { match: string; mimeType: string }>,
};
