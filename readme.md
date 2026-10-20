FlightDeck sovellus
---

### 1. `index.html` (Sisältää UI Gluen ja käynnistyksen)
* **`showModalLoader` / `hideModalLoader`**: Näyttää ja piilottaa globaalin latauspyörän.
* **`showToast`**: Näyttää ponnahdusilmoituksen (onnistuminen, virhe, varoitus).
* **`decodeJWT`**: Purkaa JWT-tokenin sisällön (esim. käyttäjän ID).
* **`switchTab`**: Vaihtaa välilehteä ja laukaisee tarvittavat lataukset (esim. viikkonäkymän).
* **`tickClock` / `updateConnStatus`**: Päivittää kellonajan ja verkkoyhteyden tilan yläpalkissa.
* **`hydrateUser` / `hydrateSettingsTab`**: Täyttää käyttäjän tiedot ja asetukset UI:hin tokenin perusteella.
* **`updateTokenStatus` / `updateRefreshTokenStatus` / `updateTopbarTokenWarning`**: Tarkistaa tokenien voimassaoloajat ja näyttää varoituksia.
* **`saveRefreshToken` / `clearRefreshToken` / `saveTokenFromSettings`**: Tallentaa tai poistaa tokeneita paikallisesta muistista.
* **`renderMapFeaturesUI` / `applyMapFeaturesUI` / `resetMapFeaturesUI`**: Hallinnoi kartan visuaalisia asetuksia (tähdet, terminaattori, yms.).
* **Boot-logiikka (`_boot` / `DOMContentLoaded`)**: Käynnistää tietokannan, käyttäjän, lentokentät, rosterin ja kartan vaiheittain.

---

### 2. `app.js` (Sovelluksen ydin ja API-integraatiot)
* **`hhmmFromIso`, `yyyymmddFromIso`, `blockToHHMM`**: Aikojen ja päivämäärien muotoiluapurit.
* **`createModal`**: Yleiskäyttöinen modaali-ikkuna (vahvistus, virheet, lomakkeet).
* **`fetchFlightIdFromRoster` / `refreshSingleFlightFromRoster`**: Hakee yksittäisen lennon tiedot tai ID:n rosterista.
* **`promptForTokenModal`**: Modaali uuden tokenin syöttämiseen, jos vanha on vanhentunut.
* **`_refreshSkyplanToken` / `getValidSkyplanToken`**: Älykäs tokenin hallinta. Tarkistaa voimassaolon, yrittää päivittää refresh-tokenilla ja pyytää käyttäjää tarvittaessa.
* **`loadAssignedFlights`**: Hakee kuukauden lentorosterin Skyplanista ja tallentaa sen välimuistiin.
* **`fetchSkyplanOFPBytes`**: Hakee OFP (Operational Flight Plan) PDF:n. Hoitaa rinnakkaiset API-kutsut (v1 ja v2), ZIP-pur kamisen ja offline-tallennuksen.
* **`fetchJourneyLog`**: Hakee lennon toteumatiedot (ATD, ATA, miehistö) Skyplanista.
* **`autoImportCompletedFlights`**: Massatuo päättyneet lennot lokikirjaan automaattisesti.
* **`previewOFPFromSkyplan`**: Avaa OFP:n PDF-katseluun. Tarkistaa ensin RAM-muistin, sitten IndexedDB:n ja vasta viimeisenä verkon.

---

