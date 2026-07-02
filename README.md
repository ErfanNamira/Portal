# Portal Proxy 🌐

A fast, private, and authenticated web proxy built entirely on Cloudflare Workers. Portal Proxy allows you to bypass restrictions and browse the web privately through a beautifully designed, modern interface. 

It utilizes Cloudflare's edge network and `HTMLRewriter` to seamlessly stream and rewrite HTML, CSS, and JavaScript on the fly, ensuring external links and assets load correctly through the proxy.

## ✨ Features

* **Edge-Rendered Modern UI:** A clean, responsive login and homepage interface styled with modern aesthetics.
* **Authentication:** Secure access using Basic Authentication with fallback to 30-day encrypted session cookies.
* **On-the-Fly Rewriting:** Uses `HTMLRewriter` to dynamically rewrite attributes like `href`, `src`, and `action` so you stay within the proxy context.
* **CSS & JS Processing:** Automatically intercepts and rewrites URLs inside stylesheets and scripts.
* **Browser Emulation:** Spoofs standard Chrome user-agent and `Sec-Fetch` headers to bypass basic anti-bot protections.
* **Edge Caching:** Caches static assets at the edge to reduce load and improve speed.
* **Smart Fallbacks:** Handles redirects and falls back to DuckDuckGo searches if a URL is incomplete.

## 🚀 Deployment

You can deploy this entirely through your browser using the Cloudflare Dashboard, without needing Node.js or any local software.

### 1. Create a New Worker
* Log in to your [Cloudflare Dashboard](https://dash.cloudflare.com/).
* Navigate to **Workers & Pages** on the left sidebar.
* Click **Create application**, then **Create Worker**.
* Give it a name (e.g., `portal-proxy`) and click **Deploy**.

### 2. Add the Code
* Click **Edit code** on your newly deployed Worker.
* Delete the default code and paste the entire contents of `worker.js`.
* Update the `config.proxyDomains` array at the top of the file to include your new `.workers.dev` URL (e.g., `['portal-proxy.your-username.workers.dev']`).
* Click **Save and deploy** in the top right corner.

### 3. Set Up Authentication Secrets
To secure your proxy, you must add your desired username and password as environment variables.

* Go back to your Worker's overview page.
* Go to **Settings** > **Variables**.
* Under **Environment Variables**, click **Add variable**.
* Add `PROXY_USER` and type your desired username, then click the **Encrypt** button.
* Click **Add variable** again, add `PROXY_PASS`, enter your password, and click the **Encrypt** button.
* Click **Deploy** to save the changes.

## ⚙️ Configuration

You can customize the proxy behavior by modifying the `config` object at the top of `worker.js`:

* `proxyDomains`: Must contain the domain(s) your worker is running on to prevent unauthorized errors.
* `separator`: The string used to separate the proxy URL from the target URL (default: `------`).
* `allowedDomains`: Whitelist specific domains for strict access (leave empty to allow all).
* `browserEmulation`: Modify headers like `User-Agent` to disguise proxy traffic.
* `cacheTTL`: Adjust how long static assets are cached at the edge (default: `3600` seconds).

## 🛡️ Security & Privacy

* **Header Stripping:** This proxy removes strict `Content-Security-Policy` and `X-Frame-Options` headers to allow seamless rendering.
* **Edge Encryption:** Traffic between your device and the proxy is encrypted via Cloudflare's SSL.
* **IP Masking:** All external requests are initiated from Cloudflare's edge network, keeping your true IP address hidden from target servers.

## 📄 License

MIT License.
