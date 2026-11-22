window.Pregunta3 = (() => {
  const MIN_N_RELIABLE = 30;
  const CAPACIDADES = [1, 2, 3, 4, 5, 6, 7, 8];
  const MODALIDADES_ORDEN = [
    "Alojamiento completo",
    "Habitación privada",
    "Habitación compartida",
    "Habitación de hotel",
  ];
  const COMPARABLES = ["Alojamiento completo", "Habitación privada"];

  const MOD_COLORES = {
    "Alojamiento completo": "#1E3A5F",
    "Habitación privada": "#B84A39",
    "Habitación compartida": "#2F6F62",
    "Habitación de hotel": "#8B6D3F",
  };

  const SPEARMAN_VARS = [
    { key: "capacidad", label: "Capacidad (huéspedes)" },
    { key: "recamaras", label: "Recámaras" },
    { key: "camas", label: "Camas" },
    { key: "calificacion", label: "Calificación" },
    { key: "resenas", label: "Número de reseñas" },
    { key: "disponibilidad_365", label: "Días disponibles al año" },
  ];

  const PALETTE_SEQ = [
    [203, 217, 232],
    [122, 158, 194],
    [45, 92, 138],
    [184, 74, 57],
  ];

  let allRows = [];
  let metrics = null;
  let refs = { panelEl: null, legendEl: null, mapApi: null, store: null };

  const state = {
    act: 1,
    mapColorBy: "modalidad", // "modalidad" | "capacidad" | "recamaras" | "camas"
    fig14Filter: "all",      // "all" | "n30" | "comparables"
    capTableMetric: "total", // "total" | "huesped" | "n"
    spearmanScope: "todos",  // "todos" | "completo" | "privada"
  };

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

  function quartilesOf(values) {
    const S = window.Stats;
    const s = S.sortedNumbers(values);
    const n = s.length;
    if (!n) return { n: 0, median: NaN, q1: NaN, q3: NaN, ric: NaN };
    const q1 = S.quantileSorted(s, 0.25);
    const median = S.quantileSorted(s, 0.5);
    const q3 = S.quantileSorted(s, 0.75);
    return { n, median, q1, q3, ric: q3 - q1 };
  }

  function computeSpearmanList(rows) {
    const S = window.Stats;
    const prices = rows.map((r) => r.precio);
    return SPEARMAN_VARS.map((v) => {
      const xs = rows.map((r) => r[v.key]);
      let validN = 0;
      for (let i = 0; i < xs.length; i++) {
        if (Number.isFinite(xs[i]) && Number.isFinite(prices[i])) validN++;
      }
      return {
        key: v.key,
        label: v.label,
        n: validN,
        rho: S.spearman(xs, prices),
      };
    }).sort((a, b) => b.rho - a.rho);
  }

  function computeMetrics(rows) {
    const S = window.Stats;

    // 4.3.1: Cuartiles por modalidad ordenados por mediana descendente
    const modGroups = {};
    rows.forEach((r) => {
      if (!modGroups[r.modalidad]) modGroups[r.modalidad] = [];
      modGroups[r.modalidad].push(r.precio);
    });
    const modList = Object.entries(modGroups)
      .map(([modalidad, vals]) => ({ modalidad, ...quartilesOf(vals) }))
      .sort((a, b) => b.median - a.median);
    const modByName = {};
    modList.forEach((m) => (modByName[m.modalidad] = m));

    // 4.3.2: Capacidad 1 a 8 × modalidad (anuncios, mediana_precio, mediana_por_huesped)
    const capData = {};
    MODALIDADES_ORDEN.forEach((m) => {
      capData[m] = {};
      CAPACIDADES.forEach((c) => {
        capData[m][c] = { precios: [], huespedes: [] };
      });
    });

    rows.forEach((r) => {
      if (capData[r.modalidad] && Number.isInteger(r.capacidad) && r.capacidad >= 1 && r.capacidad <= 8) {
        capData[r.modalidad][r.capacidad].precios.push(r.precio);
        if (Number.isFinite(r.precio_huesped)) {
          capData[r.modalidad][r.capacidad].huespedes.push(r.precio_huesped);
        }
      }
    });

    const porCapacidad = {};
    MODALIDADES_ORDEN.forEach((m) => {
      porCapacidad[m] = {};
      CAPACIDADES.forEach((c) => {
        const pArr = S.sortedNumbers(capData[m][c].precios);
        const hArr = S.sortedNumbers(capData[m][c].huespedes);
        porCapacidad[m][c] = {
          n: pArr.length,
          medTotal: pArr.length ? S.quantileSorted(pArr, 0.5) : NaN,
          medHuesped: hArr.length ? S.quantileSorted(hArr, 0.5) : NaN,
        };
      });
    });

    // 4.3.3: Correlaciones de Spearman en 3 alcances (Todos / Alojamiento completo / Habitación privada)
    const rowsComp = rows.filter((r) => r.modalidad === "Alojamiento completo");
    const rowsPriv = rows.filter((r) => r.modalidad === "Habitación privada");
    const spearmanByScope = {
      todos: { label: "Todos los alojamientos", nTotal: rows.length, list: computeSpearmanList(rows) },
      completo: { label: "Alojamiento completo", nTotal: rowsComp.length, list: computeSpearmanList(rowsComp) },
      privada: { label: "Habitación privada", nTotal: rowsPriv.length, list: computeSpearmanList(rowsPriv) },
    };

    const nComparables = rowsComp.length + rowsPriv.length;

    metrics = {
      totalN: rows.length,
      nComparables,
      pctComparables: (nComparables / rows.length) * 100,
      modList,
      modByName,
      porCapacidad,
      spearmanByScope,
    };
  }

  function pointPopupHtml(p) {
    const S = window.Stats;
    return `
      <div class="popup-title">${p.modalidad}</div>
      <div class="popup-grid">
        <span class="popup-k">Precio / noche</span><span class="popup-v">${S.fmtMXN(p.precio, 2)} MXN</span>
        <span class="popup-k">Precio / huésped</span><span class="popup-v">${S.fmtMXN(p.precio_huesped, 0)} MXN</span>
        <span class="popup-k">Capacidad</span><span class="popup-v">${S.fmtInt(p.capacidad)} huéspedes</span>
        <span class="popup-k">Recámaras</span><span class="popup-v">${Number.isFinite(p.recamaras) ? S.fmtInt(p.recamaras) : "Sin dato"}</span>
        <span class="popup-k">Camas</span><span class="popup-v">${Number.isFinite(p.camas) ? S.fmtInt(p.camas) : "Sin dato"}</span>
      </div>
    `;
  }

  function syncMapPoints() {
    let pts = allRows;
    let colorFn = (p) => MOD_COLORES[p.modalidad] || "#64748B";

    if (state.mapColorBy === "capacidad") {
      pts = allRows.filter((p) => Number.isFinite(p.capacidad));
      colorFn = (p) => lerpColor((Math.min(p.capacidad, 8) - 1) / 7, PALETTE_SEQ);
    } else if (state.mapColorBy === "recamaras") {
      pts = allRows.filter((p) => Number.isFinite(p.recamaras));
      colorFn = (p) => lerpColor(Math.min(p.recamaras, 5) / 5, PALETTE_SEQ);
    } else if (state.mapColorBy === "camas") {
      pts = allRows.filter((p) => Number.isFinite(p.camas));
      colorFn = (p) => lerpColor((Math.min(p.camas, 6) - 1) / 5, PALETTE_SEQ);
    }

    refs.mapApi.setPoints(pts, {
      colorFn,
      radiusFn: () => 2.0,
      alphaFn: () => 0.48,
      popupFn: pointPopupHtml,
    });
    renderMapLegend(pts.length);
  }

  function renderMapLegend(visibleN) {
    const S = window.Stats;
    const el = refs.legendEl;

    const btnModes = [
      { id: "modalidad", lbl: "Modalidad" },
      { id: "capacidad", lbl: "Capacidad" },
      { id: "recamaras", lbl: "Recámaras" },
      { id: "camas", lbl: "Camas" },
    ];

    const buttonsHtml = `
      <div class="legend-title">Colorear puntos por</div>
      <div class="map-color-pills">
        ${btnModes
          .map(
            (b) => `<button class="map-pill-btn ${state.mapColorBy === b.id ? "active" : ""}" data-color="${b.id}">${b.lbl}</button>`
          )
          .join("")}
      </div>
    `;

    let scaleHtml = "";
    if (state.mapColorBy === "modalidad") {
      scaleHtml = metrics.modList
        .map(
          (m) => `
          <div class="legend-item">
            <span class="legend-left"><span class="swatch" style="background:${MOD_COLORES[m.modalidad] || "#64748B"}"></span>${m.modalidad}</span>
            <span class="mono">${S.fmtInt(m.n)}</span>
          </div>`
        )
        .join("");
    } else {
      const meta = {
        capacidad: { title: "Capacidad máxima (huéspedes)", min: "1", max: "8+" },
        recamaras: { title: "Número de recámaras", min: "0", max: "5+" },
        camas: { title: "Número de camas", min: "1", max: "6+" },
      }[state.mapColorBy];
      const omitted = metrics.totalN - visibleN;
      scaleHtml = `
        <div class="legend-title" style="margin-top:4px;">${meta.title}</div>
        <div class="legend-gradient" style="background:linear-gradient(90deg, #CBD9E8 0%, #7A9EC2 35%, #2D5C8A 70%, #B84A39 100%)"></div>
        <div class="legend-scale mono"><span>${meta.min}</span><span>${meta.max}</span></div>
        ${omitted > 0 ? `<div class="svg-footnote" style="margin-top:2px;">${S.fmtInt(visibleN)} con dato (${S.fmtInt(omitted)} nulos omitidos)</div>` : ""}
      `;
    }

    el.innerHTML = buttonsHtml + scaleHtml;

    el.querySelectorAll(".map-pill-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.mapColorBy = btn.dataset.color;
        syncMapPoints();
      });
    });
  }

  // --- SVG Acto 1: Intervalos Q1–Q3 y mediana por modalidad (fiel a 4.3.1) ---
  function buildModalityIntervalSVG() {
    const S = window.Stats;
    const rows = metrics.modList;
    const rowH = 34;
    const pad = { top: 12, right: 20, bottom: 28, left: 138 };
    const W = 590;
    const H = pad.top + rows.length * rowH + pad.bottom;
    const plotW = W - pad.left - pad.right;

    const minV = Math.min(240, ...rows.map((r) => r.q1) * 0.9);
    const maxV = Math.max(7000, ...rows.map((r) => r.q3) * 1.12);
    const logMin = Math.log10(minV);
    const logMax = Math.log10(maxV);
    const xOf = (v) => pad.left + ((Math.log10(v) - logMin) / (logMax - logMin)) * plotW;

    const ticks = [250, 500, 1000, 2000, 4000, 6500].filter((t) => t >= minV && t <= maxV);
    const grid = ticks
      .map((t) => {
        const x = xOf(t);
        return `
          <line x1="${x}" y1="${pad.top}" x2="${x}" y2="${H - pad.bottom}" stroke="#E2E8F0" stroke-width="1" />
          <text x="${x}" y="${H - 8}" text-anchor="middle" class="svg-axis-txt">${S.fmtMXN(t)}</text>
        `;
      })
      .join("");

    const bars = rows
      .map((r, i) => {
        const y = pad.top + i * rowH + rowH / 2;
        const col = MOD_COLORES[r.modalidad] || "#64748B";
        const x1 = xOf(r.q1);
        const x2 = xOf(r.q3);
        const xm = xOf(r.median);
        return `
          <g>
            <title>${r.modalidad} (n=${S.fmtInt(r.n)})&#10;Mediana: ${S.fmtMXN(r.median, 2)}&#10;Q1–Q3: ${S.fmtMXN(r.q1, 2)} – ${S.fmtMXN(r.q3, 2)}&#10;RIC: ${S.fmtMXN(r.ric, 2)}</title>
            <text x="${pad.left - 10}" y="${y - 2}" text-anchor="end" class="svg-row-lbl" style="font-weight:600">${r.modalidad}</text>
            <text x="${pad.left - 10}" y="${y + 10}" text-anchor="end" class="svg-sub-txt">n = ${S.fmtInt(r.n)} · RIC ${S.fmtMXN(r.ric)}</text>
            <line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="${col}" stroke-width="7" stroke-linecap="round" opacity="0.32" />
            <circle cx="${xm}" cy="${y}" r="5.2" fill="${col}" stroke="#FFFFFF" stroke-width="1.5" />
            <text x="${xm}" y="${y - 9}" text-anchor="middle" class="svg-val-txt">${S.fmtMXN(r.median)}</text>
          </g>
        `;
      })
      .join("");

    return `
      <svg viewBox="0 0 ${W} ${H}" class="p1-svg" role="img" aria-label="Mediana y rango intercuartílico por modalidad">
        ${grid}
        ${bars}
      </svg>
      <div class="svg-footnote">
        Punto = mediana · Barra = Q1 a Q3 (escala logarítmica en MXN). Pasa el cursor sobre cada modalidad para ver los valores exactos.
      </div>
    `;
  }

  // --- SVG Acto 2: Figura 14 (Precio total | Precio por huésped, capacidades 1 a 8) ---
  function niceTicks(maxVal, count = 5) {
    if (!Number.isFinite(maxVal) || maxVal <= 0) return { top: 1000, ticks: [0, 500, 1000] };
    const roughStep = maxVal / count;
    const mag = 10 ** Math.floor(Math.log10(roughStep));
    const norm = roughStep / mag;
    let step;
    if (norm <= 1) step = 1 * mag;
    else if (norm <= 2) step = 2 * mag;
    else if (norm <= 2.5) step = 2.5 * mag;
    else if (norm <= 5) step = 5 * mag;
    else step = 10 * mag;

    const top = Math.ceil((maxVal * 1.06) / step) * step;
    const ticks = [];
    for (let v = 0; v <= top + 0.001; v += step) ticks.push(Math.round(v));
    return { top, ticks };
  }

  function buildLinePanelSVG(metricKey, title, yAxisLabel) {
    const S = window.Stats;
    const W = 300;
    const H = 228;
    const pad = { top: 24, right: 12, bottom: 30, left: 50 };
    const plotW = W - pad.left - pad.right;
    const plotH = H - pad.top - pad.bottom;

    const activeMods =
      state.fig14Filter === "comparables" ? COMPARABLES : MODALIDADES_ORDEN;

    // Construye series visibles según el filtro de la Figura 14
    const series = activeMods.map((m) => {
      const pts = [];
      CAPACIDADES.forEach((c) => {
        const cell = metrics.porCapacidad[m][c];
        const v = cell[metricKey];
        if (!Number.isFinite(v) || cell.n === 0) return;
        if (state.fig14Filter === "n30" && cell.n < MIN_N_RELIABLE) return;
        pts.push({ cap: c, val: v, n: cell.n, lowN: cell.n < MIN_N_RELIABLE });
      });
      return { modalidad: m, color: MOD_COLORES[m], pts };
    });

    let maxVal = 0;
    series.forEach((s) => s.pts.forEach((p) => { if (p.val > maxVal) maxVal = p.val; }));
    const { top, ticks } = niceTicks(maxVal, 5);

    const xOf = (c) => pad.left + ((c - 1) / 7) * plotW;
    const yOf = (v) => pad.top + (1 - v / top) * plotH;

    const yGrid = ticks
      .map((t) => {
        const y = yOf(t);
        return `
          <line x1="${pad.left}" y1="${y}" x2="${W - pad.right}" y2="${y}" stroke="#E2E8F0" stroke-width="1" />
          <text x="${pad.left - 6}" y="${y + 3}" text-anchor="end" class="svg-axis-txt">${S.fmtMXN(t)}</text>
        `;
      })
      .join("");

    const xTicks = CAPACIDADES.map((c) => {
      const x = xOf(c);
      return `<text x="${x}" y="${H - 13}" text-anchor="middle" class="svg-axis-txt">${c}</text>`;
    }).join("");

    const linesAndDots = series
      .map((s) => {
        if (!s.pts.length) return "";
        const polyPts = s.pts.map((p) => `${xOf(p.cap).toFixed(1)},${yOf(p.val).toFixed(1)}`).join(" ");
        const dots = s.pts
          .map((p) => {
            const cx = xOf(p.cap).toFixed(1);
            const cy = yOf(p.val).toFixed(1);
            const fill = p.lowN ? "#FFFFFF" : s.color;
            const stroke = p.lowN ? s.color : "#FFFFFF";
            const sw = p.lowN ? 2.0 : 1.1;
            const warn = p.lowN ? " (⚠ n < 30)" : "";
            return `
              <circle cx="${cx}" cy="${cy}" r="3.8" fill="${fill}" stroke="${stroke}" stroke-width="${sw}">
                <title>${s.modalidad} · ${p.cap} huésped(es)&#10;${title}: ${S.fmtMXN(p.val)}&#10;Anuncios: n = ${S.fmtInt(p.n)}${warn}</title>
              </circle>
            `;
          })
          .join("");
        return `
          <polyline fill="none" stroke="${s.color}" stroke-width="2" points="${polyPts}" opacity="0.9" />
          ${dots}
        `;
      })
      .join("");

    return `
      <div class="fig14-panel">
        <div class="fig14-panel-title">${title}</div>
        <svg viewBox="0 0 ${W} ${H}" class="p1-svg" role="img" aria-label="${title}">
          ${yGrid}
          <line x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${H - pad.bottom}" stroke="#CBD5E1" stroke-width="1" />
          ${xTicks}
          <text x="${pad.left + plotW / 2}" y="${H - 1}" text-anchor="middle" class="svg-sub-txt">Capacidad máxima (huéspedes)</text>
          <text x="11" y="${pad.top + plotH / 2}" text-anchor="middle" class="svg-sub-txt" transform="rotate(-90 11 ${pad.top + plotH / 2})">${yAxisLabel}</text>
          ${linesAndDots}
        </svg>
      </div>
    `;
  }

  // --- SVG Acto 3: Correlaciones de Spearman (fiel a 4.3.3) ---
  function buildSpearmanSVG(list) {
    const S = window.Stats;
    const rowH = 30;
    const pad = { top: 12, right: 48, bottom: 26, left: 162 };
    const W = 590;
    const H = pad.top + list.length * rowH + pad.bottom;
    const plotW = W - pad.left - pad.right;

    const minR = Math.min(-0.22, ...list.map((d) => d.rho) - 0.06);
    const maxR = Math.max(0.62, ...list.map((d) => d.rho) + 0.08);
    const xOf = (v) => pad.left + ((v - minR) / (maxR - minR)) * plotW;
    const x0 = xOf(0);

    const ticks = [-0.2, 0, 0.2, 0.4, 0.6].filter((t) => t >= minR - 0.01 && t <= maxR + 0.01);
    const grid = ticks
      .map((t) => {
        const x = xOf(t);
        const isZero = Math.abs(t) < 0.001;
        return `
          <line x1="${x}" y1="${pad.top}" x2="${x}" y2="${H - pad.bottom}"
                stroke="${isZero ? "#334155" : "#E2E8F0"}" stroke-width="${isZero ? 1.4 : 1}" />
          <text x="${x}" y="${H - 7}" text-anchor="middle" class="svg-axis-txt">${t === 0 ? "0.0" : S.fmtSigned(t, 1)}</text>
        `;
      })
      .join("");

    const bars = list
      .map((d, i) => {
        const yMid = pad.top + i * rowH + rowH / 2;
        const xv = xOf(d.rho);
        const bx = d.rho >= 0 ? x0 : xv;
        const bw = Math.max(2, Math.abs(xv - x0));
        const col = d.rho >= 0 ? "#1E3A5F" : "#B84A39";
        const txtX = d.rho >= 0 ? xv + 6 : xv - 6;
        const anchor = d.rho >= 0 ? "start" : "end";
        return `
          <g>
            <title>${d.label}&#10;Spearman ρ = ${S.fmtSigned(d.rho, 2)}&#10;Pares válidos: n = ${S.fmtInt(d.n)}</title>
            <text x="${pad.left - 10}" y="${yMid + 3.5}" text-anchor="end" class="svg-row-lbl">${d.label}</text>
            <rect x="${bx}" y="${yMid - 7.5}" width="${bw}" height="15" rx="2.5" fill="${col}" fill-opacity="0.86" />
            <text x="${txtX}" y="${yMid + 3.5}" text-anchor="${anchor}" class="svg-val-txt">${S.fmtSigned(d.rho, 2)}</text>
          </g>
        `;
      })
      .join("");

    return `
      <svg viewBox="0 0 ${W} ${H}" class="p1-svg" role="img" aria-label="Correlaciones de Spearman con el precio">
        ${grid}
        ${bars}
      </svg>
      <div class="svg-footnote">
        Coeficiente de correlación de Spearman (ρ) frente al precio por noche · Azul: asociación positiva · Terracota: asociación negativa.
      </div>
    `;
  }

  function renderActBody() {
    const S = window.Stats;
    const body = document.getElementById("p3-act-body");

    // ---------------- ACTO 1: Precio por modalidad (4.3.1) ----------------
    if (state.act === 1) {
      const comp = metrics.modByName["Alojamiento completo"];
      const priv = metrics.modByName["Habitación privada"];
      const shared = metrics.modByName["Habitación compartida"];
      const hotel = metrics.modByName["Habitación de hotel"];

      const rowsHtml = metrics.modList
        .map(
          (m) => `
          <tr>
            <td><span class="swatch-inline" style="background:${MOD_COLORES[m.modalidad] || "#64748B"}"></span><strong>${m.modalidad}</strong></td>
            <td class="num">${S.fmtInt(m.n)}</td>
            <td class="num"><strong>${S.fmtMXN(m.median, 2)}</strong></td>
            <td class="num">${S.fmtMXN(m.q1, 2)}</td>
            <td class="num">${S.fmtMXN(m.q3, 2)}</td>
            <td class="num">${S.fmtMXN(m.ric, 2)}</td>
          </tr>`
        )
        .join("");

      body.innerHTML = `
        <div class="kpi-grid kpi-4">
          <div class="kpi-card">
            <div class="kpi-label">Alojamiento completo</div>
            <div class="kpi-value">${S.fmtMXN(comp.median)}</div>
            <div class="kpi-sub">n=${S.fmtInt(comp.n)} · RIC ${S.fmtMXN(comp.ric)}</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">Habitación privada</div>
            <div class="kpi-value">${S.fmtMXN(priv.median)}</div>
            <div class="kpi-sub">n=${S.fmtInt(priv.n)} · RIC ${S.fmtMXN(priv.ric)}</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">Habitación compartida</div>
            <div class="kpi-value">${S.fmtMXN(shared.median)}</div>
            <div class="kpi-sub">n=${S.fmtInt(shared.n)} · RIC ${S.fmtMXN(shared.ric)}</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">Habitación de hotel</div>
            <div class="kpi-value">${S.fmtMXN(hotel.median)}</div>
            <div class="kpi-sub">n=${S.fmtInt(hotel.n)} · RIC ${S.fmtMXN(hotel.ric)}</div>
          </div>
        </div>

        <div class="card">
          <div class="card-title">Mediana y dispersión (Q1–Q3) por modalidad <span class="card-tag">Sección 4.3.1</span></div>
          ${buildModalityIntervalSVG()}
        </div>

        <div class="card">
          <div class="card-title">Tabla de cuartiles y RIC por modalidad <span class="card-tag">n = ${S.fmtInt(metrics.totalN)}</span></div>
          <table class="data-table">
            <thead>
              <tr><th>Modalidad</th><th class="num">Anuncios</th><th class="num">Mediana</th><th class="num">Q1</th><th class="num">Q3</th><th class="num">RIC</th></tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>

        <div class="card">
          <div class="card-title">Observaciones (4.3.1)</div>
          <ul class="finding-list">
            <li><strong>La modalidad marca la diferencia más clara:</strong> un alojamiento completo tiene mediana de <strong>${S.fmtMXN(comp.median)}</strong>, <strong>${(comp.median / priv.median).toFixed(2)}×</strong> la de una habitación privada (<strong>${S.fmtMXN(priv.median)}</strong>) y <strong>${(comp.median / shared.median).toFixed(2)}×</strong> la de una habitación compartida (<strong>${S.fmtMXN(shared.median)}</strong>).</li>
            <li><strong>Cautela con Habitación de hotel:</strong> registra la mediana más alta (<strong>${S.fmtMXN(hotel.median)}</strong>), pero corresponde a solo <strong>${S.fmtInt(hotel.n)} anuncios</strong> con un rango intercuartílico muy amplio (<strong>${S.fmtMXN(hotel.ric)}</strong>), por lo que no se le asigna el mismo peso que a las dos modalidades principales (<strong>${S.fmtPct(metrics.pctComparables, 1)}</strong> de la base).</li>
          </ul>
        </div>
      `;
      return;
    }

    // ---------------- ACTO 2: Capacidad 1 a 8 — Figura 14 (4.3.2) ----------------
    if (state.act === 2) {
      const pc = metrics.porCapacidad;
      const c2 = pc["Alojamiento completo"][2];
      const c8 = pc["Alojamiento completo"][8];
      const p2 = pc["Habitación privada"][2];
      const p8 = pc["Habitación privada"][8];
      const sh5 = pc["Habitación compartida"][5];
      const ht4 = pc["Habitación de hotel"][4];
      const ht6 = pc["Habitación de hotel"][6];

      const activeModsForLegend =
        state.fig14Filter === "comparables" ? COMPARABLES : MODALIDADES_ORDEN;

      const capRowsHtml = CAPACIDADES.map((cap) => {
        const cells = MODALIDADES_ORDEN.map((m) => {
          const d = pc[m][cap];
          if (!d || d.n === 0) return `<td class="num" style="color:#94a3b8">—</td>`;
          const lowCls = d.n < MIN_N_RELIABLE ? "low-n-cell" : "";
          if (state.capTableMetric === "n") {
            return `<td class="num ${lowCls}">${S.fmtInt(d.n)}</td>`;
          }
          const val = state.capTableMetric === "total" ? d.medTotal : d.medHuesped;
          return `<td class="num ${lowCls}"><strong>${S.fmtMXN(val)}</strong><span class="cell-sub">n=${S.fmtInt(d.n)}</span></td>`;
        }).join("");
        return `<tr><td><strong>${cap}</strong></td>${cells}</tr>`;
      }).join("");

      body.innerHTML = `
        <div class="card">
          <div class="card-title">
            <span>Figura 14 · Mediana del precio según capacidad y modalidad</span>
            <span class="card-tag">1 a 8 huéspedes</span>
          </div>

          <div class="segmented" role="group" aria-label="Filtro de visualización Figura 14" style="margin-bottom:8px;">
            <button class="seg-btn p3-f14-btn ${state.fig14Filter === "all" ? "active" : ""}" data-filter="all">Todas (4 modalidades)</button>
            <button class="seg-btn p3-f14-btn ${state.fig14Filter === "n30" ? "active" : ""}" data-filter="n30">Ocultar n &lt; 30</button>
            <button class="seg-btn p3-f14-btn ${state.fig14Filter === "comparables" ? "active" : ""}" data-filter="comparables">Completos y Privadas</button>
          </div>

          <div class="svg-inline-legend">
            ${activeModsForLegend
              .map((m) => `<span><i class="dot" style="background:${MOD_COLORES[m]}"></i>${m}</span>`)
              .join("")}
            <span style="color:#64748b;"><i class="dot-hollow"></i> n &lt; 30 (poca muestra)</span>
          </div>

          <div class="fig14-grid">
            ${buildLinePanelSVG("medTotal", "Precio total", "Mediana (MXN / noche)")}
            ${buildLinePanelSVG("medHuesped", "Precio por huésped", "MXN / huésped / noche")}
          </div>

          <div class="svg-footnote">
            Nota: el precio por huésped supone ocupación a capacidad máxima. Los círculos huecos señalan combinaciones con menos de 30 anuncios.
          </div>
        </div>

        <div class="card">
          <div class="card-title">
            <span>Tabla por capacidad (1–8) y modalidad</span>
            <div class="mini-tabs">
              <button class="mini-tab-btn ${state.capTableMetric === "total" ? "active" : ""}" data-m="total">Precio total</button>
              <button class="mini-tab-btn ${state.capTableMetric === "huesped" ? "active" : ""}" data-m="huesped">Por huésped</button>
              <button class="mini-tab-btn ${state.capTableMetric === "n" ? "active" : ""}" data-m="n">Anuncios (n)</button>
            </div>
          </div>
          <table class="data-table">
            <thead>
              <tr>
                <th>Cap.</th>
                <th class="num">Completo</th>
                <th class="num">Privada</th>
                <th class="num">Compartida</th>
                <th class="num">Hotel</th>
              </tr>
            </thead>
            <tbody>${capRowsHtml}</tbody>
          </table>
          <div class="svg-footnote">Celdas sombreadas en ámbar suave: grupos con menos de ${MIN_N_RELIABLE} anuncios.</div>
        </div>

        <div class="card">
          <div class="card-title">Observaciones (4.3.2)</div>
          <ul class="finding-list">
            <li><strong>Economía por persona en las dos modalidades principales:</strong> entre <strong>2 y 8 huéspedes</strong>, el precio total sube de <strong>${S.fmtMXN(c2.medTotal)} a ${S.fmtMXN(c8.medTotal)}</strong> en alojamientos completos mientras el precio por huésped baja de <strong>${S.fmtMXN(c2.medHuesped)} a ${S.fmtMXN(c8.medHuesped)}</strong>; en habitaciones privadas el total sube de <strong>${S.fmtMXN(p2.medTotal)} a ${S.fmtMXN(p8.medTotal)}</strong> y por huésped baja de <strong>${S.fmtMXN(p2.medHuesped)} a ${S.fmtMXN(p8.medHuesped)}</strong>.</li>
            <li><strong>Irregularidad por muestra pequeña en compartidas y hoteles:</strong> las habitaciones compartidas alcanzan <strong>${S.fmtMXN(sh5.medTotal)}</strong> en capacidad 5 con solo <strong>${S.fmtInt(sh5.n)} anuncios</strong>, y las de hotel muestran picos en capacidad 4 (<strong>${S.fmtMXN(ht4.medTotal)}</strong>, n=${S.fmtInt(ht4.n)}) y 6 (<strong>${S.fmtMXN(ht6.medTotal)}</strong>, n=${S.fmtInt(ht6.n)}), por lo que esos picos no son generalizables.</li>
          </ul>
        </div>
      `;

      body.querySelectorAll(".p3-f14-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          state.fig14Filter = btn.dataset.filter;
          renderActBody();
        });
      });

      body.querySelectorAll(".mini-tab-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          state.capTableMetric = btn.dataset.m;
          renderActBody();
        });
      });
      return;
    }

    // ---------------- ACTO 3: Correlaciones de Spearman y respuesta (4.3.3–4.3.4) ----------------
    const scopeObj = metrics.spearmanByScope[state.spearmanScope];
    const byKey = {};
    scopeObj.list.forEach((d) => (byKey[d.key] = d));

    const compScope = metrics.spearmanByScope.completo;
    const compByKey = {};
    compScope.list.forEach((d) => (compByKey[d.key] = d));

    const rowsHtml = scopeObj.list
      .map(
        (d) => `
        <tr>
          <td><strong>${d.label}</strong></td>
          <td class="num">${S.fmtInt(d.n)}</td>
          <td class="num"><strong style="color:${d.rho >= 0 ? "#1E3A5F" : "#B84A39"}">${S.fmtSigned(d.rho, 2)}</strong></td>
        </tr>`
      )
      .join("");

    const topVar = scopeObj.list[0];
    const secondVar = scopeObj.list[1];

    body.innerHTML = `
      <div class="card">
        <div class="card-title">
          <span>Correlación de Spearman con el precio</span>
          <span class="card-tag">Sección 4.3.3 · n = ${S.fmtInt(scopeObj.nTotal)}</span>
        </div>

        <div class="segmented" role="group" aria-label="Alcance de correlaciones" style="margin-bottom:10px;">
          <button class="seg-btn p3-sp-btn ${state.spearmanScope === "todos" ? "active" : ""}" data-scope="todos">Todos los alojamientos</button>
          <button class="seg-btn p3-sp-btn ${state.spearmanScope === "completo" ? "active" : ""}" data-scope="completo">Alojamiento completo</button>
          <button class="seg-btn p3-sp-btn ${state.spearmanScope === "privada" ? "active" : ""}" data-scope="privada">Habitación privada</button>
        </div>

        ${buildSpearmanSVG(scopeObj.list)}
      </div>

      <div class="card">
        <div class="card-title">Tabla de coeficientes · ${scopeObj.label} <span class="card-tag">Calculado del CSV</span></div>
        <table class="data-table">
          <thead>
            <tr><th>Característica</th><th class="num">Pares válidos (n)</th><th class="num">Spearman (ρ)</th></tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>

      <div class="card">
        <div class="card-title">Lectura y respuesta integrada (4.3.3 – 4.3.4)</div>
        <ul class="finding-list">
          <li><strong>Predominio de las características físicas (${scopeObj.label}):</strong> encabezan <strong>${topVar.label} (${S.fmtSigned(topVar.rho, 2)})</strong>, <strong>${secondVar.label} (${S.fmtSigned(secondVar.rho, 2)})</strong> y <strong>Camas (${S.fmtSigned(byKey.camas.rho, 2)})</strong>. Los alojamientos más grandes tienden a cobrar más, aunque con variabilidad considerable.</li>
          <li><strong>Otras variables con asociación débil o casi nula:</strong> Calificación muestra una relación positiva débil (<strong>${S.fmtSigned(byKey.calificacion.rho, 2)}</strong>), mientras que Número de reseñas (<strong>${S.fmtSigned(byKey.resenas.rho, 2)}</strong>) y Días disponibles al año (<strong>${S.fmtSigned(byKey.disponibilidad_365.rho, 2)}</strong>) presentan asociaciones débiles o cercanas a cero.</li>
          <li><strong>Efecto de controlar la modalidad:</strong> al pasar de <em>Todos los alojamientos</em> (donde Capacidad lidera por absorber diferencias entre modalidades) a <em>Alojamiento completo</em>, <strong>Recámaras (${S.fmtSigned(compByKey.recamaras.rho, 2)})</strong> supera a <strong>Capacidad (${S.fmtSigned(compByKey.capacidad.rho, 2)})</strong> y <strong>Camas (${S.fmtSigned(compByKey.camas.rho, 2)})</strong>.</li>
        </ul>
      </div>
    `;

    body.querySelectorAll(".p3-sp-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.spearmanScope = btn.dataset.scope;
        renderActBody();
      });
    });
  }

  function applyAct(actNum) {
    state.act = actNum;
    document.querySelectorAll(".p3-act-btn").forEach((b) => {
      b.classList.toggle("active", Number(b.dataset.act) === actNum);
    });
    renderActBody();
  }

  function renderShell() {
    refs.panelEl.innerHTML = `
      <div class="section-header">
        <span class="eyebrow">Pregunta 3 · Características del alojamiento</span>
        <h1>Relación del precio con modalidad, capacidad y recámaras</h1>
        <p class="subtitle">
          Evaluación estructural del precio anunciado por noche y por huésped según modalidad, tamaño y características físicas en 27,820 anuncios activos.
        </p>
      </div>

      <div class="acts-grid cols-3" role="tablist" aria-label="Secuencia narrativa Pregunta 3">
        <button class="act-btn p3-act-btn active" data-act="1"><span class="act-step">Acto 1</span><span class="act-label">Modalidad</span></button>
        <button class="act-btn p3-act-btn" data-act="2"><span class="act-step">Acto 2</span><span class="act-label">Capacidad (1–8)</span></button>
        <button class="act-btn p3-act-btn" data-act="3"><span class="act-step">Acto 3</span><span class="act-label">Spearman</span></button>
      </div>

      <div id="p3-act-body" class="p1-act-body"></div>
    `;

    document.querySelectorAll(".p3-act-btn").forEach((btn) => {
      btn.addEventListener("click", () => applyAct(Number(btn.dataset.act)));
    });
  }

  function showLoadFallback(errMsg) {
    refs.panelEl.innerHTML = `
      <div class="section-header">
        <span class="eyebrow">Pregunta 3 · Carga de datos</span>
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
        <input type="file" id="p3-file-input" accept=".csv" class="file-fallback" />
      </div>
    `;

    document.getElementById("p3-file-input").addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      allRows = await window.DataStore.loadFromFile(file);
      computeMetrics(allRows);
      renderShell();
      syncMapPoints();
      applyAct(1);
    });
  }

  async function mount(ctx) {
    refs = ctx;
    const sidePanel = document.getElementById("side-panel");
    if (sidePanel) sidePanel.classList.add("wide");

    refs.panelEl.innerHTML = `<div class="loading-box">Calculando métricas de Pregunta 3...</div>`;

    try {
      if (!allRows.length) {
        allRows = await window.DataStore.load();
        computeMetrics(allRows);
      }
      renderShell();
      syncMapPoints();
      applyAct(state.act);
      refs.mapApi.resetView();
    } catch (err) {
      showLoadFallback(err.message);
    }
  }

  function unmount() {
    const sidePanel = document.getElementById("side-panel");
    if (sidePanel) sidePanel.classList.remove("wide");
    if (refs.mapApi) {
      refs.mapApi.closePopups();
      refs.mapApi.clearOverlays();
      refs.mapApi.resetView();
    }
  }

  return { mount, unmount };
})();

if (window.AppShell) window.AppShell.register("p3", window.Pregunta3);