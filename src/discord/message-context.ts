import type { Client, Message } from 'discord.js';

import type { AppConfig } from '../config/env.js';

interface ReplyContextInput {
  currentMessage: string;
  conversation: string;
  guildName: string;
  channelName: string;
  authorName: string;
}

export interface PromptContext {
  prompt: string;
  metadata: {
    guildName: string;
    channelName: string;
    authorName: string;
  };
}

export function shouldRespond(message: Message, config: AppConfig, client: Client): boolean {
  if (message.author.bot || !client.user) {
    return false;
  }

  const isMentioned = message.mentions.users.has(client.user.id);
  const isAllowedChannel = config.discord.allowedChannelIds.includes(message.channelId);

  if (isAllowedChannel) {
    return true;
  }

  if (config.discord.allowedChannelIds.length > 0) {
    return isMentioned;
  }

  return config.discord.requireMention ? isMentioned : true;
}

export async function buildPromptContext(
  message: Message,
  client: Client,
  maxMessages: number
): Promise<PromptContext | null> {
  const promptText = extractPromptText(message, client.user?.id);
  if (!promptText) {
    return null;
  }

  const conversation = await collectConversation(message, maxMessages);
  return {
    prompt: renderPrompt({
      currentMessage: promptText,
      conversation,
      guildName: message.guild?.name ?? 'Direct Message',
      channelName: 'name' in message.channel ? (message.channel.name ?? 'unknown-channel') : 'unknown-channel',
      authorName: message.author.displayName ?? message.author.username
    }),
    metadata: {
      guildName: message.guild?.name ?? 'Direct Message',
      channelName: 'name' in message.channel ? (message.channel.name ?? 'unknown-channel') : 'unknown-channel',
      authorName: message.author.displayName ?? message.author.username
    }
  };
}

function extractPromptText(message: Message, botUserId?: string): string {
  const withoutMention = botUserId
    ? message.content.replace(new RegExp(`<@!?${botUserId}>`, 'g'), '').trim()
    : message.content.trim();

  const attachmentLines = [...message.attachments.values()].map((attachment) => {
    const kind = attachment.contentType ? ` (${attachment.contentType})` : '';
    return `- ${attachment.name ?? 'attachment'}${kind}: ${attachment.url}`;
  });

  const parts = [withoutMention];
  if (attachmentLines.length > 0) {
    parts.push(`Attachments:\n${attachmentLines.join('\n')}`);
  }

  return parts
    .map((part) => part.trim())
    .filter(Boolean)
    .join('\n\n');
}

async function collectConversation(message: Message, maxMessages: number): Promise<string> {
  if (!('messages' in message.channel)) {
    return '';
  }

  try {
    const recentMessages = await message.channel.messages.fetch({ limit: maxMessages });

    return [...recentMessages.values()]
      .sort((left, right) => left.createdTimestamp - right.createdTimestamp)
      .map((entry) => formatConversationLine(entry))
      .filter(Boolean)
      .join('\n');
  } catch {
    return '';
  }
}

function formatConversationLine(message: Message): string {
  const content = message.content.trim();
  const attachmentSummary = [...message.attachments.values()]
    .map((attachment) => attachment.name ?? 'attachment')
    .join(', ');

  const segments = [content];
  if (attachmentSummary) {
    segments.push(`[attachments: ${attachmentSummary}]`);
  }

  const merged = segments.filter(Boolean).join(' ').trim();
  if (!merged) {
    return '';
  }

  const role = message.author.bot ? 'assistant' : 'user';
  const authorName = message.author.displayName ?? message.author.username;
  return `[${role}] ${authorName}: ${truncate(merged, 500)}`;
}

function renderPrompt(input: ReplyContextInput): string {
  return [
    `Guild: ${input.guildName}`,
    `Channel: ${input.channelName}`,
    `Current user: ${input.authorName}`,
    '',
    'Recent conversation:',
    input.conversation || '(no recent context)',
    '',
    'Current message:',
    input.currentMessage,
    '',
    'Write the Discord reply only.'
  ].join('\n');
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}
