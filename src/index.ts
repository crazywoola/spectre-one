import { createDiscordBot } from './discord/bot.js';
import { loadConfig } from './config/env.js';
import { ReplyService } from './openai/reply-service.js';
import { logger } from './shared/logger.js';

const config = loadConfig();
const replyService = new ReplyService(config);

process.on('unhandledRejection', (error) => {
  logger.error('unhandled_rejection', {
    error: error instanceof Error ? error : new Error(String(error))
  });
});

process.on('uncaughtException', (error) => {
  logger.error('uncaught_exception', { error });
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    logger.info('shutdown_signal', { signal });
    client.destroy();
    process.exit(0);
  });
}

try {
  await replyService.verifyDosuTools();
} catch (error) {
  logger.error('dosu_tool_verification_failed', {
    error: error instanceof Error ? error : new Error(String(error))
  });
  process.exit(1);
}

const client = createDiscordBot(config, replyService);

try {
  await client.login(config.discord.token);
} catch (error) {
  logger.error('discord_login_failed', {
    error: error instanceof Error ? error : new Error(String(error))
  });
  process.exit(1);
}
