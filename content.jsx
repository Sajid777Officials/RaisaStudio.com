// Editable content and persistence for the portfolio.
// Visitors only receive the published snapshot. Authenticated staff work on a
// separate draft through role-protected Supabase RPC functions.
const PORTFOLIO_STORAGE_KEY = "raisa-portfolio-published-v2";
const PORTFOLIO_MEDIA_MANIFEST_KEY = "raisa-portfolio-signed-media-v1";
const PORTFOLIO_CACHE_ENVELOPE_VERSION = 1;
const PORTFOLIO_PUBLIC_CACHE_MAX_AGE_MS = 5 * 60 * 1000;
const PORTFOLIO_MEDIA_SIGNED_TTL_SECONDS = 5 * 60;
const PORTFOLIO_MEDIA_REFRESH_SKEW_MS = 60 * 1000;
const PORTFOLIO_SEED_DATE = "2026-07-08T00:00:00.000Z";
// First formal persisted-document contract. The localStorage key's historical
// "v2" suffix is a cache namespace and is not a content schema version.
const PORTFOLIO_SCHEMA_VERSION = 1;

function contentSlugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const GRAPHIC_SERVICE_CATEGORIES = [
  {
    id: "packaging-design",
    name: "Packaging Design",
    title: "Packaging Design",
    slug: "packaging-design",
    icon: 0,
    short_description: "Boxes, labels, tins, sleeves - dielines included.",
    desc: "Boxes, labels, tins, sleeves - dielines included.",
    order: 1,
    num: "01",
    is_active: true,
    created_at: PORTFOLIO_SEED_DATE,
    updated_at: PORTFOLIO_SEED_DATE,
  },
  {
    id: "flyer-design",
    name: "Flyer Design",
    title: "Flyer Design",
    slug: "flyer-design",
    icon: 1,
    short_description: "Single-page promos engineered to be read in 3 seconds.",
    desc: "Single-page promos engineered to be read in 3 seconds.",
    order: 2,
    num: "02",
    is_active: true,
    created_at: PORTFOLIO_SEED_DATE,
    updated_at: PORTFOLIO_SEED_DATE,
  },
  {
    id: "vector-art",
    name: "Vector Art",
    title: "Vector Art",
    slug: "vector-art",
    icon: 2,
    short_description: "Original illustration in crisp, scalable vector.",
    desc: "Original illustration in crisp, scalable vector.",
    order: 3,
    num: "03",
    is_active: true,
    created_at: PORTFOLIO_SEED_DATE,
    updated_at: PORTFOLIO_SEED_DATE,
  },
  {
    id: "vector-tracing",
    name: "Vector Tracing",
    title: "Vector Tracing",
    slug: "vector-tracing",
    icon: 3,
    short_description: "Raster logos rebuilt as production-grade vectors.",
    desc: "Raster logos rebuilt as production-grade vectors.",
    order: 4,
    num: "04",
    is_active: true,
    created_at: PORTFOLIO_SEED_DATE,
    updated_at: PORTFOLIO_SEED_DATE,
  },
  {
    id: "poster-design",
    name: "Poster Design",
    title: "Poster Design",
    slug: "poster-design",
    icon: 4,
    short_description: "Typographic posters for events, films and brands.",
    desc: "Typographic posters for events, films and brands.",
    order: 5,
    num: "05",
    is_active: true,
    created_at: PORTFOLIO_SEED_DATE,
    updated_at: PORTFOLIO_SEED_DATE,
  },
  {
    id: "file-conversion",
    name: "File Conversion",
    title: "File Conversion",
    slug: "file-conversion",
    icon: 5,
    short_description: "AI, PSD, PDF, SVG, EPS - clean handoffs.",
    desc: "AI, PSD, PDF, SVG, EPS - clean handoffs.",
    order: 6,
    num: "06",
    is_active: true,
    created_at: PORTFOLIO_SEED_DATE,
    updated_at: PORTFOLIO_SEED_DATE,
  },
  {
    id: "embroidery-digitizing",
    name: "Embroidery Digitizing",
    title: "Embroidery Digitizing",
    slug: "embroidery-digitizing",
    icon: 6,
    short_description: "DST, PES, EXP files for stitch-perfect output.",
    desc: "DST, PES, EXP files for stitch-perfect output.",
    order: 7,
    num: "07",
    is_active: true,
    created_at: PORTFOLIO_SEED_DATE,
    updated_at: PORTFOLIO_SEED_DATE,
  },
  {
    id: "business-cards",
    name: "Business Cards",
    title: "Business Cards",
    slug: "business-cards",
    icon: 7,
    short_description: "Foil, letterpress, soft-touch - the full menu.",
    desc: "Foil, letterpress, soft-touch - the full menu.",
    order: 8,
    num: "08",
    is_active: true,
    created_at: PORTFOLIO_SEED_DATE,
    updated_at: PORTFOLIO_SEED_DATE,
  },
  {
    id: "social-media-posts",
    name: "Social Media Posts",
    title: "Social Media Posts",
    slug: "social-media-posts",
    icon: 8,
    short_description: "Reels covers, carousels and grids that hold attention.",
    desc: "Reels covers, carousels and grids that hold attention.",
    order: 9,
    num: "09",
    is_active: true,
    created_at: PORTFOLIO_SEED_DATE,
    updated_at: PORTFOLIO_SEED_DATE,
  },
  {
    id: "presentations",
    name: "Presentations",
    title: "Presentations",
    slug: "presentations",
    icon: 9,
    short_description: "Investor decks, pitch books and sales documents.",
    desc: "Investor decks, pitch books and sales documents.",
    order: 10,
    num: "10",
    is_active: true,
    created_at: PORTFOLIO_SEED_DATE,
    updated_at: PORTFOLIO_SEED_DATE,
  },
];

const WEBDEV_SERVICE_CATEGORIES = [
  {
    id: "website-design",
    name: "Website Design",
    title: "Website Design",
    slug: "website-design",
    icon: 0,
    thumb: "WebApp",
    short_description: "Marketing sites engineered for clarity and conversion.",
    desc: "Marketing sites engineered for clarity and conversion.",
    order: 1,
    num: "01",
    is_active: true,
    created_at: PORTFOLIO_SEED_DATE,
    updated_at: PORTFOLIO_SEED_DATE,
  },
  {
    id: "software-development",
    name: "Software Development",
    title: "Software Development",
    slug: "software-development",
    icon: 1,
    thumb: "Dashboard",
    short_description: "Custom platforms, dashboards, and product workflows.",
    desc: "Custom platforms, dashboards, and product workflows.",
    order: 2,
    num: "02",
    is_active: true,
    created_at: PORTFOLIO_SEED_DATE,
    updated_at: PORTFOLIO_SEED_DATE,
  },
  {
    id: "landing-pages",
    name: "Landing Pages",
    title: "Landing Pages",
    slug: "landing-pages",
    icon: 2,
    thumb: "WebApp",
    short_description: "One-screen pitches optimized for paid traffic.",
    desc: "One-screen pitches optimized for paid traffic.",
    order: 3,
    num: "03",
    is_active: true,
    created_at: PORTFOLIO_SEED_DATE,
    updated_at: PORTFOLIO_SEED_DATE,
  },
  {
    id: "portfolio-sites",
    name: "Portfolio Sites",
    title: "Portfolio Sites",
    slug: "portfolio-sites",
    icon: 3,
    thumb: "WebApp",
    short_description: "Quiet, fast portfolios that put work first.",
    desc: "Quiet, fast portfolios that put work first.",
    order: 4,
    num: "04",
    is_active: true,
    created_at: PORTFOLIO_SEED_DATE,
    updated_at: PORTFOLIO_SEED_DATE,
  },
  {
    id: "business-websites",
    name: "Business Websites",
    title: "Business Websites",
    slug: "business-websites",
    icon: 4,
    thumb: "WebApp",
    short_description: "Multi-page sites with CMS and lead capture.",
    desc: "Multi-page sites with CMS and lead capture.",
    order: 5,
    num: "05",
    is_active: true,
    created_at: PORTFOLIO_SEED_DATE,
    updated_at: PORTFOLIO_SEED_DATE,
  },
  {
    id: "e-commerce",
    name: "E-commerce",
    title: "E-commerce",
    slug: "e-commerce",
    icon: 5,
    thumb: "WebApp",
    short_description: "Shopify, WooCommerce and custom checkout flows.",
    desc: "Shopify, WooCommerce and custom checkout flows.",
    order: 6,
    num: "06",
    is_active: true,
    created_at: PORTFOLIO_SEED_DATE,
    updated_at: PORTFOLIO_SEED_DATE,
  },
  {
    id: "app-development",
    name: "App Development",
    title: "App Development",
    slug: "app-development",
    icon: 6,
    thumb: "Dashboard",
    short_description: "React Native, Flutter and Kotlin apps shipped to stores.",
    desc: "React Native, Flutter and Kotlin apps shipped to stores.",
    order: 7,
    num: "07",
    is_active: true,
    created_at: PORTFOLIO_SEED_DATE,
    updated_at: PORTFOLIO_SEED_DATE,
  },
  {
    id: "ui-ux-design",
    name: "UI / UX Design",
    title: "UI / UX Design",
    slug: "ui-ux-design",
    icon: 7,
    thumb: "Dashboard",
    short_description: "Wireframes, prototypes and design systems.",
    desc: "Wireframes, prototypes and design systems.",
    order: 8,
    num: "08",
    is_active: true,
    created_at: PORTFOLIO_SEED_DATE,
    updated_at: PORTFOLIO_SEED_DATE,
  },
  {
    id: "frontend",
    name: "Frontend",
    title: "Frontend",
    slug: "frontend",
    icon: 8,
    thumb: "Code",
    short_description: "React, Next.js, Tailwind and TypeScript interfaces.",
    desc: "React, Next.js, Tailwind and TypeScript interfaces.",
    order: 9,
    num: "09",
    is_active: true,
    created_at: PORTFOLIO_SEED_DATE,
    updated_at: PORTFOLIO_SEED_DATE,
  },
  {
    id: "backend",
    name: "Backend",
    title: "Backend",
    slug: "backend",
    icon: 9,
    thumb: "Code",
    short_description: "Node, PHP, MySQL, Postgres, REST and GraphQL.",
    desc: "Node, PHP, MySQL, Postgres, REST and GraphQL.",
    order: 10,
    num: "10",
    is_active: true,
    created_at: PORTFOLIO_SEED_DATE,
    updated_at: PORTFOLIO_SEED_DATE,
  },
];

