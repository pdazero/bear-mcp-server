import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { createLogger } from './utils/logger.js';

const log = createLogger('server');

export function createMcpServer(tools) {
  const server = new Server(
    { name: 'bear-notes', version: '2.0.0' },
    { capabilities: { tools: {} } }
  );

  const handlerMap = new Map();
  const definitions = [];

  for (const tool of tools) {
    definitions.push(tool.definition);
    handlerMap.set(tool.definition.name, tool.handler);
  }

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: definitions,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const handler = handlerMap.get(name);

    if (!handler) {
      throw new McpError(ErrorCode.MethodNotFound, `Tool not found: ${name}`);
    }

    try {
      const result = await handler(args || {});
      return { toolResult: result };
    } catch (error) {
      log.error(`Tool ${name} failed:`, error.message);
      return { toolResult: { error: error.message } };
    }
  });

  return server;
}

export async function startServer(server) {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log.info('MCP server ready on stdio');
  return transport;
}
