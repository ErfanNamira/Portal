// ================================================================
// Configuration
// ================================================================
const config = {
  proxyDomains: ['portal-proxy.your-username.workers.dev', 'sub.mydomain.com'],
  separator: '------',
  homepage: true,
  allowedDomains: [],
  browserEmulation: {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    acceptLanguage: 'en-US,en;q=0.9',
    acceptEncoding: 'gzip, deflate, br, zstd',
    connection: 'keep-alive',
    upgradeInsecureRequests: '1',
    secFetchDest: 'document',
    secFetchMode: 'navigate',
    secFetchSite: 'none',
    secFetchUser: '?1',    
    'sec-ch-ua': '"Google Chrome";v="150", "Not?A_Brand";v="99", "Chromium";v="150"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
  },
  fallback: {
    enabled: true,
    autoReload: true,
  },
  specialSites: {
    wikipedia: {
      enabled: true,
      domains: ['wikipedia.org', 'wikimedia.org', 'mediawiki.org'],
    },
  },
  rewriteCSS: true,
  rewriteJS: true,
  cacheTTL: 3600,
  debug: false,
};

// ================================================================
// Authentication Helpers
// ================================================================
function getCookie(request, name) {
  const cookieString = request.headers.get('Cookie');
  if (cookieString) {
    const cookies = cookieString.split(';');
    for (let cookie of cookies) {
      const [cookieName, cookieVal] = cookie.split('=');
      if (cookieName.trim() === name) return cookieVal;
    }
  }
  return null;
}

function getAuthToken() {
  const u = typeof PROXY_USER !== 'undefined' ? PROXY_USER : '';
  const p = typeof PROXY_PASS !== 'undefined' ? PROXY_PASS : '';
  return btoa(u + ':' + p);
}

function authenticate(request) {
  // 1. Check for valid session cookie
  if (getCookie(request, 'proxy_session') === getAuthToken()) {
    return true;
  }
  
  // 2. Fallback to basic auth
  const authHeader = request.headers.get('Authorization');
  if (authHeader && authHeader.startsWith('Basic ')) {
    const base64 = authHeader.slice(6);
    const credentials = atob(base64);
    const [user, pass] = credentials.split(':');
    const expectedUser = typeof PROXY_USER !== 'undefined' ? PROXY_USER : '';
    const expectedPass = typeof PROXY_PASS !== 'undefined' ? PROXY_PASS : '';
    return user === expectedUser && pass === expectedPass;
  }
  
  return false;
}

// ================================================================
// Helpers
// ================================================================
function extractInnerFromReferer(request, url, separator) {
  const ref = request.headers.get('Referer') || '';
  if (!ref.startsWith(`https://${url.host}/`)) return null;
  let inner = ref.substring(`https://${url.host}/`.length);
  if (inner.startsWith(separator)) inner = inner.substring(separator.length);
  if (inner.startsWith('http://') || inner.startsWith('https://')) return inner;
  return null;
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
}

// Conditional logging (only when debug is true)
function log(...args) {
  if (config.debug) console.log(...args);
}