const GRAPHIC_CATEGORY_PROJECTS = [
  {
    id: "project-sorrel-stone-cartons",
    category_id: "packaging-design",
    title: "Sorrel & Stone Tea Cartons",
    slug: "sorrel-stone-tea-cartons",
    short_description: "A shelf-ready botanical tea packaging system with color-coded variants and production dielines.",
    full_description: "Packaging system for a botanical tea range, including box architecture, label hierarchy, dielines, and print-ready handoff files.",
    image_url: "",
    gallery_images: [],
    tags: ["Packaging", "Dielines", "Print"],
    client_name: "Sorrel & Stone Tea",
    project_date: "2025-03-12",
    is_featured: true,
    is_published: true,
    sort_order: 1,
    thumb: "Packaging",
    pal: 0,
    created_at: PORTFOLIO_SEED_DATE,
    updated_at: PORTFOLIO_SEED_DATE,
  },
  {
    id: "project-bloom-market-flyer",
    category_id: "flyer-design",
    title: "Bloom Market Launch Flyer",
    slug: "bloom-market-launch-flyer",
    short_description: "A single-page launch flyer designed for fast scanning, offer clarity, and local print distribution.",
    full_description: "Promotional flyer layout with a strong offer lockup, readable hierarchy, and print/export variants for handouts and social repurposing.",
    image_url: "",
    gallery_images: [],
    tags: ["Flyer", "Promotion", "Print"],
    client_name: "Bloom Market",
    project_date: "2025-02-05",
    is_featured: false,
    is_published: true,
    sort_order: 2,
    thumb: "Poster",
    pal: 1,
    created_at: PORTFOLIO_SEED_DATE,
    updated_at: PORTFOLIO_SEED_DATE,
  },
  {
    id: "project-celeste-vector-set",
    category_id: "vector-art",
    title: "Celeste Vector Illustration Set",
    slug: "celeste-vector-illustration-set",
    short_description: "A crisp icon and illustration set built as scalable vectors for packaging, web, and apparel use.",
    full_description: "Original vector artwork library with modular shapes, clean paths, and export-ready SVG, PDF, and AI files.",
    image_url: "",
    gallery_images: [],
    tags: ["Vector", "Illustration", "SVG"],
    client_name: "Celeste Goods",
    project_date: "2025-01-18",
    is_featured: true,
    is_published: true,
    sort_order: 3,
    thumb: "Brand",
    pal: 2,
    created_at: PORTFOLIO_SEED_DATE,
    updated_at: PORTFOLIO_SEED_DATE,
  },
  {
    id: "project-harbor-logo-trace",
    category_id: "vector-tracing",
    title: "Harbor House Logo Rebuild",
    slug: "harbor-house-logo-rebuild",
    short_description: "A low-resolution logo converted into clean, editable, production-grade vector artwork.",
    full_description: "Vector tracing and logo reconstruction from a raster source, delivered with refined curves and print-safe file formats.",
    image_url: "",
    gallery_images: [],
    tags: ["Vector Tracing", "Logo", "Cleanup"],
    client_name: "Harbor House",
    project_date: "2024-12-11",
    is_featured: false,
    is_published: true,
    sort_order: 4,
    thumb: "Brand",
    pal: 3,
    created_at: PORTFOLIO_SEED_DATE,
    updated_at: PORTFOLIO_SEED_DATE,
  },
  {
    id: "project-northwind-poster-suite",
    category_id: "poster-design",
    title: "Northwind Festival Poster Suite",
    slug: "northwind-festival-poster-suite",
    short_description: "A typographic event poster series with a bold visual system for venue walls and digital promotion.",
    full_description: "Poster direction, typography system, print preparation, and social variants for a music festival campaign.",
    image_url: "",
    gallery_images: [],
    tags: ["Poster", "Typography", "Campaign"],
    client_name: "Northwind Festival",
    project_date: "2025-04-26",
    is_featured: true,
    is_published: true,
    sort_order: 5,
    thumb: "Poster",
    pal: 4,
    num: "26",
    created_at: PORTFOLIO_SEED_DATE,
    updated_at: PORTFOLIO_SEED_DATE,
  },
  {
    id: "project-atlas-file-conversion",
    category_id: "file-conversion",
    title: "Atlas Print File Conversion",
    slug: "atlas-print-file-conversion",
    short_description: "A mixed folder of AI, PSD, PDF, SVG, and EPS assets cleaned into a consistent vendor-ready package.",
    full_description: "Production file conversion, naming cleanup, color checks, and export packaging for print and digital delivery.",
    image_url: "",
    gallery_images: [],
    tags: ["File Conversion", "Prepress", "Handoff"],
    client_name: "Atlas Roastery",
    project_date: "2024-11-22",
    is_featured: false,
    is_published: true,
    sort_order: 6,
    thumb: "Packaging",
    pal: 5,
    created_at: PORTFOLIO_SEED_DATE,
    updated_at: PORTFOLIO_SEED_DATE,
  },
  {
    id: "project-threadline-digitizing",
    category_id: "embroidery-digitizing",
    title: "Threadline Cap Digitizing",
    slug: "threadline-cap-digitizing",
    short_description: "A stitch-ready cap logo digitized for DST, PES, and EXP production with clean thread direction.",
    full_description: "Embroidery digitizing for curved cap placement, including stitch density checks, trims, and multi-format output.",
    image_url: "",
    gallery_images: [],
    tags: ["Embroidery", "DST", "Apparel"],
    client_name: "Threadline Co.",
    project_date: "2024-10-14",
    is_featured: false,
    is_published: true,
    sort_order: 7,
    thumb: "Brand",
    pal: 0,
    created_at: PORTFOLIO_SEED_DATE,
    updated_at: PORTFOLIO_SEED_DATE,
  },
  {
    id: "project-marlow-business-cards",
    category_id: "business-cards",
    title: "Marlow & Co. Business Cards",
    slug: "marlow-co-business-cards",
    short_description: "A premium business card system with foil accents, restrained type, and tactile production details.",
    full_description: "Business card design and print preparation with partner variations, foil specification, and soft-touch finish notes.",
    image_url: "",
    gallery_images: [],
    tags: ["Business Cards", "Foil", "Stationery"],
    client_name: "Marlow & Co.",
    project_date: "2024-09-19",
    is_featured: false,
    is_published: true,
    sort_order: 8,
    thumb: "Brand",
    pal: 2,
    created_at: PORTFOLIO_SEED_DATE,
    updated_at: PORTFOLIO_SEED_DATE,
  },
  {
    id: "project-hoshi-social-system",
    category_id: "social-media-posts",
    title: "Hoshi Social Launch Grid",
    slug: "hoshi-social-launch-grid",
    short_description: "A modular social media post system for carousels, reel covers, product education, and campaign drops.",
    full_description: "Reusable social templates, launch grid direction, and post variants built to keep the feed consistent across channels.",
    image_url: "",
    gallery_images: [],
    tags: ["Social", "Carousel", "Templates"],
    client_name: "Hoshi Skincare",
    project_date: "2024-08-08",
    is_featured: true,
    is_published: true,
    sort_order: 9,
    thumb: "Social",
    pal: 4,
    created_at: PORTFOLIO_SEED_DATE,
    updated_at: PORTFOLIO_SEED_DATE,
  },
  {
    id: "project-orbit-investor-deck",
    category_id: "presentations",
    title: "Orbit Labs Investor Deck",
    slug: "orbit-labs-investor-deck",
    short_description: "A clean investor presentation with narrative structure, visual hierarchy, and polished export files.",
    full_description: "Pitch deck design with slide system, charts, visual pacing, and presentation-ready PDF and editable source files.",
    image_url: "",
    gallery_images: [],
    tags: ["Presentation", "Pitch Deck", "Slides"],
    client_name: "Orbit Labs",
    project_date: "2024-07-30",
    is_featured: false,
    is_published: true,
    sort_order: 10,
    thumb: "Poster",
    pal: 1,
    created_at: PORTFOLIO_SEED_DATE,
    updated_at: PORTFOLIO_SEED_DATE,
  },
];

