// Software Development expanded page
const { ArrowRight: WdArrowRight, ArrowOut: WdArrowOut, ArrowLeft: WdArrowLeft, Close: WdClose, webdev: WD_ICONS } = window.PortfolioIcons;
const { thumbs: WdThumbs, WEBDEV_PALETTES: WD_PAL } = window.PortfolioShared;

const GITHUB_USERNAME = "Sajid777Officials";
const WD_CATEGORY_THUMBS = ["WebApp", "Dashboard", "WebApp", "WebApp", "WebApp", "WebApp", "Dashboard", "Dashboard", "Code", "Code"];

const LANG_COLORS = {
  JavaScript: "#f7df1e", TypeScript: "#3178c6", Python: "#3572A5",
  HTML: "#e34c26", CSS: "#563d7c", "C++": "#f34b7d", Java: "#b07219",
  Go: "#00ADD8", Rust: "#dea584", PHP: "#4F5D95", Swift: "#F05138",
};

function wdSlugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function wdCategoryFromService(service, index) {
  const name = service.name || service.title || `Category ${index + 1}`;
  const slug = wdSlugify(service.slug || service.id || name) || `category-${index + 1}`;
  const order = Number.isFinite(Number(service.order)) ? Number(service.order) : index + 1;
  const shortDescription = service.short_description || service.shortDescription || service.desc || "";
  return {
    ...service,
    id: service.id || slug,
    name,
    title: service.title || name,
    slug,
    short_description: shortDescription,
    desc: service.desc || shortDescription,
    order,
    num: service.num || String(order).padStart(2, "0"),
    icon: Number.isFinite(Number(service.icon)) ? Number(service.icon) : index,
    is_active: service.is_active !== false,
  };
}

function wdProjectFromContent(project, index, categoryMap, categories) {
  const fallbackCategory = categories[index % Math.max(categories.length, 1)] || {};
  const title = project.title || `Build ${index + 1}`;
  const categoryId = project.category_id || project.categoryId || project.category_slug || fallbackCategory.slug || "";
  return {
    ...project,
    id: project.id || `project-${wdSlugify(title) || index + 1}`,
    category_id: categoryId,
    title,
    slug: wdSlugify(project.slug || title),
    short_description: project.short_description || project.shortDescription || project.desc || "",
    full_description: project.full_description || project.fullDescription || project.description || "",
    image_url: project.image_url || project.image || "",
    gallery_images: Array.isArray(project.gallery_images) ? project.gallery_images : [],
    tags: Array.isArray(project.tags) ? project.tags : String(project.tags || "").split(",").map(tag => tag.trim()).filter(Boolean),
    client_name: project.client_name || project.clientName || "",
    project_date: project.project_date || project.projectDate || project.year || "",
    stack: project.stack || project.tools || "",
    is_featured: project.is_featured === true,
    is_published: project.is_published !== false,
    sort_order: Number.isFinite(Number(project.sort_order)) ? Number(project.sort_order) : index + 1,
    thumb: project.thumb || categoryMap[categoryId]?.thumb || WD_CATEGORY_THUMBS[categoryMap[categoryId]?.icon] || "WebApp",
    pal: Number.isFinite(Number(project.pal)) ? Number(project.pal) : index % WD_PAL.length,
  };
}

