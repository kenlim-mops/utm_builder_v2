import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createGtmDataMcpServer } from "@/mcp/server";
import { AuthError, requireBearerApiScope } from "@/services/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function jsonRpcError(status: number, message: string) {
  return Response.json(
    { jsonrpc: "2.0", error: { code: status === 401 ? -32001 : -32603, message }, id: null },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(req: Request) {
  try {
    // Authentication occurs here; individual tools enforce their own UTM or
    // GTM scope so a least-privilege token can expose only one module.
    const actor = await requireBearerApiScope(req);
    const server = createGtmDataMcpServer(actor);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    const response = await transport.handleRequest(req);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    if (error instanceof AuthError) return jsonRpcError(error.status, error.message);
    console.error(JSON.stringify({
      event: "mcp.request_error",
      message: error instanceof Error ? error.message : "MCP request failed.",
    }));
    return jsonRpcError(500, "Internal MCP server error.");
  }
}

export async function GET() {
  return jsonRpcError(405, "Method not allowed. Use Streamable HTTP POST.");
}

export async function DELETE() {
  return jsonRpcError(405, "Stateless MCP sessions cannot be deleted.");
}