const WEBDEV_CATEGORY_PROJECTS = [
  {
    id: "project-aura-clinic-website",
    category_id: "website-design",
    title: "Aura Clinic Website",
    slug: "aura-clinic-website",
    short_description: "A polished service website with structured pages, fast booking paths, and local SEO foundations.",
    full_description: "Marketing website build with responsive layouts, accessible components, optimized metadata, and a CMS-ready content model.",
    image_url: "",
    gallery_images: [],
    tags: ["Website", "SEO", "CMS"],
    client_name: "Aura Clinic",
    project_date: "2025-04-18",
    stack: "Next.js - CMS - SEO",
    is_featured: true,
    is_published: true,
    sort_order: 1,
    thumb: "WebApp",
    pal: 0,
    created_at: PORTFOLIO_SEED_DATE,
    updated_at: PORTFOLIO_SEED_DATE,
  },
  {
    id: "project-novaops-dispatch-platform",
    category_id: "software-development",
    title: "NovaOps Dispatch Platform",
    slug: "novaops-dispatch-platform",
    short_description: "A custom operations dashboard for jobs, assignments, team status, and client reporting.",
    full_description: "Product workflow build with role-based screens, API integrations, database schema, and a tidy production handoff.",
    image_url: "",
    gallery_images: [],
    tags: ["Dashboard", "Workflow", "API"],
    client_name: "NovaOps",
    project_date: "2025-03-26",
    stack: "React - Node - Postgres",
    is_featured: true,
    is_published: true,
    sort_order: 2,
    thumb: "Dashboard",
    pal: 1,
    created_at: PORTFOLIO_SEED_DATE,
    updated_at: PORTFOLIO_SEED_DATE,
  },
  {
    id: "project-signal-sprint-landing-page",
    category_id: "landing-pages",
    title: "Signal Sprint Landing Page",
    slug: "signal-sprint-landing-page",
    short_description: "A conversion-focused landing page with message hierarchy, analytics events, and fast load times.",
    full_description: "Single-page campaign build with section variants, CTA tracking, responsive performance tuning, and launch-ready hosting.",
    image_url: "",
    gallery_images: [],
    tags: ["Landing Page", "Analytics", "Performance"],
    client_name: "Signal Sprint",
    project_date: "2025-02-17",
    stack: "Astro - Analytics - A/B",
    is_featured: false,
    is_published: true,
    sort_order: 3,
    thumb: "WebApp",
    pal: 2,
    created_at: PORTFOLIO_SEED_DATE,
    updated_at: PORTFOLIO_SEED_DATE,
  },
  {
    id: "project-atelier-motion-portfolio",
    category_id: "portfolio-sites",
    title: "Atelier Motion Portfolio",
    slug: "atelier-motion-portfolio",
    short_description: "A lightweight portfolio for motion work with project indexing, rich case pages, and media-safe loading.",
    full_description: "Portfolio architecture with editorial case layouts, MDX content, lazy media, and a simple update workflow.",
    image_url: "",
    gallery_images: [],
    tags: ["Portfolio", "MDX", "Media"],
    client_name: "Atelier Motion",
    project_date: "2025-01-22",
    stack: "Astro - MDX - Cloudinary",
    is_featured: false,
    is_published: true,
    sort_order: 4,
    thumb: "WebApp",
    pal: 3,
    created_at: PORTFOLIO_SEED_DATE,
    updated_at: PORTFOLIO_SEED_DATE,
  },
  {
    id: "project-harbor-legal-business-site",
    category_id: "business-websites",
    title: "Harbor Legal Business Site",
    slug: "harbor-legal-business-site",
    short_description: "A multi-page business website with service pages, intake forms, and a clean editorial CMS.",
    full_description: "Business site system with lead capture, reusable page sections, schema markup, and content handoff documentation.",
    image_url: "",
    gallery_images: [],
    tags: ["Business Site", "Forms", "CMS"],
    client_name: "Harbor Legal",
    project_date: "2024-12-09",
    stack: "Next.js - Sanity - Forms",
    is_featured: false,
    is_published: true,
    sort_order: 5,
    thumb: "WebApp",
    pal: 4,
    created_at: PORTFOLIO_SEED_DATE,
    updated_at: PORTFOLIO_SEED_DATE,
  },
  {
    id: "project-lumen-home-storefront",
    category_id: "e-commerce",
    title: "Lumen Home Storefront",
    slug: "lumen-home-storefront",
    short_description: "A fast storefront with product storytelling, cart polish, and checkout paths built for repeat buyers.",
    full_description: "E-commerce implementation with product templates, collection filtering, checkout configuration, and performance tuning.",
    image_url: "",
    gallery_images: [],
    tags: ["E-commerce", "Shopify", "Checkout"],
    client_name: "Lumen Home",
    project_date: "2024-11-15",
    stack: "Shopify - Hydrogen - Stripe",
    is_featured: true,
    is_published: true,
    sort_order: 6,
    thumb: "WebApp",
    pal: 5,
    created_at: PORTFOLIO_SEED_DATE,
    updated_at: PORTFOLIO_SEED_DATE,
  },
  {
    id: "project-pulse-habit-mobile-app",
    category_id: "app-development",
    title: "Pulse Habit Mobile App",
    slug: "pulse-habit-mobile-app",
    short_description: "A mobile habit tracker with onboarding, streak logic, reminders, and subscription-ready screens.",
    full_description: "App build covering product flows, state management, Firebase data, reminder UX, and store handoff preparation.",
    image_url: "",
    gallery_images: [],
    tags: ["Mobile App", "Flutter", "Firebase"],
    client_name: "Pulse Labs",
    project_date: "2024-10-02",
    stack: "Flutter - Firebase - RevenueCat",
    is_featured: false,
    is_published: true,
    sort_order: 7,
    thumb: "Dashboard",
    pal: 0,
    created_at: PORTFOLIO_SEED_DATE,
    updated_at: PORTFOLIO_SEED_DATE,
  },
  {
    id: "project-metro-crm-product-ux",
    category_id: "ui-ux-design",
    title: "Metro CRM Product UX",
    slug: "metro-crm-product-ux",
    short_description: "A CRM redesign with cleaner navigation, task flows, component states, and prototype handoff.",
    full_description: "UX pass with wireframes, interaction states, usability notes, and a practical design system for implementation.",
    image_url: "",
    gallery_images: [],
    tags: ["UI UX", "Prototype", "Design System"],
    client_name: "Metro CRM",
    project_date: "2024-09-12",
    stack: "Figma - Design System - Prototype",
    is_featured: false,
    is_published: true,
    sort_order: 8,
    thumb: "Dashboard",
    pal: 1,
    created_at: PORTFOLIO_SEED_DATE,
    updated_at: PORTFOLIO_SEED_DATE,
  },
  {
    id: "project-verde-frontend-system",
    category_id: "frontend",
    title: "Verde Frontend Component System",
    slug: "verde-frontend-component-system",
    short_description: "A typed component library for repeated marketing pages, product cards, filters, and content blocks.",
    full_description: "Frontend system build with reusable components, responsive states, accessibility checks, and documentation examples.",
    image_url: "",
    gallery_images: [],
    tags: ["Frontend", "React", "Components"],
    client_name: "Verde Supply",
    project_date: "2024-08-21",
    stack: "React - TypeScript - Tailwind",
    is_featured: false,
    is_published: true,
    sort_order: 9,
    thumb: "Code",
    pal: 2,
    created_at: PORTFOLIO_SEED_DATE,
    updated_at: PORTFOLIO_SEED_DATE,
  },
  {
    id: "project-ledger-api-backend",
    category_id: "backend",
    title: "Ledger API Backend",
    slug: "ledger-api-backend",
    short_description: "A backend API with authentication, reporting endpoints, database migrations, and deployment scripts.",
    full_description: "Backend service build with GraphQL schema, Postgres models, auth middleware, seed scripts, and production environment notes.",
    image_url: "",
    gallery_images: [],
    tags: ["Backend", "GraphQL", "Postgres"],
    client_name: "Ledger.io",
    project_date: "2024-07-08",
    stack: "Node - GraphQL - Postgres",
    is_featured: true,
    is_published: true,
    sort_order: 10,
    thumb: "Code",
    pal: 3,
    created_at: PORTFOLIO_SEED_DATE,
    updated_at: PORTFOLIO_SEED_DATE,
  },
];

