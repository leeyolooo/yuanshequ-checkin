// ycoo.net 论坛自动签到
// 敏感信息通过环境变量传入

const BASE_URL = "https://pc.sysbbs.com";
const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
  Connection: "keep-alive",
};

const USERNAME = process.env.USERNAME;
const PASSWORD = process.env.PASSWORD;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

async function login(cookieJar) {
  const resp = await fetch(
    `${BASE_URL}/member.php?mod=logging&action=login&loginsubmit=yes&inajax=1`,
    {
      method: "POST",
      headers: {
        ...HEADERS,
        Cookie: cookieJar,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: `username=${encodeURIComponent(USERNAME)}&password=${encodeURIComponent(PASSWORD)}`,
    }
  );

  const text = await resp.text();
  const setCookie = resp.headers.get("set-cookie") || "";
  if (
    resp.ok &&
    (text.includes("欢迎您回来") || text.includes("succeedhandle_login"))
  ) {
    return mergeCookie(cookieJar, setCookie);
  } else {
    return "";
  }
}

async function getFormhash(cookieJar) {
  const resp = await fetch(`${BASE_URL}/k_misign-sign.html`, {
    headers: { ...HEADERS, Cookie: cookieJar },
  });
  const html = await resp.text();

  if (html.includes("今日已签")) {
    return null;
  }

  let match = html.match(/name="formhash"\s+value="([a-f0-9]+)"/i);
  if (match) return match[1];
  match = html.match(/formhash=([a-f0-9]+)/i);
  if (match) return match[1];
  return null;
}

async function signIn(cookieJar, formhash) {
  const url = `${BASE_URL}/plugin.php?id=k_misign:sign&operation=qiandao&formhash=${formhash}&format=empty`;
  const resp = await fetch(url, { headers: { ...HEADERS, Cookie: cookieJar } });
  const text = await resp.text();

  if (
    text.includes("成功") ||
    text.includes("恭喜") ||
    text.includes("<root><![CDATA[]]></root>")
  ) {
    return "✅ 签到成功";
  } else if (text.includes("今日已签")) {
    return "⚠️ 今日已签";
  } else {
    return "❌ 签到失败";
  }
}

async function sendTG(text) {
  if (!BOT_TOKEN || !CHAT_ID) {
    console.log("⚠️ Telegram 未配置，跳过通知");
    return;
  }
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: CHAT_ID, text }),
  });
}

function mergeCookie(oldCookie, newCookie) {
  const cookies = {};
  function add(str) {
    str.split(",").forEach((c) => {
      const kv = c.split(";")[0].trim().split("=");
      if (kv.length === 2) cookies[kv[0]] = kv[1];
    });
  }
  if (oldCookie) add(oldCookie);
  if (newCookie) add(newCookie);
  return Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

// ── 飞书消息卡片 ──────────────────────────────────────

function feishuCard(title, content) {
  const template = title.includes("✅") ? "green" : title.includes("❌") ? "red" : "orange";
  return {
    header: { title: { tag: "plain_text", content: title }, template },
    elements: [{ tag: "markdown", content }],
  };
}

async function sendFeishuMessage(content, title = "科研社区签到") {
  const webhook = process.env.FEISHU_WEBHOOK;
  if (!webhook) return;
  const secret = process.env.FEISHU_SECRET;
  const card = feishuCard(title, content);
  let payload;
  if (secret) {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const crypto = await import("crypto");
    const sign = crypto
      .createHmac("sha256", secret)
      .update(`${timestamp}\n${secret}`)
      .digest("base64");
    payload = { timestamp, sign, msg_type: "interactive", card };
  } else {
    payload = { msg_type: "interactive", card };
  }
  try {
    const resp = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await resp.json();
    if (data.code === 0 || data.StatusCode === 0) {
      console.log("📤 飞书机器人 推送成功");
    } else {
      console.log("❌ 飞书机器人 推送失败:", JSON.stringify(data));
    }
  } catch (e) {
    console.log("❌ 飞书机器人 推送异常:", e);
  }
}

async function sendFeishuAppMessage(content, title = "科研社区签到") {
  const appId = process.env.FEISHU_APP_ID;
  const appSecret = process.env.FEISHU_APP_SECRET;
  const receiveId = process.env.FEISHU_APP_RECEIVE_ID;
  const receiveType = process.env.FEISHU_APP_RECEIVE_TYPE || "open_id";
  if (!appId || !appSecret || !receiveId) return;

  // 1. 获取 tenant_access_token
  let tenantToken;
  try {
    const resp = await fetch(
      "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
      }
    );
    const data = await resp.json();
    tenantToken = data.tenant_access_token;
    if (!tenantToken) {
      console.log("❌ 飞书应用 获取token失败:", JSON.stringify(data));
      return;
    }
  } catch (e) {
    console.log("❌ 飞书应用 获取token异常:", e);
    return;
  }

  // 2. 发送消息卡片
  const card = feishuCard(title, content);
  try {
    const resp = await fetch(
      `https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=${receiveType}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tenantToken}`,
        },
        body: JSON.stringify({
          receive_id: receiveId,
          msg_type: "interactive",
          content: JSON.stringify(card),
        }),
      }
    );
    const data = await resp.json();
    if (data.code === 0) {
      console.log("📤 飞书应用 推送成功");
    } else {
      console.log("❌ 飞书应用 推送失败:", JSON.stringify(data));
    }
  } catch (e) {
    console.log("❌ 飞书应用 推送异常:", e);
  }
}

async function notifyAll(content, title) {
  await Promise.all([
    sendTG(content),
    sendFeishuMessage(content, title),
    sendFeishuAppMessage(content, title),
  ]);
}

async function run() {
  let statusLogin = "❌ 登录失败";
  let statusSign = "❌ 签到失败";

  const now = new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });

  let cookieJar = "";
  cookieJar = await login(cookieJar).catch(() => "");
  if (cookieJar) {
    statusLogin = "✅ 登录成功";

    const formhash = await getFormhash(cookieJar);
    if (formhash) {
      const result = await signIn(cookieJar, formhash);
      statusSign = result;
    } else {
      statusSign = "⚠️ 今日已签";
    }
  }

  const content = `📆 时间：${now}\n\n${statusLogin}\n${statusSign}`;
  const allOk = statusLogin.includes("✅") && (statusSign.includes("✅") || statusSign.includes("⚠️"));
  const title = allOk ? "✅ 科研社区签到成功" : "❌ 科研社区签到失败";
  const msg = `🎯 ycoo.net 自动签到\n${content}`;

  console.log(msg);
  await notifyAll(msg, title);
}

run().catch(console.error);

