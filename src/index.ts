import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import { ZodError } from 'zod';

import discordCommands from './discord/commands.json';
import { handleDiscordInteraction } from './discord/interactions.js';
import { loadConfig, type WorkerBindings } from './config/env.js';
import { ReplyService } from './openai/reply-service.js';
import { buildPrompt, parseReplyRequest } from './reply/request.js';
import { logger } from './shared/logger.js';

type AppEnv = {
  Bindings: WorkerBindings;
};

const app = new Hono<AppEnv>();

app.use('*', cors());

app.get('/', (c) => {
  const config = loadConfig(c.env);

  return c.json({
    name: 'Spectre One',
    runtime: 'cloudflare-workers',
    endpoints: {
      health: '/health',
      interactions: '/interactions',
      reply: '/v1/reply'
    },
    models: config.openai.models,
    discordCommands: discordCommands.commands.map((command) => command.name)
  });
});

app.get('/health', async (c) => {
  const shouldVerifyUpstream = c.req.query('check') === 'upstream';

  if (!shouldVerifyUpstream) {
    return c.json({ ok: true });
  }

  try {
    const config = loadConfig(c.env);
    const replyService = new ReplyService(config);
    await replyService.verifyDosuTools();

    return c.json({ ok: true });
  } catch (error) {
    logger.warn('health_upstream_check_failed', {
      path: c.req.path,
      error
    });

    return c.json({ ok: false }, 503);
  }
});

app.post('/interactions', async (c) => {
  return handleDiscordInteraction(c.req.raw, c.env, c.executionCtx);
});

app.post('/v1/reply', async (c) => {
  const config = loadConfig(c.env);
  const payload = parseReplyRequest(await readJson(c.req.raw));
  const prompt = buildPrompt(payload, config.app.maxContextMessages);
  const replyService = new ReplyService(config);
  const result = await replyService.generateReply(prompt, {
    model: payload.model,
    maxOutputTokens: payload.max_output_tokens
  });

  logger.info('reply_generated', {
    model: result.model,
    attemptedModels: result.attemptedModels,
    promptLength: payload.prompt.length
  });

  return c.json({
    reply: result.reply,
    model: result.model,
    attemptedModels: result.attemptedModels
  });
});

app.onError((error, c) => {
  logger.error('request_failed', {
    method: c.req.method,
    path: c.req.path,
    error
  });

  if (error instanceof HTTPException) {
    return c.json({ error: error.message }, error.status);
  }

  if (error instanceof ZodError) {
    return c.json(
      {
        error: 'Invalid request.',
        issues: error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message
        }))
      },
      400
    );
  }

  return c.json(
    {
      error: error instanceof Error ? error.message : 'Internal Server Error'
    },
    500
  );
});

export default app;

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new HTTPException(400, {
      message: 'Request body must be valid JSON.'
    });
  }
}