// ================================================================
// Main handler
// ================================================================
async function handleRequest(request, event) {
  const url = new URL(request.url);
  const isProxyHost = config.proxyDomains.includes(url.host);

  // ----- Login & Session Handling -----
  if (isProxyHost && url.pathname === '/login') {
    if (request.method === 'POST') {
      let user = '', pass = '';
      try {
        const formData = await request.formData();
        user = formData.get('username') || '';
        pass = formData.get('password') || '';
      } catch (e) {
        log('Failed to parse form data', e);
      }
      
      const expectedUser = typeof PROXY_USER !== 'undefined' ? PROXY_USER : '';
      const expectedPass = typeof PROXY_PASS !== 'undefined' ? PROXY_PASS : '';
      const redirectUrl = url.searchParams.get('redirect') || '/';

      if (user === expectedUser && pass === expectedPass) {
        const token = getAuthToken();
        return new Response('', {
          status: 302,
          headers: {
            'Location': redirectUrl,
            'Set-Cookie': `proxy_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000` // 30 days
          }
        });
      } else {
        const errorUrl = new URL('/login', request.url);
        errorUrl.searchParams.set('error', '1');
        if (redirectUrl !== '/') errorUrl.searchParams.set('redirect', redirectUrl);
        return Response.redirect(errorUrl.href, 302);
      }
    } else {
      // Serve GET request for Login page
      return serveLoginPage(url.searchParams.get('redirect') || '');
    }
  }

  // ----- Authentication Check -----
  if (!authenticate(request)) {
    if (isProxyHost && request.method === 'GET') {
      // Redirect unauthenticated HTML GET requests to the beautiful login page
      const redirectTarget = url.pathname !== '/' || url.search !== '' ? url.pathname + url.search : '';
      const loginUrl = new URL('/login', request.url);
      if (redirectTarget) loginUrl.searchParams.set('redirect', redirectTarget);
      return Response.redirect(loginUrl.href, 302);
    }
    // Return 401 for everything else (like media, API, or cross-domain issues)
    return new Response('Unauthorized', { status: 401 });
  }

  // ----- Homepage handling -----
  if (isProxyHost && url.pathname === '/') {
    if (config.homepage && !url.search) return getHomePage();
    if (url.search) {
      const inner = extractInnerFromReferer(request, url, config.separator);
      if (inner) {
        try {
          const base = new URL(inner);
          const targetStr = `${base.origin}${url.search}`;
          url.pathname = '/' + config.separator + targetStr;
        } catch (_) {}
      }
    }
  }

  let targetURL;
  try {
    if (isProxyHost) {
      if (url.pathname === '/proxy' && url.searchParams.has('url')) {
        targetURL = new URL(url.searchParams.get('url'));
      } else if (url.pathname.startsWith('/')) {
        const rawPath = url.pathname.substring(1);
        let path = rawPath;
        if (rawPath.startsWith(config.separator)) {
          path = rawPath.substring(config.separator.length);
        }
        if (path.startsWith('http://') || path.startsWith('https://')) {
          targetURL = new URL(path);
        } else if (path) {
          let resolved = null;
          const refInner = extractInnerFromReferer(request, url, config.separator);
          if (refInner) {
            try {
              const baseRef = new URL(refInner);
              resolved = new URL(path, baseRef);
            } catch {}
          }
          if (resolved) {
            targetURL = resolved;
          } else {
            if (url.searchParams.has('q')) {
              const ddg = new URL('https://duckduckgo.com/');
              url.searchParams.forEach((v, k) => ddg.searchParams.append(k, v));
              targetURL = ddg;
            } else if (!path.includes('.') && url.search === '') {
              targetURL = new URL('https://duckduckgo.com/?q=' + encodeURIComponent(path));
            } else if (!path.includes('.')) {
              const ddg = new URL('https://duckduckgo.com/?q=' + encodeURIComponent(path) + '&' + url.search.substring(1));
              targetURL = ddg;
            } else {
              targetURL = new URL('https://' + path);
            }
          }
        } else {
          if (url.searchParams.has('q')) {
            const ddg = new URL('https://duckduckgo.com/');
            url.searchParams.forEach((v, k) => ddg.searchParams.append(k, v));
            targetURL = ddg;
          } else {
            return new Response('Invalid URL request', { status: 400 });
          }
        }
      }
    } else {
      targetURL = url;
    }

    if (config.allowedDomains.length > 0) {
      const isAllowed = config.allowedDomains.some(domain =>
        targetURL.hostname === domain || targetURL.hostname.endsWith(`.${domain}`)
      );
      if (!isAllowed) {
        return new Response('Domain not in whitelist', { status: 403 });
      }
    }
  } catch (error) {
    return new Response(`URL parsing error: ${escapeHtml(error.message)}`, {
      status: 400,
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
    });
  }

  const isWikipediaSite = config.specialSites.wikipedia.enabled &&
    config.specialSites.wikipedia.domains.some(domain => targetURL.hostname.endsWith(domain));
    
  // ----- Build request headers -----
  const newHeaders = new Headers();
  const headersToKeep = ['cookie', 'range', 'if-none-match', 'if-modified-since', 'content-type', 'content-length'];
  for (const h of headersToKeep) {
    if (request.headers.has(h)) newHeaders.set(h, request.headers.get(h));
  }

  const emu = config.browserEmulation;
  newHeaders.set('User-Agent', emu.userAgent);
  newHeaders.set('Accept', emu.accept);
  newHeaders.set('Accept-Language', emu.acceptLanguage);
  newHeaders.set('Accept-Encoding', emu.acceptEncoding);
  newHeaders.set('Connection', emu.connection);
  newHeaders.set('Upgrade-Insecure-Requests', emu.upgradeInsecureRequests);
  newHeaders.set('Sec-Fetch-Dest', emu.secFetchDest);
  newHeaders.set('Sec-Fetch-Mode', emu.secFetchMode);
  newHeaders.set('Sec-Fetch-Site', emu.secFetchSite);
  newHeaders.set('Sec-Fetch-User', emu.secFetchUser);
  newHeaders.set('Host', targetURL.host);
  newHeaders.set('Origin', targetURL.origin);
  newHeaders.set('Referer', targetURL.href);
  
  if (request.headers.get('X-Requested-With') === 'XMLHttpRequest' ||
      request.headers.get('Accept')?.includes('application/json')) {
    newHeaders.set('X-Requested-With', 'XMLHttpRequest');
  }

  const newRequest = new Request(targetURL, {
    method: request.method,
    headers: newHeaders,
    body: (request.method !== 'GET' && request.method !== 'HEAD') ? request.body : null,
    redirect: 'manual',
  });
  
  // ----- Caching check -----
  const cache = caches.default;
  const cacheKey = new Request(request.url, request);
  let cachedResponse = await cache.match(cacheKey);
  if (cachedResponse) {
    log('Cache hit for', request.url);
    return cachedResponse;
  }

  log('Cache miss for', request.url);

  try {
    let response = await fetch(newRequest);
    
    // ----- Handle redirects -----
    const respHeaders = new Headers(response.headers);
    if ([301, 302, 307, 308].includes(response.status)) {
      const location = respHeaders.get('Location');
      if (location) {
        try {
          const redirectURL = new URL(location, targetURL);
          const newLocation = `https://${url.host}/${config.separator}${redirectURL.href}`;
          respHeaders.set('Location', newLocation);
        } catch (_) {}
      }
    }

    // ----- Remove security headers that break proxying -----
    respHeaders.delete('Content-Security-Policy');
    respHeaders.delete('Content-Security-Policy-Report-Only');
    respHeaders.delete('X-Frame-Options');
    respHeaders.delete('X-Content-Type-Options');
    respHeaders.set('Access-Control-Allow-Origin', '*');
    respHeaders.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
    respHeaders.set('Access-Control-Allow-Headers', '*');
    respHeaders.set('Access-Control-Allow-Credentials', 'true');
    const contentType = respHeaders.get('Content-Type') || '';

    // ----- Process response body -----
    let finalResponse;
	// HTML: stream rewrite via HTMLRewriter
    if (contentType.includes('text/html') || contentType.includes('application/xhtml+xml')) {
      const currentProxyDomain = url.host;
      let rewriter = new HTMLRewriter()
        .on('a[href]', new LinkRewriter(targetURL, 'href', currentProxyDomain))
        .on('form[action]', new LinkRewriter(targetURL, 'action', currentProxyDomain))
        .on('img[src]', new LinkRewriter(targetURL, 'src', currentProxyDomain))
        .on('img[srcset]', new SrcsetRewriter(targetURL, currentProxyDomain))
        .on('img[data-src]', new LinkRewriter(targetURL, 'data-src', currentProxyDomain))
        .on('img[data-lazy-src]', new LinkRewriter(targetURL, 'data-lazy-src', currentProxyDomain))
        .on('source[srcset]', new SrcsetRewriter(targetURL, currentProxyDomain))
        .on('link[href]', new LinkRewriter(targetURL, 'href', currentProxyDomain))
        .on('script[src]', new LinkRewriter(targetURL, 'src', currentProxyDomain))
        .on('iframe[src]', new LinkRewriter(targetURL, 'src', currentProxyDomain))
        .on('source[src]', new LinkRewriter(targetURL, 'src', currentProxyDomain))
        .on('video[src]', new LinkRewriter(targetURL, 'src', currentProxyDomain))
        .on('audio[src]', new LinkRewriter(targetURL, 'src', currentProxyDomain))
        .on('embed[src]', new LinkRewriter(targetURL, 'src', currentProxyDomain))
        .on('object[data]', new LinkRewriter(targetURL, 'data', currentProxyDomain))
        .on('track[src]', new LinkRewriter(targetURL, 'src', currentProxyDomain))
        .on('meta[content]', new MetaContentRewriter(targetURL, currentProxyDomain))
        .on('base[href]', new BaseTagRewriter(targetURL, currentProxyDomain))
        .on('*[style]', new StyleAttributeRewriter(targetURL, currentProxyDomain));

      if (isWikipediaSite) {
        rewriter = rewriter
          .on('style', new StyleElementRewriter(targetURL, currentProxyDomain));
      }

      if (config.fallback.enabled && config.fallback.autoReload) {
        rewriter = rewriter.on('head', new HeadRewriter(targetURL.href));
      }

      finalResponse = rewriter.transform(new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: respHeaders,
      }));
      // HTML is not cached (dynamic content)
    }
    // CSS: rewrite and cache
    else if ((contentType.includes('text/css') || contentType.includes('application/x-stylesheet')) && config.rewriteCSS) {
      const text = await response.text();
      const rewritten = rewriteCSS(text, targetURL, url.host);
      finalResponse = new Response(rewritten, {
        status: response.status,
        statusText: response.statusText,
        headers: respHeaders,
      });
      // Store in cache asynchronously
      if (request.method === 'GET' || request.method === 'HEAD') {
        event.waitUntil(cache.put(cacheKey, finalResponse.clone()));
      }
    }
    // JS: rewrite and cache
    else if ((contentType.includes('application/javascript') || contentType.includes('text/javascript')) && config.rewriteJS) {
      const text = await response.text();
      const rewritten = rewriteJavaScript(text, targetURL, url.host);
      finalResponse = new Response(rewritten, {
        status: response.status,
        statusText: response.statusText,
        headers: respHeaders,
      });
      if (request.method === 'GET' || request.method === 'HEAD') {
        event.waitUntil(cache.put(cacheKey, finalResponse.clone()));
      }
    }
    // Other types: pass through, cache static assets
    else {
      finalResponse = new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: respHeaders,
      });
      // Cache images, fonts, videos, audio (and also PDF etc.)
      if (request.method === 'GET' || request.method === 'HEAD') {
        const cacheableTypes = ['image/', 'font/', 'video/', 'audio/', 'application/pdf'];
        if (cacheableTypes.some(t => contentType.startsWith(t))) {
          event.waitUntil(cache.put(cacheKey, finalResponse.clone()));
        }
      }
    }

    // If no cache-control header from origin, add a default
    if (!finalResponse.headers.get('Cache-Control')) {
      finalResponse.headers.set('Cache-Control', `public, max-age=${config.cacheTTL}`);
    }

    return finalResponse;

  } catch (error) {
    const errorMsg = escapeHtml(error.message);
    const targetHref = escapeHtml(targetURL.href);
    return new Response(`
      <!DOCTYPE html>
      <html>
      <head><meta charset="UTF-8"><title>Proxy Error</title>
      <style>body{font-family:sans-serif;max-width:800px;margin:40px auto;padding:20px;}
      .error{background:#f8d7da;color:#721c24;padding:15px;border-radius:4px;}
      .direct{background:#d4edda;color:#155724;padding:15px;border-radius:4px;margin-top:20px;}
      a{color:#17a2b8;}
      .details{background:#f8f9fa;padding:15px;border-radius:4px;margin-top:20px;font-family:monospace;}</style>
      </head>
      <body>
        <h1>Proxy Request Failed</h1>
        <div class="error"><strong>Error:</strong> ${errorMsg}</div>
        <div class="direct"><p>Try accessing <a href="${targetHref}" target="_blank">${targetHref}</a> directly.</p></div>
        <div class="details">Request URL: ${targetHref}</div>
      </body>
      </html>
    `, {
      status: 500,
      headers: { 'Content-Type': 'text/html;charset=UTF-8', 'Access-Control-Allow-Origin': '*' },
    });
  }
}