const PORTFOLIO_DEFAULT_CONTENT = {
  schemaVersion: PORTFOLIO_SCHEMA_VERSION,
  // Delivery state is controlled by the backend. It defaults to enabled for
  // source fallback and is overridden by the public RPC when globally hidden.
  publicEnabled: true,
  site: {
    brandName: "RAISA Studio",
    logoMark: "V",
    trademark: "TM",
    contactEmail: "hello@raisastudio.com",
    metaTitle: "RAISA Studio - Graphic Design x Software Development",
    metaDescription: "A split-discipline portfolio for graphic design, branding, websites, web apps, and production-ready digital work.",
    contact: {
      email: "hello@raisastudio.com",
      phone: "",
      location: "Available worldwide",
    },
    navigation: [
      { id: "home", label: "Home", target: "home", url: "", is_visible: true, order: 1 },
      { id: "graphic", label: "Graphic Design", target: "graphic", url: "", is_visible: true, order: 2 },
      { id: "webdev", label: "Software Dev", target: "webdev", url: "", is_visible: true, order: 3 },
      { id: "about", label: "About Us", target: "about", url: "", is_visible: true, order: 4 },
    ],
    socialLinks: [
      { id: "github", label: "GitHub", url: "https://github.com/Sajid777Officials", is_visible: true, order: 1 },
      { id: "linkedin", label: "LinkedIn", url: "", is_visible: false, order: 2 },
      { id: "behance", label: "Behance", url: "", is_visible: false, order: 3 },
      { id: "x", label: "X", url: "", is_visible: false, order: 4 },
    ],
    footer: {
      eyebrow: "Graphic design x software development",
      tagline: "Thoughtful identities and production-ready digital products, built under one roof.",
      contactLabel: "Start a project",
      copyright: "RAISA Studio. All rights reserved.",
    },
    seo: {
      title: "RAISA Studio - Graphic Design x Software Development",
      description: "A split-discipline portfolio for graphic design, branding, websites, web apps, and production-ready digital work.",
      canonicalUrl: "",
      ogImage: "",
      noIndex: false,
    },
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
      backLabel: "Back to hero",
      crumbLabel: "Index / Studio A - Graphic Design",
      servicesTitle: "Services",
      servicesSubtitle: "/ ten disciplines",
      categoryCrumbLabel: "Services",
      allServicesLabel: "All services",
      workCtaLabel: "View case",
      projectCtaLabel: "View details",
      loadMoreLabel: "Load more",
      showServices: true,
      showPortfolio: true,
      showAbout: true,
      portfolioTitle: "Selected work",
      portfolioMeta: "06 of 120 - Click for case",
      servicesMeta: "Click a category to brief us",
      aboutEyebrow: "About us",
      aboutTitle: "A focused studio for brands that need to look intentional everywhere.",
      aboutLead: "RAISA Studio blends graphic design, production discipline and digital thinking for founders, teams and independent brands.",
      aboutBody: "We shape identity systems, packaging, print materials and campaign assets with a practical process: clear direction first, polished execution next, and files prepared for the people who have to use them after launch.",
      aboutPillars: ["Brand systems", "Print-ready craft", "Launch support"],
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
      backLabel: "Back to hero",
      crumbLabel: "Index / Studio B - Software Development",
      stackLabel: "Stack -",
      servicesTitle: "Services",
      servicesSubtitle: "/ ten disciplines",
      categoryCrumbLabel: "Services",
      allServicesLabel: "All services",
      workCtaLabel: "View build",
      projectCtaLabel: "View details",
      loadMoreLabel: "Load more",
      showTechStack: true,
      showServices: true,
      showPortfolio: true,
      showAbout: true,
      portfolioTitle: "Selected builds",
      portfolioMeta: "06 of 84 - Click for case",
      servicesMeta: "Click a category to scope work",
      aboutEyebrow: "About us",
      aboutTitle: "A software studio for fast, usable products that keep working after launch.",
      aboutLead: "RAISA Studio builds marketing sites, web apps and storefronts with the same care we bring to visual systems.",
      aboutBody: "We focus on readable interfaces, production-ready code and practical handoff, so your site can be updated, measured and improved without starting over every time the business moves.",
      aboutPillars: ["Fast interfaces", "Stable backends", "Clean handoff"],
    },
  },
  services: {
    graphic: GRAPHIC_SERVICE_CATEGORIES,
    webdev: WEBDEV_SERVICE_CATEGORIES,
  },
  works: {
    graphic: [
      { id: "g1", category_id: "packaging-design", title: "Sorrel & Stone", cat: "Packaging - Botanical Tea", year: "2025", thumb: "Packaging", pal: 0, span: 6 },
      { id: "g2", category_id: "poster-design", title: "Northwind Festival", cat: "Poster Series", year: "2025", thumb: "Poster", pal: 1, span: 3, num: "26" },
      { id: "g3", category_id: "vector-art", title: "Atlas Roastery", cat: "Brand Identity", year: "2024", thumb: "Brand", pal: 2, span: 3 },
      { id: "g4", category_id: "business-cards", title: "Marlow & Co.", cat: "Stationery System", year: "2024", thumb: "Brand", pal: 3, span: 4 },
      { id: "g5", category_id: "social-media-posts", title: "Hoshi Skincare", cat: "Social Media Suite", year: "2024", thumb: "Social", pal: 4, span: 4 },
      { id: "g6", category_id: "poster-design", title: "Ember Films", cat: "Title Sequence", year: "2024", thumb: "Poster", pal: 5, span: 4, num: "07" },
    ],
    webdev: [
      { id: "w1", category_id: "software-development", title: "Halo Bank", cat: "Web App - Fintech", year: "2025", stack: "Next.js - TS - Postgres", thumb: "Dashboard", pal: 0, span: 6 },
      { id: "w2", category_id: "business-websites", title: "Pinecrest Realty", cat: "Marketing Site", year: "2025", stack: "Next.js - Sanity", thumb: "WebApp", pal: 1, span: 3 },
      { id: "w3", category_id: "e-commerce", title: "Loom & Field", cat: "E-commerce", year: "2024", stack: "Shopify Hydrogen", thumb: "WebApp", pal: 2, span: 3 },
      { id: "w4", category_id: "backend", title: "Open Atlas API", cat: "Developer Tool", year: "2024", stack: "Node - GraphQL", thumb: "Code", pal: 3, span: 4 },
      { id: "w5", category_id: "portfolio-sites", title: "Northwind Studio", cat: "Portfolio", year: "2024", stack: "Astro - MDX", thumb: "WebApp", pal: 4, span: 4 },
      { id: "w6", category_id: "frontend", title: "Ledger.io", cat: "SaaS Dashboard", year: "2024", stack: "React - Tailwind", thumb: "Dashboard", pal: 5, span: 4 },
    ],
  },
  projects: {
    graphic: GRAPHIC_CATEGORY_PROJECTS,
    webdev: WEBDEV_CATEGORY_PROJECTS,
  },
  // WordPress removed; Kotlin, Flutter, MongoDB, Express.js added
  techStack: ["React", "Next.js", "TypeScript", "Tailwind", "Node.js", "PHP", "MySQL", "Postgres", "MongoDB", "Express.js", "Kotlin", "Flutter", "Shopify", "Figma", "Vercel"],
  integrations: {
    github: {
      enabled: true,
      username: "Sajid777Officials",
      eyebrow: "Live - syncs automatically",
      title: "GitHub Projects",
      linkLabel: "View all on GitHub",
      limit: 12,
    },
  },
  cases: window.PortfolioCaseData || {},
};

function cloneContent(value) {
  return JSON.parse(JSON.stringify(value));
}

function contentHasOwn(value, key) {
  return Boolean(value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, key));
}

function assertSupportedContentSchema(content) {
  if (!content || typeof content !== "object" || Array.isArray(content)) return;
  if (!contentHasOwn(content, "schemaVersion")) return;

  const schemaVersion = Number(content.schemaVersion);
  if (!Number.isInteger(schemaVersion) || schemaVersion < 1) {
    throw new Error("Portfolio content has an invalid schemaVersion.");
  }
  if (schemaVersion > PORTFOLIO_SCHEMA_VERSION) {
    throw new Error(
      `Portfolio content schemaVersion ${schemaVersion} is newer than this app supports (${PORTFOLIO_SCHEMA_VERSION}).`
    );
  }
}

function normalizeServiceCategory(service, index) {
  const source = service && typeof service === "object" ? service : {};
  const title = contentHasOwn(source, "title")
    ? String(source.title ?? "")
    : String(source.name ?? `Category ${index + 1}`);
  const description = contentHasOwn(source, "desc")
    ? String(source.desc ?? "")
    : String(source.short_description ?? source.shortDescription ?? "");
  const displayTitle = title || `Category ${index + 1}`;
  const slug = contentSlugify(source.slug || source.id || displayTitle) || `category-${index + 1}`;
  const order = Number.isFinite(Number(source.order)) ? Number(source.order) : index + 1;

  return {
    ...source,
    id: source.id || slug,
    name: title,
    title,
    slug,
    icon: Number.isFinite(Number(source.icon)) ? Number(source.icon) : index,
    icon_url: source.icon_url || "",
    short_description: description,
    shortDescription: description,
    desc: description,
    order,
    num: source.num || String(order).padStart(2, "0"),
    is_active: source.is_active !== false,
    created_at: source.created_at || PORTFOLIO_SEED_DATE,
    updated_at: source.updated_at || PORTFOLIO_SEED_DATE,
  };
}

function contentServiceCategoryResolution(categories) {
  const aliases = new Map();
  const canonical = [];
  (Array.isArray(categories) ? categories : []).forEach((category) => {
    const id = String(category?.id || "").trim();
    const slug = String(category?.slug || "").trim();
    const value = slug || id;
    if (!value) return;
    canonical.push(value);
    if (id && !aliases.has(id)) aliases.set(id, value);
    if (slug && !aliases.has(slug)) aliases.set(slug, value);
  });
  return { aliases, canonical };
}

function normalizeProject(project, index, categories) {
  const source = project && typeof project === "object" && !Array.isArray(project) ? project : {};
  const title = contentHasOwn(source, "title")
    ? String(source.title ?? "")
    : `Project ${index + 1}`;
  const fallbackCategory = categories[index % Math.max(categories.length, 1)] || {};
  const categoryResolution = contentServiceCategoryResolution(categories);
  const suppliedCategoryId = String(
    source.category_id ?? source.categoryId ?? source.category_slug ?? ""
  ).trim();
  const categoryId = categoryResolution.aliases.get(suppliedCategoryId)
    || categoryResolution.canonical[index % Math.max(categoryResolution.canonical.length, 1)]
    || String(fallbackCategory.slug || fallbackCategory.id || "");
  const slug = contentSlugify(source.slug || title) || `project-${index + 1}`;
  const id = String(source.id || `project-${slug}`);
  const imageUrl = typeof (source.image_url || source.image) === "string"
    ? (source.image_url || source.image)
    : "";

  const normalized = {
    ...source,
    id,
    category_id: categoryId,
    title,
    slug,
    short_description: String(source.short_description || source.shortDescription || source.desc || ""),
    full_description: String(source.full_description || source.fullDescription || source.description || ""),
    image_url: imageUrl,
    gallery_images: normalizeProjectImages(source.gallery_images || source.images || [], id),
    tags: Array.isArray(source.tags)
      ? source.tags.map((tag) => String(tag ?? "")).filter(Boolean)
      : String(source.tags || "").split(",").map(tag => tag.trim()).filter(Boolean),
    client_name: String(source.client_name || source.clientName || ""),
    project_date: String(source.project_date || source.projectDate || source.year || ""),
    is_featured: source.is_featured === true,
    is_published: source.is_published !== false,
    sort_order: Number.isFinite(Number(source.sort_order)) ? Number(source.sort_order) : index + 1,
    thumb: String(source.thumb || fallbackCategory.thumb || "Brand"),
    pal: Number.isFinite(Number(source.pal)) ? Number(source.pal) : index % 6,
    created_at: source.created_at || PORTFOLIO_SEED_DATE,
    updated_at: source.updated_at || PORTFOLIO_SEED_DATE,
  };
  delete normalized.images;
  return normalized;
}

