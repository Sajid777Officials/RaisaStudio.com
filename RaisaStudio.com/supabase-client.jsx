// Supabase client singleton.
// window.supabase is supplied by the pinned local vendor bundle before this
// script runs.
// window.PortfolioConfig is injected by config.js (build) or Portfolio.html (dev).
(function () {
  const cfg = window.PortfolioConfig || {};
  const url = cfg.supabaseUrl || "";
  const key = cfg.supabasePublishableKey || cfg.supabaseAnonKey || "";

  if (!url || !key) {
    window.PortfolioSupabase = null;
    return;
  }

  if (typeof window.supabase === "undefined" || typeof window.supabase.createClient !== "function") {
    console.error("[RAISA] Supabase SDK did not load. Secure admin access is unavailable.");
    window.PortfolioSupabase = null;
    return;
  }

  try {
    window.PortfolioSupabase = window.supabase.createClient(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: "raisa-portfolio-auth-v1",
      },
    });
  } catch (err) {
    console.error("[RAISA] Failed to initialize the secure backend:", err);
    window.PortfolioSupabase = null;
  }
})();
