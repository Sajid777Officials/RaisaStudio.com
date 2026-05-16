// Graphic Design expanded page
const { ArrowRight: GdArrowRight, ArrowOut: GdArrowOut, ArrowLeft: GdArrowLeft, graphic: GD_ICONS } = window.PortfolioIcons;
const { thumbs: GdThumbs, GRAPHIC_PALETTES: GD_PAL } = window.PortfolioShared;

function GraphicPage({ visible, onBack, onOpenCase, onContact, content }) {
  const studio = content?.studios?.graphic || {};
  const services = content?.services?.graphic || [];
  const works = content?.works?.graphic || [];

  return (
    <div className={"page page-graphic" + (visible ? " visible" : "")}>
      <div className="page-scroll">
        <div className="page-topbar">
          <button className="back-btn" onClick={onBack}><GdArrowLeft size={18} sw={2} />Back to hero</button>
          <div className="crumb">Index / Studio A - Graphic Design</div>
        </div>

        <div className="page-hero">
          <div>
            <div className="page-eyebrow"><span className="dot"></span>{studio.pageEyebrow || "Studio A - Graphic Design"}</div>
            <h1 className="page-title">
              {studio.pageTitlePre || "Brands, "}<em>{studio.pageTitleEm || "built"}</em>{studio.pageTitlePost || ""}<br/>
              {studio.pageTitleSecond || "to be looked at."}
            </h1>
          </div>
          <div>
            <p className="page-lede">
              {studio.pageLede || "Ten focused disciplines delivered with print-ready files and a process you can stand behind."}
            </p>
            <div className="page-stats">
              {(studio.pageStats || []).map((stat) => (
                <div key={stat.label}>
                  <div className="stat-num">{stat.value}<span className="accent">{stat.suffix}</span></div>
                  <div className="stat-label">{stat.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="section">
          <div className="section-head">
            <h2>Services <em style={{ fontFamily: "Fraunces, serif", fontWeight: 400, fontStyle: "italic", opacity: 0.5 }}>/ ten disciplines</em></h2>
            <div className="section-meta">{studio.servicesMeta || "Click a category to brief us"}</div>
          </div>
          <div className="service-grid">
            {services.map((service, index) => {
              const Icon = GD_ICONS[service.icon ?? index]?.Comp || GD_ICONS[0].Comp;
              return (
                <div key={service.num || service.title} className="service-card">
                  <div>
                    <div className="svc-num">{service.num}</div>
                    <div className="svc-icon"><Icon size={36} sw={1.5} /></div>
                    <div className="svc-title-wrap">
                      <span className="svc-title-tag">{service.title}</span>
                    </div>
                    <div style={{ fontSize: 13, lineHeight: 1.45, opacity: 0.62, marginTop: 12, fontFamily: "var(--font-body)" }}>{service.desc}</div>
                  </div>
                  <div className="svc-arrow"><GdArrowOut size={20} sw={1.8} /></div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="portfolio-section">
          <div className="section-head">
            <h2>{studio.portfolioTitle || "Selected work"}</h2>
            <div className="section-meta" style={{ opacity: 0.55 }}>{studio.portfolioMeta || "Click for case"}</div>
          </div>
          <div className="portfolio-grid">
            {works.map((work) => {
              const Thumb = GdThumbs[work.thumb] || GdThumbs.Brand;
              return (
                <div key={work.id} className="work-card" style={{ gridColumn: `span ${work.span || 4}` }} onClick={() => onOpenCase({ ...work, side: "graphic" })}>
                  <div className="work-thumb">
                    {work.image
                      ? <img src={work.image} alt={work.title} style={{ width:"100%", height:"100%", objectFit:"cover", display:"block" }} />
                      : <Thumb palette={GD_PAL[work.pal] || GD_PAL[0]} title={work.title} num={work.num || "01"} />
                    }
                  </div>
                  <div className="work-meta">
                    <div>
                      <h3 className="work-title">{work.title}</h3>
                      <div className="work-cat">{work.cat}</div>
                    </div>
                    <div className="work-year">{work.year}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="cta-foot">
          <h3>{studio.ctaTitlePre || "Got a brand "}<em>{studio.ctaTitleEm || "worth"}</em><br/>{studio.ctaTitleSecond || "looking at?"}</h3>
          <div>
            <p>{studio.ctaText}</p>
            <button className="cta-foot-btn" onClick={onContact}>{studio.ctaButton || "Start a graphic brief"} <GdArrowRight size={18} sw={2} /></button>
          </div>
        </div>
      </div>
    </div>
  );
}

window.PortfolioGraphic = GraphicPage;
