 globalThis.jotaiAtomCache = globalThis.jotaiAtomCache || {
  cache: new Map(),
  get(e, t) {
    if (this.cache.has(e)) {
      return this.cache.get(e);
    } else {
      this.cache.set(e, t);
      return t;
    }
  },
};
function M1t(e, t) {
  const r = new RegExp(${e}\\s?=\\s?"([^"]+)").exec(t);
  if (!r) {
    throw new Error("Failed to get csrfToken");
  }
  return r[1];

[
  {
    "id": 1,
    "priority": 1,
    "action": {
      "type": "modifyHeaders",
      "requestHeaders": [
        {
          "header": "origin",
          "operation": "set",
          "value": "https://www.tongyi.com"
        },
        {
          "header": "referer",
          "operation": "set",
          "value": "https://www.tongyi.com/"
        }
      ]
    },
    "condition": {
      "requestDomains": ["qianwen.aliyun.com", "qianwen.biz.aliyun.com", "api.tongyi.com"],
      "resourceTypes": ["xmlhttprequest"]
    }
  }
]
}
async function D1t() {
  const e = await en("https://www.tongyi.com/qianwen/", {
    parseResponse: (t) => t,
  });
  return M1t("csrfToken", e);
}
globalThis.jotaiAtomCache = globalThis.jotaiAtomCache || {
  cache: new Map(),
  get(e, t) {
    if (this.cache.has(e)) {
      return this.cache.get(e);
    } else {
      this.cache.set(e, t);
      return t;
    }
  },
};
class L1t extends fu {
  constructor() {
    super(...arguments);
    yi(this, "context");
  }
  async doSendMessage(n) {
    if (!this.context) {
      const i = await D1t();
      this.context = {
        csrfToken: i,
      };
    }
    const r = await fetch("https://api.tongyi.com/dialog/conversation", {
      method: "POST",
      signal: n.signal,
      headers: {
        "Content-Type": "application/json",
        "X-Platform": "pc_tongyi",
        "X-Xsrf-Token": this.context.csrfToken,
      },
      body: JSON.stringify({
        action: "next",
        contents: [
          {
            contentType: "text",
            content: n.prompt,
            role: "user",
          },
        ],
        mode: "chat",
        model: "",
        parentMsgId: this.context.lastMessageId || "",
        sessionId: this.context.sessionId || "",
        sessionType: "textchat",
        userAction: "chat",
      }),
    });
    await M(r, (i) => {
      var l;
      if (i === "[DONE]") {
        n.onEvent({
          type: "DONE",
        });
        return;
      }
      const o = JSON.parse(i);
      if (o.errorCode === "NOT_LOGIN") {
        throw new nn("请先登录通义千问", hn.QIANWEN_WEB_UNAUTHORIZED);
      }
      const s =
        (l = (o.contents || []).filter((u) => u.contentType === "text")[0]) ==
        null
          ? undefined
          : l.content;
      if (s) {
        n.onEvent({
          type: "UPDATE_ANSWER",
          data: {
            parts: [
              {
                type: "text",
                text: s,
              },
            ],
          },
        });
        this.context.sessionId = o.sessionId;
        this.context.lastMessageId = o.msgId;
      }
    });
  }
  resetConversation() {
    this.context = undefined;
  }
  get name() {
    return "通义千问";
  }
}
globalThis.jotaiAtomCache = globalThis.jotaiAtomCache || {
  cache: new Map(),
  get(e, t) {
    if (this.cache.has(e)) {
      return this.cache.get(e);
    } else {
      this.cache.set(e, t);
      return t;
    }
  },
};
async function F1t(e) {
  const t = await cL();
  if (wT.includes(e)) {
    const n = Pie(e);
    return new Cp(n.model, n.capabilities.includes("vision"));
  }
  switch (e) {
    case "chatgpt":
      return new lmt(t.chatgptWebappModelName, t.chatgptWebappHistoryDisabled);
    case "bing":
      return new I1t();
    case "bard":
      return new g0t();
    case "claude":
      return new Hmt();
    case "deepseek":
      return new Cp("deepseek/deepseek-v3-ext");
    case "llama":
      return new Cp("meta/llama3.1-8b");
    case "mistral":
      return new Cp("mistral/mixtral-8x7b");
    case "gemma":
      return new Cp("google/gemma-2");
    case "pi":
      return new $1t();
    case "qianwen":
      return new L1t();
    case "perplexity":

Looking at that Qwen code, you have a complete working implementation. The key components:

javascript
// 1. Fetch CSRF token from main page
async function D1t() {
  const html = await fetch("https://www.tongyi.com/qianwen/");
  return extractCsrfToken(html); // Regex: csrfToken\s?=\s?"([^"]+)"
}

// 2. Send message with token
fetch("https://api.tongyi.com/dialog/conversation", {
  headers: {
    "X-Platform": "pc_tongyi",
    "X-Xsrf-Token": csrfToken
  },
  body: JSON.stringify({
    contents: [{ contentType: "text", content: prompt, role: "user" }],
    sessionId: this.context.sessionId || "",
    parentMsgId: this.context.lastMessageId || ""
  })
});
This is trivial to implement. No fingerprinting, no PoW, just:

Fetch HTML page → extract CSRF token via regex
Send POST with token → get SSE response
Store sessionId/messageId for continuation
The DNR rules are just setting origin/referer headers (you already do this for other providers).