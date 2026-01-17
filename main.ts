/**
 * Movement Labs to OpenAI Proxy
 * run locally: deno run --allow-net --allow-env --watch main.ts
 */

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

// 配置常量
const TARGET_URL = "https://movementlabs.ai/api/chat";
const MODELS = [
  { id: "hawk-ultra", object: "model" },
  { id: "hawk-max", object: "model" },
  { id: "tensor-max", object: "model" },
  { id: "momentum-max", object: "model" },
];

// 从环境变量获取 Cookie，如果没有则使用硬编码（建议在 Deno Deploy 设置环境变量）
// 注意：你需要将 curl 中的 cookie 完整值填入环境变量 MOVEMENT_COOKIE
const COOKIE = Deno.env.get("MOVEMENT_COOKIE") || `__client_uat=1768305449; __refresh_8YHPIyOx=s40qrTVvuyUfHobm6uhc; __client_uat_8YHPIyOx=1768305449; cf_clearance=o38m1S77g9O8JGQTxiRevC2Tbhtcs5JKYayAbTKqnyA-1768536929-1.2.1.1-OYB136VjKrCkdfTRynI8SBUnbSigPj_dkMUsJFBn0dykx_3pG.8v6EOsG_kHjgOYGUPwTPm6jga4YDZifpSGDcEc_GLK77kNnxnzGTACJHKucADGPvr541eR1D_VefSDd2.E2r_xebEvOvqBHXfTFhufy1XtpzaE0wik0wEyw0SeBfPZ70eFjb24tVaOnNFLhz5jv9ySDJyIhRneFQ0ocYOGPZdp.7iyhXHiKsKrXJo; cfz_zaraz-analytics=%7B%22_cfa_clientId%22%3A%7B%22v%22%3A%2267845109272994210%22%2C%22e%22%3A1798692079830%7D%2C%22_cfa_sId%22%3A%7B%22v%22%3A%2269955183204181710%22%2C%22e%22%3A1768663840178%7D%7D; cfzs_google-analytics_v4=%7B%22Vhiq_pageviewCounter%22%3A%7B%22v%22%3A%222%22%7D%7D; clerk_active_context=sess_38CZKUBoHnuu2A335FdHjqZM4xE:; __session=eyJhbGciOiJSUzI1NiIsImNhdCI6ImNsX0I3ZDRQRDExMUFBQSIsImtpZCI6Imluc18zNHZvbjFZYmR4cWpYU1BJeUROU0RUTTFZVkQiLCJ0eXAiOiJKV1QifQ.eyJhenAiOiJodHRwczovL21vdmVtZW50bGFicy5haSIsImV4cCI6MTc2ODY2MjEwMCwiZmVhIjoidToxMF9tZXNzYWdlc19wZXJfZGF5LHU6NV9oYXdrX3Byb21wdHNfcGVyX2RheSx1OmVtYWlsX3N1cHBvcnQiLCJmdmEiOls1OTQzLC0xXSwiaWF0IjoxNzY4NjYyMDQwLCJpc3MiOiJodHRwczovL2NsZXJrLm1vdmVtZW50bGFicy5haSIsIm5iZiI6MTc2ODY2MjAzMCwicGxhIjoidTpmcmVlX3VzZXIiLCJzaWQiOiJzZXNzXzM4Q1pLVUJvSG51dTJBMzM1RmRIanFaTTR4RSIsInN0cyI6ImFjdGl2ZSIsInN1YiI6InVzZXJfMzUwN2FUUHh2Q3RabXAxZDNTcVRydkVjWFBPIiwidiI6Mn0.ESwBP_ZZJT1vhCv5mWssazcEWuG0F-lDycIXm8_e6AC1nwoUIkzS4_PbteaCh-ZY1_oPWYdISnIxbh098mGe-zAt9AWeALqtLJf8sqaVTNWvAtToCW9kDHfazybHEviFcVnkNlO3hjmx37e6UiCQXPh-oTas-exIXTpjmSy4TRRzfF_HIQB1k2smqZNorQMIKq4ofeHJFJ3MPnRIqP6IkpWbwyzbq0Mybrm2TiXBf2zyMxNwv54AyIMRpPVkfjSjtTdnIwMG6wPYnBpPYSf0C8y6jfP3qH8ffEQqHEW0NEOf3VEECMCl4z8qdzRczLgzT5fLBXWhvbPdIELaSIUkIg; __session_8YHPIyOx=eyJhbGciOiJSUzI1NiIsImNhdCI6ImNsX0I3ZDRQRDExMUFBQSIsImtpZCI6Imluc18zNHZvbjFZYmR4cWpYU1BJeUROU0RUTTFZVkQiLCJ0eXAiOiJKV1QifQ.eyJhenAiOiJodHRwczovL21vdmVtZW50bGFicy5haSIsImV4cCI6MTc2ODY2MjEwMCwiZmVhIjoidToxMF9tZXNzYWdlc19wZXJfZGF5LHU6NV9oYXdrX3Byb21wdHNfcGVyX2RheSx1OmVtYWlsX3N1cHBvcnQiLCJmdmEiOls1OTQzLC0xXSwiaWF0IjoxNzY4NjYyMDQwLCJpc3MiOiJodHRwczovL2NsZXJrLm1vdmVtZW50bGFicy5haSIsIm5iZiI6MTc2ODY2MjAzMCwicGxhIjoidTpmcmVlX3VzZXIiLCJzaWQiOiJzZXNzXzM4Q1pLVUJvSG51dTJBMzM1RmRIanFaTTR4RSIsInN0cyI6ImFjdGl2ZSIsInN1YiI6InVzZXJfMzUwN2FUUHh2Q3RabXAxZDNTcVRydkVjWFBPIiwidiI6Mn0.ESwBP_ZZJT1vhCv5mWssazcEWuG0F-lDycIXm8_e6AC1nwoUIkzS4_PbteaCh-ZY1_oPWYdISnIxbh098mGe-zAt9AWeALqtLJf8sqaVTNWvAtToCW9kDHfazybHEviFcVnkNlO3hjmx37e6UiCQXPh-oTas-exIXTpjmSy4TRRzfF_HIQB1k2smqZNorQMIKq4ofeHJFJ3MPnRIqP6IkpWbwyzbq0Mybrm2TiXBf2zyMxNwv54AyIMRpPVkfjSjtTdnIwMG6wPYnBpPYSf0C8y6jfP3qH8ffEQqHEW0NEOf3VEECMCl4z8qdzRczLgzT5fLBXWhvbPdIELaSIUkIg`;

