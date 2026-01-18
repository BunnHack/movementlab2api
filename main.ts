/**
 * Movement Labs to OpenAI Proxy (Stealth + Tool Calling)
 * Target: Deno Deploy
 */

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const TARGET_URL = "https://movementlabs.ai/api/chat";

// Stealth Configuration: Mimicking Chrome 140 on Linux
const FAKE_HEADERS_BASE = {
  "accept": "*/*",
  "accept-language": "zh-HK,zh;q=0.9,en-US;q=0.8,en;q=0.7,zh-TW;q=0.6",
  "content-type": "application/json",
  "origin": "https://movementlabs.ai",
  "priority": "u=1, i",
  "referer": "https://movementlabs.ai/",
  "sec-ch-ua": '"Mises";v="141", "Not?A_Brand";v="8", "Chromium";v="141"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Linux"',
  "sec-fetch-dest": "empty",
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "same-origin",
  "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
};

// Random IP Generator for X-Forwarded-For to bypass simple rate limits
function getRandomIp() {
  return Array(4).fill(0).map(() => Math.floor(Math.random() * 255)).join('.');
}

// Fallback Cookie (Always set MOVEMENT_COOKIE in Deno Environment Variables for stability)
const DEFAULT_COOKIE = `__client_uat=1768305449; __refresh_8YHPIyOx=s40qrTVvuyUfHobm6uhc; __client_uat_8YHPIyOx=1768305449; cf_clearance=o38m1S77g9O8JGQTxiRevC2Tbhtcs5JKYayAbTKqnyA-1768536929-1.2.1.1-OYB136VjKrCkdfTRynI8SBUnbSigPj_dkMUsJFBn0dykx_3pG.8v6EOsG_kHjgOYGUPwTPm6jga4YDZifpSGDcEc_GLK77kNnxnzGTACJHKucADGPvr541eR1D_VefSDd2.E2r_xebEvOvqBHXfTFhufy1XtpzaE0wik0wEyw0SeBfPZ70eFjb24tVaOnNFLhz5jv9ySDJyIhRneFQ0ocYOGPZdp.7iyhXHiKsKrXJo; clerk_active_context=sess_38CZKUBoHnuu2A335FdHjqZM4xE:; __session=...;`;

serve(async (req) => {
  const url = new URL(req.url);

  // --- CORS Handling ---
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "*",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // --- 1. Model List Endpoint ---
  if (url.pathname === "/v1/models") {
    const models = [
      { id: "tensor-max", object: "model" },
      { id: "hawk-ultra", object: "model" },
      { id: "hawk-max", object: "model" },
      { id: "momentum-max", object: "model" }
    ];
    return new Response(JSON.stringify({ object: "list", data: models }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  // --- 2. Chat Completions Endpoint ---
  if (url.pathname === "/v1/chat/completions" && req.method === "POST") {
    try {
      const body = await req.json();
      const model = body.model || "tensor-max";
      const fakeIp = getRandomIp();
      
      const headers = new Headers(FAKE_HEADERS_BASE);
      headers.set("cookie", Deno.env.get("MOVEMENT_COOKIE") || DEFAULT_COOKIE);
      headers.set("X-Forwarded-For", fakeIp);
      headers.set("X-Real-IP", fakeIp);

      // Prepare payload with Tool Calling support
      const payload: any = {
        messages: body.messages.map((m: any) => ({
          role: m.role,
          content: m.content || "",
          ...(m.tool_calls && { tool_calls: m.tool_calls }),
          ...(m.tool_call_id && { tool_call_id: m.tool_call_id }),
        })),
        model: model,
        stream: true, // Force stream for parsing tool/text parts
      };

      if (body.tools) payload.tools = body.tools;
      if (body.tool_choice) payload.tool_choice = body.tool_choice;

      console.log(`[Proxy] Requesting ${model} | IP: ${fakeIp}`);

      const response = await fetch(TARGET_URL, {
        method: "POST",
        headers: headers,
        body: JSON.stringify(payload)
      });

      // Handle WAF or Auth failures
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[Error] Upstream returned ${response.status}:`, errorText.slice(0, 300));
        return new Response(JSON.stringify({ 
          error: { message: "Upstream Error or Cloudflare Block", code: response.status, details: errorText.slice(0, 100) } 
        }), { 
          status: response.status, 
          headers: { ...corsHeaders, "Content-Type": "application/json" } 
        });
      }

      // --- Stream Transformer ---
      const stream = new ReadableStream({
        async start(controller) {
          const reader = response.body?.getReader();
          if (!reader) return controller.close();

          const decoder = new TextDecoder();
          let buffer = "";

          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;

              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split("\n");
              buffer = lines.pop() || "";

              for (const line of lines) {
                if (!line.trim()) continue;

                const timestamp = Math.floor(Date.now() / 1000);
                let openaiChunk: any = null;

                // Case A: Text Content (Protocol 0:)
                if (line.startsWith('0:')) {
                  try {
                    const content = JSON.parse(line.substring(2));
                    openaiChunk = {
                      id: `chatcmpl-${timestamp}`,
                      choices: [{ index: 0, delta: { content }, finish_reason: null }]
                    };
                  } catch { /* ignore parse error */ }
                } 
                
                // Case B: Tool Calling (Protocol 9:)
                else if (line.startsWith('9:')) {
                  try {
                    const toolData = JSON.parse(line.substring(2));
                    openaiChunk = {
                      id: `chatcmpl-${timestamp}`,
                      choices: [{
                        index: 0,
                        delta: {
                          tool_calls: [{
                            index: 0,
                            id: toolData.toolCallId,
                            type: "function",
                            function: {
                              name: toolData.toolName,
                              arguments: JSON.stringify(toolData.args)
                            }
                          }]
                        },
                        finish_reason: "tool_calls"
                      }]
                    };
                  } catch { /* ignore parse error */ }
                }

                if (openaiChunk) {
                  const data = {
                    object: "chat.completion.chunk",
                    created: timestamp,
                    model: model,
                    ...openaiChunk
                  };
                  controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`));
                }

                // Case C: Final Stop (Protocol d:)
                if (line.startsWith('d:')) {
                  const finalChunk = {
                    id: `chatcmpl-${timestamp}`,
                    object: "chat.completion.chunk",
                    created: timestamp,
                    model: model,
                    choices: [{ index: 0, delta: {}, finish_reason: "stop" }]
                  };
                  controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(finalChunk)}\n\n`));
                  controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
                }
              }
            }
          } catch (e) {
            console.error("Streaming error:", e);
          } finally {
            controller.close();
          }
        }
      });

      return new Response(stream, {
        headers: {
          ...corsHeaders,
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
        }
      });

    } catch (e: any) {
      return new Response(JSON.stringify({ error: e.message }), { 
        status: 500, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    }
  }

  return new Response("Movement Proxy Active", { status: 200 });
});