// ================================================================
// HTMLRewriter classes 
// ================================================================
class LinkRewriter {
  constructor(baseURL, attributeName, proxyDomain) {
    this.baseURL = baseURL;
    this.attributeName = attributeName;
    this.proxyDomain = proxyDomain;
  }
  element(element) {
    const attributeValue = element.getAttribute(this.attributeName);
    if (!attributeValue || attributeValue.startsWith('data:') || attributeValue.startsWith('javascript:')) return;
    if (attributeValue.startsWith(`https://${this.proxyDomain}/`)) return;
    try {
      let normalizedValue = attributeValue.trim();
      if (normalizedValue.startsWith('//')) normalizedValue = this.baseURL.protocol + normalizedValue;
      const absoluteURL = new URL(normalizedValue, this.baseURL);
      if (this.attributeName === 'src' && element.tagName === 'img') {
        const originalSrc = absoluteURL.href;
        element.setAttribute('data-original-src', originalSrc);
        element.setAttribute('onerror', `this.onerror=null;if(this.src!==this.dataset.originalSrc){this.src=this.dataset.originalSrc;}`);
      }
      const newURL = `https://${this.proxyDomain}/${config.separator}${absoluteURL.href}`;
      element.setAttribute(this.attributeName, newURL);
    } catch (_) { /* silently ignore */ }
  }
}

