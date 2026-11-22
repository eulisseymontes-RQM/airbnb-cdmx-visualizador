window.Pregunta1 = (() => {
  const MIN_N = 5;
  const LOW_N_THRESHOLD = 50; // Cautela visual para alcaldías con pocos anuncios comparables
  const COMPARABLES = ["Alojamiento completo", "Habitación privada"];

  const MOD_COLORES = {
    "Alojamiento completo": "#1E3A5F",
    "Habitación privada": "#B84A39",
    "Habitación compartida": "#2F6F62",
    "Habitación de hotel": "#8B6D3F",
  };

  let allRows = [];
  let metrics = null;
  let refs = { panelEl: null, legendEl: null, mapApi: null, store: null };
  let renderToken = 0;

  const state = {
    act: 1,
    activeModalidades: new Set(),
    choroMode: "completo", // "completo" | "privada" | "global" (Acto 2)
    selectedAlcKey: null,
    hoveredAlcKey: null,
    showAllPointsInChoro: false,
  };

  function medianOf(arr) {
    const s = window.Stats.sortedNumbers(arr);
    return window.Stats.quantileSorted(s, 0.5);
  }

  function fiveNum(values) {
    const S = window.Stats;
    const s = S.sortedNumbers(values);
    const n = s.length;
    if (!n) {
      return { n: 0, mean: NaN, min: NaN, q1: NaN, median: NaN, q3: NaN, max: NaN, iqr: NaN, wLow: NaN, wHigh: NaN, outliers: [] };
    }
    const q1 = S.quantileSorted(s, 0.25);
    const median = S.quantileSorted(s, 0.5);
    const q3 = S.quantileSorted(s, 0.75);
    const iqr = q3 - q1;
    const lowFence = q1 - 1.5 * iqr;
    const highFence = q3 + 1.5 * iqr;

    let wLow = s[0];
    for (let i = 0; i < n; i++) {
      if (s[i] >= lowFence) {
        wLow = s[i];
        break;
      }
    }
    let wHigh = s[n - 1];
    for (let i = n - 1; i >= 0; i--) {
      if (s[i] <= highFence) {
        wHigh = s[i];
        break;
      }
    }

    // Muestreo determinístico de valores fuera de bigotes para mantener ligero el SVG
    const rawOutliers = s.filter((v) => v < wLow || v > wHigh);
    const maxDots = 55;
    let outliers = rawOutliers;
    if (rawOutliers.length > maxDots) {
      outliers = [];
      const step = (rawOutliers.length - 1) / (maxDots - 1);
      for (let i = 0; i < maxDots; i++) {
        outliers.push(rawOutliers[Math.round(i * step)]);
      }
    }

    return {
      n,
      mean: S.mean(s),
      min: s[0],
      q1,
      median,
      q3,
      max: s[n - 1],
      iqr,
      wLow,
      wHigh,
      outliers,
    };
  }

  function computeMetrics(rows) {
    const allPrices = rows.map((r) => r.precio);
    const globalStats = fiveNum(allPrices);

    // 1. Resumen por modalidad (ordenado por mediana descendente, fiel a 4.1.1)
    const byModMap = {};
    rows.forEach((r) => {
      if (!byModMap[r.modalidad]) byModMap[r.modalidad] = [];
      byModMap[r.modalidad].push(r.precio);
    });

    const modList = Object.entries(byModMap)
      .map(([modalidad, vals]) => ({ modalidad, ...fiveNum(vals) }))
      .sort((a, b) => b.median - a.median);

    const modByName = {};
    modList.forEach((m) => (modByName[m.modalidad] = m));

    // 2. Cruce por alcaldía (fiel a 4.1.2: Completos + Privadas, criterio MIN_N = 5)
    const alcGroups = {};
    rows.forEach((r) => {
      const k = r.alcaldia_key;
      if (!alcGroups[k]) {
        alcGroups[k] = {
          key: k,
          alcaldia: r.alcaldia,
          all: [],
          completo: [],
          privada: [],
          compartida: [],
          hotel: [],
        };
      }
      alcGroups[k].all.push(r.precio);
      if (r.modalidad === "Alojamiento completo") alcGroups[k].completo.push(r.precio);
      else if (r.modalidad === "Habitación privada") alcGroups[k].privada.push(r.precio);
      else if (r.modalidad === "Habitación compartida") alcGroups[k].compartida.push(r.precio);
      else if (r.modalidad === "Habitación de hotel") alcGroups[k].hotel.push(r.precio);
    });

    const alcList = [];
    const alcExcluidas = [];

    Object.values(alcGroups).forEach((g) => {
      const stAll = fiveNum(g.all);
      const stComp = fiveNum(g.completo);
      const stPriv = fiveNum(g.privada);
      const cumple = stComp.n >= MIN_N && stPriv.n >= MIN_N;
      const nComparables = stComp.n + stPriv.n;
      const ratio = stPriv.median > 0 ? stComp.median / stPriv.median : NaN;

      const rec = {
        key: g.key,
        alcaldia: g.alcaldia,
        nTotal: stAll.n,
        nComparables,
        medGlobal: stAll.median,
        q1Global: stAll.q1,
        q3Global: stAll.q3,
        nComp: stComp.n,
        medComp: stComp.median,
        q1Comp: stComp.q1,
        q3Comp: stComp.q3,
        nPriv: stPriv.n,
        medPriv: stPriv.median,
        q1Priv: stPriv.q1,
        q3Priv: stPriv.q3,
        nCompartida: g.compartida.length,
        nHotel: g.hotel.length,
        ratio,
        varCompVsCdmx: ((stComp.median / modByName["Alojamiento completo"].median) - 1) * 100,
        varPrivVsCdmx: ((stPriv.median / modByName["Habitación privada"].median) - 1) * 100,
        varGlobalVsCdmx: ((stAll.median / globalStats.median) - 1) * 100,
        isLowN: nComparables < LOW_N_THRESHOLD,
        cumple,
      };

      if (cumple) alcList.push(rec);
      else alcExcluidas.push(rec.alcaldia);
    });

    // Orden oficial de 4.1.2: mediana de alojamientos completos descendente
    alcList.sort((a, b) => b.medComp - a.medComp);

    const alcByKey = {};
    alcList.forEach((a) => (alcByKey[a.key] = a));

    const nComparablesTotal = rows.filter((r) => COMPARABLES.includes(r.modalidad)).length;
    const pctComparables = (nComparablesTotal / rows.length) * 100;

    // Rangos dinámicos para escalas de color
    const rangeOf = (arr) => ({ min: Math.min(...arr), max: Math.max(...arr) });

    metrics = {
      globalStats,
      modList,
      modByName,
      alcList,
      alcByKey,
      alcExcluidas,
      nComparablesTotal,
      pctComparables,
      cdmxMedComp: modByName["Alojamiento completo"] ? modByName["Alojamiento completo"].median : NaN,
      cdmxMedPriv: modByName["Habitación privada"] ? modByName["Habitación privada"].median : NaN,
      ranges: {
        completo: rangeOf(alcList.map((a) => a.medComp)),
        privada: rangeOf(alcList.map((a) => a.medPriv)),
        global: rangeOf(alcList.map((a) => a.medGlobal)),
        ratio: rangeOf(alcList.map((a) => a.ratio)),
      },
    };
  }

  // Escala secuencial sobria (piedra clara -> azul acero -> azul pizarra profundo)
  function lerpColor(t, palette) {
    const clamped = Math.max(0, Math.min(1, t));
    const idx = clamped * (palette.length - 1);
    const lo = Math.floor(idx);
    const hi = Math.min(palette.length - 1, lo + 1);
    const f = idx - lo;
    const c0 = palette[lo];
    const c1 = palette[hi];
    const r = Math.round(c0[0] + (c1[0] - c0[0]) * f);
    const g = Math.round(c0[1] + (c1[1] - c0[1]) * f);
    const b = Math.round(c0[2] + (c1[2] - c0[2]) * f);
    return `rgb(${r}, ${g}, ${b})`;
  }

  const PALETTE_SLATE = [
    [226, 234, 243],
    [154, 181, 209],
    [74, 118, 162],
    [30, 58, 95],
  ];

  const PALETTE_RATIO = [
    [232, 236, 241],
    [152, 174, 198],
    [54, 91, 132],
    [184, 74, 57],
  ];

  function getChoroValue(rec) {
    if (!rec) return NaN;
    if (state.act === 3) return rec.ratio;
    if (state.choroMode === "privada") return rec.medPriv;
    if (state.choroMode === "global") return rec.medGlobal;
    return rec.medComp;
  }

  function getChoroRange() {
    if (state.act === 3) return metrics.ranges.ratio;
    return metrics.ranges[state.choroMode];
  }

  function getChoroColor(val) {
    if (!Number.isFinite(val)) return "#CBD5E1";
    const { min, max } = getChoroRange();
    const t = max > min ? (val - min) / (max - min) : 0.5;
    return lerpColor(t, state.act === 3 ? PALETTE_RATIO : PALETTE_SLATE);
  }

  function pointPopupHtml(p) {
    const S = window.Stats;
    return `
      <div class="popup-title">${p.alcaldia}</div>
      <div class="popup-grid">
        <span class="popup-k">Precio / noche</span><span class="popup-v">${S.fmtMXN(p.precio, 2)} MXN</span>
        <span class="popup-k">Modalidad</span><span class="popup-v">${p.modalidad}</span>
        <span class="popup-k">Capacidad</span><span class="popup-v">${S.fmtInt(p.capacidad)} huéspedes</span>
        <span class="popup-k">Precio / huésped</span><span class="popup-v">${S.fmtMXN(p.precio_huesped, 0)} MXN</span>
      </div>
    `;
  }

  function tooltipHtmlForAlcaldia(key, rawName) {
    const S = window.Stats;
    const rec = metrics.alcByKey[key];
    if (!rec) return `<div class="choro-tt-title">${rawName}</div><div>Sin datos suficientes</div>`;

    const cautela = rec.isLowN
      ? `<div style="margin-top:4px;color:#FCD34D;font-size:10.5px;">⚠ Muestra pequeña (n=${S.fmtInt(rec.nComparables)})</div>`
      : "";

    if (state.act === 3) {
      return `
        <div class="choro-tt-title">${rec.alcaldia}</div>
        <div class="choro-tt-row"><span class="choro-tt-k">Brecha (Comp / Priv)</span><span class="choro-tt-v">${rec.ratio.toFixed(2)}×</span></div>
        <div class="choro-tt-row"><span class="choro-tt-k">Med. completos</span><span class="choro-tt-v">${S.fmtMXN(rec.medComp)} (n=${S.fmtInt(rec.nComp)})</span></div>
        <div class="choro-tt-row"><span class="choro-tt-k">Med. privadas</span><span class="choro-tt-v">${S.fmtMXN(rec.medPriv)} (n=${S.fmtInt(rec.nPriv)})</span></div>
        ${cautela}
      `;
    }

    const modeLabel =
      state.choroMode === "privada"
        ? "Hab. privada"
        : state.choroMode === "global"
          ? "Todas las modalidades"
          : "Aloj. completo";
    const activeVal = getChoroValue(rec);
    const activeVar =
      state.choroMode === "privada"
        ? rec.varPrivVsCdmx
        : state.choroMode === "global"
          ? rec.varGlobalVsCdmx
          : rec.varCompVsCdmx;

    return `
      <div class="choro-tt-title">${rec.alcaldia}</div>
      <div class="choro-tt-row"><span class="choro-tt-k">Mediana (${modeLabel})</span><span class="choro-tt-v">${S.fmtMXN(activeVal)}</span></div>
      <div class="choro-tt-row"><span class="choro-tt-k">vs. mediana CDMX</span><span class="choro-tt-v">${S.fmtSigned(activeVar, 1)}%</span></div>
      <div class="choro-tt-row"><span class="choro-tt-k">Completos / Privadas</span><span class="choro-tt-v">${S.fmtInt(rec.nComp)} / ${S.fmtInt(rec.nPriv)}</span></div>
      ${cautela}
    `;
  }

  function syncPointsForCurrentAct() {
    if (state.act === 1) {
      const visible = allRows.filter((r) => state.activeModalidades.has(r.modalidad));
      refs.mapApi.setPoints(visible, {
        colorFn: (p) => MOD_COLORES[p.modalidad] || "#64748B",
        radiusFn: () => 2.1,
        alphaFn: () => 0.48,
        popupFn: pointPopupHtml,
      });
      return;
    }

    // Acto 2 y Acto 3: coroplético limpio; puntos solo de la alcaldía seleccionada (o todos si el usuario lo activa)
    let pts = [];
    if (state.showAllPointsInChoro) {
      pts = state.choroMode === "global" && state.act === 2
        ? allRows
        : allRows.filter((r) => COMPARABLES.includes(r.modalidad));
    } else if (state.selectedAlcKey) {
      pts = allRows.filter((r) => {
        if (r.alcaldia_key !== state.selectedAlcKey) return false;
        if (state.act === 2 && state.choroMode === "completo") return r.modalidad === "Alojamiento completo";
        if (state.act === 2 && state.choroMode === "privada") return r.modalidad === "Habitación privada";
        if (state.act === 3) return COMPARABLES.includes(r.modalidad);
        return true;
      });
    }

    refs.mapApi.setPoints(pts, {
      colorFn: (p) => MOD_COLORES[p.modalidad] || "#1E3A5F",
      radiusFn: () => (state.selectedAlcKey && !state.showAllPointsInChoro ? 2.6 : 1.9),
      alphaFn: () => (state.selectedAlcKey && !state.showAllPointsInChoro ? 0.72 : 0.35),
      popupFn: pointPopupHtml,
    });
  }

  async function syncMap() {
    const token = ++renderToken;

    if (state.act === 1) {
      refs.mapApi.clearChoropleth();
      syncPointsForCurrentAct();
      renderLegend();
      return;
    }

    await refs.mapApi.setChoropleth({
      selectedKey: state.selectedAlcKey,
      styleFn: (key, _rawName, { isSelected, isHovered }) => {
        const rec = metrics.alcByKey[key];
        const val = getChoroValue(rec);
        const lowN = rec && rec.isLowN;
        return {
          fillColor: getChoroColor(val),
          fillOpacity: isSelected ? 0.52 : isHovered ? 0.68 : 0.58,
          color: isSelected ? "#0F172A" : isHovered ? "#1E293B" : lowN ? "#8B6D3F" : "#FFFFFF",
          weight: isSelected ? 2.8 : isHovered ? 2.0 : lowN ? 1.8 : 1.1,
          dashArray: lowN && !isSelected ? "4 3" : null,
          opacity: 0.95,
        };
      },
      tooltipFn: tooltipHtmlForAlcaldia,
      onHover: (key) => {
        state.hoveredAlcKey = key;
        highlightLinkedElements();
      },
      onSelect: (key) => {
        state.selectedAlcKey = state.selectedAlcKey === key ? null : key;
        refs.mapApi.setSelectedAlcaldia(state.selectedAlcKey);
        syncPointsForCurrentAct();
        updateSelectedBanner();
        highlightLinkedElements();
      },
    });

    if (token !== renderToken) return;
    syncPointsForCurrentAct();
    renderLegend();
  }

  function highlightLinkedElements() {
    document.querySelectorAll("[data-alc-key]").forEach((el) => {
      const k = el.getAttribute("data-alc-key");
      el.classList.toggle("is-selected", k === state.selectedAlcKey);
      el.classList.toggle("is-hovered", k === state.hoveredAlcKey);
    });
  }

  function renderLegend() {
    const S = window.Stats;
    const el = refs.legendEl;

    if (state.act === 1) {
      el.innerHTML =
        `<div class="legend-title">Modalidad (mediana CDMX)</div>` +
        metrics.modList
          .map(
            (m) => `
            <div class="legend-item">
              <span class="legend-left"><span class="swatch" style="background:${MOD_COLORES[m.modalidad] || "#64748B"}"></span>${m.modalidad}</span>
              <span class="mono">${S.fmtMXN(m.median)}</span>
            </div>`
          )
          .join("");
      return;
    }

    const { min, max } = getChoroRange();
    const grad =
      state.act === 3
        ? "linear-gradient(90deg, #E8ECF1 0%, #98AEC6 35%, #365B84 70%, #B84A39 100%)"
        : "linear-gradient(90deg, #E2EAF3 0%, #9AB5D1 35%, #4A76A2 70%, #1E3A5F 100%)";

    const title =
      state.act === 3
        ? "Multiplicador (# veces más caro)"
        : state.choroMode === "privada"
          ? "Mediana Habitación privada"
          : state.choroMode === "global"
            ? "Mediana Global por alcaldía"
            : "Mediana Alojamiento completo";

    const minLbl = state.act === 3 ? `${min.toFixed(2)}×` : S.fmtMXN(min);
    const maxLbl = state.act === 3 ? `${max.toFixed(2)}×` : S.fmtMXN(max);

    el.innerHTML = `
      <div class="legend-title">${title}</div>
      <div class="legend-gradient" style="background:${grad}"></div>
      <div class="legend-scale mono"><span>${minLbl}</span><span>${maxLbl}</span></div>
      <div class="legend-note"><span class="dashed-sample"></span> Borde punteado: muestra pequeña (n &lt; ${LOW_N_THRESHOLD})</div>
    `;
  }

  // --- SVG 1: Boxplot logarítmico por modalidad (fiel a 4.1.1) ---
  function buildBoxplotSVG() {
    const S = window.Stats;
    const W = 415;
    const H = 235;
    const pad = { top: 14, right: 14, bottom: 44, left: 54 };
    const plotW = W - pad.left - pad.right;
    const plotH = H - pad.top - pad.bottom;

    const minVal = Math.min(140, ...metrics.modList.map((m) => m.min));
    const maxVal = Math.max(45000, ...metrics.modList.map((m) => m.max));
    const logMin = Math.log10(minVal * 0.85);
    const logMax = Math.log10(maxVal * 1.15);
    const yOf = (v) => pad.top + ((logMax - Math.log10(v)) / (logMax - logMin)) * plotH;

    const ticks = [200, 500, 1000, 2000, 5000, 10000, 20000].filter((t) => t >= minVal * 0.85 && t <= maxVal * 1.15);
    const gridLines = ticks
      .map((t) => {
        const y = yOf(t);
        return `
          <line x1="${pad.left}" y1="${y}" x2="${W - pad.right}" y2="${y}" stroke="#E2E8F0" stroke-width="1" />
          <text x="${pad.left - 7}" y="${y + 3.5}" text-anchor="end" class="svg-axis-txt">${S.fmtMXN(t)}</text>
        `;
      })
      .join("");

    // Línea punteada de mediana global CDMX
    const yGlobal = yOf(metrics.globalStats.median);
    const refLine = `
      <line x1="${pad.left}" y1="${yGlobal}" x2="${W - pad.right}" y2="${yGlobal}"
            stroke="#64748B" stroke-width="1.1" stroke-dasharray="4 3" />
    `;

    const colW = plotW / metrics.modList.length;
    const boxW = Math.min(44, colW * 0.48);

    const shortLabel = {
      "Habitación de hotel": ["Hotel", ""],
      "Alojamiento completo": ["Alojamiento", "completo"],
      "Habitación privada": ["Habitación", "privada"],
      "Habitación compartida": ["Habitación", "compartida"],
    };

    const boxes = metrics.modList
      .map((m, i) => {
        const cx = pad.left + colW * (i + 0.5);
        const col = MOD_COLORES[m.modalidad] || "#64748B";
        const yQ1 = yOf(m.q1);
        const yQ3 = yOf(m.q3);
        const yMed = yOf(m.median);
        const yLow = yOf(m.wLow);
        const yHigh = yOf(m.wHigh);
        const lines = shortLabel[m.modalidad] || [m.modalidad, ""];

        const dots = m.outliers
          .map((ov, k) => {
            const jitter = ((k % 5) - 2) * 1.4;
            return `<circle cx="${(cx + jitter).toFixed(1)}" cy="${yOf(ov).toFixed(1)}" r="1.35" fill="${col}" fill-opacity="0.38" />`;
          })
          .join("");

        return `
          <g class="svg-box-group">
            <title>${m.modalidad} (n=${S.fmtInt(m.n)})&#10;Mediana: ${S.fmtMXN(m.median, 2)}&#10;Media: ${S.fmtMXN(m.mean, 2)}&#10;Q1–Q3: ${S.fmtMXN(m.q1, 0)} – ${S.fmtMXN(m.q3, 0)}</title>
            ${dots}
            <line x1="${cx}" y1="${yHigh}" x2="${cx}" y2="${yLow}" stroke="${col}" stroke-width="1.4" />
            <line x1="${cx - boxW * 0.28}" y1="${yHigh}" x2="${cx + boxW * 0.28}" y2="${yHigh}" stroke="${col}" stroke-width="1.4" />
            <line x1="${cx - boxW * 0.28}" y1="${yLow}" x2="${cx + boxW * 0.28}" y2="${yLow}" stroke="${col}" stroke-width="1.4" />
            <rect x="${cx - boxW / 2}" y="${yQ3}" width="${boxW}" height="${Math.max(2, yQ1 - yQ3)}"
                  fill="${col}" fill-opacity="0.82" rx="2.5" stroke="#0F172A" stroke-opacity="0.15" />
            <line x1="${cx - boxW / 2}" y1="${yMed}" x2="${cx + boxW / 2}" y2="${yMed}" stroke="#FFFFFF" stroke-width="2.1" />
            <text x="${cx}" y="${H - 27}" text-anchor="middle" class="svg-cat-txt">${lines[0]}</text>
            ${lines[1] ? `<text x="${cx}" y="${H - 16}" text-anchor="middle" class="svg-cat-txt">${lines[1]}</text>` : ""}
            <text x="${cx}" y="${H - 5}" text-anchor="middle" class="svg-sub-txt">n=${S.fmtInt(m.n)}</text>
          </g>
        `;
      })
      .join("");

    return `
      <svg viewBox="0 0 ${W} ${H}" class="p1-svg" role="img" aria-label="Boxplot logarítmico por modalidad">
        ${gridLines}
        ${refLine}
        ${boxes}
      </svg>
      <div class="svg-footnote">
        Escala logarítmica en MXN · Línea punteada horizontal: mediana CDMX (${S.fmtMXN(metrics.globalStats.median)}). Pasa el cursor sobre una caja para ver sus cuantiles.
      </div>
    `;
  }

  // --- SVG 2: Intervalos Q1–Q3 y medianas por alcaldía (fiel a 4.1.2, sincronizado con el mapa) ---
  function buildIntervalsSVG() {
    const S = window.Stats;
    const rows = metrics.alcList;
    const rowH = 22;
    const pad = { top: 14, right: 14, bottom: 28, left: 132 };
    const W = 415;
    const H = pad.top + rows.length * rowH + pad.bottom;
    const plotW = W - pad.left - pad.right;

    const allLo = rows.map((r) => Math.min(r.q1Priv, r.q1Comp));
    const allHi = rows.map((r) => Math.max(r.q3Priv, r.q3Comp));
    const xMin = Math.min(360, Math.min(...allLo) * 0.9);
    const xMax = Math.max(4100, Math.max(...allHi) * 1.08);
    const logMin = Math.log10(xMin);
    const logMax = Math.log10(xMax);
    const xOf = (v) => pad.left + ((Math.log10(v) - logMin) / (logMax - logMin)) * plotW;

    const ticks = [400, 600, 1000, 1500, 2500, 4000].filter((t) => t >= xMin && t <= xMax);
    const gridHtml = ticks
      .map((t) => {
        const x = xOf(t);
        return `
          <line x1="${x}" y1="${pad.top}" x2="${x}" y2="${H - pad.bottom}" stroke="#E2E8F0" stroke-width="1" />
          <text x="${x}" y="${H - 10}" text-anchor="middle" class="svg-axis-txt">${S.fmtMXN(t)}</text>
        `;
      })
      .join("");

    const xRefComp = xOf(metrics.cdmxMedComp);
    const xRefPriv = xOf(metrics.cdmxMedPriv);
    const refLines = `
      <line x1="${xRefPriv}" y1="${pad.top}" x2="${xRefPriv}" y2="${H - pad.bottom}" stroke="#B84A39" stroke-width="1.2" stroke-dasharray="4 3" opacity="0.85" />
      <line x1="${xRefComp}" y1="${pad.top}" x2="${xRefComp}" y2="${H - pad.bottom}" stroke="#1E3A5F" stroke-width="1.2" stroke-dasharray="4 3" opacity="0.85" />
    `;

    const rowsHtml = rows
      .map((r, i) => {
        const yMid = pad.top + i * rowH + rowH / 2;
        const yC = yMid - 4;
        const yP = yMid + 4;
        const shortName = r.alcaldia === "La Magdalena Contreras"
          ? "Magdalena Contreras"
          : r.alcaldia === "Cuajimalpa de Morelos"
            ? "Cuajimalpa"
            : r.alcaldia;
        const labelTxt = r.isLowN ? `${shortName} *` : shortName;

        return `
          <g class="svg-alc-row" data-alc-key="${r.key}" tabindex="0">
            <title>${r.alcaldia}&#10;Completos: ${S.fmtMXN(r.medComp)} (Q1–Q3: ${S.fmtMXN(r.q1Comp)}–${S.fmtMXN(r.q3Comp)}, n=${S.fmtInt(r.nComp)})&#10;Privadas: ${S.fmtMXN(r.medPriv)} (Q1–Q3: ${S.fmtMXN(r.q1Priv)}–${S.fmtMXN(r.q3Priv)}, n=${S.fmtInt(r.nPriv)})</title>
            <rect class="svg-row-bg" x="0" y="${pad.top + i * rowH}" width="${W}" height="${rowH}" rx="3" />
            <text x="${pad.left - 8}" y="${yMid + 3.5}" text-anchor="end" class="svg-row-lbl ${r.isLowN ? "is-low-n" : ""}">${labelTxt}</text>
            <line x1="${xOf(r.q1Comp)}" y1="${yC}" x2="${xOf(r.q3Comp)}" y2="${yC}" stroke="#1E3A5F" stroke-width="3" stroke-linecap="round" opacity="0.42" />
            <circle cx="${xOf(r.medComp)}" cy="${yC}" r="3.4" fill="#1E3A5F" />
            <line x1="${xOf(r.q1Priv)}" y1="${yP}" x2="${xOf(r.q3Priv)}" y2="${yP}" stroke="#B84A39" stroke-width="3" stroke-linecap="round" opacity="0.42" />
            <circle cx="${xOf(r.medPriv)}" cy="${yP}" r="3.4" fill="#B84A39" />
          </g>
        `;
      })
      .join("");

    return `
      <div class="svg-inline-legend">
        <span><i class="dot" style="background:#1E3A5F"></i> Completo (CDMX ${S.fmtMXN(metrics.cdmxMedComp)})</span>
        <span><i class="dot" style="background:#B84A39"></i> Privada (CDMX ${S.fmtMXN(metrics.cdmxMedPriv)})</span>
      </div>
      <svg viewBox="0 0 ${W} ${H}" class="p1-svg" role="img" aria-label="Intervalos Q1-Q3 y medianas por alcaldía">
        ${gridHtml}
        ${refLines}
        ${rowsHtml}
      </svg>
      <div class="svg-footnote">
        Punto = mediana · Barra = Q1 a Q3 (escala log) · * Muestra pequeña (n &lt; ${LOW_N_THRESHOLD}). Haz clic en cualquier fila o alcaldía del mapa para inspeccionar sus puntos reales.
      </div>
    `;
  }

  // --- SVG 3: Ranking del multiplicador (# veces más caro) en Acto 3 ---
  function buildRatioSVG() {
    const S = window.Stats;
    const rows = [...metrics.alcList].sort((a, b) => b.ratio - a.ratio);
    const rowH = 21;
    const pad = { top: 12, right: 44, bottom: 26, left: 132 };
    const W = 415;
    const H = pad.top + rows.length * rowH + pad.bottom;
    const plotW = W - pad.left - pad.right;

    const maxR = Math.max(2.5, Math.ceil(Math.max(...rows.map((r) => r.ratio)) * 4) / 4);
    const xOf = (v) => pad.left + (v / maxR) * plotW;

    const ticks = [0, 0.5, 1.0, 1.5, 2.0, 2.5].filter((t) => t <= maxR + 0.01);
    const gridHtml = ticks
      .map((t) => {
        const x = xOf(t);
        const isTwo = Math.abs(t - 2.0) < 0.001;
        return `
          <line x1="${x}" y1="${pad.top}" x2="${x}" y2="${H - pad.bottom}"
                stroke="${isTwo ? "#B84A39" : "#E2E8F0"}" stroke-width="${isTwo ? 1.3 : 1}"
                ${isTwo ? 'stroke-dasharray="4 3"' : ""} />
          <text x="${x}" y="${H - 8}" text-anchor="middle" class="svg-axis-txt">${t.toFixed(1)}×</text>
        `;
      })
      .join("");

    const rowsHtml = rows
      .map((r, i) => {
        const yMid = pad.top + i * rowH + rowH / 2;
        const barCol = r.ratio >= 2.0 ? "#B84A39" : "#1E3A5F";
        const shortName = r.alcaldia === "La Magdalena Contreras"
          ? "Magdalena Contreras"
          : r.alcaldia === "Cuajimalpa de Morelos"
            ? "Cuajimalpa"
            : r.alcaldia;
        const labelTxt = r.isLowN ? `${shortName} *` : shortName;
        const xEnd = xOf(r.ratio);

        return `
          <g class="svg-alc-row" data-alc-key="${r.key}" tabindex="0">
            <rect class="svg-row-bg" x="0" y="${pad.top + i * rowH}" width="${W}" height="${rowH}" rx="3" />
            <text x="${pad.left - 8}" y="${yMid + 3.5}" text-anchor="end" class="svg-row-lbl ${r.isLowN ? "is-low-n" : ""}">${labelTxt}</text>
            <rect x="${pad.left}" y="${yMid - 5}" width="${Math.max(2, xEnd - pad.left)}" height="10"
                  rx="2.5" fill="${barCol}" fill-opacity="${r.isLowN ? 0.48 : 0.85}" />
            <text x="${xEnd + 5}" y="${yMid + 3.5}" class="svg-val-txt">${r.ratio.toFixed(2)}×</text>
          </g>
        `;
      })
      .join("");

    return `
      <svg viewBox="0 0 ${W} ${H}" class="p1-svg" role="img" aria-label="Brecha veces más caro por alcaldía">
        ${gridHtml}
        ${rowsHtml}
      </svg>
      <div class="svg-footnote">
        Razón = mediana de Alojamiento completo / mediana de Habitación privada · Terracota: brecha &ge; 2.0× · * Muestra pequeña (n &lt; ${LOW_N_THRESHOLD}).
      </div>
    `;
  }

  function bindLinkedRowEvents(container) {
    container.querySelectorAll("[data-alc-key]").forEach((el) => {
      const k = el.getAttribute("data-alc-key");
      el.addEventListener("mouseenter", () => {
        state.hoveredAlcKey = k;
        refs.mapApi.setHoveredAlcaldia(k);
        highlightLinkedElements();
      });
      el.addEventListener("mouseleave", () => {
        if (state.hoveredAlcKey === k) state.hoveredAlcKey = null;
        refs.mapApi.setHoveredAlcaldia(null);
        highlightLinkedElements();
      });
      el.addEventListener("click", () => {
        state.selectedAlcKey = state.selectedAlcKey === k ? null : k;
        refs.mapApi.setSelectedAlcaldia(state.selectedAlcKey);
        syncPointsForCurrentAct();
        updateSelectedBanner();
        highlightLinkedElements();
      });
    });
  }

  function updateSelectedBanner() {
    const box = document.getElementById("p1-selected-box");
    if (!box) return;
    if (!state.selectedAlcKey || !metrics.alcByKey[state.selectedAlcKey]) {
      box.innerHTML = "";
      return;
    }
    const S = window.Stats;
    const r = metrics.alcByKey[state.selectedAlcKey];
    const cautela = r.isLowN
      ? `<span class="low-n-badge">Muestra pequeña · n=${S.fmtInt(r.nComparables)}</span>`
      : "";

    box.innerHTML = `
      <div class="selected-alc-card">
        <div class="selected-alc-head">
          <div>
            <strong>${r.alcaldia}</strong> ${cautela}
            <div class="selected-alc-sub">Puntos reales visibles en el mapa · ${S.fmtInt(r.nTotal)} anuncios totales</div>
          </div>
          <button id="p1-clear-alc" class="mini-btn">Limpiar</button>
        </div>
        <div class="selected-alc-grid mono">
          <div><span>Aloj. completo</span><strong>${S.fmtMXN(r.medComp)}</strong> <small>(${S.fmtSigned(r.varCompVsCdmx, 1)}% vs CDMX · n=${S.fmtInt(r.nComp)})</small></div>
          <div><span>Hab. privada</span><strong>${S.fmtMXN(r.medPriv)}</strong> <small>(${S.fmtSigned(r.varPrivVsCdmx, 1)}% vs CDMX · n=${S.fmtInt(r.nPriv)})</small></div>
          <div><span>Brecha interno</span><strong>${r.ratio.toFixed(2)}×</strong> <small>más caro el completo</small></div>
        </div>
      </div>
    `;
    document.getElementById("p1-clear-alc").addEventListener("click", () => {
      state.selectedAlcKey = null;
      refs.mapApi.setSelectedAlcaldia(null);
      syncPointsForCurrentAct();
      updateSelectedBanner();
      highlightLinkedElements();
    });
  }

  function renderActBody() {
    const S = window.Stats;
    const body = document.getElementById("p1-act-body");

    // ---------------- ACTO 1: Distribución y modalidades ----------------
    if (state.act === 1) {
      const g = metrics.globalStats;
      const comp = metrics.modByName["Alojamiento completo"];
      const priv = metrics.modByName["Habitación privada"];
      const shared = metrics.modByName["Habitación compartida"];
      const hotel = metrics.modByName["Habitación de hotel"];

      const tableRows = [
        { modalidad: "Todos los anuncios", ...g, isTotal: true },
        ...metrics.modList,
      ]
        .map(
          (m) => `
          <tr class="${m.isTotal ? "row-total" : ""}">
            <td>${m.isTotal ? "<strong>Todos los anuncios</strong>" : `<span class="swatch-inline" style="background:${MOD_COLORES[m.modalidad] || "#64748B"}"></span>${m.modalidad}`}</td>
            <td class="num">${S.fmtInt(m.n)}</td>
            <td class="num">${S.fmtMXN(m.mean)}</td>
            <td class="num">${S.fmtMXN(m.q1)}</td>
            <td class="num"><strong>${S.fmtMXN(m.median)}</strong></td>
            <td class="num">${S.fmtMXN(m.q3)}</td>
          </tr>`
        )
        .join("");

      const modChecks = metrics.modList
        .map(
          (m) => `
          <label class="mod-chip">
            <input type="checkbox" class="p1-mod-chk" value="${m.modalidad}" ${state.activeModalidades.has(m.modalidad) ? "checked" : ""} />
            <span class="swatch-inline" style="background:${MOD_COLORES[m.modalidad] || "#64748B"}"></span>
            ${m.modalidad}
          </label>`
        )
        .join("");

      body.innerHTML = `
        <div class="kpi-grid">
          <div class="kpi-card">
            <div class="kpi-label">Mediana CDMX (valor típico)</div>
            <div class="kpi-value">${S.fmtMXN(g.median)}</div>
            <div class="kpi-sub">Q1: ${S.fmtMXN(g.q1)} · Q3: ${S.fmtMXN(g.q3)}</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">Media CDMX (sensible a cola)</div>
            <div class="kpi-value">${S.fmtMXN(g.mean)}</div>
            <div class="kpi-sub">+${S.fmtPct(((g.mean / g.median) - 1) * 100, 1)} sobre la mediana</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">Alojamiento completo</div>
            <div class="kpi-value">${S.fmtMXN(comp.median)}</div>
            <div class="kpi-sub">${(comp.median / priv.median).toFixed(2)}× vs. privada · ${(comp.median / shared.median).toFixed(1)}× vs. compartida</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">Cobertura comparables</div>
            <div class="kpi-value">${S.fmtPct(metrics.pctComparables, 1)}</div>
            <div class="kpi-sub">${S.fmtInt(metrics.nComparablesTotal)} de ${S.fmtInt(g.n)} anuncios</div>
          </div>
        </div>

        <div class="card">
          <div class="card-title">Distribución del precio por noche según modalidad <span class="card-tag">Sección 4.1.1</span></div>
          ${buildBoxplotSVG()}
        </div>

        <div class="card">
          <div class="card-title">Resumen de 5 números <span class="card-tag">Calculado del CSV</span></div>
          <table class="data-table">
            <thead>
              <tr><th>Modalidad</th><th class="num">n</th><th class="num">Media</th><th class="num">Q1</th><th class="num">Mediana</th><th class="num">Q3</th></tr>
            </thead>
            <tbody>${tableRows}</tbody>
          </table>
        </div>

        <div class="card">
          <div class="card-title">Capas de puntos en el mapa real</div>
          <div class="mod-chips">${modChecks}</div>
        </div>

        <div class="card">
          <div class="card-title">Hallazgos de distribución (4.1.1)</div>
          <ul class="finding-list">
            <li><strong>Asimetría y elección de mediana:</strong> la cola derecha eleva la media (${S.fmtMXN(g.mean)}) por encima de la mediana (${S.fmtMXN(g.median)}), por lo que la mediana y los cuartiles en escala logarítmica describen mejor el mercado.</li>
            <li><strong>Separación limpia entre modalidades principales:</strong> el 75% de las habitaciones privadas cuesta menos de <strong>${S.fmtMXN(priv.q3)}</strong> (Q3), mientras que el 75% de los alojamientos completos supera <strong>${S.fmtMXN(comp.q1)}</strong> (Q1); sus cajas casi no se superponen.</li>
            <li><strong>Cautela en Habitación de hotel:</strong> tiene la mediana más alta (<strong>${S.fmtMXN(hotel.median)}</strong>), pero solo suma <strong>${S.fmtInt(hotel.n)} anuncios</strong> y una caja muy ancha (${S.fmtMXN(hotel.q1)} a ${S.fmtMXN(hotel.q3)}), por lo que su valor típico es poco representativo.</li>
          </ul>
        </div>
      `;

      body.querySelectorAll(".p1-mod-chk").forEach((chk) => {
        chk.addEventListener("change", () => {
          if (chk.checked) state.activeModalidades.add(chk.value);
          else state.activeModalidades.delete(chk.value);
          syncPointsForCurrentAct();
        });
      });
      return;
    }

    // ---------------- ACTO 2: Alcaldías frente a CDMX ----------------
    if (state.act === 2) {
      const topComp = metrics.alcList[0];
      const botComp = metrics.alcList[metrics.alcList.length - 1];
      const byPriv = [...metrics.alcList].sort((a, b) => b.medPriv - a.medPriv);
      const topPriv = byPriv[0];
      const botPriv = byPriv[byPriv.length - 1];
      const lowNAlcs = metrics.alcList.filter((a) => a.isLowN);

      body.innerHTML = `
        <div class="card">
          <div class="card-title">Mapa coroplético por alcaldía <span class="card-tag">Mediana (coherente 4.1)</span></div>
          <div class="segmented" role="group" aria-label="Métrica del mapa coroplético">
            <button class="seg-btn ${state.choroMode === "completo" ? "active" : ""}" data-mode="completo">Aloj. completo</button>
            <button class="seg-btn ${state.choroMode === "privada" ? "active" : ""}" data-mode="privada">Hab. privada</button>
            <button class="seg-btn ${state.choroMode === "global" ? "active" : ""}" data-mode="global">Global CDMX</button>
          </div>
          <div class="toggles-row" style="margin-top:8px;padding-top:7px;">
            <label><input type="checkbox" id="p1-chk-allpts" ${state.showAllPointsInChoro ? "checked" : ""} /> Mostrar todos los puntos sobre el mapa</label>
          </div>
        </div>

        <div id="p1-selected-box"></div>

        <div class="kpi-grid">
          <div class="kpi-card">
            <div class="kpi-label">Líder en completos</div>
            <div class="kpi-value">${S.fmtMXN(topComp.medComp)}</div>
            <div class="kpi-sub">${topComp.alcaldia} (${S.fmtSigned(topComp.varCompVsCdmx, 1)}% vs CDMX)</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">Menor mediana en completos</div>
            <div class="kpi-value">${S.fmtMXN(botComp.medComp)}</div>
            <div class="kpi-sub">${botComp.alcaldia} (${S.fmtSigned(botComp.varCompVsCdmx, 1)}% vs CDMX)</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">Líder en privadas</div>
            <div class="kpi-value">${S.fmtMXN(topPriv.medPriv)}</div>
            <div class="kpi-sub">${topPriv.alcaldia} (${S.fmtSigned(topPriv.varPrivVsCdmx, 1)}% vs CDMX)</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">Menor mediana en privadas</div>
            <div class="kpi-value">${S.fmtMXN(botPriv.medPriv)}</div>
            <div class="kpi-sub">${botPriv.alcaldia} (${S.fmtSigned(botPriv.varPrivVsCdmx, 1)}% vs CDMX)</div>
          </div>
        </div>

        <div class="card">
          <div class="card-title">Precio por alcaldía: completos y privadas <span class="card-tag">Sección 4.1.2</span></div>
          <div id="p1-intervals-wrap">${buildIntervalsSVG()}</div>
        </div>

        <div class="card">
          <div class="card-title">Hallazgos territoriales (4.1.2)</div>
          <ul class="finding-list">
            <li><strong>Mismo liderazgo en ambas modalidades:</strong> ${metrics.alcList.slice(0, 3).map((a) => `<strong>${a.alcaldia}</strong>`).join(", ")} encabezan tanto en alojamientos completos como en habitaciones privadas, mientras <strong>${botComp.alcaldia}</strong> registra las medianas más bajas en ambas.</li>
            <li><strong>Traslape interno:</strong> las barras Q1–Q3 son anchas y se superponen entre varias alcaldías intermedias; solo las diferencias entre los extremos del ranking son contundentes.</li>
            <li><strong>Cautela muestral (n &lt; ${LOW_N_THRESHOLD}):</strong> ${lowNAlcs.length ? lowNAlcs.map((a) => `<strong>${a.alcaldia}</strong> (n=${S.fmtInt(a.nComparables)})`).join(" y ") : "ninguna alcaldía"} cumplen el umbral mínimo (<code>MIN_N = ${MIN_N}</code>), pero sus medianas deben leerse con reserva y se señalan con borde punteado.</li>
          </ul>
        </div>
      `;

      body.querySelectorAll(".seg-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          state.choroMode = btn.dataset.mode;
          body.querySelectorAll(".seg-btn").forEach((b) => b.classList.toggle("active", b === btn));
          refs.mapApi.refreshChoroplethStyles();
          syncPointsForCurrentAct();
          renderLegend();
        });
      });;

      document.getElementById("p1-chk-allpts").addEventListener("change", (e) => {
        state.showAllPointsInChoro = e.target.checked;
        syncPointsForCurrentAct();
      });

      bindLinkedRowEvents(document.getElementById("p1-intervals-wrap"));
      updateSelectedBanner();
      highlightLinkedElements();
      return;
    }

    // ---------------- ACTO 3: Brecha entre tipos y peso de la ubicación ----------------
    const byRatio = [...metrics.alcList].sort((a, b) => b.ratio - a.ratio);
    const maxRatioAlc = byRatio[0];
    const minRatioAlc = byRatio[byRatio.length - 1];
    const over2x = byRatio.filter((a) => a.ratio >= 2.0);

    const compMax = metrics.alcList[0];
    const compMin = metrics.alcList[metrics.alcList.length - 1];
    const compSpread = compMax.medComp / compMin.medComp;

    const privSorted = [...metrics.alcList].sort((a, b) => b.medPriv - a.medPriv);
    const privMax = privSorted[0];
    const privMin = privSorted[privSorted.length - 1];
    const privSpread = privMax.medPriv / privMin.medPriv;

    const tableRows = metrics.alcList
      .map(
        (r) => `
        <tr class="clickable-row" data-alc-key="${r.key}">
          <td>${r.alcaldia}${r.isLowN ? ' <span class="low-n-dot" title="Muestra pequeña">n bajo</span>' : ""}</td>
          <td class="num">${S.fmtInt(r.nComp)}</td>
          <td class="num">${S.fmtMXN(r.medComp)}</td>
          <td class="num">${S.fmtInt(r.nPriv)}</td>
          <td class="num">${S.fmtMXN(r.medPriv)}</td>
          <td class="num"><strong>${r.ratio.toFixed(2)}×</strong></td>
        </tr>`
      )
      .join("");

    body.innerHTML = `
      <div class="card">
        <div class="card-title">Peso de la ubicación: amplitud geográfica <span class="card-tag">Máximo / mínimo entre alcaldías</span></div>
        <div class="spread-grid">
          <div class="spread-box">
            <div class="kpi-label">Alojamiento completo</div>
            <div class="kpi-value" style="color:#1E3A5F">${compSpread.toFixed(2)}×</div>
            <div class="kpi-sub">${S.fmtMXN(compMin.medComp)} (${compMin.alcaldia}) &rarr; ${S.fmtMXN(compMax.medComp)} (${compMax.alcaldia})</div>
          </div>
          <div class="spread-box">
            <div class="kpi-label">Habitación privada</div>
            <div class="kpi-value" style="color:#B84A39">${privSpread.toFixed(2)}×</div>
            <div class="kpi-sub">${S.fmtMXN(privMin.medPriv)} (${privMin.alcaldia}) &rarr; ${S.fmtMXN(privMax.medPriv)} (${privMax.alcaldia})</div>
          </div>
        </div>
        <div class="toggles-row" style="margin-top:8px;padding-top:7px;">
          <label><input type="checkbox" id="p1-chk-allpts" ${state.showAllPointsInChoro ? "checked" : ""} /> Mostrar todos los puntos sobre el mapa</label>
        </div>
      </div>

      <div id="p1-selected-box"></div>

      <div class="card">
        <div class="card-title">Brecha interno (# veces más caro: Completo vs. Privada) <span class="card-tag">${over2x.length} alcaldías &ge; 2×</span></div>
        <div id="p1-ratio-wrap">${buildRatioSVG()}</div>
      </div>

      <div class="card">
        <div class="card-title">Tabla completa por alcaldía <span class="card-tag">Clic en fila = ver puntos</span></div>
        <div class="table-scroll">
          <table class="data-table" id="p1-alc-table">
            <thead>
              <tr><th>Alcaldía</th><th class="num">n C.</th><th class="num">Med. C.</th><th class="num">n P.</th><th class="num">Med. P.</th><th class="num">Veces</th></tr>
            </thead>
            <tbody>${tableRows}</tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <div class="card-title">Conclusión integrada de la Pregunta 1</div>
        <ul class="finding-list">
          <li><strong>La ubicación pesa más en completos:</strong> la mediana entre alcaldías varía <strong>${compSpread.toFixed(2)}×</strong> en alojamientos completos frente a <strong>${privSpread.toFixed(2)}×</strong> en habitaciones privadas.</li>
          <li><strong>Brecha desigual entre modalidades:</strong> el alojamiento completo es más caro en las 16 alcaldías, desde <strong>${minRatioAlc.ratio.toFixed(2)}×</strong> (${minRatioAlc.alcaldia}) hasta <strong>${maxRatioAlc.ratio.toFixed(2)}×</strong> (${maxRatioAlc.alcaldia}), superando el doble en ${over2x.map((a) => a.alcaldia).join(", ")}.</li>
          <li><strong>Alcance del cruce:</strong> se compararon los <strong>${S.fmtInt(metrics.nComparablesTotal)} anuncios (${S.fmtPct(metrics.pctComparables, 1)})</strong> de completos y privadas; alcaldías excluidas por <code>n &lt; ${MIN_N}</code>: <strong>${metrics.alcExcluidas.length ? metrics.alcExcluidas.join(", ") : "ninguna (0)"}</strong>.</li>
        </ul>
      </div>
    `;

    document.getElementById("p1-chk-allpts").addEventListener("change", (e) => {
      state.showAllPointsInChoro = e.target.checked;
      syncPointsForCurrentAct();
    });

    bindLinkedRowEvents(document.getElementById("p1-ratio-wrap"));
    bindLinkedRowEvents(document.getElementById("p1-alc-table"));
    updateSelectedBanner();
    highlightLinkedElements();
  }

  function applyAct(actNum) {
    state.act = actNum;
    state.selectedAlcKey = null;
    state.hoveredAlcKey = null;
    refs.mapApi.closePopups();
    refs.mapApi.setSelectedAlcaldia(null);
    refs.mapApi.setHoveredAlcaldia(null);

    document.querySelectorAll(".p1-act-btn").forEach((b) => {
      b.classList.toggle("active", Number(b.dataset.act) === actNum);
    });
    renderActBody();
    syncMap();
  }

  function renderShell() {
    refs.panelEl.innerHTML = `
      <div class="section-header">
        <span class="eyebrow">Pregunta 1 · Distribución y alcaldías</span>
        <h1>Precio por noche, modalidades y brechas por alcaldía</h1>
        <p class="subtitle">
          Réplica interactiva de la sección 4.1 calculada en vivo desde <code>shared/datos_analisis.csv</code> (mediana, cuartiles y escala logarítmica).
        </p>
      </div>

      <div class="acts-grid cols-3" role="tablist" aria-label="Secuencia narrativa Pregunta 1">
        <button class="act-btn p1-act-btn active" data-act="1"><span class="act-step">Acto 1</span><span class="act-label">Modalidades</span></button>
        <button class="act-btn p1-act-btn" data-act="2"><span class="act-step">Acto 2</span><span class="act-label">Alcaldías vs CDMX</span></button>
        <button class="act-btn p1-act-btn" data-act="3"><span class="act-step">Acto 3</span><span class="act-label">Brecha (# veces)</span></button>
      </div>

      <div id="p1-act-body" class="p1-act-body"></div>
    `;

    document.querySelectorAll(".p1-act-btn").forEach((btn) => {
      btn.addEventListener("click", () => applyAct(Number(btn.dataset.act)));
    });
  }

  function showLoadFallback(errMsg) {
    refs.panelEl.innerHTML = `
      <div class="section-header">
        <span class="eyebrow">Pregunta 1 · Carga de datos</span>
        <h1>No se pudo leer automáticamente el CSV maestro</h1>
      </div>
      <div class="callout warn">
        <strong>Motivo:</strong> ${errMsg}<br /><br />
        Ejecuta <code>python -m http.server 8000</code> dentro de <code>proyecto_airbnb_cdmx/</code>
        y abre <code>http://localhost:8000/main.html</code>.
      </div>
      <div class="card">
        <div class="card-title">Alternativa rápida sin servidor local</div>
        <p class="subtitle">Selecciona tu archivo <code>shared/datos_analisis.csv</code>:</p>
        <input type="file" id="p1-file-input" accept=".csv" class="file-fallback" />
      </div>
    `;

    document.getElementById("p1-file-input").addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      allRows = await window.DataStore.loadFromFile(file);
      computeMetrics(allRows);
      state.activeModalidades = new Set(metrics.modList.map((m) => m.modalidad));
      renderShell();
      applyAct(1);
    });
  }

  async function mount(ctx) {
    refs = ctx;
    refs.panelEl.innerHTML = `<div class="loading-box">Leyendo <code>${window.DataStore.CSV_PATH}</code> y calculando estadísticas de Pregunta 1...</div>`;

    try {
      if (!allRows.length) {
        allRows = await window.DataStore.load();
        computeMetrics(allRows);
        state.activeModalidades = new Set(metrics.modList.map((m) => m.modalidad));
      }
      renderShell();
      applyAct(state.act);
    } catch (err) {
      showLoadFallback(err.message);
    }
  }

  function unmount() {
    renderToken++;
    state.selectedAlcKey = null;
    state.hoveredAlcKey = null;
    if (refs.mapApi) {
      refs.mapApi.closePopups();
      refs.mapApi.clearChoropleth();
      refs.mapApi.clearOverlays();
    }
  }

  return { mount, unmount };
})();

if (window.AppShell) window.AppShell.register("p1", window.Pregunta1);