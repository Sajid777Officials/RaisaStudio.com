// Editable content and persistence for the portfolio.
// Saves to Supabase when configured (window.PortfolioSupabase), falls back to localStorage.
const PORTFOLIO_STORAGE_KEY = "vox-portfolio-content-v1";
const PORTFOLIO_CONTENT_ROW_ID = 1;

const PORTFOLIO_DEFAULT_CONTENT = {
  site: {
    brandName: "RAISA Studio",
    logoMark: "V",
    trademark: "TM",
    contactEmail: "hello@voxstudio.dev",
    metaTitle: "RAISA Studio - Graphic Design x Software Development",
    metaDescription: "A split-discipline portfolio for graphic design, branding, websites, web apps, and production-ready digital work.",
  },
  studios: {
    graphic: {
      heroEyebrow: "01 - Discipline A",
      heroTitleTop: "Graphic",
      heroTitleEm: "design",
      heroTitleSuffix: ".",
      heroSub: "Identity, print, packaging and editorial work for founders who want their brand to look like it means business.",
      heroCta: "Enter Graphic Studio",
      heroStats: [
        { value: "120", suffix: "+", label: "Brands shipped" },
        { value: "06", suffix: "y", label: "In practice" },
      ],
      pageEyebrow: "Studio A - Graphic Design",
      pageTitlePre: "Brands, ",
      pageTitleEm: "built",
      pageTitlePost: "",
      pageTitleSecond: "to be looked at.",
      pageLede: "Ten focused disciplines - from packaging dielines to a deck that closes the round - delivered with print-ready files and a process you can stand behind.",
      pageStats: [
        { value: "120", suffix: "+", label: "Projects delivered" },
        { value: "38", suffix: "", label: "Active clients" },
        { value: "06", suffix: "y", label: "In practice" },
      ],
      portfolioTitle: "Selected work",
      portfolioMeta: "06 of 120 - Click for case",
      servicesMeta: "Click a category to brief us",
      ctaTitlePre: "Got a brand ",
      ctaTitleEm: "worth",
      ctaTitleSecond: "looking at?",
      ctaText: "Brief us in 90 seconds. Most projects start within a week and ship the first proof inside 10 days.",
      ctaButton: "Start a graphic brief",
    },
    webdev: {
      heroEyebrow: "02 - Discipline B",
      heroTitleTop: "Software",
      heroTitleEm: "Development",
      heroTitleSuffix: ".",
      heroSub: "Engineered websites, web apps and storefronts. Type-safe, fast, search-friendly - built to convert and built to last.",
      heroCta: "Enter Software Studio",
      heroStats: [
        { value: "84", suffix: "+", label: "Sites launched" },
        { value: "99", suffix: "%", label: "Lighthouse avg." },
      ],
      pageEyebrow: "Studio B - Software Development",
      pageTitlePre: "Sites that ",
      pageTitleEm: "load",
      pageTitlePost: "",
      pageTitleSecond: "and sites that sell.",
      pageLede: "From a one-screen landing page to a typed, indexed e-commerce platform - we ship production code with measurable performance and a tidy handoff.",
      pageStats: [
        { value: "84", suffix: "+", label: "Sites launched" },
        { value: "99", suffix: "%", label: "Lighthouse avg." },
        { value: "12", suffix: "d", label: "Avg. time to launch" },
      ],
      portfolioTitle: "Selected builds",
      portfolioMeta: "06 of 84 - Click for case",
      servicesMeta: "Click a category to scope work",
      ctaTitlePre: "Need a site that ",
      ctaTitleEm: "actually",
      ctaTitleSecond: "performs?",
      ctaText: "Send us a brief or a Figma file. We scope, quote and start within a week - most marketing sites ship in 12 working days.",
      ctaButton: "Start a build brief",
    },
  },
  services: {
    graphic: [
      { num: "01", title: "Packaging Design", desc: "Boxes, labels, tins, sleeves - dielines included.", icon: 0 },
      { num: "02", title: "Flyer Design", desc: "Single-page promos engineered to be read in 3 seconds.", icon: 1 },
      { num: "03", title: "Vector Art", desc: "Original illustration in crisp, scalable vector.", icon: 2 },
      { num: "04", title: "Vector Tracing", desc: "Raster logos rebuilt as production-grade vectors.", icon: 3 },
      { num: "05", title: "Poster Design", desc: "Typographic posters for events, films and brands.", icon: 4 },
      { num: "06", title: "File Conversion", desc: "AI, PSD, PDF, SVG, EPS - clean handoffs.", icon: 5 },
      { num: "07", title: "Embroidery Digitizing", desc: "DST, PES, EXP files for stitch-perfect output.", icon: 6 },
      { num: "08", title: "Business Cards", desc: "Foil, letterpress, soft-touch - the full menu.", icon: 7 },
      { num: "09", title: "Social Media Posts", desc: "Reels covers, carousels and grids that hold attention.", icon: 8 },
      { num: "10", title: "Presentations", desc: "Investor decks, pitch books and sales documents.", icon: 9 },
    ],
    webdev: [
      { num: "01", title: "Website Design", desc: "Marketing sites engineered for clarity and conversion.", icon: 0 },
      { num: "02", title: "Software Development", desc: "Production builds with HTML, CSS and modern JS.", icon: 1 },
      { num: "03", title: "Landing Pages", desc: "One-screen pitches optimized for paid traffic.", icon: 2 },
      { num: "04", title: "Portfolio Sites", desc: "Quiet, fast portfolios that put work first.", icon: 3 },
      { num: "05", title: "Business Websites", desc: "Multi-page sites with CMS and lead capture.", icon: 4 },
      { num: "06", title: "E-commerce", desc: "Shopify, WooCommerce and custom checkout flows.", icon: 5 },
      { num: "07", title: "App Development", desc: "React and React Native apps shipped to stores.", icon: 6 },
      { num: "08", title: "UI / UX Design", desc: "Wireframes, prototypes and design systems.", icon: 7 },
      { num: "09", title: "Frontend", desc: "React, Next.js, Tailwind, TypeScript.", icon: 8 },
      { num: "10", title: "Backend", desc: "Node, PHP, MySQL, Postgres, REST and GraphQL.", icon: 9 },
    ],
  },
  works: {
    graphic: [
      { id: "g1", title: "Sorrel & Stone", cat: "Packaging - Botanical Tea", year: "2025", thumb: "Packaging", pal: 0, span: 6 },
      { id: "g2", title: "Northwind Festival", cat: "Poster Series", year: "2025", thumb: "Poster", pal: 1, span: 3, num: "26" },
      { id: "g3", title: "Atlas Roastery", cat: "Brand Identity", year: "2024", thumb: "Brand", pal: 2, span: 3 },
      { id: "g4", title: "Marlow & Co.", cat: "Stationery System", year: "2024", thumb: "Brand", pal: 3, span: 4 },
      { id: "g5", title: "Hoshi Skincare", cat: "Social Media Suite", year: "2024", thumb: "Social", pal: 4, span: 4 },
      { id: "g6", title: "Ember Films", cat: "Title Sequence", year: "2024", thumb: "Poster", pal: 5, span: 4, num: "07" },
    ],
    webdev: [
      { id: "w1", title: "Halo Bank", cat: "Web App - Fintech", year: "2025", stack: "Next.js - TS - Postgres", thumb: "Dashboard", pal: 0, span: 6 },
      { id: "w2", title: "Pinecrest Realty", cat: "Marketing Site", year: "2025", stack: "Next.js - Sanity", thumb: "WebApp", pal: 1, span: 3 },
      { id: "w3", title: "Loom & Field", cat: "E-commerce", year: "2024", stack: "Shopify Hydrogen", thumb: "WebApp", pal: 2, span: 3 },
      { id: "w4", title: "Open Atlas API", cat: "Developer Tool", year: "2024", stack: "Node - GraphQL", thumb: "Code", pal: 3, span: 4 },
      { id: "w5", title: "Northwind Studio", cat: "Portfolio", year: "2024", stack: "Astro - MDX", thumb: "WebApp", pal: 4, span: 4 },
      { id: "w6", title: "Ledger.io", cat: "SaaS Dashboard", year: "2024", stack: "React - Tailwind", thumb: "Dashboard", pal: 5, span: 4 },
    ],
  },
  // WordPress removed; Kotlin, Flutter, MongoDB, Express.js added
  techStack: ["React", "Next.js", "TypeScript", "Tailwind", "Node.js", "PHP", "MySQL", "Postgres", "MongoDB", "Express.js", "Kotlin", "Flutter", "Shopify", "Figma", "Vercel"],
  cases: window.PortfolioCaseData || {},
};

