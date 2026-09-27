# BlitzDraft v0.2

Browserbasierter Yu-Gi-Oh! Echtzeit-Draft für Freunde.

## Was diese Version enthält

- Cloudflare Worker `blitzdraft`
- Durable Object `DraftRoom`
- WebSocket-Echtzeitkommunikation
- atomare/serverautoritativ ausgeführte Kartenreservierung
- konfigurierbare Spielerzahl (2–8), Raster, Picks/Runde und Zielkartenzahl
- YGOPRODeck API v7 direkt auf dem Server
- deutsche Kartendaten
- echte YGOPRODeck-Kartenbilder
- Test-Pools:
  - Goat Format (API-Pool)
  - Battle Pack 1 – Epic Dawn
  - Battle Pack 2 – War of the Giants
  - Battle Pack 3 – Monster League
  - Battle City Style (kuratierter Test-Cube; Kartendaten werden per API aufgelöst)
- Karten werden pro Draft im Durable Object gespeichert, statt bei jedem Klick die API abzufragen
- Monster/Zauber/Fallen-Donut
- eigene Karten am unteren Rand
- Gegner sehen keine Deckinhalte
- ungültige Raster werden serverseitig blockiert

## Cloudflare

Das Repository muss genau so aufgebaut sein:

```text
package.json
wrangler.toml
src/index.js
public/index.html
public/app.js
public/style.css
```

Cloudflare Build/Deploy Command:

```bash
npx wrangler deploy
```

Kein separates Build-Verzeichnis nötig.

## Lokal

Node.js installieren, dann:

```bash
npm install
npm run dev
```

Deployment:

```bash
npx wrangler deploy
```

## GitHub

Den **Inhalt** dieses ZIPs in den Root von `SchlomoAW/Blitzdraft` hochladen, nicht das ZIP selbst.

Danach Cloudflare Workers → Build → GitHub-Repository verbinden.

## YGOPRODeck

Diese Version verwendet API v7. YGOPRODeck bittet darum, API-Daten lokal zu speichern und Bilder nicht dauerhaft direkt zu hotlinken. Der aktuelle Draft speichert die geladenen Kartendaten im Durable Object; die Bild-URLs werden für den Browser verwendet. Für einen späteren Produktionsbetrieb sollte ein eigener Bild-Cache/R2 ergänzt werden.

## Hinweis zu Cubes

YGOPRODeck stellt Card-Set- und Format-Filter bereit, aber keine allgemeine Cube-API. Deshalb sind Battle Packs über echte Set-Abfragen umgesetzt, der Goat-Testpool über `format=goat` und Battle City Style über eine kuratierte Namensliste, deren Daten über die API geladen werden.
