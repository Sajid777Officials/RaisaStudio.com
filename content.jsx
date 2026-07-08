// Editable content and persistence for the portfolio.
// Saves to Supabase when configured (window.PortfolioSupabase), falls back to localStorage.
const PORTFOLIO_STORAGE_KEY = "vox-portfolio-content-v1";
const PORTFOLIO_CONTENT_ROW_ID = 1;
const PORTFOLIO_SEED_DATE = "2026-07-08T00:00:00.000Z";

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
    graphic: GRAPHIC_SERVICE_CATEGORIES,
    webdev: WEBDEV_SERVICE_CATEGORIES,
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
  projects: {
    graphic: GRAPHIC_CATEGORY_PROJECTS,
    webdev: WEBDEV_CATEGORY_PROJECTS,
  },
  // WordPress removed; Kotlin, Flutter, MongoDB, Express.js added
  techStack: ["React", "Next.js", "TypeScript", "Tailwind", "Node.js", "PHP", "MySQL", "Postgres", "MongoDB", "Express.js", "Kotlin", "Flutter", "Shopify", "Figma", "Vercel"],
  cases: window.PortfolioCaseData || {},
};

function cloneContent(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeServiceCategory(service, index) {
  const name = service.name || service.title || `Category ${index + 1}`;
  const slug = contentSlugify(service.slug || service.id || name) || `category-${index + 1}`;
  const order = Number.isFinite(Number(service.order)) ? Number(service.order) : index + 1;
  const shortDescription = service.short_description || service.shortDescription || service.desc || "";

  return {
    ...service,
    id: service.id || slug,
    name,
    title: service.title || name,
    slug,
    icon: Number.isFinite(Number(service.icon)) ? Number(service.icon) : index,
    icon_url: service.icon_url || "",
    short_description: shortDescription,
    desc: service.desc || shortDescription,
    order,
    num: service.num || String(order).padStart(2, "0"),
    is_active: service.is_active !== false,
    created_at: service.created_at || PORTFOLIO_SEED_DATE,
    updated_at: service.updated_at || PORTFOLIO_SEED_DATE,
  };
}

function normalizeProject(project, index, categories) {
  const title = project.title || `Project ${index + 1}`;
  const fallbackCategory = categories[index % Math.max(categories.length, 1)] || {};
  const categoryId = project.category_id || project.categoryId || project.category_slug || fallbackCategory.slug || "";
  const slug = contentSlugify(project.slug || title) || `project-${index + 1}`;
  const imageUrl = project.image_url || project.image || "";

  return {
    ...project,
    id: project.id || `project-${slug}`,
    category_id: categoryId,
    title,
    slug,
    short_description: project.short_description || project.shortDescription || project.desc || "",
    full_description: project.full_description || project.fullDescription || project.description || "",
    image_url: imageUrl,
    gallery_images: Array.isArray(project.gallery_images) ? project.gallery_images : [],
    tags: Array.isArray(project.tags)
      ? project.tags
      : String(project.tags || "").split(",").map(tag => tag.trim()).filter(Boolean),
    client_name: project.client_name || project.clientName || "",
    project_date: project.project_date || project.projectDate || project.year || "",
    is_featured: project.is_featured === true,
    is_published: project.is_published !== false,
    sort_order: Number.isFinite(Number(project.sort_order)) ? Number(project.sort_order) : index + 1,
    thumb: project.thumb || fallbackCategory.thumb || "Brand",
    pal: Number.isFinite(Number(project.pal)) ? Number(project.pal) : index % 6,
    created_at: project.created_at || PORTFOLIO_SEED_DATE,
    updated_at: project.updated_at || PORTFOLIO_SEED_DATE,
  };
}

function hasUsableCategoryProject(project) {
  return Boolean(
    String(project?.title || "").trim() &&
    String(project?.category_id || project?.categoryId || project?.category_slug || "").trim()
  );
}

function normalizeCategoryProjects(projects, categories, defaultProjects) {
  const validCategoryIds = new Set((categories || []).map(category => category.slug).filter(Boolean));
  const savedProjects = Array.isArray(projects) ? projects : [];
  const normalizedSaved = savedProjects
    .map((project, index) => ({ raw: project, normalized: normalizeProject(project, index, categories) }))
    .filter(({ raw, normalized }) => hasUsableCategoryProject(raw) && validCategoryIds.has(normalized.category_id))
    .map(({ normalized }) => normalized);

  const coveredCategoryIds = new Set(normalizedSaved.map(project => project.category_id));
  const missingDefaults = (defaultProjects || [])
    .filter(project => project.category_id && !coveredCategoryIds.has(project.category_id))
    .map((project, index) => normalizeProject(project, normalizedSaved.length + index, categories));

  return [...normalizedSaved, ...missingDefaults]
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
}

function normalizeProjectImages(images, projectId) {
  if (!Array.isArray(images)) return [];
  return images
    .map((image, index) => {
      const imageUrl = typeof image === "string" ? image : (image.image_url || image.url || image.src || "");
      return {
        ...(typeof image === "string" ? {} : image),
        id: (typeof image === "string" ? "" : image.id) || `${projectId || "project"}-image-${index + 1}`,
        project_id: (typeof image === "string" ? "" : image.project_id) || projectId || "",
        image_url: imageUrl,
        caption: typeof image === "string" ? "" : (image.caption || ""),
        alt_text: typeof image === "string" ? "" : (image.alt_text || image.alt || ""),
        sort_order: Number.isFinite(Number(typeof image === "string" ? index + 1 : image.sort_order)) ? Number(typeof image === "string" ? index + 1 : image.sort_order) : index + 1,
        created_at: (typeof image === "string" ? "" : image.created_at) || PORTFOLIO_SEED_DATE,
        updated_at: (typeof image === "string" ? "" : image.updated_at) || PORTFOLIO_SEED_DATE,
      };
    })
    .filter(image => image.image_url)
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
}

function normalizeWorkProject(work, index, side) {
  const title = work.title || `Project ${index + 1}`;
  const id = work.id || `${side === "webdev" ? "w" : "g"}${index + 1}`;
  const slug = contentSlugify(work.slug || title) || id;
  const categoryId = work.category_id || contentSlugify(work.cat || work.category || "selected-work") || "selected-work";
  const coverImage = work.cover_image_url || work.image || "";

  return {
    ...work,
    id,
    title,
    slug,
    category_id: categoryId,
    cover_image_url: coverImage,
    short_description: work.short_description || work.shortDescription || work.desc || "",
    full_description: work.full_description || work.fullDescription || "",
    client_name: work.client_name || work.clientName || "",
    year: work.year || "",
    is_featured: work.is_featured === true,
    is_published: work.is_published !== false,
    sort_order: Number.isFinite(Number(work.sort_order)) ? Number(work.sort_order) : index + 1,
    gallery_images: normalizeProjectImages(work.gallery_images || work.images || [], id),
    created_at: work.created_at || PORTFOLIO_SEED_DATE,
    updated_at: work.updated_at || PORTFOLIO_SEED_DATE,
  };
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
  const normalized = mergeContent(PORTFOLIO_DEFAULT_CONTENT, content);

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
    normalized.services.graphic,
    GRAPHIC_CATEGORY_PROJECTS
  );
  normalized.projects.webdev = normalizeCategoryProjects(
    normalized.projects.webdev,
    normalized.services.webdev,
    WEBDEV_CATEGORY_PROJECTS
  );

  normalized.works = normalized.works || {};
  normalized.works.graphic = (normalized.works.graphic || [])
    .map((work, index) => normalizeWorkProject(work, index, "graphic"))
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  normalized.works.webdev = (normalized.works.webdev || [])
    .map((work, index) => normalizeWorkProject(work, index, "webdev"))
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

  return normalized;
}

