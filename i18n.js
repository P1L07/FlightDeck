/* ==============================================================
 * I18N · kielivalinta (suomi / englanti)
 * ==============================================================
 * Sovelluksen teksti on kirjoitettu suomeksi. Kun kieleksi on
 * valittu englanti, tämä tiedosto kääntää näkyvät tekstit
 * ajonaikaisesti:
 *   1. täsmälleen samat tekstit (sanakirja)
 *   2. kaavat, joissa {} = vaihtuva osa (esim. "{} lentoa")
 *   3. pidempien lauseiden sisältä tunnetut fraasit
 * Raakatekstiä (METAR/TAF/NOTAM <pre>, input-kentät) ei kosketa.
 * Kielen vaihto tallentuu localStorageen (app_lang) ja sivu
 * ladataan uudelleen.
 * ============================================================== */
'use strict';

(function () {
  const LANG_KEY = 'app_lang';

  function getLang() {
    try { return localStorage.getItem(LANG_KEY) === 'en' ? 'en' : 'fi'; }
    catch (e) { return 'fi'; }
  }

  function setLang(lang) {
    const v = lang === 'en' ? 'en' : 'fi';
    try { localStorage.setItem(LANG_KEY, v); } catch (e) {}
    window.location.reload();
  }

  window.getLang = getLang;
  window.setLang = setLang;
  window.APP_LANG = getLang();
  document.documentElement.lang = window.APP_LANG;

  /* ------------------------------------------------------------
   * SANAKIRJA  FI → EN
   * ------------------------------------------------------------ */
  const DICT = {
    // --- Välilehdet & yläpalkki ---
    'Koti': 'Home',
    'Lennot': 'Flights',
    'Lokikirja': 'Logbook',
    'Kaverit': 'Friends',
    'Sää': 'Weather',
    'Asetukset': 'Settings',
    'Hei,': 'Hi,',
    'Kapteeni': 'Captain',
    'Token vanhenee pian — klikkaa päivittääksesi': 'Token expires soon — click to renew',
    'Ladataan…': 'Loading…',
    'Ladataan..': 'Loading..',
    'Ladataan tietoja…': 'Loading data…',

    // --- Koti ---
    'Ei tulevia lentoja': 'No upcoming flights',
    'Synkkaa roster nähdäksesi seuraavan lennon': 'Sync the roster to see your next flight',
    'Ei lentoja tänään': 'No flights today',
    'Lähin': 'Nearest',
    '📍 Lähin': '📍 Nearest',
    'Ladataan reittiä…': 'Loading route…',
    'Haetaan säätä…': 'Fetching weather…',
    'Haetaan {}…': 'Fetching {}…',

    // --- Lennot / viikkonäkymä ---
    'Lentotehtävät': 'Flight duties',
    'Edellinen viikko': 'Previous week',
    'Seuraava viikko': 'Next week',
    'Tänään': 'Today',
    'TÄNÄÄN': 'TODAY',
    'Viikko {} · {}': 'Week {} · {}',
    'Lentoja': 'Flights',
    'Block-aika': 'Block time',
    'Työpäiviä': 'Duty days',
    'Ei lentotehtäviä': 'No flight duties',
    'Roster ei ole synkattu': 'Roster not synced',
    'Vaihda taulukkonäkymään ja paina': 'Switch to table view and press',
    'Hae': 'Search',
    'Offline — näytetään välimuistissa oleva data.': 'Offline — showing cached data.',
    '👥 Miehistö': '👥 Crew',
    'lento': 'flight',
    'lentoa': 'flights',
    '{} lennon': '{} flights',
    '{} vapaalla': '{} off',
    '{} sessiota': '{} sessions',
    'Lisää suosikiksi': 'Add to favourites',
    'Poista suosikeista': 'Remove from favourites',
    '{} lisätty suosikiksi.': '{} added to favourites.',
    'Kaikki suosikit poistettu.': 'All favourites removed.',
    'Poistetaanko kaikki suosikkimiehistöt?': 'Remove all favourite crew members?',
    '✏️ Täytetty': '✏️ Filled',
    '✏️ Viimeistele': '✏️ Finalize',
    '✔ Lokikirjassa': '✔ In logbook',
    '{} lento(a) tuotu lokikirjaan — allekirjoita lopuksi.': '{} flight(s) imported to logbook — sign them when done.',
    '{} lento(a) tuotu automaattisesti lokikirjaan.': '{} flight(s) automatically imported to logbook.',

    // --- Roster ---
    'Roster päivitetty': 'Roster updated',
    'Roster on ajan tasalla.': 'Roster is up to date.',
    'Roster synkronoitu: {} lentoa.': 'Roster synced: {} flights.',
    'Roster-sync epäonnistui.': 'Roster sync failed.',
    'Offline — ei voi synkata.': 'Offline — cannot sync.',
    'API ei palauttanut dataa. Yritä myöhemmin uudelleen.': 'The API returned no data. Please try again later.',
    'Uusia muutoksia dispatchilta': 'New changes from dispatch',
    'Selvä, kiitos': 'Got it, thanks',
    'Lähtöaika': 'Departure time',
    'Saapumisaika': 'Arrival time',
    'Lähtökenttä': 'Departure airport',
    'Saapumiskenttä': 'Arrival airport',
    'Lähtöpäivä': 'Departure date',
    'Rekisteri': 'Registration',
    'Konetyyppi': 'Aircraft type',
    'Lentonumero': 'Flight number',
    '◆ Muutettu': '◆ Changed',
    '✕ Poistettu': '✕ Removed',
    '▲ Lisätty': '▲ Added',
    'Edellinen synkronointi:': 'Last sync:',

    // --- Briefing ---
    'Lennon briefing': 'Flight briefing',
    '⟳ Päivitä': '⟳ Refresh',
    '✈ Avaa OFP': '✈ Open OFP',
    'Briefing päivitetty.': 'Briefing updated.',
    'Haetaan tuoreet tiedot...': 'Fetching latest data...',
    'Vaihda lento': 'Change flight',
    'Ei Flight ID:tä': 'No Flight ID',
    'Ei Flight ID:tä.': 'No Flight ID.',
    'Ei ICAO-koodia': 'No ICAO code',
    'Ei koordinaatteja reitille.': 'No coordinates for the route.',
    'Ei koordinaatteja reitile': 'No coordinates for the route',
    'Synkkaa roster tai valitse mennyt lento Lennot-välilehdeltä.': 'Sync the roster or pick a past flight from the Flights tab.',
    'MIEHISTÖ': 'CREW',
    'Miehistö · {}': 'Crew · {}',
    'Ladataan miehistöä…': 'Loading crew…',
    'Miehistön haku epäonnistui.': 'Failed to fetch crew.',
    'Miehistön haku epäonnistui: {}': 'Failed to fetch crew: {}',
    'Miehistöä ei ole vielä julkaistu.': 'Crew has not been published yet.',
    'Dispatch julkaisee miehistön yleensä 24 h ennen lähtöä.': 'Dispatch usually publishes the crew 24 h before departure.',
    '{} miehistön jäsentä': '{} crew members',
    '{} miehistön jäsentä · Lähde: Skyplan journey-log': '{} crew members · Source: Skyplan journey log',
    'Lähde: lokikirja': 'Source: logbook',
    'Journey-log-palvelu ei ole ladattu': 'Journey log service not loaded',
    'Lokikirjamoduuli ei ole ladattu.': 'Logbook module not loaded.',
    'OFP-moduuli ei ole ladattu.': 'OFP module not loaded.',
    'OFP ei vielä saatavilla': 'OFP not available yet',
    'OFP ei ole vielä saatavilla': 'OFP not available yet',
    'OFP ei ole vielä saatavilla.': 'OFP not available yet.',
    'OFP ei ole saatavilla': 'OFP not available',
    'OFP ei ole vielä julkaistu.': 'OFP has not been published yet.',
    'Lennon OFP:tä ei ole vielä generoitu. Dispatch julkaisee sen yleensä 12–24 h ennen lähtöä.': 'The OFP for this flight has not been generated yet. Dispatch usually publishes it 12–24 h before departure.',
    'Viimeistellään OFP:tä…': 'Finalizing OFP…',
    'Viimeistely epäonnistui': 'Finalizing failed',
    'Waypoint-dataa ei ole ladattu.': 'Waypoint data not loaded.',
    'Sää (MET)': 'Weather (MET)',
    'Sää-widget puuttuu': 'Weather widget missing',
    'Säämoduuli ei ole ladattu': 'Weather module not loaded',
    'Sään haku epäonnistui': 'Failed to fetch weather',
    'Sään haku epäonnistui.': 'Failed to fetch weather.',
    'LÄHTÖ': 'DEPARTURE',
    'SAAPUMINEN': 'ARRIVAL',
    'VARAKENTTÄ': 'ALTERNATE',
    'LÄHTÖ · {}': 'DEPARTURE · {}',
    'SAAPUMINEN · {}': 'ARRIVAL · {}',
    'VARAKENTTÄ{}': 'ALTERNATE{}',
    'NOTAM-KENTTÄ': 'NOTAM AIRPORT',
    'KENTTÄ': 'AIRPORT',
    'Kenttä': 'Airport',
    'Haetaan varakenttää OFP:stä…': 'Looking up the alternate from the OFP…',
    'Varakenttää ei löytynyt OFP:stä': 'No alternate found in the OFP',
    'Aika ei ole TAF:n voimassaoloajalla.': 'Time is outside the TAF validity period.',
    'TAF · Tuore': 'TAF · Fresh',
    '· Tuore': '· Fresh',
    '· Vanha': '· Old',
    'Haetaan tuore METAR / TAF…': 'Fetching latest METAR / TAF…',
    'Palauta näkymä': 'Reset view',
    'Lämpötila': 'Temperature',
    'Näkyvyys': 'Visibility',
    'Kastepiste': 'Dew point',
    'Tuuli': 'Wind',
    'Pilvet': 'Clouds',
    'Kone': 'Aircraft',
    'Vika': 'Defect',
    'Tyyppi': 'Type',
    'Ei aktiivisia ADD / CDD -kohteita': 'No active ADD / CDD items',
    'Ei konerekisteriä': 'No aircraft registration',
    'Ei konerekisteriä.': 'No aircraft registration.',
    'Haetaan vikoja…': 'Fetching defects…',
    'Vikojen haku epäonnistui: {}': 'Failed to fetch defects: {}',
    'Vikatietopalvelu ei ole ladattu.': 'Defect service not loaded.',
    'Ei valittua lentoa': 'No flight selected',
    'Kapteenin nimi puuttuu.': 'Captain name missing.',
    'Lähetys epäonnistui:': 'Sending failed:',
    'Trip Info lähetetty Skyplanille.': 'Trip Info sent to Skyplan.',
    '⏳ Lähetetään…': '⏳ Sending…',
    '✈️ Lähetä Skyplanille': '✈️ Send to Skyplan',
    '✔️ Lähetetty': '✔️ Sent',
    'Ei aktiivista lentoa.': 'No active flight.',
    'Syötä toteutunut lähtöaika ja takeoff-polttoaine. Nämä tallennetaan lennon kontekstiin ja käytetään waypoint-EFOB- ja ETO-laskennoissa.': 'Enter the actual departure time and takeoff fuel. These are stored with the flight and used for waypoint EFOB and ETO calculations.',
    'Takeoff-aika haettu automaattisesti: {} UTC': 'Takeoff time fetched automatically: {} UTC',
    'Takeoff tallennettu: {}{}': 'Takeoff saved: {}{}',
    '📡 Journey-logista haettu ATO:': '📡 ATO from journey log:',
    'Aika (UTC)': 'Time (UTC)',

    // --- NOTAM ---
    'Ei merkittäviä NOTAMeja lennon aikana': 'No significant NOTAMs during the flight',
    'Huomioitavia NOTAMeja lennon aikana': 'NOTAMs to note during the flight',
    'Kenttä tai kiitotie suljettu lennon aikana': 'Airport or runway closed during the flight',
    'Ei voimassa olevia NOTAMeja lennon aikana.': 'No NOTAMs in force during the flight.',
    'Ei voimassa lennon aikana.': 'Not in force during the flight.',
    'Ei oleelliset · eivät voimassa lennon aikana ({})': 'Not relevant · not in force during the flight ({})',
    'Ei oleelliset ({})': 'Not relevant ({})',
    'Oleelliset ({})': 'Relevant ({})',
    'NOTAMit · oleelliset': 'NOTAMs · relevant',
    'Lennon aikaikkuna: {}–{} UTC': 'Flight time window: {}–{} UTC',
    'Ei muita.': 'No others.',
    'Ei NOTAMeja tälle kentälle.': 'No NOTAMs for this airport.',
    'Ei koordinaatteja NOTAM-kentille': 'No coordinates for NOTAM airports',
    'NOTAMit OFP:stä': 'NOTAMs from OFP',
    'Ei aktiivisia NOTAMeja': 'No active NOTAMs',
    'Ei aktiivisia NOTAMeja · {}': 'No active NOTAMs · {}',
    'NOTAM-haku epäonnistui': 'NOTAM fetch failed',
    'NOTAMit eivät ole saatavilla juuri nyt.': 'NOTAMs are not available right now.',
    'Ei saatavilla juuri nyt.': 'Not available right now.',
    'Ei saatavilla.': 'Not available.',
    'Haetaan NOTAMeja {}…': 'Fetching NOTAMs {}…',
    'Näytä kaikki ({}) →': 'Show all ({}) →',
    'Kiitotie': 'Runway',
    'Rullaus': 'Taxiing',
    'Pysäköinti / standit': 'Parking / stands',
    'Linnut / eläimet': 'Birds / wildlife',
    'Menetelmät (SID/STAR/APCH)': 'Procedures (SID/STAR/APCH)',
    'Palvelut (polttoaine, jäänpoisto, RFF)': 'Services (fuel, de-icing, RFF)',
    'Palvelut': 'Services',
    'Navigointi / ILS': 'Navigation / ILS',
    'Navigointi': 'Navigation',
    'Valot': 'Lighting',
    'Esteet': 'Obstacles',
    'Este': 'Obstacle',
    'Ilmatila': 'Airspace',
    'Viestintä': 'Communications',
    'Muut': 'Other',
    'Yleinen': 'General',
    'Voimassa': 'In force',
    'Tila': 'Status',
    'Tallennus epäonnistui.': 'Saving failed.',

    // --- Sää-välilehti ---
    'ICAO (esim. UAAA)': 'ICAO (e.g. UAAA)',
    'Ei METAR-dataa': 'No METAR data',
    'Ei METAR-dataa kentälle {}.': 'No METAR data for {}.',
    'Sää haettu: {}': 'Weather fetched: {}',
    'Virhe: {}': 'Error: {}',
    'Lämpötila: {} (kastepiste {})': 'Temperature: {} (dew point {})',
    'Näkyvyys: {}': 'Visibility: {}',
    'Anna 4-kirjaiminen ICAO-koodi.': 'Enter a 4-letter ICAO code.',
    'Ei dataa': 'No data',

    // --- Kaverit ---
    'Ei jaettua dataa': 'No shared data',
    'Ei kavereita listalla': 'No friends on the list',
    'Ei lentoja jaettavaksi. Synkkaa roster ensin.': 'No flights to share. Sync the roster first.',
    'Ei yhteisiä tapahtumia': 'No common events',
    'Ei yhteisiä tapahtumia seuraavan 60 päivän aikana.': 'No common events in the next 60 days.',
    'Jaon virhe': 'Sharing error',
    'Jakaminen peruutettu.': 'Sharing cancelled.',
    'Kaveri on jo listalla': 'Friend is already on the list',
    'Kaveri poistettu.': 'Friend removed.',
    'Kaveri': 'Friend',
    'Koodi ei sisällä kelvollista dataa.': 'The code does not contain valid data.',
    'Koodin purku epäonnistui.': 'Failed to decode the code.',
    'Koodi kopioitu.': 'Code copied.',
    'Anna koodi.': 'Enter a code.',
    'Laite ei tue natiivijakoa — koodi kopioitu.': 'Native sharing not supported — code copied.',
    'Liitä': 'Paste',
    'Liitä kaverin koodi': "Paste a friend's code",
    '📥 Liitä kaverin koodi': "📥 Paste a friend's code",
    'Liitä kaverin lähettämä koodi (alkaa': 'Paste the code your friend sent (starts with',
    'Lisää kaveri Employee ID:llä. Näet milloin olette samoissa kohteissa tai teillä on yhteisiä vapaapäiviä.': 'Add a friend by Employee ID. You will see when you are at the same destinations or have days off in common.',
    'Lähetä tämä koodi kaverille (WhatsApp, Messenger, email). Koodi sisältää': 'Send this code to a friend (WhatsApp, Messenger, email). The code contains',
    'tiedot (päivämäärät, reitit, ajat) — ei henkilökohtaisia tietoja.': 'data (dates, routes, times) — no personal information.',
    'Jaa oma rosteri': 'Share my roster',
    '📤 Jaa oma rosteri': '📤 Share my roster',
    '📤 Jaa': '📤 Share',
    '📋 Kopioi': '📋 Copy',
    'Poista kaveri?': 'Remove friend?',
    'Poistetaanko': 'Remove',
    '(#{}) listalta?': '(#{}) from the list?',
    'Sinä': 'You',
    'ja': 'and',
    '{} ja {} muuta': '{} and {} others',
    '{}, {} ja {}': '{}, {} and {}',
    '{} lisätty ({} lentoa).': '{} added ({} flights).',
    '{} vapaapäivää': '{} days off',
    '{} yhteistä kohdetta': '{} common destinations',
    'Yhteinen vapaapäivä — hyvä hetki sopia tapaaminen': 'Common day off — a good time to meet up',
    'Virheellinen koodi. Pitää alkaa "FLIGHTDECK1:"': 'Invalid code. It must start with "FLIGHTDECK1:"',
    'Employee ID vaaditaan': 'Employee ID is required',
    'Yhteiset': 'Common',

    // --- Lokikirja ---
    '📊 Yhteenveto': '📊 Summary',
    'Yhteenveto': 'Summary',
    'Kirjaukset': 'Entries',
    '⚙ Toiminnot': '⚙ Actions',
    '⋯ Toiminnot': '⋯ Actions',
    'Toiminnot': 'Actions',
    'Lokikirjan toiminnot': 'Logbook actions',
    'Ei kirjauksia.': 'No entries.',
    'Ei kirjauksia. Tuo lentoja': 'No entries. Import flights from the',
    '-välilehdeltä.': ' tab.',
    '-välilehdeltä tai synkkaa rosteri.': ' tab or sync the roster.',
    'Lokikirja on tyhjä. Tuo lentoja tai palauta varmuuskopiosta.': 'The logbook is empty. Import flights or restore from a backup.',
    'Ei osumia.': 'No matches.',
    'Hae: kapteeni, pvm, lentonumero, kenttä, rekisteri…': 'Search: captain, date, flight no., airport, registration…',
    'Yhteensä · {} kirjausta': 'Total · {} entries',
    'kirjaus': 'entry',
    'kirjausta': 'entries',
    'kirjausta · {} sinetöity{}': 'entries · {} sealed{}',
    '{} kirjausta löytyi': '{} entries found',
    '{} kirjausta päivittyy': '{} entries will be updated',
    '{} kirjausta tarvitsee päivityksen': '{} entries need updating',
    '{} kirjausta allekirjoitettu{}.': '{} entries signed{}.',
    'Päivitetty {} kirjausta.': 'Updated {} entries.',
    '{} lentoa': '{} flights',
    '{} odottaa': '{} pending',
    '{} allekirjoittamatonta lentoa {}': '{} unsigned flights {}',
    '{} allekirjoittamatonta lentoa': '{} unsigned flights',
    '· Ei lupakirjaa': '· No licence',
    '· Lupakirja:': '· Licence:',
    'Lupakirja': 'Licence',
    '1. Pvm': '1. Date',
    'Pvm': 'Date',
    '2. Lähtö': '2. Departure',
    '3. Saapuminen': '3. Arrival',
    '4. Kone': '4. Aircraft',
    '7. Kokonaislentoaika': '7. Total flight time',
    'Olosuhteet & tehtävä': 'Conditions & function',
    'Remarks (sarake 12)': 'Remarks (column 12)',
    'Remarks and endorsements (sarake 12)': 'Remarks and endorsements (column 12)',
    'Huomiot': 'Remarks',
    'Päivämäärä': 'Date',
    'PÄIVÄ': 'DATE',
    'LÄHTÖPAIKKA': 'DEPARTURE PLACE',
    'LÄHTÖAIKA': 'DEPARTURE TIME',
    'Yöaika': 'Night time',
    'Yö': 'Night',
    'yö': 'night',
    'päivä': 'day',
    'yö {}': 'night {}',
    '(yö {})': '(night {})',
    'aika {} ({})': 'time {} ({})',
    'ei lennetty': 'not flown',
    'ei takeoff-aikaa': 'no takeoff time',
    'ei touchdown-aikaa': 'no touchdown time',
    'Vahvista TO / LDG': 'Confirm TO / LDG',
    'Tein takeoffin': 'I did the takeoff',
    'Tein laskun': 'I did the landing',
    '⏳ Odottaa vahvistusta — rastita mitä teit. Päivä/yö lasketaan aikaleimoista.': '⏳ Awaiting confirmation — tick what you did. Day/night is calculated from the timestamps.',
    '⚠ Skyplan ei antanut aikaa — syötä käsin': '⚠ Skyplan gave no time — enter manually',
    '⚠ Skyplan ei palauttanut TO/LDG-vahvistusta. Kuittaa käsin.': '⚠ Skyplan returned no TO/LDG confirmation. Confirm manually.',
    '⚠ Skyplan ei vahvistanut TO/LDG:tä. Rastita mitä teit — päivä/yö lasketaan automaattisesti aikaleimoista.': '⚠ Skyplan did not confirm TO/LDG. Tick what you did — day/night is calculated automatically from the timestamps.',
    'Rastittamaton = 0/0 (ei kreditointia). Yö/päivä lasketaan SunCalcilla aikaleimoista, ei arvata.': 'Unticked = 0/0 (no credit). Night/day is calculated with SunCalc from the timestamps, not guessed.',
    'Allekirjoita': 'Sign',
    'Allekirjoita kaikki': 'Sign all',
    'Allekirjoita kaikki lennot': 'Sign all flights',
    'Allekirjoita lento': 'Sign flight',
    'Allekirjoita {} lentoa': 'Sign {} flights',
    'Allekirjoita, näytä tai poista': 'Sign, view or delete',
    'Allekirjoitat': 'You are signing',
    'Allekirjoitettu': 'Signed',
    'Allekirjoitus': 'Signature',
    'Allekirjoitus peruutettu.': 'Signing cancelled.',
    'Allekirjoitus vaaditaan.': 'Signature required.',
    'Allekirjoittamattomat lennot. Näyttää muutokset ennen tallennusta.': 'Unsigned flights. Shows the changes before saving.',
    'Allekirjoituksesi piirretään PDF:n alaosaan kohtaan': 'Your signature is drawn at the bottom of the PDF in the field',
    'Aiempi allekirjoitus tallessa ({}). Voit piirtää uuden tai peruuttaa ja käyttää vanhaa.': 'Previous signature saved ({}). You can draw a new one or cancel and use the old one.',
    'Piirrä sormella tai Apple Pencilillä': 'Draw with your finger or Apple Pencil',
    'Piirrä allekirjoitus ennen PDF:n luontia.': 'Draw a signature before creating the PDF.',
    'Muokkaa allekirjoitusta': 'Edit signature',
    'Valitse kapteeni ja allekirjoita kaikki avoimet lentonsa.': 'Pick a captain and sign all of their open flights.',
    'Valitse kapteeni, jonka lennot haluat allekirjoittaa kerralla. Jokaisen lennon alle tulee sama allekirjoitus ja lupakirja.': 'Pick the captain whose flights you want to sign at once. Every flight gets the same signature and licence.',
    'Ei allekirjoitettavia lentoja ({} odottaa Skyplan-vahvistusta ⏳).': 'No flights to sign ({} awaiting Skyplan confirmation ⏳).',
    'Ei allekirjoittamattomia lentoja.': 'No unsigned flights.',
    '{} ⏳-lentoa jätetään pois, kunnes Skyplan vahvistaa nousut/laskut.': '{} ⏳ flights are left out until Skyplan confirms the takeoffs/landings.',
    'Kirjaus allekirjoitettu (SPIC).': 'Entry signed (SPIC).',
    'Kirjaus allekirjoitettu.': 'Entry signed.',
    'Kirjaus poistettu.': 'Entry deleted.',
    'Kirjaus {} poistettu.': 'Entry {} deleted.',
    'Poista kirjaus?': 'Delete entry?',
    'Poista {} pysyvästi?': 'Delete {} permanently?',
    'Poisto epäonnistui:': 'Delete failed:',
    '⚠ Tämä poistaa kirjauksen pysyvästi eikä sitä voi perua.': '⚠ This deletes the entry permanently and cannot be undone.',
    '👁 Näytä': '👁 View',
    '🗑 Poista': '🗑 Delete',
    '🗑 Poista kirjaus': '🗑 Delete entry',
    'SPIC-lento': 'SPIC flight',
    'Merkitse kaikki SPIC-lennoiksi': 'Mark all as SPIC flights',
    'Merkitsee nämä lennot SPIC-lennoiksi (PIC-tunnit + SPIC-merkintä remarks-kenttään).': 'Marks these flights as SPIC flights (PIC hours + SPIC note in remarks).',
    'Lentoaika PIC-sarakkeeseen + "SPIC" remarks-kenttään.': 'Flight time in the PIC column + "SPIC" in remarks.',
    '⟳ Päivitä journey-logista': '⟳ Update from journey log',
    'Päivitä lokikirja Skyplanista?': 'Update the logbook from Skyplan?',
    'Päivitä': 'Update',
    'Journey log ei sisällä ATD/ATA-aikoja — lentoa {} ei ole lennetty tai se on peruttu.': 'The journey log has no ATD/ATA times — flight {} has not been flown or was cancelled.',
    'NOT_ON_CREW: et ole lennon {} miehistössä — ei tuoda.': 'NOT_ON_CREW: you are not in the crew of flight {} — not imported.',
    'Lento {} tuotu lokikirjaan.': 'Flight {} imported to logbook.',
    'Lentoa ei voi tuoda': 'Cannot import flight',
    'Lisätty {} uutta ({} duplikaattia ohitettu).': 'Added {} new ({} duplicates skipped).',
    'Lisätty {} uutta lentoa lokikirjaan': 'Added {} new flights to the logbook',
    'Laske yöajat uudelleen': 'Recalculate night times',
    'Laske yöajat uudelleen?': 'Recalculate night times?',
    'Kaikki yöajat ovat jo oikein.': 'All night times are already correct.',
    '⚠ Yöaika ja nousut/laskut lasketaan uudelleen SunCalcin avulla.': '⚠ Night time and takeoffs/landings are recalculated with SunCalc.',
    '⚠ Muutokset ylikirjoittavat nykyiset arvot. Varmuuskopio otetaan automaattisesti.': '⚠ The changes overwrite the current values. A backup is taken automatically.',
    'Käsitelty: {} · Muuttunut: {} · Virheet: {}': 'Processed: {} · Changed: {} · Errors: {}',
    'Käyty läpi: {} · Muutos: {} · Ohitettu: {}': 'Checked: {} · Changed: {} · Skipped: {}',
    'Kuukausi {} ({} / {})': 'Month {} ({} / {})',
    '… ja {} muuta': '… and {} more',
    'Tallenna': 'Save',
    'Peruuta': 'Cancel',
    'Sulje': 'Close',
    'Poista': 'Delete',
    'Palauta': 'Restore',
    'Yhdistä': 'Merge',
    'Korvaa kaikki': 'Replace all',
    'Uusia lisätään': 'New ones are added',
    'Tuo CSV': 'Import CSV',
    'Tuo lokikirja CSV:stä': 'Import logbook from CSV',
    'Yhdistä tai korvaa nykyinen lokikirja CSV-tiedostosta.': 'Merge with or replace the current logbook from a CSV file.',
    'Tuonti': 'Import',
    'Vienti': 'Export',
    'Korjaukset': 'Fixes',
    'Tuonti epäonnistui': 'Import failed',
    'Tiedosto on tyhjä': 'The file is empty',
    'Tiedosto ei ole kelvollinen lokikirjan varmuuskopio.': 'The file is not a valid logbook backup.',
    'Tiedoston lukeminen ei onnistunut.': 'Could not read the file.',
    'Tiedoston tallennus ei onnistunut.': 'Could not save the file.',
    'Ei kelvollisia rivejä. Katso konsolin "Hylätyt rivit" -lista.': 'No valid rows. See the "Rejected rows" list in the console.',
    '⚠ {} riviä hylättiin. Katso konsolista syyt.': '⚠ {} rows were rejected. See the console for reasons.',
    'Päivämääräsaraketta ei löytynyt.': 'Date column not found.',
    'AIMS eCrew -raportti: kentät muunnettu ICAO-koodeiksi, ajat UTC. Yöaika laskettu block-ajoista.': 'AIMS eCrew report: airports converted to ICAO codes, times in UTC. Night time calculated from block times.',
    'CSV valmis — valitse "Tallenna tiedostoon".': 'CSV ready — choose "Save to Files".',
    'CSV-vienti epäonnistui.': 'CSV export failed.',
    'Viedään CSV…': 'Exporting CSV…',
    'Kaikki 12 saraketta + audit-metadata.': 'All 12 columns + audit metadata.',
    'Ei kirjauksia tallennettavaksi.': 'No entries to save.',
    'Ei kirjauksia vietäväksi.': 'No entries to export.',
    'Varmuuskopio epäonnistui.': 'Backup failed.',
    'Varmuuskopio valmis.': 'Backup ready.',
    'Viedään varmuuskopio…': 'Exporting backup…',
    'Varmuuskopioimaton data — muista viedä JSON.': 'Data not backed up — remember to export JSON.',
    'Täysi palautus: allekirjoitukset, hash-ketju, audit-loki.': 'Full restore: signatures, hash chain, audit log.',
    'JSON-tiedostosta. Korvaa nykyisen datan.': 'from a JSON file. Replaces the current data.',
    'Palauta varmuuskopiosta': 'Restore from backup',
    'Palauta varmuuskopiosta?': 'Restore from backup?',
    'Palautus epäonnistui': 'Restore failed',
    'Lokikirja certification-allekirjoituksella.': 'Logbook with certification signature.',
    'Lokikirjan PDF:n luonti epäonnistui.': 'Failed to create the logbook PDF.',
    'PDF avattu jakovalikkoon — valitse "Tallenna tiedostoon".': 'PDF opened in the share menu — choose "Save to Files".',
    'PDF avattu uudessa välilehdessä.': 'PDF opened in a new tab.',
    'PDF-virhe': 'PDF error',
    'PDF:n tallennus epäonnistui.': 'Failed to save the PDF.',
    'Lokikirjassa on {} kirjausta, mutta uusi data sisältää vain {}. Haluatko varmasti ylikirjoittaa?': 'The logbook has {} entries but the new data contains only {}. Are you sure you want to overwrite?',
    'Poistetaanko kaikki {} kirjausta pysyvästi?': 'Delete all {} entries permanently?',
    'merkkiä': 'characters',
    'riviä': 'rows',

    // --- Audit ---
    'Ketju on ehjä. Kaikki allekirjoitetut kirjaukset täsmäävät.': 'The chain is intact. All signed entries match.',
    'Ketju sinetöity uudelleen ({} kirjausta).': 'Chain re-sealed ({} entries).',
    'Korjaus epäonnistui:': 'Repair failed:',
    'Sinetöi ketju uudelleen': 'Re-seal chain',
    'Sinetöity': 'Sealed',
    'Lento': 'Flight',
    'Varoitus: vähintään yksi kirjaus on muuttunut allekirjoituksen jälkeen.': 'Warning: at least one entry has changed after signing.',
    'laskee kaikkien allekirjoitettujen kirjausten hashit uudelleen nykyisillä tiedoilla. Tarkista ensin, että ✕-merkityt kirjaukset ovat oikein. Korjaus ja vanhat hashit kirjataan audit-lokiin.': 'recalculates the hashes of all signed entries from the current data. First check that the entries marked ✕ are correct. The repair and the old hashes are written to the audit log.',
    '⚠ Ketju katkennut · {}/{}': '⚠ Chain broken · {}/{}',
    'Varoitus': 'Warning',

    // --- Yhteenveto ---
    'Recency · FCL.060': 'Recency · FCL.060',
    'Lentoaikarajat · ORO.FTL.210 (block)': 'Flight time limits · ORO.FTL.210 (block)',
    'Lentoaikarajat': 'Flight time limits',
    'Liukuva 28 vrk': 'Rolling 28 days',
    'Liukuvat 12 kk': 'Rolling 12 months',
    'Kalenterivuosi': 'Calendar year',
    '28 vrk': '28 days',
    '90 vrk': '90 days',
    '3 laskua / 90 vrk': '3 landings / 90 days',
    'Nousut 90 vrk': 'Takeoffs 90 days',
    'Laskut 90 vrk': 'Landings 90 days',
    'Nousut': 'Takeoffs',
    'Laskut': 'Landings',
    'Ei 3 laskua 90 vrk sisällä': 'No 3 landings within 90 days',
    'Viimeisin lasku: {} · Vain kirjatut nousut/laskut (⏳-odottavat eivät ole mukana)': 'Last landing: {} · Logged takeoffs/landings only (⏳ pending ones excluded)',
    'Viimeiset 7 vrk: {} h': 'Last 7 days: {} h',
    'Kaikki': 'All',
    'Tämä vuosi': 'This year',
    'Vuosi': 'Year',
    'Lentoaika yhteensä': 'Total flight time',
    'Ei kirjauksia valitulla aikavälillä.': 'No entries in the selected period.',
    'Block-tunnit kuukausittain · 12 kk': 'Block hours per month · 12 months',
    'Tehtävä': 'Function',
    'Koneet': 'Aircraft',
    'Konetyypit': 'Aircraft types',
    '({} tyyppiä)': '({} types)',
    'SIM-ajat': 'SIM time',
    'Reitit': 'Routes',
    'Rekisterit': 'Registrations',
    'Lentonumerot': 'Flight numbers',
    'Lähtökentät': 'Departure airports',
    'Eniten lennetyt kohteet': 'Most flown destinations',
    'Vuosittain': 'By year',
    'Viikonpäivät': 'Weekdays',
    'Ennätykset': 'Records',
    'Ensimmäinen lento': 'First flight',
    'Viimeisin lento': 'Latest flight',
    'Pisin lento': 'Longest flight',
    'Lyhyin lento': 'Shortest flight',
    'Kiireisin päivä': 'Busiest day',
    'Kiireisin kuukausi': 'Busiest month',
    'Matka': 'Distance',
    'Eniten lennetty kapteenin kanssa': 'Most flown with captain',
    'Eniten lennetty perämiehen kanssa': 'Most flown with first officer',
    'Ei PIC-lentoja perämiehen kanssa': 'No PIC flights with a first officer',
    'Ei co-pilot-lentoja': 'No co-pilot flights',
    'Tallentuu uusista tuonneista (miehistötieto)': 'Recorded from new imports (crew data)',
    '{} lentoa · {} h': '{} flights · {} h',
    '{} · {} lentoa': '{} · {} flights',
    '{}: {} h · {} lentoa (PIC {}, COP {})': '{}: {} h · {} flights (PIC {}, COP {})',
    '· ka. {} h / lento': '· avg {} h / flight',
    '· ka.': '· avg',
    '· ⏳ {} odottaa Skyplania': '· ⏳ {} awaiting Skyplan',

    // --- Asetukset ---
    'SKYPLAN KIRJAUTUMINEN': 'SKYPLAN LOGIN',
    'Kirjaudu käyttäjätunnuksella ja salasanalla.': 'Log in with your username and password.',
    '🔐 Kirjaudu': '🔐 Log in',
    'Kirjaudu': 'Log in',
    'Kirjaudu Skyplaniin': 'Log in to Skyplan',
    'Kirjaudu Skyplaniin.': 'Log in to Skyplan.',
    'Kirjaudutaan…': 'Logging in…',
    'Kirjautuminen onnistui': 'Login successful',
    'Käyttäjätunnus': 'Username',
    'Salasana': 'Password',
    'Anna käyttäjätunnus ja salasana': 'Enter your username and password',
    'Täytä molemmat kentät': 'Fill in both fields',
    'Väärä käyttäjätunnus tai salasana': 'Wrong username or password',
    'Vastauksesta puuttuu AccessToken': 'The response has no AccessToken',
    'Token puuttuu.': 'Token missing.',
    'Ei tokenia tallennettuna': 'No token saved',
    'Ei tokenia': 'No token',
    'Ei refresh tokenia': 'No refresh token',
    'Poista refresh token?': 'Delete refresh token?',
    'KÄYTTÄJÄ': 'USER',
    'Käyttäjä': 'User',
    'Nimi': 'Name',
    'Versio': 'Version',
    'CERTIFICATION-ALLEKIRJOITUS': 'CERTIFICATION SIGNATURE',
    'Ei tallennettua allekirjoitusta': 'No saved signature',
    '✍️ Piirrä': '✍️ Draw',
    'PÄIVITYS': 'UPDATE',
    '⟳ Pakota päivitys': '⟳ Force update',
    'Pakota päivitys? Cache tyhjennetään ja sivu ladataan uudelleen.': 'Force update? The cache is cleared and the page is reloaded.',
    'Sovellus päivitetty: {} → {}': 'App updated: {} → {}',
    'Uusi versio ladattu': 'New version downloaded',
    'OFFLINE-VÄLIMUISTI': 'OFFLINE CACHE',
    'OFP:t': 'OFPs',
    'KARTAN VISUAALISET OMINAISUUDET': 'MAP VISUAL FEATURES',
    'Oletukset': 'Defaults',
    'Kartta': 'Map',
    'Kartta-asetukset tallennettu.': 'Map settings saved.',
    'Virhe tallennuksessa': 'Error while saving',
    'Tähtitaivas': 'Starry sky',
    'Taustan tähdet': 'Background stars',
    'Atmosfääri-hehku': 'Atmosphere glow',
    'Päivä/yö-terminaattori': 'Day/night terminator',
    'Yöpuolen tummennus': 'Night side shading',
    'Kaupunkien yövalot': 'City lights at night',
    'Aikavyöhykeviivat': 'Time zone lines',
    '15° välein': 'Every 15°',
    'Säämerkit': 'Weather markers',
    'Lentokenttätietokanta': 'Airport database',
    'Näkyvät zoomatessa': 'Visible when zoomed in',
    'Reitti': 'Route',
    'KIELI / LANGUAGE': 'LANGUAGE / KIELI',

    // --- Yhteys / sijainti ---
    'Yhteys katkesi — siirrytty offline-tilaan.': 'Connection lost — switched to offline mode.',
    'Yhteys palautui': 'Connection restored',
    'Sijainnin haku aikakatkaistiin.': 'Location request timed out.',
    'Sijainti ei ole tuettu tässä laitteessa': 'Location is not supported on this device',
    'Sijaintia ei saatu. Tarkista että sijaintipalvelut ovat päällä.': 'Could not get location. Check that location services are on.',
    'Sijaintilupa evätty. Salli se Asetuksista → Safari → Sijainti.': 'Location permission denied. Allow it in Settings → Safari → Location.',
    'Tuntematon sijaintivirhe.': 'Unknown location error.',
    'Lentoa ei löytynyt': 'Flight not found',
    'Tyhjä payload': 'Empty payload',
    'ZIP ei sisällä PDF:ää': 'The ZIP contains no PDF',
    'Generoidaan overlaita…': 'Generating overlays…',

    // --- Lisäykset (v1.0.11) ---
    'Tervetuloa takaisin, {}': 'Welcome back, {}',
    'JSON-varmuuskopio': 'JSON backup',
    'AutoRouter-avain tallennettu.': 'AutoRouter key saved.',
    'Ehdotukset · {} {}': 'Suggestions · {} {}',
    'Havainto {}': 'Observation {}',
    'Havainto: {}': 'Observation: {}',
    'Luokka: {}': 'Category: {}',
    'Palvelinvirhe (HTTP {})': 'Server error (HTTP {})',
    'Yht': 'Total',
    '📍 Avattu GPS perusteella {}': '📍 Opened based on GPS {}',
    'Anna kelvollinen token.': 'Enter a valid token.',
    'Keltaiset pisteet': 'Yellow dots',
    'Kenttien nimet': 'Airport names',
    'Palautettu oletuksiin.': 'Reset to defaults.',
    'Pallon sininen reuna (blur)': 'Blue globe edge (blur)',
    'Poistettu.': 'Deleted.',
    'Reitin varren pisteet': 'Points along the route',
    'Tallennettu': 'Saved',
    '✓ Tallennettu': '✓ Saved',
    'Vanhenee': 'Expires',
    'Vanhenee pian!': 'Expires soon!',
    'Vanhenee: {}': 'Expires: {}',
    'Virheellinen token': 'Invalid token',
    '⚠️ Token vanhentunut': '⚠️ Token expired',
    '⚠️ Vanhentunut': '⚠️ Expired',
    '(viety {})': '(exported {})',
    'Näytä': 'View',
    'Avaa': 'Open',
    'Allekirjoitettu {}': 'Signed {}',
    'Tyhjä payload dekoodauksen jälkeen': 'Empty payload after decoding',
    'Tuntematon payload-tyyppi: {}': 'Unknown payload type: {}',
    'Tuntematon payload-tyyppi (ensimmäiset tavut: {})': 'Unknown payload type (first bytes: {})',
    'Base64-dekoodaus epäonnistui:': 'Base64 decoding failed:',
    'ZIP-paketti vastaanotettu mutta JSZip ei ole ladattu': 'ZIP package received but JSZip is not loaded',
    'Ei PDF-tavuja': 'No PDF bytes',
    'PDF-cache puuttuu (ofp-data.js ei latautunut)': 'PDF cache missing (ofp-data.js did not load)',
    'OPASTUS': 'GUIDE',
    'Käy sovelluksen tärkeimmät toiminnot läpi vaihe vaiheelta.': 'Walk through the main features of the app step by step.',
    '▶ Näytä opastus': '▶ Show guide',
    '✏️ Viimeistele OFP': '✏️ Finalize OFP',
    'Viimeistele': 'Finalize',
    'Viimeistely epäonnistui: {}': 'Finalizing failed: {}',
    '📋 Kopioi reitti': '📋 Copy route',
    'Reitti kopioitu.': 'Route copied.',
    'Nyt': 'Now',
    'Seuraava': 'Next'
  };

  // Viikonpäivät & kuukaudet (lyhenteet)
  const WD = { 'MA': 'MON', 'TI': 'TUE', 'KE': 'WED', 'TO': 'THU', 'PE': 'FRI', 'LA': 'SAT', 'SU': 'SUN',
               'ma': 'Mon', 'ti': 'Tue', 'ke': 'Wed', 'to': 'Thu', 'pe': 'Fri', 'la': 'Sat', 'su': 'Sun' };
  const MONTHS_FI = ['tammi','helmi','maalis','huhti','touko','kesä','heinä','elo','syys','loka','marras','joulu'];
  const MONTHS_FI3 = ['tam','hel','maa','huh','tou','kes','hei','elo','syy','lok','mar','jou'];
  const MONTHS_EN = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  window.I18N_DICT = DICT;
  window.I18N_WEEKDAYS = WD;
  window.I18N_MONTHS = { fi: MONTHS_FI, fi3: MONTHS_FI3, en: MONTHS_EN };

  // Kielestä riippuvat apufunktiot muille tiedostoille
  window.i18nMonth = function (idx, short) {
    if (getLang() === 'en') return MONTHS_EN[idx];
    return (short ? MONTHS_FI3 : MONTHS_FI)[idx];
  };
  window.i18nWeekday = function (fiAbbr) {
    return getLang() === 'en' ? (WD[fiAbbr] || fiAbbr) : fiAbbr;
  };
  window.i18nLocale = function () { return getLang() === 'en' ? 'en-GB' : 'fi-FI'; };

  /* ------------------------------------------------------------
   * KÄÄNNÖSMOOTTORI
   * ------------------------------------------------------------ */
  const exact = new Map();
  const patterns = [];
  const phraseKeys = [];

  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  for (const [fi, en] of Object.entries(DICT)) {
    if (fi === en) continue;
    if (fi.includes('{}')) {
      const parts = fi.split('{}').map(esc);
      patterns.push({ re: new RegExp('^' + parts.join('([\\s\\S]*?)') + '$'), en, n: parts.length - 1, len: fi.length });
    } else {
      exact.set(fi, en);
      if (fi.length >= 4) phraseKeys.push(fi);
    }
  }
  patterns.sort((a, b) => b.len - a.len);
  phraseKeys.sort((a, b) => b.length - a.length);

  const L = 'A-Za-zÀ-ÖØ-öø-ÿ0-9';
  const phraseRe = phraseKeys.length
    ? new RegExp('(^|[^' + L + '])(' + phraseKeys.map(esc).join('|') + ')(?=$|[^' + L + '])', 'g')
    : null;

  const FI_HINT = /[äöÄÖ]|\b(ei|ja|tai|lento|lentoa|kirjaus|kirjausta|odottaa|muuta|vrk|kk)\b/i;

  function translateCore(s, depth) {
    if (exact.has(s)) return exact.get(s);
    if (depth < 3) {
      for (const p of patterns) {
        const m = s.match(p.re);
        if (!m) continue;
        let i = 1;
        return p.en.replace(/\{\}/g, () => {
          const g = m[i++] || '';
          const t = g.trim();
          if (!t) return g;
          const tr = translateCore(t, depth + 1);
          return tr === t ? g : g.replace(t, tr);
        });
      }
    }
    if (phraseRe) {
      return s.replace(phraseRe, (all, pre, key) => pre + exact.get(key));
    }
    return s;
  }

  function translate(str) {
    if (str == null) return str;
    const s = String(str);
    const t = s.trim();
    if (!t || !/[A-Za-zÀ-ÿ]/.test(t)) return s;
    const norm = t.replace(/\s+/g, ' ');
    const out = translateCore(norm, 0);
    if (out === norm) return s;
    const lead = s.match(/^\s*/)[0];
    const trail = s.match(/\s*$/)[0];
    return lead + out + trail;
  }
  window.t = translate;
  window.i18nTranslate = translate;

  if (getLang() !== 'en') return;

  /* ------------------------------------------------------------
   * DOM-KÄÄNNÖS (vain englanti)
   * ------------------------------------------------------------ */
  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'PRE', 'CODE', 'TEXTAREA', 'INPUT', 'NOSCRIPT']);
  const ATTRS = ['placeholder', 'title', 'aria-label'];

  function skipNode(el) {
    for (let e = el; e && e !== document.body; e = e.parentElement) {
      if (SKIP_TAGS.has(e.tagName)) return true;
      if (e.hasAttribute && e.hasAttribute('data-no-i18n')) return true;
      if (e.isContentEditable) return true;
    }
    return false;
  }

  function doText(node) {
    const v = node.nodeValue;
    if (!v || !v.trim()) return;
    if (node.parentElement && skipNode(node.parentElement)) return;
    const tr = translate(v);
    if (tr !== v) node.nodeValue = tr;
  }

  function doAttrs(el) {
    for (const a of ATTRS) {
      const v = el.getAttribute && el.getAttribute(a);
      if (!v) continue;
      const tr = translate(v);
      if (tr !== v) el.setAttribute(a, tr);
    }
    if (el.tagName === 'INPUT' && (el.type === 'button' || el.type === 'submit') && el.value) {
      const tr = translate(el.value);
      if (tr !== el.value) el.value = tr;
    }
  }

  function walk(root) {
    if (!root) return;
    if (root.nodeType === 3) { doText(root); return; }
    if (root.nodeType !== 1 && root.nodeType !== 11) return;
    if (root.nodeType === 1) {
      if (SKIP_TAGS.has(root.tagName) && root.tagName !== 'INPUT' && root.tagName !== 'TEXTAREA') return;
      doAttrs(root);
      if (root.tagName === 'TEXTAREA' || root.tagName === 'INPUT') return;
      if (root.hasAttribute('data-no-i18n')) return;
    }
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
      acceptNode(n) {
        if (n.nodeType === 1) {
          if (SKIP_TAGS.has(n.tagName) || n.hasAttribute('data-no-i18n')) {
            if (n.tagName === 'INPUT' || n.tagName === 'TEXTAREA') doAttrs(n);
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    let n;
    while ((n = tw.nextNode())) {
      if (n.nodeType === 3) {
        const v = n.nodeValue;
        if (v && v.trim()) { const tr = translate(v); if (tr !== v) n.nodeValue = tr; }
      } else {
        doAttrs(n);
      }
    }
  }

  let observer = null;
  function start() {
    walk(document.body);
    observer = new MutationObserver(muts => {
      for (const m of muts) {
        if (m.type === 'childList') {
          m.addedNodes.forEach(n => {
            if (n.nodeType === 3) doText(n);
            else if (n.nodeType === 1 && !skipNode(n)) walk(n);
          });
        } else if (m.type === 'characterData') {
          doText(m.target);
        } else if (m.type === 'attributes') {
          const el = m.target;
          if (!skipNode(el.parentElement || el)) {
            const v = el.getAttribute(m.attributeName);
            if (v) { const tr = translate(v); if (tr !== v) el.setAttribute(m.attributeName, tr); }
          }
        }
      }
    });
    observer.observe(document.body, {
      childList: true, subtree: true, characterData: true,
      attributes: true, attributeFilter: ATTRS
    });
  }

  // Natiividialogit
  const _confirm = window.confirm.bind(window);
  const _alert = window.alert.bind(window);
  const _prompt = window.prompt.bind(window);
  const trMsg = m => (typeof m === 'string'
    ? m.split('\n').map(line => translate(line)).join('\n')
    : m);
  window.confirm = m => _confirm(trMsg(m));
  window.alert = m => _alert(trMsg(m));
  window.prompt = (m, d) => _prompt(trMsg(m), d);

  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start);
})();