// 通用 Headers
const HEADERS = {
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
  "cookie": COOKIE,
};

// CORS Headers
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  const url = new URL(req.url);

  // 1. GET /v1/models
  if (url.pathname === "/v1/models" && req.method === "GET") {
    return new Response(JSON.stringify({ object: "list", data: MODELS }), {
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  // 2. POST /v1/chat/completions
  if (url.pathname === "/v1/chat/completions" && req.method === "POST") {
    try {
      const body = await req.json();
      const model = body.model || "tensor-max";
      const messages = body.messages || [];
      const stream = body.stream || false; // 支持 stream 参数，但其实我们主要做 stream

      // 构造转发给 Movement Labs 的 Payload
      const payload = {
        messages: messages.map((m: any) => ({
          role: m.role,
          content: m.content,
        })),
        model: model,
      };

      const response = await fetch(TARGET_URL, {
        method: "POST",
        headers: HEADERS,
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        return new Response(JSON.stringify({ error: await response.text() }), {
          status: response.status,
          headers: CORS_HEADERS,
        });
      }

      // 如果客户端请求非流式 (stream: false)，为了简单起见，我们也可以用流式读取并在内存拼装（这里演示纯流式转发）
      // 这里创建一个 TransformStream 来转换数据格式
      const streamParser = new TransformStream({
        async transform(chunk, controller) {
          const text = new TextDecoder().decode(chunk);
          const lines = text.split("\n");

          for (const line of lines) {
            if (!line.trim()) continue;

            // Movement Labs Format Parsing
            // Format examples: 
            // 0:"Hello" -> Content
            // g:"Thinking..." -> Internal thought/Guardrail (We skip or map to reasoning)
            // d:{} -> End/Metadata
            
            let content = null;

            if (line.startsWith('0:')) {
                // 提取内容: 0:"Hello" -> "Hello"
                // 使用 JSON.parse 处理转义字符
                try {
                    content = JSON.parse(line.substring(2));
                } catch (e) {
                    console.error("Parse error", line);
                }
            } 
            // 如果需要处理 'g:' (Guardrail/Thinking)，可以在这里添加逻辑
            
            if (content) {
              const openAIChunk = {
                id: "chatcmpl-" + Date.now(),
                object: "chat.completion.chunk",
                created: Math.floor(Date.now() / 1000),
                model: model,
                choices: [
                  {
                    index: 0,
                    delta: { content: content },
                    finish_reason: null,
                  },
                ],
              };
              controller.enqueue(
                new TextEncoder().encode(`data: ${JSON.stringify(openAIChunk)}\n\n`)
              );
            }
            
            // 检测结束信号 (d:{})
            if (line.startsWith('d:')) {
                 const endChunk = {
                    id: "chatcmpl-" + Date.now(),
                    object: "chat.completion.chunk",
                    created: Math.floor(Date.now() / 1000),
                    model: model,
                    choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
                  };
                  controller.enqueue(
                    new TextEncoder().encode(`data: ${JSON.stringify(endChunk)}\n\n`)
                  );
                  controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
            }
          }
        },
      });

      return new Response(response.body?.pipeThrough(streamParser), {
        headers: {
          ...CORS_HEADERS,
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
        },
      });

    } catch (error) {
        // @ts-ignore
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }
  }

  return new Response("Not Found", { status: 404 });
});
