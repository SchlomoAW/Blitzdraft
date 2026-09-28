import { DurableObject } from "cloudflare:workers";

const API = "https://db.ygoprodeck.com/api/v7/cardinfo.php";
const IMAGE = "https://images.ygoprodeck.com/images/cards_small/";
const COLORS = ["#e53935", "#1e88e5", "#43a047", "#8e24aa", "#fb8c00", "#00897b", "#6d4c41", "#3949ab"];
const ROUND_PAUSE_MS = 2000;
const COUNTDOWN_MS = 2000;
const ROOM_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const LOBBY_TTL_MS = 24 * 60 * 60 * 1000;

const CUBES = {
  goat: { id:"goat", name:"Goat Format (API-Pool)", source:"YGOPRODeck format=goat", mode:"api", params:{format:"goat",language:"de"} },
  bp1: { id:"bp1", name:"Battle Pack 1 – Epic Dawn", source:"YGOPRODeck cardset", mode:"set", params:{cardset:"Battle Pack: Epic Dawn",language:"de"} },
  bp2: { id:"bp2", name:"Battle Pack 2 – War of the Giants", source:"YGOPRODeck cardset", mode:"set", params:{cardset:"Battle Pack 2: War of the Giants",language:"de"} },
  bp3: { id:"bp3", name:"Battle Pack 3 – Monster League", source:"YGOPRODeck cardset", mode:"set", params:{cardset:"Battle Pack 3: Monster League",language:"de"} },
  battlecity: { id:"battlecity", name:"Battle City Style", source:"Curated classic-card test cube; card data resolved through YGOPRODeck", mode:"names", names:[
    ["Dark Magician",2],["Dark Magician Girl",1],["Blue-Eyes White Dragon",2],["Red-Eyes Black Dragon",1],["Summoned Skull",2],["Jinzo",1],["Buster Blader",1],["Mystic Box",1],["Change of Heart",1],["Monster Reborn",1],["Dark Hole",1],["Raigeki",1],["Harpie's Feather Duster",1],["Premature Burial",1],["Snatch Steal",1],["Graceful Charity",1],["Pot of Greed",1],["Heavy Storm",1],["Swords of Revealing Light",1],["Mirror Force",1],["Magic Cylinder",1],["Call of the Haunted",1],["Sakuretsu Armor",1],["Dust Tornado",1],["Seven Tools of the Bandit",1],["Trap Hole",1],["Bottomless Trap Hole",1],["Mystical Space Typhoon",2],["Book of Moon",1],["Enemy Controller",1],["Breaker the Magical Warrior",2],["Kycoo the Ghost Destroyer",1],["D.D. Warrior Lady",1],["Exiled Force",1],["Magician of Faith",1],["Sangan",1],["Witch of the Black Forest",1],["Cyber Jar",1],["Morphing Jar",1],["Man-Eater Bug",1],["Injection Fairy Lily",1],["Mobius the Frost Monarch",1],["Zaborg the Thunder Monarch",1],["Thousand-Eyes Restrict",1],["Relinquished",1],["Dark Paladin",1]
  ]}
};