class SrcsetRewriter {
  constructor(baseURL, proxyDomain) {
    this.baseURL = baseURL;
    this.proxyDomain = proxyDomain;
  }
  element(element) {
    const srcset = element.getAttribute('srcset');
    if (!srcset) return;
    try {
      const parts = srcset.split(/,\s+/);
      const newParts = parts.map(part => {
        const [url, size] = part.trim().split(/\s+/);
        if (!url) return part;
        if (url.startsWith('data:')) return part;
        if (url.startsWith(`https://${this.proxyDomain}/`)) return part;
        try {
          let normalized = url;
          if (normalized.startsWith('//')) normalized = this.baseURL.protocol + normalized;
          const abs = new URL(normalized, this.baseURL);
          const newURL = `https://${this.proxyDomain}/${config.separator}${abs.href}`;
          return size ? `${newURL} ${size}` : newURL;
        } catch (_) { return part; }
      });
      element.setAttribute('srcset', newParts.join(', '));
    } catch (_) {}
  }
}

class MetaContentRewriter {
  constructor(baseURL, proxyDomain) {
    this.baseURL = baseURL;
    this.proxyDomain = proxyDomain;
  }
  element(element) {
    const httpEquiv = element.getAttribute('http-equiv');
    const content = element.getAttribute('content');
    if (httpEquiv && httpEquiv.toLowerCase() === 'refresh' && content) {
      const parts = content.split(';url=');
      if (parts.length === 2) {
        try {
          const url = new URL(parts[1], this.baseURL);
          const newURL = `https://${this.proxyDomain}/${config.separator}${url.href}`;
          element.setAttribute('content', `${parts[0]};url=${newURL}`);
        } catch (_) {}
      }
    }
    const property = element.getAttribute('property') || element.getAttribute('name');
    if (property && content && (property.includes('og:image') || property.includes('og:url') || property.includes('twitter:image'))) {
      try {
        const url = new URL(content, this.baseURL);
        const newURL = `https://${this.proxyDomain}/${config.separator}${url.href}`;
        element.setAttribute('content', newURL);
      } catch (_) {}
    }
  }
}

