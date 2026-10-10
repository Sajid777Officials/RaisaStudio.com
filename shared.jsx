// Shared header + portfolio thumbnail generators
const { ArrowRight, ArrowLeft, ArrowOut, Close, Lock } = window.PortfolioIcons;

function sharedSafeExternalUrl(value) {
  const normalized = String(value || "").trim();
  if (!/^https:\/\/(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?::[1-9][0-9]{0,4})?(?:\/[^\s\\]*)?$/.test(normalized)) {
    return "";
  }
  try {
    const parsed = new URL(normalized);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password
      ? parsed.href
      : "";
  } catch (_) {
    return "";
  }
}

function Nav({ onDark, onSplit, onContact, onHome, onGraphic, onWebdev, onAbout, onAdmin, site, expanded, activeSection }) {
  const brand = site?.brandName || "RAISA Studio";
  const mark = site?.logoMark || "V";
  const trademark = site?.trademark || "";
  const navigation = (site?.navigation || [
    { id: "home", label: "Home", target: "home", is_visible: true },
    { id: "graphic", label: "Graphic Design", target: "graphic", is_visible: true },
    { id: "webdev", label: "Software Dev", target: "webdev", is_visible: true },
    { id: "about", label: "About Us", target: "about", is_visible: true },
  ]).filter((item) => item.is_visible !== false);
  const handlers = {
    home: onHome,
    graphic: onGraphic,
    webdev: onWebdev,
    about: onAbout,
    contact: onContact,
  };
  const isActive = (target) => (
    (target === "home" && !expanded && activeSection !== "about") ||
    (target === "graphic" && expanded === "graphic" && activeSection !== "about") ||
    (target === "webdev" && expanded === "webdev" && activeSection !== "about") ||
    (target === "about" && activeSection === "about")
  );

  return (
    <header className={"nav" + (onDark ? " on-dark" : "") + (onSplit ? " on-split" : "")}>
      <button type="button" className="nav-logo" data-edit-target="site" data-edit-field="brand" data-edit-label="Brand identity" onClick={onHome} aria-label={`Return to ${brand} home`}>
        <div className="logo-mark">{mark}</div>
        <div>{brand}<span style={{ fontFamily: "Fraunces, serif", fontStyle: "italic", fontWeight: 400, marginLeft: 6, opacity: 0.6 }}>{trademark}</span></div>
      </button>
      <nav className="nav-links" data-edit-target="site" data-edit-field="navigation" data-edit-label="Navigation" aria-label="Primary navigation">
        {navigation.map((item) => {
          const externalUrl = item.target === "external" ? sharedSafeExternalUrl(item.url) : "";
          if (externalUrl) {
            return (
              <a key={item.id || item.label} href={externalUrl} target="_blank" rel="noopener noreferrer">
                {item.label}
              </a>
            );
          }
          return (
            <button
              type="button"
              key={item.id || item.label}
              onClick={handlers[item.target] || onHome}
              className={isActive(item.target) ? "active" : ""}
              aria-current={isActive(item.target) ? "page" : undefined}
            >
              {item.label}
            </button>
          );
        })}
      </nav>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        {onAdmin && (
          <button type="button" className="nav-admin-btn" onClick={onAdmin} title="Open admin panel">
            <Lock size={13} sw={2.2} />
            Admin
          </button>
        )}
      </div>
    </header>
  );
}

function PortfolioFooter({ site, onContact, dark = false }) {
  const footer = site?.footer || {};
  const contact = site?.contact || {};
  const email = String(contact.email || site?.contactEmail || "").trim();
  const phone = String(contact.phone || "").trim();
  const phoneHref = phone ? `tel:${phone.replace(/[^\d+]/g, "")}` : "";
  const location = String(contact.location || "").trim();
  const socialLinks = (site?.socialLinks || [])
    .map((item) => ({ ...item, safeUrl: sharedSafeExternalUrl(item.url) }))
    .filter((item) => item.is_visible !== false && item.safeUrl);
  return (
    <footer className={"portfolio-footer" + (dark ? " dark" : "")} data-edit-target="site" data-edit-field="footer" data-edit-label="Footer">
      <div>
        <div className="portfolio-footer-eyebrow">{footer.eyebrow || "Graphic design x software development"}</div>
        <h2>{footer.tagline || "Thoughtful identities and production-ready digital products, built under one roof."}</h2>
      </div>
      <div className="portfolio-footer-actions">
        <button type="button" onClick={onContact}>{footer.contactLabel || "Start a project"}</button>
        {socialLinks.length > 0 && (
          <div className="portfolio-footer-socials" data-edit-target="site" data-edit-field="social" data-edit-label="Social links">
            {socialLinks.map((item) => (
              <a key={item.id || item.label} href={item.safeUrl} target="_blank" rel="noopener noreferrer">
                {item.label}
              </a>
            ))}
          </div>
        )}
        {(email || phone || location) && (
          <address className="portfolio-footer-contact" data-edit-target="site" data-edit-field="contact" data-edit-label="Contact details">
            {email && <a href={`mailto:${email}`}>{email}</a>}
            {phone && <a href={phoneHref}>{phone}</a>}
            {location && <span>{location}</span>}
          </address>
        )}
      </div>
      <div className="portfolio-footer-copy">
        © {new Date().getFullYear()} {footer.copyright || `${site?.brandName || "RAISA Studio"}. All rights reserved.`}
      </div>
    </footer>
  );
}

