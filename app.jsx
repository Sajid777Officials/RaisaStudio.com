// Main App — clean-path router with backwards-compatible hash routes

// ── Loading screen (first visit per session) ──────────────────────────────────
function LoadingScreen({ onDone, site }) {
  const overlayRef = useRef(null);
  const logoRef    = useRef(null);

  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      onDone();
      return;
    }
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
        <div className="loading-mark">{site?.logoMark || "V"}</div>
        <div className="loading-brand">{site?.brandName || "RAISA Studio"}</div>
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
      <div
        role={show ? "main" : undefined}
        aria-hidden={show ? undefined : "true"}
        inert={show ? undefined : ""}
        style={{ position: "absolute", inset: 0, pointerEvents: show ? "auto" : "none" }}
      >
        {children}
      </div>
    );
  }
  const { motion } = FM;
  return (
    <motion.div
      role={show ? "main" : undefined}
      aria-hidden={show ? undefined : "true"}
      inert={show ? undefined : ""}
      initial={false}
      animate={{ opacity: show ? 1 : 0, x: show ? 0 : enterX }}
      transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
      style={{ position: "absolute", inset: 0, pointerEvents: show ? "auto" : "none" }}
    >
      {children}
    </motion.div>
  );
}
// Routes (legacy # equivalents remain supported):
//   /           → hero (split view)
//   /graphic    → Graphic Design studio
//   /webdev     → Software Development studio
//   /graphic/g1 → Graphic studio + case study g1 open
//   /webdev/w1  → Software Dev studio + case study w1 open
//   /admin      → Admin panel (Supabase session + database role protected)

const { useState, useEffect, useRef, useCallback } = React;
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
  const galleryTrigger = target?.closest?.("[data-gallery-trigger]");
  const img = target?.closest?.("img") || galleryTrigger?.querySelector?.("img");
  if (!img) return null;
  if (img.closest(".global-image-viewer, .admin-overlay, .admin-shell, .twk-panel, .loading-screen, .nav")) return null;
  if (img.closest(".svc-icon") || img.classList.contains("svc-icon-img")) return null;
  // These images live inside navigation controls. Let the card/button open its
  // project first; the gallery is available from inside the project view.
  if (img.closest(".category-project-image, .work-card, .case-related-card")) return null;

  const rect = img.getBoundingClientRect();
  if (rect.width < 72 && rect.height < 72) return null;

  const src = img.currentSrc || img.src || img.getAttribute("src");
  if (!src || src.startsWith("data:image/svg+xml")) return null;

  const alt = img.getAttribute("alt") || img.closest("[aria-label]")?.getAttribute("aria-label") || "Project image";
  const caption = img.dataset.galleryCaption || img.closest("figure")?.querySelector("figcaption")?.textContent?.trim() || alt;
  return { element: img, src, alt, caption };
}