function cloneContent(value) {
  return JSON.parse(JSON.stringify(value));
}

function mergeContent(defaultValue, savedValue) {
  if (Array.isArray(defaultValue)) {
    return Array.isArray(savedValue) ? savedValue : cloneContent(defaultValue);
  }
  if (defaultValue && typeof defaultValue === "object") {
    const result = {};
    const saved = savedValue && typeof savedValue === "object" ? savedValue : {};
    Object.keys(defaultValue).forEach((key) => {
      result[key] = mergeContent(defaultValue[key], saved[key]);
    });
    Object.keys(saved).forEach((key) => {
      if (!(key in result)) result[key] = saved[key];
    });
    return result;
  }
  return savedValue == null ? defaultValue : savedValue;
}

// Synchronous load — returns localStorage content or defaults. Used for first render.
function loadPortfolioContent() {
  try {
    const raw = localStorage.getItem(PORTFOLIO_STORAGE_KEY);
    if (!raw) return cloneContent(PORTFOLIO_DEFAULT_CONTENT);
    return mergeContent(PORTFOLIO_DEFAULT_CONTENT, JSON.parse(raw));
  } catch (error) {
    console.warn("Could not load saved portfolio content.", error);
    return cloneContent(PORTFOLIO_DEFAULT_CONTENT);
  }
}