/* ============= Procedural thumbnail generators =============
   The user said they'll upload images later — these are
   intentional placeholder designs (typographic, geometric),
   not faux photographs.
*/

function ThumbPackaging({ palette, title }) {
  return (
    <div style={{ position: "absolute", inset: 0, background: palette[0], display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ width: "62%", height: "78%", background: palette[1], borderRadius: 4, display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "8% 8%", boxShadow: "0 20px 40px rgba(0,0,0,0.35)" }}>
        <div style={{ fontFamily: "Space Grotesk, sans-serif", fontWeight: 800, fontSize: 26, color: palette[2], letterSpacing: "-0.04em", lineHeight: 0.95 }}>{title.split(" ")[0]}<br/>{title.split(" ")[1] || ""}</div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          <div style={{ width: 36, height: 36, background: palette[2], borderRadius: 999 }}></div>
          <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 9, color: palette[2], letterSpacing: "0.1em", textTransform: "uppercase", opacity: 0.7 }}>N° 04</div>
        </div>
      </div>
    </div>
  );
}

function ThumbPoster({ palette, title, num }) {
  return (
    <div style={{ position: "absolute", inset: 0, background: palette[0], padding: "8% 8%", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
      <div style={{ fontFamily: "Fraunces, serif", fontStyle: "italic", fontSize: 38, fontWeight: 400, color: palette[1], lineHeight: 0.9, letterSpacing: "-0.03em" }}>{title}</div>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
        <div style={{ fontFamily: "Space Grotesk, sans-serif", fontWeight: 800, fontSize: 88, color: palette[1], lineHeight: 0.9, letterSpacing: "-0.06em" }}>{num}</div>
        <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 9, color: palette[1], letterSpacing: "0.18em", textTransform: "uppercase" }}>Vol·26</div>
      </div>
    </div>
  );
}

function ThumbBrand({ palette, title }) {
  return (
    <div style={{ position: "absolute", inset: 0, background: palette[0], display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 8 }}>
      <div style={{ width: 92, height: 92, borderRadius: 999, background: palette[1], display: "flex", alignItems: "center", justifyContent: "center", color: palette[0], fontFamily: "Space Grotesk, sans-serif", fontWeight: 800, fontSize: 56, letterSpacing: "-0.06em" }}>
        {title[0]}
      </div>
      <div style={{ fontFamily: "Space Grotesk, sans-serif", fontWeight: 600, fontSize: 14, color: palette[1], letterSpacing: "0.04em", textTransform: "uppercase", marginTop: 6 }}>{title}</div>
    </div>
  );
}

