// Hero split: Graphic Design (left) / Software Development (right)
const { ArrowOut } = window.PortfolioIcons;
const { useEffect, useRef } = React;

const GRAPHIC_SERVICES = [
  "Packaging", "Flyer Design", "Vector Art", "Vector Tracing", "Poster Design",
  "File Conversion", "Embroidery Digitizing", "Business Cards", "Social Media", "Presentations",
];

const WEBDEV_SERVICES = [
  "Website Design", "Software Development", "Landing Pages", "Portfolio Sites", "Business Websites",
  "E-commerce", "App Development", "UI / UX", "Frontend", "Backend",
];

// ── Per-character spans for GSAP stagger ─────────────────────────────────────
function Letters({ text }) {
  return (
    <>
      {String(text).split("").map((ch, i) => (
        <span key={i} className="char">{ch === " " ? " " : ch}</span>
      ))}
    </>
  );
}

// ── Three.js particle field (generic — used on both panels) ──────────────────
function PanelParticles({ panelRef, r, g, b }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const THREE = window.THREE;
    if (!THREE || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const panel  = panelRef.current;

    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));

    // Radial gradient texture — colour comes from r,g,b props
    const tc = document.createElement("canvas");
    tc.width = tc.height = 64;
    const cx = tc.getContext("2d");
    const grd = cx.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0,    `rgba(${r},${g},${b},0.88)`);
    grd.addColorStop(0.28, `rgba(${r},${g},${b},0.42)`);
    grd.addColorStop(1,    `rgba(${r},${g},${b},0)`);
    cx.fillStyle = grd;
    cx.fillRect(0, 0, 64, 64);
    const texture = new THREE.CanvasTexture(tc);

    const COUNT  = 88;
    const VIEW_H = 8;

    let W = canvas.clientWidth  || 800;
    let H = canvas.clientHeight || 600;
    let aspect = W / H;

    const camera = new THREE.OrthographicCamera(
      -aspect * VIEW_H / 2,  aspect * VIEW_H / 2,
       VIEW_H / 2,           -VIEW_H / 2,
       0.1, 10
    );
    camera.position.z = 5;
    renderer.setSize(W, H, false);

    const scene = new THREE.Scene();

    const positions = new Float32Array(COUNT * 3);
    const homePos   = new Float32Array(COUNT * 3);
    const vels      = new Float32Array(COUNT * 3);

    for (let i = 0; i < COUNT; i++) {
      const x = (Math.random() - 0.5) * aspect * VIEW_H * 0.9;
      const y = (Math.random() - 0.5) * VIEW_H * 0.9;
      positions[i * 3]     = homePos[i * 3]     = x;
      positions[i * 3 + 1] = homePos[i * 3 + 1] = y;
      positions[i * 3 + 2] = homePos[i * 3 + 2] = 0;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));

    const mat = new THREE.PointsMaterial({
      map: texture, size: 0.27, transparent: true,
      depthWrite: false, alphaTest: 0.005,
    });

    scene.add(new THREE.Points(geo, mat));

    // Mouse far away initially so particles rest at home positions
    let mx = 9999, my = 9999;

    const onMove = (e) => {
      const rect = canvas.getBoundingClientRect();
      mx = ((e.clientX - rect.left) / rect.width  * 2 - 1) * aspect * VIEW_H / 2;
      my = (-((e.clientY - rect.top) / rect.height * 2 - 1)) * VIEW_H / 2;
    };
    const onLeave = () => { mx = 9999; my = 9999; };

    if (panel) {
      panel.addEventListener("mousemove",  onMove);
      panel.addEventListener("mouseleave", onLeave);
    }

    let raf;
    const tick = () => {
      raf = requestAnimationFrame(tick);

      for (let i = 0; i < COUNT; i++) {
        const ix = i * 3, iy = i * 3 + 1;
        const px = positions[ix], py = positions[iy];
        const dx = px - mx, dy = py - my;
        const dist2 = dx * dx + dy * dy;
        const R = 1.5;

        if (dist2 < R * R && dist2 > 1e-4) {
          const d = Math.sqrt(dist2);
          const f = ((R - d) / R) * 0.032;
          vels[ix] += (dx / d) * f;
          vels[iy] += (dy / d) * f;
        }

        vels[ix] += (homePos[ix] - px) * 0.036;
        vels[iy] += (homePos[iy] - py) * 0.036;
        vels[ix] *= 0.87;
        vels[iy] *= 0.87;

        positions[ix] += vels[ix];
        positions[iy] += vels[iy];
      }

      geo.attributes.position.needsUpdate = true;
      renderer.render(scene, camera);
    };
    tick();

    const ro = new ResizeObserver(() => {
      W = canvas.clientWidth; H = canvas.clientHeight;
      aspect = W / H;
      camera.left   = -aspect * VIEW_H / 2;
      camera.right  =  aspect * VIEW_H / 2;
      camera.top    =  VIEW_H / 2;
      camera.bottom = -VIEW_H / 2;
      camera.updateProjectionMatrix();
      renderer.setSize(W, H, false);
    });
    ro.observe(canvas);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      if (panel) {
        panel.removeEventListener("mousemove",  onMove);
        panel.removeEventListener("mouseleave", onLeave);
      }
      geo.dispose(); mat.dispose(); texture.dispose(); renderer.dispose();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%",
               pointerEvents: "none", zIndex: 0 }}
    />
  );
}

