/**
 * Movement Labs to OpenAI Proxy (Stealth + Tool Calling + Reasoning)
 * Deployed on Deno Deploy
 */

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const TARGET_URL = "https://movementlabs.ai/api/chat";

// 伪装配置
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

function getRandomIp() {
  return Array(4).fill(0).map(() => Math.floor(Math.random() * 255)).join('.');
}

const DEFAULT_COOKIE = `__client_uat=1768305449; __refresh_8YHPIyOx=s40qrTVvuyUfHobm6uhc; __client_uat_8YHPIyOx=1768305449; cf_clearance=...;`;

serve(async (req) => {
  const url = new URL(req.url);

  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "*",
  };

  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // 1. 模型列表
  if (url.pathname === "/v1/models") {
    const models = [
      { id: "momentum-max", object: "model" },
      { id: "tensor-max", object: "model" },
      { id: "hawk-ultra", object: "model" }
    ];
    return new Response(JSON.stringify({ object: "list", data: models }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  // 2. 聊天接口
  if (url.pathname === "/v1/chat/completions" && req.method === "POST") {
    try {
      const body = await req.json();
      const model = body.model || "momentum-max";
      const fakeIp = getRandomIp();
      
      const headers = new Headers(FAKE_HEADERS_BASE);
      headers.set("cookie", Deno.env.get("MOVEMENT_COOKIE") || DEFAULT_COOKIE);
      headers.set("X-Forwarded-For", fakeIp);

      const payload: any = {
        messages: body.messages.map((m: any) => ({
          role: m.role,
          content: m.content || "",
          ...(m.tool_calls && { tool_calls: m.tool_calls }),
          ...(m.tool_call_id && { tool_call_id: m.tool_call_id }),
        })),
        model: model,
        stream: true,
      };

      if (body.tools) payload.tools = body.tools;
      if (body.tool_choice) payload.tool_choice = body.tool_choice;

      const response = await fetch(TARGET_URL, {
        method: "POST",
        headers: headers,
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        return new Response(await response.text(), { status: response.status, headers: corsHeaders });
      }

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
                const chunkId = `chatcmpl-${timestamp}`;
                let delta: any = null;

                // --- 解析逻辑 ---
                
                // 1. 思考过程 (g: 标签)
                if (line.startsWith('g:')) {
                  try {
                    const reasoning = JSON.parse(line.substring(2));
                    delta = { reasoning_content: reasoning };
                  } catch {
                    // 如果不是 JSON 格式，按原样处理字符串
                    delta = { reasoning_content: line.substring(2).replace(/^"(.*)"$/, '$1') };
                  }
                } 
                
                // 2. 正文内容 (0: 标签)
                else if (line.startsWith('0:')) {
                  try {
                    delta = { content: JSON.parse(line.substring(2)) };
                  } catch {
                    delta = { content: line.substring(2).replace(/^"(.*)"$/, '$1') };
                  }
                }

                // 3. 工具调用 (9: 标签)
                else if (line.startsWith('9:')) {
                  try {
                    const toolData = JSON.parse(line.substring(2));
                    delta = {
                      tool_calls: [{
                        index: 0,
                        id: toolData.toolCallId,
                        type: "function",
                        function: { name: toolData.toolName, arguments: JSON.stringify(toolData.args) }
                      }]
                    };
                  } catch {}
                }

                if (delta) {
                  const openaiData = {
                    id: chunkId,
                    object: "chat.completion.chunk",
                    created: timestamp,
                    model: model,
                    choices: [{ index: 0, delta: delta, finish_reason: null }]
                  };
                  controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(openaiData)}\n\n`));
                }

                // 4. 结束信号 (d: 标签)
                if (line.startsWith('d:')) {
                  const endData = {
                    id: chunkId,
                    object: "chat.completion.chunk",
                    created: timestamp,
                    model: model,
                    choices: [{ index: 0, delta: {}, finish_reason: "stop" }]
                  };
                  controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(endData)}\n\n`));
                  controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
                }
              }
            }
          } catch (e) {
            console.error(e);
          } finally {
            controller.close();
          }
        }
      });

      return new Response(stream, {
        headers: { ...corsHeaders, "Content-Type": "text/event-stream" }
      });

    } catch (e: any) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
    }
  }

  return new Response("Movement Proxy reasoning-enabled", { status: 200 });
});
