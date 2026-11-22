window.Stats = (() => {
  const EARTH_RADIUS_KM = 6371.0088;

  function haversineKm(lat1, lon1, lat2, lon2) {
    const toRad = Math.PI / 180;
    const dLat = (lat2 - lat1) * toRad;
    const dLon = (lon2 - lon1) * toRad;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
    return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  function sortedNumbers(arr) {
    const out = [];
    for (let i = 0; i < arr.length; i++) {
      const v = arr[i];
      if (Number.isFinite(v)) out.push(v);
    }
    out.sort((a, b) => a - b);
    return out;
  }

  // Equivalente exacto a pandas.Series.quantile(q, interpolation='linear')
  function quantileSorted(sorted, q) {
    const n = sorted.length;
    if (n === 0) return NaN;
    if (n === 1) return sorted[0];
    const pos = (n - 1) * q;
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    const frac = pos - lo;
    return sorted[lo] + frac * (sorted[hi] - sorted[lo]);
  }

  function mean(arr) {
    let sum = 0;
    let n = 0;
    for (let i = 0; i < arr.length; i++) {
      if (Number.isFinite(arr[i])) {
        sum += arr[i];
        n++;
      }
    }
    return n ? sum / n : NaN;
  }

  // Desviación estándar muestral (ddof = 1)
  function std(arr) {
    const m = mean(arr);
    if (!Number.isFinite(m)) return NaN;
    let sq = 0;
    let n = 0;
    for (let i = 0; i < arr.length; i++) {
      if (Number.isFinite(arr[i])) {
        const d = arr[i] - m;
        sq += d * d;
        n++;
      }
    }
    return n > 1 ? Math.sqrt(sq / (n - 1)) : NaN;
  }

  function pearson(xs, ys) {
    let n = 0;
    let sx = 0;
    let sy = 0;
    for (let i = 0; i < xs.length; i++) {
      if (Number.isFinite(xs[i]) && Number.isFinite(ys[i])) {
        sx += xs[i];
        sy += ys[i];
        n++;
      }
    }
    if (n < 2) return NaN;
    const mx = sx / n;
    const my = sy / n;
    let num = 0;
    let dx2 = 0;
    let dy2 = 0;
    for (let i = 0; i < xs.length; i++) {
      if (Number.isFinite(xs[i]) && Number.isFinite(ys[i])) {
        const dx = xs[i] - mx;
        const dy = ys[i] - my;
        num += dx * dy;
        dx2 += dx * dx;
        dy2 += dy * dy;
      }
    }
    const den = Math.sqrt(dx2 * dy2);
    return den > 0 ? num / den : NaN;
  }

  function averageRanks(values) {
    const n = values.length;
    const idx = new Array(n);
    for (let i = 0; i < n; i++) idx[i] = i;
    idx.sort((a, b) => values[a] - values[b]);

    const ranks = new Float64Array(n);
    let i = 0;
    while (i < n) {
      let j = i;
      const v = values[idx[i]];
      while (j + 1 < n && values[idx[j + 1]] === v) j++;
      const avgRank = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) ranks[idx[k]] = avgRank;
      i = j + 1;
    }
    return ranks;
  }

  function spearman(xs, ys) {
    const vx = [];
    const vy = [];
    for (let i = 0; i < xs.length; i++) {
      if (Number.isFinite(xs[i]) && Number.isFinite(ys[i])) {
        vx.push(xs[i]);
        vy.push(ys[i]);
      }
    }
    if (vx.length < 2) return NaN;
    return pearson(averageRanks(vx), averageRanks(vy));
  }

  function summarize(rows, valueKey = "precio", xKey = "dist_km") {
    const ys = [];
    const xs = [];
    for (let i = 0; i < rows.length; i++) {
      ys.push(rows[i][valueKey]);
      xs.push(rows[i][xKey]);
    }
    const ysSorted = sortedNumbers(ys);
    const xsSorted = sortedNumbers(xs);
    const q1 = quantileSorted(ysSorted, 0.25);
    const med = quantileSorted(ysSorted, 0.5);
    const q3 = quantileSorted(ysSorted, 0.75);
    const m = mean(ys);
    return {
      n: rows.length,
      mean: m,
      median: med,
      q1,
      q3,
      iqr: q3 - q1,
      std: std(ys),
      brecha: m - med,
      distMedian: quantileSorted(xsSorted, 0.5),
      pearson: pearson(xs, ys),
      spearman: spearman(xs, ys),
    };
  }

  // Discretización por cuantiles (equivalente a pd.qcut)
  function qcutGroups(rows, xKey, q, prefix = "O") {
    const xsSorted = sortedNumbers(rows.map((r) => r[xKey]));
    if (!xsSorted.length) return [];
    const edges = [];
    for (let i = 0; i <= q; i++) {
      edges.push(quantileSorted(xsSorted, i / q));
    }
    const groups = [];
    for (let b = 0; b < q; b++) {
      const lo = edges[b];
      const hi = edges[b + 1];
      const subset = rows.filter((r) =>
        b === 0 ? r[xKey] >= lo && r[xKey] <= hi : r[xKey] > lo && r[xKey] <= hi
      );
      const s = summarize(subset, "precio", xKey);
      groups.push({
        code: `${prefix}${b + 1}`,
        label: `${prefix}${b + 1}: ${lo.toFixed(2)}–${hi.toFixed(2)} km`,
        lo,
        hi,
        ...s,
      });
    }
    return groups;
  }

  // Formateadores consistentes
  const fmtInt = (v) =>
    Number.isFinite(v) ? Math.round(v).toLocaleString("es-MX") : "—";
  const fmtMXN = (v, dec = 0) =>
    Number.isFinite(v)
      ? "$" + v.toLocaleString("es-MX", { minimumFractionDigits: dec, maximumFractionDigits: dec })
      : "—";
  const fmtPct = (v, dec = 1) =>
    Number.isFinite(v) ? `${v.toFixed(dec)}%` : "—";
  const fmtDec = (v, dec = 2) =>
    Number.isFinite(v) ? v.toFixed(dec) : "—";
  const fmtSigned = (v, dec = 2) =>
    Number.isFinite(v) ? `${v >= 0 ? "+" : ""}${v.toFixed(dec)}` : "—";

  return {
    haversineKm,
    sortedNumbers,
    quantileSorted,
    mean,
    std,
    pearson,
    spearman,
    summarize,
    qcutGroups,
    fmtInt,
    fmtMXN,
    fmtPct,
    fmtDec,
    fmtSigned,
  };
})();