function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}})}
function roomIdFromUrl(url){const p=url.pathname.split("/").filter(Boolean);return p[1]||""}
function cleanName(v,fallback="Player"){const s=String(v||"").trim().slice(0,24);return s||fallback}
function clampInt(v,min,max,fallback){const n=Number(v);return Number.isFinite(n)?Math.min(max,Math.max(min,Math.floor(n))):fallback}
function roomDefaults(){return {id:"",creator:null,players:[],maxPlayers:4,rows:2,cols:4,picksPerRound:1,target:40,pool:"goat",customCube:[],round:0,phase:"lobby",roundCards:[],roundStartedAt:null,roundPicks:{},createdAt:Date.now()}}
function cardShape(c){
  const image=c.card_images?.[0]?.image_url_small||(c.id?`${IMAGE}${c.id}.jpg`:"");
  const type=c.type||"";
  let category="Monster"; if(/Spell Card/i.test(type)) category="Spell"; else if(/Trap Card/i.test(type)) category="Trap";
  return {id:String(c.id),name:c.name,type,category,desc:c.desc||"",atk:c.atk??null,def:c.def??null,level:c.level??null,race:c.race||"",attribute:c.attribute||"",image,pickedBy:null};
}
function shuffle(a){const arr=[...a];for(let i=arr.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[arr[i],arr[j]]=[arr[j],arr[i]]}return arr}
function materialize(cards){const counts={};return cards.filter(Boolean).map(c=>{const n=counts[c.id]||0;counts[c.id]=n+1;return {...c,uid:`${c.id}-${n}`}})}
async function apiGet(params){
  const u=new URL(API);for(const [k,v] of Object.entries(params))u.searchParams.set(k,v);
  const r=await fetch(u,{headers:{"User-Agent":"BlitzDraft/0.5"}});if(!r.ok)throw new Error(`YGOPRODeck API ${r.status}`);
  const data=await r.json();if(data?.error)throw new Error(data.error);return data.data||[];
}
async function resolveCube(cubeId,customCube=[]){
  if(cubeId==="custom"){
    const result=[];
    for(const item of Array.isArray(customCube)?customCube:[]){
      const id=String(item.id||"");
      const copies=clampInt(item.copies,1,99,1);
      if(!id)continue;
      const data=await apiGet({id,language:"de"});
      if(data[0])for(let i=0;i<copies;i++)result.push(cardShape(data[0]));
    }
    return result;
  }
  const cube=CUBES[cubeId]||CUBES.goat;
  if(cube.mode==="names"){
    const result=[];for(const [name,copies] of cube.names){const data=await apiGet({name,language:"de"});if(data[0])for(let i=0;i<copies;i++)result.push(cardShape(data[0]))}return result;
  }
  return (await apiGet(cube.params)).map(cardShape);
}
function scheduleRound(ctx,phase){
  const now=Date.now();
  if(phase==="pause") return ctx.storage.setAlarm(now+ROUND_PAUSE_MS);
  if(phase==="countdown") return ctx.storage.setAlarm(now+COUNTDOWN_MS);
}
function publicState(s,viewerId=null){
  const players=s.players.map(p=>({id:p.id,name:p.name,color:p.color,total:p.deck.length,roundPicks:s.roundPicks[p.id]||0,target:s.target,ready:!!p.ready}));
  const own=s.players.find(p=>p.id===viewerId);
  return {room:{id:s.id,maxPlayers:s.maxPlayers,rows:s.rows,cols:s.cols,picksPerRound:s.picksPerRound,target:s.target,pool:s.pool,round:s.round,phase:s.phase,roundStartedAt:s.roundStartedAt},players,cards:s.roundCards.map(c=>({...c,pickedByName:c.pickedBy?(s.players.find(p=>p.id===c.pickedBy)?.name||""):null})),ownDeck:own?own.deck:[],error:null};
}

