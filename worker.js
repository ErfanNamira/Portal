// ==========================================
// 1. CONFIGURATION
// ==========================================
const CONFIG = {
    separator: '------',
    cacheTTL: 86400, // 24 hours for static assets
    sessionMaxAge: 2592000, // 30 days
    browserEmulation: {
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        acceptLanguage: 'en-US,en;q=0.9',
        acceptEncoding: 'gzip, deflate, br, zstd',
        secChUa: '"Chromium";v="128", "Not;A=Brand";v="24", "Google Chrome";v="128"',
        secChUaMobile: '?0',
        secChUaPlatform: '"Windows"',
    }
};

// Domains that should bypass the proxy and load directly (Crucial for CAPTCHAs)
const PASSTHROUGH_DOMAINS = [
    'hcaptcha.com', 
    'challenges.cloudflare.com', 
    'turnstile.com'
];

// ==========================================
// 2. JS INJECTION
// ==========================================
const JS_INJECTION = `
<script>
(function() {
    // Skip injection for ad iframes to prevent breaking them and showing raw text
    if (window.top !== window.self && window.location.search.includes('_proxy_iframe=1')) return;

    const SEP = '${CONFIG.separator}';
    const HOST = location.host;
    const ORIGIN = location.origin;
    const PASSTHROUGH = ${JSON.stringify(PASSTHROUGH_DOMAINS)};

    // 0. Block Service Workers (Crucial for Reddit, YouTube, etc.)
    if (navigator.serviceWorker) {
        navigator.serviceWorker.register = () => Promise.reject('Blocked by proxy');
        navigator.serviceWorker.getRegistrations().then(regs => regs.forEach(r => r.unregister())).catch(() => {});
    }

    // Core Proxy URL Resolver
    function toProxy(url) {
        if (!url || typeof url !== 'string') return url;
        if (url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('javascript:') || url.startsWith('#') || url.startsWith('mailto:')) return url;
        if (url.includes('/' + SEP)) return url; // Already proxied

        try {
            let testUrl = url;
            if (testUrl.startsWith('//')) testUrl = location.protocol + testUrl;
            const abs = new URL(testUrl, location.href);

            // Passthrough for CAPTCHA and CF Challenge
            if (PASSTHROUGH.some(d => abs.host.endsWith(d) || abs.host === d || abs.pathname.includes('/' + d + '/'))) return url;

            // Relative URL on proxy host. Map back to target origin.
            if (abs.host === HOST) {
                const pathMatch = location.pathname.match(new RegExp('^\\\\/' + SEP + '(https?:\\\\/\\\\/[^\\\\/]+)'));
                const targetOrigin = pathMatch ? pathMatch[1] : ORIGIN;
                return ORIGIN + '/' + SEP + targetOrigin + abs.pathname + abs.search + abs.hash;
            }

            // External URL
            if (abs.origin !== ORIGIN) {
                return ORIGIN + '/' + SEP + abs.href;
            }
            return url;
        } catch(e) { return url; }
    }

    // 1. Fetch API & Request Objects
    const origFetch = window.fetch;
    window.fetch = function(input, init) {
        try {
            if (input instanceof Request) {
                const proxiedUrl = toProxy(input.url);
                if (proxiedUrl !== input.url) input = new Request(proxiedUrl, input);
            } else if (typeof input === 'string' || input instanceof URL) {
                input = toProxy(input.toString());
            }
        } catch(e) {}
        return origFetch.call(this, input, init);
    };

    // 2. XMLHttpRequest
    const origOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(m, u, ...a) {
        return origOpen.apply(this, [m, toProxy(u), ...a]);
    };

    // 3. WebSocket (Passthrough to avoid breaking live chat/streams)

    // 4. EventSource (SSE)
    if (window.EventSource) {
        const OrigES = window.EventSource;
        window.EventSource = function(url, config) {
            return new OrigES(toProxy(url), config);
        };
    }

    // 5. Window Open & History API
    const origOpenWin = window.open;
    window.open = function(u, ...a) { return origOpenWin.call(this, u ? toProxy(u) : u, ...a); };
    const origPush = history.pushState, origReplace = history.replaceState;
    history.pushState = function(s, t, u) { return origPush.apply(this, [s, t, u ? toProxy(u) : u]); };
    history.replaceState = function(s, t, u) { return origReplace.apply(this, [s, t, u ? toProxy(u) : u]); };

    // 6. DOM Attributes & Properties Interception
    const origSetAttribute = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function(name, value) {
        const lowerName = name.toLowerCase();
        if (['src', 'href', 'action', 'data-src', 'data-lazy-src', 'data-bg', 'poster', 'srcset', 'xlink:href', 'data-original', 'data-retina'].includes(lowerName) && typeof value === 'string') {
            value = toProxy(value);
        }
        return origSetAttribute.call(this, name, value);
    };

    const propsToIntercept = {
        'HTMLImageElement': ['src', 'srcset'], 'HTMLScriptElement': ['src'], 'HTMLIFrameElement': ['src'],
        'HTMLVideoElement': ['src', 'poster'], 'HTMLAudioElement': ['src'], 'HTMLSourceElement': ['src', 'srcset'],
        'HTMLAnchorElement': ['href'], 'HTMLFormElement': ['action'], 'HTMLLinkElement': ['href'],
        'HTMLObjectElement': ['data'], 'HTMLEmbedElement': ['src']
    };

    for (const [tagName, props] of Object.entries(propsToIntercept)) {
        const proto = window[tagName]?.prototype;
        if (!proto) continue;
        for (const prop of props) {
            const descriptor = Object.getOwnPropertyDescriptor(proto, prop);
            if (descriptor && descriptor.set) {
                const origSet = descriptor.set;
                Object.defineProperty(proto, prop, {
                    configurable: true, enumerable: true, get: descriptor.get,
                    set: function(val) { if (typeof val === 'string') val = toProxy(val); return origSet.call(this, val); }
                });
            }
        }
    }

    // 7. Dynamic CSS Injection Interception
    const origInsertRule = CSSStyleSheet.prototype.insertRule;
    CSSStyleSheet.prototype.insertRule = function(rule, index) {
        if (typeof rule === 'string') {
            rule = rule.replace(/url\\(\\s*(['"]?)([^'")]+)\\1\\s*\\)/gi, (m, q, u) => "url(" + q + toProxy(u) + q + ")");
        }
        return origInsertRule.call(this, rule, index);
    };

    // 8. PostMessage Interception
    const origPostMessage = window.postMessage;
    window.postMessage = function(message, targetOrigin, ...args) {
        if (typeof targetOrigin === 'string' && targetOrigin !== '*') targetOrigin = '*';
        return origPostMessage.call(this, message, targetOrigin, ...args);
    };

    // 9. Document Write Interception
    const origWrite = document.write;
    const origWriteln = document.writeln;
    document.write = function(...args) {
        return origWrite.apply(this, args.map(a => typeof a === 'string' ? rewriteHTMLString(a) : a));
    };
    document.writeln = function(...args) {
        return origWriteln.apply(this, args.map(a => typeof a === 'string' ? rewriteHTMLString(a) : a));
    };

    // 10. innerHTML / outerHTML Interception
    const origInnerHTMLDesc = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
    if (origInnerHTMLDesc && origInnerHTMLDesc.set) {
        Object.defineProperty(Element.prototype, 'innerHTML', {
            configurable: true, enumerable: true, get: origInnerHTMLDesc.get,
            set: function(val) { return origInnerHTMLDesc.set.call(this, typeof val === 'string' ? rewriteHTMLString(val) : val); }
        });
    }

    const origOuterHTMLDesc = Object.getOwnPropertyDescriptor(Element.prototype, 'outerHTML');
    if (origOuterHTMLDesc && origOuterHTMLDesc.set) {
        Object.defineProperty(Element.prototype, 'outerHTML', {
            configurable: true, enumerable: true, get: origOuterHTMLDesc.get,
            set: function(val) { return origOuterHTMLDesc.set.call(this, typeof val === 'string' ? rewriteHTMLString(val) : val); }
        });
    }

    function rewriteHTMLString(html) {
        return html.replace(/(src|href|action|poster|srcset)\\s*=\\s*(['"])([^'"]+)\\2/gi, (m, attr, q, url) => {
            return attr + '=' + q + toProxy(url) + q;
        });
    }

    // 11. MutationObserver
    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            if (mutation.type === 'childList') {
                mutation.addedNodes.forEach(node => {
                    if (node.nodeType === 1) {
                        rewriteNode(node);
                        node.querySelectorAll && node.querySelectorAll('*').forEach(rewriteNode);
                    }
                });
            }
        }
    });

    function rewriteNode(el) {
        if (!el || !el.tagName) return;
        const attrs = ['src', 'href', 'action', 'data-src', 'data-lazy-src', 'data-original', 'data-retina', 'data-bg', 'poster', 'srcset', 'xlink:href'];
        for (const attr of attrs) {
            if (el.hasAttribute(attr)) {
                const val = el.getAttribute(attr);
                if (val && typeof val === 'string') {
                    const proxied = toProxy(val);
                    if (proxied !== val) el.setAttribute(attr, proxied);
                }
            }
        }
    }

    observer.observe(document.documentElement, { childList: true, subtree: true });

    // 12. AdBlock Injection
    const adBlockStyle = document.createElement('style');
    const adBlockCSS = 'iframe[src*="magsrv.com"], iframe[src*="idzone="], iframe[src*="exoclick"], iframe[src*="popads"], iframe[src*="juicyads"], iframe[src*="trafficstars"], iframe[src*="iframe.php?"] { display: none !important; height: 0 !important; width: 0 !important; position: absolute !important; left: -9999px !important; } div[style*="text-align:center;"] { min-height: 0 !important; margin: 0 !important; padding: 0 !important; }';
    adBlockStyle.innerHTML = adBlockCSS;
    (document.head || document.documentElement).appendChild(adBlockStyle);

    const adObserver = new MutationObserver(() => {
        document.querySelectorAll('iframe[src*="magsrv.com"], iframe[src*="idzone="]').forEach(el => {
            el.remove();
            if (el.parentElement && el.parentElement.children.length === 0) {
                el.parentElement.remove();
            }
        });
    });
    adObserver.observe(document.documentElement, { childList: true, subtree: true });

})();
</script>
`;