function normalizeCategoryProjects(projects, categories) {
  const savedProjects = Array.isArray(projects) ? projects : [];
  return savedProjects
    .map((project, index) => normalizeProject(project, index, categories))
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
}

function normalizeProjectImages(images, projectId) {
  if (!Array.isArray(images)) return [];
  return images
    .map((image, index) => {
      const source = image && typeof image === "object" && !Array.isArray(image) ? image : {};
      const imageUrl = typeof image === "string"
        ? image
        : typeof (source.image_url || source.url || source.src) === "string"
          ? (source.image_url || source.url || source.src)
          : "";
      const normalized = {
        ...source,
        id: source.id || `${projectId || "project"}-image-${index + 1}`,
        project_id: projectId || source.project_id || "",
        image_url: imageUrl,
        caption: String(source.caption || ""),
        alt_text: String(source.alt_text || source.alt || ""),
        sort_order: Number.isFinite(Number(source.sort_order)) ? Number(source.sort_order) : index + 1,
        created_at: source.created_at || PORTFOLIO_SEED_DATE,
        updated_at: source.updated_at || PORTFOLIO_SEED_DATE,
      };
      delete normalized.url;
      delete normalized.src;
      delete normalized.alt;
      return normalized;
    })
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
}

function normalizeWorkProject(work, index, side, categories) {
  const source = work && typeof work === "object" && !Array.isArray(work) ? work : {};
  const title = contentHasOwn(source, "title")
    ? String(source.title ?? "")
    : `Project ${index + 1}`;
  const id = String(source.id || `${side === "webdev" ? "w" : "g"}${index + 1}`);
  const slug = contentSlugify(source.slug || title) || id;
  const categoryResolution = contentServiceCategoryResolution(categories);
  const suppliedCategoryId = String(
    source.category_id ?? source.categoryId ?? source.category_slug ?? ""
  ).trim();
  const categoryId = categoryResolution.aliases.get(suppliedCategoryId)
    || categoryResolution.canonical[index % Math.max(categoryResolution.canonical.length, 1)]
    || "";
  const coverImage = typeof (source.cover_image_url || source.image) === "string"
    ? (source.cover_image_url || source.image)
    : "";

  const normalized = {
    ...source,
    id,
    title,
    slug,
    category_id: categoryId,
    cover_image_url: coverImage,
    short_description: String(source.short_description || source.shortDescription || source.desc || ""),
    full_description: String(source.full_description || source.fullDescription || ""),
    client_name: String(source.client_name || source.clientName || ""),
    year: String(source.year || ""),
    is_featured: source.is_featured === true,
    is_published: source.is_published !== false,
    sort_order: Number.isFinite(Number(source.sort_order)) ? Number(source.sort_order) : index + 1,
    gallery_images: normalizeProjectImages(source.gallery_images || source.images || [], id),
    created_at: source.created_at || PORTFOLIO_SEED_DATE,
    updated_at: source.updated_at || PORTFOLIO_SEED_DATE,
  };
  delete normalized.categoryId;
  delete normalized.category_slug;
  delete normalized.images;
  return normalized;
}

function findLinkedWork(works, reference, preferredSide) {
  const normalizedReference = String(reference || "").trim();
  if (!normalizedReference) return null;

  const sides = [preferredSide, "graphic", "webdev"].filter(Boolean);
  const seen = new Set();
  for (const side of sides) {
    if (seen.has(side)) continue;
    seen.add(side);
    const work = (works?.[side] || []).find(
      (item) => item.id === normalizedReference || item.slug === normalizedReference
    );
    if (work) return { work, side };
  }
  return null;
}

function normalizePortfolioCases(cases, works) {
  if (!cases || typeof cases !== "object" || Array.isArray(cases)) return {};

  return Object.entries(cases).reduce((result, [caseId, caseValue]) => {
    if (!caseValue || typeof caseValue !== "object" || Array.isArray(caseValue)) return result;

    const explicitProjectId = String(caseValue.project_id || caseValue.projectId || "").trim();
    const linked = findLinkedWork(works, explicitProjectId || caseId, caseValue.side)
      || (explicitProjectId ? findLinkedWork(works, caseId, caseValue.side) : null);

    result[caseId] = {
      ...caseValue,
      // Existing case-map keys stay intact for the current router/admin. A
      // valid explicit id wins; legacy key/slug matching migrates old cases.
      project_id: linked?.work.id || "",
      side: linked?.side || (caseValue.side === "webdev" ? "webdev" : "graphic"),
    };
    delete result[caseId].projectId;
    return result;
  }, {});
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

function normalizePortfolioContent(content) {
  assertSupportedContentSchema(content);
  const sourceSite = content?.site || {};
  const normalized = mergeContent(PORTFOLIO_DEFAULT_CONTENT, content);
  normalized.schemaVersion = PORTFOLIO_SCHEMA_VERSION;

  normalized.site = normalized.site || {};
  normalized.site.contact = normalized.site.contact || {};
  if (sourceSite.contactEmail && !sourceSite.contact?.email) {
    normalized.site.contact.email = sourceSite.contactEmail;
  }
  normalized.site.contactEmail = normalized.site.contact.email || normalized.site.contactEmail || "";

  normalized.site.seo = normalized.site.seo || {};
  if (sourceSite.metaTitle && !sourceSite.seo?.title) normalized.site.seo.title = sourceSite.metaTitle;
  if (sourceSite.metaDescription && !sourceSite.seo?.description) normalized.site.seo.description = sourceSite.metaDescription;
  normalized.site.metaTitle = normalized.site.seo.title || normalized.site.metaTitle || "";
  normalized.site.metaDescription = normalized.site.seo.description || normalized.site.metaDescription || "";

  normalized.site.navigation = (normalized.site.navigation || [])
    .map((item, index) => ({
      ...item,
      id: item.id || `nav-${index + 1}`,
      label: item.label || `Navigation ${index + 1}`,
      target: item.target || "external",
      url: item.url || "",
      is_visible: item.is_visible !== false,
      order: Number.isFinite(Number(item.order)) ? Number(item.order) : index + 1,
    }))
    .sort((a, b) => a.order - b.order);

  const legacySocialLinks = [
    ["github", "GitHub", sourceSite.github],
    ["linkedin", "LinkedIn", sourceSite.linkedin],
    ["x", "X", sourceSite.twitter],
    ["behance", "Behance", sourceSite.behance],
  ].filter(([, , url]) => url);
  if (legacySocialLinks.length && !Array.isArray(sourceSite.socialLinks)) {
    normalized.site.socialLinks = legacySocialLinks.map(([id, label, url], index) => ({
      id,
      label,
      url,
      is_visible: true,
      order: index + 1,
    }));
  }
  normalized.site.socialLinks = (normalized.site.socialLinks || [])
    .map((item, index) => ({
      ...item,
      id: item.id || `social-${index + 1}`,
      label: item.label || `Social ${index + 1}`,
      url: item.url || "",
      is_visible: item.is_visible !== false,
      order: Number.isFinite(Number(item.order)) ? Number(item.order) : index + 1,
    }))
    .sort((a, b) => a.order - b.order);

  normalized.services = normalized.services || {};
  normalized.services.graphic = (normalized.services.graphic || [])
    .map(normalizeServiceCategory)
    .sort((a, b) => (a.order || 0) - (b.order || 0));
  normalized.services.webdev = (normalized.services.webdev || [])
    .map(normalizeServiceCategory)
    .sort((a, b) => (a.order || 0) - (b.order || 0));

  normalized.projects = normalized.projects || {};
  normalized.projects.graphic = normalizeCategoryProjects(
    normalized.projects.graphic,
    normalized.services.graphic
  );
  normalized.projects.webdev = normalizeCategoryProjects(
    normalized.projects.webdev,
    normalized.services.webdev
  );

  normalized.works = normalized.works || {};
  normalized.works.graphic = (normalized.works.graphic || [])
    .map((work, index) => normalizeWorkProject(work, index, "graphic", normalized.services.graphic))
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  normalized.works.webdev = (normalized.works.webdev || [])
    .map((work, index) => normalizeWorkProject(work, index, "webdev", normalized.services.webdev))
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

  // `cases` is a keyed collection, not a partial settings object. If a saved
  // document contains it, even an empty map is authoritative; defaults only
  // apply when the collection is absent (first-run/legacy fallback).
  const sourceCases = contentHasOwn(content, "cases") ? content.cases : normalized.cases;
  normalized.cases = normalizePortfolioCases(sourceCases, normalized.works);

  return normalized;
}

function toPublicPortfolioContent(content) {
  const normalized = normalizePortfolioContent(content);
  const projected = cloneContent(normalized);

  projected.site.navigation = (projected.site.navigation || [])
    .filter((item) => item.is_visible !== false);
  projected.site.socialLinks = (projected.site.socialLinks || [])
    .filter((item) => item.is_visible !== false);

  ["graphic", "webdev"].forEach((side) => {
    projected.services[side] = (projected.services?.[side] || [])
      .filter((service) => service.is_active !== false);
    projected.projects[side] = (projected.projects?.[side] || [])
      .filter((project) => project.is_published !== false);
    projected.works[side] = (projected.works?.[side] || [])
      .filter((work) => work.is_published !== false);
  });

  const publicCases = {};
  Object.entries(projected.cases || {}).forEach(([caseId, caseData]) => {
    if (caseData?.is_published === false) return;
    const linked = findLinkedWork(
      projected.works,
      caseData.project_id || caseId,
      caseData.side
    );
    if (!linked) return;

    const publicCase = {
      ...caseData,
      project_id: linked.work.id,
      side: linked.side,
    };
    publicCases[caseId] = publicCase;

    // The current public router resolves cases by work id or slug. Aliases let
    // an explicitly linked case retain its admin key without changing either
    // component API.
    if (!publicCases[linked.work.id]) publicCases[linked.work.id] = publicCase;
    if (linked.work.slug && !publicCases[linked.work.slug]) {
      publicCases[linked.work.slug] = publicCase;
    }
  });
  projected.cases = publicCases;

  return projected;
}

const PORTFOLIO_MEDIA_TOKEN_PATTERN = /^media:\/\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function portfolioContainsMediaTokens(value) {
  if (typeof value === "string") return PORTFOLIO_MEDIA_TOKEN_PATTERN.test(value.trim());
  if (Array.isArray(value)) return value.some(portfolioContainsMediaTokens);
  if (value && typeof value === "object") return Object.values(value).some(portfolioContainsMediaTokens);
  return false;
}

function isSafePublicMediaUrl(value) {
  const normalized = String(value || "").trim();
  if (!normalized || /[\u0000-\u001f\u007f\s]/.test(normalized)) return false;
  const UrlConstructor = window.URL || (typeof URL === "function" ? URL : null);
  if (!UrlConstructor) {
    return /^https:\/\/[^/]+/i.test(normalized)
      || /^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/i.test(normalized);
  }
  try {
    const parsed = new UrlConstructor(normalized);
    if (parsed.username || parsed.password) return false;
    if (parsed.protocol === "https:") return true;
    return parsed.protocol === "http:"
      && ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
  } catch (_) {
    return false;
  }
}

function isSafePublicMediaPath(value) {
  const normalized = String(value || "").trim();
  if (
    !normalized ||
    normalized.length > 1024 ||
    normalized.startsWith("/") ||
    normalized.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(normalized)
  ) return false;
  try {
    return decodeURIComponent(normalized)
      .split("/")
      .every((segment) => segment && segment !== "." && segment !== "..");
  } catch (_) {
    return false;
  }
}

function isCanonicalDirectPublicMediaUrl(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized.includes("/storage/v1/object/public/portfolio-media-public/")
    || normalized.includes("/storage/v1/object/public/portfolio-media-public%2f");
}

function containsCachedCanonicalMediaUrl(value) {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return isCanonicalDirectPublicMediaUrl(normalized)
      || normalized.includes("/storage/v1/object/sign/portfolio-media-public/")
      || normalized.includes("/storage/v1/object/sign/portfolio-media-public%2f")
      || normalized.includes("/storage/v1/object/authenticated/portfolio-media-public/")
      || normalized.includes("/storage/v1/object/authenticated/portfolio-media-public%2f");
  }
  if (Array.isArray(value)) return value.some(containsCachedCanonicalMediaUrl);
  if (value && typeof value === "object") {
    return Object.values(value).some(containsCachedCanonicalMediaUrl);
  }
  return false;
}

