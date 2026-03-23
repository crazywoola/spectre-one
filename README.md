# Spectre One

一个简洁的 Discord Bot，用 OpenAI `Responses API` 生成回复，并把 Dosu 作为远程 MCP tool 挂给模型，用于检索团队文档或内部知识。

## 特性

- 基于 `discord.js`，自动回复频道消息或 `@mention`
- 基于 OpenAI `Responses API`
- 内置 Dosu MCP 远程工具配置
- 默认带超时、重试、日志和优雅退出
- 空仓可直接启动，无额外框架负担

## 前置要求

- Node.js 20+
- 一个 Discord Bot Token
- Discord Developer Portal 中开启 `MESSAGE CONTENT INTENT`
- OpenAI API Key
- Dosu deployment

## 安装

```bash
npm install
cp .env.example .env
```

## Dosu 配置

这个项目只使用 Dosu 的 HTTP MCP 端点，不依赖 CLI 本地配置。

按 Dosu 文档，推荐使用 path-based endpoint：

```env
DOSU_MCP_DEPLOYMENT_ID=your-deployment-id
DOSU_MCP_API_KEY=dosu_your_api_key
```

程序会自动构造：

```text
https://api.dosu.dev/v1/mcp/deployments/<your-deployment-id>
```

如果你已经有完整端点，也可以直接填写：

```env
DOSU_MCP_SERVER_URL=https://api.dosu.dev/v1/mcp/deployments/<your-deployment-id>
DOSU_MCP_API_KEY=dosu_your_api_key
```

参考 Dosu 文档：
- [Dosu MCP](https://app.dosu.dev/9affd04a-e6a9-452c-b927-c639e979994c/documents/8c21ef6e-14b7-4fa1-949e-d256af54bad1)

## 环境变量

```env
DISCORD_BOT_TOKEN=...
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-5-mini
DOSU_MCP_DEPLOYMENT_ID=...
DOSU_MCP_API_KEY=...

# 逗号分隔。填了以后这些频道会自动回复所有用户消息。
DISCORD_ALLOWED_CHANNEL_IDS=123,456

# 不填时的默认行为：
# - 如果配置了 DISCORD_ALLOWED_CHANNEL_IDS，则这些频道自动回复，其他频道仅在 @bot 时回复
# - 如果没配置频道，则默认仅在 @bot 时回复
DISCORD_REQUIRE_MENTION=
```

## 启动

开发模式：

```bash
npm run dev
```

构建并运行：

```bash
npm run build
npm start
```

## 结构

```text
src/
  config/      环境配置与 Dosu 读取
  discord/     Discord 事件与上下文拼装
  openai/      OpenAI 回复链路
  shared/      日志、重试、文本工具
  index.ts     入口
```

## 说明

- 回复使用最近几条频道消息作为上下文，避免完全脱离对话。
- 模型在需要内部文档时会自行调用 Dosu MCP；找不到内容时会直接说明，而不是编造。
- 默认模型是 `gpt-5-mini`。如果你更重视质量，可以改成 `gpt-5.4`。
- 当前 Dosu 接入方式是 HTTP MCP: `server_url + X-Dosu-API-Key`，不是 CLI 调用。
