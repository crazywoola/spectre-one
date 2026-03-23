import {
  Client,
  Events,
  GatewayIntentBits,
  Partials,
  type Message
} from 'discord.js';

import type { AppConfig } from '../config/env.js';
import { logger } from '../shared/logger.js';
import { splitDiscordMessage } from '../shared/text.js';
import { buildPromptContext, shouldRespond } from './message-context.js';
import { ReplyService } from '../openai/reply-service.js';

const GENERIC_FAILURE_MESSAGE = '我这边处理消息时出了点问题，请稍后再试。';

export function createDiscordBot(config: AppConfig, replyService: ReplyService): Client {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages
    ],
    partials: [Partials.Channel]
  });

  client.once(Events.ClientReady, (readyClient) => {
    logger.info('discord_ready', {
      user: readyClient.user.tag,
      dosuSource: config.dosu.source
    });
  });

  client.on(Events.MessageCreate, async (message) => {
    if (!shouldRespond(message, config, client)) {
      return;
    }

    await handleMessage(message, client, config, replyService);
  });

  client.on(Events.Error, (error) => {
    logger.error('discord_client_error', { error });
  });

  return client;
}

async function handleMessage(
  message: Message,
  client: Client,
  config: AppConfig,
  replyService: ReplyService
): Promise<void> {
  const promptContext = await buildPromptContext(message, client, config.bot.maxContextMessages);
  if (!promptContext) {
    return;
  }

  try {
    await sendTyping(message);

    const reply = await replyService.generateReply(promptContext.prompt);
    await replyToMessage(message, reply);

    logger.info('message_replied', {
      guild: promptContext.metadata.guildName,
      channel: promptContext.metadata.channelName,
      author: promptContext.metadata.authorName
    });
  } catch (error) {
    logger.error('message_reply_failed', {
      error,
      channelId: message.channelId,
      messageId: message.id
    });

    await safeReply(message, GENERIC_FAILURE_MESSAGE);
  }
}

async function sendTyping(message: Message): Promise<void> {
  if ('sendTyping' in message.channel) {
    await message.channel.sendTyping();
  }
}

async function replyToMessage(message: Message, reply: string): Promise<void> {
  const parts = splitDiscordMessage(reply);
  if (parts.length === 0) {
    return;
  }

  const [firstPart, ...restParts] = parts;
  await message.reply({
    content: firstPart,
    allowedMentions: {
      repliedUser: false
    }
  });

  if (!('send' in message.channel)) {
    return;
  }

  for (const part of restParts) {
    await message.channel.send({ content: part });
  }
}

async function safeReply(message: Message, content: string): Promise<void> {
  try {
    await message.reply({
      content,
      allowedMentions: {
        repliedUser: false
      }
    });
  } catch (error) {
    logger.warn('safe_reply_failed', { error, messageId: message.id });
  }
}
