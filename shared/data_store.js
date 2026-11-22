window.DataStore = (() => {
  const CSV_PATH = "shared/datos_analisis.csv";
  let cache = null;
  let pending = null;

  function toNum(v) {
    if (v === null || v === undefined) return NaN;
    const s = String(v).trim();
    if (!s || s === "NaN" || s === "None" || s === "null") return NaN;
    const n = Number(s);
    return Number.isFinite(n) ? n : NaN;
  }

  // Normaliza nombres para cruzar CSV y GeoJSON sin errores de acentos o espacios
  function normalizeKey(str) {
    return String(str || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  function parseRows(rawRows) {
    const out = [];
    for (let i = 0; i < rawRows.length; i++) {
      const r = rawRows[i];
      const lat = toNum(r.lat ?? r.latitude);
      const lon = toNum(r.lon ?? r.longitude);
      const precio = toNum(r.precio ?? r.price);
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(precio) || precio <= 0) {
        continue;
      }
      const alcaldia = String(r.alcaldia || "Sin dato").trim();
      const capacidad = toNum(r.capacidad ?? r.accommodates);
      const precioHuespedRaw = toNum(r.precio_huesped);
      const precio_huesped = Number.isFinite(precioHuespedRaw)
        ? precioHuespedRaw
        : capacidad > 0
          ? precio / capacidad
          : NaN;

      out.push({
        lat,
        lon,
        alcaldia,
        alcaldia_key: normalizeKey(alcaldia),
        modalidad: String(r.modalidad || "Sin dato").trim(),
        precio,
        log_precio: Math.log10(precio),
        precio_huesped,
        capacidad,
        recamaras: toNum(r.recamaras ?? r.bedrooms),
        camas: toNum(r.camas ?? r.beds),
        disponibilidad_365: toNum(r.disponibilidad_365 ?? r.availability_365),
        calificacion: toNum(r.calificacion ?? r.review_scores_rating),
        resenas: toNum(r.resenas ?? r.number_of_reviews),
        host_id: String(r.host_id || "").trim(),
        anuncios_anfitrion: toNum(r.anuncios_anfitrion ?? r.calculated_host_listings_count),
      });
    }
    return out;
  }

  async function load() {
    if (cache) return cache;
    if (pending) return pending;

    pending = (async () => {
      const resp = await fetch(CSV_PATH);
      if (!resp.ok) throw new Error(`HTTP ${resp.status} al leer ${CSV_PATH}`);
      const text = await resp.text();
      const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
      cache = parseRows(parsed.data);
      return cache;
    })();

    try {
      return await pending;
    } finally {
      pending = null;
    }
  }

  function loadFromFile(file) {
    return new Promise((resolve, reject) => {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (res) => {
          cache = parseRows(res.data);
          resolve(cache);
        },
        error: reject,
      });
    });
  }

  return {
    CSV_PATH,
    load,
    loadFromFile,
    getCached: () => cache,
    normalizeKey,
  };
})();