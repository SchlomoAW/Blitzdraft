import { DurableObject } from "cloudflare:workers";

const API = "https://db.ygoprodeck.com/api/v7/cardinfo.php";
const IMAGE = "https://images.ygoprodeck.com/images/cards_small/";

const COLORS = [
  "#e53935", "#1e88e5", "#43a047", "#8e24aa",
  "#fb8c00", "#00897b", "#6d4c41", "#3949ab"
];

const CUBES = {
  goat: {
    id: "goat",
    name: "Goat Format (API-Pool)",
    source: "YGOPRODeck format=goat",
    mode: "api",
    params: { format: "goat", language: "de" }
  },
  bp1: {
    id: "bp1",
    name: "Battle Pack 1 – Epic Dawn",
    source: "YGOPRODeck cardset",
    mode: "set",
    params: { cardset: "Battle Pack: Epic Dawn", language: "de" }
  },
  bp2: {
    id: "bp2",
    name: "Battle Pack 2 – War of the Giants",
    source: "YGOPRODeck cardset",
    mode: "set",
    params: { cardset: "Battle Pack 2: War of the Giants", language: "de" }
  },
  bp3: {
    id: "bp3",
    name: "Battle Pack 3 – Monster League",
    source: "YGOPRODeck cardset",
    mode: "set",
    params: { cardset: "Battle Pack 3: Monster League", language: "de" }
  },
  battlecity: {
    id: "battlecity",
    name: "Battle City Style",
    source: "Curated classic-card test cube; card data resolved through YGOPRODeck",
    mode: "names",
    names: [
      ["Dark Magician", 2], ["Dark Magician Girl", 1], ["Blue-Eyes White Dragon", 2],
      ["Red-Eyes Black Dragon", 1], ["Summoned Skull", 2], ["Jinzo", 1],
      ["Buster Blader", 1], ["Mystic Box", 1], ["Change of Heart", 1],
      ["Monster Reborn", 1], ["Dark Hole", 1], ["Raigeki", 1],
      ["Harpie's Feather Duster", 1], ["Premature Burial", 1], ["Snatch Steal", 1],
      ["Graceful Charity", 1], ["Pot of Greed", 1], ["Heavy Storm", 1],
      ["Swords of Revealing Light", 1], ["Mirror Force", 1], ["Magic Cylinder", 1],
      ["Call of the Haunted", 1], ["Sakuretsu Armor", 1], ["Dust Tornado", 1],
      ["Seven Tools of the Bandit", 1], ["Trap Hole", 1], ["Bottomless Trap Hole", 1],
      ["Mystical Space Typhoon", 2], ["Book of Moon", 1], ["Enemy Controller", 1],
      ["Breaker the Magical Warrior", 2], ["Kycoo the Ghost Destroyer", 1],
      ["D.D. Warrior Lady", 1], ["Exiled Force", 1], ["Magician of Faith", 1],
      ["Sangan", 1], ["Witch of the Black Forest", 1], ["Cyber Jar", 1],
      ["Morphing Jar", 1], ["Man-Eater Bug", 1], ["Injection Fairy Lily", 1],
      ["Mobius the Frost Monarch", 1], ["Zaborg the Thunder Monarch", 1],
      ["Thousand-Eyes Restrict", 1], ["Relinquished", 1], ["Dark Paladin", 1]
    ]
  }
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}

function roomIdFromUrl(url) {
  const parts = url.pathname.split("/").filter(Boolean);
  return parts[1] || "";
}

function cleanName(value, fallback = "Player") {
  const s = String(value || "").trim().slice(0, 24);
  return s || fallback;
}

function roomDefaults() {
  return {
    id: "",
    creator: null,
    players: [],
    maxPlayers: 4,
    rows: 2,
    cols: 4,
    picksPerRound: 1,
    target: 40,
    pool: "goat",
    round: 0,
    phase: "lobby",
    roundCards: [],
    roundStartedAt: null,
    roundPicks: {},
    createdAt: Date.now()
  };
}

function cardShape(c) {
  const image = c.card_images?.[0]?.image_url_small || (c.id ? `${IMAGE}${c.id}.jpg` : "");
  const type = c.type || "";
  let category = "Monster";
  if (/Spell Card/i.test(type)) category = "Spell";
  else if (/Trap Card/i.test(type)) category = "Trap";
  return {
    id: String(c.id),
    name: c.name,
    type,
    category,
    desc: c.desc || "",
    atk: c.atk ?? null,
    def: c.def ?? null,
    level: c.level ?? null,
    race: c.race || "",
    attribute: c.attribute || "",
    image,
    pickedBy: null
  };
}

