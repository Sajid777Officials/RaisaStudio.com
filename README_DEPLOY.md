# VOX Portfolio Deployment

## Local Workflow

```bash
npm install
npm run build
npm run preview
```

The deployable site is generated in `dist/`.

## Admin Panel

For local editing, open `Portfolio.html` or run `npm run dev`, then open `/#admin` or press `Ctrl+Shift+A`.
The local passcode is `change-me`.

For production, set a real passcode before building:

```bash
PORTFOLIO_ADMIN_PASSCODE="use-a-long-private-passcode" npm run build
```

On Windows PowerShell:

```powershell
$env:PORTFOLIO_ADMIN_PASSCODE="use-a-long-private-passcode"
npm run build
```

The production build disables the admin panel when `PORTFOLIO_ADMIN_PASSCODE` is not set. This avoids accidentally publishing the local `change-me` passcode.

This is a static-site admin panel. Edits are saved in the browser's `localStorage`; use the admin panel's JSON export/import tools to move content between browsers or environments. For a private multi-device CMS, connect the same content shape to a hosted backend.

## Build Environment

Optional variables:

```bash
PORTFOLIO_SITE_URL="https://your-domain.com"
PORTFOLIO_ADMIN_PASSCODE="use-a-long-private-passcode"
PORTFOLIO_ENABLE_TWEAKS=false
PORTFOLIO_NO_INDEX=false
```

`PORTFOLIO_SITE_URL` adds canonical, robots, and sitemap metadata. Set `PORTFOLIO_NO_INDEX=true` for staging builds that search engines should ignore.

## Static Hosting

Upload the contents of `dist/` to any static host, including Netlify, Cloudflare Pages, Vercel static output, GitHub Pages, or traditional cPanel hosting.

The build removes browser-side Babel, uses production React, adds SEO and social metadata, writes `robots.txt`, `site.webmanifest`, `favicon.svg`, `_redirects`, `404.html`, and static-host security headers.

## Host Settings

Netlify:

```bash
Build command: npm run build
Publish directory: dist
```

Vercel:

```bash
Build command: npm run build
Output directory: dist
```

Cloudflare Pages:

```bash
Build command: npm run build
Build output directory: dist
```
