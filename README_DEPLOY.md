# Portfolio Deployment Guide

## Quick Start (Local Dev)

```bash
npm install
npm run build
npm run preview
```

The deployable site is generated in `dist/`.

For live editing without a build step, open `Portfolio.html` directly in a browser.

---

## Supabase Backend Setup

Supabase gives the admin panel real backend persistence — edits made at `#admin` appear on every device and browser instantly.

### 1. Create a Supabase project

1. Go to [supabase.com](https://supabase.com) and create a free project.
2. Note your **Project URL** and **anon public key** from  
   `Dashboard → Project Settings → API`.

### 2. Run the SQL schema

Open `SQL Editor` in the Supabase dashboard and run:

```sql
-- portfolio_content: stores the entire portfolio JSON as a single row
CREATE TABLE IF NOT EXISTS portfolio_content (
  id          integer PRIMARY KEY DEFAULT 1,
  content_json jsonb   NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Enforce single-row invariant
ALTER TABLE portfolio_content
  ADD CONSTRAINT portfolio_content_single_row CHECK (id = 1);

-- portfolio_uploads: metadata for images stored in Supabase Storage
CREATE TABLE IF NOT EXISTS portfolio_uploads (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text        NOT NULL,
  mime_type    text        NOT NULL,
  size         bigint      NOT NULL DEFAULT 0,
  public_url   text        NOT NULL,
  storage_path text        NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
```

### 3. Enable Row Level Security and add policies

```sql
-- portfolio_content
ALTER TABLE portfolio_content ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read content"
  ON portfolio_content FOR SELECT USING (true);

CREATE POLICY "Authenticated users can upsert content"
  ON portfolio_content FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- portfolio_uploads
ALTER TABLE portfolio_uploads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read uploads"
  ON portfolio_uploads FOR SELECT USING (true);

CREATE POLICY "Authenticated users can manage uploads"
  ON portfolio_uploads FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');
```

### 4. Create the Storage bucket

In the Supabase dashboard go to **Storage → New bucket**:

| Setting | Value |
|---------|-------|
| Name | `portfolio-uploads` |
| Public bucket | ✅ Yes |

Then add storage RLS policies via `SQL Editor`:

```sql
-- Allow public read of uploaded images
CREATE POLICY "Public can view uploads"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'portfolio-uploads');

-- Only authenticated users can upload
CREATE POLICY "Authenticated users can upload"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'portfolio-uploads' AND auth.role() = 'authenticated');

-- Only authenticated users can delete
CREATE POLICY "Authenticated users can delete uploads"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'portfolio-uploads' AND auth.role() = 'authenticated');
```

### 5. Create the admin user

1. Go to `Dashboard → Authentication → Users → Add User`.
2. Enter your **email** and a **strong password**.
3. Optionally disable public signups: `Authentication → Settings → Disable sign ups`.

> This user's email + password is what you enter at `#admin` when Supabase is configured.

### 6. Set environment variables

Copy `.env.example` to `.env` and fill in the values:

```bash
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_ANON_KEY=eyJhbGci...
PORTFOLIO_ADMIN_PASSCODE=use-a-long-private-passcode
PORTFOLIO_SITE_URL=https://your-domain.com
```

> `PORTFOLIO_ADMIN_PASSCODE` is still required by the build check, but at runtime  
> the admin logs in with Supabase email + password when Supabase is configured.

---

## Admin Panel

Open `/#admin` or press `Ctrl+Shift+A` on any page.

**With Supabase configured:**
- Login with the email + password you created in step 5.
- All saves go to Supabase and are instantly visible site-wide.
- Images upload to Supabase Storage (public URLs, not base64).

**Without Supabase (localStorage mode):**
- Login with the passcode set in `PortfolioConfig.adminPasscode`.
- Changes persist in that browser only.
- Images are stored as base64 in localStorage (~5 MB limit).

---

## Build

```bash
# Minimal build (localStorage only)
PORTFOLIO_ADMIN_PASSCODE="your-passcode" npm run build

# Full build with Supabase backend
SUPABASE_URL="https://xxxx.supabase.co" \
SUPABASE_ANON_KEY="eyJhbGci..." \
PORTFOLIO_ADMIN_PASSCODE="your-passcode" \
PORTFOLIO_SITE_URL="https://your-domain.com" \
npm run build
```

On Windows PowerShell:

```powershell
$env:SUPABASE_URL      = "https://xxxx.supabase.co"
$env:SUPABASE_ANON_KEY = "eyJhbGci..."
$env:PORTFOLIO_ADMIN_PASSCODE = "your-passcode"
$env:PORTFOLIO_SITE_URL = "https://your-domain.com"
npm run build
```

---

## Static Hosting

Upload the contents of `dist/` to any static host.

### Netlify

```
Build command:      npm run build
Publish directory:  dist
```

Add env vars in `Site settings → Environment variables`.

### Vercel

```
Build command:   npm run build
Output directory: dist
```

Add env vars in `Project settings → Environment Variables`.

### Cloudflare Pages

```
Build command:         npm run build
Build output directory: dist
```

Add env vars in `Settings → Environment variables`.

---

## All Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SUPABASE_URL` | No | Supabase project URL. Enables backend mode. |
| `SUPABASE_ANON_KEY` | No | Supabase anon/public key. |
| `VITE_SUPABASE_URL` | No | Alternative prefix (same effect). |
| `VITE_SUPABASE_ANON_KEY` | No | Alternative prefix (same effect). |
| `PORTFOLIO_ADMIN_PASSCODE` | Yes* | Required by build when admin is enabled. |
| `PORTFOLIO_SITE_URL` | No | Adds canonical, sitemap, and OG URL tags. |
| `PORTFOLIO_ENABLE_TWEAKS` | No | Show/hide the tweaks panel. Default: `false`. |
| `PORTFOLIO_NO_INDEX` | No | Set `true` for staging builds. Default: `false`. |

*The passcode is validated at build time to prevent accidentally publishing the default value.

---

## Backward Compatibility

- If `SUPABASE_URL` / `SUPABASE_ANON_KEY` are not set, the site runs in localStorage mode — same as before. All existing routes (`#graphic`, `#webdev`, `#admin`, case studies) continue to work.
- Default content loads from code if Supabase has no saved content yet.
- The `window.PortfolioContent` API is unchanged (`.load()`, `.save()`, `.reset()`); `.save()` and `.reset()` are now async — `admin-panel.jsx` awaits them and shows loading/error states.
