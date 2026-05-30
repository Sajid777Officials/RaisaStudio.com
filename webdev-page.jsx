// Software Development expanded page
const { ArrowRight: WdArrowRight, ArrowOut: WdArrowOut, ArrowLeft: WdArrowLeft, webdev: WD_ICONS } = window.PortfolioIcons;
const { thumbs: WdThumbs, WEBDEV_PALETTES: WD_PAL } = window.PortfolioShared;

function WebDevPage({ visible, onBack, onOpenCase, onContact, content }) {
  const studio = content?.studios?.webdev || {};
  const services = content?.services?.webdev || [];
  const works = content?.works?.webdev || [];
  const techStack = content?.techStack || [];

  const [animatedStats, setAnimatedStats] = React.useState(null);
  React.useEffect(() => {
    if (!visible) { setAnimatedStats(null); return; }
    const statsData = studio.pageStats || [];
    if (!statsData.length) return;
    const duration = 1400;
    const start = performance.now();
    const targets = statsData.map(s => parseFloat(s.value) || 0);
    let raf;
    function tick(now) {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      setAnimatedStats(targets.map(v => Math.round(v * eased)));
      if (t < 1) raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [visible]);

  return (
    <div className={"page page-webdev" + (visible ? " visible" : "")}>
      <div className="page-scroll">
        <div className="page-topbar">
          <button className="back-btn" onClick={onBack}><WdArrowLeft size={18} sw={2} />Back to hero</button>
          <div className="crumb">Index / Studio B - Software Development</div>
        </div>

        <div className="page-hero">
          <div>
            <div className="page-eyebrow"><span className="dot"></span>{studio.pageEyebrow || "Studio B - Software Development"}</div>
            <h1 className="page-title">
              {studio.pageTitlePre || "Sites that "}<em>{studio.pageTitleEm || "load"}</em>{studio.pageTitlePost || ""}<br/>
              {studio.pageTitleSecond || "and sites that sell."}
            </h1>
          </div>
          <div>
            <p className="page-lede">
              {studio.pageLede || "We ship production code with measurable performance and a tidy handoff."}
            </p>
            <div className="page-stats">
              {(studio.pageStats || []).map((stat, i) => (
                <div key={stat.label}>
                  <div className="stat-num">
                    {animatedStats ? animatedStats[i] : stat.value}
                    <span className="accent">{stat.suffix}</span>
                  </div>
                  <div className="stat-label">{stat.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="tech-rail">
          <div className="tech-rail-label">Stack -</div>
          <div className="tech-rail-marquee">
            <div className="tech-rail-track">
              {[0, 1].map(copy => (
                <div key={copy} className="tech-rail-stack" aria-hidden={copy === 1 ? "true" : undefined}>
                  {techStack.map((tool) => (
                    <React.Fragment key={`${copy}-${tool}`}>
                      <span>{tool}</span>
                      <span className="dot"></span>
                    </React.Fragment>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="section">
          <div className="section-head">
            <h2 style={{ color: "white" }}>Services <em style={{ fontFamily: "Fraunces, serif", fontWeight: 400, fontStyle: "italic", opacity: 0.5 }}>/ ten disciplines</em></h2>
            <div className="section-meta">{studio.servicesMeta || "Click a category to scope work"}</div>
          </div>
          <div className="service-grid">
            {services.map((service, index) => {
              const Icon = WD_ICONS[service.icon ?? index]?.Comp || WD_ICONS[0].Comp;
              return (
                <div key={service.num || service.title} className="service-card">
                  <div>
                    <div className="svc-num">{service.num}</div>
                    <div className="svc-icon"><Icon size={36} sw={1.5} /></div>
                    <div className="svc-title">{service.title}</div>
                    <div style={{ fontSize: 13, lineHeight: 1.45, opacity: 0.6, marginTop: 12, fontFamily: "var(--font-body)" }}>{service.desc}</div>
                  </div>
                  <div className="svc-arrow"><WdArrowOut size={20} sw={1.8} /></div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="portfolio-section">
          <div className="section-head">
            <h2>{studio.portfolioTitle || "Selected builds"}</h2>
            <div className="section-meta" style={{ opacity: 0.55 }}>{studio.portfolioMeta || "Click for case"}</div>
          </div>
          <div className="portfolio-grid">
            {works.map((work) => {
              const Thumb = WdThumbs[work.thumb] || WdThumbs.WebApp;
              return (
                <div key={work.id} className="work-card" style={{ gridColumn: `span ${work.span || 4}` }} onClick={() => onOpenCase({ ...work, side: "webdev" })}>
                  <div className="work-thumb">
                    {work.image
                      ? <img src={work.image} alt={work.title} style={{ width:"100%", height:"100%", objectFit:"cover", display:"block" }} />
                      : <Thumb palette={WD_PAL[work.pal] || WD_PAL[0]} title={(work.title || "").split(" ")[0]} />
                    }
                  </div>
                  <div className="work-meta">
                    <div>
                      <h3 className="work-title">{work.title}</h3>
                      <div className="work-cat">{work.cat}</div>
                      <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 11, opacity: 0.5, marginTop: 4, letterSpacing: "0.04em" }}>{work.stack}</div>
                    </div>
                    <div className="work-year">{work.year}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="cta-foot">
          <h3>{studio.ctaTitlePre || "Need a site that "}<em>{studio.ctaTitleEm || "actually"}</em><br/>{studio.ctaTitleSecond || "performs?"}</h3>
          <div>
            <p>{studio.ctaText}</p>
            <button className="cta-foot-btn" onClick={onContact}>{studio.ctaButton || "Start a build brief"} <WdArrowRight size={18} sw={2} /></button>
          </div>
        </div>
      </div>
    </div>
  );
}

window.PortfolioWebdev = WebDevPage;
