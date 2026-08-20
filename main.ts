const CORS = {"Access-Control-Allow-Origin":"*","Content-Type":"application/json"};
const TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") || "";
const CHAT_ID = Deno.env.get("TELEGRAM_CHAT_ID") || "";

async function sendTelegram(text: string) {
  if (!TOKEN || !CHAT_ID) return {ok:false, error:"ENV TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID belum set"};
  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`,{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body: JSON.stringify({chat_id: CHAT_ID, text, parse_mode:"Markdown"})
  });
  return await res.json();
}

Deno.serve(async (req)=>{
  const url = new URL(req.url);
  
  // test koneksi
  if(url.pathname === "/test-telegram"){
    const r = await sendTelegram("✅ FAAN Telegram Connected! Bot jalan.");
    return new Response(JSON.stringify(r),{headers:CORS});
  }

  // kirim pesan custom: /send?text=Halo
  if(url.pathname === "/send"){
    const text = url.searchParams.get("text") || "Halo dari FAAN";
    const r = await sendTelegram(text);
    return new Response(JSON.stringify(r),{headers:CORS});
  }

  // kirim via POST
  if(url.pathname === "/telegram" && req.method === "POST"){
    const {message, text} = await req.json();
    const r = await sendTelegram(message || text);
    return new Response(JSON.stringify(r),{headers:CORS});
  }

  return new Response(JSON.stringify({ok:true, service:"telegram-only", telegram: !!TOKEN}),{headers:CORS});
});
