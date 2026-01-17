/**
 * Movement Labs to OpenAI Proxy (Stealth Mode)
 * Deployed on Deno Deploy
 */

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const TARGET_URL = "https://movementlabs.ai/api/chat";

// 伪装配置：完全模拟 Chrome 140 Linux 版本
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
  // 关键：User-Agent 必须与 Cookie 生成时的环境一致
  "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
};

// 随机 IP 生成器 (用于伪造 X-Forwarded-For)
function getRandomIp() {
  return Array(4).fill(0).map(() => Math.floor(Math.random() * 255)).join('.');
}

// 默认 Cookie (建议通过环境变量覆盖)
const DEFAULT_COOKIE = `__client_uat=1768305449; __refresh_8YHPIyOx=s40qrTVvuyUfHobm6uhc; __client_uat_8YHPIyOx=1768305449; cf_clearance=o38m1S77g9O8JGQTxiRevC2Tbhtcs5JKYayAbTKqnyA-1768536929-1.2.1.1-OYB136VjKrCkdfTRynI8SBUnbSigPj_dkMUsJFBn0dykx_3pG.8v6EOsG_kHjgOYGUPwTPm6jga4YDZifpSGDcEc_GLK77kNnxnzGTACJHKucADGPvr541eR1D_VefSDd2.E2r_xebEvOvqBHXfTFhufy1XtpzaE0wik0wEyw0SeBfPZ70eFjb24tVaOnNFLhz5jv9ySDJyIhRneFQ0ocYOGPZdp.7iyhXHiKsKrXJo; cfz_zaraz-analytics=%7B%22_cfa_clientId%22%3A%7B%22v%22%3A%2267845109272994210%22%2C%22e%22%3A1798692079830%7D%2C%22_cfa_sId%22%3A%7B%22v%22%3A%2269955183204181710%22%2C%22e%22%3A1768663840178%7D%7D; cfzs_google-analytics_v4=%7B%22Vhiq_pageviewCounter%22%3A%7B%22v%22%3A%222%22%7D%7D; clerk_active_context=sess_38CZKUBoHnuu2A335FdHjqZM4xE:; __session=eyJhbGciOiJSUzI1NiIsImNhdCI6ImNsX0I3ZDRQRDExMUFBQSIsImtpZCI6Imluc18zNHZvbjFZYmR4cWpYU1BJeUROU0RUTTFZVkQiLCJ0eXAiOiJKV1QifQ.eyJhenAiOiJodHRwczovL21vdmVtZW50bGFicy5haSIsImV4cCI6MTc2ODY2MjEwMCwiZmVhIjoidToxMF9tZXNzYWdlc19wZXJfZGF5LHU6NV9oYXdrX3Byb21wdHNfcGVyX2RheSx1OmVtYWlsX3N1cHBvcnQiLCJmdmEiOls1OTQzLC0xXSwiaWF0IjoxNzY4NjYyMDQwLCJpc3MiOiJodHRwczovL2NsZXJrLm1vdmVtZW50bGFicy5haSIsIm5iZiI6MTc2ODY2MjAzMCwicGxhIjoidTpmcmVlX3VzZXIiLCJzaWQiOiJzZXNzXzM4Q1pLVUJvSG51dTJBMzM1RmRIanFaTTR4RSIsInN0cyI6ImFjdGl2ZSIsInN1YiI6InVzZXJfMzUwN2FUUHh2Q3RabXAxZDNTcVRydkVjWFBPIiwidiI6Mn0.ESwBP_ZZJT1vhCv5mWssazcEWuG0F-lDycIXm8_e6AC1nwoUIkzS4_PbteaCh-ZY1_oPWYdISnIxbh098mGe-zAt9AWeALqtLJf8sqaVTNWvAtToCW9kDHfazybHEviFcVnkNlO3hjmx37e6UiCQXPh-oTas-exIXTpjmSy4TRRzfF_HIQB1k2smqZNorQMIKq4ofeHJFJ3MPnRIqP6IkpWbwyzbq0Mybrm2TiXBf2zyMxNwv54AyIMRpPVkfjSjtTdnIwMG6wPYnBpPYSf0C8y6jfP3qH8ffEQqHEW0NEOf3VEECMCl4z8qdzRczLgzT5fLBXWhvbPdIELaSIUkIg; __session_8YHPIyOx=eyJhbGciOiJSUzI1NiIsImNhdCI6ImNsX0I3ZDRQRDExMUFBQSIsImtpZCI6Imluc18zNHZvbjFZYmR4cWpYU1BJeUROU0RUTTFZVkQiLCJ0eXAiOiJKV1QifQ.eyJhenAiOiJodHRwczovL21vdmVtZW50bGFicy5haSIsImV4cCI6MTc2ODY2MjEwMCwiZmVhIjoidToxMF9tZXNzYWdlc19wZXJfZGF5LHU6NV9oYXdrX3Byb21wdHNfcGVyX2RheSx1OmVtYWlsX3N1cHBvcnQiLCJmdmEiOls1OTQzLC0xXSwiaWF0IjoxNzY4NjYyMDQwLCJpc3MiOiJodHRwczovL2NsZXJrLm1vdmVtZW50bGFicy5haSIsIm5iZiI6MTc2ODY2MjAzMCwicGxhIjoidTpmcmVlX3VzZXIiLCJzaWQiOiJzZXNzXzM4Q1pLVUJvSG51dTJBMzM1RmRIanFaTTR4RSIsInN0cyI6ImFjdGl2ZSIsInN1YiI6InVzZXJfMzUwN2FUUHh2Q3RabXAxZDNTcVRydkVjWFBPIiwidiI6Mn0.ESwBP_ZZJT1vhCv5mWssazcEWuG0F-lDycIXm8_e6AC1nwoUIkzS4_PbteaCh-ZY1_oPWYdISnIxbh098mGe-zAt9AWeALqtLJf8sqaVTNWvAtToCW9kDHfazybHEviFcVnkNlO3hjmx37e6UiCQXPh-oTas-exIXTpjmSy4TRRzfF_HIQB1k2smqZNorQMIKq4ofeHJFJ3MPnRIqP6IkpWbwyzbq0Mybrm2TiXBf2zyMxNwv54AyIMRpPVkfjSjtTdnIwMG6wPYnBpPYSf0C8y6jfP3qH8ffEQqHEW0NEOf3VEECMCl4z8qdzRczLgzT5fLBXWhvbPdIELaSIUkIg`;