function wdFormatDate(value) {
  if (!value) return "";
  if (/^\d{4}$/.test(String(value))) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

function WebDevProjectThumb({ project, category, galleryId }) {
  const image = project.image_url || project.image;
  const thumbName = project.thumb || category?.thumb || WD_CATEGORY_THUMBS[category?.icon] || "WebApp";
  const Thumb = WdThumbs[thumbName] || WdThumbs.WebApp;
  const palette = WD_PAL[project.pal] || WD_PAL[(category?.icon || 0) % WD_PAL.length] || WD_PAL[0];

  return (
    <div className={"category-project-thumb-inner" + (image ? " has-upload" : "")}>
      {image
        ? <img src={image} alt={project.cover_alt || project.title} data-image-gallery={galleryId || undefined} data-gallery-caption={project.short_description || project.title} />
        : <Thumb palette={palette} title={project.title} num={project.num || String(project.sort_order || 1).padStart(2, "0")} />
      }
    </div>
  );
}

function WebDevProjectModal({ project, category, onClose }) {
  React.useEffect(() => {
    const onKey = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const projectDate = wdFormatDate(project.project_date);
  const categoryName = category?.name || "Build";
  const gallery = project.gallery_images || [];
  const galleryId = `webdev-project-${project.id || project.slug}`;

  return (
    <div className="project-lightbox" role="dialog" aria-modal="true" aria-labelledby="webdev-project-lightbox-title" onClick={onClose}>
      <div className="project-lightbox-panel" onClick={(event) => event.stopPropagation()}>
        <button type="button" className="project-lightbox-close" onClick={onClose} aria-label="Close build preview">
          <WdClose size={16} sw={2.2} />
        </button>
        <div className="project-lightbox-media">
          <WebDevProjectThumb project={project} category={category} galleryId={galleryId} />
        </div>
        <div className="project-lightbox-body">
          <div className="project-kicker">
            <span>{categoryName}</span>
            {project.is_featured && <span>Featured</span>}
          </div>
          <h3 id="webdev-project-lightbox-title">{project.title}</h3>
          {project.short_description && <p className="project-modal-short">{project.short_description}</p>}
          {project.full_description && <p className="project-modal-full">{project.full_description}</p>}
          <div className="project-modal-meta">
            {project.client_name && <div><span>Client</span>{project.client_name}</div>}
            {projectDate && <div><span>Date</span>{projectDate}</div>}
            {project.stack && <div><span>Stack</span>{project.stack}</div>}
          </div>
          {project.tags?.length > 0 && (
            <div className="project-tag-row">
              {project.tags.map((tag) => <span key={tag}>{tag}</span>)}
            </div>
          )}
          {gallery.length > 0 && (
            <div className="project-gallery-strip">
              {gallery.map((item, index) => {
                const src = typeof item === "string" ? item : item.image_url || item.url || item.src || "";
                if (!src) return null;
                const alt = typeof item === "string" ? `${project.title} gallery ${index + 1}` : (item.alt_text || item.alt || `${project.title} gallery ${index + 1}`);
                const caption = typeof item === "string" ? alt : (item.caption || alt);
                return (
                  <button type="button" key={`${src}-${index}`} data-gallery-trigger aria-label={`Open ${alt}`}>
                    <img src={src} alt={alt} data-image-gallery={galleryId} data-gallery-caption={caption} />
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

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

function WebDevPage({ visible, onBack, onOpenCase, onContact, content, activeSection }) {
  const studio = content?.studios?.webdev || {};
  const services = content?.services?.webdev || [];
  const works = (content?.works?.webdev || []).filter(work => work.is_published !== false);
  const projects = content?.projects?.webdev || [];
  const techStack = content?.techStack || [];
  const aboutPillars = Array.isArray(studio.aboutPillars) && studio.aboutPillars.length
    ? studio.aboutPillars
    : ["Fast interfaces", "Stable backends", "Clean handoff"];
  const pageRef = React.useRef(null);
  const showcaseRef = React.useRef(null);
  const filterTimerRef = React.useRef(null);
  const [activeCategory, setActiveCategory] = React.useState(null);
  const [filtering, setFiltering] = React.useState(false);
  const [visibleCount, setVisibleCount] = React.useState(6);
  const [previewProject, setPreviewProject] = React.useState(null);

  const categories = React.useMemo(() => (
    services
      .map(wdCategoryFromService)
      .filter(category => category.is_active !== false)
      .sort((a, b) => (a.order || 0) - (b.order || 0))
  ), [services]);

  const categoryMap = React.useMemo(() => (
    categories.reduce((map, category) => {
      map[category.slug] = category;
      return map;
    }, {})
  ), [categories]);

  const categoryProjects = React.useMemo(() => (
    projects
      .map((project, index) => wdProjectFromContent(project, index, categoryMap, categories))
      .filter(project => project.is_published !== false)
  ), [projects, categoryMap, categories]);

  const selectedCategory = activeCategory ? categoryMap[activeCategory] : null;
  const filteredProjects = React.useMemo(() => (
    activeCategory
      ? categoryProjects
          .filter(project => project.category_id === activeCategory)
          .sort((a, b) => Number(b.is_featured) - Number(a.is_featured) || (a.sort_order || 0) - (b.sort_order || 0) || a.title.localeCompare(b.title))
      : []
  ), [activeCategory, categoryProjects]);
  const visibleProjects = filteredProjects.slice(0, visibleCount);

  React.useEffect(() => () => {
    if (filterTimerRef.current) clearTimeout(filterTimerRef.current);
  }, []);

  React.useEffect(() => {
    if (!visible || activeSection !== "about") return;
    const timer = window.setTimeout(() => {
      pageRef.current?.querySelector("#about-webdev")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
    return () => window.clearTimeout(timer);
  }, [visible, activeSection]);

  React.useEffect(() => {
    if (activeCategory && !categoryMap[activeCategory]) setActiveCategory(null);
  }, [activeCategory, categoryMap]);

  const selectCategory = (category) => {
    setActiveCategory(category.slug);
    setVisibleCount(6);
    setPreviewProject(null);
    setFiltering(true);
    if (filterTimerRef.current) clearTimeout(filterTimerRef.current);
    filterTimerRef.current = setTimeout(() => setFiltering(false), 260);
    window.setTimeout(() => {
      showcaseRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 40);
  };

  const clearCategory = () => {
    setActiveCategory(null);
    setPreviewProject(null);
    pageRef.current?.querySelector(".service-grid")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  React.useEffect(() => {
    const page = pageRef.current;
    if (!page || !visible) return;

    const els = Array.from(page.querySelectorAll(
      ".service-card, .work-card, .page-stats > div, .page-lede, .section-head, .about-section"
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
          <div className="service-grid" aria-label="Software development service categories">
            {categories.map((service, index) => {
              const Icon = WD_ICONS[service.icon ?? index]?.Comp || WD_ICONS[0].Comp;
              const isActive = activeCategory === service.slug;
              return (
                <button
                  key={service.slug}
                  type="button"
                  className={"service-card" + (isActive ? " active" : "")}
                  onClick={() => selectCategory(service)}
                  aria-pressed={isActive}
                  aria-controls="webdev-project-showcase"
                >
                  <div>
                    <div className="svc-num">{service.num}</div>
                    <div className="svc-icon">
                      {service.icon_url
                        ? <img className="svc-icon-img" src={service.icon_url} alt="" />
                        : <Icon size={36} sw={1.5} />
                      }
                    </div>
                    <div className="svc-title">{service.title}</div>
                    <div style={{ fontSize: 13, lineHeight: 1.45, opacity: 0.6, marginTop: 12, fontFamily: "var(--font-body)" }}>{service.short_description}</div>
                  </div>
                  <div className="svc-arrow"><WdArrowOut size={20} sw={1.8} /></div>
                </button>
              );
            })}
          </div>

          {activeCategory && (
            <div ref={showcaseRef} id="webdev-project-showcase" className="project-showcase" aria-live="polite">
              <div className="project-showcase-top">
                <button type="button" className="project-back-btn" onClick={clearCategory}>
                  <WdArrowLeft size={14} sw={2} /> All services
                </button>
                <div className="project-crumb">Services / {selectedCategory?.name}</div>
              </div>
              <div className="project-showcase-head">
                <div>
                  <div className="project-category-kicker">
                    {filteredProjects.filter(project => project.is_featured).length > 0 ? "Featured builds first" : "Category builds"}
                  </div>
                  <h3>{selectedCategory?.name}</h3>
                  <p>{selectedCategory?.short_description}</p>
                </div>
                <div className="project-count-pill">
                  {filteredProjects.length} {filteredProjects.length === 1 ? "project" : "projects"}
                </div>
              </div>

              {filtering ? (
                <div className="category-project-grid">
                  {[0, 1, 2].map((item) => <div key={item} className="category-project-card project-skeleton" />)}
                </div>
              ) : filteredProjects.length === 0 ? (
                <div className="project-empty-state">
                  <h4>No builds added yet for this category.</h4>
                  <p>Add one from the admin panel and it will appear here automatically.</p>
                </div>
              ) : (
                <>
                  <div className="category-project-grid">
                    {visibleProjects.map((project, index) => {
                      const projectCategory = categoryMap[project.category_id] || selectedCategory;
                      const projectDate = wdFormatDate(project.project_date);
                      return (
                        <article key={project.id} className="category-project-card" style={{ "--reveal-delay": `${index * 60}ms` }}>
                          <button
                            type="button"
                            className="category-project-image"
                            onClick={() => setPreviewProject(project)}
                            aria-label={`Preview ${project.title}`}
                          >
                            <WebDevProjectThumb project={project} category={projectCategory} />
                            <span className="category-project-overlay">
                              <span>View Build</span>
                              <WdArrowOut size={14} sw={2} />
                            </span>
                            {project.is_featured && <span className="project-featured-badge">Featured</span>}
                          </button>
                          <div className="category-project-body">
                            <div className="category-project-meta">
                              <span className="category-project-badge">{projectCategory?.name || "Build"}</span>
                              {projectDate && <span>{projectDate}</span>}
                            </div>
                            <h4>{project.title}</h4>
                            <p>{project.short_description}</p>
                            {project.stack && <div className="project-stack-line">{project.stack}</div>}
                            {project.tags?.length > 0 && (
                              <div className="project-tag-row compact">
                                {project.tags.slice(0, 4).map((tag) => <span key={tag}>{tag}</span>)}
                              </div>
                            )}
                            <div className="category-project-foot">
                              {project.client_name && <span>{project.client_name}</span>}
                              <button type="button" className="project-card-action" onClick={() => setPreviewProject(project)}>
                                View details <WdArrowOut size={12} sw={2} />
                              </button>
                            </div>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                  {filteredProjects.length > visibleCount && (
                    <button type="button" className="project-load-more" onClick={() => setVisibleCount(count => count + 6)}>
                      Load more <WdArrowRight size={15} sw={2} />
                    </button>
                  )}
                </>
              )}
            </div>
          )}
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
              const coverImage = work.cover_image_url || work.image;
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
                    <div className={"work-thumb-inner" + (coverImage ? " has-upload" : "")}>
                      {coverImage
                        ? <img src={coverImage} alt={work.cover_alt || work.title} loading="lazy" />
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

        <div className="about-section" id="about-webdev">
          <div>
            <div className="about-kicker">{studio.aboutEyebrow || "About us"}</div>
            <h2>{studio.aboutTitle || "A software studio for fast, usable products that keep working after launch."}</h2>
          </div>
          <div className="about-copy">
            <p>{studio.aboutLead || "RAISA Studio builds marketing sites, web apps and storefronts with the same care we bring to visual systems."}</p>
            <p>{studio.aboutBody || "We focus on readable interfaces, production-ready code and practical handoff, so your site can be updated, measured and improved without starting over every time the business moves."}</p>
            <div className="about-pillars">
              {aboutPillars.map((item) => <span key={item}>{item}</span>)}
            </div>
          </div>
        </div>
      </div>
      {previewProject && (
        <WebDevProjectModal
          project={previewProject}
          category={categoryMap[previewProject.category_id] || selectedCategory}
          onClose={() => setPreviewProject(null)}
        />
      )}
    </div>
  );
}

window.PortfolioWebdev = WebDevPage;
