// Main App — hash-based router

// ── Loading screen (first visit per session) ──────────────────────────────────
function LoadingScreen({ onDone }) {
  const overlayRef = useRef(null);
  const logoRef    = useRef(null);

  useEffect(() => {
    const gsap = window.gsap;
    if (!gsap) { onDone(); return; }

    gsap.timeline()
      .from(logoRef.current,    { scale: 0.82, opacity: 0, duration: 0.75, ease: "expo.out" })
      .to(overlayRef.current, { yPercent: -100, duration: 0.88, ease: "expo.inOut", delay: 0.38 })
      .call(onDone);
  }, []);

  return (
    <div ref={overlayRef} className="loading-screen">
      <div ref={logoRef} className="loading-logo">
        <div className="loading-mark">V</div>
        <div className="loading-brand">RAISA</div>
      </div>
    </div>
  );
}

// ── PageSlide wraps a studio page with a Framer Motion enter/exit transition.
// Falls back to a plain div when framer-motion is not loaded.
function PageSlide({ show, enterX, children }) {
  const FM = window.FramerMotion;
  if (!FM) {
    return (
      <div style={{ position: "absolute", inset: 0, pointerEvents: show ? "auto" : "none" }}>
        {children}
      </div>
    );
  }
  const { motion } = FM;
  return (
    <motion.div
      initial={false}
      animate={{ opacity: show ? 1 : 0, x: show ? 0 : enterX }}
      transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
      style={{ position: "absolute", inset: 0, pointerEvents: show ? "auto" : "none" }}
    >
      {children}
    </motion.div>
  );
}
// Routes:
//   #           → hero (split view)
//   #graphic    → Graphic Design studio
//   #webdev     → Software Development studio
//   #graphic/g1 → Graphic studio + case study g1 open
//   #webdev/w1  → Software Dev studio + case study w1 open
//   #admin      → Admin panel (password protected)

const { useState, useEffect, useRef } = React;
const { Nav } = window.PortfolioShared;
const Hero          = window.PortfolioHero;
const GraphicPage   = window.PortfolioGraphic;
const WebDevPage    = window.PortfolioWebdev;
const CaseSheet     = window.PortfolioCaseSheet;
const AdminPanel    = window.PortfolioAdminPanel;
const { TweaksPanel, useTweaks, TweakSection, TweakColor, TweakRadio, TweakToggle, TweakSelect } = window;

const CFG = window.PortfolioConfig || {};

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "red": "#E63946",
  "navy": "#0B1B3A",
  "accent": "#F4B400",
  "displayFont": "Space Grotesk",
  "bodyFont": "Manrope",
  "showAccent": true,
  "redTagStyle": "fill"
}/*EDITMODE-END*/;

function getFullscreenImage(target) {
  const img = target?.closest?.("img");
  if (!img) return null;
  if (img.closest(".global-image-viewer, .admin-overlay, .admin-shell, .twk-panel, .loading-screen, .nav")) return null;
  if (img.closest(".svc-icon") || img.classList.contains("svc-icon-img")) return null;

  const rect = img.getBoundingClientRect();
  if (rect.width < 72 && rect.height < 72) return null;

  const src = img.currentSrc || img.src || img.getAttribute("src");
  if (!src || src.startsWith("data:image/svg+xml")) return null;

  const alt = img.getAttribute("alt") || img.closest("[aria-label]")?.getAttribute("aria-label") || "Project image";
  return { src, alt };
}

function GlobalImageViewer() {
  const [image, setImage] = useState(null);
  const CloseIcon = window.PortfolioIcons?.Close;

  useEffect(() => {
    const openFromClick = (event) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const imageData = getFullscreenImage(event.target);
      if (!imageData) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
      setImage(imageData);
    };

    document.addEventListener("click", openFromClick, true);
    return () => document.removeEventListener("click", openFromClick, true);
  }, []);

  useEffect(() => {
    if (!image) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKey = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
      setImage(null);
    };

    window.addEventListener("keydown", onKey, true);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKey, true);
    };
  }, [image]);

  if (!image) return null;

  return (
    <div className="global-image-viewer" role="dialog" aria-modal="true" aria-label="Fullscreen image preview" onClick={() => setImage(null)}>
      <button type="button" className="global-image-viewer-close" onClick={() => setImage(null)} aria-label="Close fullscreen image">
        {CloseIcon ? <CloseIcon size={18} sw={2.2} /> : "x"}
      </button>
      <figure className="global-image-viewer-figure" onClick={(event) => event.stopPropagation()}>
        <img src={image.src} alt={image.alt} />
        {image.alt && <figcaption>{image.alt}</figcaption>}
      </figure>
    </div>
  );
}

