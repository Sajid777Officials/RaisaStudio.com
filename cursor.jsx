// Custom magnetic cursor — dot snaps, ring lags with lerp
// Colour shifts: red (graphic panel) · amber (webdev panel) · navy (neutral)
const { useEffect, useRef } = React;

function Cursor() {
  const dotRef  = useRef(null);
  const ringRef = useRef(null);

  useEffect(() => {
    const dot  = dotRef.current;
    const ring = ringRef.current;
    if (!dot || !ring) return;

    let mx = -200, my = -200;
    let rx = -200, ry = -200;
    let targetScale = 1, curScale = 1;
    let targetColor = "11,27,58"; // navy default
    let raf;

    const onMove = (e) => {
      mx = e.clientX; my = e.clientY;

      const el = document.elementFromPoint(mx, my);
      if      (el?.closest(".panel-webdev"))  targetColor = "244,180,0";   // amber
      else if (el?.closest(".panel-graphic")) targetColor = "230,57,70";   // red
      else                                    targetColor = "11,27,58";    // navy

      targetScale = el?.closest("button, a, .work-card, .service-card, .panel-cta") ? 1.55 : 1;
    };

    const onLeave = () => { mx = -200; my = -200; };

    const tick = () => {
      raf = requestAnimationFrame(tick);
      rx += (mx - rx) * 0.1;
      ry += (my - ry) * 0.1;
      curScale += (targetScale - curScale) * 0.1;

      dot.style.transform  = `translate(${mx - 4}px,${my - 4}px)`;
      dot.style.background = `rgb(${targetColor})`;

      ring.style.transform    = `translate(${rx - 20}px,${ry - 20}px) scale(${curScale.toFixed(3)})`;
      ring.style.borderColor  = `rgb(${targetColor})`;
    };

    document.addEventListener("mousemove",  onMove);
    document.addEventListener("mouseleave", onLeave);
    tick();

    return () => {
      document.removeEventListener("mousemove",  onMove);
      document.removeEventListener("mouseleave", onLeave);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <>
      <div ref={dotRef}  className="cursor-dot"  />
      <div ref={ringRef} className="cursor-ring" />
    </>
  );
}

window.PortfolioCursor = Cursor;
