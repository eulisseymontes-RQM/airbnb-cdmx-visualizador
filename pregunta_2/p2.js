window.Pregunta2 = (() => {
  const LAT_ZOCALO = 19.432608;
  const LON_ZOCALO = -99.133209;
  const CSV_PATH = "pregunta_2/datos_p2.csv";

  const ANILLOS = ["<= 3 km", "3-7 km", "7-15 km", "> 15 km"];
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
  const MOD_COLORES = {
    "Alojamiento completo": "#1E3A5F",
    "Habitación privada": "#B84A39",
    "Habitación compartida": "#8B6D3F",
    "Habitación de hotel": "#2F6F62",
  };

  let allRows = [];
  let metrics = null; // Todos los agregados calculados dinámicamente desde el CSV
  let activeChart = null;
  let refs = { panelEl: null, legendEl: null, mapApi: null };

  const state = {
    act: 1,
    segmento: "Todos",
    modalidad: "Todas",
    anillo: "Todos",
    cuadrante: "Todos",
    showRings: true,
    showAxes: false,
  };

  function classifyAnillo(d) {
    if (d <= 3) return "<= 3 km";
    if (d <= 7) return "3-7 km";
    if (d <= 15) return "7-15 km";
    return "> 15 km";
  }

  function classifyCuadrante(lat, lon) {
    if (lat >= LAT_ZOCALO && lon < LON_ZOCALO) return "NW";
    if (lat < LAT_ZOCALO && lon < LON_ZOCALO) return "SW";
    if (lat >= LAT_ZOCALO && lon >= LON_ZOCALO) return "NE";
    return "SE";
  }

  function processRows(rawRows) {
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
      const dist = Number.isFinite(Number(r.dist_km))
        ? Number(r.dist_km)
        : window.Stats.haversineKm(lat, lon, LAT_ZOCALO, LON_ZOCALO);

      const cuad = classifyCuadrante(lat, lon);
      prices.push(precio);
      clean.push({
        lat,
        lon,
        precio,
        dist_km: dist,
        anillo: classifyAnillo(dist),
        cuadrante: cuad,
        sector: lon < LON_ZOCALO ? "Poniente" : "Oriente",
        alcaldia: String(r.alcaldia || "Sin dato").trim(),
        modalidad: String(r.modalidad || "Sin dato").trim(),
        segmento: "Tipico",
      });
    }

    // Cálculo dinámico del umbral IQR superior: Q3 + 1.5 * RIC
    const sortedP = window.Stats.sortedNumbers(prices);
    const q1 = window.Stats.quantileSorted(sortedP, 0.25);
    const q3 = window.Stats.quantileSorted(sortedP, 0.75);
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

    const baseStats = S.summarize(allRows);
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

    const octilesBase = S.qcutGroups(allRows, "dist_km", 8, "O");
    const octilesTip = S.qcutGroups(tipico, "dist_km", 8, "O");

    const modCounts = {};
    allRows.forEach((r) => (modCounts[r.modalidad] = (modCounts[r.modalidad] || 0) + 1));
    const modalidades = Object.keys(modCounts).sort((a, b) => modCounts[b] - modCounts[a]);

    const modStatsBase = modalidades.map((m) => ({
      modalidad: m,
      ...S.summarize(allRows.filter((r) => r.modalidad === m)),
    }));
    const modStatsTip = modalidades.map((m) => ({
      modalidad: m,
      ...S.summarize(tipico.filter((r) => r.modalidad === m)),
    }));

    const cuadStatsTip = {};
    CUADRANTES.forEach((c) => {
      cuadStatsTip[c] = S.summarize(tipico.filter((r) => r.cuadrante === c));
    });

    const ponTip = tipico.filter((r) => r.sector === "Poniente");
    const oriTip = tipico.filter((r) => r.sector === "Oriente");
    const ponAlto = alto.filter((r) => r.sector === "Poniente");
    const oriAlto = alto.filter((r) => r.sector === "Oriente");

    const sectorTip = {
      Poniente: S.summarize(ponTip),
      Oriente: S.summarize(oriTip),
      pctOfertaPon: (ponTip.length / tipico.length) * 100,
      pctAltoPon: alto.length ? (ponAlto.length / alto.length) * 100 : 0,
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
      baseStats,
      tipicoStats,
      altoStats,
      anillosBase,
      anillosTip,
      octilesBase,
      octilesTip,
      modalidades,
      modStatsBase,
      modStatsTip,
      cuadStatsTip,
      sectorTip,
      matrix,
      matMin,
      matMax,
    };
  }

  function getFilteredRows() {
    return allRows.filter((r) => {
      if (state.segmento !== "Todos" && r.segmento !== state.segmento) return false;
      if (state.modalidad !== "Todas" && r.modalidad !== state.modalidad) return false;
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

    // 1. Anillos concéntricos reales en metros (3, 7 y 15 km) en SVG por encima de los puntos
    if (state.showRings) {
      [3000, 7000, 15000].forEach((radiusM) => {
        // Halo blanco sutil para contraste sobre calles y puntos
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

        // Línea principal sobria
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
    const q1 = metrics.baseStats.q1;
    const med = metrics.baseStats.median;
    const q3 = metrics.baseStats.q3;

    const popupFn = (p) => `
      <div class="popup-title">${p.alcaldia}</div>
      <div class="popup-grid">
        <span class="popup-k">Precio / noche</span><span class="popup-v">${window.Stats.fmtMXN(p.precio, 2)} MXN</span>
        <span class="popup-k">Distancia Zócalo</span><span class="popup-v">${p.dist_km.toFixed(2)} km (${p.anillo})</span>
        <span class="popup-k">Modalidad</span><span class="popup-v">${p.modalidad}</span>
        <span class="popup-k">Cuadrante</span><span class="popup-v">${CUAD_NOMBRES[p.cuadrante]}</span>
        <span class="popup-k">Segmento</span><span class="popup-v">${p.segmento === "Alto" ? "Alto (> umbral IQR)" : "Mercado típico"}</span>
      </div>
    `;

    if (state.act === 1) {
      return {
        colorFn: (p) => {
          if (p.precio <= q1) return "#94A3B8";
          if (p.precio <= med) return "#4E79A7";
          if (p.precio <= q3) return "#1E3A5F";
          return "#B84A39";
        },
        radiusFn: (p) => (p.precio > metrics.umbralAlto ? 2.8 : 2.0),
        alphaFn: () => 0.48,
        popupFn,
      };
    }

    if (state.act === 2) {
      return {
        colorFn: (p) => (p.segmento === "Alto" ? "#B84A39" : "#64748B"),
        radiusFn: (p) => (p.segmento === "Alto" ? 3.2 : 1.8),
        alphaFn: (p) => (p.segmento === "Alto" ? 0.82 : 0.22),
        popupFn,
      };
    }

    if (state.act === 3) {
      return {
        colorFn: (p) => MOD_COLORES[p.modalidad] || "#64748B",
        radiusFn: () => 2.1,
        alphaFn: () => 0.5,
        popupFn,
      };
    }

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
      el.innerHTML = `
        <div class="legend-title">Precio por noche (cuartiles CSV)</div>
        <div class="legend-item"><span class="legend-left"><span class="swatch" style="background:#94A3B8"></span>&le; Q1</span><span class="mono">${S.fmtMXN(metrics.baseStats.q1)}</span></div>
        <div class="legend-item"><span class="legend-left"><span class="swatch" style="background:#4E79A7"></span>Q1 – Mediana</span><span class="mono">${S.fmtMXN(metrics.baseStats.median)}</span></div>
        <div class="legend-item"><span class="legend-left"><span class="swatch" style="background:#1E3A5F"></span>Mediana – Q3</span><span class="mono">${S.fmtMXN(metrics.baseStats.q3)}</span></div>
        <div class="legend-item"><span class="legend-left"><span class="swatch" style="background:#B84A39"></span>&gt; Q3</span><span class="mono">&gt; ${S.fmtMXN(metrics.baseStats.q3)}</span></div>
      `;
    } else if (state.act === 2) {
      el.innerHTML = `
        <div class="legend-title">Segmentación (umbral IQR)</div>
        <div class="legend-item"><span class="legend-left"><span class="swatch" style="background:#64748B"></span>Típico (&le; ${S.fmtMXN(metrics.umbralAlto)})</span><span class="mono">${S.fmtInt(metrics.tipicoStats.n)}</span></div>
        <div class="legend-item"><span class="legend-left"><span class="swatch" style="background:#B84A39"></span>Alto (&gt; ${S.fmtMXN(metrics.umbralAlto)})</span><span class="mono">${S.fmtInt(metrics.altoStats.n)}</span></div>
      `;
    } else if (state.act === 3) {
      el.innerHTML =
        `<div class="legend-title">Modalidad de alojamiento</div>` +
        metrics.modStatsBase
          .map(
            (m) => `
            <div class="legend-item">
              <span class="legend-left"><span class="swatch" style="background:${MOD_COLORES[m.modalidad] || "#64748B"}"></span>${m.modalidad}</span>
              <span class="mono">${S.fmtMXN(m.median)}</span>
            </div>`
          )
          .join("");
    } else {
      el.innerHTML =
        `<div class="legend-title">Cuadrantes cardinales (Zócalo)</div>` +
        CUADRANTES.map(
          (c) => `
          <div class="legend-item">
            <span class="legend-left"><span class="swatch" style="background:${CUAD_COLORES[c]}"></span>${CUAD_NOMBRES[c]}</span>
            <span class="mono">${S.fmtMXN(metrics.cuadStatsTip[c].median)}</span>
          </div>`
        ).join("");
    }
  }

  function renderChartAndExtras() {
    if (activeChart) {
      activeChart.destroy();
      activeChart = null;
    }

    const S = window.Stats;
    const chartTitle = document.getElementById("p2-chart-title");
    const chartTag = document.getElementById("p2-chart-tag");
    const chartBox = document.getElementById("p2-chart-container");
    const extraBox = document.getElementById("p2-extra-box");
    const findingsEl = document.getElementById("p2-findings");

    const commonFont = { family: "Inter, sans-serif", size: 11 };

    // --- ACTO 1: Trayectoria radial pd.cut vs pd.qcut (q=8) ---
    if (state.act === 1) {
      chartTitle.textContent = "Trayectoria mediana: anillos (cut) vs. octiles (qcut)";
      chartTag.textContent = "Base completa";
      chartBox.innerHTML = `<div class="chart-wrap"><canvas id="p2-canvas"></canvas></div>`;

      const ctx = document.getElementById("p2-canvas").getContext("2d");
      activeChart = new Chart(ctx, {
        type: "scatter",
        data: {
          datasets: [
            {
              label: "Anillos urbanos (pd.cut)",
              data: metrics.anillosBase.map((a) => ({ x: a.distMedian, y: a.median, lbl: a.anillo })),
              showLine: true,
              borderColor: "#1E3A5F",
              backgroundColor: "#1E3A5F",
              borderDash: [5, 4],
              borderWidth: 2,
              pointRadius: 4.5,
            },
            {
              label: "Octiles equilibrados (q = 8)",
              data: metrics.octilesBase.map((o) => ({ x: o.distMedian, y: o.median, lbl: o.label })),
              showLine: true,
              borderColor: "#B84A39",
              backgroundColor: "#B84A39",
              borderWidth: 2.2,
              pointRadius: 4,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: "bottom", labels: { font: commonFont, boxWidth: 12 } },
            tooltip: {
              callbacks: {
                label: (c) => `${c.raw.lbl}: ${S.fmtMXN(c.raw.y)} (med. ${c.raw.x.toFixed(2)} km)`,
              },
            },
          },
          scales: {
            x: { title: { display: true, text: "Distancia mediana al Zócalo (km)", font: commonFont }, ticks: { font: commonFont } },
            y: { title: { display: true, text: "Precio mediano (MXN)", font: commonFont }, ticks: { font: commonFont } },
          },
        },
      });

      const picoAnillo = metrics.anillosBase.reduce((a, b) => (b.median > a.median ? b : a));
      const extAnillo = metrics.anillosBase[metrics.anillosBase.length - 1];
      const picoOctil = metrics.octilesBase.reduce((a, b) => (b.median > a.median ? b : a));

      extraBox.innerHTML = "";
      findingsEl.innerHTML = `
        <li><strong>Sin relación lineal simple:</strong> en los ${S.fmtInt(metrics.baseStats.n)} anuncios, Pearson es <strong>r = ${S.fmtDec(metrics.baseStats.pearson)}</strong> y Spearman <strong>ρ = ${S.fmtDec(metrics.baseStats.spearman)}</strong>.</li>
        <li><strong>Patrón en campana confirmado:</strong> el máximo no está junto al Zócalo, sino en <strong>${picoAnillo.anillo}</strong> (${S.fmtMXN(picoAnillo.median)}), afinado por octiles en <strong>${picoOctil.label}</strong> (${S.fmtMXN(picoOctil.median)}).</li>
        <li><strong>Señal de alerta en &gt; 15 km:</strong> registra la mediana más baja (<strong>${S.fmtMXN(extAnillo.median)}</strong>) pero una media inflada de <strong>${S.fmtMXN(extAnillo.mean)}</strong> (brecha de +${S.fmtMXN(extAnillo.brecha)}).</li>
      `;
    }

    // --- ACTO 2: Cola superior (Antes vs. Después) ---
    else if (state.act === 2) {
      chartTitle.textContent = "Efecto de la cola alta en la media por anillo";
      chartTag.textContent = `Corte ${S.fmtMXN(metrics.umbralAlto, 2)}`;
      chartBox.innerHTML = `<div class="chart-wrap"><canvas id="p2-canvas"></canvas></div>`;

      const ctx = document.getElementById("p2-canvas").getContext("2d");
      activeChart = new Chart(ctx, {
        type: "bar",
        data: {
          labels: ANILLOS,
          datasets: [
            {
              label: "Media base completa",
              data: metrics.anillosBase.map((a) => a.mean),
              backgroundColor: "rgba(184, 74, 57, 0.72)",
              borderRadius: 4,
            },
            {
              label: "Media mercado típico",
              data: metrics.anillosTip.map((a) => a.mean),
              backgroundColor: "rgba(30, 58, 95, 0.85)",
              borderRadius: 4,
            },
            {
              label: "Mediana mercado típico",
              data: metrics.anillosTip.map((a) => a.median),
              backgroundColor: "rgba(100, 116, 139, 0.55)",
              borderRadius: 4,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { position: "bottom", labels: { font: commonFont, boxWidth: 12 } } },
          scales: {
            x: { ticks: { font: commonFont } },
            y: { title: { display: true, text: "MXN / noche", font: commonFont }, ticks: { font: commonFont } },
          },
        },
      });

      const pctAlto = (metrics.altoStats.n / metrics.baseStats.n) * 100;
      const pctTip = (metrics.tipicoStats.n / metrics.baseStats.n) * 100;
      const dropStd = (1 - metrics.tipicoStats.std / metrics.baseStats.std) * 100;
      const extBase = metrics.anillosBase[3];
      const extTip = metrics.anillosTip[3];

      extraBox.innerHTML = "";
      findingsEl.innerHTML = `
        <li><strong>Frontera IQR calculada en vivo:</strong> ${S.fmtMXN(metrics.umbralAlto, 2)} MXN separa <strong>${S.fmtInt(metrics.tipicoStats.n)} típicos (${S.fmtPct(pctTip, 2)})</strong> de <strong>${S.fmtInt(metrics.altoStats.n)} en segmento alto (${S.fmtPct(pctAlto, 2)})</strong>.</li>
        <li><strong>Estabilización estadística:</strong> al aislar la cola alta, la desviación estándar cae <strong>${S.fmtPct(dropStd, 1)}</strong> (${S.fmtMXN(metrics.baseStats.std)} &rarr; ${S.fmtMXN(metrics.tipicoStats.std)}) y la media en <strong>&gt; 15 km</strong> baja de ${S.fmtMXN(extBase.mean)} a <strong>${S.fmtMXN(extTip.mean)}</strong>.</li>
        <li><strong>Convergencia de correlaciones:</strong> en el mercado típico, Pearson (<strong>${S.fmtDec(metrics.tipicoStats.pearson)}</strong>) se alinea con Spearman (<strong>${S.fmtDec(metrics.tipicoStats.spearman)}</strong>), pero sigue siendo débil.</li>
      `;
    }

    // --- ACTO 3: Control por modalidad ---
    else if (state.act === 3) {
      chartTitle.textContent = "Precio mediano por modalidad (mercado típico)";
      chartTag.textContent = "Variable de control";
      chartBox.innerHTML = `<div class="chart-wrap"><canvas id="p2-canvas"></canvas></div>`;

      const ctx = document.getElementById("p2-canvas").getContext("2d");
      activeChart = new Chart(ctx, {
        type: "bar",
        data: {
          labels: metrics.modStatsTip.map((m) => m.modalidad),
          datasets: [
            {
              label: "Mediana (MXN)",
              data: metrics.modStatsTip.map((m) => m.median),
              backgroundColor: metrics.modStatsTip.map((m) => MOD_COLORES[m.modalidad] || "#64748B"),
              borderRadius: 4,
            },
          ],
        },
        options: {
          indexAxis: "y",
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { title: { display: true, text: "Precio mediano (MXN)", font: commonFont }, ticks: { font: commonFont } },
            y: { ticks: { font: commonFont } },
          },
        },
      });

      const rowsHtml = metrics.modStatsTip
        .map(
          (m) => `
          <tr>
            <td>${m.modalidad}</td>
            <td class="num">${S.fmtInt(m.n)}</td>
            <td class="num">${S.fmtMXN(m.median)}</td>
            <td class="num">${S.fmtMXN(m.iqr)}</td>
            <td class="num"><strong>${S.fmtSigned(m.spearman)}</strong></td>
          </tr>`
        )
        .join("");

      extraBox.innerHTML = `
        <div class="card">
          <div class="card-title">Correlación distancia–precio dentro de cada modalidad <span class="card-tag">Típico</span></div>
          <table class="data-table">
            <thead><tr><th>Modalidad</th><th class="num">n</th><th class="num">Mediana</th><th class="num">RIC</th><th class="num">ρ</th></tr></thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>
      `;

      const m0 = metrics.modStatsTip[0];
      const m1 = metrics.modStatsTip[1];
      findingsEl.innerHTML = `
        <li><strong>El tipo de espacio domina sobre los kilómetros:</strong> <strong>${m0.modalidad}</strong> (${S.fmtMXN(m0.median)}) duplica la mediana de <strong>${m1.modalidad}</strong> (${S.fmtMXN(m1.median)}).</li>
        <li><strong>Asociación radial casi nula al controlar:</strong> dentro de ${m0.modalidad} <strong>ρ = ${S.fmtSigned(m0.spearman)}</strong> y dentro de ${m1.modalidad} <strong>ρ = ${S.fmtSigned(m1.spearman)}</strong>.</li>
        <li>Usa el filtro inferior de <em>Modalidad</em> para inspeccionar cómo cambia la huella espacial de cada categoría sobre el mapa real.</li>
      `;
    }

    // --- ACTO 4: Giro direccional (Cuadrantes y Poniente vs. Oriente) ---
    else {
      chartTitle.textContent = "Matriz de precio mediano: Cuadrante × Anillo";
      chartTag.textContent = "Mercado típico";

      const heatColor = (val) => {
        if (!Number.isFinite(val)) return "background:#F1F5F9;color:#94A3B8;";
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

      chartBox.innerHTML = `
        <table class="data-table">
          <thead>
            <tr>
              <th>Cuadrante (ρ)</th>
              ${ANILLOS.map((a) => `<th style="text-align:center">${a}</th>`).join("")}
            </tr>
          </thead>
          <tbody>${bodyRows}</tbody>
        </table>
      `;

      const pon = metrics.sectorTip.Poniente;
      const ori = metrics.sectorTip.Oriente;
      const brechaPct = ((pon.median - ori.median) / ori.median) * 100;
      const nw = metrics.cuadStatsTip.NW;
      const nw715 = metrics.matrix.NW["7-15 km"].median;
      const se715 = metrics.matrix.SE["7-15 km"].median;

      extraBox.innerHTML = `
        <div class="card">
          <div class="card-title">Contraste estructural Poniente vs. Oriente <span class="card-tag">Calculado del CSV</span></div>
          <table class="data-table">
            <thead><tr><th>Sector</th><th class="num">Oferta típica</th><th class="num">Mediana</th><th class="num">Seg. alto</th></tr></thead>
            <tbody>
              <tr>
                <td><strong>Poniente (NW + SW)</strong></td>
                <td class="num">${S.fmtInt(pon.n)} (${S.fmtPct(metrics.sectorTip.pctOfertaPon)})</td>
                <td class="num"><strong>${S.fmtMXN(pon.median)}</strong></td>
                <td class="num">${S.fmtInt(metrics.sectorTip.nAltoPon)} (${S.fmtPct(metrics.sectorTip.pctAltoPon)})</td>
              </tr>
              <tr>
                <td>Oriente (NE + SE)</td>
                <td class="num">${S.fmtInt(ori.n)} (${S.fmtPct(100 - metrics.sectorTip.pctOfertaPon)})</td>
                <td class="num">${S.fmtMXN(ori.median)}</td>
                <td class="num">${S.fmtInt(metrics.sectorTip.nAltoOri)} (${S.fmtPct(100 - metrics.sectorTip.pctAltoPon)})</td>
              </tr>
            </tbody>
          </table>
        </div>
      `;

      findingsEl.innerHTML = `
        <li><strong>Asimetría Poniente vs. Oriente:</strong> el Poniente reúne <strong>${S.fmtPct(metrics.sectorTip.pctOfertaPon, 2)}</strong> de la oferta típica, <strong>${S.fmtPct(metrics.sectorTip.pctAltoPon, 2)}</strong> del segmento alto y una mediana <strong>+${S.fmtPct(brechaPct, 1)}</strong> mayor (${S.fmtMXN(pon.median)} vs. ${S.fmtMXN(ori.median)}).</li>
        <li><strong>Cancelación de pendientes:</strong> en <strong>Norponiente (NW)</strong> la relación se invierte (<strong>ρ = ${S.fmtSigned(nw.spearman)}</strong>) y llega a <strong>${S.fmtMXN(nw715)}</strong> en 7–15 km frente a ${S.fmtMXN(se715)} en Suroriente a la misma distancia.</li>
        <li><strong>Ausencia estructural geográfica:</strong> las celdas <code>NA (n=0)</code> en <code>&gt; 15 km</code> al Norte reflejan el límite territorial norte de la CDMX respecto al Zócalo.</li>
      `;
    }
  }

  function refreshAll() {
    const filtered = getFilteredRows();
    const s = window.Stats.summarize(filtered);
    const S = window.Stats;

    // Actualizar KPIs vivos de la selección activa
    document.getElementById("kpi-n").textContent = S.fmtInt(s.n);
    document.getElementById("kpi-n-sub").textContent = `${S.fmtPct((s.n / allRows.length) * 100, 1)} del universo (${S.fmtInt(allRows.length)})`;
    document.getElementById("kpi-med").textContent = S.fmtMXN(s.median);
    document.getElementById("kpi-med-sub").textContent = `Media: ${S.fmtMXN(s.mean)} · RIC: ${S.fmtMXN(s.iqr)}`;
    document.getElementById("kpi-corr").textContent = `ρ ${S.fmtSigned(s.spearman)}`;
    document.getElementById("kpi-corr-sub").textContent = `Pearson r = ${S.fmtSigned(s.pearson)}`;
    document.getElementById("kpi-dist").textContent = `${S.fmtDec(s.distMedian, 2)} km`;
    document.getElementById("kpi-dist-sub").textContent = `Umbral alto: ${S.fmtMXN(metrics.umbralAlto, 2)}`;

    // Actualizar mapa y leyenda
    drawOverlays();
    refs.mapApi.setPoints(filtered, pointStyleForAct());
    renderLegend();
    renderChartAndExtras();
  }

  function applyActPreset(actNum) {
    state.act = actNum;
    state.modalidad = "Todas";
    state.anillo = "Todos";
    state.cuadrante = "Todos";

    if (actNum === 1) {
      state.segmento = "Todos";
      state.showRings = true;
      state.showAxes = false;
    } else if (actNum === 2) {
      state.segmento = "Todos";
      state.showRings = true;
      state.showAxes = false;
    } else if (actNum === 3) {
      state.segmento = "Tipico";
      state.showRings = false;
      state.showAxes = false;
    } else {
      state.segmento = "Tipico";
      state.showRings = true;
      state.showAxes = true;
    }

    syncControlsUI();
    refreshAll();
  }

  function syncControlsUI() {
    document.querySelectorAll(".act-btn").forEach((b) => {
      b.classList.toggle("active", Number(b.dataset.act) === state.act);
    });
    document.getElementById("f-segmento").value = state.segmento;
    document.getElementById("f-modalidad").value = state.modalidad;
    document.getElementById("f-anillo").value = state.anillo;
    document.getElementById("f-cuadrante").value = state.cuadrante;
    document.getElementById("chk-rings").checked = state.showRings;
    document.getElementById("chk-axes").checked = state.showAxes;
  }

  function renderLayout() {
    const modOptions = metrics.modalidades
      .map((m) => `<option value="${m}">${m}</option>`)
      .join("");

    refs.panelEl.innerHTML = `
      <div class="section-header">
        <span class="eyebrow">Pregunta 2 · Análisis espacial</span>
        <h1>Distancia al Zócalo vs. precio anunciado</h1>
        <p class="subtitle">
          Cálculos ejecutados en vivo desde <code>pregunta_2/datos_p2.csv</code>. Haz clic sobre cualquier punto del mapa para inspeccionar el anuncio.
        </p>
      </div>

      <div class="acts-grid" role="tablist" aria-label="Secuencia narrativa">
        <button class="act-btn active" data-act="1"><span class="act-step">Acto 1</span><span class="act-label">Patrón radial</span></button>
        <button class="act-btn" data-act="2"><span class="act-step">Acto 2</span><span class="act-label">Cola alta</span></button>
        <button class="act-btn" data-act="3"><span class="act-step">Acto 3</span><span class="act-label">Modalidad</span></button>
        <button class="act-btn" data-act="4"><span class="act-step">Acto 4</span><span class="act-label">Cuadrantes</span></button>
      </div>

      <div class="kpi-grid">
        <div class="kpi-card">
          <div class="kpi-label">Anuncios visibles</div>
          <div class="kpi-value" id="kpi-n">—</div>
          <div class="kpi-sub" id="kpi-n-sub">—</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Precio mediano</div>
          <div class="kpi-value" id="kpi-med">—</div>
          <div class="kpi-sub" id="kpi-med-sub">—</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Asociación (dist. vs precio)</div>
          <div class="kpi-value" id="kpi-corr">—</div>
          <div class="kpi-sub" id="kpi-corr-sub">—</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Distancia mediana</div>
          <div class="kpi-value" id="kpi-dist">—</div>
          <div class="kpi-sub" id="kpi-dist-sub">—</div>
        </div>
      </div>

      <div class="card">
        <div class="card-title">
          <span id="p2-chart-title">—</span>
          <span class="card-tag" id="p2-chart-tag"></span>
        </div>
        <div id="p2-chart-container"></div>
      </div>

      <div id="p2-extra-box"></div>

      <div class="card">
        <div class="card-title">Hallazgos reproducibles de esta vista</div>
        <ul class="finding-list" id="p2-findings"></ul>
      </div>

      <div class="card">
        <div class="card-title">Filtros interactivos <span class="card-tag">Recalculan mapa y KPIs</span></div>
        <div class="filters-grid">
          <div class="field">
            <label for="f-segmento">Segmento</label>
            <select id="f-segmento">
              <option value="Todos">Base completa</option>
              <option value="Tipico">Mercado típico (&le; IQR)</option>
              <option value="Alto">Segmento alto (&gt; IQR)</option>
            </select>
          </div>
          <div class="field">
            <label for="f-modalidad">Modalidad</label>
            <select id="f-modalidad">
              <option value="Todas">Todas</option>
              ${modOptions}
            </select>
          </div>
          <div class="field">
            <label for="f-anillo">Anillo de distancia</label>
            <select id="f-anillo">
              <option value="Todos">Todos los anillos</option>
              ${ANILLOS.map((a) => `<option value="${a}">${a}</option>`).join("")}
            </select>
          </div>
          <div class="field">
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
          <label><input type="checkbox" id="chk-rings" checked /> Anillos 3 / 7 / 15 km</label>
          <label><input type="checkbox" id="chk-axes" /> Ejes cardinales Zócalo</label>
        </div>
      </div>
    `;

    // Eventos de los actos y filtros
    document.querySelectorAll(".act-btn").forEach((btn) => {
      btn.addEventListener("click", () => applyActPreset(Number(btn.dataset.act)));
    });

    document.getElementById("f-segmento").addEventListener("change", (e) => {
      state.segmento = e.target.value;
      refreshAll();
    });
    document.getElementById("f-modalidad").addEventListener("change", (e) => {
      state.modalidad = e.target.value;
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
    refs.panelEl.innerHTML = `<div class="loading-box">Leyendo <code>${window.DataStore.CSV_PATH}</code> y calculando estadísticas...</div>`;

    if (allRows.length) {
      renderLayout();
      syncControlsUI();
      refreshAll();
      return;
    }

    try {
      const rows = await window.DataStore.load();
      processRows(rows);
      renderLayout();
      applyActPreset(1);
    } catch (err) {
      showLoadFallback(err.message);
    }
  }

  function unmount() {
    if (activeChart) {
      activeChart.destroy();
      activeChart = null;
    }
    if (refs.mapApi) refs.mapApi.clearOverlays();
  }

  return { mount, unmount };
})();

if (window.AppShell) window.AppShell.register("p2", window.Pregunta2);