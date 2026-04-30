import { createMcpHandler } from "mcp-handler";
import { registerTools } from "../src/tools.js";

const handler = createMcpHandler(registerTools, {
  serverInfo: { name: "fri3d-badge-mcp", version: "0.1.0" },
}, {
  // Expose streamable-HTTP transport only.
  disableSse: true,
});

export { handler as GET, handler as POST, handler as DELETE };
