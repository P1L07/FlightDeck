/* ==============================================================
 * AUDIT TRAIL · EASA AMC1 FCL.050 tamper-evident logbook
 * ==============================================================
 * Jokainen allekirjoitettu lokikirjaus sinetöidään:
 *   hash = SHA256(kanoninen_entry + "|" + edellinen_hash)
 * → muodostaa hash-ketjun (blockchain-lite)
 * → jos yksikin entry muuttuu, ketju katkeaa havaittavasti
 * ============================================================== */

const AUDIT_META_KEY = 'easa_logbook_audit_v1';

/* ---------- Canonical JSON: vain oleelliset kentät, kiinteä järjestys ---------- */
function canonicalizeEntry(entry) {
    const c = {
        id:                 entry.id,
        date:               entry.date,
        departure:          entry.departure,
        arrival:            entry.arrival,
        aircraft:           entry.aircraft,
        singlePilot:        entry.singlePilot,
        multiPilot:         entry.multiPilot,
        totalTimeOfFlight:  entry.totalTimeOfFlight,
        picName:            entry.picName,
        takeoffs:           entry.takeoffs,
        landings:           entry.landings,
        operationalCondition: entry.operationalCondition,
        pilotFunction:      entry.pilotFunction,
        fstd:               entry.fstd,
        remarks:            entry.remarks || '',
        skyplan: {
            flightId:     entry.skyplan?.flightId || null,
            flightNumber: entry.skyplan?.flightNumber || '',
            atd:          entry.skyplan?.atd || null,
            ata:          entry.skyplan?.ata || null,
            takeoff:      entry.skyplan?.takeoff || null,
            touchdown:    entry.skyplan?.touchdown || null,
            blockTime:    entry.skyplan?.blockTime || null,
            flightTime:   entry.skyplan?.flightTime || null
        }
    };
    return JSON.stringify(c);
}

