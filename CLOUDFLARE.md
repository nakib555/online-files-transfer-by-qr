# Deploying to Cloudflare Pages

This application is built as a highly optimized, fully client-side Single Page Application (SPA). Because it uses zero server-side components (meaning all base64 parsing, QR generation, IndexedDB storage, and CRC32 checks run completely sandboxed in the user's browser for absolute airgap security), it is perfectly suited for direct deployment on **Cloudflare Pages**.

---

## ⚡ Direct Deployment via Cloudflare Dashboard (Recommended)

1. **Log in** to your [Cloudflare Dashboard](https://dash.cloudflare.com/).
2. Navigate to **Workers & Pages** > **Create application** > **Pages** > **Connect to Git**.
3. Select your GitHub/GitLab repository for this project.
4. Configure the build settings as follows:
   - **Framework Preset**: `Vite` (or `None`)
   - **Build Command**: `npm run build`
   - **Build Output Directory**: `dist`
5. Click **Save and Deploy**. Cloudflare will automatically build and serve your app on a global edge CDN!

---

## 💻 Deployment via Wrangler CLI (Command Line)

If you prefer deploying directly from your terminal using Cloudflare's official CLI tool (`wrangler`), run the following commands:

### 1. Build the Application
Compile the React/Vite assets:
```bash
npm run build
```

### 2. Deploy using Wrangler
Use `npx wrangler` to publish the compiled static files to Cloudflare Pages:
```bash
npx wrangler pages deploy
```

*(Wrangler will automatically read the `pages_build_output_dir` from the pre-configured `wrangler.json` file).*

---

## 🔧 Deployment Details

- **SPA Routing**: A `_redirects` file is pre-configured under `public/_redirects` and copied to the `dist` directory during the build process. This ensures that any sub-routes or hard reloads on custom paths fallback to `index.html` seamlessly without triggering a 404 error.
- **Wrangler Config**: The root `wrangler.json` specifies `"pages_build_output_dir": "dist"`, making command-line deployments instant.