### 3. `logbook.js` (EASA FCL.050 Lokikirja)
* **`_lbReadAll` / `_lbWriteAll`**: Lukee ja kirjoittaa lokikirjan dataa (IndexedDB:n kautta).
* **`getLogbookEntry` / `saveLogbookEntry` / `deleteLogbookEntry`**: Perustoiminnot lokikirjan riveille.
* **`getCertificationSignature` / `setCertificationSignature`**: Hallinnoi PDF:n "I certify..." -allekirjoitusta.
* **`getLicenseForPilot` / `setLicenseForPilot`**: Muistaa kapteenin lupakirjanumeron.
* **`calculateNightTime` / `isNight`**: Laskee yöajan SunCalcin avulla (lennon aikana tapahtuva auringonlasku/nousu).
* **`createLogbookEntry`**: Luo tyhjän EASA-lokikirjarivin pohjan.
* **`mapJourneyLogToEntry`**: Muuntaa Skyplanin datan lokikirjan muotoon (laskee mm. yö/päivä-nousut ja laskut).
* **`importLogbookFromJourneyLog`**: Tuo yhden lennon lokikirjaan.
* **`renderLogbookTable`**: Piirtää lokikirjan taulukkonäkymän.
* **`showLogbookEntryDetail`**: Avaa yksityiskohtaisen modaalin (sisältää TO/LDG manuaalisen kuittauksen).
* **`promptLogbookSignature` / `signAllFlightsForPilot`**: Allekirjoitusmodaalit (yksittäin tai massana).
* **`generateLogbookPDF`**: Generoi virallisen PDF-lokikirjan (pdf-lib kirjastolla).
* **`saveLogbookPDF` / `printLogbook`**: Tallentaa PDF:n laitteelle.
* **`exportLogbookCSV` / `exportLogbookJSON` / `importLogbookJSON` / `importLogbookFromCSV`**: Varmuuskopiointi ja datan siirto.
* **`showExportDialog`**: "Toiminnot"-valikko lokikirjan työkaluille.
* **`syncLogbookWithSkyplan`**: Synkronoi avoimet (pending) TO/LDG-kirjaukset Skyplanin kanssa.
* **`recalculateNightTimes`**: Käy läpi kaikki lennot ja laskee yöajat uudelleen.
* **`scanForCompletedFlights`**: Taustaprosessi, joka etsii ja tuo päättyneet lennot.

---

### 4. `map.js` (Karttamoottori)
* **`_loadWorldData`**: Lataa maailmankartan (GeoJSON) ja pitää sen muistissa.
* **`getMapFeatures` / `setMapFeatures`**: Lukee ja tallentaa kartan visuaaliset asetukset.
* **`_getAirportStatus` / `_evaluateWxSeverity`**: Laskee kentän värin (vihreä/keltainen/punainen) sään (VFR/MVFR/IFR/LIFR) ja NOTAM-sulkujen perusteella.
* **`renderFlightMap`**: Koko kartan renderöintimoottori. Piirtää maapallon, reitin (waypointit tai great circle), kenttämarkerit ja hallitsee eleitä (pan, zoom, pinch).
* **`renderHomeRouteFromCache` / `waitForHomeRouteReady`**: Mahdollistaa kotikartan reitin välittömän piirtämisen välimuistista.

---

### 5. `weather.js` (Sää & Kotisivu)
* **`fetchMETAR` / `fetchTAF`**: Hakee säädatan (AviationWeather API:n kautta).
* **`_fmtWind` / `_fmtVis` / `_fmtClouds` / `_fmtTemp`**: Sään formatointiapurit.
* **`renderWeatherWidget`**: Piirtää sään UI-kortin.
* **`renderHomeDashboard`**: Kotisivun päälogiikka. Hakee seuraavan lennon, piirtää kartan, ajastaa countdownin, hakee NOTAMit ja sään.
* **`showAirportPopupInline`**: Avaa kentän tiedot (METAR, TAF, NOTAMit) kun kartalla klikataan kenttää.

---

### 6. `ofp-data.js` (OFP-tiedon purku)
* **`_getPDFBytesForFlight`**: PDF-tiedoston välimuisti (RAM-muisti). Estää saman PDF:n lataamisen moneen kertaan.
* **`_notamReadPDFLines`**: Purkaa PDF-tekstin riveiksi.
* **`parseOFPsForNotams`**: Etsii ja jäsentää NOTAMit OFP-tekstistä.
* **`buildAirportData`**: Kokoaa listan reitin kentistä (DEP, DEST, ALTN, NOTAM).
* **`parseOFPsForWaypoints`**: Purkaa reittipisteet (waypointit) OFP:n NAV LOG -sivuilta. **Suodattaa pois SID/STAR-pisteet** ja FIR-rajat.