class BaseTagRewriter {
  constructor(baseURL, proxyDomain) {
    this.baseURL = baseURL;
    this.proxyDomain = proxyDomain;
  }
  element(element) {
    const href = element.getAttribute('href');
    if (href) {
      try {
        const url = new URL(href, this.baseURL);
        const newURL = `https://${this.proxyDomain}/${config.separator}${url.href}`;
        element.setAttribute('href', newURL);
      } catch (_) {}
    }
  }
}

class StyleAttributeRewriter {
  constructor(baseURL, proxyDomain) {
    this.baseURL = baseURL;
    this.proxyDomain = proxyDomain;
  }
  element(element) {
    const style = element.getAttribute('style');
    if (!style) return;
    const rewritten = rewriteCSS(style, this.baseURL, this.proxyDomain);
    element.setAttribute('style', rewritten);
  }
}

class StyleElementRewriter {
  constructor(baseURL, proxyDomain) {
    this.baseURL = baseURL;
    this.proxyDomain = proxyDomain;
  }
  element(element) {
    element.onEndTag(endTag => {
      element.replace(endTag.before + endTag.name + endTag.after);
    });
  }
  text(text) {
    const rewritten = rewriteCSS(text.text, this.baseURL, this.proxyDomain);
    text.replace(rewritten);
  }
}

class HeadRewriter {
  constructor(originalURL) {
    this.originalURL = originalURL;
  }
  element(element) {
    element.append(`
      <script>
        document.addEventListener('DOMContentLoaded', function() {
          document.querySelectorAll('img').forEach(img => {
            if (!img.hasAttribute('data-original-src')) {
              const originalSrc = new URL(img.src).pathname.slice(1);
              img.setAttribute('data-original-src', originalSrc);
              img.setAttribute('onerror', "this.onerror=null;if(this.src!==this.dataset.originalSrc){this.src=this.dataset.originalSrc;}");
            }
          });
          document.querySelectorAll('a[target="_blank"]').forEach(link => {
            let originalUrl = link.href;
            if (originalUrl.includes('/${this.originalURL.split('/')[2]}/')) {
              try {
                const parts = new URL(originalUrl).pathname.split('/');
                parts.shift();
                originalUrl = parts.join('/');
              } catch(e) {}
            }
            link.addEventListener('click', function(e) {
              if (e.button !== 0 || e.ctrlKey || e.metaKey) return;
              e.preventDefault();
              link.setAttribute('rel', 'noreferrer noopener');
              window.open(link.href, '_blank');
            });
          });
          if (document.querySelector('body.mediawiki')) {
            document.querySelectorAll('img[data-src]').forEach(img => {
              if (!img.src && img.dataset.src) img.src = img.dataset.src;
            });
            document.querySelectorAll('[style*="background"]').forEach(el => {
              if (el.style.backgroundImage) el.setAttribute('data-original-bg', el.style.backgroundImage);
            });
          }
        });
      </script>
    `, {html: true});
  }
}