function shuffle(a) {
  const arr = [...a];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function uniqueCards(cards) {
  const map = new Map();
  for (const c of cards) if (c?.id) map.set(String(c.id), c);
  return [...map.values()];
}

async function apiGet(params) {
  const u = new URL(API);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const r = await fetch(u, { headers: { "User-Agent": "BlitzDraft/0.2" } });
  if (!r.ok) throw new Error(`YGOPRODeck API ${r.status}`);
  const data = await r.json();
  if (data?.error) throw new Error(data.error);
  return data.data || [];
}

async function resolveCube(cubeId) {
  const cube = CUBES[cubeId] || CUBES.goat;
  if (cube.mode === "names") {
    const result = [];
    for (const [name, copies] of cube.names) {
      const data = await apiGet({ name, language: "de" });
      if (data[0]) {
        for (let i = 0; i < copies; i++) result.push(cardShape(data[0]));
      }
    }
    return result;
  }
  const data = await apiGet(cube.params);
  return data.map(cardShape);
}

function publicState(s, viewerId = null) {
  const players = s.players.map(p => ({
    id: p.id, name: p.name, color: p.color,
    total: p.deck.length,
    roundPicks: s.roundPicks[p.id] || 0,
    target: s.target,
    ready: !!p.ready
  }));

  const own = s.players.find(p => p.id === viewerId);
  const cards = s.roundCards.map(c => ({
    ...c,
    // Opponents never receive card contents after selection.
    pickedByName: c.pickedBy ? (s.players.find(p => p.id === c.pickedBy)?.name || "") : null
  }));

  return {
    room: { id: s.id, maxPlayers: s.maxPlayers, rows: s.rows, cols: s.cols, picksPerRound: s.picksPerRound,
      target: s.target, pool: s.pool, round: s.round, phase: s.phase,
      roundStartedAt: s.roundStartedAt },
    players,
    cards,
    ownDeck: own ? own.deck : [],
    error: null
  };
}

export class DraftRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
    this.ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(
        `CREATE TABLE IF NOT EXISTS room (id INTEGER PRIMARY KEY, data TEXT NOT NULL)`
      );
      const row = this.ctx.storage.sql.exec(`SELECT data FROM room WHERE id=1`).one();
      if (!row) this.save(roomDefaults());
    });
  }

  load() {
    const row = this.ctx.storage.sql.exec(`SELECT data FROM room WHERE id=1`).one();
    return row ? JSON.parse(row.data) : roomDefaults();
  }

  save(s) {
    this.ctx.storage.sql.exec(
      `INSERT INTO room (id,data) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data`,
      JSON.stringify(s)
    );
  }

  sockets() {
    return this.ctx.getWebSockets();
  }

  send(ws, msg) {
    try { ws.send(JSON.stringify(msg)); } catch {}
  }

  broadcast(msg) {
    const payload = JSON.stringify(msg);
    for (const ws of this.sockets()) {
      try { ws.send(payload); } catch {}
    }
  }

  broadcastState() {
    const s = this.load();
    for (const ws of this.sockets()) {
      const attachment = ws.deserializeAttachment?.() || {};
      this.send(ws, { type: "state", state: publicState(s, attachment.playerId || null) });
    }
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname.endsWith("/ws")) {
      if (request.method !== "GET" || request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
        return new Response("WebSocket required", { status: 426 });
      }
      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];

      // Hibernation WebSocket API: the Durable Object owns the connection.
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({ playerId: null });
      server.send(JSON.stringify({ type: "state", state: publicState(this.load(), null) }));

      return new Response(null, { status: 101, webSocket: client });
    }
    return new Response("DraftRoom", { status: 200 });
  }

  async webSocketMessage(ws, message) {
    let msg;
    try { msg = JSON.parse(message); } catch { return; }
    let s = this.load();

    if (msg.type === "create") {
      if (s.id) return this.send(ws, { type: "error", message: "Raum existiert bereits." });
      const players = [];
      const hostId = crypto.randomUUID();
      players.push({ id: hostId, name: cleanName(msg.name, "Host"), color: COLORS[0], deck: [], ready: false });
      s = {
        ...roomDefaults(),
        id: String(msg.room || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8) || Math.random().toString(36).slice(2, 8).toUpperCase(),
        creator: hostId,
        players,
        maxPlayers: clampInt(msg.maxPlayers, 2, 8, 4),
        rows: clampInt(msg.rows, 1, 6, 2),
        cols: clampInt(msg.cols, 1, 10, 4),
        picksPerRound: clampInt(msg.picksPerRound, 1, 10, 1),
        target: clampInt(msg.target, 1, 60, 40),
        pool: CUBES[msg.pool] ? msg.pool : "goat"
      };
      if (s.rows * s.cols < s.maxPlayers * s.picksPerRound) {
        return this.send(ws, { type: "error", message: `Raster zu klein: ${s.rows*s.cols} Karten für ${s.maxPlayers*s.picksPerRound} mögliche Picks.` });
      }
      this.save(s);
      ws.serializeAttachment({ playerId: hostId });
      this.send(ws, { type: "identity", playerId: hostId });
      this.broadcastState();
      return;
    }

    const att = ws.deserializeAttachment?.() || {};
    const playerId = att.playerId;

    if (msg.type === "join") {
      if (!s.id) return this.send(ws, { type: "error", message: "Raum nicht gefunden." });
      if (s.phase !== "lobby") return this.send(ws, { type: "error", message: "Draft läuft bereits." });
      if (s.players.length >= s.maxPlayers) {
        return this.send(ws, { type: "error", message: `Der Raum ist voll (${s.maxPlayers} Spieler).` });
      }
      const id = crypto.randomUUID();
      const color = COLORS[s.players.length % COLORS.length];
      s.players.push({ id, name: cleanName(msg.name, `Player ${s.players.length + 1}`), color, deck: [], ready: false });
      this.save(s);
      ws.serializeAttachment({ playerId: id });
      this.send(ws, { type: "identity", playerId: id });
      this.broadcastState();
      return;
    }

    if (!playerId || !s.players.some(p => p.id === playerId)) {
      return this.send(ws, { type: "error", message: "Nicht im Raum." });
    }

    if (msg.type === "ready") {
      const p = s.players.find(p => p.id === playerId);
      p.ready = !!msg.ready;
      this.save(s);
      this.broadcastState();
      return;
    }

    if (msg.type === "start") {
      if (playerId !== s.creator) return this.send(ws, { type: "error", message: "Nur der Host kann starten." });
      if (s.players.length < 2) return this.send(ws, { type: "error", message: "Mindestens 2 Spieler erforderlich." });
      if (s.players.length > s.maxPlayers) return this.send(ws, { type: "error", message: "Zu viele Spieler im Raum." });
      if (s.rows * s.cols < s.players.length * s.picksPerRound) {
        return this.send(ws, { type: "error", message: `Raster zu klein: ${s.rows*s.cols} Karten für ${s.players.length*s.picksPerRound} Picks.` });
      }
      try {
        const pool = await resolveCube(s.pool);
        if (pool.length < s.rows * s.cols) {
          return this.send(ws, { type: "error", message: `Cube liefert nur ${pool.length} eindeutige Karten, benötigt werden ${s.rows*s.cols}.` });
        }
        s.round = 1;
        s.roundCards = shuffle(pool).slice(0, s.rows * s.cols);
        s.roundPicks = Object.fromEntries(s.players.map(p => [p.id, 0]));
        s.phase = "countdown";
        s.roundStartedAt = Date.now() + 3200;
        this.save(s);
        this.broadcastState();
      } catch (e) {
        this.send(ws, { type: "error", message: `Karten konnten nicht geladen werden: ${e.message}` });
      }
      return;
    }

    if (msg.type === "pick") {
      if (!["countdown", "draft"].includes(s.phase)) return;
      const p = s.players.find(p => p.id === playerId);
      if (!p || p.deck.length >= s.target) return;
      const roundCount = s.roundPicks[playerId] || 0;
      if (roundCount >= s.picksPerRound) return;
      const card = s.roundCards.find(c => c.id === String(msg.cardId));
      if (!card) return this.send(ws, { type: "pick_error", cardId: msg.cardId, reason: "not_found" });
      if (card.pickedBy) return this.send(ws, { type: "pick_error", cardId: msg.cardId, reason: "already_picked" });

      // This method executes on one Durable Object instance, so the check + write
      // is serialized and two simultaneous clicks cannot reserve the same card.
      card.pickedBy = playerId;
      p.deck.push(card);
      s.roundPicks[playerId] = roundCount + 1;
      s.phase = "draft";

      const finishedRound = s.players.every(x => (s.roundPicks[x.id] || 0) >= s.picksPerRound || x.deck.length >= s.target);
      const finishedDecks = s.players.every(x => x.deck.length >= s.target);

      if (finishedDecks) {
        s.phase = "finished";
      } else if (finishedRound) {
        // New round is prepared immediately; clients use roundStartedAt for the synchronized countdown.
        const pool = await resolveCube(s.pool);
        const used = new Set(s.players.flatMap(x => x.deck.map(c => c.id)));
        const candidates = shuffle(pool.filter(c => !used.has(c.id)));
        const needed = s.rows * s.cols;
        if (candidates.length < needed) {
          s.phase = "finished";
        } else {
          s.round++;
          s.roundCards = candidates.slice(0, needed);
          s.roundPicks = Object.fromEntries(s.players.map(x => [x.id, 0]));
          s.phase = "countdown";
          s.roundStartedAt = Date.now() + 3200;
        }
      }

      this.save(s);
      this.broadcastState();
    }
  }

  async webSocketClose(ws) {}
  async webSocketError(ws) {}
}

function clampInt(v, min, max, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.floor(n))) : fallback;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/room/")) {
      const id = roomIdFromUrl(url).toUpperCase();
      if (!id) return json({ error: "Room ID missing" }, 400);
      const stub = env.DRAFT_ROOMS.getByName(id);
      if (url.pathname.endsWith("/ws")) {
        if (request.method !== "GET" || request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
          return new Response("Expected WebSocket upgrade", { status: 426 });
        }
        return stub.fetch(request);
      }
      return json({ ok: true, room: id });
    }
    if (url.pathname === "/api/cubes") return json(Object.values(CUBES).map(c => ({ id: c.id, name: c.name, source: c.source })));
    if (url.pathname === "/api/health") return json({ ok: true, version: "0.2.0" });
    return env.ASSETS.fetch(request);
  }
};
