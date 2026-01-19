/**
 * Movement Labs to OpenAI Proxy (V4 - Bug Fix & Stability)
 * 修復了 url undefined 錯誤與 JSON 解析崩潰問題
 */

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const TARGET_URL = "https://movementlabs.ai/api/chat";

const FAKE_HEADERS_BASE = {
  "accept": "*/*",
  "accept-language": "zh-HK,zh;q=0.9,en-US;q=0.8,en;q=0.7,zh-TW;q=0.6",
  "content-type": "application/json",
  "origin": "https://movementlabs.ai",
  "referer": "https://movementlabs.ai/",
  "sec-ch-ua": '"Mises";v="141", "Not?A_Brand";v="8", "Chromium";v="141"',
  "sec-ch-ua-platform": '"Linux"',
  "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
};

function getRandomIp() {
  return Array(4).fill(0).map(() => Math.floor(Math.random() * 255)).join('.');
}

serve(async (req) => {
  const url = new URL(req.url); // 確保 url 在作用域內
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "*",
  };

  // 處理 CORS 預檢
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // 1. 模型列表接口
  if (url.pathname === "/v1/models") {
    return new Response(JSON.stringify({
      object: "list",
      data: [
        { id: "momentum-max", object: "model" },
        { id: "tensor-max", object: "model" },
        { id: "hawk-ultra", object: "model" }
      ]
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  // 2. 聊天接口
  if (url.pathname === "/v1/chat/completions" && req.method === "POST") {
    try {
      // 安全解析 JSON，防止 client 傳錯導致 Crash
      let body;
      try {
        body = await req.json();
      } catch (e) {
        return new Response(JSON.stringify({ error: "Invalid JSON request body" }), { status: 400, headers: corsHeaders });
      }

      const model = body.model || "momentum-max";
      let messages = [...(body.messages || [])];
      
      // --- MCP 工具注入與日誌 ---
      if (body.tools && body.tools.length > 0) {
        console.log(`[MCP] 收到工具定義: ${body.tools.map((t: any) => t.function.name).join(', ')}`);
        const toolHint = `[System: You have access to MCP tools. If needed, use them via tool_calls. Do not deny your capability.]`;
        if (messages.length > 0 && messages[0].role === 'system') {
          messages[0].content += "\n" + toolHint;
        } else {
          messages.unshift({ role: 'system', content: toolHint });
        }
      }

      const payload = {
        messages: messages.map(m => ({
          role: m.role,
          content: m.content || "",
          ...(m.tool_calls && { tool_calls: m.tool_calls }),
          ...(m.tool_call_id && { tool_call_id: m.tool_call_id }),
        })),
        model: model,
        stream: true,
        ...(body.tools && { tools: body.tools }),
        ...(body.tool_choice && { tool_choice: body.tool_choice }),
      };

      console.log(`[Request] 向 Movement Labs 發送請求...`);

      const response = await fetch(TARGET_URL, {
        method: "POST",
        headers: {
          ...FAKE_HEADERS_BASE,
          "cookie": Deno.env.get("MOVEMENT_COOKIE") || "", // 確保環境變量已設置
          "X-Forwarded-For": getRandomIp(),
        },
        body: JSON.stringify(payload)
      });

      // 如果上游報錯（例如 403, 500），不要嘗試 parse JSON
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[Upstream Error] ${response.status}: ${errorText.slice(0, 100)}`);
        return new Response(JSON.stringify({ error: "Upstream returned error", status: response.status, detail: errorText.slice(0, 50) }), { 
          status: response.status, 
          headers: { ...corsHeaders, "Content-Type": "application/json" } 
        });
      }

      // --- 流式處理 ---
      return new Response(new ReadableStream({
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
                let delta: any = null;

                try {
                  if (line.startsWith('g:')) {
                    delta = { reasoning_content: JSON.parse(line.substring(2)) };
                  } else if (line.startsWith('0:')) {
                    delta = { content: JSON.parse(line.substring(2)) };
                  } else if (line.startsWith('9:')) {
                    const toolData = JSON.parse(line.substring(2));
                    console.log(`[MCP] 觸發工具調用: ${toolData.toolName}`);
                    delta = {
                      tool_calls: [{
                        index: 0,
                        id: toolData.toolCallId,
                        type: "function",
                        function: { name: toolData.toolName, arguments: JSON.stringify(toolData.args) }
                      }]
                    };
                  }
                } catch (e) {
                  // 忽略單行解析失敗，繼續處理
                  continue;
                }

                if (delta) {
                  const chunk = {
                    id: `chatcmpl-${timestamp}`,
                    object: "chat.completion.chunk",
                    created: timestamp,
                    model: model,
                    choices: [{ index: 0, delta: delta, finish_reason: line.startsWith('9:') ? "tool_calls" : null }]
                  };
                  controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(chunk)}\n\n`));
                }

                if (line.startsWith('d:')) {
                  const endChunk = {
                    id: `chatcmpl-${timestamp}`,
                    object: "chat.completion.chunk",
                    created: timestamp,
                    model: model,
                    choices: [{ index: 0, delta: {}, finish_reason: "stop" }]
                  };
                  controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(endChunk)}\n\n`));
                  controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
                }
              }
            }
          } catch (err) {
            console.error("[Stream Error]", err);
          } finally {
            controller.close();
          }
        }
      }), { headers: { ...corsHeaders, "Content-Type": "text/event-stream" } });

    } catch (e: any) {
      console.error("[Fatal Error]", e);
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
    }
  }

  return new Response("Movement Proxy Stable Version", { status: 200 });
});