// ================================================================
// CSS/JS rewriting functions
// ================================================================
function rewriteCSS(css, baseURL, proxyDomain) {
  if (!css) return css;
  css = css.replace(/@import\s+(?:url\(\s*['"]?([^'")]+)['"]?\s*\)|['"]([^'"]+)['"]).*/g, 
    (match, urlMatch, directMatch) => {
      const importUrl = urlMatch || directMatch;
      if (!importUrl || importUrl.startsWith('data:') || importUrl.startsWith(`https://${proxyDomain}/`)) return match;
      try {
        let normalized = importUrl;
        if (normalized.startsWith('//')) normalized = baseURL.protocol + normalized;
        const abs = new URL(normalized, baseURL);
        return match.replace(importUrl, `https://${proxyDomain}/${config.separator}${abs.href}`);
      } catch (_) { return match; }
    }
  );
  css = css.replace(/url\(\s*(['"]?)([^'")]+)(['"]?)\s*\)/g,
    (match, quote1, url, quote2) => {
      if (!url || url.startsWith('data:') || url.startsWith(`https://${proxyDomain}/`)) return match;
      try {
        let normalized = url;
        if (normalized.startsWith('//')) normalized = baseURL.protocol + normalized;
        const abs = new URL(normalized, baseURL);
        return `url(${quote1}https://${proxyDomain}/${config.separator}${abs.href}${quote2})`;
      } catch (_) { return match; }
    }
  );
  css = css.replace(/image-set\(\s*(?:[^)]|(?:\([^)]*\)))+\)/g, (match) => {
    return match.replace(/url\(\s*(['"]?)([^'")]+)(['"]?)\s*\)/g,
      (urlMatch, quote1, url, quote2) => {
        if (!url || url.startsWith('data:') || url.startsWith(`https://${proxyDomain}/`)) return urlMatch;
        try {
          let normalized = url;
          if (normalized.startsWith('//')) normalized = baseURL.protocol + normalized;
          const abs = new URL(normalized, baseURL);
          return `url(${quote1}https://${proxyDomain}/${config.separator}${abs.href}${quote2})`;
        } catch (_) { return urlMatch; }
      }
    );
  });
  return css;
}

function rewriteJavaScript(js, baseURL, proxyDomain) {
  if (!js) return js;
  return js.replace(/'(https?:\/\/[^']+)'/g, (match, url) => {
    if (url.startsWith(`https://${proxyDomain}/`)) return match;
    try { return `'https://${proxyDomain}/${config.separator}${url}'`; } catch (_) { return match; }
  }).replace(/"(https?:\/\/[^"]+)"/g, (match, url) => {
    if (url.startsWith(`https://${proxyDomain}/`)) return match;
    try { return `"https://${proxyDomain}/${config.separator}${url}"`; } catch (_) { return match; }
  });
}