export class DraftRoom extends DurableObject{
  constructor(ctx,env){super(ctx,env);this.ctx=ctx;this.env=env}
  load(){return this.ctx.storage.get("state").then(s=>s||roomDefaults())}
  async save(s){await this.ctx.storage.put("state",s)}
  sockets(){return this.ctx.getWebSockets()}
  send(ws,msg){try{ws.send(JSON.stringify(msg))}catch{}}
  async broadcastState(){const s=await this.load();for(const ws of this.sockets()){const a=ws.deserializeAttachment?.()||{};this.send(ws,{type:"state",state:publicState(s,a.playerId||null)})}}
  async fetch(request){
    const url=new URL(request.url);
    if(url.pathname.endsWith("/ws")){
      if(request.method!=="GET"||request.headers.get("Upgrade")?.toLowerCase()!=="websocket")return new Response("WebSocket required",{status:426});
      const pair=new WebSocketPair(),client=pair[0],server=pair[1];this.ctx.acceptWebSocket(server);server.serializeAttachment({playerId:null});
      server.send(JSON.stringify({type:"state",state:publicState(await this.load(),null)}));return new Response(null,{status:101,webSocket:client});
    }
    return new Response("DraftRoom",{status:200});
  }
  async alarm(){
    let s=await this.load();
    if(s.phase==="finished" || s.phase==="lobby"){ await this.ctx.storage.deleteAll(); return; }
    if(s.phase==="pause"){
      s.phase="countdown";s.roundStartedAt=Date.now()+COUNTDOWN_MS;await this.save(s);await this.broadcastState();await scheduleRound(this.ctx,"countdown");return;
    }
    if(s.phase==="countdown"){
      s.phase="draft";s.roundStartedAt=Date.now();await this.save(s);await this.broadcastState();
    }
    if(s.phase==="cleanup"){ await this.ctx.storage.deleteAll(); return; }
  }
  async webSocketMessage(ws,message){
    let msg;try{msg=JSON.parse(message)}catch{return}
    let s=await this.load();
    if(msg.type==="create"){
      if(s.id)return this.send(ws,{type:"error",message:"Raum existiert bereits."});
      const hostId=crypto.randomUUID();s={...roomDefaults(),id:String(msg.room||"").toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,8)||Math.random().toString(36).slice(2,8).toUpperCase(),creator:hostId,players:[{id:hostId,name:cleanName(msg.name,"Host"),color:COLORS[0],deck:[],ready:false}],maxPlayers:clampInt(msg.maxPlayers,2,8,4),rows:clampInt(msg.rows,1,6,2),cols:clampInt(msg.cols,1,10,4),picksPerRound:clampInt(msg.picksPerRound,1,10,1),target:clampInt(msg.target,1,60,40),pool:msg.pool==="custom"?"custom":(CUBES[msg.pool]?msg.pool:"goat"),customCube:Array.isArray(msg.customCube)?msg.customCube.slice(0,500):[]};
      if(s.rows*s.cols<s.maxPlayers*s.picksPerRound)return this.send(ws,{type:"error",message:`Raster zu klein: ${s.rows*s.cols} Karten für ${s.maxPlayers*s.picksPerRound} mögliche Picks.`});
      await this.save(s);await this.ctx.storage.setAlarm(Date.now()+LOBBY_TTL_MS);ws.serializeAttachment({playerId:hostId});this.send(ws,{type:"identity",playerId:hostId});await this.broadcastState();return;
    }
    const att=ws.deserializeAttachment?.()||{},playerId=att.playerId;
    if(msg.type==="join"){
      if(!s.id)return this.send(ws,{type:"error",message:"Raum nicht gefunden."});if(s.phase!=="lobby")return this.send(ws,{type:"error",message:"Draft läuft bereits."});if(s.players.length>=s.maxPlayers)return this.send(ws,{type:"error",message:`Der Raum ist voll (${s.maxPlayers} Spieler).`});
      const id=crypto.randomUUID();s.players.push({id,name:cleanName(msg.name,`Player ${s.players.length+1}`),color:COLORS[s.players.length%COLORS.length],deck:[],ready:false});await this.save(s);ws.serializeAttachment({playerId:id});this.send(ws,{type:"identity",playerId:id});await this.broadcastState();return;
    }
    if(!playerId||!s.players.some(p=>p.id===playerId))return this.send(ws,{type:"error",message:"Nicht im Raum."});
    if(msg.type==="ready"){const p=s.players.find(p=>p.id===playerId);p.ready=!!msg.ready;await this.save(s);await this.broadcastState();return}
    if(msg.type==="start"){
      if(playerId!==s.creator)return this.send(ws,{type:"error",message:"Nur der Host kann starten."});if(s.players.length<2)return this.send(ws,{type:"error",message:"Mindestens 2 Spieler erforderlich."});
      if(s.rows*s.cols<s.players.length*s.picksPerRound)return this.send(ws,{type:"error",message:`Raster zu klein: ${s.rows*s.cols} Karten für ${s.players.length*s.picksPerRound} Picks.`});
      try{
        const pool=materialize(await resolveCube(s.pool,s.customCube));const needed=s.rows*s.cols;
        if(pool.length<needed)return this.send(ws,{type:"error",message:`Cube liefert nur ${pool.length} eindeutige Karten, benötigt werden ${needed}.`});
        s.round=1;s.roundCards=shuffle(pool).slice(0,needed);s.roundPicks=Object.fromEntries(s.players.map(p=>[p.id,0]));s.phase="pause";s.roundStartedAt=Date.now()+ROUND_PAUSE_MS;await this.save(s);await this.broadcastState();await scheduleRound(this.ctx,"pause");
      }catch(e){this.send(ws,{type:"error",message:`Karten konnten nicht geladen werden: ${e.message}`})}return;
    }
    if(msg.type==="cursor"){
      const x=Math.max(0,Math.min(1,Number(msg.x)||0)),y=Math.max(0,Math.min(1,Number(msg.y)||0));
      for(const sock of this.sockets()){const a=sock.deserializeAttachment?.()||{};if(a.playerId&&a.playerId!==playerId)this.send(sock,{type:"cursor",playerId,x,y})}
      return;
    }
    if(msg.type==="pick"){
      if(s.phase!=="draft")return;
      const p=s.players.find(p=>p.id===playerId);if(!p||p.deck.length>=s.target)return;
      const roundCount=s.roundPicks[playerId]||0;if(roundCount>=s.picksPerRound)return;
      const card=s.roundCards.find(c=>(c.uid||c.id)===String(msg.cardId));if(!card)return this.send(ws,{type:"pick_error",cardId:msg.cardId,reason:"not_found"});if(card.pickedBy)return this.send(ws,{type:"pick_error",cardId:msg.cardId,reason:"already_picked"});
      card.pickedBy=playerId;p.deck.push({...card,pickedBy:null});s.roundPicks[playerId]=roundCount+1;
      const finishedRound=s.players.every(x=>(s.roundPicks[x.id]||0)>=s.picksPerRound||x.deck.length>=s.target),finishedDecks=s.players.every(x=>x.deck.length>=s.target);
      if(finishedDecks){s.phase="finished";s.roundStartedAt=null}
      else if(finishedRound){
        const pool=materialize(await resolveCube(s.pool,s.customCube));const used=new Set(s.players.flatMap(x=>x.deck.map(c=>c.uid)));const candidates=shuffle(pool.filter(c=>!used.has(c.uid))),needed=s.rows*s.cols;
        if(candidates.length<needed){s.phase="finished";s.roundStartedAt=null}else{s.round++;s.roundCards=candidates.slice(0,needed);s.roundPicks=Object.fromEntries(s.players.map(x=>[x.id,0]));s.phase="pause";s.roundStartedAt=Date.now()+ROUND_PAUSE_MS}
      }
      await this.save(s);await this.broadcastState();if(s.phase==="pause")await scheduleRound(this.ctx,"pause");if(s.phase==="finished")await this.ctx.storage.setAlarm(Date.now()+ROOM_TTL_MS);return;
    }
  }
  async webSocketClose(ws,code,reason,wasClean){const a=ws.deserializeAttachment?.()||{};if(a.playerId){for(const sock of this.sockets()){if(sock!==ws)this.send(sock,{type:"cursor_remove",playerId:a.playerId})}}console.log("WebSocket closed",code,reason||"",wasClean)}
  async webSocketError(ws,error){console.error("WebSocket error",error)}
}