// ==========================================
// 3. AUTHENTICATION & HELPERS
// ==========================================
function getAuthToken(env) {
    return btoa((env.PROXY_USER || '') + ':' + (env.PROXY_PASS || ''));
}

function authenticate(request, env) {
    const cookie = request.headers.get('Cookie') || '';
    const match = cookie.match(/proxy_session=([^;]+)/);
    if (match && match[1] === getAuthToken(env)) return true;

    const authHeader = request.headers.get('Authorization');
    if (authHeader && authHeader.startsWith('Basic ')) {
        const [user, pass] = atob(authHeader.slice(6)).split(':');
        return user === (env.PROXY_USER || '') && pass === (env.PROXY_PASS || '');
    }
    return false;
}

function extractTargetUrl(path, separator) {
    const idx = path.indexOf(separator);
    return idx === -1 ? null : path.substring(idx + separator.length);
}

// ==========================================
// 4. ADVANCED CONTENT REWRITERS
// ==========================================
function rewriteCSS(css, baseUrl, proxyHost, separator) {
    if (!css) return css;
    css = css.replace(/@import\s+(?:url\(\s*['"]?([^'")]+)['"]?\s*\)|['"]([^'"]+)['"])/gi, (m, u1, u2) => {
        const url = u1 || u2;
        if (!url || url.startsWith('data:') || url.includes('/' + separator)) return m;
        try { return m.replace(url, `https://${proxyHost}/${separator}${new URL(url.startsWith('//') ? 'https:' + url : url, baseUrl).href}`); } catch { return m; }
    });
    css = css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (m, q, url) => {
        if (!url || url.startsWith('data:') || url.startsWith('blob:') || url.includes('/' + separator)) return m;
        try { return `url(${q}https://${proxyHost}/${separator}${new URL(url.startsWith('//') ? 'https:' + url : url, baseUrl).href}${q})`; } catch { return m; }
    });
    return css;
}

