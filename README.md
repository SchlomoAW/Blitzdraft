# BlitzDraft v0.11.0

Browserbasierter Yu-Gi-Oh!-Draft mit Cloudflare Workers, Durable Objects und WebSockets.

## Deployment

1. ZIP entpacken.
2. Den Inhalt in das Root-Verzeichnis des GitHub-Repositories kopieren.
3. Commit und Push ausführen.
4. Auf einen erfolgreichen Cloudflare-Deploy warten.
5. Browser mit `Strg + Shift + R` hart neu laden.

Die Struktur im Repository-Root muss `package.json`, `wrangler.toml`, `src/index.js` und `public/` enthalten.

## v0.11.0 — Room cleanup und geringere Nutzung

- Host-only **Raum beenden**-Button mit Sicherheitsabfrage.
- Ein beendeter Raum zeigt den bis dahin gesammelten Deckstand und wird nach 10 Minuten gelöscht.
- Räume ohne sinnvolle Aktivität werden nach 24 Stunden entfernt, sobald ihr Alarm ausgelöst wird.
- Power-up-Alarme pollen nicht mehr jede Sekunde. Der Server wacht zum nächsten Spawn, Item-Ablauf oder Effekt-Ende auf.
- Cursor-Updates werden im Browser und serverseitig auf ungefähr 12 Übertragungen pro Sekunde und Spieler begrenzt.
- Der Server benötigt keinen Neustart; ein erfolgreicher Worker-Deploy reicht.

**Hinweis zu bereits existierenden Räumen:** Ich kann nicht direkt auf dein Cloudflare-Konto zugreifen und vorhandene Durable Objects manuell löschen. Räume, deren Alarm noch läuft, werden nach dem neuen Code bereinigt. Alte Räume ohne zukünftigen Alarm lassen sich nicht automatisch finden, weil ein Worker die Namen aller vorhandenen Objekte nicht einfach auflisten kann. Diese musst du über Cloudflare-Dashboard/API löschen oder – wenn du noch als Host verbunden bist – über **Raum beenden** schließen.

## Power-ups

Der optionale Power-up-Modus enthält Mauer, Blitz und Explosion. Items fallen während der Pickphase; maximal ein Item pro Spieler kann gespeichert werden. Aktivierung per Leertaste oder Button.

## API und Cube-Editor

Kartendaten stammen von YGOPRODeck API v7. Die Anwendung sollte Kartendaten lokal wiederverwenden und unnötige API-Aufrufe vermeiden.

## Fehlerdiagnose

Wenn Cloudflare weiterhin ein Limit meldet, öffne im Dashboard **Workers & Pages → BlitzDraft → Metrics/Logs** und prüfe, ob es um Requests, CPU, Durable Objects oder Bandwidth geht. Das ist entscheidend, denn alte Räume allein erhöhen nicht automatisch die Bandbreite; aktive WebSockets und häufige Cursor-/State-Nachrichten tun es eher.
