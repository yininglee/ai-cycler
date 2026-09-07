import { getRequestSession } from "../../../../src/auth/session.ts";
import { CHAT_TOOL_MAX_INPUT_BYTES, ChatToolError, executeChatTool, parseChatToolInvocation } from "../../../../src/chat/chat-tools.ts";
import { getApplicationRepository } from "../../../../src/persistence/application-repository.ts";

export const runtime = "nodejs";

const headers = { "Cache-Control": "no-store" };

export async function POST(request: Request): Promise<Response> {
  const session = getRequestSession(request);
  if (!session) return Response.json({ error: "NOT_FOUND" }, { status: 404, headers });

  try {
    const body = await request.text();
    if (Buffer.byteLength(body, "utf8") > CHAT_TOOL_MAX_INPUT_BYTES) throw new ChatToolError("INVALID_INPUT");
    const invocation = parseChatToolInvocation(JSON.parse(body));
    const result = await executeChatTool(getApplicationRepository(), session.userId, invocation);
    return Response.json(result, { headers });
  } catch (error) {
    const code = error instanceof ChatToolError ? error.code : "INVALID_INPUT";
    const status = code === "INVALID_INPUT" ? 400 : code === "NOT_FOUND" ? 404 : code === "TIMEOUT" ? 504 : 503;
    return Response.json({ error: code }, { status, headers });
  }
}