function rewriteM3U8(text, baseUrl, proxyHost, separator) {
    if (!text) return text;
    return text.split('\n').map(line => {
        const trimmed = line.trim();
        if (trimmed.startsWith('#')) {
            return trimmed.replace(/URI="([^"]+)"/i, (m, url) => {
                try { return `URI="https://${proxyHost}/${separator}${new URL(url, baseUrl).href}"`; } catch { return m; }
            }).replace(/URI=([^",\s]+)/i, (m, url) => {
                try { return `URI=https://${proxyHost}/${separator}${new URL(url, baseUrl).href}`; } catch { return m; }
            });
        } else if (trimmed && !trimmed.startsWith('#')) {
            try { return `https://${proxyHost}/${separator}${new URL(trimmed, baseUrl).href}`; } catch { return line; }
        }
        return line;
    }).join('\n');
}

function rewriteMPD(text, baseUrl, proxyHost, separator) {
    if (!text) return text;
    text = text.replace(/<BaseURL>(.*?)<\/BaseURL>/gi, (m, url) => {
        try { return `<BaseURL>https://${proxyHost}/${separator}${new URL(url.trim(), baseUrl).href}</BaseURL>`; } catch { return m; }
    });
    text = text.replace(/(media|sourceURL|initialization)="([^"]+)"/gi, (m, attr, url) => {
        if (url.includes('$')) return m;
        try { return `${attr}="https://${proxyHost}/${separator}${new URL(url, baseUrl).href}"`; } catch { return m; }
    });
    return text;
}

// ==========================================
// 5. HTML REWRITER CLASSES
// ==========================================
class LinkRewriter {
    constructor(baseUrl, proxyHost, separator) { Object.assign(this, { baseUrl, proxyHost, separator }); }
    element(el) {
        el.removeAttribute('integrity');
        el.removeAttribute('crossorigin');
        if (el.tagName === 'IFRAME') el.removeAttribute('sandbox');
        const attrs = ['href', 'src', 'action', 'data', 'poster', 'xlink:href'];
        for (const attr of attrs) {
            if (el.hasAttribute(attr)) {
                const val = el.getAttribute(attr);
                if (!val || val.startsWith('data:') || val.startsWith('javascript:') || val.startsWith('blob:') || val.startsWith('#')) continue;
                if (val.includes('/' + this.separator)) continue;
                try {
                    let testVal = val;
                    if (testVal.startsWith('//')) testVal = 'https:' + testVal;
                    const abs = new URL(testVal, this.baseUrl);
                    if (PASSTHROUGH_DOMAINS.some(d => abs.host.endsWith(d) || abs.host === d)) continue;
                    let proxiedUrl = `https://${this.proxyHost}/${this.separator}${abs.origin}${abs.pathname}${abs.search}`;
                    if (el.tagName === 'IFRAME') proxiedUrl += (abs.search ? '&' : '?') + '_proxy_iframe=1';
                    proxiedUrl += abs.hash;
                    el.setAttribute(attr, proxiedUrl);
                } catch {}
            }
        }
    }
}

class SrcsetRewriter {
    constructor(baseUrl, proxyHost, separator) { Object.assign(this, { baseUrl, proxyHost, separator }); }
    element(el) {
        const srcset = el.getAttribute('srcset');
        if (!srcset) return;
        try {
            const newSrcset = srcset.split(',').map(part => {
                const [url, ...rest] = part.trim().split(/\s+/);
                if (!url || url.startsWith('data:')) return part;
                try {
                    let testUrl = url.startsWith('//') ? 'https:' + url : url;
                    return `https://${this.proxyHost}/${this.separator}${new URL(testUrl, this.baseUrl).href} ${rest.join(' ')}`.trim();
                } catch { return part; }
            }).join(', ');
            el.setAttribute('srcset', newSrcset);
        } catch {}
    }
}

class StyleRewriter {
    constructor(baseUrl, proxyHost, separator) { Object.assign(this, { baseUrl, proxyHost, separator }); }
    element(el) {
        const style = el.getAttribute('style');
        if (style) el.setAttribute('style', rewriteCSS(style, this.baseUrl, this.proxyHost, this.separator));
    }
    text(text) { text.replace(rewriteCSS(text.text, this.baseUrl, this.proxyHost, this.separator)); }
}

