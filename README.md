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


## v0.11.1 — Geschützte Alt-Raum-Bereinigung

Diese Version ergänzt einen geheimnisgeschützten Wartungs-Endpunkt. Er löscht **nur** die Durable Objects, deren IDs explizit übergeben werden; der Namespace und die Binding-Konfiguration bleiben bestehen.

1. Vor dem Deploy unter Workers & Pages → BlitzDraft → Settings → Variables and Secrets ein Secret `BLITZDRAFT_ADMIN_TOKEN` setzen (langer, zufälliger Wert). Nicht in GitHub oder im Frontend speichern.
2. Über die Cloudflare Durable Objects API die Objekt-IDs des Namespace auflisten und die gewünschten IDs sichern. Liste vor dem Löschen prüfen.
3. An `POST /__admin/cleanup-rooms` JSON wie `{"ids":["<durable-object-id>"]}` mit Header `x-blitzdraft-admin-token: <secret>` senden. Maximal 100 IDs pro Aufruf.
4. Ergebnis prüfen und danach das Secret entfernen, wenn die Bereinigung abgeschlossen ist.

**Achtung:** Das Löschen ist endgültig. Jeder übergebene Raum verliert Zustand und gespeicherte Daten. Den Token niemals im Browser-Code oder in öffentlichen Logs hinterlegen. Den Namespace selbst nicht löschen.


## v0.11.2 — Alle alten Rooms löschen + automatische Bereinigung

- **Einmaliger Komplett-Reset:** Die Migration `v2` in `wrangler.toml` löschen die alte Durable-Object-Klasse `DraftRoom` inklusive aller alten Rooms und legen die leere Klasse `DraftRoomV2` an. Ein normaler Deploy genügt, kein Secret und keine API nötig.
- **Dauerhaft:** Räume im Draft ohne Aktivität (Pick, Join, Start) werden nach 2 Stunden automatisch gelöscht. Lobbys nach 24 Stunden, beendete Räume nach 10 Minuten.
- Die Migrationen `v1` und `v2` dürfen **nicht** aus `wrangler.toml` entfernt werden.

## v0.12.0 — Items überarbeitet, CSV-Cube-Import

**Items**
- Items fallen **nur zu Rundenbeginn** vom oberen Rand: Spieleranzahl − 1 (mindestens 1), zeitversetzt, jede Runde mit verschiedenen Typen.
- Ein gesammeltes Item **kreist wie in Mario Kart um den Mauszeiger**. Der Ring hat die Spielerfarbe; auch fremde Cursor und die Spielerleiste zeigen, wer welches Item hält.
- Alle Effekte sind in der Farbe des Nutzers (Blitz, Bombe, Mauer-Rahmen, Tausch, Labyrinth) und erscheinen als Banner mit Namen.
- 🧱 **Mauer:** 1 zufällige Reihe/Spalte, jetzt **10 Sekunden**. Der Nutzer sieht die gesperrten Karten markiert.
- ⚡ **Blitz:** 2–4 zufällige Karten werden verkohlt und zerstört, Picks darauf verfallen.
- 💥 **Bombe:** Maus über Karte + Space, Karte ist weg, Pick verfällt.
- ♻️ **Tausch (neu):** Zwei zufällige Spieler tauschen je eine bereits gewählte Karte (animiert).
- 🧩 **Labyrinth (neu):** Maus über Karte + Space. Reihe und Spalte dieser Karte rutschen um 1 Feld in zufällige Richtung, Randkarten laufen zur anderen Seite (animiert).
- ⭐ Stern entfernt.

**Fixes**
- Im Countdown/Pause bekommen Clients **keine Karteninfos** mehr (kein Vorab-Hover, auch nicht per Entwicklertools).
- Das Hover-Panel zeigt jetzt die **große Kartenabbildung**; direkt nach Rundenstart zeigt es die Karte unter der Maus auch ohne Mausbewegung.

**Cube**
- Der Cube-Builder wurde entfernt. „Cube importieren“ liest nur noch eine **CSV** (Spalten Name/ID/Anzahl werden automatisch erkannt; auch „3x Name“ und reine Namenslisten).
- Der Server löst Karten gebündelt auf (wenige API-Aufrufe), speichert den Pool pro Draft einmal und nutzt ihn in allen Runden. Nicht gefundene Einträge meldet er dem Host.
- Die Endpunkte für Kartensuche, Sets und Archetypen wurden entfernt.

**Deploy-Hinweis:** Das Durable-Object-Binding heißt weiterhin `DRAFT_ROOMS_V2`, die Migrationen `v1` und `v2` bleiben unverändert.

## v0.12.1 — Geist, Labyrinth mit festen Picks, Sound

- 🧩 **Labyrinth:** Gepickte Karten bleiben auf ihrem Platz (Koordinaten fest). Nur die nicht gepickten Karten der Reihe/Spalte rutschen um sie herum, Randkarten laufen zur anderen Seite. Ist nichts bewegbar, bleibt das Item gespeichert.
- 👻 **Geist (neu):** Nach dem Aktivieren geht dein nächster Klick auf eine Karte an einen zufälligen Gegner und kostet dich **keinen** Pick (danach hast du weiterhin alle regulären Picks). Die Karte ist im Raster durchsichtig mit Geist markiert. Der Empfänger sieht einen großen, durchsichtigen Geist, der ihm die Karte fallen lässt; sie zählt für ihn als einer seiner Picks.
  - Bevorzugt werden Gegner, die in der Runde noch Picks offen haben. Haben alle ihre Picks schon gemacht, wird die Karte zu Beginn der **nächsten Runde** zugestellt (Empfänger hat dann einen Pick weniger, mindestens 1 Pick bleibt immer übrig).
  - Geister-Karten können nicht per Undo zurückgenommen werden. Bombe/Blitz können sie zerstören.
- 🔊 **Sound:** Alle Sounds werden im Browser erzeugt (keine Audiodateien): Karten-Klick, Fehler, Item einsammeln, Countdown-Ticks, Rundenstart, Rundenende, Draft-Ende und je ein Sound pro Item. Unten rechts: Stumm-Schalter und Lautstärke (wird gespeichert).

## v0.12.2 — Items einsammeln bei abweichender PC-Uhr

- **Fix:** Items ließen sich nicht einsammeln, wenn die Uhr des PCs von der Serveruhr abwich (bereits wenige Sekunden reichten). Der Client übernimmt jetzt die Serverzeit aus jedem State (`serverNow`) und berechnet Item-Fall, Effekt-Restzeiten und Countdown danach.
- Die Trefferprüfung beim Einsammeln ist toleranter: Die x-Position (Items fallen senkrecht) wird genau geprüft, die y-Position großzügiger.
