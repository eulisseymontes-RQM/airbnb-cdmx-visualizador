window.Pregunta5 = (() => {
  const COM = "Comercial (10+)";
  const PAR = "Particular (<10)";
  const MIN_N_ESTRATO = 30;
  const MIN_N_BURBUJA = 100;

  const COLOR_COM = "#B84A39";  // Terracota sobrio: Comercial (10+)
  const COLOR_PAR = "#1E3A5F";  // Azul pizarra: Particular (<10)
  const COLOR_DOM = "#D97706";  // Ámbar: anfitrión dominante en caso Azcapotzalco

  let allRows = [];
  let metrics = null;
  let refs = { panelEl: null, legendEl: null, mapApi: null, store: null };
  let renderToken = 0;

  const state = {
    act: 1,
    showPointsAct1: false,
    choroModAct2: "Alojamiento completo", // "Alojamiento completo" | "Habitación privada"
    selectedAlcKey: null,
    selectedStratumId: null,
    hoveredAlcKey: null,
    showAllPointsAct2: false,
    act3MapFocus: "top6", // "top6" | "azcapotzalco"
  };

  function shortAlcName(name) {
    if (name === "La Magdalena Contreras") return "Magdalena Contreras";
    if (name === "Cuajimalpa de Morelos") return "Cuajimalpa";
    return name;
  }

  function shortModName(mod) {
    if (mod === "Alojamiento completo") return "Completo";
    if (mod === "Habitación privada") return "Privada";
    if (mod === "Habitación compartida") return "Compartida";
    if (mod === "Habitación de hotel") return "Hotel";
    return mod;
  }

  // Escala divergente sobria (-max azul pizarra -> 0 neutro -> +max terracota)
  function divColor(val, maxAbs) {
    if (!Number.isFinite(val)) return "#CBD5E1";
    const t = Math.min(1, Math.abs(val) / (maxAbs || 1));
    const neutral = [238, 241, 245];
    const target = val >= 0 ? [184, 74, 57] : [30, 58, 95];
    const r = Math.round(neutral[0] + (target[0] - neutral[0]) * t);
    const g = Math.round(neutral[1] + (target[1] - neutral[1]) * t);
    const b = Math.round(neutral[2] + (target[2] - neutral[2]) * t);
    return `rgb(${r}, ${g}, ${b})`;
  }

  function boxWhiskers(values) {
    const S = window.Stats;
    const s = S.sortedNumbers(values);
    const n = s.length;
    if (!n) return { n: 0, q1: NaN, median: NaN, q3: NaN, wLow: NaN, wHigh: NaN };
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
    return { n, q1, median, q3, wLow, wHigh };
  }

  function computeMetrics(rows) {
    const S = window.Stats;

    const annotated = rows.map((r) => ({
      ...r,
      grupo: r.anuncios_anfitrion >= 10 ? COM : PAR,
    }));
    allRows = annotated;

    const comRows = annotated.filter((r) => r.grupo === COM);
    const parRows = annotated.filter((r) => r.grupo === PAR);

    // 4.5.1 Composición global
    const summarizeGroup = (grpRows, label) => {
      const hosts = new Set(grpRows.map((r) => r.host_id)).size;
      const med = S.quantileSorted(S.sortedNumbers(grpRows.map((r) => r.precio)), 0.5);
      return {
        label,
        anuncios: grpRows.length,
        anfitriones: hosts,
        precioMediano: med,
        anunciosPorHost: hosts ? grpRows.length / hosts : NaN,
        pctAnuncios: (grpRows.length / annotated.length) * 100,
      };
    };

    const compCom = summarizeGroup(comRows, COM);
    const compPar = summarizeGroup(parRows, PAR);
    const diffBruta = ((compCom.precioMediano / compPar.precioMediano) - 1) * 100;

    // Crosstab modalidad (% dentro de cada grupo)
    const modOrder = ["Alojamiento completo", "Habitación compartida", "Habitación de hotel", "Habitación privada"];
    const modCountsCom = {};
    const modCountsPar = {};
    comRows.forEach((r) => (modCountsCom[r.modalidad] = (modCountsCom[r.modalidad] || 0) + 1));
    parRows.forEach((r) => (modCountsPar[r.modalidad] = (modCountsPar[r.modalidad] || 0) + 1));

    const modComp = modOrder.map((m) => ({
      modalidad: m,
      pctCom: ((modCountsCom[m] || 0) / comRows.length) * 100,
      pctPar: ((modCountsPar[m] || 0) / parRows.length) * 100,
    }));

    // Modalidad principal (mode)
    const totalModCounts = {};
    annotated.forEach((r) => (totalModCounts[r.modalidad] = (totalModCounts[r.modalidad] || 0) + 1));
    const modalidadPrincipal = Object.entries(totalModCounts).sort((a, b) => b[1] - a[1])[0][0];

    // Crosstab alcaldía (% dentro de cada grupo) + precio mediano por alcaldía
    const alcMap = {};
    annotated.forEach((r) => {
      const k = r.alcaldia_key;
      if (!alcMap[k]) {
        alcMap[k] = { key: k, alcaldia: r.alcaldia, allPrices: [], nCom: 0, nPar: 0 };
      }
      alcMap[k].allPrices.push(r.precio);
      if (r.grupo === COM) alcMap[k].nCom++;
      else alcMap[k].nPar++;
    });

    const alcAll = Object.values(alcMap).map((a) => {
      const pctCom = (a.nCom / comRows.length) * 100;
      const pctPar = (a.nPar / parRows.length) * 100;
      return {
        key: a.key,
        alcaldia: a.alcaldia,
        anuncios: a.allPrices.length,
        nCom: a.nCom,
        nPar: a.nPar,
        precioMediano: S.quantileSorted(S.sortedNumbers(a.allPrices), 0.5),
        pctCom,
        pctPar,
        diffPP: Math.round((pctCom - pctPar) * 10) / 10,
      };
    });

    const alcByKey = {};
    alcAll.forEach((a) => (alcByKey[a.key] = a));

    const top8Ubic = [...alcAll].sort((a, b) => b.pctCom - a.pctCom).slice(0, 8);
    const bubbleAlcs = alcAll
      .filter((a) => a.anuncios >= MIN_N_BURBUJA)
      .sort((a, b) => b.precioMediano - a.precioMediano);
    const excludedBubbleAlcs = alcAll.filter((a) => a.anuncios < MIN_N_BURBUJA).map((a) => a.alcaldia);

    // 4.5.2 Estratos comparables (alcaldía × modalidad con n >= 30 en ambos grupos)
    const pairMap = {};
    annotated.forEach((r) => {
      const id = `${r.alcaldia_key}||${r.modalidad}`;
      if (!pairMap[id]) {
        pairMap[id] = {
          id,
          alcKey: r.alcaldia_key,
          alcaldia: r.alcaldia,
          modalidad: r.modalidad,
          comPrices: [],
          parPrices: [],
        };
      }
      if (r.grupo === COM) pairMap[id].comPrices.push(r.precio);
      else pairMap[id].parPrices.push(r.precio);
    });

    const estratos = [];
    Object.values(pairMap).forEach((g) => {
      if (g.comPrices.length >= MIN_N_ESTRATO && g.parPrices.length >= MIN_N_ESTRATO) {
        const medCom = S.quantileSorted(S.sortedNumbers(g.comPrices), 0.5);
        const medPar = S.quantileSorted(S.sortedNumbers(g.parPrices), 0.5);
        const diffPct = Math.round(((medCom / medPar) - 1) * 1000) / 10;
        estratos.push({
          id: g.id,
          alcKey: g.alcKey,
          alcaldia: g.alcaldia,
          modalidad: g.modalidad,
          nCom: g.comPrices.length,
          nPar: g.parPrices.length,
          medCom,
          medPar,
          diffPct,
          peso: g.comPrices.length + g.parPrices.length,
        });
      }
    });

    estratos.sort((a, b) => b.diffPct - a.diffPct);

    const nCaros = estratos.filter((e) => e.diffPct > 0).length;
    const nBaratos = estratos.filter((e) => e.diffPct < 0).length;
    const diffMediana = S.quantileSorted(S.sortedNumbers(estratos.map((e) => e.diffPct)), 0.5);
    const sumPeso = estratos.reduce((acc, e) => acc + e.peso, 0);
    const diffPonderada = sumPeso
      ? estratos.reduce((acc, e) => acc + e.diffPct * e.peso, 0) / sumPeso
      : NaN;

    // Índice rápido de estratos por modalidad y alcaldía para el mapa del Acto 2
    const estratoByModAlc = {
      "Alojamiento completo": {},
      "Habitación privada": {},
      "Habitación compartida": {},
    };
    estratos.forEach((e) => {
      if (!estratoByModAlc[e.modalidad]) estratoByModAlc[e.modalidad] = {};
      estratoByModAlc[e.modalidad][e.alcKey] = e;
    });

    // 4.5.2b Boxplots agrupados: modalidad principal en las 6 alcaldías con más anuncios totales
    const top6Alcs = [...alcAll]
      .sort((a, b) => b.anuncios - a.anuncios)
      .slice(0, 6)
      .map((a) => {
        const sub = annotated.filter((r) => r.alcaldia_key === a.key && r.modalidad === modalidadPrincipal);
        const comP = sub.filter((r) => r.grupo === COM).map((r) => r.precio);
        const parP = sub.filter((r) => r.grupo === PAR).map((r) => r.precio);
        return {
          key: a.key,
          alcaldia: a.alcaldia,
          totalAlc: a.anuncios,
          com: boxWhiskers(comP),
          par: boxWhiskers(parP),
        };
      });
    const top6Keys = new Set(top6Alcs.map((a) => a.key));

    // 4.5.3 Caso atípico: Azcapotzalco · Comercial (10+) · modalidad principal
    const azcKey = window.DataStore.normalizeKey("Azcapotzalco");
    const azcEst = estratoByModAlc[modalidadPrincipal] && estratoByModAlc[modalidadPrincipal][azcKey];
    const focusCaseAlcKey = azcEst ? azcKey : estratos[estratos.length - 1].alcKey;
    const focusCaseAlcName = alcByKey[focusCaseAlcKey] ? alcByKey[focusCaseAlcKey].alcaldia : "Azcapotzalco";

    const azcComRows = annotated.filter(
      (r) => r.alcaldia_key === focusCaseAlcKey && r.grupo === COM && r.modalidad === modalidadPrincipal
    );
    const azcParRows = annotated.filter(
      (r) => r.alcaldia_key === focusCaseAlcKey && r.grupo === PAR && r.modalidad === modalidadPrincipal
    );

    const hostGroups = {};
    azcComRows.forEach((r) => {
      if (!hostGroups[r.host_id]) hostGroups[r.host_id] = [];
      hostGroups[r.host_id].push(r.precio);
    });

    const azcTopHosts = Object.entries(hostGroups)
      .map(([hostId, prices]) => ({
        hostId,
        anuncios: prices.length,
        precioMediano: S.quantileSorted(S.sortedNumbers(prices), 0.5),
        pctComercial: azcComRows.length ? (prices.length / azcComRows.length) * 100 : 0,
      }))
      .sort((a, b) => b.anuncios - a.anuncios);

    const dominantHost = azcTopHosts[0] || null;
    const azcAllModRows = [...azcComRows, ...azcParRows];
    const azcBounds = azcAllModRows.length
      ? L.latLngBounds(azcAllModRows.map((r) => [r.lat, r.lon]))
      : null;

    metrics = {
      totalN: annotated.length,
      compCom,
      compPar,
      diffBruta,
      modComp,
      modalidadPrincipal,
      alcAll,
      alcByKey,
      top8Ubic,
      bubbleAlcs,
      excludedBubbleAlcs,
      estratos,
      nCaros,
      nBaratos,
      diffMediana,
      diffPonderada,
      estratoByModAlc,
      top6Alcs,
      top6Keys,
      focusCaseAlcKey,
      focusCaseAlcName,
      azcComCount: azcComRows.length,
      azcParCount: azcParRows.length,
      azcTopHosts: azcTopHosts.slice(0, 5),
      dominantHost,
      azcAllModRows,
      azcBounds,
      azcEstComp: estratoByModAlc[modalidadPrincipal] ? estratoByModAlc[modalidadPrincipal][focusCaseAlcKey] : null,
      azcEstPriv: estratoByModAlc["Habitación privada"] ? estratoByModAlc["Habitación privada"][focusCaseAlcKey] : null,
    };
  }

  function pointPopupHtml(p) {
    const S = window.Stats;
    const isDom =
      state.act === 3 &&
      state.act3MapFocus === "azcapotzalco" &&
      metrics.dominantHost &&
      p.host_id === metrics.dominantHost.hostId;

    return `
      <div class="popup-title">${p.alcaldia}${isDom ? " · Anfitrión dominante" : ""}</div>
      <div class="popup-grid">
        <span class="popup-k">Grupo</span><span class="popup-v">${p.grupo}</span>
        <span class="popup-k">Precio / noche</span><span class="popup-v">${S.fmtMXN(p.precio, 2)} MXN</span>
        <span class="popup-k">Modalidad</span><span class="popup-v">${p.modalidad}</span>
        <span class="popup-k">ID Anfitrión</span><span class="popup-v">${p.host_id} (${S.fmtInt(p.anuncios_anfitrion)} an.)</span>
      </div>
    `;
  }

  function fitAzcapotzalco() {
    const map = refs.mapApi.getMap();
    if (!map || !metrics.azcBounds || !metrics.azcBounds.isValid()) return;
    const panel = document.getElementById("side-panel");
    const panelOpen = panel && !panel.classList.contains("collapsed");
    const rightPad = panelOpen ? Math.min(panel.offsetWidth + 28, window.innerWidth * 0.58) : 28;
    map.fitBounds(metrics.azcBounds, {
      paddingTopLeft: [36, 36],
      paddingBottomRight: [rightPad, 36],
      maxZoom: 14,
      animate: true,
    });
  }

  function syncPointsForCurrentAct() {
    // Acto 1: puntos solo si el usuario activa el checkbox o selecciona una alcaldía
    if (state.act === 1) {
      let pts = [];
      if (state.showPointsAct1) {
        pts = allRows;
      } else if (state.selectedAlcKey) {
        pts = allRows.filter((r) => r.alcaldia_key === state.selectedAlcKey);
      }
      refs.mapApi.setPoints(pts, {
        colorFn: (p) => (p.grupo === COM ? COLOR_COM : COLOR_PAR),
        radiusFn: () => (state.selectedAlcKey && !state.showPointsAct1 ? 2.4 : 1.8),
        alphaFn: () => (state.selectedAlcKey && !state.showPointsAct1 ? 0.68 : 0.42),
        popupFn: pointPopupHtml,
      });
      return;
    }

    // Acto 2: puntos del estrato / alcaldía seleccionada (o todos de la modalidad activa si se activa checkbox)
    if (state.act === 2) {
      let pts = [];
      if (state.showAllPointsAct2) {
        pts = allRows.filter((r) => r.modalidad === state.choroModAct2);
      } else if (state.selectedStratumId) {
        const est = metrics.estratos.find((e) => e.id === state.selectedStratumId);
        if (est) {
          pts = allRows.filter((r) => r.alcaldia_key === est.alcKey && r.modalidad === est.modalidad);
        }
      } else if (state.selectedAlcKey) {
        pts = allRows.filter(
          (r) => r.alcaldia_key === state.selectedAlcKey && r.modalidad === state.choroModAct2
        );
      }
      refs.mapApi.setPoints(pts, {
        colorFn: (p) => (p.grupo === COM ? COLOR_COM : COLOR_PAR),
        radiusFn: () => (state.showAllPointsAct2 ? 1.9 : 2.6),
        alphaFn: () => (state.showAllPointsAct2 ? 0.42 : 0.72),
        popupFn: pointPopupHtml,
      });
      return;
    }

    // Acto 3: Zoom Azcapotzalco destacando al host dominante vs. Vista 6 alcaldías
    if (state.act3MapFocus === "azcapotzalco") {
      const domId = metrics.dominantHost ? metrics.dominantHost.hostId : "";
      // Ordenar para pintar al anfitrión dominante encima
      const ordered = [...metrics.azcAllModRows].sort((a, b) => {
        const aDom = a.host_id === domId ? 1 : 0;
        const bDom = b.host_id === domId ? 1 : 0;
        return aDom - bDom;
      });
      refs.mapApi.setPoints(ordered, {
        colorFn: (p) => {
          if (p.host_id === domId) return COLOR_DOM;
          return p.grupo === COM ? COLOR_COM : COLOR_PAR;
        },
        radiusFn: (p) => (p.host_id === domId ? 3.8 : 2.6),
        alphaFn: (p) => (p.host_id === domId ? 0.92 : 0.65),
        popupFn: pointPopupHtml,
      });
    } else {
      let pts = [];
      if (state.selectedAlcKey) {
        pts = allRows.filter(
          (r) => r.alcaldia_key === state.selectedAlcKey && r.modalidad === metrics.modalidadPrincipal
        );
      }
      refs.mapApi.setPoints(pts, {
        colorFn: (p) => (p.grupo === COM ? COLOR_COM : COLOR_PAR),
        radiusFn: () => 2.4,
        alphaFn: () => 0.68,
        popupFn: pointPopupHtml,
      });
    }
  }

  function tooltipHtml(key, rawName) {
    const S = window.Stats;
    const alc = metrics.alcByKey[key];
    if (!alc) return `<div class="choro-tt-title">${rawName}</div><div>Sin datos</div>`;

    if (state.act === 1) {
      const excl = alc.anuncios < MIN_N_BURBUJA
        ? `<div style="margin-top:4px;color:#FCD34D;font-size:10.5px;">⚠ Menos de ${MIN_N_BURBUJA} anuncios (excluida de burbujas)</div>`
        : "";
      return `
        <div class="choro-tt-title">${alc.alcaldia}</div>
        <div class="choro-tt-row"><span class="choro-tt-k">% Com − % Par</span><span class="choro-tt-v">${S.fmtSigned(alc.diffPP, 1)} pp</span></div>
        <div class="choro-tt-row"><span class="choro-tt-k">Peso en Com / Par</span><span class="choro-tt-v">${alc.pctCom.toFixed(1)}% / ${alc.pctPar.toFixed(1)}%</span></div>
        <div class="choro-tt-row"><span class="choro-tt-k">Mediana alcaldía</span><span class="choro-tt-v">${S.fmtMXN(alc.precioMediano)}</span></div>
        <div class="choro-tt-row"><span class="choro-tt-k">Anuncios (Com / Par)</span><span class="choro-tt-v">${S.fmtInt(alc.nCom)} / ${S.fmtInt(alc.nPar)}</span></div>
        ${excl}
      `;
    }

    if (state.act === 2) {
      const est = metrics.estratoByModAlc[state.choroModAct2] && metrics.estratoByModAlc[state.choroModAct2][key];
      if (!est) {
        return `
          <div class="choro-tt-title">${alc.alcaldia}</div>
          <div class="choro-tt-row"><span class="choro-tt-k">${state.choroModAct2}</span><span class="choro-tt-v">Sin mínimo (n &ge; ${MIN_N_ESTRATO})</span></div>
        `;
      }
      return `
        <div class="choro-tt-title">${est.alcaldia} · ${shortModName(est.modalidad)}</div>
        <div class="choro-tt-row"><span class="choro-tt-k">Diferencia Com vs Par</span><span class="choro-tt-v">${S.fmtSigned(est.diffPct, 1)}%</span></div>
        <div class="choro-tt-row"><span class="choro-tt-k">Mediana Comercial</span><span class="choro-tt-v">${S.fmtMXN(est.medCom)} (n=${S.fmtInt(est.nCom)})</span></div>
        <div class="choro-tt-row"><span class="choro-tt-k">Mediana Particular</span><span class="choro-tt-v">${S.fmtMXN(est.medPar)} (n=${S.fmtInt(est.nPar)})</span></div>
      `;
    }

    // Acto 3
    if (state.act3MapFocus === "azcapotzalco") {
      if (key === metrics.focusCaseAlcKey && metrics.dominantHost) {
        return `
          <div class="choro-tt-title">${alc.alcaldia} · Caso atípico</div>
          <div class="choro-tt-row"><span class="choro-tt-k">Host dominante</span><span class="choro-tt-v">#${metrics.dominantHost.hostId} (${metrics.dominantHost.anuncios} an.)</span></div>
          <div class="choro-tt-row"><span class="choro-tt-k">Peso en oferta com.</span><span class="choro-tt-v">${metrics.dominantHost.pctComercial.toFixed(1)}%</span></div>
          <div class="choro-tt-row"><span class="choro-tt-k">Mediana host</span><span class="choro-tt-v">${S.fmtMXN(metrics.dominantHost.precioMediano)}</span></div>
        `;
      }
      return `<div class="choro-tt-title">${alc.alcaldia}</div><div>Enfoque actual en ${metrics.focusCaseAlcName}</div>`;
    }

    const topRec = metrics.top6Alcs.find((t) => t.key === key);
    if (!topRec) {
      return `<div class="choro-tt-title">${alc.alcaldia}</div><div>Fuera del Top 6 por volumen (${S.fmtInt(alc.anuncios)} an.)</div>`;
    }
    return `
      <div class="choro-tt-title">${topRec.alcaldia} · ${metrics.modalidadPrincipal}</div>
      <div class="choro-tt-row"><span class="choro-tt-k">Med. Comercial</span><span class="choro-tt-v">${S.fmtMXN(topRec.com.median)} (n=${S.fmtInt(topRec.com.n)})</span></div>
      <div class="choro-tt-row"><span class="choro-tt-k">Med. Particular</span><span class="choro-tt-v">${S.fmtMXN(topRec.par.median)} (n=${S.fmtInt(topRec.par.n)})</span></div>
    `;
  }

  async function syncMap() {
    const token = ++renderToken;

    await refs.mapApi.setChoropleth({
      selectedKey: state.selectedAlcKey,
      styleFn: (key, _rawName, { isSelected, isHovered }) => {
        if (state.act === 1) {
          const alc = metrics.alcByKey[key];
          const lowN = !alc || alc.anuncios < MIN_N_BURBUJA;
          return {
            fillColor: alc ? divColor(alc.diffPP, 20.5) : "#CBD5E1",
            fillOpacity: lowN ? 0.32 : isSelected ? 0.56 : isHovered ? 0.72 : 0.62,
            color: isSelected ? "#0F172A" : lowN ? "#8B6D3F" : "#FFFFFF",
            weight: isSelected ? 2.6 : lowN ? 1.5 : 1.1,
            dashArray: lowN && !isSelected ? "4 3" : null,
            opacity: 0.95,
          };
        }

        if (state.act === 2) {
          const est = metrics.estratoByModAlc[state.choroModAct2] && metrics.estratoByModAlc[state.choroModAct2][key];
          if (!est) {
            return {
              fillColor: "#CBD5E1",
              fillOpacity: 0.25,
              color: "#FFFFFF",
              weight: 1.0,
              opacity: 0.8,
            };
          }
          return {
            fillColor: divColor(est.diffPct, 35),
            fillOpacity: isSelected ? 0.54 : isHovered ? 0.72 : 0.62,
            color: isSelected ? "#0F172A" : "#FFFFFF",
            weight: isSelected ? 2.6 : 1.1,
            opacity: 0.95,
          };
        }

        // Acto 3
        if (state.act3MapFocus === "azcapotzalco") {
          const isFocus = key === metrics.focusCaseAlcKey;
          return {
            fillColor: isFocus ? "#FEF3C7" : "#E2E8F0",
            fillOpacity: isFocus ? 0.35 : 0.18,
            color: isFocus ? "#0F172A" : "#94A3B8",
            weight: isFocus ? 2.4 : 0.9,
            opacity: 0.95,
          };
        }

        const isTop6 = metrics.top6Keys.has(key);
        return {
          fillColor: isTop6 ? "#4A76A2" : "#CBD5E1",
          fillOpacity: isTop6 ? (isSelected ? 0.48 : isHovered ? 0.64 : 0.5) : 0.2,
          color: isSelected ? "#0F172A" : "#FFFFFF",
          weight: isSelected ? 2.6 : 1.1,
          opacity: 0.9,
        };
      },
      tooltipFn: tooltipHtml,
      onHover: (key) => {
        state.hoveredAlcKey = key;
        highlightLinkedElements();
      },
      onSelect: (key) => {
        if (state.act === 3 && state.act3MapFocus === "azcapotzalco") return;
        state.selectedAlcKey = state.selectedAlcKey === key ? null : key;
        if (state.act === 2) {
          const est =
            state.selectedAlcKey &&
            metrics.estratoByModAlc[state.choroModAct2] &&
            metrics.estratoByModAlc[state.choroModAct2][state.selectedAlcKey];
          state.selectedStratumId = est ? est.id : null;
        }
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
      const sid = el.getAttribute("data-stratum-id");
      const isSel = sid ? sid === state.selectedStratumId : k === state.selectedAlcKey;
      el.classList.toggle("is-selected", isSel);
      el.classList.toggle("is-hovered", k === state.hoveredAlcKey);
    });
  }

  function renderLegend() {
    const S = window.Stats;
    const el = refs.legendEl;

    if (state.act === 1) {
      el.innerHTML = `
        <div class="legend-title">Sesgo territorial (% Com − % Par)</div>
        <div class="legend-gradient" style="background:linear-gradient(90deg, #1E3A5F 0%, #EEF1F5 50%, #B84A39 100%)"></div>
        <div class="legend-scale mono"><span>+Particulares</span><span>0 pp</span><span>+Comerciales</span></div>
        <div class="legend-note"><span class="dashed-sample"></span> Borde punteado: n &lt; ${MIN_N_BURBUJA}</div>
        <div class="legend-item" style="margin-top:4px;"><span class="legend-left"><span class="swatch" style="background:${COLOR_COM}"></span>${COM}</span><span class="mono">${S.fmtInt(metrics.compCom.anuncios)}</span></div>
        <div class="legend-item"><span class="legend-left"><span class="swatch" style="background:${COLOR_PAR}"></span>${PAR}</span><span class="mono">${S.fmtInt(metrics.compPar.anuncios)}</span></div>
      `;
      return;
    }

    if (state.act === 2) {
      el.innerHTML = `
        <div class="legend-title">Brecha Com vs Par · ${shortModName(state.choroModAct2)}</div>
        <div class="legend-gradient" style="background:linear-gradient(90deg, #1E3A5F 0%, #EEF1F5 50%, #B84A39 100%)"></div>
        <div class="legend-scale mono"><span>Com. más barato</span><span>0%</span><span>Com. más caro</span></div>
        <div class="svg-footnote" style="margin-top:3px;">Gris plano: alcaldía sin mínimo de ${MIN_N_ESTRATO} anuncios en ambos grupos.</div>
      `;
      return;
    }

    if (state.act3MapFocus === "azcapotzalco" && metrics.dominantHost) {
      const dom = metrics.dominantHost;
      el.innerHTML = `
        <div class="legend-title">${metrics.focusCaseAlcName} · ${shortModName(metrics.modalidadPrincipal)}</div>
        <div class="legend-item"><span class="legend-left"><span class="swatch" style="background:${COLOR_DOM}"></span>Host #${dom.hostId}</span><span class="mono">${dom.anuncios} (${S.fmtMXN(dom.precioMediano)})</span></div>
        <div class="legend-item"><span class="legend-left"><span class="swatch" style="background:${COLOR_COM}"></span>Otros comerciales</span><span class="mono">${metrics.azcComCount - dom.anuncios}</span></div>
        <div class="legend-item"><span class="legend-left"><span class="swatch" style="background:${COLOR_PAR}"></span>${PAR}</span><span class="mono">${metrics.azcParCount}</span></div>
      `;
      return;
    }

    el.innerHTML = `
      <div class="legend-title">Top 6 alcaldías (Aloj. completo)</div>
      <div class="legend-item"><span class="legend-left"><span class="swatch" style="background:#4A76A2"></span>Incluidas en boxplot</span><span class="mono">6 alcaldías</span></div>
      <div class="legend-item"><span class="legend-left"><span class="swatch" style="background:${COLOR_COM}"></span>${COM}</span><span class="mono">Clic = puntos</span></div>
      <div class="legend-item"><span class="legend-left"><span class="swatch" style="background:${COLOR_PAR}"></span>${PAR}</span><span class="mono">Clic = puntos</span></div>
    `;
  }

  // --- SVG 1 (Acto 1): Composición por Modalidad y Top 8 Alcaldías ---
  function buildCompositionSVG() {
    const W = 490;
    const H = 228;
    const midX = 215;

    // Panel Izquierdo: Modalidad
    const pL = { left: 74, right: midX - 10, top: 24, bottom: 26 };
    const wL = pL.right - pL.left;
    const hL = H - pL.top - pL.bottom;
    const maxMod = 75;
    const xL = (v) => pL.left + (Math.min(v, maxMod) / maxMod) * wL;

    const modRows = metrics.modComp; // completo arriba o abajo; orden fiel al notebook
    const modStep = hL / modRows.length;

    const leftGrid = [0, 25, 50, 75]
      .map((t) => {
        const x = xL(t);
        return `
          <line x1="${x}" y1="${pL.top}" x2="${x}" y2="${H - pL.bottom}" stroke="#E2E8F0" stroke-width="1" />
          <text x="${x}" y="${H - 10}" text-anchor="middle" class="svg-axis-txt">${t}%</text>
        `;
      })
      .join("");

    const leftBars = modRows
      .map((m, i) => {
        const yMid = pL.top + i * modStep + modStep / 2;
        return `
          <g>
            <title>${m.modalidad}&#10;${COM}: ${m.pctCom.toFixed(1)}%&#10;${PAR}: ${m.pctPar.toFixed(1)}%</title>
            <text x="${pL.left - 6}" y="${yMid + 3}" text-anchor="end" class="svg-row-lbl">${shortModName(m.modalidad)}</text>
            <rect x="${pL.left}" y="${yMid - 8}" width="${Math.max(1.5, xL(m.pctCom) - pL.left)}" height="7" rx="1.5" fill="${COLOR_COM}" />
            <rect x="${pL.left}" y="${yMid + 1}" width="${Math.max(1.5, xL(m.pctPar) - pL.left)}" height="7" rx="1.5" fill="${COLOR_PAR}" />
          </g>
        `;
      })
      .join("");

    // Panel Derecho: Top 8 alcaldías con más comerciales
    const pR = { left: midX + 108, right: W - 12, top: 24, bottom: 26 };
    const wR = pR.right - pR.left;
    const hR = H - pR.top - pR.bottom;
    const maxU = Math.max(65, Math.ceil(Math.max(...metrics.top8Ubic.map((a) => Math.max(a.pctCom, a.pctPar))) / 10) * 10);
    const xR = (v) => pR.left + (v / maxU) * wR;
    const uStep = hR / metrics.top8Ubic.length;

    const rightGrid = [0, 20, 40, 60]
      .filter((t) => t <= maxU)
      .map((t) => {
        const x = xR(t);
        return `
          <line x1="${x}" y1="${pR.top}" x2="${x}" y2="${H - pR.bottom}" stroke="#E2E8F0" stroke-width="1" />
          <text x="${x}" y="${H - 10}" text-anchor="middle" class="svg-axis-txt">${t}%</text>
        `;
      })
      .join("");

    const rightBars = metrics.top8Ubic
      .map((a, i) => {
        const yMid = pR.top + i * uStep + uStep / 2;
        return `
          <g class="svg-alc-row" data-alc-key="${a.key}">
            <title>${a.alcaldia}&#10;${COM}: ${a.pctCom.toFixed(1)}%&#10;${PAR}: ${a.pctPar.toFixed(1)}%&#10;Diferencia: ${window.Stats.fmtSigned(a.diffPP, 1)} pp</title>
            <rect class="svg-row-bg" x="${midX + 6}" y="${pR.top + i * uStep}" width="${W - midX - 10}" height="${uStep}" rx="3" />
            <text x="${pR.left - 6}" y="${yMid + 3}" text-anchor="end" class="svg-row-lbl">${shortAlcName(a.alcaldia)}</text>
            <rect x="${pR.left}" y="${yMid - 6.5}" width="${Math.max(1.5, xR(a.pctCom) - pR.left)}" height="5.8" rx="1.5" fill="${COLOR_COM}" />
            <rect x="${pR.left}" y="${yMid + 0.7}" width="${Math.max(1.5, xR(a.pctPar) - pR.left)}" height="5.8" rx="1.5" fill="${COLOR_PAR}" />
          </g>
        `;
      })
      .join("");

    return `
      <div class="svg-inline-legend">
        <span><i class="dot" style="background:${COLOR_COM}"></i> ${COM}</span>
        <span><i class="dot" style="background:${COLOR_PAR}"></i> ${PAR}</span>
      </div>
      <svg viewBox="0 0 ${W} ${H}" class="p1-svg" role="img" aria-label="Composición de la oferta por modalidad y alcaldía">
        <text x="${pL.left + wL / 2}" y="13" text-anchor="middle" class="svg-cat-txt">Modalidad (% del grupo)</text>
        <text x="${pR.left + wR / 2}" y="13" text-anchor="middle" class="svg-cat-txt">Top 8 alcaldías (% del grupo)</text>
        ${leftGrid}
        ${leftBars}
        ${rightGrid}
        ${rightBars}
      </svg>
    `;
  }

  // --- SVG 2 (Acto 1): Burbujas precio mediano vs (% Com - % Par) en alcaldías n >= 100 ---
  function buildBubbleSVG() {
    const S = window.Stats;
    const data = metrics.bubbleAlcs;
    const W = 490;
    const H = 250;
    const pad = { top: 18, right: 24, bottom: 32, left: 46 };
    const plotW = W - pad.left - pad.right;
    const plotH = H - pad.top - pad.bottom;

    const xMin = Math.floor(Math.min(...data.map((d) => d.precioMediano)) / 100) * 100 - 40;
    const xMax = Math.ceil(Math.max(...data.map((d) => d.precioMediano)) / 100) * 100 + 80;
    const yMin = Math.min(-10, ...data.map((d) => d.diffPP - 2));
    const yMax = Math.max(23, ...data.map((d) => d.diffPP + 3));

    const xOf = (v) => pad.left + ((v - xMin) / (xMax - xMin)) * plotW;
    const yOf = (v) => pad.top + ((yMax - v) / (yMax - yMin)) * plotH;
    const maxN = Math.max(...data.map((d) => d.anuncios));
    const rOf = (n) => 3.5 + Math.sqrt(n / maxN) * 14.5;

    const xTicks = [800, 1000, 1200, 1400, 1600, 1800].filter((t) => t >= xMin && t <= xMax);
    const yTicks = [-10, -5, 0, 5, 10, 15, 20].filter((t) => t >= yMin && t <= yMax);

    const gridX = xTicks
      .map((t) => {
        const x = xOf(t);
        return `
          <line x1="${x}" y1="${pad.top}" x2="${x}" y2="${H - pad.bottom}" stroke="#E2E8F0" stroke-width="1" />
          <text x="${x}" y="${H - 14}" text-anchor="middle" class="svg-axis-txt">${S.fmtMXN(t)}</text>
        `;
      })
      .join("");

    const gridY = yTicks
      .map((t) => {
        const y = yOf(t);
        const isZero = t === 0;
        return `
          <line x1="${pad.left}" y1="${y}" x2="${W - pad.right}" y2="${y}"
                stroke="${isZero ? "#334155" : "#E2E8F0"}" stroke-width="${isZero ? 1.3 : 1}" />
          <text x="${pad.left - 7}" y="${y + 3}" text-anchor="end" class="svg-axis-txt">${t > 0 ? `+${t}` : t}</text>
        `;
      })
      .join("");

    // Etiquetas selectivas para evitar encimamiento visual (el resto se inspecciona con hover/clic)
    const labelOffsets = {
      "Cuauhtémoc": { dx: -14, dy: -18, anchor: "middle" },
      "Miguel Hidalgo": { dx: -8, dy: -12, anchor: "end" },
      "Cuajimalpa de Morelos": { dx: -6, dy: 13, anchor: "end" },
      "Benito Juárez": { dx: 11, dy: 3, anchor: "start" },
      "Coyoacán": { dx: 10, dy: 2, anchor: "start" },
      "Álvaro Obregón": { dx: 7, dy: 11, anchor: "start" },
      "Azcapotzalco": { dx: 6, dy: -6, anchor: "start" },
      "Iztapalapa": { dx: 6, dy: -5, anchor: "start" },
    };

    const bubbles = data
      .map((d) => {
        const cx = xOf(d.precioMediano);
        const cy = yOf(d.diffPP);
        const r = rOf(d.anuncios);
        const fill = d.diffPP >= 0 ? COLOR_COM : COLOR_PAR;
        const off = labelOffsets[d.alcaldia];
        const lbl = off
          ? `<text x="${(cx + off.dx).toFixed(1)}" y="${(cy + off.dy).toFixed(1)}" text-anchor="${off.anchor}" class="svg-sub-txt" style="fill:#334155;font-weight:600">${shortAlcName(d.alcaldia)}</text>`
          : "";
        return `
          <g class="svg-alc-row" data-alc-key="${d.key}">
            <title>${d.alcaldia} (n=${S.fmtInt(d.anuncios)})&#10;Mediana alcaldía: ${S.fmtMXN(d.precioMediano, 2)}&#10;% Com − % Par: ${S.fmtSigned(d.diffPP, 1)} pp (${d.pctCom.toFixed(1)}% vs ${d.pctPar.toFixed(1)}%)</title>
            <circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}"
                    fill="${fill}" fill-opacity="0.62" stroke="#FFFFFF" stroke-width="1.2" />
            ${lbl}
          </g>
        `;
      })
      .join("");

    return `
      <svg viewBox="0 0 ${W} ${H}" class="p1-svg" role="img" aria-label="Concentración de anuncios comerciales según precio de la alcaldía">
        ${gridX}
        ${gridY}
        ${bubbles}
        <text x="${pad.left + plotW / 2}" y="${H - 2}" text-anchor="middle" class="svg-sub-txt">Precio mediano por noche en la alcaldía (MXN)</text>
        <text x="11" y="${pad.top + plotH / 2}" text-anchor="middle" class="svg-sub-txt" transform="rotate(-90 11 ${pad.top + plotH / 2})">% comerciales − % particulares (pp)</text>
      </svg>
      <div class="svg-footnote">
        Tamaño = número de anuncios · ${data.length} alcaldías con n &ge; ${MIN_N_BURBUJA} (excluidas: ${metrics.excludedBubbleAlcs.join(", ") || "ninguna"}). Haz clic en una burbuja o alcaldía del mapa para ver sus puntos.
      </div>
    `;
  }

  // --- SVG 3 (Acto 2): 20 barras divergentes por estrato (alcaldía × modalidad) ---
  function buildStrataBarsSVG() {
    const S = window.Stats;
    const rows = metrics.estratos;
    const rowH = 20;
    const pad = { top: 20, right: 42, bottom: 26, left: 194 };
    const W = 490;
    const H = pad.top + rows.length * rowH + pad.bottom;
    const plotW = W - pad.left - pad.right;

    const minV = Math.min(-55, ...rows.map((r) => r.diffPct - 4));
    const maxV = Math.max(52, ...rows.map((r) => r.diffPct + 4));
    const xOf = (v) => pad.left + ((v - minV) / (maxV - minV)) * plotW;
    const x0 = xOf(0);
    const xBruta = xOf(metrics.diffBruta);
    const xMed = xOf(metrics.diffMediana);

    const ticks = [-40, -20, 0, 20, 40].filter((t) => t >= minV && t <= maxV);
    const grid = ticks
      .map((t) => {
        const x = xOf(t);
        const isZero = t === 0;
        return `
          <line x1="${x}" y1="${pad.top}" x2="${x}" y2="${H - pad.bottom}"
                stroke="${isZero ? "#334155" : "#E2E8F0"}" stroke-width="${isZero ? 1.3 : 1}" />
          <text x="${x}" y="${H - 8}" text-anchor="middle" class="svg-axis-txt">${t > 0 ? `+${t}%` : `${t}%`}</text>
        `;
      })
      .join("");

    const refsSvg = `
      <line x1="${xBruta}" y1="${pad.top}" x2="${xBruta}" y2="${H - pad.bottom}" stroke="#D97706" stroke-width="1.35" stroke-dasharray="4 3" />
      <text x="${xBruta}" y="${pad.top - 5}" text-anchor="middle" class="svg-sub-txt" style="fill:#B45309;font-weight:600">Bruta +${metrics.diffBruta.toFixed(0)}%</text>
      <line x1="${xMed}" y1="${pad.top}" x2="${xMed}" y2="${H - pad.bottom}" stroke="#0F172A" stroke-width="1.25" stroke-dasharray="2 3" />
      <text x="${xMed - 2}" y="${pad.top - 5}" text-anchor="end" class="svg-sub-txt" style="fill:#0F172A;font-weight:600">Med. +${metrics.diffMediana.toFixed(1)}%</text>
    `;

    const bars = rows
      .map((r, i) => {
        const yMid = pad.top + i * rowH + rowH / 2;
        const xv = xOf(r.diffPct);
        const bx = r.diffPct >= 0 ? x0 : xv;
        const bw = Math.max(2, Math.abs(xv - x0));
        const col = r.diffPct >= 0 ? COLOR_COM : COLOR_PAR;
        const lbl = `${shortAlcName(r.alcaldia)} · ${shortModName(r.modalidad)}`;
        const valX = r.diffPct >= 0 ? xv + 4 : xv - 4;
        const anchor = r.diffPct >= 0 ? "start" : "end";

        return `
          <g class="svg-alc-row" data-alc-key="${r.alcKey}" data-stratum-id="${r.id}">
            <title>${r.alcaldia} · ${r.modalidad}&#10;Comercial: ${S.fmtMXN(r.medCom, 2)} (n=${S.fmtInt(r.nCom)})&#10;Particular: ${S.fmtMXN(r.medPar, 2)} (n=${S.fmtInt(r.nPar)})&#10;Diferencia: ${S.fmtSigned(r.diffPct, 1)}%</title>
            <rect class="svg-row-bg" x="0" y="${pad.top + i * rowH}" width="${W}" height="${rowH}" rx="3" />
            <text x="${pad.left - 6}" y="${yMid + 3}" text-anchor="end" class="svg-row-lbl">${lbl}</text>
            <rect x="${bx}" y="${yMid - 5.2}" width="${bw}" height="10.4" rx="2" fill="${col}" fill-opacity="0.86" />
            <text x="${valX}" y="${yMid + 3}" text-anchor="${anchor}" class="svg-val-txt" style="font-size:8.8px">${S.fmtSigned(r.diffPct, 1)}%</text>
          </g>
        `;
      })
      .join("");

    return `
      <svg viewBox="0 0 ${W} ${H}" class="p1-svg" role="img" aria-label="Diferencia porcentual por alcaldía y modalidad">
        ${grid}
        ${bars}
        ${refsSvg}
      </svg>
      <div class="svg-footnote">
        Positivo (terracota) = comerciales cobran más · Negativo (azul) = particulares cobran más. Haz clic en cualquier barra para ver los anuncios reales de ese estrato en el mapa.
      </div>
    `;
  }

  // --- SVG 4 (Acto 3): Boxplots agrupados en escala log (Top 6 alcaldías, showfliers=False) ---
  function buildTop6BoxplotsSVG() {
    const S = window.Stats;
    const rows = metrics.top6Alcs;
    const W = 490;
    const H = 248;
    const pad = { top: 14, right: 14, bottom: 44, left: 52 };
    const plotW = W - pad.left - pad.right;
    const plotH = H - pad.top - pad.bottom;

    const lows = rows.flatMap((r) => [r.com.wLow, r.par.wLow]).filter((v) => Number.isFinite(v) && v > 0);
    const highs = rows.flatMap((r) => [r.com.wHigh, r.par.wHigh]).filter((v) => Number.isFinite(v) && v > 0);
    const yMin = Math.min(200, ...lows.map((v) => v * 0.85));
    const yMax = Math.max(10000, ...highs.map((v) => v * 1.15));
    const logMin = Math.log10(yMin);
    const logMax = Math.log10(yMax);
    const yOf = (v) => pad.top + ((logMax - Math.log10(v)) / (logMax - logMin)) * plotH;

    const ticks = [200, 500, 1000, 2000, 5000, 10000].filter((t) => t >= yMin && t <= yMax);
    const grid = ticks
      .map((t) => {
        const y = yOf(t);
        return `
          <line x1="${pad.left}" y1="${y}" x2="${W - pad.right}" y2="${y}" stroke="#E2E8F0" stroke-width="1" />
          <text x="${pad.left - 6}" y="${y + 3}" text-anchor="end" class="svg-axis-txt">${S.fmtMXN(t)}</text>
        `;
      })
      .join("");

    const grpW = plotW / rows.length;
    const boxW = Math.min(20, grpW * 0.30);
    const gap = 3;

    const drawBox = (stats, cx, color, label) => {
      if (!stats.n) return "";
      const yQ1 = yOf(stats.q1);
      const yQ3 = yOf(stats.q3);
      const yMed = yOf(stats.median);
      const yLo = yOf(stats.wLow);
      const yHi = yOf(stats.wHigh);
      return `
        <g>
          <title>${label} (n=${S.fmtInt(stats.n)})&#10;Mediana: ${S.fmtMXN(stats.median, 2)}&#10;Q1–Q3: ${S.fmtMXN(stats.q1, 0)} – ${S.fmtMXN(stats.q3, 0)}&#10;Bigotes: ${S.fmtMXN(stats.wLow, 0)} – ${S.fmtMXN(stats.wHigh, 0)}</title>
          <line x1="${cx}" y1="${yHi}" x2="${cx}" y2="${yLo}" stroke="${color}" stroke-width="1.3" />
          <line x1="${cx - boxW * 0.3}" y1="${yHi}" x2="${cx + boxW * 0.3}" y2="${yHi}" stroke="${color}" stroke-width="1.3" />
          <line x1="${cx - boxW * 0.3}" y1="${yLo}" x2="${cx + boxW * 0.3}" y2="${yLo}" stroke="${color}" stroke-width="1.3" />
          <rect x="${cx - boxW / 2}" y="${yQ3}" width="${boxW}" height="${Math.max(2, yQ1 - yQ3)}"
                fill="${color}" fill-opacity="0.82" rx="2" stroke="#0F172A" stroke-opacity="0.18" />
          <line x1="${cx - boxW / 2}" y1="${yMed}" x2="${cx + boxW / 2}" y2="${yMed}" stroke="#FFFFFF" stroke-width="2" />
        </g>
      `;
    };

    const groupsSvg = rows
      .map((r, i) => {
        const center = pad.left + grpW * (i + 0.5);
        const cxCom = center - boxW / 2 - gap / 2;
        const cxPar = center + boxW / 2 + gap / 2;
        const lbl = r.alcaldia === "Venustiano Carranza" ? "V. Carranza" : r.alcaldia;
        return `
          <g class="svg-alc-row" data-alc-key="${r.key}">
            <rect class="svg-row-bg" x="${pad.left + i * grpW + 2}" y="${pad.top}" width="${grpW - 4}" height="${plotH}" rx="4" />
            ${drawBox(r.com, cxCom, COLOR_COM, `${r.alcaldia} · ${COM}`)}
            ${drawBox(r.par, cxPar, COLOR_PAR, `${r.alcaldia} · ${PAR}`)}
            <text x="${center}" y="${H - 22}" text-anchor="middle" class="svg-cat-txt" style="font-size:8.8px">${lbl}</text>
            <text x="${center}" y="${H - 9}" text-anchor="middle" class="svg-sub-txt" style="font-size:8.2px">${S.fmtInt(r.com.n)} vs ${S.fmtInt(r.par.n)}</text>
          </g>
        `;
      })
      .join("");

    return `
      <div class="svg-inline-legend">
        <span><i class="dot" style="background:${COLOR_COM}"></i> ${COM}</span>
        <span><i class="dot" style="background:${COLOR_PAR}"></i> ${PAR}</span>
        <span style="color:#64748b;">(escala log · sin extremos aislados)</span>
      </div>
      <svg viewBox="0 0 ${W} ${H}" class="p1-svg" role="img" aria-label="Boxplots agrupados por tipo de anfitrión en las 6 alcaldías principales">
        ${grid}
        ${groupsSvg}
      </svg>
      <div class="svg-footnote">
        Debajo de cada alcaldía: anuncios comerciales vs. particulares en ${metrics.modalidadPrincipal}. Las cajas se superponen ampliamente en todos los casos.
      </div>
    `;
  }

  function updateSelectedBanner() {
    const box = document.getElementById("p5-selected-box");
    if (!box) return;
    const S = window.Stats;

    if (state.act === 1 && state.selectedAlcKey && metrics.alcByKey[state.selectedAlcKey]) {
      const a = metrics.alcByKey[state.selectedAlcKey];
      box.innerHTML = `
        <div class="selected-alc-card">
          <div class="selected-alc-head">
            <div>
              <strong>${a.alcaldia}</strong>
              <div class="selected-alc-sub">Puntos visibles: ${S.fmtInt(a.nCom)} comerciales y ${S.fmtInt(a.nPar)} particulares</div>
            </div>
            <button id="p5-clear-sel" class="mini-btn">Limpiar</button>
          </div>
          <div class="selected-alc-grid mono">
            <div><span>Peso grupo</span><strong>${a.pctCom.toFixed(1)}% Com</strong> <small>vs ${a.pctPar.toFixed(1)}% Par (${S.fmtSigned(a.diffPP, 1)} pp)</small></div>
            <div><span>Mediana alc.</span><strong>${S.fmtMXN(a.precioMediano, 2)}</strong> <small>(n=${S.fmtInt(a.anuncios)} anuncios)</small></div>
          </div>
        </div>
      `;
    } else if (state.act === 2 && state.selectedStratumId) {
      const est = metrics.estratos.find((e) => e.id === state.selectedStratumId);
      if (est) {
        box.innerHTML = `
          <div class="selected-alc-card">
            <div class="selected-alc-head">
              <div>
                <strong>${est.alcaldia} · ${est.modalidad}</strong>
                <div class="selected-alc-sub">Puntos del estrato visibles en el mapa (${S.fmtInt(est.peso)} anuncios)</div>
              </div>
              <button id="p5-clear-sel" class="mini-btn">Limpiar</button>
            </div>
            <div class="selected-alc-grid mono">
              <div><span>${COM}</span><strong>${S.fmtMXN(est.medCom, 2)}</strong> <small>(n=${S.fmtInt(est.nCom)})</small></div>
              <div><span>${PAR}</span><strong>${S.fmtMXN(est.medPar, 2)}</strong> <small>(n=${S.fmtInt(est.nPar)})</small></div>
              <div><span>Diferencia</span><strong style="color:${est.diffPct >= 0 ? COLOR_COM : COLOR_PAR}">${S.fmtSigned(est.diffPct, 1)}%</strong> <small>${est.diffPct >= 0 ? "comerciales más caros" : "comerciales más baratos"}</small></div>
            </div>
          </div>
        `;
      } else {
        box.innerHTML = "";
      }
    } else if (state.act === 3 && state.act3MapFocus === "top6" && state.selectedAlcKey) {
      const r = metrics.top6Alcs.find((t) => t.key === state.selectedAlcKey);
      if (r) {
        box.innerHTML = `
          <div class="selected-alc-card">
            <div class="selected-alc-head">
              <div>
                <strong>${r.alcaldia} · ${metrics.modalidadPrincipal}</strong>
                <div class="selected-alc-sub">Mostrando ${S.fmtInt(r.com.n + r.par.n)} puntos en el mapa</div>
              </div>
              <button id="p5-clear-sel" class="mini-btn">Limpiar</button>
            </div>
            <div class="selected-alc-grid mono">
              <div><span>Comercial</span><strong>${S.fmtMXN(r.com.median)}</strong> <small>Q1–Q3: ${S.fmtMXN(r.com.q1)}–${S.fmtMXN(r.com.q3)} (n=${S.fmtInt(r.com.n)})</small></div>
              <div><span>Particular</span><strong>${S.fmtMXN(r.par.median)}</strong> <small>Q1–Q3: ${S.fmtMXN(r.par.q1)}–${S.fmtMXN(r.par.q3)} (n=${S.fmtInt(r.par.n)})</small></div>
            </div>
          </div>
        `;
      } else {
        box.innerHTML = "";
      }
    } else {
      box.innerHTML = "";
    }

    const clearBtn = document.getElementById("p5-clear-sel");
    if (clearBtn) {
      clearBtn.addEventListener("click", () => {
        state.selectedAlcKey = null;
        state.selectedStratumId = null;
        refs.mapApi.setSelectedAlcaldia(null);
        syncPointsForCurrentAct();
        updateSelectedBanner();
        highlightLinkedElements();
      });
    }
  }

  function bindLinkedAlc(container) {
    if (!container) return;
    container.querySelectorAll("[data-alc-key]").forEach((el) => {
      const k = el.getAttribute("data-alc-key");
      const sid = el.getAttribute("data-stratum-id");

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
        if (state.act === 2 && sid) {
          const est = metrics.estratos.find((e) => e.id === sid);
          if (est && (est.modalidad === "Alojamiento completo" || est.modalidad === "Habitación privada")) {
            if (state.choroModAct2 !== est.modalidad) {
              state.choroModAct2 = est.modalidad;
              document.querySelectorAll(".p5-mod-btn").forEach((b) => {
                b.classList.toggle("active", b.dataset.mod === state.choroModAct2);
              });
              refs.mapApi.refreshChoroplethStyles();
              renderLegend();
            }
          }
          const same = state.selectedStratumId === sid;
          state.selectedStratumId = same ? null : sid;
          state.selectedAlcKey = same ? null : k;
        } else {
          if (state.act === 3 && state.act3MapFocus === "azcapotzalco") {
            state.act3MapFocus = "top6";
            renderActBody();
            syncMap();
            refs.mapApi.resetView();
          }
          state.selectedAlcKey = state.selectedAlcKey === k ? null : k;
        }
        refs.mapApi.setSelectedAlcaldia(state.selectedAlcKey);
        syncPointsForCurrentAct();
        updateSelectedBanner();
        highlightLinkedElements();
      });
    });
  }

  function renderActBody() {
    const S = window.Stats;
    const body = document.getElementById("p5-act-body");

    // ---------------- ACTO 1: Composición y sesgo territorial (4.5.1) ----------------
    if (state.act === 1) {
      const c = metrics.compCom;
      const p = metrics.compPar;
      const cuau = metrics.alcByKey[window.DataStore.normalizeKey("Cuauhtémoc")];
      const mh = metrics.alcByKey[window.DataStore.normalizeKey("Miguel Hidalgo")];
      const bj = metrics.alcByKey[window.DataStore.normalizeKey("Benito Juárez")];
      const coy = metrics.alcByKey[window.DataStore.normalizeKey("Coyoacán")];
      const modCompObj = metrics.modComp.find((m) => m.modalidad === "Alojamiento completo");

      body.innerHTML = `
        <div class="kpi-grid kpi-4">
          <div class="kpi-card">
            <div class="kpi-label">Comercial (10+)</div>
            <div class="kpi-value" style="color:${COLOR_COM}">${S.fmtMXN(c.precioMediano, 0)}</div>
            <div class="kpi-sub">${S.fmtInt(c.anuncios)} an. · ${S.fmtInt(c.anfitriones)} hosts</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">Particular (&lt;10)</div>
            <div class="kpi-value" style="color:${COLOR_PAR}">${S.fmtMXN(p.precioMediano, 0)}</div>
            <div class="kpi-sub">${S.fmtInt(p.anuncios)} an. · ${S.fmtInt(p.anfitriones)} hosts</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">Brecha bruta</div>
            <div class="kpi-value">+${metrics.diffBruta.toFixed(1)}%</div>
            <div class="kpi-sub">Sin controlar zona ni tipo</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">Escala operativa</div>
            <div class="kpi-value">${c.anunciosPorHost.toFixed(1)} vs ${p.anunciosPorHost.toFixed(1)}</div>
            <div class="kpi-sub">Anuncios por anfitrión</div>
          </div>
        </div>

        <div class="card">
          <div class="card-title">Tabla de composición global <span class="card-tag">Sección 4.5.1</span></div>
          <table class="data-table">
            <thead>
              <tr><th>Grupo</th><th class="num">Anuncios</th><th class="num">Hosts</th><th class="num">Mediana</th><th class="num">An./host</th><th class="num">%</th></tr>
            </thead>
            <tbody>
              <tr>
                <td><span class="swatch-inline" style="background:${COLOR_COM}"></span><strong>${COM}</strong></td>
                <td class="num">${S.fmtInt(c.anuncios)}</td>
                <td class="num">${S.fmtInt(c.anfitriones)}</td>
                <td class="num"><strong>${S.fmtMXN(c.precioMediano, 2)}</strong></td>
                <td class="num">${c.anunciosPorHost.toFixed(1)}</td>
                <td class="num">${c.pctAnuncios.toFixed(1)}%</td>
              </tr>
              <tr>
                <td><span class="swatch-inline" style="background:${COLOR_PAR}"></span><strong>${PAR}</strong></td>
                <td class="num">${S.fmtInt(p.anuncios)}</td>
                <td class="num">${S.fmtInt(p.anfitriones)}</td>
                <td class="num"><strong>${S.fmtMXN(p.precioMediano, 2)}</strong></td>
                <td class="num">${p.anunciosPorHost.toFixed(1)}</td>
                <td class="num">${p.pctAnuncios.toFixed(1)}%</td>
              </tr>
            </tbody>
          </table>
          <div class="toggles-row" style="margin-top:8px;padding-top:7px;">
            <label><input type="checkbox" id="p5-chk-pts1" ${state.showPointsAct1 ? "checked" : ""} /> Mostrar todos los puntos (Comercial vs. Particular)</label>
          </div>
        </div>

        <div id="p5-selected-box"></div>

        <div class="card">
          <div class="card-title">Composición de la oferta según tipo de anfitrión <span class="card-tag">Modalidad y Top 8</span></div>
          <div id="p5-comp-wrap">${buildCompositionSVG()}</div>
        </div>

        <div class="card">
          <div class="card-title">Sesgo de ubicación: anuncios concentrados en alcaldías caras <span class="card-tag">n &ge; ${MIN_N_BURBUJA}</span></div>
          <div id="p5-bubble-wrap">${buildBubbleSVG()}</div>
        </div>

        <div class="card">
          <div class="card-title">Por qué la diferencia bruta (+${metrics.diffBruta.toFixed(1)}%) puede engañar</div>
          <ul class="finding-list">
            <li><strong>Modalidad similar:</strong> ambos grupos ofrecen cerca de dos tercios de alojamientos completos (${modCompObj ? `${modCompObj.pctCom.toFixed(1)}% comerciales vs. ${modCompObj.pctPar.toFixed(1)}% particulares` : "proporción muy similar"}).</li>
            <li><strong>Fuerte sesgo territorial:</strong> ${cuau && mh ? `<strong>${cuau.alcaldia} (${cuau.pctCom.toFixed(1)}%, +${cuau.diffPP.toFixed(1)} pp)</strong> y <strong>${mh.alcaldia} (${mh.pctCom.toFixed(1)}%, +${mh.diffPP.toFixed(1)} pp)</strong> reúnen casi <strong>${(cuau.pctCom + mh.pctCom).toFixed(0)}%</strong> de la oferta comercial (frente a ${(cuau.pctPar + mh.pctPar).toFixed(0)}% de la particular)` : "los comerciales se concentran en alcaldías centrales caras"}.</li>
            <li><strong>Contraparte particular:</strong> ${bj && coy ? `<strong>${bj.alcaldia} (${bj.diffPP.toFixed(1)} pp)</strong> y <strong>${coy.alcaldia} (${coy.diffPP.toFixed(1)} pp)</strong>` : "alcaldías de precio intermedio"} tienen mayor peso entre particulares. Por ello, es indispensable comparar dentro de la misma alcaldía y modalidad.</li>
          </ul>
          <div class="note-cite">Umbral comercial (&ge; 10 anuncios) siguiendo a Ke (2017) para identificar operadores de gran escala.</div>
        </div>
      `;

      document.getElementById("p5-chk-pts1").addEventListener("change", (e) => {
        state.showPointsAct1 = e.target.checked;
        syncPointsForCurrentAct();
      });
      bindLinkedAlc(document.getElementById("p5-comp-wrap"));
      bindLinkedAlc(document.getElementById("p5-bubble-wrap"));
      updateSelectedBanner();
      highlightLinkedElements();
      return;
    }

    // ---------------- ACTO 2: 20 estratos controlados (4.5.2) ----------------
    if (state.act === 2) {
      const tableRows = metrics.estratos
        .map(
          (e) => `
          <tr class="clickable-row" data-alc-key="${e.alcKey}" data-stratum-id="${e.id}">
            <td>${shortAlcName(e.alcaldia)} <span style="color:#64748b">· ${shortModName(e.modalidad)}</span></td>
            <td class="num">${S.fmtInt(e.nCom)} / ${S.fmtInt(e.nPar)}</td>
            <td class="num">${S.fmtMXN(e.medCom)}</td>
            <td class="num">${S.fmtMXN(e.medPar)}</td>
            <td class="num"><strong style="color:${e.diffPct >= 0 ? COLOR_COM : COLOR_PAR}">${S.fmtSigned(e.diffPct, 1)}%</strong></td>
          </tr>`
        )
        .join("");

      body.innerHTML = `
        <div class="card">
          <div class="card-title">Modalidad activa en el mapa coroplético <span class="card-tag">Estratos con n &ge; ${MIN_N_ESTRATO}</span></div>
          <div class="segmented cols-2" role="group" aria-label="Modalidad en mapa coroplético">
            <button class="seg-btn p5-mod-btn ${state.choroModAct2 === "Alojamiento completo" ? "active" : ""}" data-mod="Alojamiento completo">Alojamiento completo</button>
            <button class="seg-btn p5-mod-btn ${state.choroModAct2 === "Habitación privada" ? "active" : ""}" data-mod="Habitación privada">Habitación privada</button>
          </div>
          <div class="toggles-row" style="margin-top:8px;padding-top:7px;">
            <label><input type="checkbox" id="p5-chk-pts2" ${state.showAllPointsAct2 ? "checked" : ""} /> Mostrar todos los puntos de esta modalidad</label>
          </div>
        </div>

        <div id="p5-selected-box"></div>

        <div class="kpi-grid kpi-4">
          <div class="kpi-card">
            <div class="kpi-label">Estratos comparables</div>
            <div class="kpi-value">${metrics.estratos.length}</div>
            <div class="kpi-sub">n &ge; ${MIN_N_ESTRATO} en ambos grupos</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">Com. más caros</div>
            <div class="kpi-value">${metrics.nCaros} de ${metrics.estratos.length}</div>
            <div class="kpi-sub">Más baratos en ${metrics.nBaratos}</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">Diferencia mediana</div>
            <div class="kpi-value" style="color:${COLOR_COM}">+${metrics.diffMediana.toFixed(1)}%</div>
            <div class="kpi-sub">Sin ponderar (estratos)</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">Media ponderada</div>
            <div class="kpi-value" style="color:${COLOR_COM}">+${metrics.diffPonderada.toFixed(1)}%</div>
            <div class="kpi-sub">Ponderada por anuncios</div>
          </div>
        </div>

        <div class="card">
          <div class="card-title">Diferencia en el precio mediano por alcaldía y modalidad <span class="card-tag">vs. bruta +${metrics.diffBruta.toFixed(1)}%</span></div>
          <div id="p5-bars-wrap">${buildStrataBarsSVG()}</div>
        </div>

        <div class="card">
          <div class="card-title">Tabla de los ${metrics.estratos.length} estratos comparables <span class="card-tag">Clic = ver puntos</span></div>
          <div class="table-scroll">
            <table class="data-table" id="p5-strata-table">
              <thead>
                <tr><th>Alcaldía · Modalidad</th><th class="num">Com / Par</th><th class="num">Med. C.</th><th class="num">Med. P.</th><th class="num">Dif. %</th></tr>
              </thead>
              <tbody>${tableRows}</tbody>
            </table>
          </div>
        </div>

        <div class="card">
          <div class="card-title">Hallazgos al controlar ubicación y modalidad (4.5.2)</div>
          <ul class="finding-list">
            <li><strong>La brecha se reduce a menos de la mitad:</strong> del <strong>+${metrics.diffBruta.toFixed(1)}%</strong> bruto baja a <strong>+${metrics.diffMediana.toFixed(1)}%</strong> (mediana de estratos) y <strong>+${metrics.diffPonderada.toFixed(1)}%</strong> (promedio ponderado por oferta).</li>
            <li><strong>Consistencia entre medidas:</strong> la cercanía entre la mediana (trata todos los estratos igual) y la ponderada (dominada por Cuauhtémoc y Miguel Hidalgo) confirma un patrón real de ~9% a 10% más caro, sin ser arrastrado por los extremos de Azcapotzalco.</li>
            <li><strong>Variación entre segmentos:</strong> en los segmentos centrales de mayor volumen la prima es moderada (+11% a +15% en completos de Cuauhtémoc, Miguel Hidalgo y Benito Juárez), mientras en Venustiano Carranza y Cuajimalpa los comerciales cobran menos.</li>
          </ul>
        </div>
      `;

      body.querySelectorAll(".p5-mod-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          state.choroModAct2 = btn.dataset.mod;
          state.selectedStratumId = null;
          state.selectedAlcKey = null;
          refs.mapApi.setSelectedAlcaldia(null);
          body.querySelectorAll(".p5-mod-btn").forEach((b) => b.classList.toggle("active", b === btn));
          refs.mapApi.refreshChoroplethStyles();
          syncPointsForCurrentAct();
          renderLegend();
          updateSelectedBanner();
          highlightLinkedElements();
        });
      });

      document.getElementById("p5-chk-pts2").addEventListener("change", (e) => {
        state.showAllPointsAct2 = e.target.checked;
        syncPointsForCurrentAct();
      });

      bindLinkedAlc(document.getElementById("p5-bars-wrap"));
      bindLinkedAlc(document.getElementById("p5-strata-table"));
      updateSelectedBanner();
      highlightLinkedElements();
      return;
    }

    // ---------------- ACTO 3: Dispersión Top 6 + Caso Azcapotzalco (4.5.2–4.5.4) ----------------
    const dom = metrics.dominantHost;
    const hostRowsHtml = metrics.azcTopHosts
      .map(
        (h, idx) => `
        <tr class="${idx === 0 ? "row-dom-host" : ""}">
          <td><strong>#${h.hostId}</strong>${idx === 0 ? ' <span class="dom-badge">Dominante</span>' : ""}</td>
          <td class="num"><strong>${S.fmtInt(h.anuncios)}</strong></td>
          <td class="num">${S.fmtMXN(h.precioMediano, 2)}</td>
          <td class="num"><strong>${h.pctComercial.toFixed(1)}%</strong></td>
        </tr>`
      )
      .join("");

    body.innerHTML = `
      <div class="card">
        <div class="card-title">Enfoque del mapa real <span class="card-tag">Secciones 4.5.2 y 4.5.3</span></div>
        <div class="segmented cols-2" role="group" aria-label="Enfoque del mapa en Acto 3">
          <button class="seg-btn p5-focus-btn ${state.act3MapFocus === "top6" ? "active" : ""}" data-focus="top6">6 alcaldías (Boxplot)</button>
          <button class="seg-btn p5-focus-btn ${state.act3MapFocus === "azcapotzalco" ? "active" : ""}" data-focus="azcapotzalco">Zoom ${metrics.focusCaseAlcName} (Host #${dom ? dom.hostId : ""})</button>
        </div>
      </div>

      <div id="p5-selected-box"></div>

      <div class="card">
        <div class="card-title">Dispersión en ${metrics.modalidadPrincipal} · 6 alcaldías con más anuncios <span class="card-tag">Escala log</span></div>
        <div id="p5-box-wrap">${buildTop6BoxplotsSVG()}</div>
      </div>

      <div class="card">
        <div class="card-title">
          <span>Caso atípico: ${metrics.focusCaseAlcName} (${metrics.modalidadPrincipal})</span>
          <span class="card-tag">Top 5 anfitriones comerciales</span>
        </div>
        <p class="subtitle" style="margin-bottom:8px;">
          En ${metrics.focusCaseAlcName}, los comerciales cobran <strong>${metrics.azcEstPriv ? S.fmtSigned(metrics.azcEstPriv.diffPct, 1) + "%" : "+50%"}</strong> en habitaciones privadas pero <strong>${metrics.azcEstComp ? S.fmtSigned(metrics.azcEstComp.diffPct, 1) + "%" : "-53.9%"}</strong> en alojamientos completos. Detrás está la concentración en un solo operador:
        </p>
        <table class="data-table">
          <thead>
            <tr><th>host_id</th><th class="num">Anuncios</th><th class="num">Mediana</th><th class="num">% oferta com.</th></tr>
          </thead>
          <tbody>${hostRowsHtml}</tbody>
        </table>
      </div>

      <div class="card">
        <div class="card-title">Respuesta integrada y limitaciones (4.5.4)</div>
        <ul class="finding-list">
          <li><strong>Prima real moderada (~9% a 10%):</strong> los anfitriones comerciales cobran más que los particulares, pero menos de la mitad del <strong>+${metrics.diffBruta.toFixed(1)}%</strong> bruto porque buena parte respondía a su concentración en Cuauhtémoc y Miguel Hidalgo.</li>
          <li><strong>Amplia superposición de precios:</strong> en las 6 alcaldías principales las cajas son muy parecidas; la diferencia está en la mediana, no en una separación tajante, y muchos particulares cobran más que muchos comerciales.</li>
          <li><strong>Sensibilidad a pocos operadores:</strong> en ${metrics.focusCaseAlcName}, ${dom ? `un solo anfitrión (<code>#${dom.hostId}</code>) concentra <strong>${S.fmtInt(dom.anuncios)} de los ${S.fmtInt(metrics.azcComCount)}</strong> anuncios comerciales (<strong>${dom.pctComercial.toFixed(1)}%</strong>) a <strong>${S.fmtMXN(dom.precioMediano)}</strong>` : "un solo operador domina el estrato"}, invirtiendo la mediana del segmento.</li>
          <li><strong>Limitación metodológica:</strong> documenta <strong>asociación y no causalidad</strong> sobre precios publicados (no necesariamente reservados), sin controlar diferencias no observadas en amenidades, calidad o servicios.</li>
        </ul>
      </div>
    `;

    body.querySelectorAll(".p5-focus-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.act3MapFocus = btn.dataset.focus;
        state.selectedAlcKey = null;
        refs.mapApi.setSelectedAlcaldia(null);
        body.querySelectorAll(".p5-focus-btn").forEach((b) => b.classList.toggle("active", b === btn));
        syncMap();
        updateSelectedBanner();
        if (state.act3MapFocus === "azcapotzalco") fitAzcapotzalco();
        else refs.mapApi.resetView();
      });
    });

    bindLinkedAlc(document.getElementById("p5-box-wrap"));
    updateSelectedBanner();
    highlightLinkedElements();
  }

  function applyAct(actNum) {
    state.act = actNum;
    state.selectedAlcKey = null;
    state.selectedStratumId = null;
    state.hoveredAlcKey = null;
    state.act3MapFocus = "top6";

    refs.mapApi.closePopups();
    refs.mapApi.setSelectedAlcaldia(null);
    refs.mapApi.setHoveredAlcaldia(null);
    refs.mapApi.resetView();

    document.querySelectorAll(".p5-act-btn").forEach((b) => {
      b.classList.toggle("active", Number(b.dataset.act) === actNum);
    });
    renderActBody();
    syncMap();
  }

  function renderShell() {
    refs.panelEl.innerHTML = `
      <div class="section-header">
        <span class="eyebrow">Pregunta 5 · Perfil del anfitrión</span>
        <h1>Anfitriones comerciales (10+) vs. particulares (&lt;10)</h1>
        <p class="subtitle">
          Contraste de precios medianos entre operadores comerciales y particulares controlando sesgo territorial, modalidad y concentración por anfitrión.
        </p>
      </div>

      <div class="acts-grid cols-3" role="tablist" aria-label="Secuencia narrativa Pregunta 5">
        <button class="act-btn p5-act-btn active" data-act="1"><span class="act-step">Acto 1</span><span class="act-label">Composición</span></button>
        <button class="act-btn p5-act-btn" data-act="2"><span class="act-step">Acto 2</span><span class="act-label">20 estratos</span></button>
        <button class="act-btn p5-act-btn" data-act="3"><span class="act-step">Acto 3</span><span class="act-label">Cajas y caso</span></button>
      </div>

      <div id="p5-act-body" class="p1-act-body"></div>
    `;

    document.querySelectorAll(".p5-act-btn").forEach((btn) => {
      btn.addEventListener("click", () => applyAct(Number(btn.dataset.act)));
    });
  }

  function showLoadFallback(errMsg) {
    refs.panelEl.innerHTML = `
      <div class="section-header">
        <span class="eyebrow">Pregunta 5 · Carga de datos</span>
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
        <input type="file" id="p5-file-input" accept=".csv" class="file-fallback" />
      </div>
    `;

    document.getElementById("p5-file-input").addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const rows = await window.DataStore.loadFromFile(file);
      computeMetrics(rows);
      renderShell();
      applyAct(1);
    });
  }

  async function mount(ctx) {
    refs = ctx;
    const sidePanel = document.getElementById("side-panel");
    if (sidePanel) sidePanel.classList.add("medium");

    refs.panelEl.innerHTML = `<div class="loading-box">Calculando métricas de Pregunta 5...</div>`;

    try {
      if (!allRows.length) {
        const rows = await window.DataStore.load();
        computeMetrics(rows);
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
    state.selectedStratumId = null;
    state.hoveredAlcKey = null;
    state.act3MapFocus = "top6";
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

if (window.AppShell) window.AppShell.register("p5", window.Pregunta5);