window.Pregunta4 = (() => {
  const MIN_N_CORR = 3;      // Mínimo para definir Spearman en celda (sección 4.4)
  const MIN_N_RELIABLE = 30; // Umbral de confiabilidad por celda en Figura 9

  const LEVEL_COLORS = ["#94A3B8", "#5B84B1", "#1E3A5F", "#B84A39"];
  const RATING_BUCKETS = [
    { label: "< 4.50", color: "#B84A39", test: (v) => v < 4.5 },
    { label: "4.50 – 4.79", color: "#8B6D3F", test: (v) => v >= 4.5 && v < 4.8 },
    { label: "4.80 – 4.94", color: "#4E79A7", test: (v) => v >= 4.8 && v < 4.95 },
    { label: "4.95 – 5.00", color: "#1E3A5F", test: (v) => v >= 4.95 },
  ];

  let allRows = [];
  let calRows = [];
  let metrics = null;
  let refs = { panelEl: null, legendEl: null, mapApi: null, store: null };
  let renderToken = 0;

  const state = {
    act: 1,
    boxZoom: false,            // false: escala 1–5 | true: zoom 4.0–5.0
    mapColorBy: "calificacion", // Actos 1 y 2: "calificacion" | "nivel"
    activeLevelIdx: 0,         // Acto 3: arranca en 0 (1–9 reseñas)
    muteLowN: false,           // Acto 3: atenuar celdas con n < 30
    selectedAlcKey: null,
    hoveredAlcKey: null,
    showAllPointsInChoro: false,
  };

  // Escala divergente sobria (-1 azul -> 0 neutro -> +1 rojo terracota)
  function corrColor(val, muted = false) {
    if (!Number.isFinite(val)) return "#1E293B"; // NA (n < 3)
    const v = Math.max(-1, Math.min(1, val));
    const scale = muted ? 0.32 : 1.0;
    const t = Math.abs(v) * scale;
    const neutral = [238, 241, 245];
    const target = v >= 0 ? [184, 58, 50] : [43, 91, 158];
    const r = Math.round(neutral[0] + (target[0] - neutral[0]) * t);
    const g = Math.round(neutral[1] + (target[1] - neutral[1]) * t);
    const b = Math.round(neutral[2] + (target[2] - neutral[2]) * t);
    return `rgb(${r}, ${g}, ${b})`;
  }

  function boxSummary(values) {
    const S = window.Stats;
    const s = S.sortedNumbers(values);
    const n = s.length;
    if (!n) {
      return { n: 0, mean: NaN, median: NaN, q1: NaN, q3: NaN, ric: NaN, wLow: NaN, wHigh: NaN, pctUnder45: NaN, outliers: [] };
    }
    const q1 = S.quantileSorted(s, 0.25);
    const median = S.quantileSorted(s, 0.5);
    const q3 = S.quantileSorted(s, 0.75);
    const ric = q3 - q1;
    const lowFence = q1 - 1.5 * ric;
    const highFence = q3 + 1.5 * ric;

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

    let under45 = 0;
    for (let i = 0; i < n; i++) if (s[i] < 4.5) under45++;

    const rawOut = s.filter((v) => v < wLow || v > wHigh);
    const maxDots = 65;
    let outliers = rawOut;
    if (rawOut.length > maxDots) {
      outliers = [];
      const step = (rawOut.length - 1) / (maxDots - 1);
      for (let i = 0; i < maxDots; i++) outliers.push(rawOut[Math.round(i * step)]);
    }

    return {
      n,
      mean: S.mean(s),
      median,
      q1,
      q3,
      ric,
      wLow,
      wHigh,
      pctUnder45: (under45 / n) * 100,
      outliers,
    };
  }

  function corrPair(subset) {
    const S = window.Stats;
    const xs = [];
    const ys = [];
    for (let i = 0; i < subset.length; i++) {
      const r = subset[i];
      if (Number.isFinite(r.log_precio) && Number.isFinite(r.calificacion)) {
        xs.push(r.log_precio);
        ys.push(r.calificacion);
      }
    }
    return {
      n: xs.length,
      spearman: xs.length >= MIN_N_CORR ? S.spearman(xs, ys) : NaN,
      pearson: xs.length >= MIN_N_CORR ? S.pearson(xs, ys) : NaN,
    };
  }

  function computeMetrics(rows) {
    const S = window.Stats;
    const rated = rows.filter((r) => Number.isFinite(r.calificacion));

    // Cuartiles enteros de number_of_reviews (equivalente exacto a quantile([.25,.5,.75]).astype(int))
    const revSorted = S.sortedNumbers(rated.map((r) => r.resenas));
    const c1 = Math.trunc(S.quantileSorted(revSorted, 0.25));
    const c2 = Math.trunc(S.quantileSorted(revSorted, 0.50));
    const c3 = Math.trunc(S.quantileSorted(revSorted, 0.75));

    const levels = [
      { idx: 0, label: `1–${c1}`, test: (n) => n > 0 && n <= c1 },
      { idx: 1, label: `${c1 + 1}–${c2}`, test: (n) => n > c1 && n <= c2 },
      { idx: 2, label: `${c2 + 1}–${c3}`, test: (n) => n > c2 && n <= c3 },
      { idx: 3, label: `${c3 + 1} o más`, test: (n) => n > c3 },
    ];

    const annotated = [];
    const byLevel = [[], [], [], []];

    for (let i = 0; i < rated.length; i++) {
      const r = rated[i];
      let lv = -1;
      for (let j = 0; j < levels.length; j++) {
        if (levels[j].test(r.resenas)) {
          lv = j;
          break;
        }
      }
      if (lv === -1) continue;
      const item = { ...r, nivelIdx: lv, nivelLabel: levels[lv].label };
      annotated.push(item);
      byLevel[lv].push(item);
    }

    calRows = annotated;

    // 1. Resumen por nivel de reseñas (Acto 1)
    const levelStats = levels.map((lv) => {
      const sub = byLevel[lv.idx];
      return {
        idx: lv.idx,
        label: lv.label,
        ...boxSummary(sub.map((r) => r.calificacion)),
      };
    });

    // 2. Correlaciones globales y por nivel (Acto 2)
    const globalCorr = { label: "Todos", isGlobal: true, ...corrPair(calRows) };
    const levelCorrs = levels.map((lv) => ({
      idx: lv.idx,
      label: lv.label,
      isGlobal: false,
      ...corrPair(byLevel[lv.idx]),
    }));

    // 3. Matriz 16 alcaldías × 4 niveles de reseñas (Acto 3 - Figura 9)
    const alcMap = {};
    calRows.forEach((r) => {
      const k = r.alcaldia_key;
      if (!alcMap[k]) {
        alcMap[k] = { key: k, alcaldia: r.alcaldia, totalN: 0, buckets: [[], [], [], []] };
      }
      alcMap[k].totalN++;
      alcMap[k].buckets[r.nivelIdx].push(r);
    });

    let definedCells = 0;
    let lowNCells = 0;

    const alcMatrix = Object.values(alcMap)
      .sort((a, b) => b.totalN - a.totalN)
      .map((a) => {
        const cells = levels.map((lv) => {
          const sub = a.buckets[lv.idx];
          const c = corrPair(sub);
          const defined = Number.isFinite(c.spearman);
          if (defined) definedCells++;
          if (sub.length < MIN_N_RELIABLE) lowNCells++;
          return {
            idx: lv.idx,
            label: lv.label,
            n: sub.length,
            rho: c.spearman,
            defined,
            lowN: sub.length < MIN_N_RELIABLE,
          };
        });
        return { key: a.key, alcaldia: a.alcaldia, totalN: a.totalN, cells };
      });

    const alcByKey = {};
    alcMatrix.forEach((a) => (alcByKey[a.key] = a));

    metrics = {
      totalAll: rows.length,
      totalCal: calRows.length,
      pctCal: (calRows.length / rows.length) * 100,
      cuts: [c1, c2, c3],
      levels,
      levelStats,
      globalCorr,
      levelCorrs,
      allCorrs: [globalCorr, ...levelCorrs],
      alcMatrix,
      alcByKey,
      totalCells: alcMatrix.length * levels.length,
      definedCells,
      lowNCells,
    };
  }

  function pointPopupHtml(p) {
    const S = window.Stats;
    return `
      <div class="popup-title">${p.alcaldia}</div>
      <div class="popup-grid">
        <span class="popup-k">Calificación</span><span class="popup-v">${p.calificacion.toFixed(2)} / 5.00</span>
        <span class="popup-k">Reseñas</span><span class="popup-v">${S.fmtInt(p.resenas)} (${p.nivelLabel})</span>
        <span class="popup-k">Precio / noche</span><span class="popup-v">${S.fmtMXN(p.precio, 2)} MXN</span>
        <span class="popup-k">Modalidad</span><span class="popup-v">${p.modalidad}</span>
      </div>
    `;
  }

  function ratingColor(v) {
    for (let i = 0; i < RATING_BUCKETS.length; i++) {
      if (RATING_BUCKETS[i].test(v)) return RATING_BUCKETS[i].color;
    }
    return "#64748B";
  }

  function syncPointsForCurrentAct() {
    if (state.act !== 3) {
      const colorFn =
        state.mapColorBy === "nivel"
          ? (p) => LEVEL_COLORS[p.nivelIdx] || "#64748B"
          : (p) => ratingColor(p.calificacion);
      refs.mapApi.setPoints(calRows, {
        colorFn,
        radiusFn: (p) => (state.mapColorBy === "calificacion" && p.calificacion < 4.5 ? 2.5 : 1.9),
        alphaFn: (p) => (state.mapColorBy === "calificacion" && p.calificacion < 4.5 ? 0.68 : 0.42),
        popupFn: pointPopupHtml,
      });
      return;
    }

    // Acto 3: coroplético limpio; puntos del nivel activo solo al seleccionar alcaldía o activar checkbox
    let pts = [];
    if (state.showAllPointsInChoro) {
      pts = calRows.filter((r) => r.nivelIdx === state.activeLevelIdx);
    } else if (state.selectedAlcKey) {
      pts = calRows.filter(
        (r) => r.alcaldia_key === state.selectedAlcKey && r.nivelIdx === state.activeLevelIdx
      );
    }

    refs.mapApi.setPoints(pts, {
      colorFn: (p) => ratingColor(p.calificacion),
      radiusFn: () => (state.selectedAlcKey && !state.showAllPointsInChoro ? 2.6 : 1.9),
      alphaFn: () => (state.selectedAlcKey && !state.showAllPointsInChoro ? 0.72 : 0.42),
      popupFn: pointPopupHtml,
    });
  }

  function tooltipHtmlForAlcaldia(key, rawName) {
    const S = window.Stats;
    const rec = metrics.alcByKey[key];
    if (!rec) return `<div class="choro-tt-title">${rawName}</div><div>Sin anuncios con calificación</div>`;
    const cell = rec.cells[state.activeLevelIdx];
    const rhoTxt = cell.defined ? S.fmtSigned(cell.rho, 2) : `No definido (n=${cell.n})`;
    const warn = cell.lowN
      ? `<div style="margin-top:4px;color:#FCD34D;font-size:10.5px;">⚠ Menos de ${MIN_N_RELIABLE} anuncios en este nivel</div>`
      : "";

    return `
      <div class="choro-tt-title">${rec.alcaldia}</div>
      <div class="choro-tt-row"><span class="choro-tt-k">Nivel reseñas</span><span class="choro-tt-v">${cell.label}</span></div>
      <div class="choro-tt-row"><span class="choro-tt-k">Spearman (ρ)</span><span class="choro-tt-v">${rhoTxt}</span></div>
      <div class="choro-tt-row"><span class="choro-tt-k">Anuncios celda</span><span class="choro-tt-v">n = ${S.fmtInt(cell.n)}</span></div>
      <div class="choro-tt-row"><span class="choro-tt-k">Total con calif.</span><span class="choro-tt-v">${S.fmtInt(rec.totalN)}</span></div>
      ${warn}
    `;
  }

  async function syncMap() {
    const token = ++renderToken;

    if (state.act !== 3) {
      refs.mapApi.clearChoropleth();
      syncPointsForCurrentAct();
      renderLegend();
      return;
    }

    await refs.mapApi.setChoropleth({
      selectedKey: state.selectedAlcKey,
      styleFn: (key, _rawName, { isSelected, isHovered }) => {
        const rec = metrics.alcByKey[key];
        const cell = rec ? rec.cells[state.activeLevelIdx] : null;
        const defined = cell && cell.defined;
        const lowN = !cell || cell.lowN;
        const muted = state.muteLowN && lowN;

        return {
          fillColor: defined ? corrColor(cell.rho, muted) : "#CBD5E1",
          fillOpacity: !defined ? 0.35 : muted ? 0.32 : isSelected ? 0.56 : isHovered ? 0.72 : 0.62,
          color: isSelected ? "#0F172A" : isHovered ? "#1E293B" : lowN ? "#8B6D3F" : "#FFFFFF",
          weight: isSelected ? 2.8 : isHovered ? 2.0 : lowN ? 1.7 : 1.1,
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

    if (state.act !== 3) {
      const header = `
        <div class="legend-title">Colorear puntos (n=${S.fmtInt(metrics.totalCal)})</div>
        <div class="map-color-pills">
          <button class="map-pill-btn ${state.mapColorBy === "calificacion" ? "active" : ""}" data-color="calificacion">Calificación</button>
          <button class="map-pill-btn ${state.mapColorBy === "nivel" ? "active" : ""}" data-color="nivel">Nivel reseñas</button>
        </div>
      `;

      const items =
        state.mapColorBy === "nivel"
          ? metrics.levelStats
              .map(
                (lv) => `
                <div class="legend-item">
                  <span class="legend-left"><span class="swatch" style="background:${LEVEL_COLORS[lv.idx]}"></span>${lv.label}</span>
                  <span class="mono">${S.fmtInt(lv.n)}</span>
                </div>`
              )
              .join("")
          : RATING_BUCKETS.map(
              (b) => `
              <div class="legend-item">
                <span class="legend-left"><span class="swatch" style="background:${b.color}"></span>${b.label}</span>
              </div>`
            ).join("");

      el.innerHTML = header + items;
      el.querySelectorAll(".map-pill-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          state.mapColorBy = btn.dataset.color;
          syncPointsForCurrentAct();
          renderLegend();
        });
      });
      return;
    }

    const activeLabel = metrics.levels[state.activeLevelIdx].label;
    el.innerHTML = `
      <div class="legend-title">Spearman ρ · Nivel ${activeLabel}</div>
      <div class="legend-gradient" style="background:linear-gradient(90deg, #2B5B9E 0%, #EEF1F5 50%, #B83A32 100%)"></div>
      <div class="legend-scale mono"><span>-1.0</span><span>0.0</span><span>+1.0</span></div>
      <div class="legend-note"><span class="dashed-sample"></span> Borde punteado: celda con n &lt; ${MIN_N_RELIABLE}</div>
      <div class="svg-footnote" style="margin-top:2px;">Gris plano: sin coeficiente (n &lt; ${MIN_N_CORR}).</div>
    `;
  }

  // --- SVG Acto 1: Boxplot de calificación por nivel de reseñas (con zoom 1–5 / 4.0–5.0) ---
  function buildRatingBoxplotSVG() {
    const S = window.Stats;
    const W = 490;
    const H = 238;
    const pad = { top: 14, right: 16, bottom: 38, left: 46 };
    const plotW = W - pad.left - pad.right;
    const plotH = H - pad.top - pad.bottom;

    const yMin = state.boxZoom ? 3.95 : 0.85;
    const yMax = 5.06;
    const yOf = (v) => pad.top + ((yMax - v) / (yMax - yMin)) * plotH;

    const ticks = state.boxZoom
      ? [4.0, 4.2, 4.4, 4.5, 4.6, 4.8, 5.0]
      : [1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0];

    const grid = ticks
      .map((t) => {
        const y = yOf(t);
        const is45 = Math.abs(t - 4.5) < 0.001;
        return `
          <line x1="${pad.left}" y1="${y}" x2="${W - pad.right}" y2="${y}"
                stroke="${is45 ? "#B84A39" : "#E2E8F0"}" stroke-width="${is45 ? 1.15 : 1}"
                ${is45 ? 'stroke-dasharray="4 3"' : ""} />
          <text x="${pad.left - 7}" y="${y + 3.5}" text-anchor="end" class="svg-axis-txt">${t.toFixed(1)}</text>
        `;
      })
      .join("");

    const colW = plotW / metrics.levelStats.length;
    const boxW = Math.min(54, colW * 0.46);

    const boxes = metrics.levelStats
      .map((lv, i) => {
        const cx = pad.left + colW * (i + 0.5);
        const yQ1 = yOf(Math.max(yMin, lv.q1));
        const yQ3 = yOf(Math.min(yMax, lv.q3));
        const yMed = yOf(lv.median);
        const yMean = yOf(lv.mean);
        const yLow = yOf(Math.max(yMin, lv.wLow));
        const yHigh = yOf(Math.min(yMax, lv.wHigh));

        const dots = lv.outliers
          .filter((v) => v >= yMin)
          .map((v, k) => {
            const j = ((k % 5) - 2) * 1.3;
            return `<circle cx="${(cx + j).toFixed(1)}" cy="${yOf(v).toFixed(1)}" r="1.4" fill="#334155" fill-opacity="0.38" />`;
          })
          .join("");

        // Triángulo naranja para la media (fiel a showmeans=True del notebook)
        const tri = `${cx},${yMean - 4.5} ${cx - 4.2},${yMean + 3.5} ${cx + 4.2},${yMean + 3.5}`;

        return `
          <g>
            <title>Reseñas ${lv.label} (n=${S.fmtInt(lv.n)})&#10;Mediana: ${lv.median.toFixed(2)}&#10;Media: ${lv.mean.toFixed(2)}&#10;Q1–Q3: ${lv.q1.toFixed(2)} – ${lv.q3.toFixed(2)} (RIC ${lv.ric.toFixed(2)})&#10;Menores a 4.5: ${lv.pctUnder45.toFixed(2)}%</title>
            ${dots}
            <line x1="${cx}" y1="${yHigh}" x2="${cx}" y2="${yLow}" stroke="#1E3A5F" stroke-width="1.4" />
            <line x1="${cx - boxW * 0.28}" y1="${yHigh}" x2="${cx + boxW * 0.28}" y2="${yHigh}" stroke="#1E3A5F" stroke-width="1.4" />
            ${lv.wLow >= yMin ? `<line x1="${cx - boxW * 0.28}" y1="${yLow}" x2="${cx + boxW * 0.28}" y2="${yLow}" stroke="#1E3A5F" stroke-width="1.4" />` : ""}
            <rect x="${cx - boxW / 2}" y="${yQ3}" width="${boxW}" height="${Math.max(2, yQ1 - yQ3)}"
                  fill="#4E79A7" fill-opacity="0.82" rx="2" stroke="#1E3A5F" stroke-width="1" />
            <line x1="${cx - boxW / 2}" y1="${yMed}" x2="${cx + boxW / 2}" y2="${yMed}" stroke="#FFFFFF" stroke-width="2.1" />
            <polygon points="${tri}" fill="#E67E22" stroke="#FFFFFF" stroke-width="0.7" />
            <text x="${cx}" y="${H - 18}" text-anchor="middle" class="svg-cat-txt">${lv.label}</text>
            <text x="${cx}" y="${H - 6}" text-anchor="middle" class="svg-sub-txt">n=${S.fmtInt(lv.n)}</text>
          </g>
        `;
      })
      .join("");

    return `
      <div class="svg-inline-legend">
        <span><i class="line-white-sample"></i> Mediana</span>
        <span><i class="tri-sample"></i> Media</span>
        <span style="color:#B84A39;">--- Umbral 4.5</span>
      </div>
      <svg viewBox="0 0 ${W} ${H}" class="p1-svg" role="img" aria-label="Boxplot de calificación según número de reseñas">
        ${grid}
        ${boxes}
      </svg>
      <div class="svg-footnote">
        ${state.boxZoom ? "Vista ampliada 4.0–5.0 para observar la contracción del RIC (los valores extremos inferiores quedan debajo del corte)." : "Escala completa 1.0–5.0 mostrando la cola de calificaciones bajas concentrada en 1–9 reseñas."}
      </div>
    `;
  }

  // --- SVG Acto 2: Barras agrupadas Spearman vs Pearson (log_precio) ---
  function buildCorrComparisonSVG() {
    const S = window.Stats;
    const list = metrics.allCorrs;
    const rowH = 38;
    const pad = { top: 10, right: 48, bottom: 26, left: 82 };
    const W = 490;
    const H = pad.top + list.length * rowH + pad.bottom;
    const plotW = W - pad.left - pad.right;

    const allVals = list.flatMap((d) => [d.spearman, d.pearson]).filter(Number.isFinite);
    const maxV = Math.max(0.35, ...allVals.map((v) => v + 0.05));
    const xOf = (v) => pad.left + (Math.max(0, v) / maxV) * plotW;

    const ticks = [0, 0.05, 0.10, 0.15, 0.20, 0.25, 0.30, 0.35].filter((t) => t <= maxV + 0.005);
    const grid = ticks
      .map((t) => {
        const x = xOf(t);
        return `
          <line x1="${x}" y1="${pad.top}" x2="${x}" y2="${H - pad.bottom}" stroke="${t === 0 ? "#334155" : "#E2E8F0"}" stroke-width="${t === 0 ? 1.3 : 1}" />
          <text x="${x}" y="${H - 7}" text-anchor="middle" class="svg-axis-txt">${t.toFixed(2)}</text>
        `;
      })
      .join("");

    // Línea de referencia del Spearman global
    const xGlobalSp = xOf(metrics.globalCorr.spearman);
    const refLine = `
      <line x1="${xGlobalSp}" y1="${pad.top}" x2="${xGlobalSp}" y2="${H - pad.bottom}"
            stroke="#1E3A5F" stroke-width="1.1" stroke-dasharray="4 3" opacity="0.65" />
    `;

    const bars = list
      .map((d, i) => {
        const yTop = pad.top + i * rowH;
        const ySp = yTop + 6;
        const yPe = yTop + 19;
        const wSp = Math.max(2, xOf(d.spearman) - pad.left);
        const wPe = Math.max(2, xOf(d.pearson) - pad.left);

        return `
          <g>
            ${d.isGlobal ? `<rect x="0" y="${yTop}" width="${W}" height="${rowH - 2}" fill="#F8FAFC" rx="3" />` : ""}
            <text x="${pad.left - 8}" y="${yTop + 16}" text-anchor="end" class="svg-row-lbl" style="font-weight:${d.isGlobal ? 700 : 600}">${d.label}</text>
            <text x="${pad.left - 8}" y="${yTop + 28}" text-anchor="end" class="svg-sub-txt">n=${S.fmtInt(d.n)}</text>
            <rect x="${pad.left}" y="${ySp}" width="${wSp}" height="10" rx="2" fill="#1E3A5F" fill-opacity="0.9" />
            <text x="${pad.left + wSp + 5}" y="${ySp + 8.5}" class="svg-val-txt">${d.spearman.toFixed(2)}</text>
            <rect x="${pad.left}" y="${yPe}" width="${wPe}" height="10" rx="2" fill="#B84A39" fill-opacity="0.82" />
            <text x="${pad.left + wPe + 5}" y="${yPe + 8.5}" class="svg-val-txt" style="fill:#991B1B">${d.pearson.toFixed(2)}</text>
          </g>
        `;
      })
      .join("");

    return `
      <div class="svg-inline-legend">
        <span><i class="dot" style="background:#1E3A5F"></i> Spearman (ρ)</span>
        <span><i class="dot" style="background:#B84A39"></i> Pearson (r, log₁₀ precio)</span>
      </div>
      <svg viewBox="0 0 ${W} ${H}" class="p1-svg" role="img" aria-label="Spearman y Pearson por nivel de reseñas">
        ${grid}
        ${refLine}
        ${bars}
      </svg>
      <div class="svg-footnote">
        Línea punteada vertical: Spearman global (${metrics.globalCorr.spearman.toFixed(2)}). Mezclar anuncios con pocas reseñas diluye el coeficiente general.
      </div>
    `;
  }

  // --- Acto 3: Figura 9 (Heatmap 16 × 4 sincronizado con el mapa coroplético) ---
  function buildHeatmapHTML() {
    const S = window.Stats;

    const headCols = metrics.levels
      .map(
        (lv) => `
        <th class="hm-col-head ${state.activeLevelIdx === lv.idx ? "active-col" : ""}" data-level-idx="${lv.idx}" title="Clic para mostrar esta columna en el mapa">
          ${lv.label}
        </th>`
      )
      .join("");

    const rowsHtml = metrics.alcMatrix
      .map((a) => {
        const shortName =
          a.alcaldia === "La Magdalena Contreras"
            ? "Magdalena Contreras"
            : a.alcaldia === "Cuajimalpa de Morelos"
              ? "Cuajimalpa"
              : a.alcaldia;

        const cellsHtml = a.cells
          .map((c) => {
            const isActiveCol = state.activeLevelIdx === c.idx;
            const isMuted = state.muteLowN && c.lowN;
            let bg, fg, mainTxt;

            if (!c.defined) {
              bg = "#0F172A";
              fg = "#CBD5E1";
              mainTxt = `n=${c.n}`;
            } else {
              bg = corrColor(c.rho, isMuted);
              fg = !isMuted && Math.abs(c.rho) >= 0.35 ? "#FFFFFF" : isMuted ? "#64748B" : "#0F172A";
              mainTxt = `${c.rho.toFixed(2)}`;
            }

            const subTxt = c.defined ? `<span class="hm-sub">n=${S.fmtInt(c.n)}</span>` : "";
            const lowMark = c.lowN && c.defined ? "hm-low-n" : "";

            return `
              <td class="hm-cell ${isActiveCol ? "active-col" : ""} ${lowMark} ${isMuted ? "is-muted" : ""}"
                  style="background:${bg};color:${fg};"
                  data-level-idx="${c.idx}"
                  title="${a.alcaldia} · ${c.label}: ${c.defined ? `ρ = ${S.fmtSigned(c.rho, 2)}` : "No definido"} (n=${S.fmtInt(c.n)})">
                ${mainTxt}${subTxt}
              </td>
            `;
          })
          .join("");

        return `
          <tr class="hm-row" data-alc-key="${a.key}">
            <td class="hm-alc-name" title="${a.alcaldia} (${S.fmtInt(a.totalN)} con calificación)">${shortName}</td>
            ${cellsHtml}
          </tr>
        `;
      })
      .join("");

    return `
      <div class="hm-wrap">
        <table class="hm-table" id="p4-heatmap-table">
          <thead>
            <tr>
              <th class="hm-alc-head">Alcaldía</th>
              ${headCols}
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>
      <div class="svg-footnote">
        ${metrics.definedCells} de ${metrics.totalCells} celdas con coeficiente (n &ge; ${MIN_N_CORR}) · ${metrics.lowNCells} celdas con menos de ${MIN_N_RELIABLE} anuncios (borde punteado). Haz clic en una columna para actualizar el mapa o en una alcaldía para inspeccionar su trayectoria y puntos.
      </div>
    `;
  }

  function updateSelectedBanner() {
    const box = document.getElementById("p4-selected-box");
    if (!box) return;
    if (!state.selectedAlcKey || !metrics.alcByKey[state.selectedAlcKey]) {
      box.innerHTML = "";
      return;
    }
    const S = window.Stats;
    const rec = metrics.alcByKey[state.selectedAlcKey];
    const activeCell = rec.cells[state.activeLevelIdx];

    const trajHtml = rec.cells
      .map((c) => {
        const val = c.defined ? S.fmtSigned(c.rho, 2) : "NA";
        const activeCls = c.idx === state.activeLevelIdx ? "is-active" : "";
        return `
          <div class="traj-pill ${activeCls}">
            <span class="traj-k">${c.label}</span>
            <strong class="traj-v">${val}</strong>
            <span class="traj-n">n=${S.fmtInt(c.n)}</span>
          </div>`;
      })
      .join("");

    box.innerHTML = `
      <div class="selected-alc-card">
        <div class="selected-alc-head">
          <div>
            <strong>${rec.alcaldia}</strong>
            <div class="selected-alc-sub">
              Mostrando ${S.fmtInt(activeCell.n)} puntos en nivel <strong>${activeCell.label}</strong> (${S.fmtInt(rec.totalN)} totales con calificación)
            </div>
          </div>
          <button id="p4-clear-alc" class="mini-btn">Limpiar</button>
        </div>
        <div class="traj-grid mono">${trajHtml}</div>
      </div>
    `;

    document.getElementById("p4-clear-alc").addEventListener("click", () => {
      state.selectedAlcKey = null;
      refs.mapApi.setSelectedAlcaldia(null);
      syncPointsForCurrentAct();
      updateSelectedBanner();
      highlightLinkedElements();
    });
  }

  function setActiveLevelCol(idx) {
    state.activeLevelIdx = idx;
    document.querySelectorAll(".p4-lv-btn").forEach((b) => {
      b.classList.toggle("active", Number(b.dataset.idx) === idx);
    });
    document.querySelectorAll(".hm-col-head, .hm-cell").forEach((el) => {
      el.classList.toggle("active-col", Number(el.dataset.levelIdx) === idx);
    });
    refs.mapApi.refreshChoroplethStyles();
    syncPointsForCurrentAct();
    renderLegend();
    updateSelectedBanner();
  }

  function renderActBody() {
    const S = window.Stats;
    const body = document.getElementById("p4-act-body");

    // ---------------- ACTO 1: Respaldo de la calificación por reseñas ----------------
    if (state.act === 1) {
      const lv0 = metrics.levelStats[0];
      const lv3 = metrics.levelStats[3];
      const sinCal = metrics.totalAll - metrics.totalCal;

      const rowsHtml = metrics.levelStats
        .map(
          (lv) => `
          <tr>
            <td><strong>${lv.label}</strong></td>
            <td class="num">${S.fmtInt(lv.n)}</td>
            <td class="num"><strong>${lv.median.toFixed(2)}</strong></td>
            <td class="num">${lv.mean.toFixed(2)}</td>
            <td class="num">${lv.ric.toFixed(2)}</td>
            <td class="num">${lv.pctUnder45.toFixed(2)}%</td>
          </tr>`
        )
        .join("");

      body.innerHTML = `
        <div class="kpi-grid kpi-4">
          <div class="kpi-card">
            <div class="kpi-label">Con calificación</div>
            <div class="kpi-value">${S.fmtInt(metrics.totalCal)}</div>
            <div class="kpi-sub">${S.fmtPct(metrics.pctCal, 1)} de ${S.fmtInt(metrics.totalAll)}</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">Sin reseñas (excl.)</div>
            <div class="kpi-value">${S.fmtInt(sinCal)}</div>
            <div class="kpi-sub">No se imputan opiniones</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">Contracción del RIC</div>
            <div class="kpi-value">${lv0.ric.toFixed(2)} &rarr; ${lv3.ric.toFixed(2)}</div>
            <div class="kpi-sub">${lv0.label} vs. ${lv3.label}</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">Bajan de 4.5</div>
            <div class="kpi-value">${lv0.pctUnder45.toFixed(1)}% &rarr; ${lv3.pctUnder45.toFixed(1)}%</div>
            <div class="kpi-sub">Mayor estabilidad con reseñas</div>
          </div>
        </div>

        <div class="card">
          <div class="card-title">
            <span>Calificación según número de reseñas</span>
            <div class="mini-tabs">
              <button class="mini-tab-btn p4-zoom-btn ${!state.boxZoom ? "active" : ""}" data-zoom="0">Escala 1–5</button>
              <button class="mini-tab-btn p4-zoom-btn ${state.boxZoom ? "active" : ""}" data-zoom="1">Zoom 4.0–5.0</button>
            </div>
          </div>
          ${buildRatingBoxplotSVG()}
        </div>

        <div class="card">
          <div class="card-title">Resumen por cuartil de reseñas <span class="card-tag">4 grupos balanceados</span></div>
          <table class="data-table">
            <thead>
              <tr><th>Nivel reseñas</th><th class="num">Anuncios</th><th class="num">Mediana</th><th class="num">Media</th><th class="num">RIC</th><th class="num">&lt; 4.5</th></tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>

        <div class="card">
          <div class="card-title">Por qué segmentar por respaldo de reseñas</div>
          <ul class="finding-list">
            <li><strong>Calificaciones concentradas arriba:</strong> la mediana se mantiene cercana a 5 en todos los grupos (${lv0.median.toFixed(2)} en ${lv0.label} y ${lv3.median.toFixed(2)} en el resto), mientras la media queda debajo de la mediana por una cola de calificaciones bajas.</li>
            <li><strong>Menos confiabilidad con pocas reseñas:</strong> al pasar de <strong>${lv0.label}</strong> a <strong>${lv3.label}</strong> reseñas, el RIC se contrae de <strong>${lv0.ric.toFixed(2)} a ${lv3.ric.toFixed(2)}</strong> y la proporción de anuncios por debajo de 4.5 cae de <strong>${lv0.pctUnder45.toFixed(2)}% a ${lv3.pctUnder45.toFixed(2)}%</strong>.</li>
            <li><strong>Decisión de método:</strong> no se imputan las ${S.fmtInt(sinCal)} observaciones sin reseñas y la relación con el precio se evalúa dentro de cada nivel de respaldo.</li>
          </ul>
        </div>
      `;

      body.querySelectorAll(".p4-zoom-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          state.boxZoom = btn.dataset.zoom === "1";
          renderActBody();
        });
      });
      return;
    }

    // ---------------- ACTO 2: Asociación global y por nivel de reseñas ----------------
    if (state.act === 2) {
      const g = metrics.globalCorr;
      const first = metrics.levelCorrs[0];
      const last = metrics.levelCorrs[metrics.levelCorrs.length - 1];

      const rowsHtml = metrics.allCorrs
        .map(
          (d) => `
          <tr class="${d.isGlobal ? "row-total" : ""}">
            <td><strong>${d.label}</strong></td>
            <td class="num">${S.fmtInt(d.n)}</td>
            <td class="num"><strong style="color:#1E3A5F">${d.spearman.toFixed(2)}</strong></td>
            <td class="num"><strong style="color:#B84A39">${d.pearson.toFixed(2)}</strong></td>
          </tr>`
        )
        .join("");

      body.innerHTML = `
        <div class="kpi-grid">
          <div class="kpi-card">
            <div class="kpi-label">Global · Spearman (ρ)</div>
            <div class="kpi-value">${g.spearman.toFixed(2)}</div>
            <div class="kpi-sub">Pearson (log₁₀ precio): ${g.pearson.toFixed(2)} · n=${S.fmtInt(g.n)}</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">Crecimiento con respaldo</div>
            <div class="kpi-value">${first.spearman.toFixed(2)} &rarr; ${last.spearman.toFixed(2)}</div>
            <div class="kpi-sub">Pearson: ${first.pearson.toFixed(2)} &rarr; ${last.pearson.toFixed(2)} (${first.label} a ${last.label})</div>
          </div>
        </div>

        <div class="card">
          <div class="card-title">Asociación precio (log₁₀) vs. calificación <span class="card-tag">Spearman vs. Pearson</span></div>
          ${buildCorrComparisonSVG()}
        </div>

        <div class="card">
          <div class="card-title">Tabla comparativa de coeficientes <span class="card-tag">Calculado del CSV</span></div>
          <table class="data-table">
            <thead>
              <tr><th>Grupo</th><th class="num">n</th><th class="num">Spearman (ρ)</th><th class="num">Pearson (r)</th></tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>

        <div class="card">
          <div class="card-title">Hallazgos de asociación global</div>
          <ul class="finding-list">
            <li><strong>Asociación positiva pero débil:</strong> en los ${S.fmtInt(g.n)} anuncios con calificación, Spearman es <strong>${g.spearman.toFixed(2)}</strong> y Pearson sobre <code>log_precio</code> es <strong>${g.pearson.toFixed(2)}</strong>; cobrar más se asocia ligeramente con mejor calificación, pero el precio explica muy poco de la nota.</li>
            <li><strong>Más nítida con reputación respaldada:</strong> Spearman sube de <strong>${first.spearman.toFixed(2)}</strong> (${first.label}) a <strong>${last.spearman.toFixed(2)}</strong> (${last.label}), y Pearson de <strong>${first.pearson.toFixed(2)}</strong> a <strong>${last.pearson.toFixed(2)}</strong>; mezclar anuncios poco respaldados diluye el coeficiente global.</li>
            <li><strong>Consistencia y cautela:</strong> ambos coeficientes coinciden en signo y tendencia, pero esto describe <strong>asociación, no causalidad</strong> (los anuncios con muchas reseñas también son más antiguos y consolidados).</li>
          </ul>
        </div>
      `;
      return;
    }

    // ---------------- ACTO 3: Figura 9 (Alcaldía × nivel de reseñas) ----------------
    const findAlc = (name) => metrics.alcByKey[window.DataStore.normalizeKey(name)];
    const cuau = findAlc("Cuauhtémoc");
    const ao = findAlc("Álvaro Obregón");
    const gam = findAlc("Gustavo A. Madero");
    const vc = findAlc("Venustiano Carranza");

    body.innerHTML = `
      <div class="card">
        <div class="card-title">
          <span>Columna activa en el mapa coroplético</span>
          <span class="card-tag">Nivel de reseñas</span>
        </div>
        <div class="segmented cols-4" role="group" aria-label="Nivel de reseñas en el mapa">
          ${metrics.levels
            .map(
              (lv) =>
                `<button class="seg-btn p4-lv-btn ${state.activeLevelIdx === lv.idx ? "active" : ""}" data-idx="${lv.idx}">${lv.label}</button>`
            )
            .join("")}
        </div>
        <div class="toggles-row" style="margin-top:8px;padding-top:7px;">
          <label><input type="checkbox" id="p4-chk-mute" ${state.muteLowN ? "checked" : ""} /> Atenuar celdas con n &lt; ${MIN_N_RELIABLE} (${metrics.lowNCells} celdas)</label>
          <label><input type="checkbox" id="p4-chk-allpts" ${state.showAllPointsInChoro ? "checked" : ""} /> Mostrar puntos del nivel</label>
        </div>
      </div>

      <div id="p4-selected-box"></div>

      <div class="card">
        <div class="card-title">
          <span>Figura 9 · Asociación precio–calificación por alcaldía</span>
          <span class="card-tag">Spearman (ρ)</span>
        </div>
        ${buildHeatmapHTML()}
      </div>

      <div class="card">
        <div class="card-title">Conclusión territorial y limitaciones</div>
        <ul class="finding-list">
          <li><strong>Alcaldías grandes:</strong> el coeficiente es positivo en todas; ${cuau ? `en <strong>${cuau.alcaldia}</strong> sube de <strong>${cuau.cells[0].rho.toFixed(2)} a ${cuau.cells[3].rho.toFixed(2)}</strong>` : "las de mayor volumen muestran crecimiento sostenido"} conforme aumenta el respaldo de reseñas.</li>
          <li><strong>Territorios sin asociación y valores altos:</strong> ${ao ? `<strong>${ao.alcaldia}</strong> permanece cerca de cero en los 4 niveles (${ao.cells.map((c) => c.rho.toFixed(2)).join(", ")})` : "algunas alcaldías muestran relación nula"}, mientras ${gam && vc ? `<strong>${gam.alcaldia}</strong> (${gam.cells[3].rho.toFixed(2)}, n=${gam.cells[3].n}) y <strong>${vc.alcaldia}</strong> (hasta ${Math.max(...vc.cells.map((c) => c.rho)).toFixed(2)})` : "alcaldías medianas"} alcanzan asociaciones más altas.</li>
          <li><strong>Limitaciones explícitas:</strong> <strong>${metrics.lowNCells} de ${metrics.totalCells}</strong> celdas tienen menos de ${MIN_N_RELIABLE} anuncios (valores inestables como 1.00 con n=3 o 4); además la matriz mezcla modalidades y documenta asociación, nunca causalidad.</li>
        </ul>
      </div>
    `;

    body.querySelectorAll(".p4-lv-btn").forEach((btn) => {
      btn.addEventListener("click", () => setActiveLevelCol(Number(btn.dataset.idx)));
    });

    document.getElementById("p4-chk-mute").addEventListener("change", (e) => {
      state.muteLowN = e.target.checked;
      renderActBody();
      refs.mapApi.refreshChoroplethStyles();
    });

    document.getElementById("p4-chk-allpts").addEventListener("change", (e) => {
      state.showAllPointsInChoro = e.target.checked;
      syncPointsForCurrentAct();
    });

    const table = document.getElementById("p4-heatmap-table");
    if (table) {
      table.querySelectorAll(".hm-col-head").forEach((th) => {
        th.addEventListener("click", () => setActiveLevelCol(Number(th.dataset.levelIdx)));
      });

      table.querySelectorAll(".hm-row").forEach((tr) => {
        const key = tr.getAttribute("data-alc-key");
        tr.addEventListener("mouseenter", () => {
          state.hoveredAlcKey = key;
          refs.mapApi.setHoveredAlcaldia(key);
          highlightLinkedElements();
        });
        tr.addEventListener("mouseleave", () => {
          if (state.hoveredAlcKey === key) state.hoveredAlcKey = null;
          refs.mapApi.setHoveredAlcaldia(null);
          highlightLinkedElements();
        });
        tr.addEventListener("click", (ev) => {
          const cellTd = ev.target.closest(".hm-cell");
          if (cellTd && cellTd.dataset.levelIdx !== undefined) {
            const clickedCol = Number(cellTd.dataset.levelIdx);
            if (clickedCol !== state.activeLevelIdx) {
              setActiveLevelCol(clickedCol);
            }
          }
          state.selectedAlcKey = state.selectedAlcKey === key ? null : key;
          refs.mapApi.setSelectedAlcaldia(state.selectedAlcKey);
          syncPointsForCurrentAct();
          updateSelectedBanner();
          highlightLinkedElements();
        });
      });
    }

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

    document.querySelectorAll(".p4-act-btn").forEach((b) => {
      b.classList.toggle("active", Number(b.dataset.act) === actNum);
    });
    renderActBody();
    syncMap();
  }

  function renderShell() {
    refs.panelEl.innerHTML = `
      <div class="section-header">
        <span class="eyebrow">Pregunta 4 · Reputación y precio</span>
        <h1>Asociación entre el precio anunciado y la calificación general</h1>
        <p class="subtitle">
          Análisis de correlación (Spearman y Pearson sobre log₁₀ del precio) controlado por respaldo de reseñas y desglosado por alcaldía en los anuncios calificados.
        </p>
      </div>

      <div class="acts-grid cols-3" role="tablist" aria-label="Secuencia narrativa Pregunta 4">
        <button class="act-btn p4-act-btn active" data-act="1"><span class="act-step">Acto 1</span><span class="act-label">Respaldo reseñas</span></button>
        <button class="act-btn p4-act-btn" data-act="2"><span class="act-step">Acto 2</span><span class="act-label">Spearman vs Pearson</span></button>
        <button class="act-btn p4-act-btn" data-act="3"><span class="act-step">Acto 3</span><span class="act-label">Mapa por alcaldía</span></button>
      </div>

      <div id="p4-act-body" class="p1-act-body"></div>
    `;

    document.querySelectorAll(".p4-act-btn").forEach((btn) => {
      btn.addEventListener("click", () => applyAct(Number(btn.dataset.act)));
    });
  }

  function showLoadFallback(errMsg) {
    refs.panelEl.innerHTML = `
      <div class="section-header">
        <span class="eyebrow">Pregunta 4 · Carga de datos</span>
        <h1>No se pudo leer automáticamente la base de análisis</h1>
      </div>
      <div class="callout warn">
        <strong>Motivo:</strong> ${errMsg}<br /><br />
        Ejecuta <code>python -m http.server 8000</code> dentro de <code>proyecto_airbnb_cdmx/</code>
        y abre <code>http://localhost:8000/main.html</code>.
      </div>
      <div class="card">
        <div class="card-title">Alternativa rápida sin servidor local</div>
        <p class="subtitle">Selecciona tu archivo <code>shared/datos_analisis.csv</code>:</p>
        <input type="file" id="p4-file-input" accept=".csv" class="file-fallback" />
      </div>
    `;

    document.getElementById("p4-file-input").addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      allRows = await window.DataStore.loadFromFile(file);
      computeMetrics(allRows);
      renderShell();
      applyAct(1);
    });
  }

  async function mount(ctx) {
    refs = ctx;
    const sidePanel = document.getElementById("side-panel");
    if (sidePanel) sidePanel.classList.add("medium");

    refs.panelEl.innerHTML = `<div class="loading-box">Calculando métricas de Pregunta 4...</div>`;

    try {
      if (!allRows.length) {
        allRows = await window.DataStore.load();
        computeMetrics(allRows);
      }
      renderShell();
      applyAct(state.act);
      refs.mapApi.resetView();
    } catch (err) {
      showLoadFallback(err.message);
    }
  }

  function unmount() {
    renderToken++;
    state.selectedAlcKey = null;
    state.hoveredAlcKey = null;
    const sidePanel = document.getElementById("side-panel");
    if (sidePanel) sidePanel.classList.remove("medium");
    if (refs.mapApi) {
      refs.mapApi.closePopups();
      refs.mapApi.clearChoropleth();
      refs.mapApi.clearOverlays();
      refs.mapApi.resetView();
    }
  }

  return { mount, unmount };
})();

if (window.AppShell) window.AppShell.register("p4", window.Pregunta4);