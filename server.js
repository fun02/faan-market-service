import express from 'express'
import http from 'http'
import { Server } from 'socket.io'
import cors from 'cors'
import WebSocket from 'ws'
const app = express()
app.use(cors({origin:'*'}))
const server = http.createServer(app)
const io = new Server(server,{cors:{origin:'*'}})
const candles = new Map()
const getKey=(s,tf)=>`${s}:${tf}`
function save(c){
  const key=getKey(c.symbol,c.timeframe)
  if(!candles.has(key)) candles.set(key,[])
  const arr=candles.get(key); arr.push(c)
  if(arr.length>200) arr.shift()
  io.to(key).emit('candle',c)
  console.log(`[${c.symbol} ${c.timeframe}] ${c.c}`)
}
function startBinance(){
  const streams=['btcusdt@kline_1s','btcusdt@kline_1m','btcusdt@kline_5m','btcusdt@kline_15m','btcusdt@kline_1h','btcusdt@kline_1d','ethusdt@kline_1m'].join('/')
  const ws=new WebSocket(`wss://stream.binance.com:9443/ws/${streams}`)
  ws.on('open',()=>console.log('✅ Binance WS connected'))
  ws.on('message',raw=>{
    try{
      const k=JSON.parse(raw).k; if(!k) return
      const map={'BTCUSDT':'BTC/USD','ETHUSDT':'ETH/USD'}
      const tfMap={'1s':'1S','1m':'1M','5m':'5M','15m':'15M','1h':'1H','1d':'1D'}
      save({symbol:map[k.s]||k.s,timeframe:tfMap[k.i]||k.i,o:+k.o,h:+k.h,l:+k.l,c:+k.c,v:+k.v,ts:k.t,source:'binance'})
    }catch(e){}
  })
  ws.on('close',()=>setTimeout(startBinance,3000))
}
startBinance()
io.on('connection',s=>{
  s.on('subscribe',({symbol,tf})=>{
    const room=`${symbol}:${tf}`; s.join(room)
    s.emit('history',{symbol,tf,candles:(candles.get(room)||[]).slice(-60)})
  })
})
app.get('/',(req,res)=>res.json({status:'FAAN OK on Fly.io sin'}))
app.get('/candles',(req,res)=>{
  const {symbol='BTC/USD',timeframe='1S'}=req.query
  res.json((candles.get(`${symbol}:${timeframe}`)||[]).slice(-20))
})
server.listen(process.env.PORT||3001,()=>console.log('🚀 FAAN running'))
