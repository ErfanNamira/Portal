# 🌐 Portal: Advanced Cloudflare Worker Web Proxy

**Portal** is a powerful, single-file web proxy built entirely on Cloudflare Workers. It goes beyond simple request forwarding by implementing deep server-side HTML/CSS rewriting and aggressive client-side DOM interception. 

Designed for privacy, bypassing basic geo-restrictions, and accessing content securely, Portal features a custom-built UI, streaming media support, and intelligent Cloudflare Challenge handling.

---

## ✨ Key Features

### 🧠 Intelligent Routing & Interception
* **Client-Side DOM Hijacking**: Intercepts `fetch`, `XMLHttpRequest`, `EventSource`, `window.open`, and the History API to route dynamic traffic.
* **Deep Property Interception**: Uses `Object.defineProperty` to intercept dynamic DOM property assignments (e.g., `img.src`, `a.href`, `form.action`).
* **MutationObserver**: Automatically rewrites URLs for nodes dynamically injected into the DOM by target site scripts.
* **Service Worker Blocking**: Prevents target sites from registering Service Workers, which would otherwise cache and break proxy routing.

### 🛠️ Server-Side Rewriting
* **HTMLRewriter Integration**: Streams and modifies HTML on the edge, rewriting `src`, `href`, `srcset`, and inline styles before they reach the browser.
* **CSS & Manifest Parsing**: Natively rewrites `@import` and `url()` in CSS files, as well as HLS (`.m3u8`) and DASH (`.mpd`) streaming manifests for seamless video playback.
* **Header Sanitization**: Strips restrictive security headers (CSP, X-Frame-Options, HSTS) and rewrites `Set-Cookie` paths to isolate cookies per target domain.

### 🛡️ Anti-Bot & Challenge Bypass
* **Smart CAPTCHA Passthrough**: Domains like `hcaptcha.com`, `challenges.cloudflare.com`, and `turnstile.com` are automatically whitelisted to load directly, ensuring CAPTCHAs work perfectly.
* **CF Challenge Detection**: Detects Cloudflare 403/503 Challenge pages, temporarily disables client-side JS injection to prevent breaking the challenge, and rewrites challenge URLs server-side.
* **Browser Emulation**: Spoofs `User-Agent`, `Sec-CH-UA`, and `Accept` headers to mimic a modern Chrome 150 browser on Windows 10.

### 🎨 Premium UI & UX
* **Custom "Portal" Homepage**: A sleek, cyberpunk-inspired routing interface with animated SVG backgrounds.
* **Dark/Light Mode**: Fully responsive themes with local storage persistence.
* **Secure Authentication**: Optional Basic Auth and secure, HttpOnly cookie-based session management with a custom login portal.

---

## 🚀 Deployment

Since this is a single-file project, deployment is incredibly simple.

### Method 1: Cloudflare Dashboard (Easiest)
1. Log in to your Cloudflare Dashboard.
2. Navigate to **Workers & Pages** > **Create** > **Create Worker**.
3. Name your worker (e.g., `portal-proxy`) and click **Deploy**.
4. Click **Edit Code** to open the Quick Editor.
5. Delete the default boilerplate code and paste the entire contents of your `worker.js` file.
6. Click **Save and Deploy**.

## ⚙️ Configuration

Portal uses Cloudflare Environment Variables for authentication. Go to your Worker's Settings > Variables to configure them.
| Variable      | Description                                     | Required? |
|---------------|-------------------------------------------------|-----------|
| `PROXY_USER`  | The username required to access the proxy.      | No |
| `PROXY_PASS`  | The password required to access the proxy.      | No |

## 📖 Customization (Inside the Code)

You can customize the proxy's behavior by editing the `CONFIG` object at the top of the file.

| Option | Description | Default |
|--------|-------------|---------|
| `separator` | The string used to separate the proxy host from the target URL. | `------` |
| `cacheTTL` | Edge cache duration for static assets, in seconds. | `86400` (24 hours) |
| `PASSTHROUGH_DOMAINS` | An array of domains that should bypass the proxy entirely. This is essential for WebSockets, CAPTCHAs, and certain CDNs. | See `CONFIG` |

## ⚠️ Limitations & Disclaimer
**Complex DRMs:** Proxies cannot bypass hardware-level DRM (Widevine L1, PlayReady) used by Netflix, Hulu, etc.

**WebRTC/IP Leaks:** This proxy routes HTTP/HTTPS traffic. It does not tunnel WebRTC or UDP traffic.

**Strict Origin Protections:** Some highly protected sites (e.g., banking, advanced bot-protected ticketing sites) may still detect the proxy environment via canvas fingerprinting or TLS fingerprinting (JA3).

**Disclaimer:** This project is provided for **educational, privacy, and testing purposes only.** The developers are not responsible for any misuse or violation of third-party Terms of Service. Please use responsibly and legally.

## 📄 License

MIT License.
