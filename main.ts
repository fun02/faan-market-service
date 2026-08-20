/**
 * FAAN FINAL BACKEND - Dewan Analis 3 AI + Telegram Webhook + FIRESTORE CLOUD
 * Groq Llama 3.3 70B (Scanner) -> DeepSeek R1 FREE (Strategist) -> Meta Llama API (Communicator) -> Telegram + Firestore
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "*",
  "Access-Control-Allow-Headers": "*",
  "Content-Type": "application/json",
};

const GROQ_KEY = Deno.env.get("GROQ_KEY") || "";
const OPENROUTER_KEY = Deno.env.get("OPENROUTER_KEY") || "";
const META_KEY = Deno.env.get("META_KEY") || GROQ_KEY;
const TELEGRAM_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") || "";
const TELEGRAM_CHAT = Deno.env.get("TELEGRAM_CHAT_ID") || "";

// FIRESTORE CONFIG - pakai yang kamu punya di fannmarket.web.app
const FIREBASE_PROJECT_ID = Deno.env.get("FIREBASE_PROJECT_ID") || "fannmarket";
const FIREBASE_API_KEY = Deno.env.get("FIREBASE_API_KEY") || ""; // optional, tapi butuh kalau rules butuh key
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;

function toFirestoreFields(obj: any) {
  // Simpan simple: pair, status, timestamp, + full json sebagai string
  const now = new Date().toISOString();
  return {
    fields: {
      pair: { stringValue: String(obj.pair || obj.id || "BTCUSDT") },
      status: { stringValue: String(obj.sinyal?.status || obj.status || "WAIT") },
      timestamp: { timestampValue: obj.timestamp || now },
      createdAt: { integerValue: String(Date.now()) },
      source: { stringValue: String(obj.source || "unknown") },
      chatId: { stringValue: String(obj.chatId || "") },
      json: { stringValue: JSON.stringify(obj).slice(0, 1000000) }, // Firestore limit 1MB
    }
  };
}

function fromFirestoreDoc(doc: any) {
  try {
    const f = doc.fields || {};
    const jsonStr = f.json?.stringValue || "{}";
    const parsed = JSON.parse(jsonStr);
    // override dengan field penting biar gampang diakses
    return {
      ...parsed,
      _id: doc.name?.split("/").pop(),
      pair: f.pair?.stringValue || parsed.pair,
      status: f.status?.stringValue || parsed.sinyal?.status,
      timestamp: f.timestamp?.timestampValue || parsed.timestamp,
    };
  } catch {
    return { _raw: doc };
  }
}

async function saveToCloud(data: any) {
  const payload = toFirestoreFields({ ...data, timestamp: new Date().toISOString() });
  const url = `${FIRESTORE_BASE}/signals${FIREBASE_API_KEY ? `?key=${FIREBASE_API_KEY}` : ""}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const j = await res.json();
    if (!res.ok) {
      console.error("Firestore save error", j);
      // fallback log aja biar bot tetap jalan walau firestore error
      return null;
    }
    return j.name;
  } catch (e) {
    console.error("saveToCloud firestore error", e);
    return null;
  }
}

async function getCloudHistory(limit = 10) {
  // pakai runQuery biar bisa orderBy timestamp DESC
  const url = `${FIRESTORE_BASE}:runQuery${FIREBASE_API_KEY ? `?key=${FIREBASE_API_KEY}` : ""}`;
  const body = {
    structuredQuery: {
      from: [{ collectionId: "signals" }],
      orderBy: [{ field: { fieldPath: "createdAt" }, direction: "DESCENDING" }],
      limit: limit,
    }
  };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const arr = await res.json();
    if (!Array.isArray(arr)) {
      console.error("Firestore get error", arr);
      return [];
    }
    const history = arr
      .filter((r: any) => r.document)
      .map((r: any) => fromFirestoreDoc(r.document));
    return history;
  } catch (e) {
    console.error("getCloudHistory error", e);
    return [];
  }
}

async function sendTelegram(text: string, chatId?: string) {
  if (!TELEGRAM_TOKEN) return { ok: false, error: "TELEGRAM ENV belum set" };
  const target = chatId || TELEGRAM_CHAT;
  if (!target) return { ok: false, error: "No chat id" };
  const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: target, text, parse_mode: "Markdown" }),
  });
  return await res.json();
}

function calcRSI(prices: number[], period = 7): number {
  if (prices.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = prices.length - period; i < prices.length; i++) {
    if (i <= 0) continue;
    const diff = prices[i] - prices[i - 1];
    if (diff >= 0) gains += diff; else losses -= diff;
  }
  if (losses === 0) return 100;
  const rs = gains / (losses || 1);
  return 100 - 100 / (1 + rs);
}

function calcEMA(prices: number[], period: number): number[] {
  const k = 2 / (period + 1);
  let ema: number[] = [];
  let sma = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  ema.push(sma);
  for (let i = period; i < prices.length; i++) {
    ema.push(prices[i] * k + ema[ema.length - 1] * (1 - k));
  }
  return ema;
}

async function callGroq(prompt: string): Promise<string> {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${GROQ_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "llama-3.3-70b-versatile", messages: [{ role: "user", content: prompt }], temperature: 0.2 }),
  });
  const j = await res.json();
  return j.choices?.[0]?.message?.content || "";
}

async function callDeepSeek(prompt: string): Promise<string> {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENROUTER_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://fannmarket.web.app",
      "X-Title": "FAAN Dewan Analis",
    },
    body: JSON.stringify({ model: "deepseek/deepseek-r1:free", messages: [{ role: "user", content: prompt }], temperature: 0.2 }),
  });
  const j = await res.json();
  return j.choices?.[0]?.message?.content || "";
}

async function callMeta(prompt: string): Promise<string> {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${META_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "llama3-70b-8192", messages: [{ role: "user", content: prompt }], temperature: 0.3 }),
  });
  const j = await res.json();
  return j.choices?.[0]?.message?.content || "";
}

async function getSignal(id = "bitcoin", pair = "BTCUSDT", tf = "1m", modal = "100", provider = "ensemble") {
  const [chart, detail] = await Promise.all([
    fetch(`https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=1`).then(r => r.json()),
    fetch(`https://api.coingecko.com/api/v3/coins/${id}`).then(r => r.json()),
  ]);
  const prices: number[] = chart.prices.map((p: any) => p[1]);
  const volumes: number[] = chart.total_volumes.map((v: any) => v[1]);
  const rsi7 = calcRSI(prices, 7);
  const rsi14 = calcRSI(prices, 14);
  const ema9 = calcEMA(prices, 9).pop() || 0;
  const ema21 = calcEMA(prices, 21).pop() || 0;
  const ema20 = calcEMA(prices, 20).pop() || 0;
  const ema50 = calcEMA(prices, 50).pop() || 0;
  const low = Math.min(...prices.slice(-20));
  const high = Math.max(...prices.slice(-20));
  const lastVol = volumes[volumes.length - 1] || 0;
  const avgVol = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const volSpike = avgVol > 0 ? (lastVol / avgVol) : 1;

  const groqPrompt = `KAMU DEWAN ANALIS - SCANNER Groq ${pair} TF ${tf} Harga ${detail.market_data?.current_price?.usd} RSI7 ${rsi7.toFixed(2)} EMA9 ${ema9.toFixed(2)} EMA21 ${ema21.toFixed(2)} Support ${low} Resist ${high} VolSpike ${volSpike.toFixed(1)}x`;
  let groqOut = "";
  if (provider === "groq" || provider === "ensemble") groqOut = await callGroq(groqPrompt);

  const deepSeekPrompt = `STRATEGIST DeepSeek R1 - HASIL SCANNER: ${groqOut} RSI7 ${rsi7.toFixed(2)} RSI14 ${rsi14.toFixed(2)} EMA9 ${ema9} EMA21 ${ema21} Support ${low} Resist ${high} Harga ${detail.market_data?.current_price?.usd} - Output JSON sinyal BUY/SELL/WAIT + RR + SL TP + telegram_alert`;
  let deepSeekOut = "";
  if (provider === "openrouter" || provider === "ensemble") deepSeekOut = await callDeepSeek(deepSeekPrompt); else deepSeekOut = groqOut;

  const metaPrompt = `COMMUNICATOR Meta Llama - OUTPUT STRATEGIST: ${deepSeekOut || groqOut} - Jadi JSON final + laporan_manusia ID + telegram_alert SCALP | ${pair} | BUY @... | SL... | TP...`;
  let metaOut = "";
  if (provider === "meta" || provider === "ensemble") metaOut = await callMeta(metaPrompt);

  let finalText = metaOut || deepSeekOut || groqOut;
  const jsonMatch = finalText.match(/\{[\s\S]*\}/);
  return jsonMatch ? jsonMatch[0] : finalText;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  const url = new URL(req.url);

  if (url.pathname === "/") {
    return new Response(JSON.stringify({
      ok: true,
      stack: "FAAN Dewan Analis 3 AI + Telegram + Firestore",
      flow: "Groq Scanner -> DeepSeek Strategist -> Meta Communicator -> Telegram + Firestore",
      providers: { groq: !!GROQ_KEY, openrouter: !!OPENROUTER_KEY, meta: !!META_KEY, telegram: !!TELEGRAM_TOKEN, firestore: !!FIREBASE_PROJECT_ID },
      webhook: "/webhook",
      cloud: "Firestore - fannmarket",
      endpoints: { history: "/history?limit=20", firestore: FIRESTORE_BASE },
    }), { headers: CORS });
  }

  if (url.pathname === "/test-telegram") {
    const r = await sendTelegram("✅ *FAAN 3 AI + Telegram + Firestore Connected!*\n\nBot siap kirim sinyal otomatis + save ke Firestore.");
    return new Response(JSON.stringify(r), { headers: CORS });
  }

  if (url.pathname === "/webhook" || url.pathname === "/telegram-webhook") {
    try {
      const body = await req.json();
      const msg = body.message || body.edited_message;
      const chatId = msg?.chat?.id?.toString();
      const text = msg?.text?.trim() || "";
      const username = msg?.from?.username || "trader";

      if (!chatId) return new Response("ok", { headers: CORS });

      if (text.startsWith("/start")) {
        const welcome = `🚀 *FAAN SIGNAL BOT AKTIF - FIRESTORE*

Halo @${username}! Bot Dewan Analis 3 AI siap.

*Commands:*
/start - menu ini
/sinyal - cek sinyal BTCUSDT sekarang
/sinyal ETH - cek ETHUSDT
/riwayat - liat 10 sinyal terakhir dari Firestore
/status - cek status AI + Firestore

*Auto Alert:* Bot akan kirim sinyal otomatis ke chat ini kalau ada setup BUY/SELL A+.

Pair default: BTCUSDT 1m RR 1:1.2

Ketik /sinyal untuk test sekarang.`;
        await sendTelegram(welcome, chatId);
      } else if (text.startsWith("/sinyal") || text.startsWith("/signal")) {
        const parts = text.split(" ");
        const pair = (parts[1] || "BTCUSDT").toUpperCase();
        const id = pair.includes("BTC") ? "bitcoin" : pair.includes("ETH") ? "ethereum" : "bitcoin";
        await sendTelegram(`⏳ Analisa ${pair} 1m sedang diproses 3 AI... (max 25 detik)`, chatId);
        try {
          const timeout = new Promise<string>((_, rej) => setTimeout(() => rej(new Error("AI timeout >25s - coba /sinyal lagi")), 25000));
          const finalJson = await Promise.race([getSignal(id, pair, "1m", "100", "ensemble"), timeout]) as string;
          let parsed: any;
          try { parsed = JSON.parse(finalJson); } catch { parsed = { sinyal: { status: "WAIT", alasan_3_poin: [finalJson.slice(0,200)] } }; }
          // SAVE TO FIRESTORE
          await saveToCloud({ pair, id, tf: "1m", ...parsed, chatId, username, source: "telegram/sinyal" });
          const status = parsed.sinyal?.status || "WAIT";
          if (status === "WAIT") {
            await sendTelegram(`⏸️ *${pair} WAIT*\n\nBelum ada setup A+. ${parsed.sinyal?.alasan_3_poin?.[0] || "Market ranging."}\n\nCoba lagi 2-3 menit.`, chatId);
          } else {
            const alert = `🚀 *FAAN SCALP ALERT*\n\n${parsed.telegram_alert || `SCALP | ${pair} | ${status} @ ${parsed.manajemen_risiko?.entry}`}\nSL ${parsed.manajemen_risiko?.stop_loss} | TP1 ${parsed.manajemen_risiko?.take_profit_1} TP2 ${parsed.manajemen_risiko?.take_profit_2}\nRR ${parsed.manajemen_risiko?.risk_reward} | Prob ${parsed.manajemen_risiko?.probabilitas_berhasil || "-"}\n\n${(parsed.sinyal?.alasan_3_poin||[]).map((a:string,i:number)=>`${i+1}. ${a}`).join("\n")}`;
            await sendTelegram(alert, chatId);
          }
        } catch (e:any) {
          console.error("sinyal error", e);
          await sendTelegram(`❌ Error analisa: ${e.message}`, chatId);
        }
      } else if (text.startsWith("/riwayat") || text.startsWith("/history")) {
        const history = await getCloudHistory(10);
        if (history.length === 0) {
          await sendTelegram(`📭 *Riwayat Kosong di Firestore*\n\nBelum ada sinyal tersimpan.\n\nKetik /sinyal untuk generate sinyal pertama.`, chatId);
        } else {
          let msg = `📚 *RIWAYAT ${history.length} SINYAL TERAKHIR - FIRESTORE*\n\n`;
          history.forEach((h: any, i: number) => {
            const t = h.timestamp ? new Date(h.timestamp).toLocaleString("id-ID") : "-";
            const s = h.sinyal?.status || h.status || "WAIT";
            const p = h.pair || "BTCUSDT";
            const price = h.manajemen_risiko?.entry || "-";
            msg += `${i+1}. ${p} - ${s} @ ${price}\n   ${t}\n`;
          });
          await sendTelegram(msg, chatId);
        }
      } else if (text.startsWith("/status")) {
        const history = await getCloudHistory(1);
        const all = await getCloudHistory(100);
        await sendTelegram(`✅ *FAAN Status - Firestore*\n\nGroq: ${!!GROQ_KEY ? "ON" : "OFF"}\nOpenRouter: ${!!OPENROUTER_KEY ? "ON" : "OFF"}\nMeta: ${!!META_KEY ? "ON" : "OFF"}\nTelegram: ${!!TELEGRAM_TOKEN ? "ON" : "OFF"}\nFirestore: ${FIREBASE_PROJECT_ID} (${all.length} sinyal)\nLast: ${history[0]?.timestamp || "belum ada"}\n\nURL: fannmarket.web.app`, chatId);
      } else {
        if (text) {
          await sendTelegram(`Ketik /start untuk menu, /sinyal untuk cek sinyal BTCUSDT, /riwayat untuk liat history Firestore.`, chatId);
        }
      }

      return new Response(JSON.stringify({ ok: true }), { headers: CORS });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: String(e) }), { headers: CORS });
    }
  }

  if (url.pathname === "/telegram" && req.method === "POST") {
    const { message, text, chatId } = await req.json();
    const r = await sendTelegram(message || text || "Test FAAN", chatId);
    return new Response(JSON.stringify(r), { headers: CORS });
  }

  if (url.pathname === "/signal") {
    const id = url.searchParams.get("id") || "bitcoin";
    const pair = url.searchParams.get("pair") || "BTCUSDT";
    const tf = url.searchParams.get("tf") || "1m";
    const modal = url.searchParams.get("modal") || "100";
    const provider = url.searchParams.get("provider") || "ensemble";

    try {
      const finalJson = await getSignal(id, pair, tf, modal, provider);
      try {
        const parsed = JSON.parse(finalJson);
        await saveToCloud({ pair, tf, provider, ...parsed, source: "api/signal" });
        if (parsed.sinyal?.status && parsed.sinyal.status !== "WAIT") {
          const alert = `🚀 *FAAN SCALP ALERT*\n\n${parsed.telegram_alert || `SCALP | ${pair} | ${parsed.sinyal.status} @ ${parsed.manajemen_risiko?.entry}`}\nSL ${parsed.manajemen_risiko?.stop_loss} | TP1 ${parsed.manajemen_risiko?.take_profit_1} TP2 ${parsed.manajemen_risiko?.take_profit_2}\nRR ${parsed.manajemen_risiko?.risk_reward}\n\n${(parsed.sinyal?.alasan_3_poin||[]).map((a:string,i:number)=>`${i+1}. ${a}`).join("\n")}`;
          await sendTelegram(alert);
        }
      } catch {}
      return new Response(finalJson, { headers: CORS });
    } catch (e: any) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: CORS });
    }
  }

  if (url.pathname === "/history") {
    const limit = parseInt(url.searchParams.get("limit") || "20");
    const history = await getCloudHistory(limit);
    return new Response(JSON.stringify({ ok: true, source: "firestore", project: FIREBASE_PROJECT_ID, count: history.length, history }), { headers: CORS });
  }

  return new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers: CORS });
});
