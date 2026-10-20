/* ==============================================================
 * AUTH · Keskitetty tokenhallinta
 * ==============================================================
 * - Yksi jaettu refreshPromise estää rinnakkaiset token-pyynnöt
 * - Hoitaa access- ja refresh-tokenien tallennuksen ja validoinnin
 * - Tarjoaa modaalin tokenin manuaaliseen syöttöön
 * ============================================================== */
'use strict';

(function() {
const REFRESH_COOLDOWN_MS = 5 * 60 * 1000;
let _refreshFailedAt = 0;
let _lastModalShownAt = 0;
const MODAL_COOLDOWN_MS = 10 * 1000;
let _tokenModalPromise = null;
let _refreshPromise = null;

/* ---------------- JWT-parsinta ---------------- */
function parseJwt(token) {
  if (!token || typeof token !== 'string') return null;
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const base64Url = parts[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - base64.length % 4) % 4);
    const jsonPayload = decodeURIComponent(
      atob(padded).split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join('')
    );
    return JSON.parse(jsonPayload);
  } catch (e) { return null; }
}

/* ---------------- Tokenin päivitys (Refresh) ---------------- */
async function refreshSkyplanToken(refreshToken) {
  if (_refreshFailedAt && (Date.now() - _refreshFailedAt) < REFRESH_COOLDOWN_MS) {
    return null;
  }

  const clean = String(refreshToken || '').trim().replace(/^Bearer\s+/i, '').replace(/^"+|"+$/g, '');
  if (!clean || clean.length < 20) return null;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    const resp = await fetch('https://kcskyplanapi.airastana.com/api/v1/auth/refresh-token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'mobile-version': '1.2.0.94'
      },
      body: JSON.stringify({ RefreshToken: clean }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (resp.status === 401 || resp.status === 403) {
      _refreshFailedAt = Date.now();
      return null;
    }

    if (!resp.ok) {
      _refreshFailedAt = Date.now();
      return null;
    }

    const data = await resp.json();
    const newAccess = data.AccessToken || data.accessToken || data.access_token;
    const newRefresh = data.RefreshToken || data.refreshToken || data.refresh_token;

    if (!newAccess) return null;

    try {
      localStorage.setItem('skyplan_token', newAccess);
      if (newRefresh) {
        localStorage.setItem('skyplan_refresh_token', newRefresh);
        localStorage.setItem('skyplan_refresh_token_backup', newRefresh);
      }
    } catch (e) {}

    _refreshFailedAt = 0;
    return newAccess;
  } catch (e) {
    _refreshFailedAt = Date.now();
    return null;
  }
}

/* ---------------- Token-modalin syöttö ---------------- */
function promptForTokenModal() {
  if (_tokenModalPromise) return _tokenModalPromise;

  _tokenModalPromise = new Promise(async (resolve) => {
    let isResolved = false;
    const finish = (resultToken) => {
      if (isResolved) return;
      isResolved = true;
      _tokenModalPromise = null;
      resolve(resultToken);
    };

    const bodyHTML = `
      <div style="display: flex; flex-direction: column; gap: 10px;">
        <label style="font-size: 12px; font-weight: 600; color: var(--dim);">Paste New Skyplan Access Token</label>
        <textarea id="modal-skyplan-token" placeholder='eyJhbGciOi...' style="width: 100%; height: 120px; padding: 10px; border-radius: 8px; background: var(--input); color: var(--text); border: 1px solid var(--border); font-size: 13px; font-family: monospace; box-sizing: border-box;"></textarea>
      </div>`;

    if (typeof createModal === 'function') {
      try {
        await createModal({
          title: 'Skyplan Token Expired', icon: '🔑', type: 'info',
          confirmText: 'Save Token', cancelText: 'Disregard',
          centered: true, compact: true, maxWidth: '500px', bodyHTML: bodyHTML,
          onConfirm: () => {
            const inputElem = document.getElementById('modal-skyplan-token');
            const rawInput = (inputElem ? inputElem.value : '').trim();
            const t = rawInput.replace(/^Bearer\s+/i, '').replace(/^"+|"+$/g, '').trim();
            if (t) {
              try { localStorage.setItem('skyplan_token', t); } catch (e) {}
              if (typeof showToast === 'function') showToast('Skyplan token updated!', 'success');
              finish(t);
            } else {
              finish(null);
            }
          },
          onCancel: () => finish(null)
        });
      } catch (err) {
        finish(null);
      }
    } else {
      const t = prompt("Skyplan Access Token expired. Please paste new token:");
      if (t) {
        try { localStorage.setItem('skyplan_token', t.trim()); } catch (e) {}
        finish(t.trim());
      } else {
        finish(null);
      }
    }
  });

  return _tokenModalPromise;
}

/* ---------------- Pääfunktio: getValidToken ---------------- */
window.getValidToken = async function() {
  if (!navigator.onLine) {
    try {
      const cached = localStorage.getItem('skyplan_token');
      if (cached && cached.length > 20) return cached;
    } catch (e) {}
    return null;
  }

  if (_refreshFailedAt && (Date.now() - _refreshFailedAt) < REFRESH_COOLDOWN_MS) return null;

  let token = null, refreshToken = null;
  try {
    token = localStorage.getItem('skyplan_token');
    refreshToken = localStorage.getItem('skyplan_refresh_token') || localStorage.getItem('skyplan_refresh_token_backup');
  } catch (e) {}

  if (token) {
    token = token.trim().replace(/^Bearer\s+/i, '').replace(/^"+|"+$/g, '');
    if (token === 'null' || token === 'undefined' || token === '') token = null;
  }

  // 1. Token on vielä voimassa (>5 min)
  if (token) {
    const decoded = parseJwt(token);
    if (decoded && typeof decoded.exp === 'number' && decoded.exp > (Math.floor(Date.now() / 1000) + 300)) {
      return token;
    }
  }

  // 2. Token vanhentunut, mutta refresh token löytyy
  if (refreshToken && refreshToken.length > 10) {
    const decodedRefresh = parseJwt(refreshToken);
    if (decodedRefresh && decodedRefresh.exp && (decodedRefresh.exp * 1000 < Date.now())) {
      // Refresh token on vanhentunut
      if (Date.now() - _lastModalShownAt < MODAL_COOLDOWN_MS) return null;
      _lastModalShownAt = Date.now();
      return await promptForTokenModal();
    }

    // KÄYTETÄÄN JAETTUA PROMISEA
    if (!_refreshPromise) {
      _refreshPromise = refreshSkyplanToken(refreshToken).finally(() => {
        _refreshPromise = null;
      });
    }
    const newToken = await _refreshPromise;
    if (newToken) return newToken;
  }

  // 3. Ei tokeneita -> Pyydetään käyttäjältä
  if (Date.now() - _lastModalShownAt < MODAL_COOLDOWN_MS) return null;
  _lastModalShownAt = Date.now();
  return await promptForTokenModal();
};

window.getValidSkyplanToken = window.getValidToken;
window._refreshSkyplanToken = refreshSkyplanToken;
})();