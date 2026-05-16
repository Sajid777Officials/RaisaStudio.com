// Hero split: Graphic Design (left) / Web Development (right)
const { ArrowOut } = window.PortfolioIcons;

const GRAPHIC_SERVICES = [
  "Packaging", "Flyer Design", "Vector Art", "Vector Tracing", "Poster Design",
  "File Conversion", "Embroidery Digitizing", "Business Cards", "Social Media", "Presentations",
];

const WEBDEV_SERVICES = [
  "Website Design", "Web Development", "Landing Pages", "Portfolio Sites", "Business Websites",
  "E-commerce", "App Development", "UI / UX", "Frontend", "Backend",
];

function Hero({ hovered, setHovered, expanded, onExpand, content }) {
  const isLeftFull = expanded === "graphic";
  const isRightFull = expanded === "webdev";
  const isExpanded = !!expanded;
  const graphic = content?.studios?.graphic || {};
  const webdev = content?.studios?.webdev || {};
  const graphicServices = (content?.services?.graphic || GRAPHIC_SERVICES).map((service) =>
    typeof service === "string" ? service : service.title
  );
  const webdevServices = (content?.services?.webdev || WEBDEV_SERVICES).map((service) =>
    typeof service === "string" ? service : service.title
  );
  const graphicStats = graphic.heroStats || [
    { value: "120", suffix: "+", label: "Brands shipped" },
    { value: "06", suffix: "y", label: "In practice" },
  ];
  const webdevStats = webdev.heroStats || [
    { value: "84", suffix: "+", label: "Sites launched" },
    { value: "99", suffix: "%", label: "Lighthouse avg." },
  ];

  return (
    <div className={"hero" + (isExpanded ? " expanded" : "")}>
      <div
        className={
          "hero-panel panel-graphic" +
          (isLeftFull ? " full" : "") +
          (isRightFull ? " hidden" : "") +
          (!isExpanded && hovered === "graphic" ? " boost" : "") +
          (!isExpanded && hovered === "webdev" ? " dim" : "")
        }
        onMouseEnter={() => !isExpanded && setHovered("graphic")}
        onMouseLeave={() => !isExpanded && setHovered(null)}
        onClick={() => !isExpanded && onExpand("graphic")}
      >
        <div className="hero-inner">
          <div>
            <div className="panel-eyebrow">
              <span className="bar"></span>
              {graphic.heroEyebrow || "01 - Discipline A"}
            </div>
            <h1 className="panel-title">
              <span className="stack">{graphic.heroTitleTop || "Graphic"}</span>
              <span className="stack"><em>{graphic.heroTitleEm || "design"}</em>{graphic.heroTitleSuffix || "."}</span>
            </h1>
            <p className="panel-sub">
              {graphic.heroSub || "Identity, print, packaging and editorial work for founders who want their brand to look like it means business."}
            </p>
            <div className="tag-cloud">
              {graphicServices.map((service) => (
                <span key={service} className="tag-red">{service}</span>
              ))}
            </div>
          </div>
          <div className="panel-foot">
            <button className="panel-cta" onClick={(e) => { e.stopPropagation(); onExpand("graphic"); }}>
              {graphic.heroCta || "Enter Graphic Studio"}
              <span className="arrow"><ArrowOut size={20} sw={2} /></span>
            </button>
            <div className="panel-meta">
              {graphicStats.map((stat) => (
                <div className="stat" key={stat.label}>
                  <div className="stat-num">{stat.value}<span style={{ color: "var(--red)" }}>{stat.suffix}</span></div>
                  <div className="stat-label">{stat.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="hover-tag"><span className="pulse"></span>Click to enter</div>
      </div>

      <div className="hero-divider">
        <span className="vs">/</span>
      </div>

      <div
        className={
          "hero-panel panel-webdev" +
          (isRightFull ? " full" : "") +
          (isLeftFull ? " hidden" : "") +
          (!isExpanded && hovered === "webdev" ? " boost" : "") +
          (!isExpanded && hovered === "graphic" ? " dim" : "")
        }
        onMouseEnter={() => !isExpanded && setHovered("webdev")}
        onMouseLeave={() => !isExpanded && setHovered(null)}
        onClick={() => !isExpanded && onExpand("webdev")}
      >
        <div className="hero-inner">
          <div>
            <div className="panel-eyebrow">
              <span className="bar"></span>
              {webdev.heroEyebrow || "02 - Discipline B"}
            </div>
            <h1 className="panel-title">
              <span className="stack">{webdev.heroTitleTop || "Web &"}</span>
              <span className="stack"><em>{webdev.heroTitleEm || "development"}</em>{webdev.heroTitleSuffix || "."}</span>
            </h1>
            <p className="panel-sub">
              {webdev.heroSub || "Engineered websites, web apps and storefronts. Type-safe, fast, search-friendly - built to convert and built to last."}
            </p>
            <div className="tag-cloud">
              {webdevServices.map((service) => (
                <span key={service} className="tag-line">{service}</span>
              ))}
            </div>
          </div>
          <div className="panel-foot">
            <button className="panel-cta" onClick={(e) => { e.stopPropagation(); onExpand("webdev"); }}>
              {webdev.heroCta || "Enter Web Studio"}
              <span className="arrow"><ArrowOut size={20} sw={2} /></span>
            </button>
            <div className="panel-meta">
              {webdevStats.map((stat) => (
                <div className="stat" key={stat.label}>
                  <div className="stat-num">{stat.value}<span style={{ color: "var(--amber)" }}>{stat.suffix}</span></div>
                  <div className="stat-label">{stat.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="hover-tag"><span className="pulse"></span>Click to enter</div>
      </div>
    </div>
  );
}

window.PortfolioHero = Hero;
