/**
 * Movement Labs Proxy - Bug Fixed Version
 */

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const TARGET_URL = "https://movementlabs.ai/api/chat";

// 确保字符串是有效的 ByteString (仅包含 ASCII)
function toByteString(str: string): string {
  // 移除所有非 ASCII 字符，防止 Headers.set 崩溃
  return str.replace(/[^\x00-\x7F]/g, "");
}

const FAKE_HEADERS_BASE: Record<string, string> = {
  "accept": "*/*",
  "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
  "content-type": "application/json",
  "origin": "https://movementlabs.ai",
  "referer": "https://movementlabs.ai/",
  "sec-ch-ua": '"Chromium";v="140", "Not?A_Brand";v="8"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Linux"',
  "sec-fetch-dest": "empty",
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "same-origin",
  "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
};

serve(async (req) => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, ""); // 去除末尾斜杠

  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "*",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // 路由 1: GET /v1/models
  if (path === "/v1/models") {
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

  // 路由 2: POST /v1/chat/completions
  if (path === "/v1/chat/completions" && req.method === "POST") {
    try {
      const body = await req.json();
      const model = body.model || "tensor-max";
      
      // 处理 Tool Calling 注入逻辑 (保持之前的逻辑)
      let messages = body.messages || [];
      if (body.tools && body.tools.length > 0) {
        const toolPrompt = `\n\n[System: You have tools available. If needed, respond ONLY with JSON: {"tool": "name", "arguments": {...}}]`;
        messages = [...messages, { role: "system", content: toolPrompt }];
      }

      // 构建 Headers，并进行 ByteString 校验
      const headers = new Headers();
      for (const [key, value] of Object.entries(FAKE_HEADERS_BASE)) {
        headers.set(key, toByteString(value));
      }
      
      // 从环境变量读取 Cookie，如果包含中文会被 toByteString 过滤掉
      const rawCookie = Deno.env.get("MOVEMENT_COOKIE") || "";
      headers.set("cookie", toByteString(rawCookie));
      
      // 随机 IP 伪装
      const fakeIp = Array(4).fill(0).map(() => Math.floor(Math.random() * 255)).join('.');
      headers.set("X-Forwarded-For", fakeIp);

      const response = await fetch(TARGET_URL, {
        method: "POST",
        headers: headers,
        body: JSON.stringify({ messages, model })
      });

      if (!response.ok) {
        return new Response(JSON.stringify({ 
          error: "Upstream returned error", 
          status: response.status 
        }), { status: response.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // 流式转换
      const stream = new ReadableStream({
        async start(controller) {
          const reader = response.body?.getReader();
          const decoder = new TextDecoder();
          if (!reader) return controller.close();

          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              const lines = decoder.decode(value).split("\n");
              for (const line of lines) {
                if (line.startsWith("0:")) {
                  const content = JSON.parse(line.substring(2));
                  const chunk = {
                    id: `chatcmpl-${Date.now()}`,
                    choices: [{ delta: { content }, index: 0, finish_reason: null }]
                  };
                  controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(chunk)}\n\n`));
                }
                if (line.startsWith("d:")) {
                  controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
                }
              }
            }
          } finally {
            controller.close();
          }
        }
      });

      return new Response(stream, {
        headers: { ...corsHeaders, "Content-Type": "text/event-stream" }
      });

    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { 
        status: 500, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    }
  }

  // 兜底错误响应：返回 JSON 格式，防止客户端解析 "Not Found" 字符串失败
  return new Response(JSON.stringify({ error: "Route not found", path: url.pathname }), { 
    status: 404, 
    headers: { ...corsHeaders, "Content-Type": "application/json" } 
  });
});
                                          
