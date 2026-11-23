window.Theme = (() => {
  // Arranca en modo daltonismo (Okabe-Ito) por defecto para la evaluación
  let mode = "cvd"; // "cvd" | "editorial"
  let remapping = false;
  let observer = null;

  // Mapeo directo Editorial -> Okabe-Ito (seguro en deuteranopía, protanopía y tritanopía)
  const HEX_MAP = {
    "#1e3a5f": "#0072B2", // Azul pizarra -> Azul fuerte
    "#2b5b9e": "#0072B2", // Azul divergente -> Azul fuerte
    "#365b84": "#0072B2", // Azul intermedio -> Azul fuerte
    "#2d5c8a": "#0072B2", // Azul secuencia -> Azul fuerte
    "#4a76a2": "#0072B2", // Azul coroplético -> Azul fuerte
    "#4e79a7": "#56B4E9", // Azul medio -> Azul cielo
    "#5b84b1": "#56B4E9", // Azul nivel -> Azul cielo
    "#7a9ec2": "#56B4E9", // Azul claro -> Azul cielo
    "#9ab5d1": "#7FBCE0", // Azul suave -> Cielo suave
    "#98aec6": "#7FBCE0", // Azul grisáceo -> Cielo suave
    "#b84a39": "#D55E00", // Terracota -> Naranja bermellón
    "#b83a32": "#D55E00", // Rojo divergente -> Naranja bermellón
    "#991b1b": "#A84300", // Texto contraste -> Bermellón oscuro (AA)
    "#2f6f62": "#009E73", // Verde pino -> Verde azulado
    "#8b6d3f": "#E69F00", // Ocre -> Ámbar dorado (coincide con sección 0.2)
    "#e67e22": "#E69F00", // Triángulo media P4 -> Ámbar dorado
    "#d97706": "#009E73", // Host dominante / ref bruta P5 -> Verde azulado (3er canal limpio)
    "#b45309": "#007A59", // Texto ref bruta P5 -> Verde azulado oscuro
  };

  // Tonos neutros de interfaz que nunca deben alterarse
  const PROTECTED = new Set([
    "#0f172a", "#1e293b", "#334155", "#475569", "#64748b", "#94a3b8",
    "#cbd5e1", "#e2e8f0", "#f1f5f9", "#f8fafc", "#ffffff", "#000000",
    "#eef1f5", "#eef2f6", "#eef3f8", "#e2ecf7", "#e8edf2", "#fdf2f0",
    "#fef3c7", "#fffbeb", "#fcd34d", "#92400e", "#f59e0b", "#d2dfee",
  ]);

  const toHex = (r, g, b) =>
    "#" + [r, g, b].map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0")).join("");

  function hexToRgb(hex) {
    const h = hex.replace("#", "");
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }

  function lerpRgb(c0, c1, t) {
    const k = Math.max(0, Math.min(1, t));
    return [
      Math.round(c0[0] + (c1[0] - c0[0]) * k),
      Math.round(c0[1] + (c1[1] - c0[1]) * k),
      Math.round(c0[2] + (c1[2] - c0[2]) * k),
    ];
  }

  function mapSingleColor(val) {
    if (mode !== "cvd" || typeof val !== "string") return val;
    const trimmed = val.trim();
    const low = trimmed.toLowerCase();

    // 1. Coincidencia exacta hexadecimal
    if (low.startsWith("#") && low.length === 7) {
      if (HEX_MAP[low]) return HEX_MAP[low];
      if (PROTECTED.has(low)) return trimmed;
      const [r, g, b] = hexToRgb(low);
      return remapInterpolatedRgb(r, g, b, null, trimmed);
    }

    // 2. Cadenas rgb(...) o rgba(...)
    const m = low.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)$/);
    if (m) {
      const r = Number(m[1]);
      const g = Number(m[2]);
      const b = Number(m[3]);
      const a = m[4] !== undefined ? Number(m[4]) : null;
      const hex = toHex(r, g, b);

      if (HEX_MAP[hex]) {
        const [nr, ng, nb] = hexToRgb(HEX_MAP[hex]);
        return a !== null ? `rgba(${nr}, ${ng}, ${nb}, ${a})` : `rgb(${nr}, ${ng}, ${nb})`;
      }
      if (PROTECTED.has(hex)) return trimmed;
      return remapInterpolatedRgb(r, g, b, a, trimmed);
    }

    return val;
  }

  // Remapea escalas continuas y divergentes (coropléticos y heatmaps) a Azul <-> Neutro <-> Naranja bermellón
  function remapInterpolatedRgb(r, g, b, alpha, fallback) {
    const neutral = [241, 244, 248];

    // Rama cálida (terracota / rojo positivo -> Naranja bermellón #D55E00)
    if (r - b > 14 && r > g) {
      const t = Math.min(1, Math.max(0, (245 - b) / 190));
      const [nr, ng, nb] = lerpRgb(neutral, [213, 94, 0], t);
      return alpha !== null ? `rgba(${nr}, ${ng}, ${nb}, ${alpha})` : `rgb(${nr}, ${ng}, ${nb})`;
    }

    // Rama fría (azul pizarra / negativo -> Azul Okabe-Ito #0072B2)
    if (b - r > 22 && b > g) {
      const t = Math.min(1, Math.max(0, (238 - r) / 195));
      const [nr, ng, nb] = lerpRgb(neutral, [0, 114, 178], t);
      return alpha !== null ? `rgba(${nr}, ${ng}, ${nb}, ${alpha})` : `rgb(${nr}, ${ng}, ${nb})`;
    }

    return fallback;
  }

  function mapColor(val) {
    if (mode !== "cvd" || typeof val !== "string") return val;
    if (val.includes("gradient(")) {
      return val.replace(/#[0-9a-fA-F]{6}|rgba?\([^)]+\)/g, (tok) => mapSingleColor(tok));
    }
    return mapSingleColor(val);
  }

  // Bordes punteados de cautela en modo daltonismo: gris carbón de alto contraste (evita choque con ámbar)
  function mapCautionColor(val) {
    if (mode !== "cvd") return val;
    return "#334155";
  }

  function remapElement(el) {
    if (!el || el.nodeType !== 1) return;

    ["fill", "stroke", "color"].forEach((attr) => {
      const cur = el.getAttribute(attr);
      if (!cur || cur === "none" || cur === "transparent") return;
      const next = mapColor(cur);
      if (next !== cur) el.setAttribute(attr, next);
    });

    const st = el.getAttribute("style");
    if (st && (st.includes("#") || st.includes("rgb"))) {
      const nextSt = st.replace(/#[0-9a-fA-F]{6}|rgba?\([^)]+\)/g, (tok) => mapSingleColor(tok));
      if (nextSt !== st) el.setAttribute("style", nextSt);
    }
  }

  function remapSubtree(root) {
    if (mode !== "cvd" || !root || remapping) return;
    remapping = true;
    try {
      remapElement(root);
      const nodes = root.querySelectorAll("*");
      for (let i = 0; i < nodes.length; i++) remapElement(nodes[i]);
    } finally {
      remapping = false;
    }
  }

  function startObserver() {
    if (observer) return;
    observer = new MutationObserver((mutations) => {
      if (mode !== "cvd" || remapping) return;
      for (let i = 0; i < mutations.length; i++) {
        const m = mutations[i];
        if (m.type === "childList") {
          m.addedNodes.forEach((node) => {
            if (node.nodeType === 1) remapSubtree(node);
          });
        } else if (m.type === "attributes" && m.target && m.target.nodeType === 1) {
          remapping = true;
          try {
            remapElement(m.target);
          } finally {
            remapping = false;
          }
        }
      }
    });

    const cfg = { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "fill", "stroke"] };
    const panel = document.getElementById("panel-content");
    const legend = document.getElementById("map-legend");
    const geomPane = window.MapaBase && window.MapaBase.getMap && window.MapaBase.getMap()
      ? window.MapaBase.getMap().getPane("geometryPane")
      : null;

    if (panel) observer.observe(panel, cfg);
    if (legend) observer.observe(legend, cfg);
    if (geomPane) observer.observe(geomPane, cfg);
  }

  // Hook automático para las gráficas Chart.js (Pregunta 2)
  function registerChartPlugin() {
    if (!window.Chart) return;
    window.Chart.register({
      id: "okabeItoTheme",
      beforeUpdate(chart) {
        if (mode !== "cvd") return;
        const pointShapes = ["rect", "triangle", "circle", "rectRot"];
        chart.data.datasets.forEach((ds, idx) => {
          if (typeof ds.borderColor === "string") ds.borderColor = mapColor(ds.borderColor);
          else if (Array.isArray(ds.borderColor)) ds.borderColor = ds.borderColor.map(mapColor);

          if (typeof ds.backgroundColor === "string") ds.backgroundColor = mapColor(ds.backgroundColor);
          else if (Array.isArray(ds.backgroundColor)) ds.backgroundColor = ds.backgroundColor.map(mapColor);

          if (ds.showLine) ds.pointStyle = pointShapes[idx % pointShapes.length];
        });
      },
    });
  }

  function updateUI() {
    document.documentElement.dataset.theme = mode;
    const btn = document.getElementById("btn-toggle-theme");
    if (btn) {
      const isCvd = mode === "cvd";
      btn.classList.toggle("active", isCvd);
      btn.setAttribute("aria-pressed", String(isCvd));
      btn.textContent = isCvd ? "Daltonismo: ON" : "Daltonismo: OFF";
    }
  }

  function toggle() {
    mode = mode === "cvd" ? "editorial" : "cvd";
    updateUI();
    if (window.AppShell && typeof window.AppShell.refreshActive === "function") {
      window.AppShell.refreshActive();
    }
  }

  function init() {
    registerChartPlugin();
    updateUI();
    startObserver();

    const btn = document.getElementById("btn-toggle-theme");
    if (btn) btn.addEventListener("click", toggle);
  }

  return {
    init,
    toggle,
    isCVD: () => mode === "cvd",
    mapColor,
    mapCautionColor,
    remapSubtree,
  };
})();