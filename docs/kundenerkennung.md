# Kundenerkennung aus einer E-Mail

Die Erkennung liest TANSS-Daten mit der angemeldeten Benutzersitzung. Sie legt weder Firmen noch Ansprechpartner oder Tickets an.

1. Die Absenderadresse wird mit Firmenadressen und aktiven Ansprechpartnern verglichen. Exakte Ansprechpartner-Treffer liefern ihre Firmenzuordnungen; die Firma wird nochmals über die Firmensuche aufgelöst. Gesperrte und inaktive Firmen werden nicht angeboten.
2. Gibt es keinen eindeutigen Adresstreffer, werden die Domänen hinterlegter Firmenadressen und Webseiten verglichen. Ein einzelner Volltexttreffer allein genügt nicht. Öffentliche Anbieter wie Gmail, GMX und Outlook werden nicht zur Domänenzuordnung verwendet. Eine exakte persönliche Adresse bei diesen Anbietern kann weiterhin einen bekannten Ansprechpartner erkennen.
3. Eindeutige Treffer werden im Formular vorausgewählt. Mehrere mögliche Firmen, unvollständige Suchergebnisse oder fehlende Firmenzuordnungen erfordern eine manuelle Auswahl. Der Grund wird am Firmenfeld angezeigt; die Auswahl bleibt änderbar.
4. Explizite Ticketmarkierungen wie `[hecom-Ticket #34224]`, `[TANSS-Ticket #34224]` und `[Ticket #34224]` werden nachgeschlagen. Nur für den angemeldeten Mitarbeiter sichtbare Tickets werden angeboten. Ein einzelnes Ticket kann den Kunden liefern, sofern dessen Firma aufgelöst werden kann und keine Mehrdeutigkeit besteht. Widersprechen sich Absenderkunde und Ticketkunde, wird keine Firma vorausgewählt. Bei mehreren Ticketmarkierungen wird keine Ticketfirma automatisch übernommen.
5. Ein erkanntes Ticket bietet „Stattdessen anhängen“ an. Das Anhängen selbst wird erst durch den Benutzer ausgelöst. Die Erkennung verändert keine Berechtigungen; eine Ticketmarkierung oder Absenderadresse beweist keine Identität.

Die Vertragsauswahl bleibt optional und wird nicht automatisch vorbelegt. Die Qualität der Erkennung hängt von gepflegten E-Mail-Adressen, Webseiten und Firmenzuordnungen in TANSS ab. Die Freemail-Liste ist eine gepflegte Liste verbreiteter Anbieter und keine vollständige Erkennung aller öffentlichen Maildienste.

Technische Prüfungen: `tests/js/test_customer_recognition.js` prüft die Entscheidungslogik mit synthetischen Daten; `tests/js/test_api.js` prüft die Übergabe über den Mailkontext. Ein Funktionstest in Outlook wird dadurch nicht ersetzt.
