window.Pregunta2 = (() => {
  const LAT_ZOCALO = 19.432608;
  const LON_ZOCALO = -99.133209;

  const ANILLOS = ["<= 3 km", "3–7 km", "7–15 km", "> 15 km"];
  const CUADRANTES = ["NW", "SW", "NE", "SE"];
  const CUAD_NOMBRES = {
    NW: "Norponiente (NW)",
    SW: "Surponiente (SW)",
    NE: "Nororiente (NE)",
    SE: "Suroriente (SE)",
  };
  const CUAD_COLORES = {
    NW: "#B84A39",
    SW: "#1E3A5F",
    NE: "#8B6D3F",
    SE: "#2F6F62",
  };
  const DIST_RING_COLORES = {
    "<= 3 km": "#B84A39",
    "3–7 km": "#8B6D3F",
    "7–15 km": "#4E79A7",
    "> 15 km": "#1E3A5F",
  };

  let allRows = [];
  let metrics = null;
  let refs = { panelEl: null, legendEl: null, mapApi: null, store: null };

  const state = {
    act: 1,
    segmento: "Todos",
    anillo: "Todos",
    cuadrante: "Todos",
    showRings: false,
    showAxes: false,
  };

  function classifyAnillo(d) {
    if (d <= 3) return "<= 3 km";
    if (d <= 7) return "3–7 km";
    if (d <= 15) return "7–15 km";
    return "> 15 km";
  }

  function classifyCuadrante(lat, lon) {
    if (lat >= LAT_ZOCALO && lon < LON_ZOCALO) return "NW";
    if (lat < LAT_ZOCALO && lon < LON_ZOCALO) return "SW";
    if (lat >= LAT_ZOCALO && lon >= LON_ZOCALO) return "NE";
    return "SE";
  }

  // Asimetría muestral ajustada (equivalente exacto a pandas.Series.skew())
  function skewness(arr) {
    const v = arr.filter(Number.isFinite);
    const n = v.length;
    if (n < 3) return NaN;
    const m = window.Stats.mean(v);
    const sd = window.Stats.std(v);
    if (!sd) return 0;
    let sum3 = 0;
    for (let i = 0; i < n; i++) sum3 += ((v[i] - m) / sd) ** 3;
    return (n / ((n - 1) * (n - 2))) * sum3;
  }

  // Perfil por tramos de 1 km hasta 20 km (n >= 15), equivalente a pd.cut(..., np.arange(0, 21, 1))
  function profileByKm(rows, maxKm = 20, minN = 15) {
    const S = window.Stats;
    const bins = Array.from({ length: maxKm }, () => []);
    for (let i = 0; i < rows.length; i++) {
      const d = rows[i].dist_km;
      if (d > 0 && d <= maxKm) {
        const idx = Math.min(maxKm - 1, Math.ceil(d) - 1);
        if (idx >= 0) bins[idx].push(rows[i].precio);
      }
    }
    const out = [];
    for (let b = 0; b < maxKm; b++) {
      if (bins[b].length >= minN) {
        const sorted = S.sortedNumbers(bins[b]);
        out.push({
          km: b + 0.5,
          n: sorted.length,
          median: S.quantileSorted(sorted, 0.5),
          mean: S.mean(sorted),
        });
      }
    }
    return out;
  }

  // Muestreo determinístico para las facetas 2×2 (mantiene ligero el SVG)
  function sampleEvenly(arr, maxN) {
    if (arr.length <= maxN) return arr;
    const out = [];
    const step = (arr.length - 1) / (maxN - 1);
    for (let i = 0; i < maxN; i++) out.push(arr[Math.round(i * step)]);
    return out;
  }

  function processRows(rawRows) {
    const S = window.Stats;
    const clean = [];
    const prices = [];

    for (let i = 0; i < rawRows.length; i++) {
      const r = rawRows[i];
      const lat = Number(r.lat ?? r.latitude);
      const lon = Number(r.lon ?? r.longitude);
      const precio = Number(r.precio ?? r.price);
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(precio) || precio <= 0) {
        continue;
      }
      const dist = Math.round(S.haversineKm(lat, lon, LAT_ZOCALO, LON_ZOCALO) * 1000) / 1000;
      const cuad = classifyCuadrante(lat, lon);
      prices.push(precio);
      clean.push({
        lat,
        lon,
        precio,
        log_precio: Number.isFinite(r.log_precio) ? r.log_precio : Math.log10(precio),
        dist_km: dist,
        anillo: classifyAnillo(dist),
        cuadrante: cuad,
        sector: lon < LON_ZOCALO ? "Poniente" : "Oriente",
        alcaldia: String(r.alcaldia || "Sin dato").trim(),
        modalidad: String(r.modalidad || "Sin dato").trim(),
        segmento: "Tipico",
      });
    }

    const sortedP = S.sortedNumbers(prices);
    const q1 = S.quantileSorted(sortedP, 0.25);
    const q3 = S.quantileSorted(sortedP, 0.75);
    const umbralAlto = q3 + 1.5 * (q3 - q1);

    for (let i = 0; i < clean.length; i++) {
      clean[i].segmento = clean[i].precio > umbralAlto ? "Alto" : "Tipico";
    }

    allRows = clean;
    computeMasterMetrics(umbralAlto);
  }

  function computeMasterMetrics(umbralAlto) {
    const S = window.Stats;
    const tipico = allRows.filter((r) => r.segmento === "Tipico");
    const alto = allRows.filter((r) => r.segmento === "Alto");

    // 4.2.1 Distribución de dist_centro_km y precio
    const distVals = allRows.map((r) => r.dist_km);
    const distSorted = S.sortedNumbers(distVals);
    const priceVals = allRows.map((r) => r.precio);
    const distSummary = {
      n: distSorted.length,
      mean: S.mean(distSorted),
      median: S.quantileSorted(distSorted, 0.5),
      std: S.std(distSorted),
      q1: S.quantileSorted(distSorted, 0.25),
      q3: S.quantileSorted(distSorted, 0.75),
      p80: S.quantileSorted(distSorted, 0.8),
      p95: S.quantileSorted(distSorted, 0.95),
      min: distSorted[0],
      max: distSorted[distSorted.length - 1],
      iqr: S.quantileSorted(distSorted, 0.75) - S.quantileSorted(distSorted, 0.25),
      skew: skewness(distSorted),
    };

    // Histograma (30 bins) y ECDF muestreada
    const nBins = 30;
    const binW = (distSummary.max - distSummary.min) / nBins || 1;
    const histCounts = new Array(nBins).fill(0);
    for (let i = 0; i < distSorted.length; i++) {
      const idx = Math.min(nBins - 1, Math.floor((distSorted[i] - distSummary.min) / binW));
      histCounts[idx]++;
    }
    const histBins = histCounts.map((cnt, i) => ({
      x0: distSummary.min + i * binW,
      x1: distSummary.min + (i + 1) * binW,
      density: cnt / (distSorted.length * binW),
      count: cnt,
    }));

    const ecdfPts = [];
    const ecdfSteps = 90;
    for (let i = 0; i <= ecdfSteps; i++) {
      const frac = i / ecdfSteps;
      const idx = Math.min(distSorted.length - 1, Math.round(frac * (distSorted.length - 1)));
      ecdfPts.push({ x: distSorted[idx], y: (idx + 1) / distSorted.length });
    }

    // 4.2.2 Correlaciones globales y discretizaciones (cut, q=4, q=5, q=8)
    const baseStats = { ...S.summarize(allRows), skew: skewness(priceVals) };
    const logPearson = S.pearson(distVals, allRows.map((r) => r.log_precio));
    const logSpearman = S.spearman(distVals, allRows.map((r) => r.log_precio));

    const tipicoStats = S.summarize(tipico);
    const altoStats = S.summarize(alto);

    const anillosBase = ANILLOS.map((a) => ({
      anillo: a,
      ...S.summarize(allRows.filter((r) => r.anillo === a)),
    }));
    const anillosTip = ANILLOS.map((a) => ({
      anillo: a,
      ...S.summarize(tipico.filter((r) => r.anillo === a)),
    }));
    const anillosAlto = ANILLOS.map((a) => ({
      anillo: a,
      ...S.summarize(alto.filter((r) => r.anillo === a)),
    }));

    const q4Base = S.qcutGroups(allRows, "dist_km", 4, "Q");
    const q5Base = S.qcutGroups(allRows, "dist_km", 5, "Q");
    const q8Base = S.qcutGroups(allRows, "dist_km", 8, "O");

    // 4.2.3 Perfil lineal por km en segmento típico
    const perfilKmTip = profileByKm(tipico, 20, 15);

    // 4.2.4 Cuadrantes y sectores Poniente vs. Oriente
    const cuadStatsTip = {};
    const cuadProfiles = {};
    const cuadSamples = {};
    CUADRANTES.forEach((c) => {
      const sub = tipico.filter((r) => r.cuadrante === c);
      cuadStatsTip[c] = S.summarize(sub);
      cuadProfiles[c] = profileByKm(sub, 20, 15);
      cuadSamples[c] = sampleEvenly(
        sub.filter((r) => r.dist_km <= 21),
        220
      );
    });

    const ponTip = tipico.filter((r) => r.sector === "Poniente");
    const oriTip = tipico.filter((r) => r.sector === "Oriente");
    const ponAlto = alto.filter((r) => r.sector === "Poniente");
    const oriAlto = alto.filter((r) => r.sector === "Oriente");
    const ponAll = allRows.filter((r) => r.sector === "Poniente");
    const oriAll = allRows.filter((r) => r.sector === "Oriente");

    const sectorTip = {
      Poniente: S.summarize(ponTip),
      Oriente: S.summarize(oriTip),
      pctOfertaPon: (ponTip.length / tipico.length) * 100,
      pctAltoPon: alto.length ? (ponAlto.length / alto.length) * 100 : 0,
      tasaAltoPon: ponAll.length ? (ponAlto.length / ponAll.length) * 100 : 0,
      tasaAltoOri: oriAll.length ? (oriAlto.length / oriAll.length) * 100 : 0,
      nAltoPon: ponAlto.length,
      nAltoOri: oriAlto.length,
    };

    const matrix = {};
    let matMin = Infinity;
    let matMax = -Infinity;
    CUADRANTES.forEach((c) => {
      matrix[c] = {};
      ANILLOS.forEach((a) => {
        const sub = tipico.filter((r) => r.cuadrante === c && r.anillo === a);
        const med = sub.length ? S.quantileSorted(S.sortedNumbers(sub.map((x) => x.precio)), 0.5) : NaN;
        matrix[c][a] = { n: sub.length, median: med };
        if (Number.isFinite(med)) {
          if (med < matMin) matMin = med;
          if (med > matMax) matMax = med;
        }
      });
    });

    metrics = {
      umbralAlto,
      distSummary,
      histBins,
      ecdfPts,
      baseStats,
      logPearson,
      logSpearman,
      tipicoStats,
      altoStats,
      anillosBase,
      anillosTip,
      anillosAlto,
      q4Base,
      q5Base,
      q8Base,
      perfilKmTip,
      cuadStatsTip,
      cuadProfiles,
      cuadSamples,
      sectorTip,
      matrix,
      matMin,
      matMax,
    };
  }

  function getFilteredRows() {
    return allRows.filter((r) => {
      if (state.segmento !== "Todos" && r.segmento !== state.segmento) return false;
      if (state.anillo !== "Todos" && r.anillo !== state.anillo) return false;
      if (state.cuadrante === "Poniente" && r.sector !== "Poniente") return false;
      if (state.cuadrante === "Oriente" && r.sector !== "Oriente") return false;
      if (CUADRANTES.includes(state.cuadrante) && r.cuadrante !== state.cuadrante) return false;
      return true;
    });
  }

  function drawOverlays() {
    const group = refs.mapApi.getOverlayGroup();
    const renderer = refs.mapApi.getGeometryRenderer();
    group.clearLayers();

    // 1. Anillos concéntricos reales (3, 7 y 15 km) en SVG por encima de los puntos
    if (state.showRings) {
      [3000, 7000, 15000].forEach((radiusM) => {
        L.circle([LAT_ZOCALO, LON_ZOCALO], {
          radius: radiusM,
          color: "#FFFFFF",
          weight: 3.8,
          opacity: 0.72,
          fill: false,
          interactive: false,
          pane: "geometryPane",
          renderer,
        }).addTo(group);

        L.circle([LAT_ZOCALO, LON_ZOCALO], {
          radius: radiusM,
          color: "#1E293B",
          weight: 1.7,
          dashArray: "6 5",
          opacity: 0.92,
          fill: false,
          interactive: false,
          pane: "geometryPane",
          renderer,
        }).addTo(group);

        const latLabel = LAT_ZOCALO + radiusM / 111320;
        L.marker([latLabel, LON_ZOCALO], {
          interactive: false,
          icon: L.divIcon({
            className: "custom-map-marker",
            html: `<div class="map-ring-label">${radiusM / 1000} km</div>`,
            iconSize: [0, 0],
            iconAnchor: [0, 0],
          }),
        }).addTo(group);
      });
    }

    // 2. Ejes cardinales ortogonales desde el Zócalo + etiquetas de cuadrantes
    if (state.showAxes) {
      const ejes = [
        [[19.04, LON_ZOCALO], [19.60, LON_ZOCALO]],
        [[LAT_ZOCALO, -99.37], [LAT_ZOCALO, -98.94]],
      ];

      ejes.forEach((coords) => {
        L.polyline(coords, {
          color: "#FFFFFF",
          weight: 4.2,
          opacity: 0.78,
          interactive: false,
          pane: "geometryPane",
          renderer,
        }).addTo(group);

        L.polyline(coords, {
          color: "#0F172A",
          weight: 1.9,
          dashArray: "5 5",
          opacity: 0.92,
          interactive: false,
          pane: "geometryPane",
          renderer,
        }).addTo(group);
      });

      const labelPos = {
        NW: [19.476, -99.198],
        SW: [19.335, -99.218],
        NE: [19.476, -99.070],
        SE: [19.335, -99.060],
      };
      CUADRANTES.forEach((c) => {
        const s = metrics.cuadStatsTip[c];
        L.marker(labelPos[c], {
          interactive: false,
          icon: L.divIcon({
            className: "custom-map-marker",
            html: `<div class="map-quad-label">${c} · ${window.Stats.fmtMXN(s.median)} (ρ ${window.Stats.fmtSigned(s.spearman)})</div>`,
            iconSize: [0, 0],
            iconAnchor: [0, 0],
          }),
        }).addTo(group);
      });
    }

    // 3. Marcador del Zócalo siempre al frente
    L.circleMarker([LAT_ZOCALO, LON_ZOCALO], {
      radius: 6.5,
      color: "#FFFFFF",
      weight: 2.5,
      fillColor: "#B84A39",
      fillOpacity: 1,
      pane: "geometryPane",
      renderer,
    })
      .bindTooltip("Zócalo CDMX (0 km)", { direction: "top", offset: [0, -7] })
      .addTo(group);
  }

  function pointStyleForAct() {
    const S = window.Stats;
    const q1 = metrics.baseStats.q1;
    const med = metrics.baseStats.median;
    const q3 = metrics.baseStats.q3;

    const popupFn = (p) => `
      <div class="popup-title">${p.alcaldia}</div>
      <div class="popup-grid">
        <span class="popup-k">Precio / noche</span><span class="popup-v">${S.fmtMXN(p.precio, 2)} MXN</span>
        <span class="popup-k">Distancia Zócalo</span><span class="popup-v">${p.dist_km.toFixed(2)} km (${p.anillo})</span>
        <span class="popup-k">Cuadrante</span><span class="popup-v">${CUAD_NOMBRES[p.cuadrante]}</span>
        <span class="popup-k">Segmento</span><span class="popup-v">${p.segmento === "Alto" ? "Segmento alto" : "Segmento típico"}</span>
      </div>
    `;

    // Acto 1: Coloreado por distancia al Zócalo (4.2.1)
    if (state.act === 1) {
      return {
        colorFn: (p) => DIST_RING_COLORES[p.anillo] || "#1E3A5F",
        radiusFn: () => 2.0,
        alphaFn: () => 0.5,
        popupFn,
      };
    }

    // Acto 2: Coloreado por cuartiles de precio (4.2.2)
    if (state.act === 2) {
      return {
        colorFn: (p) => {
          if (p.precio <= q1) return "#94A3B8";
          if (p.precio <= med) return "#4E79A7";
          if (p.precio <= q3) return "#1E3A5F";
          return "#B84A39";
        },
        radiusFn: (p) => (p.precio > metrics.umbralAlto ? 2.7 : 2.0),
        alphaFn: () => 0.48,
        popupFn,
      };
    }

    // Acto 3: Segmento alto resaltado sobre segmento típico (4.2.3)
    if (state.act === 3) {
      return {
        colorFn: (p) => (p.segmento === "Alto" ? "#B84A39" : "#64748B"),
        radiusFn: (p) => (p.segmento === "Alto" ? 3.2 : 1.8),
        alphaFn: (p) => (p.segmento === "Alto" ? 0.82 : 0.22),
        popupFn,
      };
    }

    // Acto 4: Cuadrantes cardinales (4.2.4)
    return {
      colorFn: (p) => CUAD_COLORES[p.cuadrante] || "#64748B",
      radiusFn: () => 2.1,
      alphaFn: () => 0.48,
      popupFn,
    };
  }

  function renderLegend() {
    const S = window.Stats;
    const el = refs.legendEl;

    if (state.act === 1) {
      el.innerHTML =
        `<div class="legend-title">Distancia al Zócalo (km)</div>` +
        metrics.anillosBase
          .map(
            (a) => `
            <div class="legend-item">
              <span class="legend-left"><span class="swatch" style="background:${DIST_RING_COLORES[a.anillo]}"></span>${a.anillo}</span>
              <span class="mono">${S.fmtPct((a.n / metrics.baseStats.n) * 100, 1)}</span>
            </div>`
          )
          .join("");
    } else if (state.act === 2) {
      el.innerHTML = `
        <div class="legend-title">Precio por noche (cuartiles)</div>
        <div class="legend-item"><span class="legend-left"><span class="swatch" style="background:#94A3B8"></span>&le; Q1</span><span class="mono">${S.fmtMXN(metrics.baseStats.q1)}</span></div>
        <div class="legend-item"><span class="legend-left"><span class="swatch" style="background:#4E79A7"></span>Q1 – Mediana</span><span class="mono">${S.fmtMXN(metrics.baseStats.median)}</span></div>
        <div class="legend-item"><span class="legend-left"><span class="swatch" style="background:#1E3A5F"></span>Mediana – Q3</span><span class="mono">${S.fmtMXN(metrics.baseStats.q3)}</span></div>
        <div class="legend-item"><span class="legend-left"><span class="swatch" style="background:#B84A39"></span>&gt; Q3</span><span class="mono">&gt; ${S.fmtMXN(metrics.baseStats.q3)}</span></div>
      `;
    } else if (state.act === 3) {
      el.innerHTML = `
        <div class="legend-title">Frontera Q3 + 1.5×RIC</div>
        <div class="legend-item"><span class="legend-left"><span class="swatch" style="background:#64748B"></span>Típico (&le; ${S.fmtMXN(metrics.umbralAlto)})</span><span class="mono">${S.fmtPct((metrics.tipicoStats.n / metrics.baseStats.n) * 100, 1)}</span></div>
        <div class="legend-item"><span class="legend-left"><span class="swatch" style="background:#B84A39"></span>Alto (&gt; ${S.fmtMXN(metrics.umbralAlto)})</span><span class="mono">${S.fmtPct((metrics.altoStats.n / metrics.baseStats.n) * 100, 1)}</span></div>
      `;
    } else {
      el.innerHTML =
        `<div class="legend-title">Cuadrantes cardinales (típico)</div>` +
        CUADRANTES.map(
          (c) => `
          <div class="legend-item">
            <span class="legend-left"><span class="swatch" style="background:${CUAD_COLORES[c]}"></span>${CUAD_NOMBRES[c]}</span>
            <span class="mono">${S.fmtMXN(metrics.cuadStatsTip[c].median)}</span>
          </div>`
        ).join("");
    }
  }

  // --- SVG Acto 1: Histograma de densidad + Proporción acumulada (ECDF) ---
  function buildHistEcdfSVG() {
    const d = metrics.distSummary;
    const W = 240;
    const H = 175;
    const pad = { top: 14, right: 10, bottom: 26, left: 36 };
    const pw = W - pad.left - pad.right;
    const ph = H - pad.top - pad.bottom;

    const maxX = Math.ceil(d.max / 5) * 5;
    const xOf = (v) => pad.left + (v / maxX) * pw;
    const xTicks = [0, 5, 10, 15, 20, 25, 30].filter((t) => t <= maxX);

    // Panel A: Histograma
    const maxDens = Math.max(...metrics.histBins.map((b) => b.density)) * 1.1;
    const yH = (v) => pad.top + (1 - v / maxDens) * ph;
    const barsHtml = metrics.histBins
      .map((b) => {
        const x = xOf(b.x0);
        const w = Math.max(1.5, xOf(b.x1) - x - 0.6);
        const y = yH(b.density);
        return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${(pad.top + ph - y).toFixed(1)}" fill="#4E79A7" fill-opacity="0.72" rx="1"><title>${b.x0.toFixed(1)}–${b.x1.toFixed(1)} km: ${window.Stats.fmtInt(b.count)} anuncios</title></rect>`;
      })
      .join("");

    const xP50 = xOf(d.median);
    const histSvg = `
      <div class="fig14-panel">
        <div class="fig14-panel-title">Distribución de dist_centro_km</div>
        <svg viewBox="0 0 ${W} ${H}" class="p1-svg" role="img" aria-label="Histograma de distancia al Zócalo">
          ${[0, 0.05, 0.1, 0.15].filter((t) => t <= maxDens).map((t) => {
            const y = yH(t);
            return `<line x1="${pad.left}" y1="${y}" x2="${W - pad.right}" y2="${y}" stroke="#E2E8F0" stroke-width="1" />
                    <text x="${pad.left - 4}" y="${y + 3}" text-anchor="end" class="svg-axis-txt" style="font-size:8.5px">${t.toFixed(2)}</text>`;
          }).join("")}
          ${barsHtml}
          <line x1="${xP50}" y1="${pad.top}" x2="${xP50}" y2="${pad.top + ph}" stroke="#B84A39" stroke-width="1.5" stroke-dasharray="4 3" />
          <text x="${xP50 + 4}" y="${pad.top + 10}" class="svg-sub-txt" style="fill:#B84A39;font-weight:600">Med: ${d.median.toFixed(2)} km</text>
          ${xTicks.map((t) => `<text x="${xOf(t)}" y="${H - 11}" text-anchor="middle" class="svg-axis-txt" style="font-size:8.5px">${t}</text>`).join("")}
          <text x="${pad.left + pw / 2}" y="${H - 1}" text-anchor="middle" class="svg-sub-txt" style="font-size:8.2px">Distancia al Zócalo (km)</text>
        </svg>
      </div>
    `;

    // Panel B: ECDF
    const yE = (v) => pad.top + (1 - v) * ph;
    const polyPts = metrics.ecdfPts.map((p) => `${xOf(p.x).toFixed(1)},${yE(p.y).toFixed(1)}`).join(" ");
    const y50 = yE(0.5);
    const y80 = yE(0.8);

    const ecdfSvg = `
      <div class="fig14-panel">
        <div class="fig14-panel-title">Proporción acumulada</div>
        <svg viewBox="0 0 ${W} ${H}" class="p1-svg" role="img" aria-label="Proporción acumulada de anuncios por distancia">
          ${[0, 0.25, 0.5, 0.75, 1.0].map((t) => {
            const y = yE(t);
            return `<line x1="${pad.left}" y1="${y}" x2="${W - pad.right}" y2="${y}" stroke="#E2E8F0" stroke-width="1" />
                    <text x="${pad.left - 4}" y="${y + 3}" text-anchor="end" class="svg-axis-txt" style="font-size:8.5px">${Math.round(t * 100)}%</text>`;
          }).join("")}
          <line x1="${pad.left}" y1="${y50}" x2="${W - pad.right}" y2="${y50}" stroke="#8B6D3F" stroke-width="1.2" stroke-dasharray="4 3" />
          <line x1="${pad.left}" y1="${y80}" x2="${W - pad.right}" y2="${y80}" stroke="#B84A39" stroke-width="1.2" stroke-dasharray="4 3" />
          <polyline fill="none" stroke="#1E3A5F" stroke-width="2" points="${polyPts}" />
          <text x="${W - pad.right - 3}" y="${y50 - 3}" text-anchor="end" class="svg-sub-txt" style="fill:#8B6D3F;font-weight:600">50% &le; ${d.median.toFixed(2)} km</text>
          <text x="${W - pad.right - 3}" y="${y80 - 3}" text-anchor="end" class="svg-sub-txt" style="fill:#B84A39;font-weight:600">80% &le; ${d.p80.toFixed(2)} km</text>
          ${xTicks.map((t) => `<text x="${xOf(t)}" y="${H - 11}" text-anchor="middle" class="svg-axis-txt" style="font-size:8.5px">${t}</text>`).join("")}
          <text x="${pad.left + pw / 2}" y="${H - 1}" text-anchor="middle" class="svg-sub-txt" style="font-size:8.2px">Distancia al Zócalo (km)</text>
        </svg>
      </div>
    `;

    return `<div class="p2-dual-grid">${histSvg}${ecdfSvg}</div>`;
  }

  // --- SVG Acto 2: Trayectoria mediana en los 4 cortes (pd.cut vs q=4, 5, 8) ---
  function buildTrajectorySVG() {
    const S = window.Stats;
    const W = 490;
    const H = 208;
    const pad = { top: 14, right: 16, bottom: 30, left: 52 };
    const pw = W - pad.left - pad.right;
    const ph = H - pad.top - pad.bottom;

    const series = [
      { label: "4 anillos (cut)", data: metrics.anillosBase.map((a) => ({ x: a.distMedian, y: a.median, lbl: a.anillo })), color: "#1E3A5F", dash: "6 4", shape: "square" },
      { label: "Cuartiles (q=4)", data: metrics.q4Base.map((a) => ({ x: a.distMedian, y: a.median, lbl: a.label })), color: "#8B6D3F", dash: "3 3", shape: "diamond" },
      { label: "Quintiles (q=5)", data: metrics.q5Base.map((a) => ({ x: a.distMedian, y: a.median, lbl: a.label })), color: "#2F6F62", dash: "", shape: "circle" },
      { label: "Octiles (q=8)", data: metrics.q8Base.map((a) => ({ x: a.distMedian, y: a.median, lbl: a.label })), color: "#B84A39", dash: "", shape: "triangle" },
    ];

    const allX = series.flatMap((s) => s.data.map((p) => p.x));
    const allY = series.flatMap((s) => s.data.map((p) => p.y));
    const xMax = Math.max(18, Math.ceil(Math.max(...allX)));
    const yMin = Math.floor(Math.min(...allY) / 100) * 100 - 50;
    const yMax = Math.ceil(Math.max(...allY) / 100) * 100 + 50;

    const xOf = (v) => pad.left + (v / xMax) * pw;
    const yOf = (v) => pad.top + ((yMax - v) / (yMax - yMin)) * ph;

    const drawMarker = (shape, cx, cy, col, tip) => {
      if (shape === "square") return `<rect x="${(cx - 3.3).toFixed(1)}" y="${(cy - 3.3).toFixed(1)}" width="6.6" height="6.6" fill="${col}" stroke="#FFFFFF" stroke-width="1"><title>${tip}</title></rect>`;
      if (shape === "triangle") return `<polygon points="${cx.toFixed(1)},${(cy - 4.4).toFixed(1)} ${(cx - 4).toFixed(1)},${(cy + 3.2).toFixed(1)} ${(cx + 4).toFixed(1)},${(cy + 3.2).toFixed(1)}" fill="${col}" stroke="#FFFFFF" stroke-width="1"><title>${tip}</title></polygon>`;
      if (shape === "diamond") return `<polygon points="${cx.toFixed(1)},${(cy - 4.2).toFixed(1)} ${(cx + 4).toFixed(1)},${cy.toFixed(1)} ${cx.toFixed(1)},${(cy + 4.2).toFixed(1)} ${(cx - 4).toFixed(1)},${cy.toFixed(1)}" fill="${col}" stroke="#FFFFFF" stroke-width="1"><title>${tip}</title></polygon>`;
      return `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="3.6" fill="${col}" stroke="#FFFFFF" stroke-width="1"><title>${tip}</title></circle>`;
    };

    const yTicks = [];
    for (let v = Math.ceil(yMin / 100) * 100; v <= yMax; v += 100) {
      if (v % 200 === 0 || yMax - yMin <= 700) yTicks.push(v);
    }

    const grid = yTicks
      .map((t) => {
        const y = yOf(t);
        return `<line x1="${pad.left}" y1="${y}" x2="${W - pad.right}" y2="${y}" stroke="#E2E8F0" stroke-width="1" />
                <text x="${pad.left - 6}" y="${y + 3}" text-anchor="end" class="svg-axis-txt">${S.fmtMXN(t)}</text>`;
      })
      .join("");

    const xTicks = [0, 2, 4, 6, 8, 10, 12, 14, 16, 18].filter((t) => t <= xMax);
    const xGrid = xTicks
      .map((t) => `<text x="${xOf(t)}" y="${H - 13}" text-anchor="middle" class="svg-axis-txt">${t}</text>`)
      .join("");

    const paths = series
      .map((s) => {
        const pts = s.data.map((p) => `${xOf(p.x).toFixed(1)},${yOf(p.y).toFixed(1)}`).join(" ");
        const markers = s.data
          .map((p) => drawMarker(s.shape, xOf(p.x), yOf(p.y), s.color, `${p.lbl}\nMediana: ${S.fmtMXN(p.y, 2)}\nDist. mediana: ${p.x.toFixed(2)} km`))
          .join("");
        return `
          <polyline fill="none" stroke="${s.color}" stroke-width="1.9" ${s.dash ? `stroke-dasharray="${s.dash}"` : ""} points="${pts}" opacity="0.92" />
          ${markers}
        `;
      })
      .join("");

    return `
      <div class="svg-inline-legend">
        ${series.map((s) => `<span><i class="dot" style="background:${s.color}"></i>${s.label}</span>`).join("")}
      </div>
      <svg viewBox="0 0 ${W} ${H}" class="p1-svg" role="img" aria-label="Trayectoria del precio mediano en los cuatro esquemas de corte">
        ${grid}
        ${xGrid}
        ${paths}
        <text x="${pad.left + pw / 2}" y="${H - 1}" text-anchor="middle" class="svg-sub-txt">Distancia mediana del grupo al Zócalo (km)</text>
      </svg>
    `;
  }

  // --- SVG compartido (Acto 2 y Acto 3): Intervalos RIC (Q1–Q3), Mediana y Media por anillo ---
  function buildRingIntervalsSVG(ringStats) {
    const S = window.Stats;
    const W = 490;
    const rowH = 29;
    const pad = { top: 10, right: 16, bottom: 26, left: 66 };
    const H = pad.top + ringStats.length * rowH + pad.bottom;
    const pw = W - pad.left - pad.right;

    const minX = Math.floor(Math.min(...ringStats.map((r) => r.q1)) / 200) * 200;
    const maxX = Math.ceil(Math.max(...ringStats.map((r) => Math.max(r.q3, r.mean))) / 200) * 200 + 100;
    const xOf = (v) => pad.left + ((v - minX) / (maxX - minX)) * pw;

    const step = maxX - minX > 1600 ? 400 : 200;
    const ticks = [];
    for (let v = minX; v <= maxX; v += step) ticks.push(v);

    const grid = ticks
      .map((t) => {
        const x = xOf(t);
        return `<line x1="${x}" y1="${pad.top}" x2="${x}" y2="${H - pad.bottom}" stroke="#E2E8F0" stroke-width="1" />
                <text x="${x}" y="${H - 7}" text-anchor="middle" class="svg-axis-txt">${S.fmtMXN(t)}</text>`;
      })
      .join("");

    const rowsHtml = ringStats
      .map((r, i) => {
        const y = pad.top + i * rowH + rowH / 2;
        const x1 = xOf(r.q1);
        const x2 = xOf(r.q3);
        const xm = xOf(r.median);
        const xmean = xOf(r.mean);
        const diam = `${xmean.toFixed(1)},${(y - 5.2).toFixed(1)} ${(xmean + 4.8).toFixed(1)},${y.toFixed(1)} ${xmean.toFixed(1)},${(y + 5.2).toFixed(1)} ${(xmean - 4.8).toFixed(1)},${y.toFixed(1)}`;
        return `
          <g>
            <title>${r.anillo} (n=${S.fmtInt(r.n)})&#10;Q1–Q3: ${S.fmtMXN(r.q1)} – ${S.fmtMXN(r.q3)}&#10;Mediana: ${S.fmtMXN(r.median, 2)}&#10;Media: ${S.fmtMXN(r.mean, 2)} (brecha +${S.fmtMXN(r.brecha, 2)})</title>
            <text x="${pad.left - 8}" y="${y + 3.5}" text-anchor="end" class="svg-row-lbl" style="font-weight:600">${r.anillo}</text>
            <line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="#4E79A7" stroke-width="6" stroke-linecap="round" opacity="0.48" />
            <circle cx="${xm}" cy="${y}" r="4.6" fill="#1E3A5F" stroke="#FFFFFF" stroke-width="1.3" />
            <polygon points="${diam}" fill="#B84A39" stroke="#FFFFFF" stroke-width="1" />
          </g>
        `;
      })
      .join("");

    return `
      <div class="svg-inline-legend">
        <span><i class="bar-sample"></i> RIC (Q1–Q3)</span>
        <span><i class="dot" style="background:#1E3A5F"></i> Mediana</span>
        <span><i class="diamond-sample"></i> Media</span>
      </div>
      <svg viewBox="0 0 ${W} ${H}" class="p1-svg" role="img" aria-label="Intervalos Q1-Q3, mediana y media por anillo urbano">
        ${grid}
        ${rowsHtml}
      </svg>
    `;
  }

  // --- SVG Acto 3: Perfil lineal por km (Mediana vs. Media en segmento típico) ---
  function buildLinearProfileSVG() {
    const S = window.Stats;
    const pts = metrics.perfilKmTip;
    const W = 490;
    const H = 175;
    const pad = { top: 14, right: 16, bottom: 28, left: 50 };
    const pw = W - pad.left - pad.right;
    const ph = H - pad.top - pad.bottom;

    const maxY = Math.ceil(Math.max(...pts.map((p) => Math.max(p.mean, p.median))) / 200) * 200 + 200;
    const xOf = (v) => pad.left + (v / 20) * pw;
    const yOf = (v) => pad.top + (1 - v / maxY) * ph;

    const yTicks = [];
    for (let v = 0; v <= maxY; v += 500) yTicks.push(v);

    const grid = yTicks
      .map((t) => {
        const y = yOf(t);
        return `<line x1="${pad.left}" y1="${y}" x2="${W - pad.right}" y2="${y}" stroke="#E2E8F0" stroke-width="1" />
                <text x="${pad.left - 6}" y="${y + 3}" text-anchor="end" class="svg-axis-txt">${S.fmtMXN(t)}</text>`;
      })
      .join("");

    const medPts = pts.map((p) => `${xOf(p.km).toFixed(1)},${yOf(p.median).toFixed(1)}`).join(" ");
    const meanPts = pts.map((p) => `${xOf(p.km).toFixed(1)},${yOf(p.mean).toFixed(1)}`).join(" ");
    const dots = pts
      .map(
        (p) =>
          `<circle cx="${xOf(p.km).toFixed(1)}" cy="${yOf(p.median).toFixed(1)}" r="2.7" fill="#1E3A5F"><title>${(p.km - 0.5).toFixed(0)}–${(p.km + 0.5).toFixed(0)} km (n=${S.fmtInt(p.n)})\nMediana: ${S.fmtMXN(p.median)}\nMedia: ${S.fmtMXN(p.mean)}</title></circle>`
      )
      .join("");

    return `
      <div class="svg-inline-legend">
        <span><i class="dot" style="background:#1E3A5F"></i> Mediana por km</span>
        <span style="color:#B84A39;">--- Media por km (escala lineal)</span>
      </div>
      <svg viewBox="0 0 ${W} ${H}" class="p1-svg" role="img" aria-label="Mediana y media por kilómetro en segmento típico">
        ${grid}
        ${[0, 2.5, 5, 7.5, 10, 12.5, 15, 17.5, 20].map((t) => `<text x="${xOf(t)}" y="${H - 11}" text-anchor="middle" class="svg-axis-txt">${t}</text>`).join("")}
        <polyline fill="none" stroke="#B84A39" stroke-width="1.8" stroke-dasharray="5 3" points="${meanPts}" />
        <polyline fill="none" stroke="#1E3A5F" stroke-width="2.1" points="${medPts}" />
        ${dots}
        <text x="${pad.left + pw / 2}" y="${H - 1}" text-anchor="middle" class="svg-sub-txt">Distancia al Zócalo (km, tramos con n &ge; 15)</text>
      </svg>
    `;
  }

  // --- SVG Acto 4: Facetas 2×2 por cuadrante (mismas escalas, mediana por km) ---
  function buildQuadFacetsSVG() {
    const S = window.Stats;
    const W = 235;
    const H = 140;
    const pad = { top: 10, right: 8, bottom: 22, left: 38 };
    const pw = W - pad.left - pad.right;
    const ph = H - pad.top - pad.bottom;

    const yMax = Math.ceil(metrics.umbralAlto / 1000) * 1000;
    const xOf = (v) => pad.left + (Math.min(v, 21) / 21) * pw;
    const yOf = (v) => pad.top + (1 - Math.min(v, yMax) / yMax) * ph;

    const panels = CUADRANTES.map((c) => {
      const st = metrics.cuadStatsTip[c];
      const col = CUAD_COLORES[c];
      const ptsSvg = metrics.cuadSamples[c]
        .map(
          (p) =>
            `<circle cx="${xOf(p.dist_km).toFixed(1)}" cy="${yOf(p.precio).toFixed(1)}" r="1.4" fill="${col}" fill-opacity="0.28" />`
        )
        .join("");

      const linePts = metrics.cuadProfiles[c]
        .map((p) => `${xOf(p.km).toFixed(1)},${yOf(p.median).toFixed(1)}`)
        .join(" ");

      return `
        <div class="fig14-panel">
          <div class="fig14-panel-title" style="font-size:10.5px;">
            ${c} · Med ${S.fmtMXN(st.median)} · <strong>ρ ${S.fmtSigned(st.spearman)}</strong>
          </div>
          <svg viewBox="0 0 ${W} ${H}" class="p1-svg" role="img" aria-label="Tendencia distancia precio en ${CUAD_NOMBRES[c]}">
            ${[0, 1000, 2000, 3000, 4000].filter((t) => t <= yMax).map((t) => {
              const y = yOf(t);
              return `<line x1="${pad.left}" y1="${y}" x2="${W - pad.right}" y2="${y}" stroke="#E2E8F0" stroke-width="0.9" />
                      <text x="${pad.left - 4}" y="${y + 3}" text-anchor="end" class="svg-axis-txt" style="font-size:8px">$${t / 1000}k</text>`;
            }).join("")}
            ${ptsSvg}
            <polyline fill="none" stroke="#FFFFFF" stroke-width="3.2" points="${linePts}" opacity="0.85" />
            <polyline fill="none" stroke="#0F172A" stroke-width="1.8" points="${linePts}" />
            ${[0, 5, 10, 15, 20].map((t) => `<text x="${xOf(t)}" y="${H - 7}" text-anchor="middle" class="svg-axis-txt" style="font-size:8px">${t} km</text>`).join("")}
          </svg>
        </div>
      `;
    }).join("");

    return `
      <div class="p2-facets-grid">${panels}</div>
      <div class="svg-footnote">Misma escala en los cuatro paneles (0–21 km y $0–${S.fmtMXN(metrics.umbralAlto)} MXN) · Línea oscura: mediana por km (n &ge; 15).</div>
    `;
  }

  function renderActContent() {
    const S = window.Stats;
    const body = document.getElementById("p2-act-body");

    // ---------------- ACTO 1 (4.2.1): Ingeniería y distribución de dist_centro_km ----------------
    if (state.act === 1) {
      const d = metrics.distSummary;
      const p = metrics.baseStats;

      body.innerHTML = `
        <div class="card">
          <div class="card-title">Distribución de la distancia al Zócalo <span class="card-tag">Sección 4.2.1</span></div>
          ${buildHistEcdfSVG()}
        </div>

        <div class="card">
          <div class="card-title">Resumen descriptivo: distancia y precio <span class="card-tag">n = ${S.fmtInt(p.n)}</span></div>
          <table class="data-table">
            <thead>
              <tr><th>Variable</th><th class="num">Media</th><th class="num">Mediana</th><th class="num">Desv. std</th><th class="num">RIC</th><th class="num">Asimetría</th></tr>
            </thead>
            <tbody>
              <tr>
                <td><strong>dist_centro_km</strong></td>
                <td class="num">${d.mean.toFixed(2)} km</td>
                <td class="num"><strong>${d.median.toFixed(2)} km</strong></td>
                <td class="num">${d.std.toFixed(2)}</td>
                <td class="num">${d.iqr.toFixed(2)} km</td>
                <td class="num"><strong>${d.skew.toFixed(2)}</strong></td>
              </tr>
              <tr>
                <td><strong>precio (MXN)</strong></td>
                <td class="num">${S.fmtMXN(p.mean, 2)}</td>
                <td class="num"><strong>${S.fmtMXN(p.median, 2)}</strong></td>
                <td class="num">${S.fmtMXN(p.std, 2)}</td>
                <td class="num">${S.fmtMXN(p.iqr, 2)}</td>
                <td class="num"><strong>${p.skew.toFixed(2)}</strong></td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="card">
          <div class="card-title">Observaciones (4.2.1)</div>
          <ul class="finding-list">
            <li><strong>Variable derivada con asimetría positiva (${d.skew.toFixed(2)}):</strong> la distancia geodésica (Haversine) al Zócalo tiene media de <strong>${d.mean.toFixed(2)} km</strong> frente a mediana de <strong>${d.median.toFixed(2)} km</strong> (máximo ${d.max.toFixed(2)} km).</li>
            <li><strong>Fuerte concentración central:</strong> el 50% central de la oferta se ubica entre <strong>${d.q1.toFixed(2)} km y ${d.q3.toFixed(2)} km</strong> (RIC = ${d.iqr.toFixed(2)} km), y el <strong>80%</strong> está a menos de <strong>${d.p80.toFixed(2)} km</strong>.</li>
            <li><strong>Cola periférica:</strong> persiste oferta más allá del percentil 80, con un repunte ligero entre <strong>14 y 16 km</strong> (P95 = ${d.p95.toFixed(2)} km), reflejado en la huella espacial asimétrica del mapa.</li>
          </ul>
        </div>
      `;
      return;
    }

    // ---------------- ACTO 2 (4.2.2): Discretización y bivariado base ----------------
    if (state.act === 2) {
      const b = metrics.baseStats;
      const aPico = metrics.anillosBase.reduce((x, y) => (y.median > x.median ? y : x));
      const aExt = metrics.anillosBase[metrics.anillosBase.length - 1];
      const q4Pico = metrics.q4Base.reduce((x, y) => (y.median > x.median ? y : x));
      const q8Pico = metrics.q8Base.reduce((x, y) => (y.median > x.median ? y : x));
      const q8Last = metrics.q8Base[metrics.q8Base.length - 1];

      const ringRows = metrics.anillosBase
        .map(
          (a) => `
          <tr>
            <td><strong>${a.anillo}</strong></td>
            <td class="num">${S.fmtInt(a.n)} (${S.fmtPct((a.n / b.n) * 100, 1)})</td>
            <td class="num"><strong>${S.fmtMXN(a.median)}</strong></td>
            <td class="num">${S.fmtMXN(a.mean)}</td>
            <td class="num">+${S.fmtMXN(a.brecha)}</td>
            <td class="num">${S.fmtSigned(a.spearman)}</td>
          </tr>`
        )
        .join("");

      body.innerHTML = `
        <div class="card">
          <div class="card-title">Correlación global (base completa) <span class="card-tag">Sección 4.2.2</span></div>
          <table class="data-table">
            <thead><tr><th>Relación evaluada</th><th class="num">n</th><th class="num">Pearson (r)</th><th class="num">Spearman (ρ)</th></tr></thead>
            <tbody>
              <tr><td>dist_centro_km vs. precio</td><td class="num">${S.fmtInt(b.n)}</td><td class="num"><strong>${S.fmtDec(b.pearson)}</strong></td><td class="num"><strong>${S.fmtDec(b.spearman)}</strong></td></tr>
              <tr><td>dist_centro_km vs. log_precio</td><td class="num">${S.fmtInt(b.n)}</td><td class="num"><strong>${S.fmtDec(metrics.logPearson)}</strong></td><td class="num"><strong>${S.fmtDec(metrics.logSpearman)}</strong></td></tr>
            </tbody>
          </table>
        </div>

        <div class="card">
          <div class="card-title">Trayectoria mediana: 4 anillos vs. cuantiles (q = 4, 5, 8)</div>
          ${buildTrajectorySVG()}
        </div>

        <div class="card">
          <div class="card-title">Precio por anillo urbano: RIC, mediana y media <span class="card-tag">Base completa</span></div>
          ${buildRingIntervalsSVG(metrics.anillosBase)}
          <table class="data-table" style="margin-top:8px;">
            <thead><tr><th>Anillo</th><th class="num">Oferta</th><th class="num">Mediana</th><th class="num">Media</th><th class="num">Brecha</th><th class="num">ρ</th></tr></thead>
            <tbody>${ringRows}</tbody>
          </table>
        </div>

        <div class="card">
          <div class="card-title">Observaciones (4.2.2)</div>
          <ul class="finding-list">
            <li><strong>Asociación global casi nula:</strong> la correlación lineal es <strong>r = ${S.fmtDec(b.pearson)}</strong> y sobre <code>log_precio</code> o por rangos se mantiene muy baja (<strong>r = ${S.fmtDec(metrics.logPearson)}</strong>, <strong>ρ = ${S.fmtDec(b.spearman)}</strong>), confirmando un patrón no lineal.</li>
            <li><strong>Forma de campana en todos los cortes:</strong> en anillos el máximo está en <strong>${aPico.anillo}</strong> (${S.fmtMXN(aPico.median)}, ${S.fmtPct((aPico.n / b.n) * 100, 1)} de la oferta); en cuartiles aparece antes de 5 km (<strong>${q4Pico.label}</strong>: ${S.fmtMXN(q4Pico.median)}) y en octiles se afina en <strong>${q8Pico.label}</strong> (${S.fmtMXN(q8Pico.median)}), cayendo hasta <strong>${q8Last.code}</strong> (${S.fmtMXN(q8Last.median)}).</li>
            <li><strong>Elección de 4 anillos y alerta en &gt; 15 km:</strong> se conservan los 4 anillos urbanos por su claridad territorial; sin embargo, en <strong>${aExt.anillo}</strong> la mediana es la más baja (<strong>${S.fmtMXN(aExt.median)}</strong>) pero la media sube a <strong>${S.fmtMXN(aExt.mean)}</strong> (brecha de +${S.fmtMXN(aExt.brecha)}), señalando el peso de la cola superior.</li>
          </ul>
        </div>
      `;
      return;
    }

    // ---------------- ACTO 3 (4.2.3): Escenario complementario (Típico vs. Alto) ----------------
    if (state.act === 3) {
      const b = metrics.baseStats;
      const t = metrics.tipicoStats;
      const a = metrics.altoStats;
      const dropStd = (1 - t.std / b.std) * 100;
      const extB = metrics.anillosBase[3];
      const extT = metrics.anillosTip[3];
      const extA = metrics.anillosAlto[3];
      const dropExtMean = (1 - extT.mean / extB.mean) * 100;

      const scenarios = [
        { lbl: "Base completa", st: b, pct: 100 },
        { lbl: `Segmento típico (≤ ${S.fmtMXN(metrics.umbralAlto)})`, st: t, pct: (t.n / b.n) * 100 },
        { lbl: `Segmento alto (> ${S.fmtMXN(metrics.umbralAlto)})`, st: a, pct: (a.n / b.n) * 100 },
      ];

      body.innerHTML = `
        <div class="card">
          <div class="card-title">Comparativa de escenarios <span class="card-tag">Frontera ${S.fmtMXN(metrics.umbralAlto, 2)}</span></div>
          <table class="data-table">
            <thead><tr><th>Escenario</th><th class="num">n (%)</th><th class="num">Media</th><th class="num">Mediana</th><th class="num">Desv. std</th><th class="num">r / ρ</th></tr></thead>
            <tbody>
              ${scenarios
                .map(
                  (s, idx) => `
                  <tr class="${idx === 1 ? "row-total" : ""}">
                    <td><strong>${s.lbl}</strong></td>
                    <td class="num">${S.fmtInt(s.st.n)} (${s.pct.toFixed(1)}%)</td>
                    <td class="num">${S.fmtMXN(s.st.mean)}</td>
                    <td class="num"><strong>${S.fmtMXN(s.st.median)}</strong></td>
                    <td class="num">${S.fmtMXN(s.st.std)}</td>
                    <td class="num">${S.fmtDec(s.st.pearson)} / ${S.fmtDec(s.st.spearman)}</td>
                  </tr>`
                )
                .join("")}
            </tbody>
          </table>
        </div>

        <div class="card">
          <div class="card-title">Segmento típico en escala lineal: perfil por kilómetro <span class="card-tag">≤ ${S.fmtMXN(metrics.umbralAlto)}</span></div>
          ${buildLinearProfileSVG()}
        </div>

        <div class="card">
          <div class="card-title">Convergencia de media y mediana por anillo <span class="card-tag">Segmento típico</span></div>
          ${buildRingIntervalsSVG(metrics.anillosTip)}
        </div>

        <div class="card">
          <div class="card-title">Observaciones (4.2.3)</div>
          <ul class="finding-list">
            <li><strong>Frontera robusta y caída en dispersión:</strong> al acotar al segmento típico (<strong>${S.fmtPct((t.n / b.n) * 100, 2)}</strong>) con <code>Q3 + 1.5 × RIC</code> (${S.fmtMXN(metrics.umbralAlto, 2)}), la desviación estándar cae <strong>${S.fmtPct(dropStd, 1)}</strong> (${S.fmtMXN(b.std)} &rarr; ${S.fmtMXN(t.std)}) y la brecha global media–mediana baja a <strong>${S.fmtMXN(t.brecha, 2)}</strong>.</li>
            <li><strong>Desaparece la distorsión en &gt; 15 km:</strong> retirar los ${S.fmtInt(extA.n)} anuncios altos del anillo exterior (media ${S.fmtMXN(extA.mean)}) reduce la media en <strong>${S.fmtPct(dropExtMean, 1)}</strong> (${S.fmtMXN(extB.mean)} &rarr; <strong>${S.fmtMXN(extT.mean)}</strong>), alineando media y mediana en descenso ordenado desde 3–7 km.</li>
            <li><strong>Correlaciones aún débiles y cambio de signo:</strong> en el segmento típico Pearson converge con Spearman (<strong>r = ${S.fmtDec(t.pearson)}</strong>, <strong>ρ = ${S.fmtDec(t.spearman)}</strong>), mientras el segmento alto no depende de la distancia (<strong>ρ = ${S.fmtDec(a.spearman)}</strong>). En <code>&le; 3 km</code> la relación es positiva (<strong>ρ = +${metrics.anillosTip[0].spearman.toFixed(2)}</strong>) y en <code>7–15 km</code> negativa (<strong>ρ = ${metrics.anillosTip[2].spearman.toFixed(2)}</strong>), lo que motiva evaluar la <strong>dirección cardinal</strong>.</li>
          </ul>
        </div>
      `;
      return;
    }

    // ---------------- ACTO 4 (4.2.4 y 4.2.5): Dirección cardinal y respuesta final ----------------
    const heatColor = (val) => {
      if (!Number.isFinite(val)) return "background:#0F172A;color:#CBD5E1;";
      const t = Math.max(0, Math.min(1, (val - metrics.matMin) / (metrics.matMax - metrics.matMin || 1)));
      const r = Math.round(238 - t * (238 - 30));
      const g = Math.round(243 - t * (243 - 58));
      const b = Math.round(248 - t * (248 - 95));
      const txt = t > 0.52 ? "#FFFFFF" : "#0F172A";
      return `background:rgb(${r},${g},${b});color:${txt};`;
    };

    const bodyRows = CUADRANTES.map((c) => {
      const cells = ANILLOS.map((a) => {
        const cell = metrics.matrix[c][a];
        const label = Number.isFinite(cell.median) ? S.fmtMXN(cell.median) : "NA";
        return `<td class="heat-cell" style="${heatColor(cell.median)}">${label}<span class="heat-sub">n=${S.fmtInt(cell.n)}</span></td>`;
      }).join("");
      return `<tr><td><strong>${c}</strong> <span style="color:#64748b">(${S.fmtSigned(metrics.cuadStatsTip[c].spearman)})</span></td>${cells}</tr>`;
    }).join("");

    const pon = metrics.sectorTip.Poniente;
    const ori = metrics.sectorTip.Oriente;
    const brechaEO = ((pon.median / ori.median) - 1) * 100;
    const nw = metrics.cuadStatsTip.NW;
    const sw37 = metrics.matrix.SW["3–7 km"].median;
    const ne37 = metrics.matrix.NE["3–7 km"].median;
    const nw715 = metrics.matrix.NW["7–15 km"].median;
    const se715 = metrics.matrix.SE["7–15 km"].median;
    const brecha37 = ((sw37 / ne37) - 1) * 100;
    const brecha715 = ((nw715 / se715) - 1) * 100;

    body.innerHTML = `
      <div class="card">
        <div class="card-title">Contraste estructural Poniente vs. Oriente <span class="card-tag">Sección 4.2.4</span></div>
        <table class="data-table">
          <thead><tr><th>Sector</th><th class="num">Oferta típica</th><th class="num">Mediana</th><th class="num">Seg. alto (tasa)</th></tr></thead>
          <tbody>
            <tr>
              <td><strong>Poniente (W)</strong></td>
              <td class="num">${S.fmtInt(pon.n)} (${S.fmtPct(metrics.sectorTip.pctOfertaPon, 1)})</td>
              <td class="num"><strong>${S.fmtMXN(pon.median, 2)}</strong></td>
              <td class="num">${S.fmtInt(metrics.sectorTip.nAltoPon)} (${S.fmtPct(metrics.sectorTip.tasaAltoPon, 2)})</td>
            </tr>
            <tr>
              <td><strong>Oriente (E)</strong></td>
              <td class="num">${S.fmtInt(ori.n)} (${S.fmtPct(100 - metrics.sectorTip.pctOfertaPon, 1)})</td>
              <td class="num"><strong>${S.fmtMXN(ori.median, 2)}</strong></td>
              <td class="num">${S.fmtInt(metrics.sectorTip.nAltoOri)} (${S.fmtPct(metrics.sectorTip.tasaAltoOri, 2)})</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="card">
        <div class="card-title">Precio mediano: Cuadrante × Anillo <span class="card-tag">Segmento típico</span></div>
        <table class="data-table">
          <thead>
            <tr>
              <th>Cuadrante (ρ)</th>
              ${ANILLOS.map((a) => `<th style="text-align:center">${a}</th>`).join("")}
            </tr>
          </thead>
          <tbody>${bodyRows}</tbody>
        </table>
      </div>

      <div class="card">
        <div class="card-title">Relación distancia–precio por cuadrante <span class="card-tag">Facetas 2×2</span></div>
        ${buildQuadFacetsSVG()}
      </div>

      <div class="card">
        <div class="card-title">Respuesta a la pregunta (4.2.5)</div>
        <ul class="finding-list">
          <li><strong>Sin relación lineal ni monótona simple:</strong> en los ${S.fmtInt(metrics.baseStats.n)} anuncios activos, alejarse del Zócalo no abarata las tarifas de forma uniforme (<strong>r = ${S.fmtDec(metrics.baseStats.pearson)}</strong>; <strong>ρ = ${S.fmtDec(metrics.baseStats.spearman)}</strong>), y en el 92.7% típico sigue siendo débil (<strong>ρ = ${S.fmtDec(metrics.tipicoStats.spearman)}</strong>).</li>
          <li><strong>Predominio de la dirección cardinal:</strong> el <strong>Poniente</strong> concentra <strong>${S.fmtPct(metrics.sectorTip.pctOfertaPon, 2)}</strong> de la oferta típica, <strong>${S.fmtPct(metrics.sectorTip.pctAltoPon, 2)}</strong> del segmento alto y una mediana <strong>+${S.fmtPct(brechaEO, 1)}</strong> superior al Oriente.</li>
          <li><strong>Pendientes opuestas e igual distancia, distinto precio:</strong> mientras SW, NE y SE bajan al alejarse, <strong>Norponiente (NW)</strong> se encarece (<strong>ρ = ${S.fmtSigned(nw.spearman)}</strong>) hasta <strong>${S.fmtMXN(nw715)}</strong> en 7–15 km (+${S.fmtPct(brecha715, 1)} sobre SE), y en 3–7 km SW supera en +${S.fmtPct(brecha37, 1)} a NE.</li>
        </ul>
        <div class="note-cite">
          Consideración: <code>dist_centro_km</code> mide distancia geodésica en línea recta respecto al Zócalo, sin incorporar tiempos de traslado vial ni subcentros económicos múltiples.
        </div>
      </div>
    `;
  }

  function refreshAll() {
    const filtered = getFilteredRows();
    const s = window.Stats.summarize(filtered);
    const S = window.Stats;

    document.getElementById("kpi-n").textContent = S.fmtInt(s.n);
    document.getElementById("kpi-n-sub").textContent = `${S.fmtPct((s.n / allRows.length) * 100, 1)} del total`;
    document.getElementById("kpi-med").textContent = S.fmtMXN(s.median);
    document.getElementById("kpi-med-sub").textContent = `Media: ${S.fmtMXN(s.mean)}`;
    document.getElementById("kpi-corr").textContent = `ρ ${S.fmtSigned(s.spearman)}`;
    document.getElementById("kpi-corr-sub").textContent = `Pearson r = ${S.fmtSigned(s.pearson)}`;
    document.getElementById("kpi-dist").textContent = `${S.fmtDec(s.distMedian, 2)} km`;
    document.getElementById("kpi-dist-sub").textContent = `RIC precio: ${S.fmtMXN(s.iqr)}`;

    drawOverlays();
    refs.mapApi.setPoints(filtered, pointStyleForAct());
    renderLegend();
  }

  function syncControlsUI() {
    document.querySelectorAll(".p2-act-btn").forEach((b) => {
      b.classList.toggle("active", Number(b.dataset.act) === state.act);
    });
    document.getElementById("f-segmento").value = state.segmento;
    document.getElementById("f-anillo").value = state.anillo;
    document.getElementById("f-cuadrante").value = state.cuadrante;
    document.getElementById("chk-rings").checked = state.showRings;
    document.getElementById("chk-axes").checked = state.showAxes;
  }

  function applyActPreset(actNum) {
    state.act = actNum;
    state.anillo = "Todos";
    state.cuadrante = "Todos";

    if (actNum === 1) {
      state.segmento = "Todos";
      state.showRings = false;
      state.showAxes = false;
    } else if (actNum === 2) {
      state.segmento = "Todos";
      state.showRings = true;
      state.showAxes = false;
    } else if (actNum === 3) {
      state.segmento = "Todos";
      state.showRings = true;
      state.showAxes = false;
    } else {
      state.segmento = "Tipico";
      state.showRings = true;
      state.showAxes = true;
    }

    refs.mapApi.closePopups();
    syncControlsUI();
    renderActContent();
    refreshAll();
  }

  function renderLayout() {
    refs.panelEl.innerHTML = `
      <div class="section-header">
        <span class="eyebrow">Pregunta 2 · Distancia al centro</span>
        <h1>Distancia al Zócalo vs. precio anunciado</h1>
        <p class="subtitle">
          Relación espacial entre la distancia geodésica al Zócalo (Haversine) y las tarifas por noche en 27,820 anuncios activos.
        </p>
      </div>

      <div class="acts-grid" role="tablist" aria-label="Secuencia narrativa Pregunta 2">
        <button class="act-btn p2-act-btn active" data-act="1"><span class="act-step">Acto 1</span><span class="act-label">Distancia</span></button>
        <button class="act-btn p2-act-btn" data-act="2"><span class="act-step">Acto 2</span><span class="act-label">Cortes</span></button>
        <button class="act-btn p2-act-btn" data-act="3"><span class="act-step">Acto 3</span><span class="act-label">Seg. típico</span></button>
        <button class="act-btn p2-act-btn" data-act="4"><span class="act-step">Acto 4</span><span class="act-label">Cuadrantes</span></button>
      </div>

      <div class="kpi-grid kpi-4">
        <div class="kpi-card">
          <div class="kpi-label">Anuncios</div>
          <div class="kpi-value" id="kpi-n">—</div>
          <div class="kpi-sub" id="kpi-n-sub">—</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Precio mediano</div>
          <div class="kpi-value" id="kpi-med">—</div>
          <div class="kpi-sub" id="kpi-med-sub">—</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Correlación</div>
          <div class="kpi-value" id="kpi-corr">—</div>
          <div class="kpi-sub" id="kpi-corr-sub">—</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Dist. mediana</div>
          <div class="kpi-value" id="kpi-dist">—</div>
          <div class="kpi-sub" id="kpi-dist-sub">—</div>
        </div>
      </div>

      <div id="p2-act-body" class="p1-act-body"></div>

      <details class="card p2-filters-details">
        <summary class="card-title" style="margin:0;cursor:pointer;">
          <span>Filtros exploratorios sobre el mapa</span>
          <span class="card-tag">Opcional</span>
        </summary>
        <div class="filters-grid" style="margin-top:10px;">
          <div class="field">
            <label for="f-segmento">Segmento</label>
            <select id="f-segmento">
              <option value="Todos">Base completa</option>
              <option value="Tipico">Segmento típico (&le; IQR)</option>
              <option value="Alto">Segmento alto (&gt; IQR)</option>
            </select>
          </div>
          <div class="field">
            <label for="f-anillo">Anillo de distancia</label>
            <select id="f-anillo">
              <option value="Todos">Todos los anillos</option>
              ${ANILLOS.map((a) => `<option value="${a}">${a}</option>`).join("")}
            </select>
          </div>
          <div class="field" style="grid-column:span 2;">
            <label for="f-cuadrante">Dirección cardinal</label>
            <select id="f-cuadrante">
              <option value="Todos">Toda la CDMX</option>
              <option value="Poniente">Poniente (NW + SW)</option>
              <option value="Oriente">Oriente (NE + SE)</option>
              ${CUADRANTES.map((c) => `<option value="${c}">${CUAD_NOMBRES[c]}</option>`).join("")}
            </select>
          </div>
        </div>
        <div class="toggles-row">
          <label><input type="checkbox" id="chk-rings" /> Anillos 3 / 7 / 15 km</label>
          <label><input type="checkbox" id="chk-axes" /> Ejes cardinales Zócalo</label>
        </div>
      </details>
    `;

    document.querySelectorAll(".p2-act-btn").forEach((btn) => {
      btn.addEventListener("click", () => applyActPreset(Number(btn.dataset.act)));
    });

    document.getElementById("f-segmento").addEventListener("change", (e) => {
      state.segmento = e.target.value;
      refreshAll();
    });
    document.getElementById("f-anillo").addEventListener("change", (e) => {
      state.anillo = e.target.value;
      refreshAll();
    });
    document.getElementById("f-cuadrante").addEventListener("change", (e) => {
      state.cuadrante = e.target.value;
      refreshAll();
    });
    document.getElementById("chk-rings").addEventListener("change", (e) => {
      state.showRings = e.target.checked;
      drawOverlays();
    });
    document.getElementById("chk-axes").addEventListener("change", (e) => {
      state.showAxes = e.target.checked;
      drawOverlays();
    });
  }

  function showLoadFallback(errMsg) {
    refs.panelEl.innerHTML = `
      <div class="section-header">
        <span class="eyebrow">Pregunta 2 · Carga de datos</span>
        <h1>No se pudo leer automáticamente la base de análisis</h1>
      </div>
      <div class="callout warn">
        <strong>Motivo:</strong> ${errMsg}<br /><br />
        Ejecuta <code>python -m http.server 8000</code> dentro de <code>proyecto_airbnb_cdmx/</code>
        y abre <code>http://localhost:8000/main.html</code>.
      </div>
      <div class="card">
        <div class="card-title">Alternativa rápida sin servidor local</div>
        <p class="subtitle">Selecciona el archivo de datos del proyecto:</p>
        <input type="file" id="p2-file-input" accept=".csv" class="file-fallback" />
      </div>
    `;

    document.getElementById("p2-file-input").addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const rows = await window.DataStore.loadFromFile(file);
      processRows(rows);
      renderLayout();
      applyActPreset(1);
    });
  }

  async function mount(ctx) {
    refs = ctx;
    const sidePanel = document.getElementById("side-panel");
    if (sidePanel) sidePanel.classList.add("medium");

    refs.panelEl.innerHTML = `<div class="loading-box">Calculando métricas de Pregunta 2...</div>`;

    try {
      if (!allRows.length) {
        const rows = await window.DataStore.load();
        processRows(rows);
      }
      renderLayout();
      applyActPreset(state.act);
      refs.mapApi.resetView();
    } catch (err) {
      showLoadFallback(err.message);
    }
  }

  function unmount() {
    const sidePanel = document.getElementById("side-panel");
    if (sidePanel) sidePanel.classList.remove("medium");
    if (refs.mapApi) {
      refs.mapApi.closePopups();
      refs.mapApi.clearOverlays();
      refs.mapApi.resetView();
    }
  }

  return { mount, unmount };
})();

if (window.AppShell) window.AppShell.register("p2", window.Pregunta2);