---

### 7. `ofp-map.js` (Briefing-sivun NOTAM-kartta)
* **`renderNotamMap`**: Piirtää erillisen NOTAM-kartan (käytetään Briefing-sivulla).
* **`showAirportNotamModal`**: Avaa suuren modaalin, jossa on kentän METAR, TAF ja kaikki NOTAMit.
* **`_preloadWxForAirports` / `fetchWXForAirport`**: Esilataa sään kaikille reitin kentille.

---

### 8. `ofp-parser.js` (Tekstinlouhinta PDF:stä)
* **`getLinesFromPDFPage` / `buildRows`**: Jäsentää PDF:n sisällön luettaviin riveihin koordinaattien perusteella.
* **`extractNOTAMs`**: Poimii NOTAM-lohkot tekstistä (tunnistaa alkukohdat ja lopetusehdot).
* **`extractRoutes`**: Etsii "DEST ROUTE:" ja "ALTN ROUTE:" -merkkijonot.
* **`parseRouteWaypointNames`**: Pilkkoo reittimerkkijonon sanoiksi ja tunnistaa oikeat waypoint-nimet (jättää pois korkeudet ja airways).
* **`parseNotamValidity`**: Purkaa NOTAMin B) ja C) -kentät (voimassaoloajat).
* **`extractCoordFromString`**: Muuttaa DDMM-koordinaatit desimaaliasteiksi.

---

### 9. `airport-db.js` (Lentokenttätietokanta)
* **`initAirportDB`**: Lataa ja tallentaa OurAirports CSV-datan IndexedDB:hen (päivittää 30 vrk välein).
* **`lookupAirport` / `getAirportName`**: Hakee kentän tiedot (lat/lon, nimi) muistista tai tietokannasta.
* **`normalizeIcao`**: Korjaa vanhentuneet ICAO-koodit (esim. UACN -> UACC).

---

### 10. `flight-utils.js` (Jaetut apurit)
* **`_cacheJourneyLog` / `_getCachedJourneyLog`**: Tallentaa ja lukee lennon miehistö/ATD/ATA-tiedot.
* **`_extractPdfBytes` / `extractPdfFromZipOrRaw`**: Purkaa ZIP-paketoidun PDF:n tai käsittelee raa'an PDF-datan.
* **`parseCrewFromJourneyLog`**: Jäsentää miehistölistan rooleihin (PIC, FO, IFS, CC).
* **`extractStandNumber`**: Etsii lennon portin/stand-paikan eri kentistä.
* **`getBlockFuelFromOFP`**: Purkaa OFP:stä block fuelin ja minimipolttoaineen.
* **`updateTopbarCountdown`**: Päivittää yläpalkin lähtölaskennan seuraavaan lentoon.
* **`showFlightCrewModal`**: Modaali, joka näyttää tietyn lennon miehistön.

---

### 11. `briefing.js` (Lennon briefing -näkymä)
* **`renderBriefing`**: Kokoaa briefing-sivun: hakee sään (METAR/TAF), miehistön, NOTAM-kartan ja näyttää OFP-napin.
* **`onBriefingFlightChange`**: Vaihtaa valittua lentoa ja päivittää näkymän.
* **`openBriefingOFP` / `importBriefingToLogbook`**: Toiminnot OFP:n avaamiseen ja lokikirjaan tuontiin.
* **`forceRefreshBriefing`**: "Päivitä"-nappi. Tyhjentää sään, OFP:n ja NOTAMien välimuistit ja hakee pakotetusti uudet tiedot.

---

### 12. `tripinfo.js` (Lennon painot & polttoaineet)
* **`_parseOFPFuelAndWeights`**: Purkaa OFP:stä MTOW, MLW, ZFW, Ramp Fuel, Trip Fuel yms.
* **`renderTripInfoCard`**: Piirtää lomakkeen, jossa kapteeni voi tarkistaa painot ennen lähetystä.
* **`submitTripInfo`**: Lähettää lomakkeen tiedot takaisin Skyplanin API:in (trip-info endpoint).

---