serve(async (req) => {
  const url = new URL(req.url);

  // CORS 设置，允许跨域调用
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "*",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // 1. 获取模型列表
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

  // 2. 聊天接口
  if (url.pathname === "/v1/chat/completions" && req.method === "POST") {
    try {
      const body = await req.json();
      const model = body.model || "tensor-max";
      
      // 构造随机 IP
      const fakeIp = getRandomIp();
      
      // 构造请求头
      const headers = new Headers(FAKE_HEADERS_BASE);
      headers.set("cookie", Deno.env.get("MOVEMENT_COOKIE") || DEFAULT_COOKIE);
      // IP 伪装：尝试绕过简单的 IP 频率限制
      headers.set("X-Forwarded-For", fakeIp);
      headers.set("X-Real-IP", fakeIp);

      const payload = {
        messages: body.messages.map((m: any) => ({ role: m.role, content: m.content })),
        model: model
      };

      console.log(`Proxying to Movement Labs... Model: ${model}, Pseudo-IP: ${fakeIp}`);

      const response = await fetch(TARGET_URL, {
        method: "POST",
        headers: headers,
        body: JSON.stringify(payload)
      });

      // 处理 Cloudflare 拦截 (常见状态码 403 或 503)
      if (response.status === 403 || response.status === 503) {
        const text = await response.text();
        console.error("Cloudflare Blocked:", text.slice(0, 200));
        return new Response(JSON.stringify({ 
          error: {
            message: "Upstream WAF Blocked. Cookie may be invalid or IP mismatched. Refresh cookie.",
            type: "upstream_error",
            code: response.status
          }
        }), { status: response.status, headers: { ...corsHeaders, "Content-Type": "application/json" }});
      }

      if (!response.ok) {
        return new Response(JSON.stringify({ error: await response.text() }), { status: response.status, headers: corsHeaders });
      }

      // 流式转换器
      const stream = new ReadableStream({
        async start(controller) {
          const reader = response.body?.getReader();
          if (!reader) {
            controller.close();
            return;
          }

          const decoder = new TextDecoder();
          let buffer = "";

          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;

              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split("\n");
              buffer = lines.pop() || ""; // 保留未完成的行

              for (const line of lines) {
                if (!line.trim()) continue;

                let content = null;
                // 解析 Movement Labs 格式: 0:"text"
                if (line.startsWith('0:')) {
                  try {
                    content = JSON.parse(line.substring(2));
                  } catch (e) { /* ignore parse error */ }
                }

                if (content) {
                  const chunk = {
                    id: `chatcmpl-${Date.now()}`,
                    object: "chat.completion.chunk",
                    created: Math.floor(Date.now() / 1000),
                    model: model,
                    choices: [{ index: 0, delta: { content }, finish_reason: null }]
                  };
                  controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(chunk)}\n\n`));
                }

                // 结束信号
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
            console.error("Stream Error", e);
            controller.error(e);
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