// ─── Router helpers ───────────────────────────────────────────────────────────
function parseHash() {
  const h = window.location.hash.replace(/^#\/?/, "").trim();
  if (!h) return { view: null, caseId: null, section: null, admin: false };
  if (h === "admin") return { view: null, caseId: null, section: null, admin: true };
  if (h === "about") return { view: "graphic", caseId: null, section: "about", admin: false };
  const [view, detail = null] = h.split("/");
  if (view === "graphic" || view === "webdev") {
    const section = detail === "about" ? "about" : null;
    return { view, caseId: section ? null : detail, section, admin: false };
  }
  return { view: null, caseId: null, section: null, admin: false };
}

function go(path) {
  // pushState keeps history so back-button works between views
  const newHash = path ? "#" + path.replace(/^#/, "") : window.location.pathname + window.location.search;
  history.pushState(null, "", newHash);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

// ─── App ──────────────────────────────────────────────────────────────────────
function App() {
  const [route, setRoute]   = useState(parseHash);
  const [hovered, setHovered] = useState(null);
  const [content, setContent] = useState(() => window.PortfolioContent.load());
  const [tweaks, setTweak]  = useTweaks(TWEAK_DEFAULTS);
  const [ready, setReady]   = useState(() => Boolean(sessionStorage.getItem("p-ready")));

  const Cursor = window.PortfolioCursor;

  const adminEnabled  = CFG.adminEnabled  !== false;
  const tweaksEnabled = CFG.tweaksEnabled !== false;

  const { view: expanded, caseId, section: activeSection, admin: adminOpen } = route;

  // Hydrate content from Supabase on mount; first render uses localStorage/defaults
  useEffect(() => {
    window.PortfolioContent.loadAsync().then(setContent).catch(() => {});
  }, []);

  // Listen to popstate (browser back/forward + our go() calls)
  useEffect(() => {
    const sync = () => setRoute(parseHash());
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e) => {
      // Ctrl+Shift+A → open admin
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "a" && adminEnabled) {
        e.preventDefault();
        go("admin");
        return;
      }
      if (adminOpen) return;
      if (e.key === "Escape") {
        if (caseId) go(expanded || "");
        else if (expanded) go("");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [adminOpen, caseId, expanded, adminEnabled]);

  // Apply tweaks to CSS variables
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--red",         tweaks.red);
    root.style.setProperty("--navy",        tweaks.navy);
    root.style.setProperty("--amber",       tweaks.showAccent ? tweaks.accent : tweaks.red);
    root.style.setProperty("--font-display",`"${tweaks.displayFont}", system-ui, sans-serif`);
    root.style.setProperty("--font-body",   `"${tweaks.bodyFont}", system-ui, sans-serif`);
  }, [tweaks]);

  // Scale 1920×1080 stage to viewport
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const update = () => setScale(Math.min(window.innerWidth / 1920, window.innerHeight / 1080));
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  // Update document title per route
  useEffect(() => {
    const base = content.site?.metaTitle || "RAISA Studio";
    const suffix = expanded === "graphic" ? " — Graphic Design"
                 : expanded === "webdev"  ? " — Software Development"
                 : adminOpen              ? " — Admin"
                 : "";
    document.title = activeSection === "about" ? `${base} - About Us` : base + suffix;
  }, [expanded, activeSection, adminOpen, content.site?.metaTitle]);

  useEffect(() => {
    if (!caseId) return;
    const activeWork = (content.works?.[expanded || "graphic"] || []).find(work => work.id === caseId || work.slug === caseId);
    const activeCase = content.cases?.[caseId];
    const caseTitle = activeWork?.title || activeCase?.title;
    if (!caseTitle) return;
    const base = content.site?.metaTitle || "RAISA Studio";
    document.title = `${base} - ${caseTitle} Case Study`;
    const meta = document.querySelector('meta[name="description"]');
    if (meta) {
      meta.setAttribute("content", activeWork?.short_description || activeCase?.short_description || content.site?.metaDescription || "");
    }
  }, [expanded, caseId, content]);

  // ── Navigation helpers ──────────────────────────────────────────────────────
  const goHome        = () => go("");
  const goGraphic     = () => go("graphic");
  const goWebdev      = () => go("webdev");
  const goAbout       = () => go(expanded === "webdev" ? "webdev/about" : expanded === "graphic" ? "graphic/about" : "about");
  const openCase      = (work) => {
    const side = work.side || expanded || "graphic";
    go(`${side}/${work.id}`);
  };
  const closeCase     = () => go(expanded || "");
  const openAdmin     = () => go("admin");
  const closeAdmin    = () => {
    // Don't put admin in history; go back to whatever was open before
    history.back();
  };
  const contact       = () => {
    const email = content.site?.contactEmail || "hello@voxstudio.dev";
    const sub   = encodeURIComponent(`Project inquiry — ${content.site?.brandName || "RAISA Studio"}`);
    window.location.href = `mailto:${email}?subject=${sub}`;
  };

  const onSplit = !expanded;
  const onDark  = expanded === "webdev";

  const handleReady = () => { sessionStorage.setItem("p-ready", "1"); setReady(true); };

  return (
    <div className="app-shell">
      {!ready && <LoadingScreen onDone={handleReady} />}
      {Cursor && <Cursor />}
      <div className="stage-wrap">
        <div
          className="stage"
          style={{ transform: `translate(-50%, -50%) scale(${scale})` }}
        >
          <Nav
            site={content.site}
            onDark={onDark}
            onSplit={onSplit}
            onHome={goHome}
            onGraphic={goGraphic}
            onWebdev={goWebdev}
            onAbout={goAbout}
            onContact={contact}
            onAdmin={adminEnabled ? openAdmin : null}
            expanded={expanded}
            activeSection={activeSection}
          />

          <Hero
            content={content}
            hovered={hovered}
            setHovered={setHovered}
            expanded={expanded}
            onExpand={(v) => v === "graphic" ? goGraphic() : goWebdev()}
          />

          <PageSlide show={expanded === "graphic"} enterX={-28}>
            <GraphicPage
              content={content}
              visible={expanded === "graphic"}
              onBack={goHome}
              onOpenCase={openCase}
              onContact={contact}
              activeSection={activeSection}
            />
          </PageSlide>

          <PageSlide show={expanded === "webdev"} enterX={28}>
            <WebDevPage
              content={content}
              visible={expanded === "webdev"}
              onBack={goHome}
              onOpenCase={openCase}
              onContact={contact}
              activeSection={activeSection}
            />
          </PageSlide>

          <CaseSheet
            content={content}
            activeSide={expanded}
            caseId={caseId}
            onClose={closeCase}
            onNavigate={openCase}
          />
        </div>

        {tweaksEnabled && (
          <TweaksPanel title="Tweaks">
            <TweakSection label="Palette">
              <TweakColor label="Graphic Design red" value={tweaks.red}
                onChange={(v) => setTweak("red", v)}
                options={["#E63946","#DC2626","#FF3B30","#C8102E"]} />
              <TweakColor label="Software Dev navy" value={tweaks.navy}
                onChange={(v) => setTweak("navy", v)}
                options={["#0B1B3A","#102A43","#050E22","#1E3A8A"]} />
              <TweakToggle label="Yellow accent" value={tweaks.showAccent}
                onChange={(v) => setTweak("showAccent", v)} />
              {tweaks.showAccent && (
                <TweakColor label="Accent" value={tweaks.accent}
                  onChange={(v) => setTweak("accent", v)}
                  options={["#F4B400","#FF7A1A","#FFD23F","#FF9F1C"]} />
              )}
            </TweakSection>
            <TweakSection label="Typography">
              <TweakSelect label="Display font" value={tweaks.displayFont}
                onChange={(v) => setTweak("displayFont", v)}
                options={["Space Grotesk","Archivo","Bricolage Grotesque","Instrument Serif"]} />
              <TweakSelect label="Body font" value={tweaks.bodyFont}
                onChange={(v) => setTweak("bodyFont", v)}
                options={["Manrope","Inter Tight","DM Sans","IBM Plex Sans"]} />
            </TweakSection>
            <TweakSection label="Jump to view">
              <TweakRadio label="" value={expanded || "hero"}
                onChange={(v) => {
                  if (v === "hero") goHome();
                  else if (v === "graphic") goGraphic();
                  else goWebdev();
                }}
                options={[
                  { value:"hero",    label:"Hero"    },
                  { value:"graphic", label:"Graphic" },
                  { value:"webdev",  label:"Software Dev" },
                ]} />
            </TweakSection>
          </TweaksPanel>
        )}
      </div>

      {adminEnabled && (
        <AdminPanel
          enabled={adminEnabled}
          open={adminOpen}
          content={content}
          onSave={setContent}
          onClose={closeAdmin}
        />
      )}
      <GlobalImageViewer />
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<App />);
