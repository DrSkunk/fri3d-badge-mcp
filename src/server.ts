#!/usr/bin/env node
/**
 * Standalone stdio MCP server for local use.
 *
 * Run directly:
 *   npx fri3d-badge-mcp
 *
 * Or add to your MCP client config (e.g. Claude Desktop):
 *   {
 *     "mcpServers": {
 *       "fri3d-badge": {
 *         "command": "npx",
 *         "args": ["fri3d-badge-mcp"]
 *       }
 *     }
 *   }
 *
 * Caching: search indices and pages are cached in memory for the lifetime of
 * the process, and persisted to disk (os.tmpdir()/fri3d-badge-mcp/) with
 * stale-while-revalidate so subsequent sessions start fast.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./tools.js";

const server = new McpServer({
  name: "fri3d-badge-mcp",
  version: "0.1.0",
});

registerTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);
