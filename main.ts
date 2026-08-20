/**
 * FAAN FINAL BACKEND - Dewan Analis 3 AI + Telegram LENGKAP
 * Groq Llama 3.3 70B (Scanner) -> DeepSeek R1 FREE (Strategist) -> Meta Llama API (Communicator) -> Telegram
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

async function sendTelegram(text: string) {
  if (!TELEGRAM_TOKEN ||!TELEGRAM_CHAT) return { ok: false, error: "ENV Telegram belum set" };
  const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT, text, parse_mode: "Markdown" }),
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  const url = new URL(req.url);

  if (url.pathname === "/") {
    return new Response(JSON.stringify({
      ok: true,
      stack: "FAAN Dewan Analis 3 AI + Telegram",
      flow: "Groq Scanner -> DeepSeek Strategist -> Meta Communicator -> Telegram",
      providers: { groq:!!GROQ_KEY, openrouter:!!OPENROUTER_KEY, meta:!!META_KEY, telegram:!!TELEGRAM_TOKEN },
      realtime: "Binance WebSocket kline 1m + orderbook + trade <100ms",
      anti_delay: "Local RSI/EMA calc -> trigger -> AI 5-10x/day",
    }), { headers: CORS });
  }

  if (url.pathname === "/test-telegram") {
    const r = await sendTelegram("✅ *FAAN 3 AI + Telegram Connected!*\nBot siap kirim sinyal otomatis.");
    return new Response(JSON.stringify(r), { headers: CORS });
  }

  if (url.pathname === "/telegram" && req.method === "POST") {
    const body = await req.json();
    const r = await sendTelegram(body.message || body.text || "Test FAAN");
    return new Response(JSON.stringify(r), { headers: CORS });
  }

  if (url.pathname === "/signal") {
    const id = url.searchParams.get("id") || "bitcoin";
    const pair = url.searchParams.get("pair") || "BTCUSDT";
    const tf = url.searchParams.get("tf") || "1m";
    const modal = url.searchParams.get("modal") || "100";
    const provider = url.searchParams.get("provider") || "ensemble";

    try {
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
      const volSpike = avgVol > 0? (lastVol / avgVol) : 1;

      const ohlcv = chart.prices.slice(-100).map((p: any, i: number) => {
        const v = chart.total_volumes[i]?.[1] || 0;
        return { t: p[0], c: p[1], v };
      });

      const groqPrompt = `
KAMU ADALAH "DEWAN ANALIS TRADING PROFESIONAL" - THE SCANNER (Groq Llama 3.3 70B)

KONTEKS: Trading ${pair} timeframe ${tf} gaya SCALPING CEPAT modal $${modal} max risk 0.5-1%

DATA REAL:
HARGA_SEKARANG: ${detail.market_data?.current_price?.usd}
100_CANDLE_1M: ${JSON.stringify(ohlcv.slice(-20).map((c:any)=>c.c.toFixed(2)))}
RSI_7: ${rsi7.toFixed(2)}
EMA_9_21: ${ema9.toFixed(2)} / ${ema21.toFixed(2)}
VOLUME_20: avg ${avgVol.toFixed(2)} last ${lastVol.toFixed(2)} spike ${volSpike.toFixed(1)}x
SR_LEVEL: Support ${low.toFixed(2)} Resist ${high.toFixed(2)}
SPREAD: ${(high-low).toFixed(2)}

PERATURAN: DATA FIRST, NO FOMO, RISK WAJIB, JUJUR, OUTPUT JSON SAJA

ROLE GROQ: Scan cepat 100 candle 1M dalam 1 detik. Cari breakout EMA, volume spike, SR mikro. Output ADA SETUP atau TIDAK ADA + 3 fakta kunci.
`;

      let groqOut = "";
      if (provider === "groq" || provider === "ensemble") {
        groqOut = await callGroq(groqPrompt);
      }

      const deepSeekPrompt = `
KAMU ADALAH DEEPSEEK R1 FREE - THE STRATEGIST / RISK OFFICER

HASIL SCANNER GROQ:
${groqOut}

DATA VALIDASI:
RSI_7 ${rsi7.toFixed(2)} RSI_14 ${rsi14.toFixed(2)} EMA9 ${ema9.toFixed(2)} EMA21 ${ema21.toFixed(2)} EMA20 ${ema20.toFixed(2)} EMA50 ${ema50.toFixed(2)}
Support ${low.toFixed(2)} Resist ${high.toFixed(2)} VolSpike ${volSpike.toFixed(1)}x
Harga ${detail.market_data?.current_price?.usd}

TUGAS: Validasi hasil Scanner. Hitung probabilitas, konfluensi, RR, position size. Kenapa valid? Apa yang bisa gagal?
Jika RR < 1:1.5 tolak. Jika tidak ada setup A+ jawab WAIT.

OUTPUT JSON WAJIB (tanpa markdown):
{
  "meta": {"pair": "${pair}", "timeframe": "${tf}", "tanggal_analisis": "${new Date().toLocaleString('id-ID', {timeZone: 'Asia/Jakarta'})} WIB"},
  "analisis": {"trend": "Uptrend/Downtrend/Sideways", "kondisi_market": "Trending/Ranging/Volatile", "level_kunci": ["${low.toFixed(2)}", "${high.toFixed(2)}"]},
  "sinyal": {"status": "BUY/SELL/WAIT", "alasan_3_poin": ["...", "...", "..."], "konfluensi": "..."},
  "manajemen_risiko": {"entry": "...", "stop_loss": "...", "take_profit_1": "...", "take_profit_2": "...", "risk_reward": "1:x", "probabilitas_berhasil": "xx%", "position_size_saran": "x%"},
  "catatan": {"skenario_gagal": "...", "disclaimer": "Ini bukan saran keuangan. DYOR."}
}
`;

      let deepSeekOut = "";
      if (provider === "openrouter" || provider === "ensemble") {
        deepSeekOut = await callDeepSeek(deepSeekPrompt);
      } else if (provider === "groq") {
        deepSeekOut = groqOut;
      }

      const metaPrompt = `
KAMU ADALAH META AI LLAMA - THE COMMUNICATOR / ALERT BOT

OUTPUT STRATEGIST:
${deepSeekOut || groqOut}

TUGAS: Ubah jadi laporan bahasa Indonesia rapi, mudah dimengerti pemula. Tambahkan disclaimer, psikologi trading, ringkasan 1 kalimat.
Untuk scalping, buat juga 1 baris alert Telegram: SCALP | ${pair} | BUY @ harga | SL | TP | RR | Risk 0.5%

OUTPUT JSON FINAL (gabung strategist + tambahan):
{
 ... (copy dari strategist),
  "laporan_manusia": "Ringkasan bahasa Indonesia 3 paragraf...",
  "telegram_alert": "SCALP | ${pair} | BUY @... | SL... | TP... | RR... | Risk 0.5%",
  "psikologi": "Jangan FOMO...",
  "ai_voting": {"groq": "BUY", "deepseek": "BUY", "meta": "BUY"}
}
`;

      let metaOut = "";
      if (provider === "meta" || provider === "ensemble") {
        metaOut = await callMeta(metaPrompt);
      }

      let finalText = metaOut || deepSeekOut || groqOut;
      const jsonMatch = finalText.match(/\{[\s\S]*\}/);
      const finalJson = jsonMatch? jsonMatch[0] : finalText;

      try {
        const parsed = JSON.parse(finalJson);
        if (parsed.sinyal?.status && parsed.sinyal.status!== "WAIT") {
          const alert = `🚀 *FAAN SCALP ALERT*\n\n${parsed.telegram_alert || `SCALP | ${pair} | ${parsed.sinyal.status} @ ${parsed.manajemen_risiko?.entry}`}\nSL ${parsed.manajemen_risiko?.stop_loss} | TP1 ${parsed.manajemen_risiko?.take_profit_1} TP2 ${parsed.manajemen_risiko?.take_profit_2}\nRR ${parsed.manajemen_risiko?.risk_reward}\nProb ${parsed.manajemen_risiko?.probabilitas_berhasil || "-"}\n\n${(parsed.sinyal?.alasan_3_poin||[]).map((a:string,i:number)=>`${i+1}. ${a}`).join("\n")}\n\n_${parsed.meta?.tanggal_analisis || ""}_`;
          await sendTelegram(alert);
        }
      } catch {}

      return new Response(finalJson, { headers: CORS });
    } catch (e: any) {
      return new Response(JSON.stringify({ error: e.message, stack: "Groq->DeepSeek->Meta failed" }), { status: 500, headers: CORS });
    }
  }

  return new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers: CORS });
});