function normalizePublicMediaManifest(manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) return {};
  return Object.entries(manifest).reduce((result, [token, record]) => {
    const publicUrl = String(record?.public_url || "").trim();
    const bucket = String(record?.bucket || "");
    if (
      !PORTFOLIO_MEDIA_TOKEN_PATTERN.test(token) ||
      !isSafePublicMediaUrl(publicUrl) ||
      (bucket === "portfolio-media-public" && isCanonicalDirectPublicMediaUrl(publicUrl))
    ) return result;
    result[token] = { ...record, public_url: publicUrl };
    return result;
  }, {});
}

async function completePublicMediaManifest(manifest, sb) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) return {};
  const completed = {};
  const canonicalRecords = [];

  Object.entries(manifest).forEach(([token, record]) => {
    if (!PORTFOLIO_MEDIA_TOKEN_PATTERN.test(token) || !record || typeof record !== "object") return;
    const bucket = String(record.bucket || "");
    const path = String(record.path || "");
    if (!isSafePublicMediaPath(path)) return;

    if (bucket === "portfolio-media-public") {
      canonicalRecords.push({ token, path, record });
      return;
    }

    if (bucket !== "portfolio-uploads") return;
    let publicUrl = String(record.public_url || "").trim();
    if (!publicUrl) {
      const result = sb?.storage?.from(bucket)?.getPublicUrl(path);
      publicUrl = String(result?.data?.publicUrl || result?.data?.publicURL || "");
    }
    if (!isSafePublicMediaUrl(publicUrl) || isCanonicalDirectPublicMediaUrl(publicUrl)) return;
    completed[token] = { ...record, public_url: publicUrl };
  });

  if (canonicalRecords.length) {
    const signer = sb?.storage?.from("portfolio-media-public");
    if (typeof signer?.createSignedUrls !== "function") {
      throw new Error("The private media signer is unavailable.");
    }
    const paths = canonicalRecords.map((item) => item.path);
    const { data, error } = await signer.createSignedUrls(
      paths,
      PORTFOLIO_MEDIA_SIGNED_TTL_SECONDS
    );
    if (error) throw error;
    if (!Array.isArray(data) || data.length !== canonicalRecords.length) {
      throw new Error("The private media signer returned an incomplete manifest.");
    }
    canonicalRecords.forEach(({ token, path, record }, index) => {
      const signed = data[index];
      const signedUrl = String(signed?.signedUrl || signed?.signedURL || "").trim();
      if (
        signed?.error ||
        (signed?.path && String(signed.path) !== path) ||
        !isSafePublicMediaUrl(signedUrl) ||
        isCanonicalDirectPublicMediaUrl(signedUrl)
      ) {
        throw new Error("The private media signer returned an unsafe URL.");
      }
      completed[token] = { ...record, bucket: "portfolio-media-public", path, public_url: signedUrl };
    });
  }

  return completed;
}

function resolvePortfolioMediaTokens(value, manifest, unresolved) {
  if (typeof value === "string") {
    const token = value.trim();
    if (!PORTFOLIO_MEDIA_TOKEN_PATTERN.test(token)) return value;
    const publicUrl = manifest[token]?.public_url;
    if (!publicUrl) {
      unresolved.add(token);
      return "";
    }
    return publicUrl;
  }
  if (Array.isArray(value)) {
    return value.map((item) => resolvePortfolioMediaTokens(item, manifest, unresolved));
  }
  if (value && typeof value === "object") {
    return Object.entries(value).reduce((result, [key, item]) => {
      result[key] = resolvePortfolioMediaTokens(item, manifest, unresolved);
      return result;
    }, {});
  }
  return value;
}

function hydratePublicPortfolioMedia(content, manifest = {}) {
  const projected = toPublicPortfolioContent(content);
  if (!portfolioContainsMediaTokens(projected)) return projected;

  const unresolved = new Set();
  const hydrated = resolvePortfolioMediaTokens(
    projected,
    normalizePublicMediaManifest(manifest),
    unresolved
  );
  if (unresolved.size) {
    throw new Error(`Published media is not ready for ${unresolved.size} referenced asset${unresolved.size === 1 ? "" : "s"}.`);
  }
  return hydrated;
}

async function loadPublicMediaManifest(sb) {
  const { data, error } = await sb.rpc("get_public_media_manifest");
  if (error) throw error;
  const manifest = await completePublicMediaManifest(data, sb);
  const now = Date.now();
  return {
    version: PORTFOLIO_CACHE_ENVELOPE_VERSION,
    cachedAt: now,
    refreshAt: now + (PORTFOLIO_MEDIA_SIGNED_TTL_SECONDS * 1000) - PORTFOLIO_MEDIA_REFRESH_SKEW_MS,
    expiresAt: now + (PORTFOLIO_MEDIA_SIGNED_TTL_SECONDS * 1000),
    manifest,
  };
}

// Synchronous first render uses only a fresh public cache. An unconfigured
// source build may still use defaults; a configured production build fails
// closed until its public RPC refresh completes.
function unavailablePortfolioContent() {
  return toPublicPortfolioContent({
    schemaVersion: PORTFOLIO_SCHEMA_VERSION,
    publicEnabled: false,
  });
}

function clearPublishedContentCache() {
  try {
    localStorage.removeItem(PORTFOLIO_STORAGE_KEY);
    localStorage.removeItem(PORTFOLIO_MEDIA_MANIFEST_KEY);
  } catch (_) {}
}

