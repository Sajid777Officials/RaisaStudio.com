// Software Development expanded page
const { ArrowRight: WdArrowRight, ArrowOut: WdArrowOut, ArrowLeft: WdArrowLeft, webdev: WD_ICONS } = window.PortfolioIcons;
const { thumbs: WdThumbs, WEBDEV_PALETTES: WD_PAL } = window.PortfolioShared;

const GITHUB_USERNAME = "Sajid777Officials";

const LANG_COLORS = {
  JavaScript: "#f7df1e", TypeScript: "#3178c6", Python: "#3572A5",
  HTML: "#e34c26", CSS: "#563d7c", "C++": "#f34b7d", Java: "#b07219",
  Go: "#00ADD8", Rust: "#dea584", PHP: "#4F5D95", Swift: "#F05138",
};

function GitHubProjects() {
  const [repos, setRepos] = React.useState(null);
  const [err, setErr] = React.useState(false);

  React.useEffect(() => {
    fetch(`https://api.github.com/users/${GITHUB_USERNAME}/repos?sort=updated&per_page=30&type=public`)
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(data => {
        if (!Array.isArray(data)) { setErr(true); return; }
        setRepos(data.filter(r => !r.fork).slice(0, 12));
      })
      .catch(() => setErr(true));
  }, []);

  if (err || (repos && repos.length === 0)) return null;

  return (
    <div className="github-section section">
      <div className="section-head">
        <div>
          <div className="portfolio-count">live · syncs automatically</div>
          <h2 style={{ color: "white" }}>GitHub Projects</h2>
        </div>
        <a className="github-profile-link" href={`https://github.com/${GITHUB_USERNAME}`} target="_blank" rel="noopener noreferrer">
          View all on GitHub &thinsp;<WdArrowOut size={12} sw={2} />
        </a>
      </div>

      {!repos ? (
        <div className="github-loading">
          {[0,1,2,3,4,5].map(i => <div key={i} className="github-card github-skeleton" />)}
        </div>
      ) : (
        <div className="github-grid">
          {repos.map(repo => {
            const langColor = LANG_COLORS[repo.language] || "rgba(255,255,255,0.4)";
            const year = repo.pushed_at ? new Date(repo.pushed_at).getFullYear() : "";
            return (
              <a key={repo.id}
                 className="github-card"
                 href={repo.html_url}
                 target="_blank" rel="noopener noreferrer"
                 onClick={e => e.stopPropagation()}>
                <div className="github-card-top">
                  <span className="github-repo-icon">⌥</span>
                  <div className="github-repo-name">{repo.name.replace(/[-_]/g, " ")}</div>
                </div>
                {repo.description && (
                  <p className="github-desc">{repo.description}</p>
                )}
                <div className="github-card-foot">
                  {repo.language && (
                    <span className="github-lang">
                      <span className="github-lang-dot" style={{ background: langColor }} />
                      {repo.language}
                    </span>
                  )}
                  <span className="github-stars">
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                      <path d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.75.75 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.887 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25Z"/>
                    </svg>
                    {repo.stargazers_count}
                  </span>
                  {year && <span className="github-year">{year}</span>}
                </div>
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}

function WebDevPage({ visible, onBack, onOpenCase, onContact, content }) {
  const studio = content?.studios?.webdev || {};
  const services = content?.services?.webdev || [];
  const works = content?.works?.webdev || [];
  const techStack = content?.techStack || [];

  const pageRef = React.useRef(null);

  React.useEffect(() => {
    const page = pageRef.current;
    if (!page || !visible) return;

    const els = Array.from(page.querySelectorAll(
      ".service-card, .work-card, .page-stats > div, .page-lede, .section-head, .cta-foot"
    ));

    els.forEach((el, i) => {
      el.style.opacity   = "0";
      el.style.transform = "translateY(22px)";
      el.style.transition = `opacity 0.52s ease ${(i % 6) * 0.07}s, transform 0.52s ease ${(i % 6) * 0.07}s`;
    });

    const obs = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.style.opacity   = "1";
          entry.target.style.transform = "translateY(0)";
        }
      });
    }, { threshold: 0.12 });

    els.forEach(el => obs.observe(el));
    return () => { obs.disconnect(); els.forEach(el => { el.style.opacity = "0"; el.style.transform = "translateY(22px)"; }); };
  }, [visible]);

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
    <div ref={pageRef} className={"page page-webdev" + (visible ? " visible" : "")}>
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
            <div>
              {works.length > 0 && <div className="portfolio-count">{works.length} {works.length === 1 ? "project" : "projects"}</div>}
              <h2>{studio.portfolioTitle || "Selected builds"}</h2>
            </div>
            <div className="section-meta" style={{ opacity: 0.55 }}>{studio.portfolioMeta || "Click for case"}</div>
          </div>
          <div className="portfolio-grid">
            {works.map((work) => {
              const Thumb = WdThumbs[work.thumb] || WdThumbs.WebApp;
              const tilt = (e) => {
                const card = e.currentTarget;
                const rect = card.getBoundingClientRect();
                const x = (e.clientX - rect.left) / rect.width - 0.5;
                const y = (e.clientY - rect.top) / rect.height - 0.5;
                card.style.transition = "transform 0.08s linear";
                card.style.transform = `perspective(800px) rotateY(${x * 10}deg) rotateX(${-y * 10}deg) scale3d(1.02,1.02,1.02)`;
              };
              const untilt = (e) => {
                const c = e.currentTarget;
                c.style.transition = "transform 0.4s cubic-bezier(0.2,0.8,0.2,1)";
                c.style.transform = "";
              };
              return (
                <div key={work.id}
                     className={"work-card span-" + (work.span || 4)}
                     style={{ gridColumn: `span ${work.span || 4}` }}
                     onClick={() => onOpenCase({ ...work, side: "webdev" })}
                     onMouseMove={tilt}
                     onMouseLeave={untilt}>
                  <div className="work-thumb">
                    <div className={"work-thumb-inner" + (work.image ? " has-upload" : "")}>
                      {work.image
                        ? <img src={work.image} alt={work.title} />
                        : <Thumb palette={WD_PAL[work.pal] || WD_PAL[0]} title={(work.title || "").split(" ")[0]} />
                      }
                    </div>
                    {work.cat && <span className="work-badge">{work.cat}</span>}
                    <div className="work-overlay">
                      <div className="work-ov-cat">{work.cat}</div>
                      <div className="work-ov-title">{work.title}</div>
                      {work.stack && <div className="work-ov-stack">{work.stack}</div>}
                      <div className="work-ov-cta">View build &thinsp;<WdArrowOut size={12} sw={2} /></div>
                    </div>
                  </div>
                  <div className="work-meta">
                    <div>
                      <h3 className="work-title">{work.title}</h3>
                      <div className="work-cat">{work.cat}</div>
                      {work.stack && <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 11, opacity: 0.45, marginTop: 4, letterSpacing: "0.04em" }}>{work.stack}</div>}
                    </div>
                    <div className="work-year">{work.year}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <GitHubProjects />

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