function ThumbSocial({ palette, title }) {
  return (
    <div style={{ position: "absolute", inset: 0, background: palette[0], padding: "6% 6%", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
      {[0,1,2,3].map(i => (
        <div key={i} style={{ background: i % 2 === 0 ? palette[1] : palette[2], borderRadius: 3, display: "flex", alignItems: "center", justifyContent: "center", color: i % 2 === 0 ? palette[0] : palette[1], fontFamily: "Space Grotesk", fontWeight: 800, fontSize: 18, letterSpacing: "-0.03em", padding: 8, textAlign: "center", lineHeight: 1 }}>
          {i === 0 ? title.split(" ")[0] : i === 1 ? "01" : i === 2 ? "→" : "•"}
        </div>
      ))}
    </div>
  );
}

function ThumbWebApp({ palette, title }) {
  return (
    <div style={{ position: "absolute", inset: 0, background: palette[0], padding: 18, display: "flex", flexDirection: "column" }}>
      <div style={{ height: 18, display: "flex", gap: 6, alignItems: "center", marginBottom: 10 }}>
        <div style={{ width: 8, height: 8, borderRadius: 999, background: "#FF5F57" }}></div>
        <div style={{ width: 8, height: 8, borderRadius: 999, background: "#FEBC2E" }}></div>
        <div style={{ width: 8, height: 8, borderRadius: 999, background: "#28C840" }}></div>
        <div style={{ flex: 1, height: 12, borderRadius: 4, background: palette[1], marginLeft: 8 }}></div>
      </div>
      <div style={{ flex: 1, background: palette[1], borderRadius: 6, padding: 16, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontFamily: "Space Grotesk", fontWeight: 800, fontSize: 22, color: palette[2], letterSpacing: "-0.03em", lineHeight: 1 }}>{title}</div>
          <div style={{ fontFamily: "JetBrains Mono", fontSize: 9, color: palette[2], opacity: 0.6, marginTop: 4, letterSpacing: "0.06em" }}>// localhost:3000</div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <div style={{ flex: 1, height: 28, background: palette[2], borderRadius: 4 }}></div>
          <div style={{ width: 60, height: 28, background: palette[3] || palette[2], borderRadius: 4, opacity: 0.5 }}></div>
        </div>
      </div>
    </div>
  );
}

function ThumbCode({ palette, title }) {
  const lines = [
    { w: 0.55, c: 0 }, { w: 0.78, c: 1 }, { w: 0.42, c: 2 },
    { w: 0.66, c: 1 }, { w: 0.30, c: 0 }, { w: 0.70, c: 2 },
    { w: 0.50, c: 1 }, { w: 0.82, c: 0 },
  ];
  return (
    <div style={{ position: "absolute", inset: 0, background: palette[0], padding: 22, display: "flex", flexDirection: "column", gap: 8, fontFamily: "JetBrains Mono", fontSize: 9 }}>
      {lines.map((l, i) => (
        <div key={i} style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{ width: 14, color: palette[2], opacity: 0.4 }}>{String(i+1).padStart(2,"0")}</div>
          <div style={{ width: `${l.w * 100}%`, height: 6, background: [palette[1], palette[2], palette[3] || palette[2]][l.c], borderRadius: 2, opacity: l.c === 0 ? 1 : 0.7 }}></div>
        </div>
      ))}
      <div style={{ position: "absolute", bottom: 18, right: 22, fontFamily: "Space Grotesk", fontWeight: 700, fontSize: 18, color: palette[1], letterSpacing: "-0.03em" }}>{title}</div>
    </div>
  );
}

function ThumbDashboard({ palette, title }) {
  return (
    <div style={{ position: "absolute", inset: 0, background: palette[0], padding: 22, display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontFamily: "Space Grotesk", fontWeight: 700, fontSize: 16, color: palette[1], letterSpacing: "-0.02em" }}>{title}</div>
        <div style={{ width: 24, height: 8, background: palette[1], borderRadius: 2, opacity: 0.4 }}></div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, flex: 1 }}>
        <div style={{ background: palette[1], borderRadius: 6, padding: 10, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
          <div style={{ fontFamily: "JetBrains Mono", fontSize: 8, color: palette[0], opacity: 0.7, letterSpacing: "0.1em", textTransform: "uppercase" }}>Revenue</div>
          <div style={{ fontFamily: "Space Grotesk", fontWeight: 800, fontSize: 28, color: palette[0], letterSpacing: "-0.04em", lineHeight: 1 }}>$ 84K</div>
        </div>
        <div style={{ background: palette[2], borderRadius: 6, padding: 10, position: "relative", overflow: "hidden" }}>
          <svg viewBox="0 0 100 50" style={{ position: "absolute", left: 0, bottom: 0, width: "100%", height: "70%" }}>
            <polyline points="0,40 15,30 30,35 45,18 60,25 75,10 100,15" fill="none" stroke={palette[1]} strokeWidth="2" />
          </svg>
        </div>
      </div>
    </div>
  );
}

const GRAPHIC_PALETTES = [
  ["#1A1A1A", "#F4EFE6", "#E63946"], // dark + cream + red
  ["#E63946", "#FAF7F1", "#1A1A1A"], // red bg
  ["#F4EFE6", "#1A1A1A", "#E63946"], // cream + dark
  ["#F4B400", "#1A1A1A", "#E63946"], // amber
  ["#0B1B3A", "#FAF7F1", "#E63946"], // navy + cream
  ["#C8102E", "#FAF7F1", "#1A1A1A"], // deep red
];

const WEBDEV_PALETTES = [
  ["#050E22", "#F4EFE6", "#E63946", "#F4B400"],
  ["#1B2C4E", "#0B1B3A", "#FAF7F1", "#F4B400"],
  ["#0B1B3A", "#F4B400", "#050E22", "#E63946"],
  ["#FAF7F1", "#0B1B3A", "#E63946", "#F4B400"],
  ["#102A43", "#FAF7F1", "#F4B400", "#E63946"],
  ["#050E22", "#FAF7F1", "#E63946", "#F4B400"],
];

window.PortfolioShared = {
  Nav,
  Footer: PortfolioFooter,
  thumbs: {
    Packaging: ThumbPackaging,
    Poster: ThumbPoster,
    Brand: ThumbBrand,
    Social: ThumbSocial,
    WebApp: ThumbWebApp,
    Code: ThumbCode,
    Dashboard: ThumbDashboard,
  },
  GRAPHIC_PALETTES,
  WEBDEV_PALETTES,
};