// Synchronous load — returns localStorage content or defaults. Used for first render.
function loadPortfolioContent() {
  try {
    const raw = localStorage.getItem(PORTFOLIO_STORAGE_KEY);
    if (!raw) return normalizePortfolioContent(PORTFOLIO_DEFAULT_CONTENT);
    return normalizePortfolioContent(JSON.parse(raw));
  } catch (error) {
    console.warn("Could not load saved portfolio content.", error);
    return normalizePortfolioContent(PORTFOLIO_DEFAULT_CONTENT);
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

    const normalized = normalizePortfolioContent(data.content_json);
    try { localStorage.setItem(PORTFOLIO_STORAGE_KEY, JSON.stringify(normalized)); } catch (_) {}
    return normalized;
  } catch (err) {
    console.warn("[RAISA] Supabase load failed, using localStorage fallback.", err);
    return loadPortfolioContent();
  }
}

// Async save — writes to Supabase (primary) and localStorage (cache/fallback).
// Throws if Supabase is configured but the save fails, so the admin can see the error.
async function savePortfolioContent(content) {
  const normalized = normalizePortfolioContent(content);
  try { localStorage.setItem(PORTFOLIO_STORAGE_KEY, JSON.stringify(normalized)); } catch (_) {}

  const sb = window.PortfolioSupabase;
  if (sb) {
    const { error } = await sb
      .from("portfolio_content")
      .upsert(
        { id: PORTFOLIO_CONTENT_ROW_ID, content_json: normalized, updated_at: new Date().toISOString() },
        { onConflict: "id" }
      );
    if (error) throw error;
  }

  window.dispatchEvent(new CustomEvent("portfolio-content-saved", { detail: normalized }));
}

// Async reset — deletes from Supabase and localStorage, returns fresh defaults.
async function resetPortfolioContent() {
  const fresh = normalizePortfolioContent(PORTFOLIO_DEFAULT_CONTENT);
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
