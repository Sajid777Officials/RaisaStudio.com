// Supabase client singleton.
// window.supabase is loaded from CDN before this script runs.
// window.PortfolioConfig is injected by config.js (build) or Portfolio.html (dev).
(function () {
  const cfg = window.PortfolioConfig || {};
  const url = cfg.supabaseUrl || "";
  const key = cfg.supabaseAnonKey || "";

  if (!url || !key) {
    window.PortfolioSupabase = null;
    return;
  }

  if (typeof window.supabase === "undefined" || typeof window.supabase.createClient !== "function") {
    console.warn("[RAISA] Supabase SDK not loaded from CDN — running without backend persistence.");
    window.PortfolioSupabase = null;
    return;
  }

  try {
    window.PortfolioSupabase = window.supabase.createClient(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        storageKey: "vox-portfolio-auth",
      },
    });
  } catch (err) {
    console.warn("[RAISA] Failed to initialize Supabase client:", err);
    window.PortfolioSupabase = null;
  }
})();