function readPublishedCacheEnvelope() {
  const raw = localStorage.getItem(PORTFOLIO_STORAGE_KEY);
  if (!raw) return null;
  const parsed = JSON.parse(raw);
  if (
    parsed &&
    typeof parsed === "object" &&
    parsed.version === PORTFOLIO_CACHE_ENVELOPE_VERSION &&
    parsed.content &&
    typeof parsed.content === "object"
  ) {
    return parsed;
  }

  // Older releases cached the hydrated public document directly. Keep safe
  // legacy `portfolio-uploads` URLs for unconfigured/offline builds, but never
  // reuse a canonical private-bucket URL or treat an undated cache as fresh
  // when a backend is configured.
  return {
    version: 0,
    cachedAt: 0,
    expiresAt: 0,
    content: toPublicPortfolioContent(parsed),
  };
}

function readSignedManifestEnvelope() {
  const raw = localStorage.getItem(PORTFOLIO_MEDIA_MANIFEST_KEY);
  if (!raw) return null;
  const parsed = JSON.parse(raw);
  if (
    !parsed ||
    typeof parsed !== "object" ||
    parsed.version !== PORTFOLIO_CACHE_ENVELOPE_VERSION ||
    !Number.isFinite(Number(parsed.expiresAt)) ||
    !parsed.manifest ||
    typeof parsed.manifest !== "object"
  ) return null;
  return {
    ...parsed,
    expiresAt: Number(parsed.expiresAt),
    refreshAt: Number(parsed.refreshAt || 0),
    manifest: normalizePublicMediaManifest(parsed.manifest),
  };
}

function loadPortfolioContent() {
  const backendConfigured = Boolean(window.PortfolioSupabase);
  try {
    const envelope = readPublishedCacheEnvelope();
    if (!envelope) {
      return backendConfigured
        ? unavailablePortfolioContent()
        : hydratePublicPortfolioMedia(PORTFOLIO_DEFAULT_CONTENT);
    }
    if (containsCachedCanonicalMediaUrl(envelope.content)) {
      clearPublishedContentCache();
      return backendConfigured
        ? unavailablePortfolioContent()
        : hydratePublicPortfolioMedia(PORTFOLIO_DEFAULT_CONTENT);
    }
    if (envelope.content.publicEnabled === false) return unavailablePortfolioContent();
    if (backendConfigured && Number(envelope.expiresAt || 0) <= Date.now()) {
      return unavailablePortfolioContent();
    }

    const projected = toPublicPortfolioContent(envelope.content);
    if (!portfolioContainsMediaTokens(projected)) return projected;
    const mediaEnvelope = readSignedManifestEnvelope();
    if (!mediaEnvelope || mediaEnvelope.expiresAt <= Date.now()) {
      return backendConfigured
        ? unavailablePortfolioContent()
        : hydratePublicPortfolioMedia(PORTFOLIO_DEFAULT_CONTENT);
    }
    return hydratePublicPortfolioMedia(projected, mediaEnvelope.manifest);
  } catch (error) {
    console.warn("Could not load saved portfolio content.", error);
    return backendConfigured
      ? unavailablePortfolioContent()
      : hydratePublicPortfolioMedia(PORTFOLIO_DEFAULT_CONTENT);
  }
}

function cachePublishedContent(content, mediaEnvelope = null) {
  const projected = toPublicPortfolioContent(content);
  if (projected.publicEnabled === false || containsCachedCanonicalMediaUrl(projected)) {
    clearPublishedContentCache();
    return unavailablePortfolioContent();
  }

  const now = Date.now();
  const hasManagedMedia = portfolioContainsMediaTokens(projected);
  const manifest = hasManagedMedia ? mediaEnvelope?.manifest : {};
  if (hasManagedMedia && (!mediaEnvelope || Number(mediaEnvelope.expiresAt || 0) <= now)) {
    throw new Error("The signed media manifest has expired.");
  }
  const expiresAt = Math.min(
    now + PORTFOLIO_PUBLIC_CACHE_MAX_AGE_MS,
    hasManagedMedia ? Number(mediaEnvelope.expiresAt) : Number.MAX_SAFE_INTEGER
  );
  const envelope = {
    version: PORTFOLIO_CACHE_ENVELOPE_VERSION,
    cachedAt: now,
    expiresAt,
    content: projected,
  };
  const hydrated = hydratePublicPortfolioMedia(projected, manifest);
  try {
    localStorage.setItem(PORTFOLIO_STORAGE_KEY, JSON.stringify(envelope));
    if (hasManagedMedia) {
      localStorage.setItem(PORTFOLIO_MEDIA_MANIFEST_KEY, JSON.stringify(mediaEnvelope));
    } else {
      localStorage.removeItem(PORTFOLIO_MEDIA_MANIFEST_KEY);
    }
  } catch (_) {}
  return hydrated;
}

function requirePortfolioBackend() {
  const sb = window.PortfolioSupabase;
  if (!sb) throw new Error("The secure content backend is not configured.");
  return sb;
}

// Public load: the RPC can only return the published snapshot. On a temporary
// network failure, visitors receive a still-fresh public cache; once its short
// TTL expires, the configured site renders its unavailable state.
async function loadPortfolioContentAsync() {
  const sb = window.PortfolioSupabase;
  if (!sb) return loadPortfolioContent();

  try {
    const { data, error } = await sb.rpc("get_published_portfolio");
    if (error) throw error;
    if (data && typeof data === "object" && !Array.isArray(data) && !Object.keys(data).length) {
      clearPublishedContentCache();
      return unavailablePortfolioContent();
    }
    if (!data || typeof data !== "object" || Array.isArray(data) || data.publicEnabled === false) {
      clearPublishedContentCache();
      return unavailablePortfolioContent();
    }
    const manifestEnvelope = portfolioContainsMediaTokens(data)
      ? await loadPublicMediaManifest(sb)
      : null;
    return cachePublishedContent(data, manifestEnvelope);
  } catch (err) {
    console.warn("[RAISA] Published content refresh failed; using the last safe cache.", err);
    return loadPortfolioContent();
  }
}

async function getPortfolioAdminProfile() {
  const sb = requirePortfolioBackend();
  const { data, error } = await sb.rpc("get_admin_profile");
  if (error) throw error;
  if (!data || typeof data !== "object" || !data.is_active) return null;
  return {
    userId: data.user_id,
    role: data.role,
    isActive: data.is_active === true,
  };
}

async function loadPortfolioAdminState() {
  const sb = requirePortfolioBackend();
  const { data, error } = await sb.rpc("get_portfolio_admin_state");
  if (error) throw error;
  if (!data || typeof data !== "object") throw new Error("The admin content state is unavailable.");
  return {
    draft: normalizePortfolioContent(data.draft_json || PORTFOLIO_DEFAULT_CONTENT),
    published: normalizePortfolioContent(data.published_json || PORTFOLIO_DEFAULT_CONTENT),
    draftRevision: Number(data.draft_revision || 0),
    publishedRevision: Number(data.published_revision || 0),
    publicEnabled: data.public_enabled !== false,
    updatedAt: data.updated_at || null,
    publishedAt: data.published_at || null,
    unpublishedAt: data.unpublished_at || null,
  };
}

async function savePortfolioDraft(content, expectedRevision) {
  const normalized = normalizePortfolioContent(content);
  const sb = requirePortfolioBackend();
  const { data, error } = await sb.rpc("save_portfolio_draft", {
    p_content: normalized,
    p_expected_revision: Number(expectedRevision || 0),
  });
  if (error) throw error;
  return {
    draft: normalized,
    draftRevision: Number(data?.draft_revision ?? expectedRevision ?? 0),
    updatedAt: data?.updated_at || new Date().toISOString(),
  };
}

function assertPortfolioMediaPromotionItem(item) {
  const sourceBucket = String(item?.source_bucket || "");
  const destinationBucket = String(item?.destination_bucket || "");
  const sourcePath = String(item?.source_path || "");
  const destinationPath = String(item?.destination_path || "");
  if (
    sourceBucket !== "portfolio-media-drafts" ||
    destinationBucket !== "portfolio-media-public" ||
    !sourcePath ||
    !destinationPath ||
    sourcePath.startsWith("/") ||
    destinationPath.startsWith("/") ||
    sourcePath.includes("..") ||
    destinationPath.includes("..")
  ) {
    throw new Error("The media service returned an unsafe promotion path.");
  }
  return {
    assetId: item.asset_id,
    sourceBucket,
    sourcePath,
    destinationBucket,
    destinationPath,
  };
}

async function promotePortfolioDraftMedia(sb, expectedDraftRevision, onProgress) {
  const { data, error } = await sb.rpc("prepare_portfolio_media_promotion", {
    p_expected_draft_revision: Number(expectedDraftRevision || 0),
  });
  if (error) throw error;

  const items = Array.isArray(data?.items) ? data.items : [];
  for (let index = 0; index < items.length; index += 1) {
    const item = assertPortfolioMediaPromotionItem(items[index]);
    onProgress?.({
      stage: "media",
      current: index + 1,
      total: items.length,
      label: `Preparing media ${index + 1} of ${items.length}`,
    });

    const { error: copyError } = await sb.storage
      .from(item.sourceBucket)
      .copy(item.sourcePath, item.destinationPath, {
        destinationBucket: item.destinationBucket,
      });

    if (copyError) {
      // A previous attempt may have copied successfully before its response
      // was lost. Let the server verify that immutable destination first.
      const retryFinalize = await sb.rpc("finalize_portfolio_media_promotion", {
        p_asset_id: item.assetId,
      });
      if (retryFinalize.error) throw copyError;
      continue;
    }

    const { error: finalizeError } = await sb.rpc("finalize_portfolio_media_promotion", {
      p_asset_id: item.assetId,
    });
    if (finalizeError) throw finalizeError;
  }
}

