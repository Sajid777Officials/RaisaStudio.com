// Case study sheet — slides up over the page
const { ArrowLeft: CsArrowLeft, Close: CsClose } = window.PortfolioIcons;
const { thumbs: CsThumbs, GRAPHIC_PALETTES: CS_GD_PAL, WEBDEV_PALETTES: CS_WD_PAL } = window.PortfolioShared;

const CASE_DATA = {
  // graphic
  g1: {
    side: "graphic",
    title: "Sorrel & Stone",
    eyebrow: "Case · Packaging system",
    pal: 0,
    side_info: [
      ["Client", "Sorrel & Stone Tea"],
      ["Year", "2025"],
      ["Discipline", "Packaging · Identity"],
      ["Deliverables", "12 SKUs · Dielines"],
      ["Print", "Soft-touch · Foil stamp"],
      ["Role", "Lead Designer"],
    ],
    challenge: "An eight-year-old botanical tea brand was hitting shelf in three new markets and competing with mass-market players that out-budget them 100×. They needed packaging that looked premium at six feet and survived a 0.4-second eye scan.",
    pull: "The brand had to feel like an heirloom, but read like a billboard.",
    process: "We rebuilt the master logotype, defined a five-colour system anchored on a deep botanical green, and engineered a layout grid that holds for both 50g sachets and 250g tins. Twelve SKUs were dielined, prepared and proofed for soft-touch litho with hot-foil accents.",
    tools: "Adobe Illustrator · InDesign · Pantone bridge · Esko ArtPro · Soft-touch laminate · Hot-foil stamp",
    results: [["+42", "%", "Shelf-test recall"], ["12", "", "SKUs shipped"], ["3", "", "New markets"]],
  },
  g2: {
    side: "graphic",
    title: "Northwind Festival",
    eyebrow: "Case · Poster series",
    pal: 1,
    side_info: [
      ["Client", "Northwind Music Co."],
      ["Year", "2025"],
      ["Discipline", "Poster · Editorial"],
      ["Deliverables", "26-poster series"],
      ["Print", "Risograph + offset"],
      ["Role", "Art Director"],
    ],
    challenge: "26 headliners, 26 posters, one shared visual language — and a print budget that wouldn't stretch beyond two-colour riso. The series had to feel like one festival from a half-block away, and like 26 distinct nights at arm's length.",
    pull: "One system, twenty-six headliners, two ink colours.",
    process: "We built a typographic grid anchored on a numeral and an italic display word. Each poster gets one custom-set headliner name, one numeral, and a swatch from the festival's chromatic palette. Output was riso for venue posters and offset for the printed programme.",
    tools: "Glyphs · Illustrator · Risolve · Sappi McCoy 100lb · Fluorescent Pink + Black",
    results: [["26", "", "Posters shipped"], ["+18", "%", "Ticket conversion"], ["2", "", "Print awards"]],
  },
  g3: {
    side: "graphic",
    title: "Atlas Roastery",
    eyebrow: "Case · Brand identity",
    pal: 2,
    side_info: [
      ["Client", "Atlas Coffee Roastery"],
      ["Year", "2024"],
      ["Discipline", "Identity · Packaging"],
      ["Deliverables", "Wordmark · Bags · Web"],
      ["Print", "Kraft + 2c flexo"],
      ["Role", "Lead Designer"],
    ],
    challenge: "A specialty roaster wanted to step out of the third-wave look-alike pile without alienating the regulars who buy a bag every Saturday. The brand had to read serious to wholesale buyers and warm to walk-in customers.",
    pull: "Specialty taste, neighbourhood warmth — without the third-wave clichés.",
    process: "Custom wordmark drawn from scratch, paired with a numbered origin-card system on the back of each bag. Two-colour flexo on kraft for wholesale, full-colour digital for limited drops.",
    tools: "Glyphs · Illustrator · InDesign · Flexo · Digital print",
    results: [["+31", "%", "Wholesale orders"], ["18", "", "Origin SKUs"], ["4.9", "★", "Avg. shelf rating"]],
  },
  g4: {
    side: "graphic",
    title: "Marlow & Co.",
    eyebrow: "Case · Stationery system",
    pal: 3,
    side_info: [["Client", "Marlow & Co."], ["Year", "2024"], ["Discipline", "Stationery"], ["Deliverables", "Cards · Letterhead"], ["Print", "Letterpress · Foil"], ["Role", "Designer"]],
    challenge: "A boutique law firm needed a full stationery system that signalled discretion and authority without slipping into the usual marble-and-serif law-firm template. Every touchpoint had to feel like the same letter from the same hand.",
    pull: "Discreet, authoritative, hand-set — not another marble-and-serif law-firm template.",
    process: "Letterpress monogram printed in deep ink on Crane cotton stock, with hot-foil accents reserved for partner cards. Full system spans cards, letterhead, envelopes, and a wax-seal mark.",
    tools: "Illustrator · InDesign · Letterpress · Hot foil",
    results: [["8", "", "Stationery items"], ["140", "gsm", "Crane cotton"], ["2", "", "Foil dies"]],
  },
  g5: {
    side: "graphic",
    title: "Hoshi Skincare",
    eyebrow: "Case · Social system",
    pal: 4,
    side_info: [["Client", "Hoshi"], ["Year", "2024"], ["Discipline", "Social · Content"], ["Deliverables", "120 posts · Templates"], ["Channels", "IG · TikTok · Pinterest"], ["Role", "Art Director"]],
    challenge: "A skincare brand was posting six times a week with no template, no rhythm and a graphic feed that read as six unrelated brands. We needed a system the in-house team could run without us in the room.",
    pull: "Six posts a week, three channels, zero look-alike feeds.",
    process: "Built a Figma template library with 12 modular layouts, a typographic system on two weights of one face, and a colour grid that rotates weekly. Trained the in-house team in a single afternoon.",
    tools: "Figma · After Effects · Lottie · CapCut",
    results: [["+64", "%", "Saves per post"], ["120", "", "Templates"], ["1", "", "Afternoon to handoff"]],
  },
  g6: {
    side: "graphic",
    title: "Ember Films",
    eyebrow: "Case · Title sequence",
    pal: 5,
    side_info: [["Client", "Ember Films"], ["Year", "2024"], ["Discipline", "Motion · Type"], ["Deliverables", "60s title sequence"], ["Output", "ProRes 4444 · DCP"], ["Role", "Designer"]],
    challenge: "The opening sixty seconds of a feature documentary — type only, no footage, and a brief that asked for the visual register of a hand-set film noir without the gimmick.",
    pull: "Sixty seconds, type only, the register of hand-set noir.",
    process: "Animated a single custom display face frame-by-frame, with three orchestrated reveal beats. Cut to a numeric volume marker that becomes the film's recurring chapter device.",
    tools: "Glyphs · After Effects · ProRes 4444",
    results: [["60", "s", "Sequence length"], ["3", "", "Reveal beats"], ["1", "★", "Festival selection"]],
  },

  // webdev
  w1: {
    side: "webdev",
    title: "Halo Bank",
    eyebrow: "Case · Fintech web app",
    pal: 0,
    side_info: [
      ["Client", "Halo Financial"],
      ["Year", "2025"],
      ["Stack", "Next.js · TS · Postgres"],
      ["Deliverables", "Web app · Design system"],
      ["Difficulty", "★★★★★"],
      ["Role", "Lead Developer"],
    ],
    challenge: "A challenger bank was running their customer dashboard on a legacy PHP monolith that took 4.2s to first paint and made compliance audits a quarterly fire drill. They needed a typed, accessible rebuild that could survive ten years of feature creep without a second rewrite.",
    pull: "From a 4.2-second first paint to under 600ms — without losing a single feature.",
    process: "Migrated to Next.js with a typed Postgres layer and a self-hosted design system. Built component-by-component on a feature-flag rollout — old monolith and new app served side-by-side for 90 days, then a clean cutover. Compliance docs auto-generated from the type schema.",
    tools: "Next.js 14 · TypeScript · Postgres · Drizzle · Tailwind · Playwright · Vercel",
    results: [["−86", "%", "First paint"], ["100", "", "Lighthouse perf"], ["0", "", "Open a11y issues"]],
  },
  w2: {
    side: "webdev",
    title: "Pinecrest Realty",
    eyebrow: "Case · Marketing site",
    pal: 1,
    side_info: [["Client", "Pinecrest Realty"], ["Year", "2025"], ["Stack", "Next.js · Sanity"], ["Deliverables", "8-page site"], ["Difficulty", "★★★☆☆"], ["Role", "Designer + Dev"]],
    challenge: "A regional realty firm had a Wix site that worked but cost them every other lead — slow on mobile, no listings search, and a CMS only the founder's son could log into.",
    pull: "Cheap to run, fast on the slowest phone, easy enough for the team to update.",
    process: "Rebuilt on Next.js with Sanity Studio as the CMS. Five staff members trained in one session. Listings pull from MLS via a typed adapter; the team edits the marketing pages directly.",
    tools: "Next.js · Sanity · Tailwind · MLS RETS API",
    results: [["+2.1", "×", "Mobile leads"], ["98", "", "Lighthouse mobile"], ["5", "", "Editors trained"]],
  },
  w3: {
    side: "webdev",
    title: "Loom & Field",
    eyebrow: "Case · E-commerce",
    pal: 2,
    side_info: [["Client", "Loom & Field"], ["Year", "2024"], ["Stack", "Shopify Hydrogen"], ["Deliverables", "Storefront · Checkout"], ["Difficulty", "★★★★☆"], ["Role", "Lead Developer"]],
    challenge: "An apparel brand outgrew a Liquid theme but didn't want to leave Shopify's payments infrastructure. They needed a headless storefront with custom product configurators without giving up Shop Pay's one-tap checkout.",
    pull: "Headless storefront, native checkout — no compromise on either.",
    process: "Built on Hydrogen with a custom product-configurator React tree, while keeping Shopify's Storefront API as the source of truth. Edge-rendered on Oxygen, sub-second TTFB worldwide.",
    tools: "Hydrogen · Remix · Shopify Storefront API · Oxygen",
    results: [["+38", "%", "Conversion"], ["−54", "%", "Bounce"], ["0.4", "s", "Avg. TTFB"]],
  },
  w4: {
    side: "webdev",
    title: "Open Atlas API",
    eyebrow: "Case · Developer tool",
    pal: 3,
    side_info: [["Client", "Open Atlas"], ["Year", "2024"], ["Stack", "Node · GraphQL"], ["Deliverables", "API · Docs · CLI"], ["Difficulty", "★★★★★"], ["Role", "Lead Developer"]],
    challenge: "A geospatial startup needed to ship a public REST + GraphQL API in eight weeks, with typed clients in four languages and a documentation site that didn't need a separate writer.",
    pull: "Eight weeks. Two APIs. Four typed clients. One source of truth.",
    process: "OpenAPI schema as the single source — REST, GraphQL, typed clients and docs all generated from it. Docs site built with Astro and MDX, with live API examples that hit a sandbox env.",
    tools: "Node · Fastify · GraphQL Yoga · Astro · MDX · OpenAPI",
    results: [["4", "", "Client SDKs"], ["8", "wk", "From scratch to v1"], ["1.2", "k", "Devs in beta"]],
  },
  w5: {
    side: "webdev",
    title: "Northwind Studio",
    eyebrow: "Case · Portfolio site",
    pal: 4,
    side_info: [["Client", "Northwind Studio"], ["Year", "2024"], ["Stack", "Astro · MDX"], ["Deliverables", "5-page portfolio"], ["Difficulty", "★★☆☆☆"], ["Role", "Designer + Dev"]],
    challenge: "A two-person motion studio needed a portfolio that loaded as fast as a JPEG but could showcase 4K video reels without paying for a video host.",
    pull: "As fast as a JPEG — full reels at 4K, on a static host.",
    process: "Astro with zero-JS by default, MUX for adaptive video, fully static deploy on Cloudflare Pages. Built in a week, total monthly hosting cost: $0.",
    tools: "Astro · MUX · Cloudflare Pages",
    results: [["100", "", "Lighthouse perf"], ["$0", "/mo", "Hosting"], ["1", "wk", "From brief to live"]],
  },
  w6: {
    side: "webdev",
    title: "Ledger.io",
    eyebrow: "Case · SaaS dashboard",
    pal: 5,
    side_info: [["Client", "Ledger.io"], ["Year", "2024"], ["Stack", "React · Tailwind"], ["Deliverables", "Admin dashboard"], ["Difficulty", "★★★★☆"], ["Role", "Frontend Lead"]],
    challenge: "An accounting SaaS had a dashboard built across three years by five different contractors. Onboarding new hires took two weeks; new features took twice as long as they should have. Time to consolidate.",
    pull: "Three years of contractors, five different patterns, one consolidated system.",
    process: "Audited and consolidated to a single component library with typed props and Storybook docs. Replaced four state libraries with TanStack Query and Zustand. Onboarding dropped from two weeks to two days.",
    tools: "React · TypeScript · Tailwind · TanStack Query · Zustand · Storybook",
    results: [["−86", "%", "Onboarding time"], ["1", "", "Component library"], ["2", "d", "New-hire ramp"]],
  },
};

