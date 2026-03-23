import OpenAI from 'openai';
import type { Response, ResponseCreateParamsNonStreaming } from 'openai/resources/responses/responses';

import type { AppConfig } from '../config/env.js';
import { logger } from '../shared/logger.js';
import { withRetry } from '../shared/retry.js';

const DOSU_PREFERRED_TOOLS = [
  'init_knowledge',
  'search_documentation',
  'search_threads',
  'fetch_source',
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
    const response = await this.createResponse(this.buildReplyRequest(input));

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
      tools: [this.buildDosuMcpTool()]
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
    const missingOptionalTools = DOSU_PREFERRED_TOOLS.filter((toolName) => !importedTools.includes(toolName));

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

  private buildReplyRequest(input: string): ResponseCreateParamsNonStreaming {
    return {
      model: this.config.openai.model,
      instructions: this.config.bot.systemPrompt,
      input,
      stream: false,
      max_output_tokens: 900,
      tools: [this.buildDosuMcpTool()]
    };
  }

  private buildDosuMcpTool(): NonNullable<ResponseCreateParamsNonStreaming['tools']>[number] {
    return {
      type: 'mcp',
      server_label: 'dosu',
      server_description: 'Team docs, internal architecture notes, product knowledge, and runbooks.',
      server_url: this.config.dosu.serverUrl,
      headers: {
        'X-Dosu-API-Key': this.config.dosu.apiKey
      },
      allowed_tools: [...DOSU_PREFERRED_TOOLS],
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
