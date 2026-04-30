let API = window.API_URL || localStorage.getItem('api_base') || '/api';
const API_CANDIDATES = (() => {
  const list = [];
  if (window.API_URL) list.push(window.API_URL);
  const saved = localStorage.getItem('api_base');
  if (saved) list.push(saved);
  list.push('/api');
  if (['localhost', '127.0.0.1', '::1', '[::1]'].includes(window.location.hostname)) {
    list.push('http://127.0.0.1:8000');
    list.push('http://localhost:8000');
    list.push('http://[::1]:8000');
  } else {
    list.push(`${window.location.protocol}//${window.location.hostname}:8000`);
  }
  return [...new Set(list)];
})();
let API_READY = false;

const token = localStorage.getItem('token');
if (!token) window.location.href = 'login.html';
const authH = () => ({ 'Authorization': `Bearer ${localStorage.getItem('token') || ''}` });

async function ensureApiBase(force = false) {
  if (!force && API_READY) return API;

  const prioritized = [API, ...API_CANDIDATES.filter(b => b !== API)];
  for (const base of prioritized) {
    try {
      const res = await fetch(`${base}/health`, { cache: 'no-store' });
      const body = (await res.text()).trim();
      if (res.ok && body.startsWith('{')) {
        API = base;
        localStorage.setItem('api_base', API);
        API_READY = true;
        return API;
      }
    } catch (_) {}
  }
  API = API_CANDIDATES[0] || '/api';
  API_READY = true;
  return API;
}

async function parseApiJsonResponse(res, failPrefix) {
  const raw = await res.text();
  let data = {};
  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch (_) {
      if (raw.trim().startsWith('<')) {
        throw new Error(`${failPrefix}: API yerine HTML döndü (API adresi yanlış veya backend kapalı).`);
      }
      throw new Error(`${failPrefix}: API JSON dönmedi (HTTP ${res.status}).`);
    }
  }
  if (!res.ok) {
    const detail = data && data.detail ? data.detail : `${failPrefix} (HTTP ${res.status})`;
    throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail));
  }
  return data;
}
function logout() { localStorage.clear(); window.location.href = 'login.html'; }
