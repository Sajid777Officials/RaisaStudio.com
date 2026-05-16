// Main App — hash-based router
// Routes:
//   #           → hero (split view)
//   #graphic    → Graphic Design studio
//   #webdev     → Web Development studio
//   #graphic/g1 → Graphic studio + case study g1 open
//   #webdev/w1  → Web Dev studio + case study w1 open
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

// ─── Router helpers ───────────────────────────────────────────────────────────
function parseHash() {
  const h = window.location.hash.replace(/^#\/?/, "").trim();
  if (!h) return { view: null, caseId: null, admin: false };
  if (h === "admin") return { view: null, caseId: null, admin: true };
  const [view, caseId = null] = h.split("/");
  if (view === "graphic" || view === "webdev") return { view, caseId, admin: false };
  return { view: null, caseId: null, admin: false };
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

  const adminEnabled  = CFG.adminEnabled  !== false;
  const tweaksEnabled = CFG.tweaksEnabled !== false;

  const { view: expanded, caseId, admin: adminOpen } = route;

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
    const base = content.site?.metaTitle || "VOX Studio";
    const suffix = expanded === "graphic" ? " — Graphic Design"
                 : expanded === "webdev"  ? " — Web Development"
                 : adminOpen              ? " — Admin"
                 : "";
    document.title = base + suffix;
  }, [expanded, adminOpen, content.site?.metaTitle]);

  // ── Navigation helpers ──────────────────────────────────────────────────────
  const goHome        = () => go("");
  const goGraphic     = () => go("graphic");
  const goWebdev      = () => go("webdev");
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
    const sub   = encodeURIComponent(`Project inquiry — ${content.site?.brandName || "VOX Studio"}`);
    window.location.href = `mailto:${email}?subject=${sub}`;
  };

  const onSplit = !expanded;
  const onDark  = expanded === "webdev";

  return (
    <div className="app-shell">
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
            onContact={contact}
            onAdmin={adminEnabled ? openAdmin : null}
            expanded={expanded}
          />

          <Hero
            content={content}
            hovered={hovered}
            setHovered={setHovered}
            expanded={expanded}
            onExpand={(v) => v === "graphic" ? goGraphic() : goWebdev()}
          />

          <GraphicPage
            content={content}
            visible={expanded === "graphic"}
            onBack={goHome}
            onOpenCase={openCase}
            onContact={contact}
          />

          <WebDevPage
            content={content}
            visible={expanded === "webdev"}
            onBack={goHome}
            onOpenCase={openCase}
            onContact={contact}
          />

          <CaseSheet
            content={content}
            caseId={caseId}
            onClose={closeCase}
          />
        </div>

        {tweaksEnabled && (
          <TweaksPanel title="Tweaks">
            <TweakSection label="Palette">
              <TweakColor label="Graphic Design red" value={tweaks.red}
                onChange={(v) => setTweak("red", v)}
                options={["#E63946","#DC2626","#FF3B30","#C8102E"]} />
              <TweakColor label="Web Dev navy" value={tweaks.navy}
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
                  { value:"webdev",  label:"Web Dev" },
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
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<App />);
