import OpenAI from 'openai';
import type { Response, ResponseCreateParamsNonStreaming } from 'openai/resources/responses/responses';

import type { AppConfig } from '../config/env.js';
import { logger } from '../shared/logger.js';
import { withRetry } from '../shared/retry.js';

const DOSU_LOOKUP_TOOLS = [
  'init_knowledge',
  'search_documentation',
  'search_threads',
  'fetch_source'
] as const;

const DOSU_VERIFICATION_TOOLS = [
  ...DOSU_LOOKUP_TOOLS,
  'greet'
] as const;

const DOSU_REQUIRED_TOOLS = [
  'init_knowledge',
  'search_documentation',
  'fetch_source'
] as const;

export class ReplyService {
  private readonly client: OpenAI;
  private readonly config: AppConfig;

  public constructor(config: AppConfig) {
    this.config = config;
    this.client = new OpenAI({
      apiKey: config.openai.apiKey,
      baseURL: config.openai.baseURL
    });
  }

  public async generateReply(input: string): Promise<string> {
    const dosuLookupResponse = await this.createResponse(this.buildDosuLookupRequest(input));
    const dosuCalls = getDosuMcpCalls(dosuLookupResponse);

    if (dosuCalls.length === 0) {
      throw new Error('OpenAI did not query Dosu before generating a reply.');
    }

    logger.info('dosu_lookup_completed', {
      callCount: dosuCalls.length,
      tools: dosuCalls.map((call) => call.name),
      statuses: dosuCalls.map((call) => call.status ?? 'completed'),
      failedTools: dosuCalls.filter((call) => call.error).map((call) => call.name)
    });

    const response = await this.createResponse(this.buildReplyRequest(dosuLookupResponse.id));

    const output = response.output_text.trim();
    if (!output) {
      throw new Error('OpenAI returned an empty response.');
    }

    return output;
  }

  public async verifyDosuTools(): Promise<void> {
    const response = await this.createResponse({
      model: this.config.openai.model,
      input: 'Acknowledge with OK. Do not call any tool.',
      instructions: [
        'Initialize the configured MCP server so its tools are available.',
        'Do not invoke any MCP tool.',
        'Reply with exactly: OK'
      ].join(' '),
      stream: false,
      max_output_tokens: 20,
      tools: [this.buildDosuMcpTool(DOSU_VERIFICATION_TOOLS)]
    });

    const mcpListTools = response.output.find(isMcpListToolsItem);
    if (!mcpListTools || mcpListTools.server_label !== 'dosu') {
      throw new Error('OpenAI did not return a Dosu MCP tool listing during startup verification.');
    }

    if (mcpListTools.error) {
      throw new Error(`Dosu MCP tool listing failed: ${mcpListTools.error}`);
    }

    const importedTools = mcpListTools.tools.map((tool) => tool.name).sort();
    const missingRequiredTools = DOSU_REQUIRED_TOOLS.filter((toolName) => !importedTools.includes(toolName));
    const missingOptionalTools = DOSU_VERIFICATION_TOOLS.filter((toolName) => !importedTools.includes(toolName));

    if (missingRequiredTools.length > 0) {
      throw new Error(
        `Dosu MCP loaded, but required tools are missing: ${missingRequiredTools.join(', ')}. Imported tools: ${importedTools.join(', ')}`
      );
    }

    logger.info('dosu_tools_loaded', {
      serverLabel: mcpListTools.server_label,
      toolCount: importedTools.length,
      tools: importedTools
    });

    if (missingOptionalTools.length > 0) {
      logger.warn('dosu_optional_tools_missing', {
        missingTools: missingOptionalTools,
        importedTools
      });
    }
  }

  private buildDosuLookupRequest(input: string): ResponseCreateParamsNonStreaming {
    return {
      model: this.config.openai.model,
      instructions: [
        'You are preparing context for a Discord bot reply.',
        'Before any final answer is written, you must query the Dosu MCP server at least once.',
        'Prefer search_documentation first. Use search_threads for discussion history when helpful. Use fetch_source to inspect any promising result in more detail.',
        'Do not call greet.',
        'Do not write a user-facing reply in this step.'
      ].join(' '),
      input,
      stream: false,
      max_output_tokens: 300,
      tool_choice: {
        type: 'allowed_tools',
        mode: 'required',
        tools: [
          {
            type: 'mcp',
            server_label: 'dosu'
          }
        ]
      },
      tools: [this.buildDosuMcpTool(DOSU_LOOKUP_TOOLS)]
    };
  }

  private buildReplyRequest(previousResponseId: string): ResponseCreateParamsNonStreaming {
    return {
      model: this.config.openai.model,
      instructions: [
        this.config.bot.systemPrompt,
        'A Dosu lookup was already completed in the previous response.',
        'Use the retrieved Dosu context before answering the user.',
        'If the Dosu lookup failed or did not contain enough relevant information, say so plainly instead of guessing.'
      ].join(' '),
      input: 'Write the final Discord reply for the original user request using the Dosu lookup above.',
      previous_response_id: previousResponseId,
      stream: false,
      max_output_tokens: 900,
      tool_choice: 'none'
    };
  }

  private buildDosuMcpTool(
    allowedTools: readonly string[]
  ): NonNullable<ResponseCreateParamsNonStreaming['tools']>[number] {
    return {
      type: 'mcp',
      server_label: 'dosu',
      server_description: 'Team docs, internal architecture notes, product knowledge, and runbooks.',
      server_url: this.config.dosu.serverUrl,
      headers: {
        'X-Dosu-API-Key': this.config.dosu.apiKey
      },
      allowed_tools: [...allowedTools],
      require_approval: 'never'
    };
  }

  private async createResponse(request: ResponseCreateParamsNonStreaming): Promise<Response> {
    return withRetry(
      async () => {
        return this.client.responses.create(request, {
          signal: AbortSignal.timeout(this.config.openai.requestTimeoutMs)
        });
      },
      {
        retries: 2,
        delayMs: 750,
        shouldRetry: isRetryableError
      }
    );
  }
}

function isMcpListToolsItem(item: Response['output'][number]): item is Extract<Response['output'][number], { type: 'mcp_list_tools' }> {
  return item.type === 'mcp_list_tools';
}

function getDosuMcpCalls(response: Response): Array<Extract<Response['output'][number], { type: 'mcp_call' }>> {
  return response.output.filter(
    (item): item is Extract<Response['output'][number], { type: 'mcp_call' }> =>
      item.type === 'mcp_call' && item.server_label === 'dosu'
  );
}

function isRetryableError(error: unknown): boolean {
  if (error instanceof OpenAI.APIConnectionError) {
    return true;
  }

  if (error instanceof OpenAI.RateLimitError) {
    return true;
  }

  if (error instanceof OpenAI.InternalServerError) {
    return true;
  }

  if (error instanceof OpenAI.APIError) {
    logger.warn('openai_api_error', {
      status: error.status,
      message: error.message
    });
  }

  return false;
}
