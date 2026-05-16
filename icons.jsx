// Clean monoline icons — 24x24 stroke-based
const Icon = ({ d, size = 24, sw = 1.6, color = "currentColor", children }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
    {d ? <path d={d} /> : children}
  </svg>
);

const ArrowOut = ({ size = 20, sw = 2 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
    <path d="M7 17 L17 7" />
    <path d="M8 7 L17 7 L17 16" />
  </svg>
);

const ArrowRight = ({ size = 20, sw = 2 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 12 H19" />
    <path d="M13 5 L20 12 L13 19" />
  </svg>
);

const ArrowLeft = ({ size = 18, sw = 2 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
    <path d="M19 12 H5" />
    <path d="M11 5 L4 12 L11 19" />
  </svg>
);

const Close = ({ size = 14, sw = 2 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 6 L18 18" />
    <path d="M18 6 L6 18" />
  </svg>
);

// Service icons — graphic
const IcoPackaging = (p) => <Icon {...p}><path d="M3 8 L12 4 L21 8 L12 12 Z"/><path d="M3 8 V17 L12 21 L21 17 V8"/><path d="M12 12 V21"/></Icon>;
const IcoFlyer = (p) => <Icon {...p}><rect x="5" y="3" width="14" height="18" rx="1"/><path d="M8 8 H16"/><path d="M8 12 H14"/><path d="M8 16 H12"/></Icon>;
const IcoVector = (p) => <Icon {...p}><circle cx="6" cy="6" r="2"/><circle cx="18" cy="6" r="2"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="18" r="2"/><path d="M8 6 H16"/><path d="M6 8 V16"/><path d="M18 8 V16"/></Icon>;
const IcoTrace = (p) => <Icon {...p}><path d="M4 12 C4 7, 8 4, 12 4 C16 4, 20 7, 20 12 C20 15, 18 17, 15 17 H9 C6 17, 4 19, 4 21"/></Icon>;
const IcoPoster = (p) => <Icon {...p}><rect x="4" y="3" width="16" height="18" rx="1"/><path d="M8 9 L12 13 L16 9"/></Icon>;
const IcoFile = (p) => <Icon {...p}><path d="M14 3 H7 V21 H17 V6 Z"/><path d="M14 3 V6 H17"/><path d="M10 10 L13 13 L10 16"/></Icon>;
const IcoEmbroidery = (p) => <Icon {...p}><circle cx="12" cy="12" r="9"/><path d="M12 3 V21"/><path d="M3 12 H21"/><path d="M6 6 L18 18"/><path d="M18 6 L6 18"/></Icon>;
const IcoCard = (p) => <Icon {...p}><rect x="3" y="6" width="18" height="12" rx="1"/><path d="M3 10 H21"/><path d="M7 14 H11"/></Icon>;
const IcoSocial = (p) => <Icon {...p}><circle cx="6" cy="12" r="3"/><circle cx="18" cy="6" r="3"/><circle cx="18" cy="18" r="3"/><path d="M8.5 10.5 L15.5 7.5"/><path d="M8.5 13.5 L15.5 16.5"/></Icon>;
const IcoPresent = (p) => <Icon {...p}><rect x="3" y="4" width="18" height="12" rx="1"/><path d="M8 20 L12 16 L16 20"/></Icon>;

// Service icons — webdev
const IcoWeb = (p) => <Icon {...p}><rect x="3" y="4" width="18" height="16" rx="1"/><path d="M3 9 H21"/><circle cx="6.5" cy="6.5" r="0.5" fill="currentColor"/><circle cx="9" cy="6.5" r="0.5" fill="currentColor"/></Icon>;
const IcoCode = (p) => <Icon {...p}><path d="M8 8 L4 12 L8 16"/><path d="M16 8 L20 12 L16 16"/><path d="M14 6 L10 18"/></Icon>;
const IcoLanding = (p) => <Icon {...p}><rect x="3" y="3" width="18" height="18" rx="1"/><path d="M3 8 H21"/><path d="M7 13 H17"/><rect x="7" y="16" width="6" height="2" rx="0.5"/></Icon>;
const IcoFolio = (p) => <Icon {...p}><rect x="3" y="6" width="18" height="14" rx="1"/><path d="M9 6 V4 H15 V6"/><path d="M3 12 H21"/></Icon>;
const IcoBiz = (p) => <Icon {...p}><path d="M3 21 V8 L12 3 L21 8 V21"/><rect x="9" y="13" width="6" height="8"/></Icon>;
const IcoEcom = (p) => <Icon {...p}><path d="M3 4 H5 L7 16 H18 L20 8 H7"/><circle cx="9" cy="20" r="1.2"/><circle cx="17" cy="20" r="1.2"/></Icon>;
const IcoApp = (p) => <Icon {...p}><rect x="7" y="3" width="10" height="18" rx="2"/><path d="M11 18 H13"/></Icon>;
const IcoUx = (p) => <Icon {...p}><circle cx="12" cy="12" r="9"/><path d="M12 7 L12 12 L16 14"/></Icon>;
const IcoFrontend = (p) => <Icon {...p}><rect x="3" y="4" width="18" height="14" rx="1"/><path d="M9 22 H15"/><path d="M12 18 V22"/><path d="M7 8 L9 10 L7 12"/><path d="M12 12 H14"/></Icon>;
const IcoBackend = (p) => <Icon {...p}><ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6 V12 C4 13.7, 7.6 15, 12 15 C16.4 15, 20 13.7, 20 12 V6"/><path d="M4 12 V18 C4 19.7, 7.6 21, 12 21 C16.4 21, 20 19.7, 20 18 V12"/></Icon>;

const Lock = ({ size = 16, sw = 2 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
    <rect x="5" y="11" width="14" height="10" rx="2"/>
    <path d="M8 11 V7 A4 4 0 0 1 16 7 V11"/>
  </svg>
);

window.PortfolioIcons = {
  Icon, ArrowOut, ArrowRight, ArrowLeft, Close, Lock,
  graphic: [
    { Comp: IcoPackaging, label: "Packaging Design" },
    { Comp: IcoFlyer, label: "Flyer Design" },
    { Comp: IcoVector, label: "Vector Art" },
    { Comp: IcoTrace, label: "Vector Tracing" },
    { Comp: IcoPoster, label: "Poster Design" },
    { Comp: IcoFile, label: "File Conversion" },
    { Comp: IcoEmbroidery, label: "Embroidery Digitizing" },
    { Comp: IcoCard, label: "Business Card Design" },
    { Comp: IcoSocial, label: "Social Media Posts" },
    { Comp: IcoPresent, label: "Presentation Design" },
  ],
  webdev: [
    { Comp: IcoWeb, label: "Website Design" },
    { Comp: IcoCode, label: "Web Development" },
    { Comp: IcoLanding, label: "Landing Pages" },
    { Comp: IcoFolio, label: "Portfolio Sites" },
    { Comp: IcoBiz, label: "Business Websites" },
    { Comp: IcoEcom, label: "E-commerce" },
    { Comp: IcoApp, label: "App Development" },
    { Comp: IcoUx, label: "UI / UX Design" },
    { Comp: IcoFrontend, label: "Frontend" },
    { Comp: IcoBackend, label: "Backend" },
  ],
};