// ==========================================
// 6. UI PAGES
// ==========================================
// Palette — dark (default):
//   --bg      #0a0a14  black with a navy/violet undertone
//   --panel   #131226  raised surface, deep indigo
//   --line    #24223f  hairline borders
//   --text    #f1f0f8  primary text
//   --muted   #8b87a8  secondary text
//   --signal  #a78bfa  violet "beacon" accent
//   --ok      #6ee7b0  route-active green, used sparingly
//
// Palette — light:
//   --bg      #f4f3fb  soft lavender-white
//   --panel   #ffffff
//   --line    #e2dff2
//   --text    #17162a
//   --muted   #6b6788
//   --signal  #7c5cf5  deepened violet for AA contrast on white
//   --ok      #12996b
//
function getHomePage(proxyHost, separator) {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Portal — Route Anywhere</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Manrope:wght@400;500;600;700&display=swap');

:root {
  --bg: #0a0a14;
  --panel: #131226;
  --panel-hi: #17162e;
  --line: #24223f;
  --text: #f1f0f8;
  --muted: #8b87a8;
  --signal: #a78bfa;
  --signal-ink: #17102f;
  --signal-dim: rgba(167,139,250,0.16);
  --ok: #6ee7b0;
}
html[data-theme="light"] {
  --bg: #f4f3fb;
  --panel: #ffffff;
  --panel-hi: #faf9ff;
  --line: #e2dff2;
  --text: #17162a;
  --muted: #6b6788;
  --signal: #7c5cf5;
  --signal-ink: #ffffff;
  --signal-dim: rgba(124,92,245,0.12);
  --ok: #12996b;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { height: 100%; }
body {
  font-family: 'Manrope', -apple-system, sans-serif;
  background: var(--bg);
  color: var(--text);
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  overflow: hidden;
  padding: 24px;
  transition: background 0.25s ease, color 0.25s ease;
}
.mono { font-family: 'IBM Plex Mono', ui-monospace, monospace; }

/* ---- theme toggle ---- */
.theme-toggle {
  position: fixed;
  top: 22px; right: 22px;
  z-index: 20;
  width: 42px; height: 42px;
  display: flex; align-items: center; justify-content: center;
  background: var(--panel-hi);
  border: 1.5px solid var(--signal);
  border-radius: 11px;
  color: var(--signal);
  cursor: pointer;
  box-shadow: 0 4px 16px rgba(0,0,0,0.35);
  transition: all 0.18s ease;
}
.theme-toggle:hover { color: var(--signal-ink); background: var(--signal); }
.theme-toggle svg { width: 19px; height: 19px; display: block; }
.theme-toggle .sun { display: none; }
html[data-theme="light"] .theme-toggle .moon { display: none; }
html[data-theme="light"] .theme-toggle .sun { display: block; }

/* ---- background route field ---- */
.route-field {
  position: absolute;
  inset: 0;
  z-index: 0;
  opacity: 0.55;
}
html[data-theme="light"] .route-field { opacity: 0.4; }
.route-field svg { width: 100%; height: 100%; }
.route-path { fill: none; stroke: var(--line); stroke-width: 1; }
.route-node { fill: var(--line); }
.route-node.active { fill: var(--signal); }
.packet { fill: var(--signal); filter: drop-shadow(0 0 6px rgba(167,139,250,0.7)); }

/* ---- layout ---- */
.wrap { position: relative; z-index: 1; width: 100%; max-width: 640px; }

.eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 0.72rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--muted);
  margin-bottom: 22px;
}
.eyebrow .dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--ok);
  box-shadow: 0 0 8px rgba(110,231,176,0.9);
}

h1 {
  font-size: clamp(2.4rem, 6vw, 3.4rem);
  font-weight: 700;
  letter-spacing: -0.03em;
  line-height: 1.05;
  margin-bottom: 14px;
}
h1 span { color: var(--muted); font-weight: 500; }

.sub {
  color: var(--muted);
  font-size: 1rem;
  line-height: 1.5;
  max-width: 46ch;
  margin-bottom: 40px;
}

/* ---- address bar ---- */
.bar {
  display: flex;
  align-items: stretch;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 6px;
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}
.bar:focus-within { border-color: var(--signal); box-shadow: 0 0 0 3px var(--signal-dim); }
.bar-flag {
  display: flex;
  align-items: center;
  padding: 0 16px;
  color: var(--muted);
  font-size: 0.82rem;
  border-right: 1px solid var(--line);
  white-space: nowrap;
  user-select: none;
}
input {
  flex: 1;
  min-width: 0;
  background: transparent;
  border: none;
  outline: none;
  color: var(--text);
  font-size: 1.02rem;
  padding: 14px 16px;
  font-family: 'IBM Plex Mono', ui-monospace, monospace;
}
input::placeholder { color: var(--muted); opacity: 0.6; }

button {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--signal);
  color: var(--signal-ink);
  border: none;
  border-radius: 9px;
  padding: 0 22px;
  font-weight: 700;
  font-size: 0.92rem;
  cursor: pointer;
  transition: transform 0.15s ease, filter 0.15s ease;
}
button:hover { filter: brightness(1.08); transform: translateY(-1px); }
button:active { transform: translateY(0); }
button svg { width: 15px; height: 15px; }

/* ---- shortcuts ---- */
.hops { display: flex; align-items: center; gap: 10px; margin-top: 34px; flex-wrap: wrap; }
.hops .label {
  font-size: 0.72rem;
  color: var(--muted);
  opacity: 0.75;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  margin-right: 4px;
}
.hops a {
  color: var(--muted);
  text-decoration: none;
  font-size: 0.86rem;
  padding: 7px 14px;
  border: 1px solid var(--line);
  border-radius: 99px;
  transition: all 0.18s ease;
}
.hops a:hover { color: var(--text); border-color: var(--signal); background: var(--signal-dim); }