function findCaseWork(caseId, content, preferredSide, caseSide) {
  const sides = [preferredSide, caseSide, "graphic", "webdev"].filter(Boolean);
  const seen = new Set();
  for (const side of sides) {
    if (seen.has(side)) continue;
    seen.add(side);
    const work = content?.works?.[side]?.find((item) => item.id === caseId);
    if (work) return { ...work, side };
  }
  return null;
}

function buildCaseFromWork(work) {
  if (!work) return null;
  return {
    side: work.side || "graphic",
    title: work.title || "Untitled Project",
    eyebrow: `Case - ${work.cat || "Project"}`,
    thumb: work.thumb,
    pal: work.pal ?? 0,
    num: work.num,
    image: work.image,
    side_info: [
      ["Year", work.year || ""],
      [work.side === "webdev" ? "Stack" : "Discipline", work.stack || work.cat || ""],
    ].filter((row) => row[1]),
    challenge: "",
    pull: "",
    process: "",
    tools: work.stack || "",
    results: [],
  };
}

function mergeCaseWithWork(baseData, linkedWork) {
  if (!baseData || !linkedWork) return baseData;
  return {
    ...baseData,
    image: baseData.image || linkedWork.image,
    thumb: baseData.thumb || linkedWork.thumb,
    pal: baseData.pal ?? linkedWork.pal,
    num: baseData.num || linkedWork.num,
  };
}

