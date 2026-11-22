window.MapaBase = (() => {
  const CDMX_FALLBACK_BOUNDS = [
    [19.048, -99.365],
    [19.593, -98.940],
  ];

  let map = null;
  let tileGroup = null;
  let maskGroup = null;
  let bordersGroup = null;
  let choroplethGroup = null;
  let highlightGroup = null;
  let overlayGroup = null;
  let canvasLayer = null;

  let maskRenderer = null;
  let choroplethRenderer = null;
  let highlightRenderer = null;
  let geometryRenderer = null;

  let styleIndex = 0;
  let currentOpacity = 0.68;
  let cdmxGeoData = null;
  let geoPromise = null;
  let cdmxBounds = L.latLngBounds(CDMX_FALLBACK_BOUNDS);
  let showMask = true;
  let showBorders = true;

  // Estado de capa coroplética activa + un único tooltip compartido
  let choroConfig = null;
  let choroLayersByKey = {};
  let hoveredKey = null;
  let selectedKey = null;
  let choroTooltip = null;

  const BASE_STYLES = [
    {
      name: "Claro sobrio",
      themeClass: "theme-light",
      maskColor: "#EEF2F6",
      maskOpacity: 0.78,
      borderColor: "#334155",
      layers: [
        {
          url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
          attribution: "&copy; OpenStreetMap contributors",
        },
      ],
    },
    {
      name: "Oscuro sobrio",
      themeClass: "theme-dark",
      maskColor: "#0B1220",
      maskOpacity: 0.78,
      borderColor: "#CBD5E1",
      layers: [
        {
          url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
          attribution: "&copy; OpenStreetMap contributors",
        },
      ],
    },
    {
      name: "Minimal gris",
      themeClass: "theme-plain",
      maskColor: "#E8EDF2",
      maskOpacity: 0.75,
      borderColor: "#334155",
      layers: [
        {
          url: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}",
          attribution: "Tiles &copy; Esri",
        },
        {
          url: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}",
          attribution: "",
        },
      ],
    },
  ];

  // Capa Canvas con animación de zoom continua (sin parpadeo)
  const FastPointsLayer = L.Layer.extend({
    initialize: function () {
      this._points = [];
      this._colorFn = () => "#1E3A5F";
      this._radiusFn = () => 2.2;
      this._alphaFn = () => 0.45;
      this._popupFn = null;
      this._padRatio = 0.35;
      this._padX = 0;
      this._padY = 0;
      this._topLeftLatLng = null;
      this._lastZoom = null;
    },

    onAdd: function (mapInstance) {
      this._map = mapInstance;
      const animated = mapInstance.options.zoomAnimation && L.Browser.any3d;
      const cls = animated ? "leaflet-layer leaflet-zoom-animated" : "leaflet-layer";

      this._canvas = L.DomUtil.create("canvas", cls);
      this._canvas.style.pointerEvents = "none";
      this._canvas.style.transformOrigin = "0 0";
      this._ctx = this._canvas.getContext("2d");
      mapInstance.getPanes().overlayPane.appendChild(this._canvas);

      mapInstance.on("moveend zoomend viewreset resize", this._reset, this);
      if (animated) mapInstance.on("zoomanim", this._animateZoom, this);
      mapInstance.on("click", this._onMapClick, this);
      this._reset();
    },

    onRemove: function (mapInstance) {
      mapInstance.off("moveend zoomend viewreset resize", this._reset, this);
      mapInstance.off("zoomanim", this._animateZoom, this);
      mapInstance.off("click", this._onMapClick, this);
      L.DomUtil.remove(this._canvas);
    },

    setData: function (points, options = {}) {
      this._points = points || [];
      this._colorFn = options.colorFn || (() => "#1E3A5F");
      this._radiusFn = options.radiusFn || (() => 2.2);
      this._alphaFn = options.alphaFn || (() => 0.45);
      this._popupFn = options.popupFn || null;
      this._reset();
    },

    findNearestPoint: function (containerPoint, maxRadiusPx = 9) {
      if (!this._popupFn || !this._points.length || !this._map) return null;
      let best = null;
      let bestDist2 = maxRadiusPx * maxRadiusPx;
      for (let i = 0; i < this._points.length; i++) {
        const p = this._points[i];
        const pt = this._map.latLngToContainerPoint([p.lat, p.lon]);
        const dx = pt.x - containerPoint.x;
        const dy = pt.y - containerPoint.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestDist2) {
          bestDist2 = d2;
          best = p;
        }
      }
      return best;
    },

    _animateZoom: function (e) {
      if (!this._topLeftLatLng || this._lastZoom === null) return;
      const scale = this._map.getZoomScale(e.zoom, this._lastZoom);
      const offset = this._map._latLngToNewLayerPoint(this._topLeftLatLng, e.zoom, e.center);
      L.DomUtil.setTransform(this._canvas, offset, scale);
    },

    _reset: function () {
      if (!this._map || !this._canvas) return;
      const size = this._map.getSize();
      this._padX = Math.round(size.x * this._padRatio);
      this._padY = Math.round(size.y * this._padRatio);

      const w = size.x + this._padX * 2;
      const h = size.y + this._padY * 2;

      const topLeft = this._map.containerPointToLayerPoint([-this._padX, -this._padY]);
      this._topLeftLatLng = this._map.containerPointToLatLng([-this._padX, -this._padY]);
      this._lastZoom = this._map.getZoom();

      L.DomUtil.setPosition(this._canvas, topLeft);

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this._canvas.width = w * dpr;
      this._canvas.height = h * dpr;
      this._canvas.style.width = `${w}px`;
      this._canvas.style.height = `${h}px`;
      this._ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this._redraw();
    },

    _redraw: function () {
      if (!this._map || !this._ctx) return;
      const size = this._map.getSize();
      const w = size.x + this._padX * 2;
      const h = size.y + this._padY * 2;
      const ctx = this._ctx;
      ctx.clearRect(0, 0, w, h);

      const zoom = this._map.getZoom();
      const zoomScale = zoom >= 14 ? 1.55 : zoom >= 12 ? 1.2 : 1.0;

      for (let i = 0; i < this._points.length; i++) {
        const p = this._points[i];
        const pt = this._map.latLngToContainerPoint([p.lat, p.lon]);
        const cx = pt.x + this._padX;
        const cy = pt.y + this._padY;
        if (cx < -8 || cy < -8 || cx > w + 8 || cy > h + 8) continue;

        ctx.globalAlpha = this._alphaFn(p);
        ctx.fillStyle = this._colorFn(p);
        const r = this._radiusFn(p) * zoomScale;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    },

    _onMapClick: function (ev) {
      const best = this.findNearestPoint(ev.containerPoint, 9);
      if (best) {
        hideChoroTooltip();
        L.popup({ maxWidth: 260 })
          .setLatLng([best.lat, best.lon])
          .setContent(this._popupFn(best))
          .openOn(this._map);
      }
    },
  });

  function showChoroTooltip(latlng, html) {
    if (!map || !html) return;
    if (!choroTooltip) {
      choroTooltip = L.tooltip({
        direction: "top",
        offset: [0, -14],
        opacity: 1,
        className: "choro-tooltip",
        interactive: false,
      });
    }
    choroTooltip.setLatLng(latlng).setContent(html);
    if (!map.hasLayer(choroTooltip)) {
      choroTooltip.addTo(map);
    }
  }

  function hideChoroTooltip() {
    if (map && choroTooltip && map.hasLayer(choroTooltip)) {
      map.removeLayer(choroTooltip);
    }
  }

  function closePopups() {
    hideChoroTooltip();
    if (map) map.closePopup();
  }

  function extractFeatureName(feature) {
    const props = (feature && feature.properties) || {};
    return String(
      props.neighbourhood ||
      props.alcaldia ||
      props.NOMGEO ||
      props.NOM_MUN ||
      props.name ||
      props.NAME ||
      ""
    ).trim();
  }

  function extractOuterRings(geojson) {
    const rings = [];
    const features = geojson.type === "FeatureCollection" ? geojson.features : [geojson];
    features.forEach((f) => {
      const geom = f.geometry || f;
      if (!geom) return;
      if (geom.type === "Polygon" && geom.coordinates[0]) {
        rings.push(geom.coordinates[0].map(([lon, lat]) => [lat, lon]));
      } else if (geom.type === "MultiPolygon") {
        geom.coordinates.forEach((poly) => {
          if (poly[0]) rings.push(poly[0].map(([lon, lat]) => [lat, lon]));
        });
      }
    });
    return rings;
  }

  function renderCDMXHighlight() {
    maskGroup.clearLayers();
    bordersGroup.clearLayers();
    if (!cdmxGeoData) return;

    const cfg = BASE_STYLES[styleIndex];

    if (showMask) {
      const worldRing = [
        [85, -180],
        [85, 180],
        [-85, 180],
        [-85, -180],
      ];
      const holes = extractOuterRings(cdmxGeoData);
      if (holes.length) {
        L.polygon([worldRing, ...holes], {
          stroke: false,
          fillColor: cfg.maskColor,
          fillOpacity: cfg.maskOpacity,
          fillRule: "evenodd",
          interactive: false,
          pane: "maskPane",
          renderer: maskRenderer,
        }).addTo(maskGroup);
      }
    }

    if (showBorders && !choroConfig) {
      L.geoJSON(cdmxGeoData, {
        pane: "maskPane",
        renderer: maskRenderer,
        interactive: false,
        style: {
          color: cfg.borderColor,
          weight: 1.15,
          opacity: 0.65,
          fill: false,
        },
      }).addTo(bordersGroup);
    }
  }

  // Contornos de hover y selección en capa separada sin interacción (evita mover nodos SVG)
  function renderChoroHighlights() {
    if (!highlightGroup) return;
    highlightGroup.clearLayers();
    if (!choroConfig) return;

    if (hoveredKey && hoveredKey !== selectedKey && choroLayersByKey[hoveredKey]) {
      L.geoJSON(choroLayersByKey[hoveredKey].feature, {
        pane: "highlightPane",
        renderer: highlightRenderer,
        interactive: false,
        style: {
          fill: false,
          color: "#1E293B",
          weight: 2.2,
          opacity: 0.95,
        },
      }).addTo(highlightGroup);
    }

    if (selectedKey && choroLayersByKey[selectedKey]) {
      L.geoJSON(choroLayersByKey[selectedKey].feature, {
        pane: "highlightPane",
        renderer: highlightRenderer,
        interactive: false,
        style: {
          fill: false,
          color: "#0F172A",
          weight: 3.0,
          opacity: 1,
        },
      }).addTo(highlightGroup);
    }
  }

  function refreshChoroplethStyles() {
    if (!choroConfig) return;
    Object.entries(choroLayersByKey).forEach(([key, entry]) => {
      const isSelected = selectedKey === key;
      const isHovered = hoveredKey === key;
      entry.layer.setStyle(choroConfig.styleFn(key, entry.rawName, { isSelected, isHovered }));
    });
    renderChoroHighlights();
  }

  function clearChoropleth() {
    closePopups();
    choroConfig = null;
    choroLayersByKey = {};
    hoveredKey = null;
    selectedKey = null;
    if (choroplethGroup) choroplethGroup.clearLayers();
    if (highlightGroup) highlightGroup.clearLayers();
    renderCDMXHighlight();
  }

  async function setChoropleth(options) {
    await ensureGeoLoaded();
    closePopups();
    choroplethGroup.clearLayers();
    highlightGroup.clearLayers();
    choroLayersByKey = {};
    choroConfig = options || null;
    hoveredKey = null;
    selectedKey = options && options.selectedKey ? options.selectedKey : null;
    renderCDMXHighlight();
    if (!choroConfig || !cdmxGeoData) return;

    L.geoJSON(cdmxGeoData, {
      pane: "choroplethPane",
      renderer: choroplethRenderer,
      style: (feature) => {
        const rawName = extractFeatureName(feature);
        const key = window.DataStore.normalizeKey(rawName);
        return choroConfig.styleFn(key, rawName, {
          isSelected: selectedKey === key,
          isHovered: hoveredKey === key,
        });
      },
      onEachFeature: (feature, layer) => {
        const rawName = extractFeatureName(feature);
        const key = window.DataStore.normalizeKey(rawName);
        choroLayersByKey[key] = { layer, feature, rawName };

        layer.on("mouseover", (ev) => {
          hoveredKey = key;
          refreshChoroplethStyles();
          if (typeof choroConfig.tooltipFn === "function") {
            showChoroTooltip(ev.latlng, choroConfig.tooltipFn(key, rawName));
          }
          if (typeof choroConfig.onHover === "function") choroConfig.onHover(key, rawName);
        });

        layer.on("mousemove", (ev) => {
          if (hoveredKey === key && typeof choroConfig.tooltipFn === "function") {
            showChoroTooltip(ev.latlng, choroConfig.tooltipFn(key, rawName));
          }
        });

        layer.on("mouseout", () => {
          if (hoveredKey === key) {
            hoveredKey = null;
            hideChoroTooltip();
            refreshChoroplethStyles();
            if (typeof choroConfig.onHover === "function") choroConfig.onHover(null, null);
          }
        });

        layer.on("click", (ev) => {
          if (canvasLayer && canvasLayer.findNearestPoint(ev.containerPoint, 9)) {
            hideChoroTooltip();
            return;
          }
          if (typeof choroConfig.onSelect === "function") choroConfig.onSelect(key, rawName);
        });
      },
    }).addTo(choroplethGroup);

    refreshChoroplethStyles();
  }

  function ensureGeoLoaded() {
    if (cdmxGeoData) return Promise.resolve(cdmxGeoData);
    if (geoPromise) return geoPromise;

    const statusEl = document.getElementById("cdmx-geo-status");
    geoPromise = fetch("shared/cdmx_alcaldias.geojson")
      .then((resp) => {
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        return resp.json();
      })
      .then((data) => {
        cdmxGeoData = data;
        const b = L.geoJSON(cdmxGeoData).getBounds();
        if (b.isValid()) cdmxBounds = b;
        if (statusEl) statusEl.hidden = true;
        renderCDMXHighlight();
        fitToCDMX(false);
        return cdmxGeoData;
      })
      .catch(() => {
        if (statusEl) statusEl.hidden = false;
        return null;
      });
    return geoPromise;
  }

  function fitToCDMX(animate = true) {
    if (!map) return;
    const panel = document.getElementById("side-panel");
    const panelOpen = panel && !panel.classList.contains("collapsed");
    const rightPad = panelOpen ? Math.min(panel.offsetWidth + 28, window.innerWidth * 0.55) : 28;

    map.fitBounds(cdmxBounds, {
      paddingTopLeft: [28, 22],
      paddingBottomRight: [rightPad, 22],
      maxZoom: 12,
      animate,
    });
  }

  function applyBaseStyle() {
    const cfg = BASE_STYLES[styleIndex];
    const mapEl = map.getContainer();
    mapEl.classList.remove("theme-light", "theme-dark", "theme-plain");
    mapEl.classList.add(cfg.themeClass);

    if (tileGroup) tileGroup.clearLayers();
    cfg.layers.forEach((l) => {
      L.tileLayer(l.url, {
        attribution: l.attribution,
        maxZoom: 18,
        opacity: currentOpacity,
      }).addTo(tileGroup);
    });

    const styleBtn = document.getElementById("btn-toggle-style");
    if (styleBtn) styleBtn.textContent = `Base: ${cfg.name}`;
    renderCDMXHighlight();
  }

  function init(containerId) {
    map = L.map(containerId, {
      center: [19.37, -99.13],
      zoom: 11,
      zoomControl: true,
    });

    // Jerarquía: tiles (200) < máscara (380) < coroplético (390) < contornos hover/sel (395) < puntos (400) < anillos/ejes (460)
    const maskPane = map.createPane("maskPane");
    maskPane.style.zIndex = 380;
    maskPane.style.pointerEvents = "none";

    const choroPane = map.createPane("choroplethPane");
    choroPane.style.zIndex = 390;

    const hlPane = map.createPane("highlightPane");
    hlPane.style.zIndex = 395;
    hlPane.style.pointerEvents = "none";

    const geomPane = map.createPane("geometryPane");
    geomPane.style.zIndex = 460;

    maskRenderer = L.svg({ pane: "maskPane" });
    choroplethRenderer = L.svg({ pane: "choroplethPane" });
    highlightRenderer = L.svg({ pane: "highlightPane" });
    geometryRenderer = L.svg({ pane: "geometryPane" });

    tileGroup = L.layerGroup().addTo(map);
    maskGroup = L.layerGroup().addTo(map);
    bordersGroup = L.layerGroup().addTo(map);
    choroplethGroup = L.layerGroup().addTo(map);
    highlightGroup = L.layerGroup().addTo(map);
    canvasLayer = new FastPointsLayer().addTo(map);
    overlayGroup = L.layerGroup().addTo(map);

    // Oculta siempre el tooltip al mover el mapa o salir hacia el panel lateral
    map.on("movestart zoomstart", hideChoroTooltip);
    map.getContainer().addEventListener("mouseleave", () => {
      hideChoroTooltip();
      if (hoveredKey !== null) {
        hoveredKey = null;
        refreshChoroplethStyles();
        if (choroConfig && typeof choroConfig.onHover === "function") {
          choroConfig.onHover(null, null);
        }
      }
    });

    applyBaseStyle();
    fitToCDMX(false);
    ensureGeoLoaded();

    const slider = document.getElementById("tile-opacity");
    const valLabel = document.getElementById("tile-opacity-val");
    if (slider) {
      slider.addEventListener("input", () => {
        currentOpacity = Number(slider.value) / 100;
        tileGroup.eachLayer((layer) => {
          if (typeof layer.setOpacity === "function") layer.setOpacity(currentOpacity);
        });
        if (valLabel) valLabel.textContent = `${slider.value}%`;
      });
    }

    const chkMask = document.getElementById("chk-cdmx-mask");
    if (chkMask) {
      chkMask.addEventListener("change", () => {
        showMask = chkMask.checked;
        renderCDMXHighlight();
      });
    }

    const chkBorders = document.getElementById("chk-cdmx-borders");
    if (chkBorders) {
      chkBorders.addEventListener("change", () => {
        showBorders = chkBorders.checked;
        renderCDMXHighlight();
      });
    }

    const resetBtn = document.getElementById("btn-reset-view");
    if (resetBtn) resetBtn.addEventListener("click", () => fitToCDMX(true));

    const styleBtn = document.getElementById("btn-toggle-style");
    if (styleBtn) {
      styleBtn.addEventListener("click", () => {
        styleIndex = (styleIndex + 1) % BASE_STYLES.length;
        applyBaseStyle();
      });
    }
  }

  return {
    init,
    getMap: () => map,
    getOverlayGroup: () => overlayGroup,
    getGeometryRenderer: () => geometryRenderer,
    ensureGeoLoaded,
    clearOverlays: () => overlayGroup && overlayGroup.clearLayers(),
    setPoints: (points, options) => canvasLayer && canvasLayer.setData(points, options),
    setChoropleth,
    clearChoropleth,
    refreshChoroplethStyles,
    closePopups,
    setHoveredAlcaldia: (key) => {
      hoveredKey = key;
      refreshChoroplethStyles();
    },
    setSelectedAlcaldia: (key) => {
      selectedKey = key;
      refreshChoroplethStyles();
    },
    flyTo: (latlng, zoom) => map && map.setView(latlng, zoom, { animate: true }),
    resetView: () => fitToCDMX(true),
  };
})();