/* ==============================================================
 * OFP-FINALIZE · OFP-PDF:n viimeistely waypoint-overlayilla
 * ============================================================== */
'use strict';

const OFP_COORD = {
  TIME_X: 485,     // ETO (ylärivi)
  ATO_X: 485,      // ATO (alarivi)
  EFOB_X: 445,     // EFOB (ylärivi)
  AFOB_X: 445,     // AFOB (alarivi)
  RVSM_X: 350,     // RVSM (alarivi)
  NOTES_X: 160,
  V_LIFT: 2,
  LINE_HEIGHT: 12
};

async function finalizeOFP(flightId, options = {}) {
  const { download = true, silent = false } = options;

  if (!flightId) throw new Error('flightId puuttuu');
  if (typeof PDFLib === 'undefined') throw new Error('pdf-lib puuttuu');

  if (!silent && typeof showModalLoader === 'function') {
    showModalLoader('Viimeistellään OFP:tä…', 'Generoidaan overlaita…');
  }

  try {
    const entry = await _getPDFBytesForFlight(flightId);
    if (!entry?.bytes) throw new Error('OFP ei ole saatavilla');

        // HAETAAN WAYPOINTIT PAKOTETUSTI (forceRefresh = true)
    let waypoints = [];
    let logs = (typeof getAllWaypointLogs === 'function') ? getAllWaypointLogs(flightId) : {}; // <-- LISÄÄ TÄMÄ

    if (typeof parseOFPsForWaypoints === 'function') {
      try {
        const wpData = await parseOFPsForWaypoints(flightId, true);
        
        // Varmistetaan, että saadaan kaikki pisteet (allWaypoints)
        if (wpData.allWaypoints && wpData.allWaypoints.length > 0) {
          waypoints = wpData.allWaypoints;
        } else {
          waypoints = wpData.waypoints || [];
        }
        
        window._allOFPWaypoints = waypoints; 
      } catch (e) {
        console.warn('[OFP-Finalize] Failed to load waypoints:', e);
      }
    }

    if (!waypoints.length) {
      waypoints = window._allOFPWaypoints || window._lastWaypoints || [];
    }
    
    if (!waypoints.length) throw new Error('Waypoint-dataa ei ole ladattu.');

    const ctx = (typeof Cache !== 'undefined') 
      ? Cache.get(`flight:context:${flightId}`, { mode: 'persist' })?.value 
      : null;

    const wp0 = waypoints[0]; // Kaikista ensimmäinen piste
    const plannedTakeoffFuel = wp0 ? wp0.fob : null;

    const { PDFDocument, StandardFonts, rgb } = PDFLib;
    const sourceDoc = await PDFDocument.load(entry.bytes);
    const newPdf = await PDFDocument.create();
    
    const copiedPages = await newPdf.copyPages(sourceDoc, Array.from({ length: sourceDoc.getPageCount() }, (_, i) => i));
    const fontB = await newPdf.embedFont(StandardFonts.HelveticaBold);
    const fontR = await newPdf.embedFont(StandardFonts.Helvetica);

    const { TIME_X, ATO_X, EFOB_X, AFOB_X, RVSM_X, NOTES_X, V_LIFT, LINE_HEIGHT } = OFP_COORD;
    const getVal = (log, key) => log && log[key] != null ? String(log[key]).trim() : '';
    let drawn = 0;

    for (let i = 0; i < copiedPages.length; i++) {
      const page = copiedPages[i];
      newPdf.addPage(page);

      for (const wp of waypoints) {
        if (wp.page !== i || wp.isTakeoff) continue;

        const name = String(wp.name || '').toUpperCase();
        const log = logs[name] || {}; // Sallitaan tyhjä log dynaamiseen laskentaan
        const mainY = wp.y_anchor + V_LIFT;

        // 1. ETO — Lasketaan aina takeoff-ajasta!
        let etoTxt = '';
        if (ctx?.takeoffIso && wp.totalMins !== undefined && wp.totalMins !== null) {
          const t = new Date(new Date(ctx.takeoffIso).getTime() + wp.totalMins * 60000);
          etoTxt = String(t.getUTCHours()).padStart(2, '0') + String(t.getUTCMinutes()).padStart(2, '0');
        } else {
          etoTxt = (log.eto || wp.eto || '').replace(':', '');
        }
        if (etoTxt) {
          page.drawText(etoTxt, { x: TIME_X, y: mainY + LINE_HEIGHT, size: 12, font: fontB, color: rgb(0, 0, 0.5) });
          drawn++;
        }

        // 2. EFOB — Lasketaan aina takeoff-fuelista!
        let efobTxt = '';
        if (ctx?.takeoffFuelKg != null && plannedTakeoffFuel != null && wp.fob != null) {
          const burned = Math.max(0, plannedTakeoffFuel - wp.fob);
          efobTxt = String(Math.max(0, ctx.takeoffFuelKg - burned));
        } else if (log.efob != null) {
          efobTxt = String(log.efob);
        }
        if (efobTxt) {
          // Siirretty toinen rivi alaspäin
          page.drawText(efobTxt, { x: EFOB_X, y: mainY - LINE_HEIGHT, size: 10, font: fontR, color: rgb(0, 0, 0) });
          drawn++;
        }

        // 3. ATO (alarivi)
        const atoTxt = getVal(log, 'ato').replace(':', '');
        if (atoTxt) {
          page.drawText(atoTxt, { x: ATO_X, y: mainY, size: 12, font: fontR, color: rgb(0, 0, 0) });
          drawn++;
        }

        // 4. AFOB (alarivi)
        const afobTxt = log.fob != null ? String(log.fob) : '';
        if (afobTxt) {
          // Siirretty toinen rivi alaspäin
          page.drawText(afobTxt, { x: AFOB_X, y: mainY - (LINE_HEIGHT * 2), size: 10, font: fontB, color: rgb(0, 0.5, 0) });
          drawn++;
        }


        // 5. RVSM
        if (log.rvsm === true) {
          // Siirretty alaspäin yhdellä rivillä
          page.drawText('RVSM CHECK OK', { x: RVSM_X, y: mainY - LINE_HEIGHT, size: 8, font: fontB, color: rgb(0, 0.6, 0) });
          drawn++;
        }
      }
    }

    const bytes = await newPdf.save();
    window.lastFinalizedOFPPdfBytes = bytes;
    if (!silent && typeof hideModalLoader === 'function') hideModalLoader();

    if (download && typeof savePDFToDevice === 'function') {
      const flt = String(window._lastFlightNumber || flightId);
      await savePDFToDevice(bytes, `OFP_${flt}_${new Date().toISOString().slice(0, 10)}`);
    }
    return bytes;
  } catch (e) {
    if (!silent && typeof hideModalLoader === 'function') hideModalLoader();
    throw e;
  }
}
window.finalizeOFP = finalizeOFP;