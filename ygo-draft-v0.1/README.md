# YGO Draft – erste spielbare Version

## Lokal testen
Voraussetzung: Node.js LTS und ein kostenloses Cloudflare-Konto.

```bash
npm install
npx wrangler login
npm run dev
```

Danach die lokale URL öffnen.

## Kostenlos veröffentlichen
```bash
npx wrangler deploy
```
Cloudflare zeigt anschließend die `workers.dev`-Adresse an. Diesen Link können die Freunde öffnen.

## Wichtig
Die fünf Test-Pools sind zunächst als auswählbare Demo-Poolnamen angelegt. Die Karten im Demo-Draft sind absichtlich kleine Testdaten. Als nächster Schritt wird die echte YGOPRODeck-Datenquelle eingebunden und die Cubes als dauerhaft gespeicherte Kartenlisten umgesetzt.

## Aktuell enthalten
- Räume mit Raum-Code
- 2–12 Spieler
- Zeilen/Spalten
- Picks pro Spieler und Runde
- automatische Validierung: Angebot >= Spieler × Picks
- 3-2-1-Rundenstart mit Kartenrücken
- atomare Server-Auswahl: ein Pick wird nur bei erfolgreicher Reservierung verbraucht
- Spielerfarben und gesperrte Karten mit farbiger Umrandung
- Fehlklick auf bereits gepickte Karte wackelt
- eigenes Deck/Pick-Leiste
- Monster/Zauber/Fallen-Zähler
- Zielgröße 40 Karten
- Game-Mode-freundliche Serverstruktur für spätere Modi

## Nächste Ausbaustufe
- echte Kartendaten + Bilder
- echte persistente Cubes
- Cube-Editor
- Battle Pack / Retro Pack Kartenpools
- bessere Kartendarstellung
- Ergebnis-/Deck-Export
- weiterer Card-Wall-Game-Mode