function getFullscreenGallery(clickedImage) {
  const fallback = {
    src: clickedImage.src,
    alt: clickedImage.alt,
    caption: clickedImage.caption,
  };
  const galleryId = clickedImage.element?.dataset?.imageGallery;
  if (!galleryId) return { images: [fallback], index: 0 };

  const seen = new Set();
  const grouped = Array.from(document.querySelectorAll("img[data-image-gallery]"))
    .filter((img) => img.dataset.imageGallery === galleryId)
    .map((img) => getFullscreenImage(img))
    .filter(Boolean)
    .filter((item) => {
      const key = `${item.src}::${item.alt}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  if (!grouped.length) return { images: [fallback], index: 0 };
  const clickedIndex = grouped.findIndex((item) => item.element === clickedImage.element);
  return {
    images: grouped.map(({ src, alt, caption }) => ({ src, alt, caption })),
    index: clickedIndex >= 0 ? clickedIndex : 0,
  };
}

function GlobalImageViewer() {
  const [gallery, setGallery] = useState(null);
  const [viewport, setViewport] = useState({ scale: 1, x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const viewportRef = useRef({ scale: 1, x: 0, y: 0 });
  const dialogRef = useRef(null);
  const returnFocusRef = useRef(null);
  const stageRef = useRef(null);
  const imageRef = useRef(null);
  const pointersRef = useRef(new Map());
  const gestureRef = useRef(null);
  const ignoreClickRef = useRef(false);
  const thumbnailRefs = useRef([]);
  const CloseIcon = window.PortfolioIcons?.Close;
  const ArrowLeftIcon = window.PortfolioIcons?.ArrowLeft;
  const ArrowRightIcon = window.PortfolioIcons?.ArrowRight;
  const image = gallery?.images?.[gallery.index] || null;
  const imageCount = gallery?.images?.length || 0;
  const isZoomed = viewport.scale > 1.01;

  const commitViewport = (next) => {
    viewportRef.current = next;
    setViewport(next);
  };

  const clampViewport = (next) => {
    if (next.scale <= 1.01) return { scale: 1, x: 0, y: 0 };
    const stage = stageRef.current;
    const imageElement = imageRef.current;
    if (!stage || !imageElement) return next;
    const maxX = Math.max(0, (imageElement.offsetWidth * next.scale - stage.clientWidth) / 2);
    const maxY = Math.max(0, (imageElement.offsetHeight * next.scale - stage.clientHeight) / 2);
    return {
      scale: next.scale,
      x: Math.max(-maxX, Math.min(maxX, next.x)),
      y: Math.max(-maxY, Math.min(maxY, next.y)),
    };
  };

  const resetZoom = () => {
    pointersRef.current.clear();
    gestureRef.current = null;
    setIsDragging(false);
    commitViewport({ scale: 1, x: 0, y: 0 });
  };

  const zoomAt = (requestedScale, clientX, clientY) => {
    const current = viewportRef.current;
    const nextScale = Math.max(1, Math.min(4, requestedScale));
    if (nextScale <= 1.01) {
      resetZoom();
      return;
    }

    const rect = stageRef.current?.getBoundingClientRect();
    const pointX = rect && Number.isFinite(clientX) ? clientX - (rect.left + rect.width / 2) : 0;
    const pointY = rect && Number.isFinite(clientY) ? clientY - (rect.top + rect.height / 2) : 0;
    const ratio = nextScale / current.scale;
    commitViewport(clampViewport({
      scale: nextScale,
      x: pointX - (pointX - current.x) * ratio,
      y: pointY - (pointY - current.y) * ratio,
    }));
  };

  const closeGallery = () => {
    const returnTarget = returnFocusRef.current;
    resetZoom();
    setGallery(null);
    requestAnimationFrame(() => returnTarget?.focus?.());
  };
  const moveGallery = (step) => {
    setGallery((current) => {
      if (!current || current.images.length < 2) return current;
      return {
        ...current,
        index: (current.index + step + current.images.length) % current.images.length,
      };
    });
  };

  const stagePoint = (event) => ({ x: event.clientX, y: event.clientY });
  const pointDistance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const pointMidpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

  const beginStagePointer = (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    pointersRef.current.set(event.pointerId, stagePoint(event));
    const points = Array.from(pointersRef.current.values());

    if (points.length === 1) {
      gestureRef.current = {
        type: "single",
        startPoint: points[0],
        startViewport: { ...viewportRef.current },
      };
      setIsDragging(viewportRef.current.scale > 1.01);
      return;
    }

    if (points.length === 2) {
      gestureRef.current = {
        type: "pinch",
        startDistance: Math.max(1, pointDistance(points[0], points[1])),
        startMidpoint: pointMidpoint(points[0], points[1]),
        startViewport: { ...viewportRef.current },
      };
      ignoreClickRef.current = true;
      setIsDragging(true);
    }
  };

  const moveStagePointer = (event) => {
    if (!pointersRef.current.has(event.pointerId)) return;
    event.preventDefault();
    event.stopPropagation();
    pointersRef.current.set(event.pointerId, stagePoint(event));
    const points = Array.from(pointersRef.current.values());
    const gesture = gestureRef.current;

    if (points.length >= 2 && gesture?.type === "pinch") {
      const distance = Math.max(1, pointDistance(points[0], points[1]));
      const midpoint = pointMidpoint(points[0], points[1]);
      const nextScale = Math.max(1, Math.min(4, gesture.startViewport.scale * (distance / gesture.startDistance)));
      const rect = stageRef.current?.getBoundingClientRect();
      const centerX = rect ? rect.left + rect.width / 2 : 0;
      const centerY = rect ? rect.top + rect.height / 2 : 0;
      const startPointX = gesture.startMidpoint.x - centerX;
      const startPointY = gesture.startMidpoint.y - centerY;
      const currentPointX = midpoint.x - centerX;
      const currentPointY = midpoint.y - centerY;
      const anchorX = (startPointX - gesture.startViewport.x) / gesture.startViewport.scale;
      const anchorY = (startPointY - gesture.startViewport.y) / gesture.startViewport.scale;
      commitViewport(clampViewport({
        scale: nextScale,
        x: currentPointX - anchorX * nextScale,
        y: currentPointY - anchorY * nextScale,
      }));
      ignoreClickRef.current = true;
      return;
    }

    if (points.length === 1 && gesture?.type === "single") {
      const dx = points[0].x - gesture.startPoint.x;
      const dy = points[0].y - gesture.startPoint.y;
      if (Math.hypot(dx, dy) > 4) ignoreClickRef.current = true;
      if (gesture.startViewport.scale > 1.01) {
        commitViewport(clampViewport({
          ...gesture.startViewport,
          x: gesture.startViewport.x + dx,
          y: gesture.startViewport.y + dy,
        }));
      }
    }
  };

  const endStagePointer = (event, cancelled = false) => {
    if (!pointersRef.current.has(event.pointerId)) return;
    event.stopPropagation();
    const point = pointersRef.current.get(event.pointerId);
    const gesture = gestureRef.current;
    const pointerCount = pointersRef.current.size;

    if (!cancelled && pointerCount === 1 && gesture?.type === "single") {
      const dx = point.x - gesture.startPoint.x;
      const dy = point.y - gesture.startPoint.y;
      if (viewportRef.current.scale <= 1.01 && imageCount > 1 && Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy)) {
        ignoreClickRef.current = true;
        moveGallery(dx > 0 ? -1 : 1);
      }
    }

    pointersRef.current.delete(event.pointerId);
    if (pointersRef.current.size === 1 && gesture?.type === "pinch") {
      const remainingPoint = Array.from(pointersRef.current.values())[0];
      gestureRef.current = {
        type: "single",
        startPoint: remainingPoint,
        startViewport: { ...viewportRef.current },
      };
    } else if (pointersRef.current.size === 0) {
      gestureRef.current = null;
      setIsDragging(false);
    }

    if (ignoreClickRef.current) {
      setTimeout(() => { ignoreClickRef.current = false; }, 0);
    }
  };

  const toggleTapZoom = (event) => {
    event.stopPropagation();
    if (ignoreClickRef.current) {
      ignoreClickRef.current = false;
      return;
    }
    if (viewportRef.current.scale > 1.01) resetZoom();
    else zoomAt(2.5, event.clientX, event.clientY);
  };

  const changeZoomFromCenter = (step) => {
    const rect = stageRef.current?.getBoundingClientRect();
    zoomAt(
      viewportRef.current.scale + step,
      rect ? rect.left + rect.width / 2 : undefined,
      rect ? rect.top + rect.height / 2 : undefined
    );
  };

  useEffect(() => {
    const openFromClick = (event) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const imageData = getFullscreenImage(event.target);
      if (!imageData) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
      returnFocusRef.current =
        imageData.element.closest?.("button, a, [tabindex]") ||
        document.activeElement;
      setGallery(getFullscreenGallery(imageData));
    };

    document.addEventListener("click", openFromClick, true);
    return () => document.removeEventListener("click", openFromClick, true);
  }, []);

  useEffect(() => {
    if (!gallery) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    requestAnimationFrame(() => {
      dialogRef.current?.querySelector?.(".global-image-viewer-close")?.focus?.();
    });

    const onKey = (event) => {
      if (event.key === "Tab") {
        const focusable = Array.from(
          dialogRef.current?.querySelectorAll?.(
            'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
          ) || []
        );
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
        return;
      }
      if (!["Escape", "ArrowLeft", "ArrowRight", "Home", "End", "+", "=", "-", "0"].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
      if (event.key === "Escape") closeGallery();
      if (event.key === "ArrowLeft") moveGallery(-1);
      if (event.key === "ArrowRight") moveGallery(1);
      if (event.key === "Home") setGallery((current) => current ? { ...current, index: 0 } : current);
      if (event.key === "End") setGallery((current) => current ? { ...current, index: current.images.length - 1 } : current);
      if (event.key === "+" || event.key === "=") changeZoomFromCenter(0.5);
      if (event.key === "-") changeZoomFromCenter(-0.5);
      if (event.key === "0") resetZoom();
    };

    window.addEventListener("keydown", onKey, true);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKey, true);
    };
  }, [Boolean(gallery)]);

  useEffect(() => {
    if (!gallery || imageCount < 2) return;
    thumbnailRefs.current[gallery.index]?.scrollIntoView?.({ behavior: "smooth", block: "nearest", inline: "center" });
  }, [gallery?.index, imageCount]);

  useEffect(() => {
    resetZoom();
  }, [gallery?.index, image?.src]);

  if (!image) return null;

  return (
    <div
      ref={dialogRef}
      className="global-image-viewer"
      role="dialog"
      aria-modal="true"
      aria-label="Project image gallery"
      onClick={closeGallery}
    >
      <button type="button" className="global-image-viewer-close" onClick={closeGallery} aria-label="Close image gallery">
        {CloseIcon ? <CloseIcon size={18} sw={2.2} /> : "x"}
      </button>
      <div className="global-image-viewer-zoom-controls" onClick={(event) => event.stopPropagation()} aria-label="Image zoom controls">
        <button type="button" onClick={() => changeZoomFromCenter(-0.5)} disabled={!isZoomed} aria-label="Zoom out">−</button>
        <output aria-live="polite">{Math.round(viewport.scale * 100)}%</output>
        <button type="button" onClick={() => changeZoomFromCenter(0.5)} disabled={viewport.scale >= 4} aria-label="Zoom in">+</button>
        <button type="button" className="fit" onClick={resetZoom} disabled={!isZoomed}>Fit</button>
      </div>
      {imageCount > 1 && (
        <button type="button" className="global-image-viewer-nav prev" onClick={(event) => { event.stopPropagation(); moveGallery(-1); }} aria-label="Previous image">
          {ArrowLeftIcon ? <ArrowLeftIcon size={22} sw={2} /> : "Prev"}
        </button>
      )}
      <div className="global-image-viewer-shell" onClick={(event) => event.stopPropagation()}>
        <figure className="global-image-viewer-figure">
          <div
            ref={stageRef}
            className={`global-image-viewer-stage${isZoomed ? " is-zoomed" : ""}${isDragging ? " is-dragging" : ""}`}
            role="button"
            tabIndex="0"
            aria-label={isZoomed ? "Zoomed image. Drag to pan or tap to fit." : "Full image. Tap to zoom."}
            onClick={toggleTapZoom}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              if (viewportRef.current.scale > 1.01) resetZoom();
              else changeZoomFromCenter(1.5);
            }}
            onWheel={(event) => {
              event.preventDefault();
              event.stopPropagation();
              zoomAt(viewportRef.current.scale * Math.exp(-event.deltaY * 0.0015), event.clientX, event.clientY);
            }}
            onPointerDown={beginStagePointer}
            onPointerMove={moveStagePointer}
            onPointerUp={(event) => endStagePointer(event)}
            onPointerCancel={(event) => endStagePointer(event, true)}
          >
            <img
              ref={imageRef}
              key={image.src}
              src={image.src}
              alt={image.alt}
              draggable="false"
              style={{ transform: `translate3d(${viewport.x}px, ${viewport.y}px, 0) scale(${viewport.scale})` }}
            />
            <span className="global-image-viewer-zoom-hint">
              {isZoomed ? "Drag to explore · tap to fit" : "Tap image to zoom · pinch or scroll"}
            </span>
          </div>
          <figcaption>
            <span>{String(gallery.index + 1).padStart(2, "0")} / {String(imageCount).padStart(2, "0")}</span>
            <strong>{image.caption || image.alt}</strong>
          </figcaption>
        </figure>
        {imageCount > 1 && (
          <div className="global-image-viewer-thumbnails" role="tablist" aria-label="Choose project image">
            {gallery.images.map((item, index) => (
              <button
                type="button"
                role="tab"
                key={`${item.src}-${index}`}
                ref={(node) => { thumbnailRefs.current[index] = node; }}
                className={index === gallery.index ? "active" : ""}
                aria-selected={index === gallery.index}
                aria-label={`View image ${index + 1}: ${item.alt}`}
                onClick={() => setGallery((current) => current ? { ...current, index } : current)}
              >
                <img src={item.src} alt="" />
                <span>{String(index + 1).padStart(2, "0")}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {imageCount > 1 && (
        <button type="button" className="global-image-viewer-nav next" onClick={(event) => { event.stopPropagation(); moveGallery(1); }} aria-label="Next image">
          {ArrowRightIcon ? <ArrowRightIcon size={22} sw={2} /> : "Next"}
        </button>
      )}
    </div>
  );
}

// ─── Router helpers ───────────────────────────────────────────────────────────
function parseHash() {
  // Keep old hash links working while using crawlable history paths for new
  // navigation. Static hosts already rewrite unknown paths to index.html.
  const legacyHash = window.location.hash.replace(/^#\/?/, "").trim();
  const cleanPath = window.location.pathname
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .map((segment) => {
      try { return decodeURIComponent(segment); } catch (_) { return segment; }
    })
    .join("/");
  const routeValue = legacyHash || cleanPath;
  if (!routeValue || routeValue === "index.html") {
    return { view: null, caseId: null, section: null, admin: false };
  }
  if (routeValue === "admin") {
    return { view: null, caseId: null, section: null, admin: true };
  }
  if (routeValue === "about") {
    return { view: "graphic", caseId: null, section: "about", admin: false };
  }
  const [view, detail = null] = routeValue.split("/");
  if (view === "graphic" || view === "webdev") {
    const section = detail === "about" ? "about" : null;
    return { view, caseId: section ? null : detail, section, admin: false };
  }
  return { view: null, caseId: null, section: null, admin: false };
}

function go(path) {
  // pushState keeps history so back-button works between views
  const normalizedPath = String(path || "")
    .replace(/^#?\/?/, "")
    .replace(/\/+$/, "");
  const nextUrl = normalizedPath
    ? `/${normalizedPath}${window.location.search}`
    : `/${window.location.search}`;
  history.pushState(null, "", nextUrl);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

// ─── App ──────────────────────────────────────────────────────────────────────
function App() {
  const [route, setRoute]   = useState(parseHash);
  const [hovered, setHovered] = useState(null);
  const [content, setContent] = useState(() => window.PortfolioContent.load());
  const [previewMode, setPreviewMode] = useState(false);
  const [adminPreviewRoute, setAdminPreviewRoute] = useState(null);
  const [tweaks, setTweak]  = useTweaks(TWEAK_DEFAULTS);
  const [ready, setReady]   = useState(() => Boolean(sessionStorage.getItem("p-ready")));
  const contentRequestRef = useRef(0);

  const Cursor = window.PortfolioCursor;

  const adminEnabled  = CFG.adminEnabled  !== false;
  const tweaksEnabled = CFG.tweaksEnabled !== false;

  const adminOpen = route.admin;
  const effectiveRoute = previewMode && adminPreviewRoute
    ? adminPreviewRoute
    : route;
  const expanded = effectiveRoute.view;
  const caseId = effectiveRoute.caseId;
  const activeSection = effectiveRoute.section;
  const publicUnavailable = content.publicEnabled === false && !previewMode;

  // Hydrate content from Supabase on mount; first render uses localStorage/defaults
  useEffect(() => {
    const requestId = contentRequestRef.current + 1;
    contentRequestRef.current = requestId;
    window.PortfolioContent.loadAsync()
      .then((nextContent) => {
        if (requestId === contentRequestRef.current) setContent(nextContent);
      })
      .catch(() => {});
  }, []);

  // Refresh visitors after a protected publish event without exposing drafts.
  useEffect(
    () => window.PortfolioContent.subscribe((nextContent) => {
      if (!previewMode) setContent(nextContent);
    }),
    [previewMode]
  );

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

  // Update route-aware metadata from managed SEO fields. Hash routing limits
  // server-rendered crawler previews, but each editable view still gets a
  // complete browser metadata contract and draft previews are always noindex.
  useEffect(() => {
    const globalSeo = content.site?.seo || {};
    const base = globalSeo.title || content.site?.metaTitle || "RAISA Studio";
    const routeKey = adminOpen
      ? "admin"
      : activeSection === "about"
        ? "about"
        : expanded === "graphic"
          ? "graphic"
          : expanded === "webdev"
            ? "webdev"
            : "home";
    const pageSeo = globalSeo.pages?.[routeKey] || {};
    const activeWork = caseId
      ? (content.works?.[expanded || "graphic"] || []).find(
          (work) =>
            (work.id === caseId || work.slug === caseId) &&
            (previewMode || work.is_published !== false)
        )
      : null;
    const exactCase = caseId ? content.cases?.[caseId] : null;
    const linkedCase = caseId
      ? Object.values(content.cases || {}).find((caseData) => (
          caseData?.project_id === (activeWork?.id || caseId) ||
          (activeWork?.slug && caseData?.project_id === activeWork.slug)
        ))
      : null;
    const activeCaseCandidate = linkedCase || exactCase;
    const caseRouteAvailable = Boolean(
      caseId &&
      activeWork &&
      activeCaseCandidate &&
      (previewMode || activeCaseCandidate.is_published !== false)
    );
    const activeCase = caseRouteAvailable
      ? activeCaseCandidate
      : null;
    const caseSeo = activeCase?.seo || activeWork?.seo || {};
    const caseTitle = caseRouteAvailable ? (activeCase?.title || activeWork?.title || "") : "";
    const routeSuffix = routeKey === "graphic" ? " - Graphic Design"
      : routeKey === "webdev" ? " - Software Development"
      : routeKey === "about" ? " - About Us"
      : routeKey === "admin" ? " - Admin"
      : "";
    const title = publicUnavailable
      ? `${base} - Temporarily unavailable`
      : caseTitle
        ? caseSeo.title || `${base} - ${caseTitle} Case Study`
        : pageSeo.title || `${base}${routeSuffix}`;
    const description = String(
      caseSeo.description ||
      activeWork?.short_description ||
      activeCase?.short_description ||
      pageSeo.description ||
      globalSeo.description ||
      content.site?.metaDescription ||
      ""
    );
    const canonicalBase = String(globalSeo.canonicalUrl || CFG.siteUrl || "")
      .trim()
      .replace(/\/+$/, "");
    const routePath = caseTitle
      ? `/${expanded || activeCase?.side || "graphic"}/${activeWork?.slug || activeWork?.id || caseId}`
      : routeKey === "home" || routeKey === "admin"
        ? ""
        : `/${routeKey}`;
    const canonicalUrl = String(
      caseSeo.canonicalUrl ||
      pageSeo.canonicalUrl ||
      (canonicalBase ? `${canonicalBase}${routePath}` : "")
    ).trim();
    const sharingImage = String(
      caseSeo.ogImage ||
      activeWork?.cover_image_url ||
      pageSeo.ogImage ||
      globalSeo.ogImage ||
      ""
    ).trim();
    const keywordValue = caseSeo.keywords || pageSeo.keywords || globalSeo.keywords || "";
    const keywords = Array.isArray(keywordValue)
      ? keywordValue.map((item) => String(item).trim()).filter(Boolean).join(", ")
      : String(keywordValue).trim();
    const forceNoIndex = Boolean(
      publicUnavailable ||
      adminOpen ||
      previewMode ||
      CFG.noIndex === true ||
      globalSeo.noIndex === true ||
      pageSeo.noIndex === true ||
      caseSeo.noIndex === true
    );
    document.title = title;

    const setMeta = (selector, attribute, attributeValue, value) => {
      let node = document.head.querySelector(selector);
      if (!node && value) {
        node = document.createElement("meta");
        node.setAttribute(attribute, attributeValue);
        document.head.appendChild(node);
      }
      if (node && value) node.setAttribute("content", value);
      if (node && !value) node.removeAttribute("content");
    };

    setMeta('meta[name="description"]', "name", "description", description);
    setMeta('meta[name="keywords"]', "name", "keywords", keywords);
    setMeta('meta[property="og:title"]', "property", "og:title", title);
    setMeta('meta[property="og:description"]', "property", "og:description", description);
    setMeta('meta[property="og:image"]', "property", "og:image", sharingImage);
    setMeta('meta[property="og:url"]', "property", "og:url", canonicalUrl);
    setMeta('meta[property="og:type"]', "property", "og:type", caseTitle ? "article" : "website");
    setMeta('meta[name="twitter:title"]', "name", "twitter:title", title);
    setMeta('meta[name="twitter:description"]', "name", "twitter:description", description);
    setMeta('meta[name="twitter:image"]', "name", "twitter:image", sharingImage);

    let canonical = document.head.querySelector('link[rel="canonical"]');
    if (!canonical && canonicalUrl) {
      canonical = document.createElement("link");
      canonical.rel = "canonical";
      document.head.appendChild(canonical);
    }
    if (canonicalUrl) canonical?.setAttribute("href", canonicalUrl);
    else canonical?.remove();

    let robots = document.querySelector('meta[name="robots"]');
    if (!robots) {
      const nextRobots = document.createElement("meta");
      nextRobots.name = "robots";
      document.head.appendChild(nextRobots);
      robots = nextRobots;
    }
    robots.setAttribute("content", forceNoIndex ? "noindex, nofollow" : "index, follow");

    let structuredData = document.head.querySelector("#portfolio-structured-data");
    if (!structuredData) {
      structuredData = document.createElement("script");
      structuredData.id = "portfolio-structured-data";
      structuredData.type = "application/ld+json";
      document.head.appendChild(structuredData);
    }
    const organization = {
      "@type": "Organization",
      name: content.site?.brandName || "RAISA Studio",
      ...(canonicalBase ? { url: canonicalBase } : {}),
      ...(content.site?.contact?.email ? { email: content.site.contact.email } : {}),
      ...(content.site?.contact?.phone ? { telephone: content.site.contact.phone } : {}),
      ...(content.site?.contact?.location
        ? { areaServed: content.site.contact.location }
        : {}),
      sameAs: (content.site?.socialLinks || [])
        .filter((item) => item.is_visible !== false && /^https?:\/\//i.test(String(item.url || "")))
        .map((item) => item.url),
    };
    const structuredPayload = caseTitle
      ? {
          "@context": "https://schema.org",
          "@type": "CreativeWork",
          name: caseTitle,
          description,
          ...(canonicalUrl ? { url: canonicalUrl } : {}),
          ...(sharingImage ? { image: sharingImage } : {}),
          creator: organization,
        }
      : {
          "@context": "https://schema.org",
          ...organization,
          description,
        };
    structuredData.textContent = JSON.stringify(structuredPayload).replace(/</g, "\\u003c");
  }, [expanded, activeSection, adminOpen, caseId, content, previewMode, publicUnavailable]);

  // ── Navigation helpers ──────────────────────────────────────────────────────
  const previewNavigate = (view = null, nextCaseId = null, section = null) => {
    if (!previewMode) return false;
    setAdminPreviewRoute({ view, caseId: nextCaseId, section, admin: false });
    return true;
  };
  const goHome        = () => previewNavigate() || go("");
  const goGraphic     = () => previewNavigate("graphic") || go("graphic");
  const goWebdev      = () => previewNavigate("webdev") || go("webdev");
  const goAbout       = () => (
    previewNavigate(expanded === "webdev" ? "webdev" : "graphic", null, "about") ||
    go(expanded === "webdev" ? "webdev/about" : expanded === "graphic" ? "graphic/about" : "about")
  );
  const openCase      = (work) => {
    const side = work.side || expanded || "graphic";
    const routeId = work.slug || work.id;
    if (!previewNavigate(side, routeId, null)) go(`${side}/${routeId}`);
  };
  const closeCase     = () => previewNavigate(expanded || null) || go(expanded || "");
  const openAdmin     = () => go("admin");
  const closeAdmin    = () => {
    history.replaceState(null, "", `/${window.location.search}`);
    window.dispatchEvent(new PopStateEvent("popstate"));
  };
  const restorePublishedContent = useCallback(async () => {
    const requestId = contentRequestRef.current + 1;
    contentRequestRef.current = requestId;
    setPreviewMode(false);
    setAdminPreviewRoute(null);
    try {
      const published = await window.PortfolioContent.loadAsync();
      if (requestId === contentRequestRef.current) setContent(published);
    } catch (_) {
      if (requestId === contentRequestRef.current) {
        setContent(window.PortfolioContent.load());
      }
    }
  }, []);
  useEffect(() => {
    if (!previewMode || adminOpen) return undefined;
    let active = true;
    let checking = false;
    const verifyPreviewAccess = async () => {
      if (!active || checking) return;
      checking = true;
      try {
        const sb = window.PortfolioSupabase;
        if (!sb?.auth) throw new Error("Admin authentication is unavailable.");
        const { data, error } = await sb.auth.getUser();
        if (error || !data?.user) throw error || new Error("The admin session has expired.");
        const profile = await window.PortfolioContent.getAdminProfile();
        if (!profile?.isActive || profile.userId !== data.user.id) {
          throw new Error("Draft preview access is no longer active.");
        }
      } catch (_) {
        if (active) await restorePublishedContent();
      } finally {
        checking = false;
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") verifyPreviewAccess();
    };
    verifyPreviewAccess();
    window.addEventListener("focus", verifyPreviewAccess);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      active = false;
      window.removeEventListener("focus", verifyPreviewAccess);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [previewMode, adminOpen, restorePublishedContent]);
  const previewDraft = (nextDraft, options = {}) => {
    contentRequestRef.current += 1;
    setContent(nextDraft);
    setPreviewMode(true);
    setAdminPreviewRoute({
      view: options.view === "graphic" || options.view === "webdev"
        ? options.view
        : null,
      caseId: options.caseId || null,
      section: options.section || null,
      admin: false,
    });
    if (!options.keepOpen) closeAdmin();
  };
  const endPreview = restorePublishedContent;
  const contact       = () => {
    const email = content.site?.contact?.email || content.site?.contactEmail || "hello@raisastudio.com";
    const sub   = encodeURIComponent(`Project inquiry — ${content.site?.brandName || "RAISA Studio"}`);
    window.location.href = `mailto:${email}?subject=${sub}`;
  };

  const onSplit = !expanded;
  const onDark  = expanded === "webdev";

  const handleReady = () => { sessionStorage.setItem("p-ready", "1"); setReady(true); };

  return (
    <div className="app-shell">
      {!ready && <LoadingScreen onDone={handleReady} site={content.site} />}
      {Cursor && <Cursor />}
      <div className="stage-wrap">
        {publicUnavailable && (
          <main className="portfolio-unpublished" role="status" aria-live="polite">
            <span>{content.site?.brandName || "RAISA Studio"}</span>
            <h1>This portfolio is temporarily unavailable.</h1>
            <p>Please check back soon.</p>
          </main>
        )}
        <div
          className="stage"
          aria-hidden={publicUnavailable ? "true" : undefined}
          style={{
            transform: `translate(-50%, -50%) scale(${scale})`,
            visibility: publicUnavailable ? "hidden" : undefined,
            pointerEvents: publicUnavailable ? "none" : undefined,
          }}
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
            onAdmin={adminEnabled && CFG.showAdminLink ? openAdmin : null}
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
            allowUnpublished={previewMode}
            onClose={closeCase}
            onNavigate={openCase}
          />
        </div>

        {tweaksEnabled && !publicUnavailable && (
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
          onSave={(nextContent) => {
            contentRequestRef.current += 1;
            setPreviewMode(false);
            setAdminPreviewRoute(null);
            setContent(nextContent);
          }}
          onPreview={previewDraft}
          onAccessRevoked={restorePublishedContent}
          onClose={closeAdmin}
        />
      )}
      {previewMode && !adminOpen && (
        <div className="portfolio-preview-banner">
          <span>Draft preview · not published</span>
          <button type="button" onClick={endPreview}>Exit preview</button>
        </div>
      )}
      <GlobalImageViewer />
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<App />);