function CaseSheet({ caseId, onClose, content, activeSide }) {
  if (!caseId) return null;
  const baseData = content?.cases?.[caseId] || CASE_DATA[caseId];
  const linkedWork = findCaseWork(caseId, content, activeSide, baseData?.side);
  const data = mergeCaseWithWork(baseData || buildCaseFromWork(linkedWork), linkedWork);
  if (!data) return null;
  const pal = data.side === "graphic" ? CS_GD_PAL[data.pal] : CS_WD_PAL[data.pal];
  const Thumb = data.side === "graphic"
    ? (CsThumbs[data.thumb] || (caseId === "g1" ? CsThumbs.Packaging : caseId === "g2" || caseId === "g6" ? CsThumbs.Poster : caseId === "g5" ? CsThumbs.Social : CsThumbs.Brand))
    : (CsThumbs[data.thumb] || (caseId === "w1" || caseId === "w6" ? CsThumbs.Dashboard : caseId === "w4" ? CsThumbs.Code : CsThumbs.WebApp));

  return (
    <div className={"case-sheet " + (data.side === "webdev" ? "webdev " : "") + (caseId ? "open" : "")}>
      <div className="case-scroll">
        <div className="case-head">
          <div className="left">
            <div className="case-eyebrow"><span style={{ width: 8, height: 8, background: "currentColor", borderRadius: 999, opacity: 0.6 }}></span>{data.eyebrow}</div>
            <h1 className="case-title">{data.title}</h1>
          </div>
          <button className="case-close" onClick={onClose}><CsClose size={12} sw={2} />Close case</button>
        </div>

        <div className={"case-hero-img" + (data.image ? " has-upload" : "")}>
          {data.image
            ? <img src={data.image} alt={data.title} />
            : <Thumb palette={pal} title={data.title} num={data.num || "26"} />
          }
        </div>

        <div className="case-body">
          <div className="case-side">
            {data.side_info.map(([k, v]) => (
              <div className="row" key={k}>
                <div className="k">{k}</div>
                <div className="v">{v}</div>
              </div>
            ))}
          </div>
          <div className="case-content">
            <h4>The challenge</h4>
            <p>{data.challenge}</p>
            <div className="pull">{data.pull}</div>
            <h4>Process</h4>
            <p>{data.process}</p>
            <h4>Tools &amp; stack</h4>
            <p style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 15, lineHeight: 1.7, opacity: 0.75 }}>{data.tools}</p>
            <div className="case-results">
              {data.results.map(([num, suf, lbl]) => (
                <div key={lbl}>
                  <div className="num">{num}<span className="accent">{suf}</span></div>
                  <div className="lbl">{lbl}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

window.PortfolioCaseSheet = CaseSheet;
window.PortfolioCaseData = CASE_DATA;
