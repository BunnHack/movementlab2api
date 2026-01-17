/**
 * Movement Labs to OpenAI Proxy (Stealth + Tool Calling Support)
 * Deployed on Deno Deploy
 */

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const TARGET_URL = "https://movementlabs.ai/api/chat";

// === 1. 伪装配置 ===
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

// 默认 Cookie (请务必在 Deno Deploy 环境变量 MOVEMENT_COOKIE 中配置)
const DEFAULT_COOKIE = `请替换为你的真实Cookie`;

function getRandomIp() {
  return Array(4).fill(0).map(() => Math.floor(Math.random() * 255)).join('.');
}

// === 2. 工具处理逻辑 (Tool Calling) ===

/**
 * 将 OpenAI 的 tools 定义转换为模型能理解的 System Prompt
 */
function generateSystemPromptForTools(tools: any[]) {
  const toolDescriptions = tools.map((t) => {
    const fn = t.function;
    return `
Tool Name: ${fn.name}
Description: ${fn.description || "No description"}
Parameters: ${JSON.stringify(fn.parameters)}
`;
  }).join("\n---\n");

  return `
## Tool Usage Instructions
You have access to the following tools. You are capable of using them to answer the user's request.

${toolDescriptions}

IMPORTANT:
- If you need to use a tool, DO NOT output conversational text.
- ONLY output a JSON block strictly matching the tool's signature.
- Format: {"tool": "tool_name", "arguments": { ... }}
- If no tool is needed, respond normally.
`;
}

serve(async (req) => {
  const url = new URL(req.url);

  // CORS
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "*",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // 1. GET /v1/models
  if (url.pathname === "/v1/models") {
    const models = [
      { id: "hawk-ultra", object: "model" },
      { id: "hawk-max", object: "model" },
      { id: "tensor-max", object: "model" },
      { id: "momentum-max", object: "model" }
    ];
    return new Response(JSON.stringify({ object: "list", data: models }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  // 2. POST /v1/chat/completions
  if (url.pathname === "/v1/chat/completions" && req.method === "POST") {
    try {
      const body = await req.json();
      let { model, messages, tools, tool_choice, stream } = body;
      
      model = model || "tensor-max";

      // === Tool Calling 注入逻辑 ===
      if (tools && tools.length > 0) {
        console.log("Tools detected, injecting system prompt...");
        const toolPrompt = generateSystemPromptForTools(tools);
        
        // 检查是否已有 System Role，有则追加，无则新建
        const systemMessageIndex = messages.findIndex((m: any) => m.role === "system");
        if (systemMessageIndex > -1) {
          messages[systemMessageIndex].content += `\n\n${toolPrompt}`;
        } else {
          messages.unshift({ role: "system", content: toolPrompt });
        }
      }

      // 构造请求头
      const fakeIp = getRandomIp();
      const headers = new Headers(FAKE_HEADERS_BASE);
      headers.set("cookie", Deno.env.get("MOVEMENT_COOKIE") || DEFAULT_COOKIE);
      headers.set("X-Forwarded-For", fakeIp);
      headers.set("X-Real-IP", fakeIp);

      const payload = {
        messages: messages.map((m: any) => ({ role: m.role, content: m.content })),
        model: model
      };

      const response = await fetch(TARGET_URL, {
        method: "POST",
        headers: headers,
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        // 处理 Cloudflare 或 API 错误
        const errorText = await response.text();
        console.error("Upstream Error:", response.status, errorText);
        return new Response(JSON.stringify({ 
           error: { message: `Upstream error: ${response.status}`, details: errorText } 
        }), { status: response.status, headers: corsHeaders });
      }

      // === 流式响应处理 ===
      // 我们这里不做复杂的 JSON 抓取转换（不稳定），而是让模型直接输出 Text 格式的 JSON
      // 客户端（如 LangChain）通常能处理 Text 中的 JSON Block
      
      const streamParser = new ReadableStream({
        async start(controller) {
          const reader = response.body?.getReader();
          if (!reader) { controller.close(); return; }
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

                let content = null;
                // 解析 Movement Labs 格式 0:"content"
                if (line.startsWith('0:')) {
                  try {
                    content = JSON.parse(line.substring(2));
                  } catch (e) { /* ignore */ }
                }

                if (content) {
                  const chunk = {
                    id: `chatcmpl-${Date.now()}`,
                    object: "chat.completion.chunk",
                    created: Math.floor(Date.now() / 1000),
                    model: model,
                    choices: [{ 
                        index: 0, 
                        delta: { content }, // 将内容（可能是 JSON 字符串）作为 content 返回
                        finish_reason: null 
                    }]
                  };
                  controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(chunk)}\n\n`));
                }

                // 结束信号 d:{}
                if (line.startsWith('d:') && line.includes('{}')) {
                    const endChunk = {
                        id: `chatcmpl-${Date.now()}`,
                        object: "chat.completion.chunk",
                        created: Math.floor(Date.now() / 1000),
                        model: model,
                        choices: [{ index: 0, delta: {}, finish_reason: "stop" }]
                    };
                    controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(endChunk)}\n\n`));
                    controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
                }
              }
            }
          } catch (e) {
            console.error("Stream parsing error:", e);
            controller.error(e);
          } finally {
            controller.close();
          }
        }
      });

      return new Response(streamParser, {
        headers: {
          ...corsHeaders,
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
        }
      });

    } catch (e) {
      // @ts-ignore
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
    }
  }

  return new Response("Not Found", { status: 404 });
});
