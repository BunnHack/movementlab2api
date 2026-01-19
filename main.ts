/**
 * Movement Labs to OpenAI Proxy (V3 - MCP Optimizer)
 * 解決模型「裝傻」不認工具的問題
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
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "*",
  };

  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  if (url.pathname === "/v1/models") {
    return new Response(JSON.stringify({
      object: "list",
      data: [{ id: "momentum-max", object: "model" }, { id: "tensor-max", object: "model" }]
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  if (url.pathname === "/v1/chat/completions" && req.method === "POST") {
    try {
      const body = await req.json();
      const model = body.model || "momentum-max";
      
      // --- 工具檢查與系統提示詞注入 ---
      let messages = [...body.messages];
      if (body.tools && body.tools.length > 0) {
        console.log(`[MCP] 檢測到工具: ${body.tools.map(t => t.function.name).join(', ')}`);
        
        // 注入一段話，強迫模型認帳 (Reasoning 模型有時需要這點推力)
        const toolHint = `[System Notice: You have access to ${body.tools.length} MCP tools. If the user asks for info you don't have, you MUST use tool_calls. Do NOT say you don't have access.]`;
        
        if (messages[0].role === 'system') {
          messages[0].content += "\n" + toolHint;
        } else {
          messages.unshift({ role: 'system', content: toolHint });
        }
      } else {
        console.log("[MCP] 警告: 此請求未攜帶 tools");
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

      const response = await fetch(TARGET_URL, {
        method: "POST",
        headers: {
          ...FAKE_HEADERS_BASE,
          "cookie": Deno.env.get("MOVEMENT_COOKIE") || "",
          "X-Forwarded-For": getRandomIp(),
        },
        body: JSON.stringify(payload)
      });

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

                if (line.startsWith('g:')) { // 思考過程
                  delta = { reasoning_content: JSON.parse(line.substring(2)) };
                } else if (line.startsWith('0:')) { // 正文
                  delta = { content: JSON.parse(line.substring(2)) };
                } else if (line.startsWith('9:')) { // 工具調用
                  const toolData = JSON.parse(line.substring(2));
                  console.log(`[MCP] 模型決定調用工具: ${toolData.toolName}`);
                  delta = {
                    tool_calls: [{
                      index: 0,
                      id: toolData.toolCallId,
                      type: "function",
                      function: { name: toolData.toolName, arguments: JSON.stringify(toolData.args) }
                    }]
                  };
                }

                if (delta) {
                  controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({
                    id: `chatcmpl-${timestamp}`,
                    object: "chat.completion.chunk",
                    created: timestamp,
                    model: model,
                    choices: [{ index: 0, delta: delta, finish_reason: line.startsWith('9:') ? "tool_calls" : null }]
                  })}\n\n`));
                }

                if (line.startsWith('d:')) {
                  controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({
                    id: `chatcmpl-${timestamp}`,
                    object: "chat.completion.chunk",
                    created: timestamp,
                    model: model,
                    choices: [{ index: 0, delta: {}, finish_reason: "stop" }]
                  })}\n\n`));
                  controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
                }
              }
            }
          } finally {
            controller.close();
          }
        }
      }), { headers: { ...corsHeaders, "Content-Type": "text/event-stream" } });

    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
    }
  }
  return new Response("OK", { status: 200 });
});