@media (max-width: 520px) {
  .bar { flex-direction: column; gap: 8px; }
  .bar-flag { border-right: none; border-bottom: 1px solid var(--line); padding: 10px 12px; }
  button { padding: 12px; justify-content: center; }
  .theme-toggle { top: 16px; right: 16px; }
}
@media (prefers-reduced-motion: reduce) {
  .packet, .route-node.active { animation: none !important; }
}
</style>
</head>
<body>

<button class="theme-toggle" id="themeToggle" aria-label="Toggle theme" type="button">
  <svg class="moon" width="19" height="19" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <path fill="currentColor" d="M12.3 2.5c.3 0 .6.2.5.5-.7 4 1.9 8 6 8.7.3.1.4.5.1.7A9.5 9.5 0 1 1 11.6 2.6c.2-.1.5-.1.7-.1z"/>
  </svg>
  <svg class="sun" width="19" height="19" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <circle cx="12" cy="12" r="4.5" fill="currentColor"/>
    <g fill="currentColor">
      <rect x="11" y="1" width="2" height="4" rx="1"/>
      <rect x="11" y="19" width="2" height="4" rx="1"/>
      <rect x="1" y="11" width="4" height="2" rx="1"/>
      <rect x="19" y="11" width="4" height="2" rx="1"/>
      <rect x="3.5" y="3.5" width="2" height="4" rx="1" transform="rotate(-45 4.5 5.5)"/>
      <rect x="18.5" y="16.5" width="2" height="4" rx="1" transform="rotate(-45 19.5 18.5)"/>
      <rect x="16.5" y="3.5" width="2" height="4" rx="1" transform="rotate(45 17.5 5.5)"/>
      <rect x="3.5" y="16.5" width="2" height="4" rx="1" transform="rotate(45 4.5 18.5)"/>
    </g>
  </svg>
</button>

<div class="route-field" aria-hidden="true">
  <svg viewBox="0 0 900 600" preserveAspectRatio="xMidYMid slice">
    <path id="p1" class="route-path" d="M -50,120 C 150,80 250,220 450,180 S 750,60 950,140" />
    <path id="p2" class="route-path" d="M -50,420 C 200,460 300,320 500,380 S 800,500 950,440" />
    <circle class="route-node" cx="150" cy="98" r="3"></circle>
    <circle class="route-node active" cx="450" cy="180" r="3.5"></circle>
    <circle class="route-node" cx="700" cy="90" r="3"></circle>
    <circle class="route-node" cx="300" cy="330" r="3"></circle>
    <circle class="route-node active" cx="560" cy="392" r="3.5"></circle>
    <circle class="route-node" cx="800" cy="470" r="3"></circle>
    <circle class="packet" r="3.2">
      <animateMotion dur="7s" repeatCount="indefinite" begin="0s">
        <mpath href="#p1"></mpath>
      </animateMotion>
    </circle>
    <circle class="packet" r="3.2">
      <animateMotion dur="9s" repeatCount="indefinite" begin="1.5s">
        <mpath href="#p2"></mpath>
      </animateMotion>
    </circle>
  </svg>
</div>

<div class="wrap">
  <div class="eyebrow"><span class="dot"></span><span class="mono">route status: active</span></div>
  <h1>Get there<br><span>through the portal.</span></h1>
  <p class="sub">Enter any address below. Traffic is routed through Portal so the destination sees us, not you.</p>

  <form class="bar" onsubmit="navigate(event)">
    <span class="bar-flag mono">https://</span>
    <input type="text" id="url" placeholder="youtube.com" autofocus autocomplete="off" spellcheck="false">
    <button type="submit">
      Go
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
    </button>
  </form>

  <div class="hops">
    <span class="label mono">quick hops</span>
    <a href="/${separator}https://wikipedia.org/">Wikipedia</a>
    <a href="/${separator}https://reddit.com/">Reddit</a>
	<a href="/${separator}https://ext.to/">ExtTo</a>
    <a href="/${separator}https://browserleaks.com/ip">BrowserLeaks</a>
  </div>
</div>

