import * as React from "react";
import * as ReactDOMLegacy from "react-dom";
import { createRoot } from "react-dom/client";
import { createClient } from "@supabase/supabase-js";
import { gsap } from "gsap";
import * as THREE from "three";

// The existing source is intentionally framework-light and consumes these
// libraries as browser globals. Bundle and pin them locally instead of loading
// executable code from a third-party CDN at runtime.
window.React = React;
window.ReactDOM = { ...ReactDOMLegacy, createRoot };
window.supabase = { createClient };
window.gsap = gsap;
window.THREE = THREE;