### 13. `defects.js` (Koneen viat / ADD)
* **`fetchAircraftDefects`**: Hakee koneen vikalistan (ADD/CDD) Skyplanista rekisteritunnuksen perusteella.
* **`renderDefectsTableHTML`**: Piirtää vikataulukon (XSS-suojattu).
* **`showDefectsPopup`**: Avaa vikalistan erilliseen ponnahdusikkunaan (Kotisivulta).

---

### 14. `version.js` (Ylläpito)
* **`checkAppVersion`**: Vertaa selaimen versiota ja näyttää päivitystoastin.
* **`forceAppRefresh`**: Tyhjentää Service Workerin ja selaimen cachen ja pakottaa kovan päivityksen.
* **`migrateDataIfNeeded`**: Päivittää paikallisen datan skeeman (esim. lisää puuttuvat kentät vanhoihin lokikirjoihin).
* **`registerServiceWorker`**: Rekisteröi PWA:n Service Workerin.

---

### 15. `roster.js` (Rosterin hallinta)
* **`mergeRosterFlights`**: Yhdistää vanhan ja uuden rosterin (poistaa yli 90 vrk vanhat).
* **`compareRosters`**: Vertaa vanhaa ja uutta rosteria (löytää lisätyt, poistetut ja muuttuneet lennot).
* **`showRosterChangeModal`**: Näyttää ponnahdusikkunan, jos dispatch on muuttanut lentoja.
* **`forceRosterSync`**: Hakee 3 kuukautta (edellinen, nykyinen, seuraava) rinnakkain ja yhdistää ne.
* **`autoLoadMonthRoster`**: Taustalla tapahtuva automaattinen rosterin haku käynnistyksen yhteydessä.

---

### 16. `notam.js` (AutoRouter NOTAMit)
* **`fetchNOTAMs`**: Hakee NOTAMit AutoRouter API:sta (proxyn kautta).
* **`_parseQLine`**: Purkaa NOTAMin Q-koodin (esim. QR) ja tunnistaa kategorian (esim. kiitotie, navigointi).
* **`_notamCategory` / `_highlightNotam`**: Kategorisoi NOTAMit ja korostaa tekstistä kriittiset sanat (esim. CLSD).
* **`loadHomeNOTAMs` / `loadNOTAMsForStation`**: Renderöi NOTAMit UI:hin.

---

### 17. `db.js` (IndexedDB-tallennus)
* **`dbInit`**: Alustaa tietokannan ja valitsee suurimman datalähteen (IDB, localStorage tai backup) migraatiota varten.
* **`dbPutOne` / `dbDeleteOne` / `dbReplaceAll`**: Synkroniset funktiot datan kirjoittamiseen (päivittää muistia ja IDB:tä taustalla).
* **`dbReplaceAllSafe`**: Turvatoiminto. Varmistaa, ettei vahingossa ylikirjoiteta isoa lokikirjaa pienemmällä datalla.
* **`_mirrorToLocalStorage`**: Pitää pientä kopiota localStoragessa migraatioita ja varoja varten.

---

### 18. `weekview.js` (Viikkonäkymä)
* **`renderWeekView`**: Piirtää 7 päivän kortit viikoittain (lennot, vapaapäivät, block-ajat).
* **`_wvSyncAndRender`**: Hakee uuden datan vain jos kyseistä viikkoa ei ole vielä välimuistissa.
* **`weekViewPrev` / `weekViewNext` / `weekViewToday`**: Viikkonavigaatio.
* **`_wvScrollToToday`**: Varmistaa, että avattaessa näkymä skrollautuu automaattisesti tämän päivän kohdalle.

---

### 19. `offline.js` (Offline-tilan hallinta)
* **`safeFetch`**: Estää verkkopyynnöt, jos laite on offline-tilassa.
* **`isTokenExpiredOrExpiring`**: Nopea tarkistus tokenin vanhenemiselle.
* **`_onBackOnline`**: Orkestroi kaikki toiminnot, kun verkkoyhteys palautuu (roster-sync, lokikirjan päivitys, kotisivun kartan lataus).

---