<script>
(function() {
  const root = document.documentElement;
  const saved = localStorage.getItem('portal-theme');
  const preferred = saved || (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  root.setAttribute('data-theme', preferred);
  document.getElementById('themeToggle').addEventListener('click', function() {
    const next = root.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    root.setAttribute('data-theme', next);
    localStorage.setItem('portal-theme', next);
  });
})();

function navigate(e) {
    e.preventDefault();
    const field = document.getElementById('url');
    let val = field.value.trim();
    if (!val) return;
    if (!val.startsWith('http://') && !val.startsWith('https://')) {
        if (val.includes('.') && !val.includes(' ')) val = 'https://' + val;
        else { field.focus(); return; }
    }
    window.location.href = '/${separator}' + val;
}
</script>
</body>
</html>`;
    return new Response(html, { headers: { 'Content-Type': 'text/html;charset=UTF-8', 'Cache-Control': 'no-cache' } });
}

function getLoginPage(error = false) {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Portal — Access</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Manrope:wght@400;500;600;700&display=swap');

:root {
  --bg: #0a0a14;
  --panel: #131226;
  --field: #0e0d1c;
  --line: #24223f;
  --text: #f1f0f8;
  --muted: #8b87a8;
  --signal: #a78bfa;
  --signal-ink: #17102f;
  --signal-dim: rgba(167,139,250,0.16);
  --err: #f0768a;
  --err-dim: rgba(240,118,138,0.12);
}
html[data-theme="light"] {
  --bg: #f4f3fb;
  --panel: #ffffff;
  --field: #f7f6fd;
  --line: #e2dff2;
  --text: #17162a;
  --muted: #6b6788;
  --signal: #7c5cf5;
  --signal-ink: #ffffff;
  --signal-dim: rgba(124,92,245,0.12);
  --err: #d63d5c;
  --err-dim: rgba(214,61,92,0.08);
}
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { height: 100%; }
body {
  font-family: 'Manrope', -apple-system, sans-serif;
  background: var(--bg);
  color: var(--text);
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  position: relative;
  transition: background 0.25s ease, color 0.25s ease;
}
.mono { font-family: 'IBM Plex Mono', ui-monospace, monospace; }

.theme-toggle {
  position: fixed;
  top: 22px; right: 22px;
  z-index: 20;
  width: 42px; height: 42px;
  display: flex; align-items: center; justify-content: center;
  background: var(--panel);
  border: 1.5px solid var(--signal);
  border-radius: 11px;
  color: var(--signal);
  cursor: pointer;
  box-shadow: 0 4px 16px rgba(0,0,0,0.35);
  transition: all 0.18s ease;
}
.theme-toggle:hover { color: var(--signal-ink); background: var(--signal); }
.theme-toggle svg { width: 19px; height: 19px; display: block; }
.theme-toggle .sun { display: none; }
html[data-theme="light"] .theme-toggle .moon { display: none; }
html[data-theme="light"] .theme-toggle .sun { display: block; }

.card {
  width: 100%;
  max-width: 380px;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 18px;
  padding: 38px 34px;
}

.badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px; height: 40px;
  border-radius: 10px;
  background: var(--signal-dim);
  color: var(--signal);
  margin-bottom: 20px;
}
.badge svg { width: 20px; height: 20px; }

h1 { font-size: 1.5rem; font-weight: 700; letter-spacing: -0.02em; margin-bottom: 6px; }
.sub { color: var(--muted); font-size: 0.9rem; margin-bottom: 26px; }

.err {
  display: ${error ? 'flex' : 'none'};
  align-items: center;
  gap: 8px;
  background: var(--err-dim);
  color: var(--err);
  border: 1px solid rgba(240,118,138,0.25);
  padding: 11px 14px;
  border-radius: 10px;
  font-size: 0.85rem;
  margin-bottom: 22px;
}

.field { margin-bottom: 18px; }
label {
  display: block;
  font-size: 0.72rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
  margin-bottom: 8px;
}
input {
  width: 100%;
  padding: 12px 14px;
  background: var(--field);
  border: 1px solid var(--line);
  border-radius: 10px;
  color: var(--text);
  font-size: 0.95rem;
  outline: none;
  transition: border-color 0.18s ease, box-shadow 0.18s ease;
}
input:focus { border-color: var(--signal); box-shadow: 0 0 0 3px var(--signal-dim); }

button {
  width: 100%;
  padding: 13px;
  background: var(--signal);
  color: var(--signal-ink);
  border: none;
  border-radius: 10px;
  font-weight: 700;
  font-size: 0.95rem;
  cursor: pointer;
  margin-top: 6px;
  transition: transform 0.15s ease, filter 0.15s ease;
}
button:hover { filter: brightness(1.08); transform: translateY(-1px); }
button:active { transform: translateY(0); }

.foot { margin-top: 20px; text-align: center; font-size: 0.76rem; color: var(--muted); opacity: 0.8; }

@media (max-width: 460px) {
  .theme-toggle { top: 16px; right: 16px; }
}
</style>
</head>
<body>
<button class="theme-toggle" id="themeToggle" aria-label="Toggle theme" type="button">
  <svg class="moon" width="19" height="19" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <path fill="currentColor" d="M12.3 2.5c.3 0 .6.2.5.5-.7 4 1.9 8 6 8.7.3.1.4.5.1.7A9.5 9.5 0 1 1 11.6 2.6c.2-.1.5-.1.7-.1z"/>
  </svg>
  <svg class="sun" width="19" height="19" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <circle cx="12" cy="12" r="4.5" fill="currentColor"/>
    <g fill="currentColor">
      <rect x="11" y="1" width="2" height="4" rx="1"/>
      <rect x="11" y="19" width="2" height="4" rx="1"/>
      <rect x="1" y="11" width="4" height="2" rx="1"/>
      <rect x="19" y="11" width="4" height="2" rx="1"/>
      <rect x="3.5" y="3.5" width="2" height="4" rx="1" transform="rotate(-45 4.5 5.5)"/>
      <rect x="18.5" y="16.5" width="2" height="4" rx="1" transform="rotate(-45 19.5 18.5)"/>
      <rect x="16.5" y="3.5" width="2" height="4" rx="1" transform="rotate(45 17.5 5.5)"/>
      <rect x="3.5" y="16.5" width="2" height="4" rx="1" transform="rotate(45 4.5 18.5)"/>
    </g>
  </svg>
</button>

<form class="card" method="POST" action="/login">
  <div class="badge">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="10" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
  </div>
  <h1>Unlock Portal</h1>
  <p class="sub">Sign in to start routing traffic.</p>

  <div class="err">
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>
    Invalid credentials. Please try again.
  </div>

  <div class="field">
    <label>Username</label>
    <input type="text" name="username" required autofocus autocomplete="username">
  </div>
  <div class="field">
    <label>Password</label>
    <input type="password" name="password" required autocomplete="current-password">
  </div>

  <button type="submit">Enter</button>
  <p class="foot mono">connection secured · no traffic logged</p>
</form>

<script>
(function() {
  const root = document.documentElement;
  const saved = localStorage.getItem('portal-theme');
  const preferred = saved || (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  root.setAttribute('data-theme', preferred);
  document.getElementById('themeToggle').addEventListener('click', function() {
    const next = root.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    root.setAttribute('data-theme', next);
    localStorage.setItem('portal-theme', next);
  });
})();
</script>
</body>
</html>`;
    return new Response(html, { headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
}

// ==========================================
// 7. MAIN WORKER LOGIC
// ==========================================
export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const proxyHost = url.host;
        const { separator } = CONFIG;

        // 1. Login Handling
        if (url.pathname === '/login') {
            if (request.method === 'POST') {
                const form = await request.formData();
                const u = form.get('username') || '';
                const p = form.get('password') || '';
                if (u === (env.PROXY_USER || '') && p === (env.PROXY_PASS || '')) {
                    return new Response(null, {
                        status: 302,
                        headers: {
                            'Location': '/',
                            'Set-Cookie': `proxy_session=${getAuthToken(env)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${CONFIG.sessionMaxAge}`
                        }
                    });
                }
                return getLoginPage(true);
            }
            return getLoginPage(false);
        }

        // 2. Auth Check
        if (!authenticate(request, env)) {
            if (request.method === 'GET' && request.headers.get('Accept')?.includes('text/html')) {
                return Response.redirect(`${url.origin}/login`, 302);
            }
            return new Response('Unauthorized', { status: 401 });
        }

        // 3. Homepage
        if (url.pathname === '/' && !url.search) {
            return getHomePage(proxyHost, separator);
        }

        // 4. Target URL Resolution
        let targetUrlStr = extractTargetUrl(url.pathname, separator);
        if (!targetUrlStr) return new Response('Invalid Proxy URL.', { status: 400 });

        // Append query parameters from the proxy request to the target URL.
        // url.pathname does NOT include the query string (e.g., ?topic=123), which causes
        // forums to drop topic IDs and show "The requested topic does not exist."
        let fullTargetStr = targetUrlStr + url.search;

        // Clean up proxy-specific params that shouldn't be sent to the origin
        try {
            let cleanUrl = new URL(fullTargetStr);
            cleanUrl.searchParams.delete('_proxy_iframe');
            fullTargetStr = cleanUrl.href;
        } catch(e) {}

        let targetUrl;
        try { 
            targetUrl = new URL(fullTargetStr); 
        } catch { 
            return new Response('Invalid Target URL', { status: 400 }); 
        }

        // 5. Build Proxied Request
        const newHeaders = new Headers();
        const keepHeaders = ['cookie', 'range', 'if-none-match', 'if-modified-since', 'content-type', 'content-length'];
        for (const h of keepHeaders) if (request.headers.has(h)) newHeaders.set(h, request.headers.get(h));
        const passThrough = ['accept', 'accept-language', 'sec-fetch-dest', 'sec-fetch-mode', 'sec-fetch-site', 'sec-fetch-user', 'sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform'];
        for (const h of passThrough) if (request.headers.has(h)) newHeaders.set(h, request.headers.get(h));
        
        // Remove Accept-Encoding so origin sends uncompressed HTML/CSS/JS.
        newHeaders.delete('accept-encoding');

        const emu = CONFIG.browserEmulation;
        if (!newHeaders.has('User-Agent')) newHeaders.set('User-Agent', emu.userAgent);
        if (!newHeaders.has('Accept')) newHeaders.set('Accept', emu.accept);
        newHeaders.set('Host', targetUrl.host);

        // YouTube Referer/Origin issues
        if (targetUrl.host.includes('googlevideo.com') || targetUrl.host.includes('ytimg.com') || targetUrl.host.includes('youtube.com')) {
            newHeaders.set('Referer', 'https://www.youtube.com/');
            newHeaders.set('Origin', 'https://www.youtube.com');
        } else {
            newHeaders.set('Referer', targetUrl.href);
            newHeaders.set('Origin', targetUrl.origin);
        }

        const proxiedReq = new Request(targetUrl, {
            method: request.method,
            headers: newHeaders,
            body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : null,
            redirect: 'manual'
        });

        // 6. Fetch & Cache Check
        const cache = caches.default;
        const cacheKey = new Request(request.url, request);
        let response = await cache.match(cacheKey);

        if (!response) {
            response = await fetch(proxiedReq);
            let respHeaders = new Headers(response.headers);

            // Handle Redirects
            if ([301, 302, 303, 307, 308].includes(response.status)) {
                const loc = respHeaders.get('Location');
                if (loc) {
                    try {
                        const absLoc = new URL(loc, targetUrl);
                        respHeaders.set('Location', `https://${proxyHost}/${separator}${absLoc.href}`);
                    } catch {}
                }
            }

            // Strip Security Headers
            const stripHeaders = ['content-security-policy', 'content-security-policy-report-only', 'x-frame-options', 'x-content-type-options', 'strict-transport-security', 'referrer-policy', 'cross-origin-resource-policy', 'cross-origin-embedder-policy', 'cross-origin-opener-policy', 'permissions-policy'];
            stripHeaders.forEach(h => respHeaders.delete(h));

            // CORS
            respHeaders.set('Access-Control-Allow-Origin', '*');
            respHeaders.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
            respHeaders.set('Access-Control-Allow-Headers', '*');

            // Path-based Cookie Isolation
            const setCookies = respHeaders.getSetCookie ? respHeaders.getSetCookie() : [];
            if (setCookies && setCookies.length > 0) {
                respHeaders.delete('Set-Cookie');
                const targetPath = `/${separator}${targetUrl.origin}/`;
                setCookies.forEach(cookie => {
                    if (!cookie) return;
                    let newCookie = cookie.replace(/Domain=[^;]+;?/gi, '').replace(/Secure;?/gi, '');
                    if (!/Path=/i.test(newCookie)) {
                        newCookie += `; Path=${targetPath}`;
                    } else {
                        newCookie = newCookie.replace(/Path=[^;]+/i, `Path=${targetPath}`);
                    }
                    if (!/SameSite=/i.test(newCookie)) newCookie += '; SameSite=Lax';
                    respHeaders.append('Set-Cookie', newCookie);
                });
            }

            const contentType = respHeaders.get('Content-Type') || '';
            const lowerUrl = targetUrl.pathname.toLowerCase();

            // Detect CF Challenge to handle it specially
            const isCfChallenge = (response.status === 403 || response.status === 503) &&
                (respHeaders.get('server')?.startsWith('cloudflare') || targetUrl.pathname.includes('/cdn-cgi/'));

            // Check if request is for an iframe (to skip JS injection)
            const isIframe = url.searchParams.has('_proxy_iframe');

            let finalBody = response.body;
            let bodyModified = false;

            // HTML Rewriting
            if (contentType.includes('text/html') || contentType.includes('application/xhtml+xml')) {
                try {
                    const rewriter = new HTMLRewriter()
                        .on('base', { element(el) { el.remove(); } }) // Remove base tag to fix relative URLs
                        .on('meta[http-equiv]', {
                            element(el) {
                                const equiv = el.getAttribute('http-equiv');
                                if (equiv && (equiv.toLowerCase().includes('content-security-policy') || equiv.toLowerCase().includes('x-ua-compatible'))) el.remove();
                            }
                        })
                        .on('a[href], link[href], script[src], img[src], iframe[src], form[action], video[src], audio[src], source[src], embed[src], object[data], track[src]', new LinkRewriter(targetUrl, proxyHost, separator))
                        .on('img[data-src], img[data-lazy-src], img[data-original], img[data-retina], div[data-bg], *[data-background]', {
                            element(el) {
                                const attrs = ['data-src', 'data-lazy-src', 'data-original', 'data-retina', 'data-bg', 'data-background'];
                                for (const attr of attrs) {
                                    const val = el.getAttribute(attr);
                                    if (val && typeof val === 'string' && !val.startsWith('data:') && !val.includes('/' + separator)) {
                                        try { el.setAttribute(attr, `https://${proxyHost}/${separator}${new URL(val, targetUrl).href}`); } catch {}
                                    }
                                }
                            }
                        })
                        .on('img[srcset], source[srcset]', new SrcsetRewriter(targetUrl, proxyHost, separator))
                        .on('*[style]', new StyleRewriter(targetUrl, proxyHost, separator))
                        .on('style', { text(text) { text.replace(rewriteCSS(text.text, targetUrl, proxyHost, separator)); } })
                        .on('script', {
                            text(textChunk) {
                                // ONLY rewrite script text for CF Challenges where JS_INJECTION is skipped
                                if (isCfChallenge) {
                                    let content = textChunk.text;
                                    content = content.replace(/(["'])(https?:\/\/[^"']+)\1/g, (match, quote, url) => {
                                        if (url.includes('/' + separator)) return match;
                                        try {
                                            const abs = new URL(url, targetUrl);
                                            if (PASSTHROUGH_DOMAINS.some(d => abs.host.endsWith(d))) return match;
                                            return `${quote}https://${proxyHost}/${separator}${abs.href}${quote}`;
                                        } catch { return match; }
                                    });
                                    content = content.replace(/(["'])(\/cdn-cgi\/[^"']+)\1/g, (match, quote, path) => {
                                        return `${quote}/${separator}${targetUrl.origin}${path}${quote}`;
                                    });
                                    textChunk.replace(content);
                                }
                            }
                        });

                    // Only inject JS if NOT a CF challenge and NOT an iframe
                    if (!isCfChallenge && !isIframe) {
                        rewriter.on('head', { element(el) { el.prepend(JS_INJECTION, { html: true }); } });
                    }

                    finalBody = rewriter.transform(response).body;
                    bodyModified = true;
                } catch (e) {
                    finalBody = response.body; // Fallback if rewriting fails
                }
            }
            // CSS Rewriting
            else if (contentType.includes('text/css')) {
                try {
                    const text = await response.text();
                    finalBody = rewriteCSS(text, targetUrl, proxyHost, separator);
                    bodyModified = true;
                } catch {}
            }
            // HLS (m3u8) Rewriting
            else if (contentType.includes('application/vnd.apple.mpegurl') || contentType.includes('application/x-mpegurl') || lowerUrl.endsWith('.m3u8')) {
                try {
                    const text = await response.text();
                    finalBody = rewriteM3U8(text, targetUrl, proxyHost, separator);
                    bodyModified = true;
                } catch {}
            }
            // DASH (mpd) Rewriting
            else if (contentType.includes('application/dash+xml') || lowerUrl.endsWith('.mpd')) {
                try {
                    const text = await response.text();
                    finalBody = rewriteMPD(text, targetUrl, proxyHost, separator);
                    bodyModified = true;
                } catch {}
            }

            if (bodyModified) {
                respHeaders.delete('Content-Encoding');
                respHeaders.delete('Content-Length');
            }

            const finalResponse = new Response(finalBody, {
                status: response.status,
                statusText: response.statusText,
                headers: respHeaders
            });

            // Cache Static Assets
            if (request.method === 'GET' && response.status === 200 && !bodyModified) {
                if (contentType.startsWith('image/') || contentType.startsWith('font/') || contentType.startsWith('video/') || contentType.startsWith('audio/') || contentType.includes('javascript') || contentType.includes('text/css')) {
                    ctx.waitUntil(cache.put(cacheKey, finalResponse.clone()));
                }
            }
            response = finalResponse;
        }

        if (!response.headers.has('Cache-Control')) {
            response.headers.set('Cache-Control', `public, max-age=${CONFIG.cacheTTL}`);
        }

        return response;
    }
};
