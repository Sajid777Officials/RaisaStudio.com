// Graphic Design expanded page
const { ArrowRight: GdArrowRight, ArrowOut: GdArrowOut, ArrowLeft: GdArrowLeft, Close: GdClose, graphic: GD_ICONS } = window.PortfolioIcons;
const { thumbs: GdThumbs, GRAPHIC_PALETTES: GD_PAL } = window.PortfolioShared;

const GD_CATEGORY_THUMBS = ["Packaging", "Poster", "Brand", "Brand", "Poster", "Packaging", "Brand", "Brand", "Social", "Poster"];

function gdSlugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function gdCategoryFromService(service, index) {
  const name = service.name || service.title || `Category ${index + 1}`;
  const slug = gdSlugify(service.slug || service.id || name) || `category-${index + 1}`;
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

function gdProjectFromContent(project, index, categoryMap, categories) {
  const fallbackCategory = categories[index % Math.max(categories.length, 1)] || {};
  const title = project.title || `Project ${index + 1}`;
  const categoryId = project.category_id || project.categoryId || project.category_slug || fallbackCategory.slug || "";
  return {
    ...project,
    id: project.id || `project-${gdSlugify(title) || index + 1}`,
    category_id: categoryId,
    title,
    slug: gdSlugify(project.slug || title),
    short_description: project.short_description || project.shortDescription || project.desc || "",
    full_description: project.full_description || project.fullDescription || project.description || "",
    image_url: project.image_url || project.image || "",
    gallery_images: Array.isArray(project.gallery_images) ? project.gallery_images : [],
    tags: Array.isArray(project.tags) ? project.tags : String(project.tags || "").split(",").map(tag => tag.trim()).filter(Boolean),
    client_name: project.client_name || project.clientName || "",
    project_date: project.project_date || project.projectDate || project.year || "",
    is_featured: project.is_featured === true,
    is_published: project.is_published !== false,
    sort_order: Number.isFinite(Number(project.sort_order)) ? Number(project.sort_order) : index + 1,
    thumb: project.thumb || GD_CATEGORY_THUMBS[categoryMap[categoryId]?.icon] || "Brand",
    pal: Number.isFinite(Number(project.pal)) ? Number(project.pal) : index % GD_PAL.length,
  };
}

function gdFormatDate(value) {
  if (!value) return "";
  if (/^\d{4}$/.test(String(value))) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

function GraphicProjectThumb({ project, category }) {
  const image = project.image_url || project.image;
  const thumbName = project.thumb || GD_CATEGORY_THUMBS[category?.icon] || "Brand";
  const Thumb = GdThumbs[thumbName] || GdThumbs.Brand;
  const palette = GD_PAL[project.pal] || GD_PAL[(category?.icon || 0) % GD_PAL.length] || GD_PAL[0];

  return (
    <div className={"category-project-thumb-inner" + (image ? " has-upload" : "")}>
      {image
        ? <img src={image} alt={project.title} />
        : <Thumb palette={palette} title={project.title} num={project.num || String(project.sort_order || 1).padStart(2, "0")} />
      }
    </div>
  );
}

function GraphicProjectModal({ project, category, onClose }) {
  React.useEffect(() => {
    const onKey = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const projectDate = gdFormatDate(project.project_date);
  const categoryName = category?.name || "Project";
  const gallery = project.gallery_images || [];

  return (
    <div className="project-lightbox" role="dialog" aria-modal="true" aria-labelledby="project-lightbox-title" onClick={onClose}>
      <div className="project-lightbox-panel" onClick={(event) => event.stopPropagation()}>
        <button type="button" className="project-lightbox-close" onClick={onClose} aria-label="Close project preview">
          <GdClose size={16} sw={2.2} />
        </button>
        <div className="project-lightbox-media">
          <GraphicProjectThumb project={project} category={category} />
        </div>
        <div className="project-lightbox-body">
          <div className="project-kicker">
            <span>{categoryName}</span>
            {project.is_featured && <span>Featured</span>}
          </div>
          <h3 id="project-lightbox-title">{project.title}</h3>
          {project.short_description && <p className="project-modal-short">{project.short_description}</p>}
          {project.full_description && <p className="project-modal-full">{project.full_description}</p>}
          <div className="project-modal-meta">
            {project.client_name && <div><span>Client</span>{project.client_name}</div>}
            {projectDate && <div><span>Date</span>{projectDate}</div>}
            {project.slug && <div><span>Slug</span>{project.slug}</div>}
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
                const alt = typeof item === "string" ? `${project.title} gallery ${index + 1}` : (item.alt_text || item.alt || `${project.title} gallery ${index + 1}`);
                if (!src) return null;
                return <img key={`${src}-${index}`} src={src} alt={alt} />;
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function GraphicPage({ visible, onBack, onOpenCase, onContact, content, activeSection }) {
  const studio = content?.studios?.graphic || {};
  const services = content?.services?.graphic || [];
  const works = (content?.works?.graphic || []).filter(work => work.is_published !== false);
  const projects = content?.projects?.graphic || [];
  const aboutPillars = Array.isArray(studio.aboutPillars) && studio.aboutPillars.length
    ? studio.aboutPillars
    : ["Brand systems", "Print-ready craft", "Launch support"];
  const pageRef = React.useRef(null);
  const showcaseRef = React.useRef(null);
  const filterTimerRef = React.useRef(null);
  const [activeCategory, setActiveCategory] = React.useState(null);
  const [filtering, setFiltering] = React.useState(false);
  const [visibleCount, setVisibleCount] = React.useState(6);
  const [previewProject, setPreviewProject] = React.useState(null);

  const categories = React.useMemo(() => (
    services
      .map(gdCategoryFromService)
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
      .map((project, index) => gdProjectFromContent(project, index, categoryMap, categories))
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
      pageRef.current?.querySelector("#about")?.scrollIntoView({ behavior: "smooth", block: "start" });
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

  return (
    <div ref={pageRef} className={"page page-graphic" + (visible ? " visible" : "")}>
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
          <div className="service-grid" aria-label="Graphic design service categories">
            {categories.map((service, index) => {
              const Icon = GD_ICONS[service.icon ?? index]?.Comp || GD_ICONS[0].Comp;
              const isActive = activeCategory === service.slug;
              return (
                <button
                  key={service.slug}
                  type="button"
                  className={"service-card" + (isActive ? " active" : "")}
                  onClick={() => selectCategory(service)}
                  aria-pressed={isActive}
                  aria-controls="graphic-project-showcase"
                >
                  <div>
                    <div className="svc-num">{service.num}</div>
                    <div className="svc-icon">
                      {service.icon_url
                        ? <img className="svc-icon-img" src={service.icon_url} alt="" />
                        : <Icon size={36} sw={1.5} />
                      }
                    </div>
                    <div className="svc-title-wrap">
                      <span className="svc-title-tag">{service.name}</span>
                    </div>
                    <div style={{ fontSize: 13, lineHeight: 1.45, opacity: 0.62, marginTop: 12, fontFamily: "var(--font-body)" }}>{service.short_description}</div>
                  </div>
                  <div className="svc-arrow"><GdArrowOut size={20} sw={1.8} /></div>
                </button>
              );
            })}
          </div>

          {activeCategory && (
            <div ref={showcaseRef} id="graphic-project-showcase" className="project-showcase" aria-live="polite">
              <div className="project-showcase-top">
                <button type="button" className="project-back-btn" onClick={clearCategory}>
                  <GdArrowLeft size={14} sw={2} /> All services
                </button>
                <div className="project-crumb">Services / {selectedCategory?.name}</div>
              </div>
              <div className="project-showcase-head">
                <div>
                  <div className="project-category-kicker">
                    {filteredProjects.filter(project => project.is_featured).length > 0 ? "Featured projects first" : "Category projects"}
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
                  <h4>No projects added yet for this category.</h4>
                  <p>Add one from the admin panel and it will appear here automatically.</p>
                </div>
              ) : (
                <>
                  <div className="category-project-grid">
                    {visibleProjects.map((project, index) => {
                      const projectCategory = categoryMap[project.category_id] || selectedCategory;
                      const projectDate = gdFormatDate(project.project_date);
                      return (
                        <article key={project.id} className="category-project-card" style={{ "--reveal-delay": `${index * 60}ms` }}>
                          <button
                            type="button"
                            className="category-project-image"
                            onClick={() => setPreviewProject(project)}
                            aria-label={`Preview ${project.title}`}
                          >
                            <GraphicProjectThumb project={project} category={projectCategory} />
                            <span className="category-project-overlay">
                              <span>View Project</span>
                              <GdArrowOut size={14} sw={2} />
                            </span>
                            {project.is_featured && <span className="project-featured-badge">Featured</span>}
                          </button>
                          <div className="category-project-body">
                            <div className="category-project-meta">
                              <span className="category-project-badge">{projectCategory?.name || "Project"}</span>
                              {projectDate && <span>{projectDate}</span>}
                            </div>
                            <h4>{project.title}</h4>
                            <p>{project.short_description}</p>
                            {project.tags?.length > 0 && (
                              <div className="project-tag-row compact">
                                {project.tags.slice(0, 4).map((tag) => <span key={tag}>{tag}</span>)}
                              </div>
                            )}
                            <div className="category-project-foot">
                              {project.client_name && <span>{project.client_name}</span>}
                              <button type="button" className="project-card-action" onClick={() => setPreviewProject(project)}>
                                View details <GdArrowOut size={12} sw={2} />
                              </button>
                            </div>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                  {filteredProjects.length > visibleCount && (
                    <button type="button" className="project-load-more" onClick={() => setVisibleCount(count => count + 6)}>
                      Load more <GdArrowRight size={15} sw={2} />
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
              <h2>{studio.portfolioTitle || "Selected work"}</h2>
            </div>
            <div className="section-meta" style={{ opacity: 0.55 }}>{studio.portfolioMeta || "Click for case"}</div>
          </div>
          <div className="portfolio-grid">
            {works.map((work) => {
              const Thumb = GdThumbs[work.thumb] || GdThumbs.Brand;
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
                     onClick={() => onOpenCase({ ...work, side: "graphic" })}
                     onMouseMove={tilt}
                     onMouseLeave={untilt}>
                  <div className="work-thumb">
                    <div className={"work-thumb-inner" + (coverImage ? " has-upload" : "")}>
                      {coverImage
                        ? <img src={coverImage} alt={work.cover_alt || work.title} loading="lazy" />
                        : <Thumb palette={GD_PAL[work.pal] || GD_PAL[0]} title={work.title} num={work.num || "01"} />
                      }
                    </div>
                    {work.cat && <span className="work-badge">{work.cat}</span>}
                    <div className="work-overlay">
                      <div className="work-ov-cat">{work.cat}</div>
                      <div className="work-ov-title">{work.title}</div>
                      <div className="work-ov-cta">View case &thinsp;<GdArrowOut size={12} sw={2} /></div>
                    </div>
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

        <div className="about-section" id="about">
          <div>
            <div className="about-kicker">{studio.aboutEyebrow || "About us"}</div>
            <h2>{studio.aboutTitle || "A focused studio for brands that need to look intentional everywhere."}</h2>
          </div>
          <div className="about-copy">
            <p>{studio.aboutLead || "RAISA Studio blends graphic design, production discipline and digital thinking for founders, teams and independent brands."}</p>
            <p>{studio.aboutBody || "We shape identity systems, packaging, print materials and campaign assets with a practical process: clear direction first, polished execution next, and files prepared for the people who have to use them after launch."}</p>
            <div className="about-pillars">
              {aboutPillars.map((item) => <span key={item}>{item}</span>)}
            </div>
          </div>
        </div>
      </div>
      {previewProject && (
        <GraphicProjectModal
          project={previewProject}
          category={categoryMap[previewProject.category_id] || selectedCategory}
          onClose={() => setPreviewProject(null)}
        />
      )}
    </div>
  );
}

window.PortfolioGraphic = GraphicPage;
