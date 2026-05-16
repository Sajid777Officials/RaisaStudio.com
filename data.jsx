// Data layer — reads localStorage, falls back to built-in defaults.
// Exposes window.PortfolioData used by graphic-page, webdev-page, case-sheet.
(function () {
  const KEYS = {
    graphic: 'vox_graphic_works',
    webdev:  'vox_webdev_works',
  };

  const DEFAULT_GRAPHIC = [
    { id:'g1', title:'Sorrel & Stone',    cat:'Packaging · Botanical Tea', year:'2025', thumb:'Packaging', pal:0, span:6 },
    { id:'g2', title:'Northwind Festival',cat:'Poster Series',             year:'2025', thumb:'Poster',    pal:1, span:3, num:'26' },
    { id:'g3', title:'Atlas Roastery',    cat:'Brand Identity',            year:'2024', thumb:'Brand',     pal:2, span:3 },
    { id:'g4', title:'Marlow & Co.',      cat:'Stationery System',         year:'2024', thumb:'Brand',     pal:3, span:4 },
    { id:'g5', title:'Hoshi Skincare',    cat:'Social Media Suite',        year:'2024', thumb:'Social',    pal:4, span:4 },
    { id:'g6', title:'Ember Films',       cat:'Title Sequence',            year:'2024', thumb:'Poster',    pal:5, span:4, num:'07' },
  ];

  const DEFAULT_WEBDEV = [
    { id:'w1', title:'Halo Bank',         cat:'Web App · Fintech',  year:'2025', stack:'Next.js · TS · Postgres', thumb:'Dashboard', pal:0, span:6 },
    { id:'w2', title:'Pinecrest Realty',  cat:'Marketing Site',     year:'2025', stack:'Next.js · Sanity',         thumb:'WebApp',    pal:1, span:3 },
    { id:'w3', title:'Loom & Field',      cat:'E-commerce',         year:'2024', stack:'Shopify Hydrogen',         thumb:'WebApp',    pal:2, span:3 },
    { id:'w4', title:'Open Atlas API',    cat:'Developer Tool',     year:'2024', stack:'Node · GraphQL',           thumb:'Code',      pal:3, span:4 },
    { id:'w5', title:'Northwind Studio',  cat:'Portfolio',          year:'2024', stack:'Astro · MDX',              thumb:'WebApp',    pal:4, span:4 },
    { id:'w6', title:'Ledger.io',         cat:'SaaS Dashboard',     year:'2024', stack:'React · Tailwind',         thumb:'Dashboard', pal:5, span:4 },
  ];

  const DEFAULT_CASES = {
    g1:{ side:'graphic', title:'Sorrel & Stone',    eyebrow:'Case · Packaging system',  pal:0,
      side_info:[['Client','Sorrel & Stone Tea'],['Year','2025'],['Discipline','Packaging · Identity'],['Deliverables','12 SKUs · Dielines'],['Print','Soft-touch · Foil stamp'],['Role','Lead Designer']],
      challenge:'An eight-year-old botanical tea brand was hitting shelf in three new markets and competing with mass-market players that out-budget them 100×. They needed packaging that looked premium at six feet and survived a 0.4-second eye scan.',
      pull:'The brand had to feel like an heirloom, but read like a billboard.',
      process:'We rebuilt the master logotype, defined a five-colour system anchored on a deep botanical green, and engineered a layout grid that holds for both 50g sachets and 250g tins. Twelve SKUs were dielined, prepared and proofed for soft-touch litho with hot-foil accents.',
      tools:'Adobe Illustrator · InDesign · Pantone bridge · Esko ArtPro · Soft-touch laminate · Hot-foil stamp',
      results:[['+42','%','Shelf-test recall'],['12','','SKUs shipped'],['3','','New markets']] },
    g2:{ side:'graphic', title:'Northwind Festival', eyebrow:'Case · Poster series', pal:1,
      side_info:[['Client','Northwind Music Co.'],['Year','2025'],['Discipline','Poster · Editorial'],['Deliverables','26-poster series'],['Print','Risograph + offset'],['Role','Art Director']],
      challenge:'26 headliners, 26 posters, one shared visual language — and a print budget that wouldn\'t stretch beyond two-colour riso.',
      pull:'One system, twenty-six headliners, two ink colours.',
      process:'We built a typographic grid anchored on a numeral and an italic display word. Each poster gets one custom-set headliner name, one numeral, and a swatch from the festival\'s chromatic palette.',
      tools:'Glyphs · Illustrator · Risolve · Sappi McCoy 100lb · Fluorescent Pink + Black',
      results:[['26','','Posters shipped'],['+18','%','Ticket conversion'],['2','','Print awards']] },
    g3:{ side:'graphic', title:'Atlas Roastery', eyebrow:'Case · Brand identity', pal:2,
      side_info:[['Client','Atlas Coffee Roastery'],['Year','2024'],['Discipline','Identity · Packaging'],['Deliverables','Wordmark · Bags · Web'],['Print','Kraft + 2c flexo'],['Role','Lead Designer']],
      challenge:'A specialty roaster wanted to step out of the third-wave look-alike pile without alienating the regulars who buy a bag every Saturday.',
      pull:'Specialty taste, neighbourhood warmth — without the third-wave clichés.',
      process:'Custom wordmark drawn from scratch, paired with a numbered origin-card system on the back of each bag.',
      tools:'Glyphs · Illustrator · InDesign · Flexo · Digital print',
      results:[['+31','%','Wholesale orders'],['18','','Origin SKUs'],['4.9','★','Avg. shelf rating']] },
    g4:{ side:'graphic', title:'Marlow & Co.', eyebrow:'Case · Stationery system', pal:3,
      side_info:[['Client','Marlow & Co.'],['Year','2024'],['Discipline','Stationery'],['Deliverables','Cards · Letterhead'],['Print','Letterpress · Foil'],['Role','Designer']],
      challenge:'A boutique law firm needed a full stationery system that signalled discretion and authority without slipping into the usual marble-and-serif law-firm template.',
      pull:'Discreet, authoritative, hand-set — not another marble-and-serif law-firm template.',
      process:'Letterpress monogram printed in deep ink on Crane cotton stock, with hot-foil accents reserved for partner cards.',
      tools:'Illustrator · InDesign · Letterpress · Hot foil',
      results:[['8','','Stationery items'],['140','gsm','Crane cotton'],['2','','Foil dies']] },
    g5:{ side:'graphic', title:'Hoshi Skincare', eyebrow:'Case · Social system', pal:4,
      side_info:[['Client','Hoshi'],['Year','2024'],['Discipline','Social · Content'],['Deliverables','120 posts · Templates'],['Channels','IG · TikTok · Pinterest'],['Role','Art Director']],
      challenge:'A skincare brand was posting six times a week with no template, no rhythm and a graphic feed that read as six unrelated brands.',
      pull:'Six posts a week, three channels, zero look-alike feeds.',
      process:'Built a Figma template library with 12 modular layouts, a typographic system on two weights of one face, and a colour grid that rotates weekly.',
      tools:'Figma · After Effects · Lottie · CapCut',
      results:[['+64','%','Saves per post'],['120','','Templates'],['1','','Afternoon to handoff']] },
    g6:{ side:'graphic', title:'Ember Films', eyebrow:'Case · Title sequence', pal:5,
      side_info:[['Client','Ember Films'],['Year','2024'],['Discipline','Motion · Type'],['Deliverables','60s title sequence'],['Output','ProRes 4444 · DCP'],['Role','Designer']],
      challenge:'The opening sixty seconds of a feature documentary — type only, no footage, and a brief that asked for the visual register of a hand-set film noir without the gimmick.',
      pull:'Sixty seconds, type only, the register of hand-set noir.',
      process:'Animated a single custom display face frame-by-frame, with three orchestrated reveal beats.',
      tools:'Glyphs · After Effects · ProRes 4444',
      results:[['60','s','Sequence length'],['3','','Reveal beats'],['1','★','Festival selection']] },
    w1:{ side:'webdev', title:'Halo Bank', eyebrow:'Case · Fintech web app', pal:0,
      side_info:[['Client','Halo Financial'],['Year','2025'],['Stack','Next.js · TS · Postgres'],['Deliverables','Web app · Design system'],['Difficulty','★★★★★'],['Role','Lead Developer']],
      challenge:'A challenger bank was running their customer dashboard on a legacy PHP monolith that took 4.2s to first paint.',
      pull:'From a 4.2-second first paint to under 600ms — without losing a single feature.',
      process:'Migrated to Next.js with a typed Postgres layer and a self-hosted design system. Built component-by-component on a feature-flag rollout.',
      tools:'Next.js 14 · TypeScript · Postgres · Drizzle · Tailwind · Playwright · Vercel',
      results:[['−86','%','First paint'],['100','','Lighthouse perf'],['0','','Open a11y issues']] },
    w2:{ side:'webdev', title:'Pinecrest Realty', eyebrow:'Case · Marketing site', pal:1,
      side_info:[['Client','Pinecrest Realty'],['Year','2025'],['Stack','Next.js · Sanity'],['Deliverables','8-page site'],['Difficulty','★★★☆☆'],['Role','Designer + Dev']],
      challenge:'A regional realty firm had a Wix site that worked but cost them every other lead — slow on mobile, no listings search.',
      pull:'Cheap to run, fast on the slowest phone, easy enough for the team to update.',
      process:'Rebuilt on Next.js with Sanity Studio as the CMS. Five staff members trained in one session.',
      tools:'Next.js · Sanity · Tailwind · MLS RETS API',
      results:[['+2.1','×','Mobile leads'],['98','','Lighthouse mobile'],['5','','Editors trained']] },
    w3:{ side:'webdev', title:'Loom & Field', eyebrow:'Case · E-commerce', pal:2,
      side_info:[['Client','Loom & Field'],['Year','2024'],['Stack','Shopify Hydrogen'],['Deliverables','Storefront · Checkout'],['Difficulty','★★★★☆'],['Role','Lead Developer']],
      challenge:'An apparel brand outgrew a Liquid theme but didn\'t want to leave Shopify\'s payments infrastructure.',
      pull:'Headless storefront, native checkout — no compromise on either.',
      process:'Built on Hydrogen with a custom product-configurator React tree, while keeping Shopify\'s Storefront API as the source of truth.',
      tools:'Hydrogen · Remix · Shopify Storefront API · Oxygen',
      results:[['+38','%','Conversion'],['−54','%','Bounce'],['0.4','s','Avg. TTFB']] },
    w4:{ side:'webdev', title:'Open Atlas API', eyebrow:'Case · Developer tool', pal:3,
      side_info:[['Client','Open Atlas'],['Year','2024'],['Stack','Node · GraphQL'],['Deliverables','API · Docs · CLI'],['Difficulty','★★★★★'],['Role','Lead Developer']],
      challenge:'A geospatial startup needed to ship a public REST + GraphQL API in eight weeks, with typed clients in four languages.',
      pull:'Eight weeks. Two APIs. Four typed clients. One source of truth.',
      process:'OpenAPI schema as the single source — REST, GraphQL, typed clients and docs all generated from it.',
      tools:'Node · Fastify · GraphQL Yoga · Astro · MDX · OpenAPI',
      results:[['4','','Client SDKs'],['8','wk','From scratch to v1'],['1.2','k','Devs in beta']] },
    w5:{ side:'webdev', title:'Northwind Studio', eyebrow:'Case · Portfolio site', pal:4,
      side_info:[['Client','Northwind Studio'],['Year','2024'],['Stack','Astro · MDX'],['Deliverables','5-page portfolio'],['Difficulty','★★☆☆☆'],['Role','Designer + Dev']],
      challenge:'A two-person motion studio needed a portfolio that loaded as fast as a JPEG but could showcase 4K video reels.',
      pull:'As fast as a JPEG — full reels at 4K, on a static host.',
      process:'Astro with zero-JS by default, MUX for adaptive video, fully static deploy on Cloudflare Pages.',
      tools:'Astro · MUX · Cloudflare Pages',
      results:[['100','','Lighthouse perf'],['$0','/mo','Hosting'],['1','wk','From brief to live']] },
    w6:{ side:'webdev', title:'Ledger.io', eyebrow:'Case · SaaS dashboard', pal:5,
      side_info:[['Client','Ledger.io'],['Year','2024'],['Stack','React · Tailwind'],['Deliverables','Admin dashboard'],['Difficulty','★★★★☆'],['Role','Frontend Lead']],
      challenge:'An accounting SaaS had a dashboard built across three years by five different contractors.',
      pull:'Three years of contractors, five different patterns, one consolidated system.',
      process:'Audited and consolidated to a single component library with typed props and Storybook docs.',
      tools:'React · TypeScript · Tailwind · TanStack Query · Zustand · Storybook',
      results:[['−86','%','Onboarding time'],['1','','Component library'],['2','d','New-hire ramp']] },
  };

  function load(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
    catch(e) { return fallback; }
  }

  function save(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch(e) {}
  }

  // Build case data: merge defaults with any overrides from stored works
  function getCaseData() {
    const graphic = load(KEYS.graphic, DEFAULT_GRAPHIC);
    const webdev  = load(KEYS.webdev,  DEFAULT_WEBDEV);
    const merged  = Object.assign({}, DEFAULT_CASES);
    [...graphic, ...webdev].forEach(w => {
      if (w.challenge) {
        merged[w.id] = {
          side:      w.side || (w.id[0] === 'g' ? 'graphic' : 'webdev'),
          title:     w.title,
          eyebrow:   w.eyebrow || `Case · ${w.cat}`,
          pal:       w.pal || 0,
          image:     w.image || null,
          side_info: w.side_info || [],
          challenge: w.challenge,
          pull:      w.pull || '',
          process:   w.process || '',
          tools:     w.tools || '',
          results:   w.results || [],
        };
      }
    });
    return merged;
  }

  window.PortfolioData = {
    getGraphicWorks: () => load(KEYS.graphic, DEFAULT_GRAPHIC),
    getWebdevWorks:  () => load(KEYS.webdev,  DEFAULT_WEBDEV),
    getCaseData,
    saveGraphicWorks: (w) => save(KEYS.graphic, w),
    saveWebdevWorks:  (w) => save(KEYS.webdev, w),
    DEFAULTS: { graphic: DEFAULT_GRAPHIC, webdev: DEFAULT_WEBDEV, cases: DEFAULT_CASES },
  };
})();