// ── Single hero panel ─────────────────────────────────────────────────────────
function HeroPanel({ side, panelClass, extraClass, isExpanded, onEnter, onLeave, onClick, onExpand, studio, services, stats, accentColor }) {
  const panelRef   = useRef(null);
  const tlRef      = useRef(null);
  const pulseTLRef = useRef(null);

  useEffect(() => {
    const gsap = window.gsap;
    if (!gsap || !panelRef.current) return;

    const panel = panelRef.current;
    const chars = panel.querySelectorAll(".panel-title .char");
    const inner = panel.querySelector(".hero-inner");
    const tag   = panel.querySelector(".hover-tag");
    const dot   = tag?.querySelector(".pulse");

    // Initial states
    gsap.set(chars, { opacity: 0, y: 18, rotateX: -30, transformPerspective: 500 });
    gsap.set(tag,   { opacity: 0, y: 8 });

    // Infinite GSAP pulse — fully replaces the CSS keyframe animation
    if (dot) {
      pulseTLRef.current = gsap.timeline({ paused: true, repeat: -1 })
        .to(dot, { scale: 1.8, opacity: 0.22, duration: 0.55, ease: "sine.inOut" })
        .to(dot, { scale: 1.0, opacity: 1.0,  duration: 0.55, ease: "sine.inOut" });
    }

    // Main hover timeline
    tlRef.current = gsap.timeline({ paused: true })
      // Panel subtle scale-up
      .to(panel, { scale: 1.018, duration: 0.5, ease: "expo.out" }, 0)
      // Inner wrapper clip-path expand
      .fromTo(
        inner,
        { clipPath: "inset(5% 3% 5% 3%)" },
        { clipPath: "inset(0% 0% 0% 0%)", duration: 0.45, ease: "expo.out" },
        0
      )
      // Title letters: 3D rotateX flip + y slide + opacity stagger
      .to(chars, {
        opacity: 1, y: 0, rotateX: 0,
        duration: 0.42, stagger: 0.024, ease: "back.out(1.7)",
      }, 0.08)
      // "Click to enter" tag: slide up + fade in
      .to(tag, { opacity: 0.68, y: 0, duration: 0.28, ease: "power2.out" }, 0.22);

    return () => {
      tlRef.current?.kill();
      pulseTLRef.current?.kill();
    };
  }, []);

  const handleEnter = () => {
    if (isExpanded) return;
    onEnter();
    tlRef.current?.play();
    pulseTLRef.current?.play();
  };

  const handleLeave = () => {
    if (isExpanded) return;
    onLeave();
    tlRef.current?.reverse();
    pulseTLRef.current?.pause(0); // stop pulse + reset dot state
  };

  const titleTop    = studio.heroTitleTop    || (side === "graphic" ? "Graphic"     : "Software");
  const titleEm     = studio.heroTitleEm     || (side === "graphic" ? "design"      : "Development");
  const titleSuffix = studio.heroTitleSuffix || ".";
  const eyebrow     = studio.heroEyebrow     || (side === "graphic" ? "01 - Discipline A" : "02 - Discipline B");
  const sub         = studio.heroSub         || (side === "graphic"
    ? "Identity, print, packaging and editorial work for founders who want their brand to look like it means business."
    : "Engineered websites, web apps and storefronts. Type-safe, fast, search-friendly - built to convert and built to last."
  );
  const cta      = studio.heroCta  || (side === "graphic" ? "Enter Graphic Studio" : "Enter Software Studio");
  const tagClass = side === "graphic" ? "tag-red" : "tag-line";

  return (
    <div
      ref={panelRef}
      className={"hero-panel " + panelClass + (extraClass ? " " + extraClass : "")}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      onClick={onClick}
    >
      {/* navy dots on cream (graphic) · cream dots on navy (webdev) */}
      {side === "graphic" && <PanelParticles panelRef={panelRef} r={11}  g={27}  b={58}  />}
      {side === "webdev"  && <PanelParticles panelRef={panelRef} r={250} g={247} b={241} />}
      <div className="hero-inner">
        <div>
          <div className="panel-eyebrow">
            <span className="bar"></span>
            {eyebrow}
          </div>
          <h1 className="panel-title">
            <span className="stack"><Letters text={titleTop} /></span>
            <span className="stack">
              <em><Letters text={titleEm} /></em>
              <Letters text={titleSuffix} />
            </span>
          </h1>
          <p className="panel-sub">{sub}</p>
          <div className="tag-cloud">
            {services.map((s) => (
              <span key={s} className={tagClass}>{s}</span>
            ))}
          </div>
        </div>
        <div className="panel-foot">
          <button className="panel-cta" onClick={(e) => { e.stopPropagation(); onExpand(); }}>
            {cta}
            <span className="arrow"><ArrowOut size={20} sw={2} /></span>
          </button>
          <div className="panel-meta">
            {stats.map((stat) => (
              <div className="stat" key={stat.label}>
                <div className="stat-num">
                  {stat.value}<span style={{ color: accentColor }}>{stat.suffix}</span>
                </div>
                <div className="stat-label">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="hover-tag"><span className="pulse"></span>Click to enter</div>
    </div>
  );
}

// ── Marquee strip spanning both panels ───────────────────────────────────────
const ALL_SERVICES = [...GRAPHIC_SERVICES, ...WEBDEV_SERVICES];

function HeroMarquee() {
  return (
    <div className="hero-marquee" aria-hidden="true">
      <div className="hero-marquee-track">
        {[0, 1].map(copy => (
          <div key={copy} className="hero-marquee-inner">
            {ALL_SERVICES.map((s, i) => (
              <React.Fragment key={`${copy}-${i}`}>
                <span>{s}</span>
                <span className="hero-marquee-sep">·</span>
              </React.Fragment>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Hero ──────────────────────────────────────────────────────────────────────
function Hero({ hovered, setHovered, expanded, onExpand, content }) {
  const isLeftFull  = expanded === "graphic";
  const isRightFull = expanded === "webdev";
  const isExpanded  = !!expanded;
  const graphic = content?.studios?.graphic || {};
  const webdev  = content?.studios?.webdev  || {};

  const graphicServices = (content?.services?.graphic || GRAPHIC_SERVICES).map((s) =>
    typeof s === "string" ? s : s.title
  );
  const webdevServices = (content?.services?.webdev || WEBDEV_SERVICES).map((s) =>
    typeof s === "string" ? s : s.title
  );

  const graphicStats = graphic.heroStats || [
    { value: "120", suffix: "+", label: "Brands shipped" },
    { value: "06",  suffix: "y", label: "In practice"    },
  ];
  const webdevStats = webdev.heroStats || [
    { value: "84", suffix: "+", label: "Sites launched"  },
    { value: "99", suffix: "%", label: "Lighthouse avg." },
  ];

  return (
    <div className={"hero" + (isExpanded ? " expanded" : "")}>
      <HeroPanel
        side="graphic"
        panelClass="panel-graphic"
        extraClass={[
          isLeftFull                           && "full",
          isRightFull                          && "hidden",
          !isExpanded && hovered === "graphic" && "boost",
          !isExpanded && hovered === "webdev"  && "dim",
        ].filter(Boolean).join(" ")}
        isExpanded={isExpanded}
        onEnter={() => setHovered("graphic")}
        onLeave={() => setHovered(null)}
        onClick={() => !isExpanded && onExpand("graphic")}
        onExpand={() => onExpand("graphic")}
        studio={graphic}
        services={graphicServices}
        stats={graphicStats}
        accentColor="var(--red)"
      />

      <div className="hero-divider">
        <span className="vs">/</span>
      </div>

      <HeroPanel
        side="webdev"
        panelClass="panel-webdev"
        extraClass={[
          isRightFull                          && "full",
          isLeftFull                           && "hidden",
          !isExpanded && hovered === "webdev"  && "boost",
          !isExpanded && hovered === "graphic" && "dim",
        ].filter(Boolean).join(" ")}
        isExpanded={isExpanded}
        onEnter={() => setHovered("webdev")}
        onLeave={() => setHovered(null)}
        onClick={() => !isExpanded && onExpand("webdev")}
        onExpand={() => onExpand("webdev")}
        studio={webdev}
        services={webdevServices}
        stats={webdevStats}
        accentColor="var(--amber)"
      />
      <HeroMarquee />
    </div>
  );
}

window.PortfolioHero = Hero;