async function publishPortfolioDraft(expectedDraftRevision, { onProgress } = {}) {
  const sb = requirePortfolioBackend();
  await promotePortfolioDraftMedia(sb, expectedDraftRevision, onProgress);
  onProgress?.({ stage: "publish", current: 1, total: 1, label: "Publishing content" });
  const { data, error } = await sb.rpc("publish_portfolio", {
    p_expected_draft_revision: Number(expectedDraftRevision || 0),
  });
  if (error) throw error;
  const published = normalizePortfolioContent(data?.published_json || PORTFOLIO_DEFAULT_CONTENT);
  const manifestEnvelope = portfolioContainsMediaTokens(published)
    ? await loadPublicMediaManifest(sb)
    : null;
  const publicContent = cachePublishedContent(published, manifestEnvelope);
  window.dispatchEvent(new CustomEvent("portfolio-content-published", { detail: publicContent }));
  return {
    published,
    publicContent,
    publishedRevision: Number(data?.published_revision || 0),
    publishedAt: data?.published_at || new Date().toISOString(),
  };
}

async function unpublishPortfolio(expectedPublishedRevision) {
  const sb = requirePortfolioBackend();
  const { data, error } = await sb.rpc("unpublish_portfolio", {
    p_expected_published_revision: Number(expectedPublishedRevision || 0),
  });
  if (error) throw error;

  // A successful unpublish is authoritative even if the protected RPC also
  // returns the retained private snapshot for the admin UI.
  clearPublishedContentCache();
  const publicContent = unavailablePortfolioContent();
  window.dispatchEvent(new CustomEvent("portfolio-content-published", { detail: publicContent }));

  return {
    publicContent,
    publishedRevision: Number(data?.published_revision || 0),
    unpublishedAt: data?.unpublished_at || new Date().toISOString(),
  };
}

async function listPortfolioAdminUsers() {
  const sb = requirePortfolioBackend();
  const { data, error } = await sb.rpc("list_portfolio_admin_users");
  if (error) throw error;
  if (!Array.isArray(data)) {
    throw new Error("The portfolio staff list is unavailable.");
  }
  return data;
}

async function addPortfolioAdminUser(email, role) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const normalizedRole = String(role || "").trim().toLowerCase();
  if (!normalizedEmail || !normalizedRole) {
    throw new Error("A staff email and role are required.");
  }

  const sb = requirePortfolioBackend();
  const { data, error } = await sb.rpc("add_portfolio_admin_user", {
    p_email: normalizedEmail,
    p_role: normalizedRole,
  });
  if (error) throw error;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("The portfolio staff assignment was not returned.");
  }
  return data;
}

async function updatePortfolioAdminUser(userId, role, isActive) {
  const normalizedUserId = String(userId || "").trim();
  const normalizedRole = String(role || "").trim().toLowerCase();
  if (!normalizedUserId || !normalizedRole || typeof isActive !== "boolean") {
    throw new Error("A staff user, role, and activation state are required.");
  }

  const sb = requirePortfolioBackend();
  const { data, error } = await sb.rpc("update_portfolio_admin_user", {
    p_user_id: normalizedUserId,
    p_role: normalizedRole,
    p_is_active: isActive,
  });
  if (error) throw error;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("The updated portfolio staff record was not returned.");
  }
  return data;
}

async function loadPortfolioActivity({ offset = 0, limit = 20 } = {}) {
  const sb = requirePortfolioBackend();
  const from = Math.max(0, Number(offset) || 0);
  const pageSize = Math.min(100, Math.max(1, Number(limit) || 20));
  const { data, error } = await sb.rpc("get_portfolio_activity", {
    p_offset: from,
    p_limit: pageSize,
  });
  if (error) throw error;
  if (
    !data ||
    typeof data !== "object" ||
    Array.isArray(data) ||
    !Array.isArray(data.items) ||
    data.count == null ||
    String(data.count).trim() === "" ||
    !Number.isFinite(Number(data.count)) ||
    Number(data.count) < 0
  ) {
    throw new Error("The portfolio activity feed is unavailable.");
  }
  return {
    items: data.items,
    count: Number(data.count),
  };
}

async function loadPortfolioRevisions({ offset = 0, limit = 20 } = {}) {
  const sb = requirePortfolioBackend();
  const from = Math.max(0, Number(offset) || 0);
  const to = from + Math.min(100, Math.max(1, Number(limit) || 20)) - 1;
  const { data, error, count } = await sb
    .from("portfolio_revisions")
    .select("id, revision, kind, created_at, created_by", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to);
  if (error) throw error;
  return { items: data || [], count: Number(count || 0) };
}

async function restorePortfolioRevision(revisionId, expectedDraftRevision) {
  const sb = requirePortfolioBackend();
  const { data, error } = await sb.rpc("restore_portfolio_revision", {
    p_revision_id: revisionId,
    p_expected_revision: Number(expectedDraftRevision || 0),
  });
  if (error) throw error;
  return {
    draft: normalizePortfolioContent(data?.draft_json || PORTFOLIO_DEFAULT_CONTENT),
    draftRevision: Number(data?.draft_revision || 0),
    updatedAt: data?.updated_at || new Date().toISOString(),
  };
}

function subscribeToPortfolioPublications(onPublished) {
  const sb = window.PortfolioSupabase;
  if (!sb?.channel || typeof onPublished !== "function") return () => {};
  let refreshTimer = null;
  let refreshPromise = null;
  let stopped = false;

  const scheduleRefresh = () => {
    if (stopped || typeof setTimeout !== "function") return;
    if (refreshTimer != null && typeof clearTimeout === "function") clearTimeout(refreshTimer);
    const now = Date.now();
    let refreshAt = now + PORTFOLIO_PUBLIC_CACHE_MAX_AGE_MS - PORTFOLIO_MEDIA_REFRESH_SKEW_MS;
    try {
      const contentEnvelope = readPublishedCacheEnvelope();
      const mediaEnvelope = readSignedManifestEnvelope();
      const expiresAt = Math.min(
        Number(contentEnvelope?.expiresAt || Number.MAX_SAFE_INTEGER),
        Number(mediaEnvelope?.expiresAt || Number.MAX_SAFE_INTEGER)
      );
      const preferredRefreshAt = Number(
        mediaEnvelope?.refreshAt ||
        (Number.isFinite(Number(contentEnvelope?.expiresAt))
          ? Number(contentEnvelope.expiresAt) - PORTFOLIO_MEDIA_REFRESH_SKEW_MS
          : refreshAt)
      );
      if (preferredRefreshAt > now) {
        refreshAt = preferredRefreshAt;
      } else if (expiresAt > now && expiresAt < Number.MAX_SAFE_INTEGER) {
        // Retry briefly until the hard expiry so a failed pre-expiry refresh
        // cannot leave already-rendered content visible past its cache lease.
        refreshAt = Math.min(expiresAt, now + 15 * 1000);
      } else if (expiresAt <= now) {
        refreshAt = now + 60 * 1000;
      }
    } catch (_) {}
    refreshTimer = setTimeout(refresh, Math.max(1000, refreshAt - now));
  };

  const refresh = () => {
    if (stopped) return Promise.resolve();
    if (refreshPromise) return refreshPromise;
    refreshPromise = loadPortfolioContentAsync()
      .then((content) => onPublished(content))
      .catch((error) => console.warn("[RAISA] Timed public content refresh failed.", error))
      .finally(() => {
        refreshPromise = null;
        scheduleRefresh();
      });
    return refreshPromise;
  };

  const channel = sb
    .channel("raisa-publications")
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "portfolio_publish_events" },
      refresh
    )
    .subscribe();
  const onVisibilityChange = () => {
    if (document.visibilityState === "visible") refresh();
  };
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVisibilityChange);
  }
  scheduleRefresh();

  return () => {
    stopped = true;
    if (refreshTimer != null && typeof clearTimeout === "function") clearTimeout(refreshTimer);
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    }
    Promise.resolve(sb.removeChannel(channel)).catch(() => {});
  };
}

window.PortfolioContent = {
  key: PORTFOLIO_STORAGE_KEY,
  mediaManifestKey: PORTFOLIO_MEDIA_MANIFEST_KEY,
  schemaVersion: PORTFOLIO_SCHEMA_VERSION,
  defaults: PORTFOLIO_DEFAULT_CONTENT,
  clone: cloneContent,
  merge: mergeContent,
  normalize: normalizePortfolioContent,
  toPublicContent: toPublicPortfolioContent,
  hydratePublicMedia: hydratePublicPortfolioMedia,
  containsMediaTokens: portfolioContainsMediaTokens,
  load: loadPortfolioContent,
  loadAsync: loadPortfolioContentAsync,
  getAdminProfile: getPortfolioAdminProfile,
  loadAdminState: loadPortfolioAdminState,
  saveDraft: savePortfolioDraft,
  publishDraft: publishPortfolioDraft,
  unpublish: unpublishPortfolio,
  listPortfolioAdminUsers,
  addPortfolioAdminUser,
  updatePortfolioAdminUser,
  listAdminUsers: listPortfolioAdminUsers,
  addAdminUser: addPortfolioAdminUser,
  updateAdminUser: updatePortfolioAdminUser,
  loadActivity: loadPortfolioActivity,
  loadRevisions: loadPortfolioRevisions,
  restoreRevision: restorePortfolioRevision,
  subscribe: subscribeToPortfolioPublications,
};
