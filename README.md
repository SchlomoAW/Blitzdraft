# BlitzDraft v0.10.1

Browserbasierter Yu-Gi-Oh!-Echtzeit-Draft mit Cloudflare Workers + Durable Objects und YGOPRODeck API v7.

## v0.6
- Kleinere Kartenansicht für Streaming/Facecams.
- Kartenrücken während 2s Rundenpause und 3-2-1 Countdown.
- Serverseitig synchronisierte Flip-Animation.
- Hover-Karteninfo mit deutschem Namen, Typ, Effekt, ATK/DEF/Level usw.
- Eigener Cube mit YGOPRODeck-Suche, Kopien pro Karte und Speicherung im Browser.
- Fertig-Screen mit vollständigem eigenen Deck und Hover-Details.
- Farbiger Rahmen des Spielers, der die Karte gepickt hat.
- Physische Karteninstanzen für echte Kopien derselben Karte.

## API-Hinweis
YGOPRODeck v7 unterstützt deutsche Kartendaten und `fname` für Fuzzy-Suche. Die API ist auf 20 Requests/Sekunde begrenzt und empfiehlt, Daten lokal zu speichern/cachen. In dieser Version werden Kartendaten beim Cube-Aufbau geladen und danach im Room-State weiterverwendet. Für einen späteren Schritt sollte zusätzlich ein dauerhafter Cache für Cube-/Kartendaten ergänzt werden.

## Start
Repository-Root muss enthalten:
- package.json
- wrangler.toml
- src/index.js
- public/index.html
- public/app.js
- public/style.css

Cloudflare Workers Builds deployt den Worker nach Git-Push.

## v0.10.1 – Power-up-Prototyp
- Optionaler Power-up-Modus beim Erstellen eines Raums.
- Drei Items fallen während der Pickphase ins Spielfeld: Mauer, Blitz und Explosion.
- Items werden durch Cursorberührung eingesammelt; Inventar ist auf ein Item begrenzt.
- Mit Leertaste oder dem Aktivieren-Button wird das Power-up ausgelöst.
- Mauer verdeckt für Gegner die unterste Reihe serverseitig für 4 Sekunden.
- Blitz begrenzt serverseitig die übertragene Cursorbewegung der Gegner für 4 Sekunden.
- Explosion löst eine visuelle Cursor-Schockwelle aus.
- Spawn-Zeitpunkte, Inventar und temporäre Effekte werden vom Durable Object verwaltet.

## Power-up-Hinweise
- Die Power-ups sind optional und zunächst als erster spielbarer Prototyp umgesetzt.
- Mauer und Blitz dauern 4 Sekunden; Explosion ist ein einmaliger visueller Impuls.
- Items erscheinen ungefähr alle 10–15 Sekunden, maximal zwei Items können gleichzeitig fallen.
- Inventar bleibt zwischen Runden erhalten; laufende Effekte und fallende Items werden beim Rundenabschluss entfernt.
- Für das Einsammeln sendet der Client Cursorpositionen; das Durable Object prüft die Distanz zum serverseitig erzeugten Item.

## Bereits vorhandene Funktionen
- eigener Cube als separater Reiter
- Filter für Monster/Zauber/Fallen, Extra-Deck-Typen, Attribut, Rasse und Level
- Extra Deck separat sortiert: Fusion, Synchro, XYZ, Link
- Karten-Effekt-Hover während des Drafts
- eigener Cube wird beim Raum-Erstellen nur noch ausgewählt


### v0.10.1 – Power-up Spawn/Pickup Fix
- Power-ups erscheinen 2,5–5 Sekunden nach Beginn der Pickphase erstmals.
- Fallende Items sind per Mausberührung oder Klick einsammelbar.
- Server prüft Item-ID, Ablaufzeit, Phase, Inventar und Nähe, bevor es vergeben wird.