export default {async fetch(request,env){
  const url=new URL(request.url);
  if(url.pathname.startsWith("/room/")){const id=roomIdFromUrl(url).toUpperCase();if(!id)return json({error:"Room ID missing"},400);const stub=env.DRAFT_ROOMS.getByName(id);if(url.pathname.endsWith("/ws")){if(request.method!=="GET"||request.headers.get("Upgrade")?.toLowerCase()!=="websocket")return new Response("Expected WebSocket upgrade",{status:426});return stub.fetch(request)}return json({ok:true,room:id})}
  if(url.pathname==="/api/cubes")return json([...Object.values(CUBES).map(c=>({id:c.id,name:c.name,source:c.source})),{id:"custom",name:"Eigener Cube",source:"Selbst zusammengestellt"}]);
  if(url.pathname==="/api/cards/search"){
    const q=(url.searchParams.get("q")||"").trim().slice(0,80);
    if(q.length<2)return json({data:[]});
    try{
      let data=[];
      try{ data=await apiGet({fname:q,language:"de"}); }catch(_){}
      if(!data.length){ try{ data=await apiGet({name:q,language:"de"}); }catch(_){} }
      const limited=data.slice(0,24).map(cardShape).map(c=>({id:c.id,name:c.name,type:c.type,category:c.category,image:c.image,desc:c.desc,atk:c.atk,def:c.def,level:c.level,race:c.race,attribute:c.attribute}));
      return json({data:limited});
    }catch(e){return json({error:`Kartensuche fehlgeschlagen: ${e.message}`},502)}
  }
  if(url.pathname==="/api/health")return json({ok:true,version:"0.6.0"});
  return env.ASSETS.fetch(request);
}};