// Async load — fetches from Supabase, caches in localStorage, falls back to localStorage.
async function loadPortfolioContentAsync() {
  const sb = window.PortfolioSupabase;
  if (!sb) return loadPortfolioContent();

  try {
    const { data, error } = await sb
      .from("portfolio_content")
      .select("content_json")
      .eq("id", PORTFOLIO_CONTENT_ROW_ID)
      .maybeSingle();

    if (error) throw error;
    if (!data || !data.content_json) return loadPortfolioContent();

    const merged = mergeContent(PORTFOLIO_DEFAULT_CONTENT, data.content_json);
    try { localStorage.setItem(PORTFOLIO_STORAGE_KEY, JSON.stringify(merged)); } catch (_) {}
    return merged;
  } catch (err) {
    console.warn("[RAISA] Supabase load failed, using localStorage fallback.", err);
    return loadPortfolioContent();
  }
}

// Async save — writes to Supabase (primary) and localStorage (cache/fallback).
// Throws if Supabase is configured but the save fails, so the admin can see the error.
async function savePortfolioContent(content) {
  try { localStorage.setItem(PORTFOLIO_STORAGE_KEY, JSON.stringify(content)); } catch (_) {}

  const sb = window.PortfolioSupabase;
  if (sb) {
    const { error } = await sb
      .from("portfolio_content")
      .upsert(
        { id: PORTFOLIO_CONTENT_ROW_ID, content_json: content, updated_at: new Date().toISOString() },
        { onConflict: "id" }
      );
    if (error) throw error;
  }

  window.dispatchEvent(new CustomEvent("portfolio-content-saved", { detail: content }));
}

// Async reset — deletes from Supabase and localStorage, returns fresh defaults.
async function resetPortfolioContent() {
  const fresh = cloneContent(PORTFOLIO_DEFAULT_CONTENT);
  try { localStorage.removeItem(PORTFOLIO_STORAGE_KEY); } catch (_) {}

  const sb = window.PortfolioSupabase;
  if (sb) {
    try {
      await sb.from("portfolio_content").delete().eq("id", PORTFOLIO_CONTENT_ROW_ID);
    } catch (_) {}
  }

  window.dispatchEvent(new CustomEvent("portfolio-content-saved", { detail: fresh }));
  return fresh;
}

function normalizePortfolioContent(content) {
  return mergeContent(PORTFOLIO_DEFAULT_CONTENT, content);
}

window.PortfolioContent = {
  key: PORTFOLIO_STORAGE_KEY,
  defaults: PORTFOLIO_DEFAULT_CONTENT,
  clone: cloneContent,
  merge: mergeContent,
  normalize: normalizePortfolioContent,
  load: loadPortfolioContent,
  loadAsync: loadPortfolioContentAsync,
  save: savePortfolioContent,
  reset: resetPortfolioContent,
};