/* ---------- SHA-256 ---------- */
async function sha256Hex(text) {
    const enc = new TextEncoder();
    const buf = await crypto.subtle.digest('SHA-256', enc.encode(text));
    return Array.from(new Uint8Array(buf))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

/* ---------- Ketjun edellinen entry aikajärjestyksessä ---------- */
function _getPrevSealedEntry(entry) {
  const all = getLogbookEntries()
    .filter(e => e.hash && e.id !== entry.id);

  // Ensisijainen: vertaa sealedAt-aikaleimaa
  const entryTime = new Date(entry.sealedAt || 0).getTime();

  // Etsi ne jotka on sinetöity ennen tätä (tiukka <)
  const older = all
    .filter(e => new Date(e.sealedAt || 0).getTime() < entryTime)
    .sort((a, b) => new Date(a.sealedAt || 0) - new Date(b.sealedAt || 0));

  if (older.length) return older[older.length - 1];

  // Fallback: jos samalla aikaleimalla → käytä insertion-järjestystä (edellinen listassa)
  const list = getLogbookEntries().filter(e => e.hash);
  const idx = list.findIndex(e => e.id === entry.id);
  if (idx > 0) return list[idx - 1];

  return null;
}

/* ---------- Sinetöi entry ---------- */
async function sealLogbookEntry(entry) {
  if (!entry || !entry.id) throw new Error('sealLogbookEntry: entry.id required');

  const prev = _getPrevSealedEntry(entry);
  const prevHash = prev ? prev.hash : null;

  if (!entry.sealedAt) entry.sealedAt = new Date().toISOString();

  const payload = canonicalizeEntry(entry) + '|' + (prevHash || '');
  entry.prevHash = prevHash;
  entry.hash = await sha256Hex(payload);
  entry.hashAlgo = 'SHA-256';
  entry.hashVersion = 1;

  _auditAppend({
    type: 'seal',
    entryId: entry.id,
    hash: entry.hash,
    prevHash: prevHash,
    at: entry.sealedAt,
    by: entry.picName || '',
    device: navigator.userAgent.slice(0, 120)
  });

  return entry;
}

/* ---------- Verifioi yksittäinen entry ---------- */
async function verifyLogbookEntry(entry) {
    if (!entry) return { ok: false, reason: 'missing entry' };
    if (!entry.hash)  return { ok: true, unsigned: true };
    const payload = canonicalizeEntry(entry) + '|' + (entry.prevHash || '');
    const expected = await sha256Hex(payload);
    return {
        ok: expected === entry.hash,
        expected,
        actual: entry.hash,
        unsigned: false
    };
}

/* ---------- Verifioi koko ketju ---------- */
async function verifyLogbookChain() {
    const all = getLogbookEntries()
        .filter(e => e.hash)
        .sort((a, b) => new Date(a.sealedAt || 0) - new Date(b.sealedAt || 0));

    const results = [];
    let prevHash = null;
    for (const e of all) {
        const v = await verifyLogbookEntry(e);
        const chainOk = (e.prevHash || null) === prevHash;
        results.push({
            id: e.id,
            flightNumber: e.skyplan?.flightNumber || '',
            date: e.date,
            hashOk: v.ok,
            chainOk,
            overallOk: v.ok && chainOk,
            sealedAt: e.sealedAt
        });
        prevHash = e.hash;
    }
    return {
        total: all.length,
        intact: results.every(r => r.overallOk),
        results
    };
}

/* ---------- Audit-loki (append-only) ---------- */
function _auditRead() {
    try {
        return JSON.parse(localStorage.getItem(AUDIT_META_KEY) || '[]') || [];
    } catch (e) { return []; }
}
function _auditAppend(event) {
    const log = _auditRead();
    log.push(event);
    // Rajataan 5000 entryyn
    if (log.length > 5000) log.splice(0, log.length - 5000);
    try { localStorage.setItem(AUDIT_META_KEY, JSON.stringify(log)); } catch (e) {}
}
function getAuditLog() { return _auditRead(); }

/* ---------- UI: ketjun tila -badge ---------- */
async function renderChainStatusBadge() {
    const el = document.getElementById('chain-status');
    if (!el) return;
    const v = await verifyLogbookChain();
    if (v.total === 0) {
        el.style.display = 'none';
        return;
    }
    el.style.display = 'inline-flex';
    if (v.intact) {
        el.className = 'chain-status ok';
        el.innerHTML = `🔒 Audit trail ehjä · ${v.total} kirjausta`;
    } else {
        el.className = 'chain-status broken';
        const broken = v.results.filter(r => !r.overallOk).length;
        el.innerHTML = `⚠ Ketju katkennut · ${broken}/${v.total}`;
    }
    el.onclick = () => showChainDetails(v);
}
window.renderChainStatusBadge = renderChainStatusBadge;

/* ---------- UI: ketjun yksityiskohdat ---------- */
function showChainDetails(v) {
    const rows = v.results.map(r => `
        <tr>
            <td style="font-family:var(--font-mono); font-size:11px;">
                ${r.flightNumber || '–'}
            </td>
            <td style="font-size:12px;">${r.date || '–'}</td>
            <td style="font-size:11px; color:var(--dim);">
                ${r.sealedAt ? new Date(r.sealedAt).toLocaleString() : '–'}
            </td>
            <td style="text-align:right; color:${r.overallOk ? 'var(--success)' : 'var(--error)'}; font-weight:700;">
                ${r.overallOk ? '✔ OK' : '✕ MUUTETTU'}
            </td>
        </tr>
    `).join('');

    const body = `
        <div style="font-size:13px; margin-bottom:12px; padding:12px;
                    background:${v.intact ? 'rgba(50,215,75,0.08)' : 'rgba(255,69,58,0.10)'};
                    border-left:3px solid ${v.intact ? 'var(--success)' : 'var(--error)'};
                    border-radius:8px;">
            ${v.intact
                ? 'Ketju on ehjä. Kaikki allekirjoitetut kirjaukset täsmäävät.'
                : 'Varoitus: vähintään yksi kirjaus on muuttunut allekirjoituksen jälkeen.'}
        </div>
        <table style="width:100%; border-collapse:collapse; font-size:13px;">
            <thead>
                <tr style="border-bottom:1px solid var(--border);">
                    <th style="text-align:left; padding:8px 6px; color:var(--dim);
                               font-size:10px; letter-spacing:1.5px; text-transform:uppercase;">Lento</th>
                    <th style="text-align:left; padding:8px 6px; color:var(--dim);
                               font-size:10px; letter-spacing:1.5px; text-transform:uppercase;">Pvm</th>
                    <th style="text-align:left; padding:8px 6px; color:var(--dim);
                               font-size:10px; letter-spacing:1.5px; text-transform:uppercase;">Sinetöity</th>
                    <th></th>
                </tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>
        <div style="margin-top:14px; font-size:11px; color:var(--dim);">
            Audit-loki: ${getAuditLog().length} tapahtumaa.
            Algoritmi: SHA-256, hash-versio 1.
        </div>
    `;

    createModal({
        title: 'Audit Trail',
        icon: v.intact ? '🔒' : '⚠️',
        bodyHTML: body,
        confirmText: 'Sulje',
        maxWidth: '720px'
    });
}
window.showChainDetails = showChainDetails;