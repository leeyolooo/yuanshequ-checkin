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

  const msg = `🎯 ycoo.net 自动签到\n📆 时间：${now}\n\n${statusLogin}\n${statusSign}`;
  console.log(msg);
  await sendTG(msg);
}

run().catch(console.error);
