/* ==============================================================
 * TOUR · opastus ensikertalaisille
 * ==============================================================
 * - Käynnistyy automaattisesti ensimmäisen kirjautumisen jälkeen
 *   (localStorage: tour_done_v1)
 * - Vaiheittainen: korostus + nuoli + ohjeteksti
 * - Seuraava / Edellinen / Ohita, Esc = ohita, ← → = selaa
 * - Asetuksista voi näyttää uudelleen: startTour(true)
 * - Tekstit suomeksi ja englanniksi (getLang())
 * ============================================================== */
'use strict';

(function () {
  const DONE_KEY = 'tour_done_v1';

  const STEPS = [
    // ---------- KOTI ----------
    { tab: 'home', sel: null,
      fi: ['Tervetuloa FlightDeckiin! 👋', 'Käydään nopeasti läpi tärkeimmät toiminnot. Voit ohittaa opastuksen milloin tahansa ja avata sen myöhemmin uudelleen Asetuksista.'],
      en: ['Welcome to FlightDeck! 👋', 'Let\'s take a quick look at the main features. You can skip this guide at any time and open it again later from Settings.'] },
    { tab: 'home', sel: '#home-map-overlay .hm-icao-dep', optional: true,
      fi: ['Lähtökenttä (DEP)', 'Paina lähtökentän tunnusta, niin näet sen METARin, TAFin ja NOTAMit popupissa. NOTAMit on jaettu lennon kannalta oleellisiin ja muihin.'],
      en: ['Departure (DEP)', 'Tap the departure airport code to see its METAR, TAF and NOTAMs in a popup. NOTAMs are split into ones relevant to your flight and others.'] },
    { tab: 'home', sel: '#home-map-overlay .hm-icao-arr', optional: true,
      fi: ['Määränpää (DEST)', 'Sama toimii määränpäässä: paina tunnusta, niin saat sään ja NOTAMit saapumisajan mukaan.'],
      en: ['Destination (DEST)', 'Same for the destination: tap the code to get the weather and NOTAMs for your arrival time.'] },
    { tab: 'home', sel: '#topbar-flight', optional: true,
      fi: ['Seuraava lento', 'Yläpalkissa näkyy seuraavan lennon numero ja koneen rekisteri. Rekisteri on keltainen, jos koneella on avoin MEL-vika. Paina rekisteriä, niin näet avoimet viat (ADD / CDD). Kehyksessä näkyy aika lähtöön (😴) tai saapumiseen (✈).'],
      en: ['Next flight', 'The top bar shows the next flight number and aircraft registration. The registration turns yellow if the aircraft has an open MEL item. Tap it to see open defects (ADD / CDD). The pill shows time to departure (😴) or arrival (✈).'] },
    { tab: 'home', sel: '#topbar-eta', optional: true,
      fi: ['🛬 ETA', 'Kellon vieressä on arvioitu laskeutumisaika (UTC). Se lasketaan takeoff-ajasta ja OFP:n reittiajoista, ja tarkentuu aina kun kirjaat reittipisteelle ATO-ajan, jolloin aika muuttuu vihreäksi. Ennen lentoa arvio perustuu STD/ETD-aikaan.'],
      en: ['🛬 ETA', 'Next to the clock is the estimated landing time (UTC). It is calculated from the takeoff time and the OFP waypoint times, and refines every time you log an ATO at a waypoint (then it turns green). Before the flight it is based on STD/ETD.'] },
    { tab: 'home', sel: '#home-map-overlay .hm-takeoff-btn', optional: true,
      fi: ['Takeoff-tiedot', 'Kirjaa toteutunut lähtöaika ja takeoff-polttoaine. Niitä käytetään reittipisteiden EFOB- ja ETO-laskentaan.'],
      en: ['Takeoff data', 'Enter the actual departure time and takeoff fuel. They are used for waypoint EFOB and ETO calculations.'] },
    { tab: 'home', sel: '#fc-map', pad: -40,
      fi: ['Kartta', 'Kartalla näet reittisi ja kentät värikoodattuna sään mukaan: vihreä VFR, sininen MVFR, keltainen IFR ja punainen LIFR. Paina kenttää, niin saat sen sään ja NOTAMit.'],
      en: ['Map', 'The map shows your route and airports colour-coded by weather: green VFR, blue MVFR, yellow IFR and red LIFR. Tap an airport to see its weather and NOTAMs.'] },

    // ---------- LENNOT ----------
    { tab: 'flights', sel: '.tabbar .tab-btn[data-tab="flights"]',
      fi: ['Lennot', 'Lennot-välilehdellä näet rosterisi viikoittain.'],
      en: ['Flights', 'The Flights tab shows your roster week by week.'] },
    { tab: 'flights', sel: '#toolbar-week',
      fi: ['Viikon valinta', 'Siirry viikosta toiseen nuolilla. "Tänään" palauttaa kuluvaan viikkoon. Roster päivittyy automaattisesti.'],
      en: ['Week selector', 'Move between weeks with the arrows. "Today" takes you back to the current week. The roster syncs automatically.'] },
    { tab: 'flights', sel: '#week-view-container .wv-flight', optional: true,
      fi: ['Lento', 'Jokaisesta lennosta näet ajat (UTC), reitin, rekisterin ja block-ajan. ⭐ kertoo, että mukana on suosikkimiehistöäsi.'],
      en: ['Flight', 'Each flight shows its times (UTC), route, registration and block time. ⭐ means one of your favourite crew members is on board.'] },
    { tab: 'flights', sel: '#week-view-container .wv-flight-btn-crew', optional: true,
      fi: ['Miehistö', 'Paina tätä nähdäksesi lennon miehistön. Voit lisätä kollegoita suosikeiksi.'],
      en: ['Crew', 'Tap here to see the crew of the flight. You can add colleagues as favourites.'] },

    // ---------- LOKIKIRJA ----------
    { tab: 'logbook', sel: '.tabbar .tab-btn[data-tab="logbook"]',
      fi: ['Lokikirja', 'Lennetyt lennot tuodaan Skyplanista lokikirjaan automaattisesti (EASA FCL.050).'],
      en: ['Logbook', 'Completed flights are imported from Skyplan into the logbook automatically (EASA FCL.050).'] },
    { tab: 'logbook', sel: '#logbook-view-toggle',
      fi: ['Yhteenveto ja kirjaukset', 'Yhteenveto näyttää tunnit ja tilastot. Kirjaukset-näkymässä on jokainen lento rivinä. ⏳ tarkoittaa, että nousut ja laskut odottavat Skyplanin vahvistusta.'],
      en: ['Summary and entries', 'Summary shows your hours and statistics. Entries lists every flight as a row. ⏳ means takeoffs and landings are awaiting Skyplan confirmation.'] },
    { tab: 'logbook', sel: '#logbook-summary .lbs-card', optional: true,
      fi: ['Recency ja lentoaikarajat', 'Ylimpänä näet 90 päivän nousut ja laskut (FCL.060) sekä lentoaikarajat (ORO.FTL.210) väreillä: vihreä on kunnossa, keltainen lähellä rajaa ja punainen yli.'],
      en: ['Recency and flight time limits', 'At the top you see takeoffs and landings in the last 90 days (FCL.060) and flight time limits (ORO.FTL.210), colour-coded: green is fine, yellow is close to the limit and red is over.'] },
    { tab: 'logbook', sel: '#tab-logbook [onclick="showExportDialog()"]',
      fi: ['Toiminnot', 'Täältä löydät: allekirjoita kaikki lennot kerralla, laske yöajat uudelleen, vie CSV / JSON-varmuuskopio / PDF sekä tuo tai palauta lokikirja. Yksittäisen rivin ⋯-valikosta voit allekirjoittaa, katsoa tai poistaa kirjauksen.'],
      en: ['Actions', 'Here you can sign all flights at once, recalculate night times, export CSV / JSON backup / PDF and import or restore the logbook. A row\'s ⋯ menu lets you sign, view or delete a single entry.'] },

    // ---------- BRIEFING ----------
    { tab: 'briefing', sel: '.tabbar .tab-btn[data-tab="briefing"]',
      fi: ['Briefing', 'Briefing kokoaa lennon tiedot yhteen: sää, NOTAMit, miehistö, viat ja reitti.'],
      en: ['Briefing', 'Briefing gathers everything about the flight: weather, NOTAMs, crew, defects and route.'] },
    { tab: 'briefing', sel: '#bf-day', optional: true,
      fi: ['Päivän lennot', 'Päivän kaikki sektorit kääntöaikoineen. Näet missä kohtaa päivää mennään, paljonko kääntöaikaa on jäljellä sekä ETD/ATD- ja ETA/ATA-ajat verrattuna aikatauluun. Paina sektoria valitaksesi sen, nuolilla vaihdat päivää.'],
      en: ['Day overview', 'All sectors of the day with turnaround times. See where you are in the day, how much turnaround time is left and ETD/ATD and ETA/ATA versus schedule. Tap a sector to select it, use the arrows to change day.'] },
    { tab: 'briefing', sel: '#bf-card-dep .bf-taf-badge', optional: true,
      fi: ['TAF-merkki', 'Väri kertoo ennusteen pahimman sääluokan lähtö- tai saapumishetkellä. Paina merkkiä, niin TAF aukeaa ja kyseisen hetken ryhmät on värjätty.'],
      en: ['TAF badge', 'The colour shows the worst forecast category at departure or arrival time. Tap it to open the TAF with the relevant groups highlighted.'] },
    { tab: 'briefing', sel: '#bf-card-dep .bf-notam-badge:not(.bf-taf-badge)', optional: true,
      fi: ['NOTAM-merkki', 'Vihreä: ei merkittäviä NOTAMeja lennon aikana. Keltainen: huomioitavia. Punainen: kenttä tai kiitotie suljettu. Paina merkkiä, niin NOTAMit aukeavat ryhmiteltyinä (kiitotie, rullaus, standit jne.).'],
      en: ['NOTAM badge', 'Green: no significant NOTAMs during the flight. Yellow: NOTAMs to note. Red: airport or runway closed. Tap it to open the NOTAMs grouped by category (runway, taxiway, stands, etc.).'] },
    { tab: 'briefing', sel: '#bf-notam-map', optional: true, pad: -20,
      fi: ['Reittikartta', 'Paina kartalla kenttää, niin saat saman sää- ja NOTAM-popupin kuin kotisivulla.'],
      en: ['Route map', 'Tap an airport on the map to get the same weather and NOTAM popup as on the home page.'] },

    // ---------- LOPPU ----------
    { tab: 'settings', sel: '.tabbar .tab-btn[data-tab="settings"]',
      fi: ['Valmista! ✈', 'Asetuksista voit vaihtaa kielen, piirtää allekirjoituksen ja avata tämän opastuksen uudelleen. Hyviä lentoja!'],
      en: ['All set! ✈', 'In Settings you can change the language, draw your signature and open this guide again. Have good flights!'] }
  ];

  const UI = {
    fi: { next: 'Seuraava', prev: 'Edellinen', skip: 'Ohita', done: 'Valmis' },
    en: { next: 'Next', prev: 'Back', skip: 'Skip', done: 'Done' }
  };
  const lang = () => (typeof window.getLang === 'function' && window.getLang() === 'en') ? 'en' : 'fi';

  let idx = 0, active = false, steps = [], els = null, curTarget = null, runId = 0;

  /* ---------------- DOM ---------------- */
  function build() {
    const root = document.createElement('div');
    root.className = 'tour-root';
    root.setAttribute('data-no-i18n', '');
    root.innerHTML = `
      <div class="tour-block"></div>
      <div class="tour-spot"></div>
      <div class="tour-arrow">➜</div>
      <div class="tour-tip" role="dialog" aria-live="polite">
        <div class="tour-count"></div>
        <div class="tour-title"></div>
        <div class="tour-text"></div>
        <div class="tour-btns">
          <button type="button" class="tour-skip"></button>
          <span style="flex:1"></span>
          <button type="button" class="tour-prev"></button>
          <button type="button" class="tour-next"></button>
        </div>
      </div>`;
    document.body.appendChild(root);
    els = {
      root,
      spot: root.querySelector('.tour-spot'),
      arrow: root.querySelector('.tour-arrow'),
      tip: root.querySelector('.tour-tip'),
      count: root.querySelector('.tour-count'),
      title: root.querySelector('.tour-title'),
      text: root.querySelector('.tour-text'),
      skip: root.querySelector('.tour-skip'),
      prev: root.querySelector('.tour-prev'),
      next: root.querySelector('.tour-next')
    };
    els.skip.onclick = () => end();
    els.prev.onclick = () => go(idx - 1, -1);
    els.next.onclick = () => (idx >= steps.length - 1 ? end() : go(idx + 1, 1));
  }

  function visible(el) {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none';
  }

  function waitFor(sel, ms) {
    return new Promise(resolve => {
      if (!sel) return resolve(null);
      const t0 = Date.now();
      const tick = () => {
        const el = Array.from(document.querySelectorAll(sel)).find(visible);
        if (el) return resolve(el);
        if (Date.now() - t0 > ms) return resolve(null);
        setTimeout(tick, 120);
      };
      tick();
    });
  }

  async function go(i, dir) {
    if (!active) return;
    if (i < 0) i = 0;
    if (i >= steps.length) return end();
    const my = ++runId;
    idx = i;
    const s = steps[i];
    if (s.tab && typeof window.switchTab === 'function') {
      const curTab = document.querySelector('.tab-panel.active')?.id?.replace('tab-', '');
      if (curTab !== s.tab) window.switchTab(s.tab);
    }
    els.tip.style.opacity = '0';
    els.arrow.style.opacity = '0';
    const target = await waitFor(s.sel, s.optional ? 1800 : 1200);
    if (my !== runId || !active) return;
    if (s.sel && !target && s.optional) {
      // Kohdetta ei ole (esim. ei lentoja) → hyppää yli
      const n = i + (dir || 1);
      if (n < 0 || n >= steps.length) return render(s, null);
      return go(n, dir || 1);
    }
    if (target) {
      const r = target.getBoundingClientRect();
      if (r.top < 60 || r.bottom > window.innerHeight - 90) {
        target.scrollIntoView({ block: 'center', behavior: 'smooth' });
        await new Promise(r2 => setTimeout(r2, 380));
        if (my !== runId || !active) return;
      }
    }
    render(s, target);
  }

  function render(s, target) {
    curTarget = target;
    const L = lang(), ui = UI[L];
    const [title, text] = s[L] || s.fi;
    els.count.textContent = `${idx + 1} / ${steps.length}`;
    els.title.textContent = title;
    els.text.textContent = text;
    els.skip.textContent = ui.skip;
    els.prev.textContent = ui.prev;
    els.prev.style.visibility = idx === 0 ? 'hidden' : 'visible';
    els.next.textContent = idx >= steps.length - 1 ? ui.done : ui.next;
    position();
    els.tip.style.opacity = '1';
    setTimeout(() => els?.next?.focus({ preventScroll: true }), 50);
  }

  function position() {
    if (!els) return;
    const s = steps[idx] || {};
    const vw = window.innerWidth, vh = window.innerHeight;
    const tip = els.tip;
    tip.style.maxWidth = Math.min(340, vw - 24) + 'px';

    if (!curTarget || !curTarget.isConnected) {
      els.spot.style.cssText = `left:${vw / 2}px; top:${vh / 2}px; width:0; height:0;`;
      els.arrow.style.opacity = '0';
      const tw = tip.offsetWidth, th = tip.offsetHeight;
      tip.style.left = Math.round((vw - tw) / 2) + 'px';
      tip.style.top = Math.round((vh - th) / 2) + 'px';
      return;
    }

    const pad = s.pad != null ? s.pad : 6;
    const r = curTarget.getBoundingClientRect();
    const sx = Math.max(4, r.left - pad), sy = Math.max(4, r.top - pad);
    const sw = Math.min(vw - 8, r.right + pad) - sx, sh = Math.min(vh - 8, r.bottom + pad) - sy;
    els.spot.style.cssText = `left:${sx}px; top:${sy}px; width:${sw}px; height:${sh}px;`;

    const tw = tip.offsetWidth, th = tip.offsetHeight;
    const gap = 46;           // tila nuolelle
    const below = sy + sh + gap + th < vh - 70;
    const above = sy - gap - th > 8;
    let top, arrowDir;
    if (below || !above) {
      top = below ? sy + sh + gap : Math.max(8, vh - th - 80);
      arrowDir = 'up';
    } else {
      top = sy - gap - th;
      arrowDir = 'down';
    }
    // Iso kohde (kartta) → vihje kohteen sisälle
    if (!below && !above) { top = Math.max(8, Math.min(vh - th - 80, sy + sh / 2 - th / 2)); arrowDir = null; }

    const cx = sx + sw / 2;
    let left = Math.round(cx - tw / 2);
    left = Math.max(12, Math.min(vw - tw - 12, left));
    tip.style.left = left + 'px';
    tip.style.top = Math.round(top) + 'px';

    const a = els.arrow;
    if (!arrowDir) { a.style.opacity = '0'; return; }
    const ax = Math.max(16, Math.min(vw - 16, cx));
    a.className = 'tour-arrow ' + arrowDir;
    a.style.left = ax + 'px';
    a.style.top = (arrowDir === 'up' ? sy + sh + 6 : sy - 6 - 32) + 'px';
    a.style.opacity = '1';
  }

  function onKey(e) {
    if (!active) return;
    if (e.key === 'Escape') { e.stopPropagation(); end(); }
    else if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); els.next.click(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); if (idx > 0) go(idx - 1, -1); }
  }
  let rafPending = false;
  function onMove() {
    if (!active || rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => { rafPending = false; position(); });
  }

  function startTour(force) {
    if (active) return;
    if (!force) {
      try { if (localStorage.getItem(DONE_KEY)) return; } catch (e) { return; }
    }
    if (!document.querySelector('.tabbar')) return;
    steps = STEPS.slice();
    active = true;
    build();
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);
    go(0, 1);
  }

  function end() {
    active = false;
    runId++;
    try { localStorage.setItem(DONE_KEY, new Date().toISOString()); } catch (e) {}
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', onMove);
    window.removeEventListener('scroll', onMove, true);
    if (els?.root) els.root.remove();
    els = null;
    curTarget = null;
    if (typeof window.switchTab === 'function') window.switchTab('home');
  }

  function hasLogin() {
    try { return !!(localStorage.getItem('skyplan_token') || localStorage.getItem('skyplan_refresh_token')); }
    catch (e) { return false; }
  }

  /* Käynnistä automaattisesti, kun käyttäjä on kirjautunut eikä opastusta ole nähty */
  function maybeStartTour(delay = 1500) {
    try { if (localStorage.getItem(DONE_KEY)) return; } catch (e) { return; }
    const t0 = Date.now();
    const wait = () => {
      if (active) return;
      const booting = document.getElementById('boot-overlay');
      const modalOpen = document.querySelector('div[style*="position: fixed"][style*="z-index"] input[type="password"]');
      if ((booting || modalOpen || !hasLogin()) && Date.now() - t0 < 60000) return setTimeout(wait, 700);
      if (!hasLogin()) return;
      setTimeout(() => startTour(false), delay);
    };
    wait();
  }

  window.startTour = startTour;
  window.endTour = end;
  window.maybeStartTour = maybeStartTour;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => maybeStartTour(2000));
  else maybeStartTour(2000);
})();
