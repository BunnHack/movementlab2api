/**
 * Movement Labs API to OpenAI Proxy (Vercel Stream Parser Fixed)
 * 部署平台: Deno Deploy (deno.dev)
 */

const UPSTREAM_URL = "https://movementlabs.ai/api/chat";
const MODEL_ID = "tensor-2.5";

const HEADERS = {
  "accept": "*/*",
  "accept-language": "zh-HK,zh;q=0.9,en-US;q=0.8,en;q=0.7,zh-TW;q=0.6",
  "content-type": "application/json",
  // 务必确保 Cookie 有效
  "cookie": "__client_uat=0; __client_uat_8YHPIyOx=0; cfz_zaraz-analytics=%7B%22_cfa_clientId%22%3A%7B%22v%22%3A%2267845109272994210%22%2C%22e%22%3A1798692079830%7D%2C%22_cfa_sId%22%3A%7B%22v%22%3A%2289920079323967330%22%2C%22e%22%3A1767354011883%7D%7D; cfzs_google-analytics_v4=%7B%22Vhiq_pageviewCounter%22%3A%7B%22v%22%3A%222%22%7D%7D; cfz_google-analytics_v4=%7B%22Vhiq_engagementDuration%22%3A%7B%22v%22%3A%228904%22%2C%22e%22%3A1798888221403%7D%2C%22Vhiq_engagementStart%22%3A%7B%22v%22%3A1767352227257%2C%22e%22%3A1798888228378%7D%2C%22Vhiq_counter%22%3A%7B%22v%22%3A%2215%22%2C%22e%22%3A1798888212499%7D%2C%22Vhiq_session_counter%22%3A%7B%22v%22%3A%222%22%2C%22e%22%3A1798888212499%7D%2C%22Vhiq_ga4%22%3A%7B%22v%22%3A%22bb8a7cd3-af28-4945-97f5-eba2c8ccf322%22%2C%22e%22%3A1798888212499%7D%2C%22Vhiq_let%22%3A%7B%22v%22%3A%221767352212499%22%2C%22e%22%3A1798888212499%7D%2C%22Vhiq_ga4sid%22%3A%7B%22v%22%3A%22688084256%22%2C%22e%22%3A1767354012499%7D%7D",
  "origin": "https://movementlabs.ai",
  "priority": "u=1, i",
  "referer": "https://movementlabs.ai/",
  "sec-ch-ua": '"Mises";v="141", "Not?A_Brand";v="8", "Chromium";v="141"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Linux"',
  "sec-fetch-dest": "empty",
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "same-origin",
  "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"
};

function setCorsHeaders(response) {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "*");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * 解析 Vercel AI SDK 的流格式
 * 格式示例: 
 * 0:"Hello"
 * 0:" World"
 * d:{}
 */
function parseVercelStream(rawText) {
  const lines = rawText.split("\n");
  let fullContent = "";

  for (const line of lines) {
    if (!line) continue;
    
    // 我们只关心以 0: 开头的行，这代表文本内容 delta
    if (line.startsWith('0:')) {
      try {
        // 去掉前缀 0:，剩余部分是一个 JSON 字符串，例如 "Hello"
        const jsonStr = line.substring(2);
        // 使用 JSON.parse 解析字符串，自动处理 \n 等转义
        const content = JSON.parse(jsonStr);
        fullContent += content;
      } catch (e) {
        console.warn("Parsing line failed:", line, e);
      }
    }
    // d:{} 是数据，e: 是错误，这里暂时忽略，只提取文本
  }
  return fullContent;
}

Deno.serve(async (req) => {
  const url = new URL(req.url);

  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "*",
      },
    });
  }

  if (url.pathname === "/v1/models") {
    return setCorsHeaders(Response.json({
      object: "list",
      data: [{
        id: MODEL_ID,
        object: "model",
        created: Math.floor(Date.now() / 1000),
        owned_by: "movementlabs",
      }],
    }));
  }

  if (url.pathname === "/v1/chat/completions" && req.method === "POST") {
    try {
      const inputBody = await req.json();

      console.log("Requesting Upstream...");
      const response = await fetch(UPSTREAM_URL, {
        method: "POST",
        headers: HEADERS,
        body: JSON.stringify({
          messages: inputBody.messages,
          model: MODEL_ID,
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        return setCorsHeaders(
          new Response(JSON.stringify({ error: `Upstream error: ${response.status}`, details: errText }), {
            status: response.status,
            headers: { "Content-Type": "application/json" }
          })
        );
      }

      // 1. 获取原始流文本
      const rawText = await response.text();
      
      // 2. 清洗数据（解析 Vercel 格式）
      const cleanContent = parseVercelStream(rawText);

      console.log("Cleaned content length:", cleanContent.length);

      // 3. 构造 OpenAI 格式
      const openAIResponse = {
        id: "chatcmpl-" + crypto.randomUUID(),
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: inputBody.model || MODEL_ID,
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: cleanContent, // 这里放的是清洗后的纯文本
            },
            finish_reason: "stop",
          },
        ],
        usage: {
          prompt_tokens: 0,
          completion_tokens: cleanContent.length,
          total_tokens: cleanContent.length,
        },
      };

      return setCorsHeaders(Response.json(openAIResponse));

    } catch (error) {
      console.error("Server Error:", error);
      return setCorsHeaders(
        new Response(JSON.stringify({ error: "Internal Server Error", message: error.message }), {
          status: 500,
          headers: { "Content-Type": "application/json" }
        })
      );
    }
  }

  return setCorsHeaders(new Response("Not Found", { status: 404 }));
});
