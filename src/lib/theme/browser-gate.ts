/**
 * Tier 3 gate: a browser too old to run the app gets a plain message instead
 * of a broken grey screen.
 *
 * Deliberately ES5 with no modern syntax: a browser that cannot parse this
 * script would show nothing at all, which is the exact failure the gate
 * exists to prevent. It is injected into <head> and runs before React, for
 * the same reason.
 *
 * It tests capability, not user-agent strings, which lie.
 */
export const BROWSER_GATE_SCRIPT = `
(function () {
  function supports(decl) {
    try {
      return !!(window.CSS && window.CSS.supports && window.CSS.supports(decl));
    } catch (e) {
      return false;
    }
  }

  var ok =
    typeof Promise === 'function' &&
    typeof window.fetch === 'function' &&
    supports('--x:0') &&
    supports('display:grid') &&
    supports('position:sticky');

  if (ok) return;

  var wrap = document.createElement('div');
  wrap.setAttribute('role', 'alert');
  wrap.id = 'browser-too-old';
  wrap.style.cssText =
    'position:fixed;inset:0;z-index:2147483647;background:#16181d;color:#fcfcfc;' +
    'font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;' +
    'display:block;padding:32px;text-align:center;';
  wrap.innerHTML =
    '<div style="max-width:420px;margin:15vh auto 0">' +
    '<h1 style="font-size:20px;margin:0 0 12px">Please update your browser</h1>' +
    '<p style="margin:0 0 8px">This app needs a newer browser than the one you are using.</p>' +
    '<p style="margin:0;opacity:.7;font-size:14px">Chrome 111 or newer, Safari 16.4 or newer, ' +
    'Firefox 128 or newer, or Edge 111 or newer.</p>' +
    '</div>';

  function mount() {
    if (document.body) document.body.appendChild(wrap);
  }

  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount);
})();
`;