// ================================================================
// Homepage
// ================================================================
function getHomePage() {
  return new Response(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Portal</title>
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><defs><linearGradient id='g' x1='0%' y1='0%' x2='100%' y2='100%'><stop offset='0%' stop-color='%23007aff' /><stop offset='100%' stop-color='%237000ff' /></linearGradient></defs><rect width='100' height='100' rx='24' fill='url(%23g)' /><text x='50' y='72' text-anchor='middle' font-family='sans-serif' font-size='62' font-weight='bold' fill='%23ffffff'>P.</text></svg>" />
  <style>
    :root {
      --bg: #ffffff;
      --text: #1a1a1a;
      --text-muted: #6b7280;
      --border: #e5e7eb;
      --accent: #2563eb;
      --accent-soft: #eff6ff;
      --radius: 14px;
      --shadow: 0 1px 2px rgba(0,0,0,0.04), 0 8px 24px rgba(0,0,0,0.06);
    }

    * { margin: 0; padding: 0; box-sizing: border-box; }

    html, body { height: 100%; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
      display: flex;
      flex-direction: column;
      min-height: 100vh;
    }

    main {
      flex: 1;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      padding: 24px;
    }

    .container {
      width: 100%;
      max-width: 560px;
      text-align: center;
    }

    .logo {
      font-size: clamp(2.4rem, 6vw, 3.4rem);
      font-weight: 600;
      letter-spacing: -0.03em;
      margin-bottom: 0.5rem;
      color: var(--text);
    }
    .logo .dot { color: var(--accent); }

    .sub {
      font-size: 0.95rem;
      color: var(--text-muted);
      margin-bottom: 2rem;
    }

    form {
      display: flex;
      align-items: center;
      gap: 4px;
      border: 1px solid var(--border);
      border-radius: 999px;
      padding: 6px 8px 6px 20px;
      background: var(--bg);
      box-shadow: var(--shadow);
      transition: border-color 0.15s ease, box-shadow 0.15s ease;
    }
    form:focus-within {
      border-color: var(--accent);
      box-shadow: 0 0 0 3px var(--accent-soft), var(--shadow);
    }

    input[type="text"] {
      flex: 1;
      min-width: 0;
      border: none;
      outline: none;
      font-size: 1.05rem;
      padding: 12px 0;
      background: transparent;
      color: var(--text);
    }
    input[type="text"]::placeholder { color: #9ca3af; }

    button {
      flex-shrink: 0;
      background: var(--accent);
      border: none;
      cursor: pointer;
      width: 42px;
      height: 42px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #ffffff;
      transition: background 0.15s ease, transform 0.1s ease;
    }
    button:hover { background: #1d4ed8; }
    button:active { transform: scale(0.94); }
    button svg { width: 20px; height: 20px; fill: currentColor; }

    .examples {
      margin-top: 1.8rem;
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: 0.4rem 0.6rem;
      font-size: 0.85rem;
    }
    .examples .label {
      color: var(--text-muted);
      margin-right: 0.15rem;
    }
    .examples a {
      color: var(--text-muted);
      text-decoration: none;
      padding: 5px 12px;
      border: 1px solid var(--border);
      border-radius: 999px;
      transition: color 0.15s ease, border-color 0.15s ease, background 0.15s ease;
    }
    .examples a:hover {
      color: var(--accent);
      border-color: var(--accent);
      background: var(--accent-soft);
    }

    footer {
      text-align: center;
      padding: 18px 16px 24px;
      font-size: 0.78rem;
      color: #9ca3af;
    }

    @media (max-width: 480px) {
      form { padding: 4px 4px 4px 16px; }
      input[type="text"] { font-size: 1rem; padding: 10px 0; }
      button { width: 38px; height: 38px; }
      .examples { font-size: 0.8rem; }
    }

    @media (prefers-reduced-motion: reduce) {
      * { transition: none !important; }
    }
  </style>
</head>
<body>
  <main>
    <div class="container">
      <h1 class="logo">Portal<span class="dot">.</span></h1>
      <p class="sub">Private &amp; fast web access</p>

      <form id="proxyForm" onsubmit="navigateToProxy(event)">
        <input
          type="text"
          id="urlInput"
          placeholder="Enter a URL or search…"
          autocomplete="off"
          spellcheck="false"
          autofocus
        />
        <button type="submit" aria-label="Go">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>
        </button>
      </form>

      <div class="examples">
        <span class="label">Try:</span>
        <a href="/------https://ext.to/">Ext</a>		
        <a href="/------https://browserleaks.com/ip">BrowserLeaks</a>
      </div>
    </div>
  </main>

  <footer>Portal &middot; browse privately</footer>

  <script>
    function navigateToProxy(e) {
      e.preventDefault();
      const input = document.getElementById('urlInput').value.trim();
      if (!input) return;
      const hasScheme = /^https?:\\/\\//i.test(input);
      const looksLikeDomain = input.includes('.') && !input.startsWith(' ');
      let target;
      if (hasScheme) {
        target = input;
      } else if (looksLikeDomain) {
        target = 'https://' + input;
      } else {
        target = 'https://duckduckgo.com/?q=' + encodeURIComponent(input);
      }
      window.location.href = '/' + '------' + target;
    }

    const urlInput = document.getElementById('urlInput');
    urlInput.addEventListener('paste', function(e) {
      setTimeout(function() {
        urlInput.value = urlInput.value.trim().replace(/\\s+/g, '');
      }, 0);
    });
  </script>
</body>
</html>`, {
    headers: { 'Content-Type': 'text/html;charset=UTF-8', 'Cache-Control': 'no-cache' }
  });
}

// ================================================================
// Login page
// ================================================================
function serveLoginPage(redirectUrl = '') {
  const redirectParam = redirectUrl ? `?redirect=${encodeURIComponent(redirectUrl)}` : '';
  return new Response(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Portal Login</title>
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><defs><linearGradient id='g' x1='0%' y1='0%' x2='100%' y2='100%'><stop offset='0%' stop-color='%23007aff' /><stop offset='100%' stop-color='%237000ff' /></linearGradient></defs><rect width='100' height='100' rx='24' fill='url(%23g)' /><text x='50' y='72' text-anchor='middle' font-family='sans-serif' font-size='62' font-weight='bold' fill='%23ffffff'>P.</text></svg>" />
  <style>
    :root {
      --bg: #ffffff;
      --text: #1a1a1a;
      --text-muted: #6b7280;
      --border: #e5e7eb;
      --accent: #2563eb;
      --accent-soft: #eff6ff;
      --error-bg: #fef2f2;
      --error-text: #dc2626;
      --radius: 14px;
      --shadow: 0 1px 2px rgba(0,0,0,0.04), 0 8px 24px rgba(0,0,0,0.06);
    }

    * { margin: 0; padding: 0; box-sizing: border-box; }

    html, body { height: 100%; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 24px;
    }

    .login-card {
      background: var(--bg);
      padding: 2.4rem 2rem;
      border-radius: var(--radius);
      border: 1px solid var(--border);
      box-shadow: var(--shadow);
      width: 100%;
      max-width: 380px;
    }

    .mark {
      width: 40px;
      height: 40px;
      border-radius: 10px;
      background: var(--accent-soft);
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 1.1rem;
    }
    .mark svg {
      width: 20px;
      height: 20px;
      stroke: var(--accent);
    }

    h1 {
      font-weight: 600;
      font-size: 1.5rem;
      letter-spacing: -0.01em;
      margin-bottom: 0.35rem;
      color: var(--text);
    }

    .sub {
      color: var(--text-muted);
      margin-bottom: 1.6rem;
      font-size: 0.92rem;
    }

    .field {
      margin-bottom: 1rem;
    }

    label {
      display: block;
      font-size: 0.82rem;
      font-weight: 500;
      color: var(--text-muted);
      margin-bottom: 0.35rem;
    }

    input[type="text"],
    input[type="password"] {
      width: 100%;
      padding: 0.72rem 0.9rem;
      border: 1px solid var(--border);
      border-radius: 10px;
      font-size: 0.98rem;
      color: var(--text);
      background: var(--bg);
      transition: border-color 0.15s ease, box-shadow 0.15s ease;
    }
    input::placeholder {
      color: #9ca3af;
    }
    input:focus {
      outline: none;
      border-color: var(--accent);
      box-shadow: 0 0 0 3px var(--accent-soft);
    }

    button {
      width: 100%;
      background: var(--accent);
      color: #ffffff;
      border: none;
      padding: 0.78rem;
      border-radius: 10px;
      font-size: 0.98rem;
      font-weight: 500;
      cursor: pointer;
      margin-top: 0.4rem;
      transition: background 0.15s ease, transform 0.1s ease;
    }
    button:hover {
      background: #1d4ed8;
    }
    button:active {
      transform: scale(0.99);
    }

    .error {
      background: var(--error-bg);
      color: var(--error-text);
      padding: 0.65rem 0.8rem;
      border-radius: 10px;
      margin-bottom: 1rem;
      font-size: 0.88rem;
      display: none;
      align-items: center;
      gap: 0.5rem;
    }
    .error.visible {
      display: flex;
    }

    @media (max-width: 420px) {
      .login-card { padding: 2rem 1.5rem; }
      h1 { font-size: 1.35rem; }
    }

    @media (prefers-reduced-motion: reduce) {
      * { transition: none !important; }
    }
  </style>
</head>
<body>
  <div class="login-card">
    <div class="mark">
      <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="4" y="10" width="16" height="10" rx="2" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3" />
      </svg>
    </div>
    <h1>Sign in</h1>
    <p class="sub">Enter your credentials to access the Portal</p>
    <form method="POST" action="/login${redirectParam}">
      <div class="error" id="errorMsg">
        <span>Invalid username or password</span>
      </div>
      <div class="field">
        <label for="username">Username</label>
        <input type="text" id="username" name="username" placeholder="Enter your username" required autofocus />
      </div>
      <div class="field">
        <label for="password">Password</label>
        <input type="password" id="password" name="password" placeholder="Enter your password" required />
      </div>
      <button type="submit">Log in</button>
    </form>
  </div>
  <script>
    if (window.location.search.includes('error=1')) {
      document.getElementById('errorMsg').classList.add('visible');
    }
  </script>
</body>
</html>`, {
    headers: { 'Content-Type': 'text/html;charset=UTF-8' },
  });
}

// ================================================================
// Worker entry
// ================================================================
addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request, event));
});
