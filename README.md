# BlitzDraft v0.4

Browserbasierter Yu-Gi-Oh!-Draft für private Runden.

## Was ist neu in v0.4?
- Durable Object nutzt für den Raumzustand den normalen persistenten `ctx.storage`-Store statt SQL im Konstruktor. Das vermeidet einen häufigen Laufzeitfehler, bei dem der WebSocket direkt nach dem Verbinden geschlossen wird.
- WebSocket-Hibernation bleibt aktiv (`acceptWebSocket`).
- Player-Limit 2–8.
- Server bleibt autoritativ: Picks werden innerhalb eines Durable Objects serialisiert.
- YGOPRODeck API v7, deutsche Kartendaten und Kartenbilder.

## Deployment
Repository-Struktur im Root:

```text
package.json
wrangler.toml
src/index.js
public/index.html
public/app.js
public/style.css
```

Cloudflare Workers → Build aus GitHub. Nach dem Push sollte automatisch neu gebaut werden.

Lokal:

```bash
npm install
npm run check
npm run dev
```

## Wichtig
Die Anwendung lädt Kartendaten beim Start eines Drafts von YGOPRODeck. Für Produktion sollte ein lokaler/serverseitiger Cache ergänzt werden; YGOPRODeck bittet ausdrücklich darum, Daten lokal zu speichern und Bilder nicht unnötig dauerhaft hotzulinken.

Test-Cubes:
- Goat Format
- Battle Pack 1
- Battle Pack 2
- Battle Pack 3
- Battle City Style (kuratierte Testliste)
