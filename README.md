# BlitzDraft v0.6

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

## v0.9
- eigener Cube als separater Reiter
- Filter für Monster/Zauber/Fallen, Extra-Deck-Typen, Attribut, Rasse und Level
- Extra Deck separat sortiert: Fusion, Synchro, XYZ, Link
- Karten-Effekt-Hover während des Drafts
- eigener Cube wird beim Raum-Erstellen nur noch ausgewählt
