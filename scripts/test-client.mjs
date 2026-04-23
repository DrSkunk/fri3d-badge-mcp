import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const origin = process.argv[2] || "http://localhost:3000";

async function main() {
  const transport = new StreamableHTTPClientTransport(new URL(`${origin}/mcp`));
  const client = new Client(
    { name: "fri3d-badge-mcp-test-client", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );
  await client.connect(transport);

  console.log("Connected:", client.getServerCapabilities());

  const tools = await client.listTools();
  console.log("\nTools:");
  for (const t of tools.tools) console.log(` - ${t.name}: ${t.description?.split("\n")[0]}`);

  console.log("\nlist_micropython_modules →");
  const list = await client.callTool({ name: "list_micropython_modules", arguments: {} });
  console.log(JSON.stringify(list, null, 2).slice(0, 800));

  console.log("\nsearch_micropython_docs(neopixel) →");
  const search = await client.callTool({
    name: "search_micropython_docs",
    arguments: { query: "neopixel", limit: 3 },
  });
  console.log(JSON.stringify(search, null, 2).slice(0, 1200));

  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
