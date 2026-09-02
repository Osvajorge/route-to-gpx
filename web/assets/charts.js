// The two drawings: the track seen from above, and its elevation profile.
//
// They share one job. Both must make the recording gap impossible to miss,
// because that is the one measurement that changes what you do on the
// mountain. So the gap gets the same weight in both: a heavy dashed chord in
// the warning colour, end marks where the recording stopped and resumed, and a
// label anchored to it. A small ringed dot is not enough on the map when the
// profile shows a tinted band.

const TRACE_W = 1000;
const TRACE_H = 600;
const TRACE_PAD = 34;
const PROFILE_W = 1000;
const PROFILE_H = 230;

/** Equirectangular projection, fitted to the viewBox with the aspect kept. */
export function projectTrace(points) {
  const lats = points.map((p) => p.lat);
  const lons = points.map((p) => p.lon);
  const midLat = ((Math.min(...lats) + Math.max(...lats)) / 2 / 180) * Math.PI;
  const kx = Math.cos(midLat);

  const xs = lons.map((lon) => lon * kx);
  const ys = lats;
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const spanX = maxX - minX || 1e-9;
  const spanY = maxY - minY || 1e-9;
  const scale = Math.min(
    (TRACE_W - 2 * TRACE_PAD) / spanX,
    (TRACE_H - 2 * TRACE_PAD) / spanY,
  );
  const offsetX = (TRACE_W - spanX * scale) / 2;
  const offsetY = (TRACE_H - spanY * scale) / 2;

  return points.map((p, i) => ({
    x: offsetX + (xs[i] - minX) * scale,
    // Latitude grows north, SVG y grows down.
    y: TRACE_H - offsetY - (ys[i] - minY) * scale,
  }));
}

function pathFrom(coords, from, to) {
  let d = '';
  for (let i = from; i <= to; i++) {
    d += (i === from ? 'M' : 'L') + coords[i].x.toFixed(1) + ' ' + coords[i].y.toFixed(1);
  }
  return d;
}

/** Index of the point right after the largest gap. */
function gapIndex(measurements) {
  const target = measurements.largestGapAtM;
  const cumulative = measurements.cumulative;
  for (let i = 0; i < cumulative.length; i++) {
    if (cumulative[i] >= target) return i;
  }
  return -1;
}

export function renderTrace(points, measurements, t) {
  const coords = projectTrace(points);
  const showGap = measurements.gapExceedsThreshold;
  const cut = showGap ? gapIndex(measurements) : -1;

  // Split the drawn track either side of the gap so the gap itself is never
  // painted as if it were recorded ground.
  const segments =
    cut > 0 && cut < coords.length
      ? [pathFrom(coords, 0, cut - 1), pathFrom(coords, cut, coords.length - 1)]
      : [pathFrom(coords, 0, coords.length - 1)];

  const grid = [];
  for (let x = 100; x < TRACE_W; x += 100) {
    grid.push(`<line x1="${x}" y1="0" x2="${x}" y2="${TRACE_H}"/>`);
  }
  for (let y = 100; y < TRACE_H; y += 100) {
    grid.push(`<line x1="0" y1="${y}" x2="${TRACE_W}" y2="${y}"/>`);
  }

  const glow = segments
    .map((d) => `<path d="${d}" class="trace-glow"/><path d="${d}" class="trace-halo"/>`)
    .join('');
  const line = segments.map((d) => `<path d="${d}" class="trace-line"/>`).join('');

  let gapMarkup = '';
  let gapAnchor = null;
  if (cut > 0 && cut < coords.length) {
    const a = coords[cut - 1];
    const b = coords[cut];
    // End marks sit across the chord, so the eye reads "the recording stopped
    // here and resumed there" rather than "there is a dot".
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy) || 1;
    const nx = (-dy / length) * 9;
    const ny = (dx / length) * 9;
    gapMarkup = `
      <line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" class="trace-gap-glow"/>
      <line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" class="trace-gap"/>
      <line x1="${(a.x - nx).toFixed(1)}" y1="${(a.y - ny).toFixed(1)}" x2="${(a.x + nx).toFixed(1)}" y2="${(a.y + ny).toFixed(1)}" class="trace-gap-end"/>
      <line x1="${(b.x - nx).toFixed(1)}" y1="${(b.y - ny).toFixed(1)}" x2="${(b.x + nx).toFixed(1)}" y2="${(b.y + ny).toFixed(1)}" class="trace-gap-end"/>`;
    gapAnchor = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  const start = coords[0];
  const svg = `<svg viewBox="0 0 ${TRACE_W} ${TRACE_H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${t('chart.trace')}">
      <g class="chart-grid">${grid.join('')}</g>
      ${glow}${line}${gapMarkup}
      <circle cx="${start.x.toFixed(1)}" cy="${start.y.toFixed(1)}" r="4.5" class="trace-start"/>
      <g class="trace-cursor" hidden>
        <circle r="13" class="trace-cursor-halo"/>
        <circle r="5.5" class="trace-cursor-dot"/>
      </g>
    </svg>`;

  return { svg, coords, gapAnchor, viewBox: { w: TRACE_W, h: TRACE_H } };
}

export function renderProfile(points, measurements, t) {
  const cumulative = measurements.cumulative;
  const total = measurements.distanceM || 1;
  const min = measurements.elevationMinM ?? 0;
  const max = measurements.elevationMaxM ?? 1;
  const span = max - min || 1;

  const showGap = measurements.gapExceedsThreshold;
  const cut = showGap ? gapIndex(measurements) : -1;

  const px = (i) => (cumulative[i] / total) * PROFILE_W;
  const py = (ele) => PROFILE_H - 12 - ((ele - min) / span) * (PROFILE_H - 24);

  const run = (from, to) => {
    let d = '';
    for (let i = from; i <= to; i++) {
      const ele = points[i].ele;
      if (ele === null) continue;
      d += (d === '' ? 'M' : 'L') + px(i).toFixed(1) + ' ' + py(ele).toFixed(1);
    }
    return d;
  };

  const runs =
    cut > 0 && cut < points.length
      ? [run(0, cut - 1), run(cut, points.length - 1)]
      : [run(0, points.length - 1)];

  const area = runs
    .filter(Boolean)
    .map((d) => {
      const first = d.slice(1).split('L')[0].split(' ');
      const lastPair = d.split('L').pop().split(' ');
      return `<path d="${d}L${lastPair[0]} ${PROFILE_H} L${first[0]} ${PROFILE_H} Z" class="profile-area"/>`;
    })
    .join('');
  const stroke = runs
    .filter(Boolean)
    .map((d) => `<path d="${d}" class="profile-line"/>`)
    .join('');

  let gapMarkup = '';
  if (cut > 0 && cut < points.length) {
    const x1 = px(cut - 1);
    const x2 = px(cut);
    const y1 = py(points[cut - 1].ele ?? min);
    const y2 = py(points[cut].ele ?? min);
    // A short gap on a long route is only a few units wide. Give the band a
    // floor so it stays visible, and mark both edges the way the trace does.
    const bandWidth = Math.max(x2 - x1, 8);
    gapMarkup = `
      <rect x="${x1.toFixed(1)}" y="0" width="${bandWidth.toFixed(1)}" height="${PROFILE_H}" class="profile-gap-band"/>
      <line x1="${x1.toFixed(1)}" y1="0" x2="${x1.toFixed(1)}" y2="${PROFILE_H}" class="profile-gap-end"/>
      <line x1="${(x1 + bandWidth).toFixed(1)}" y1="0" x2="${(x1 + bandWidth).toFixed(1)}" y2="${PROFILE_H}" class="profile-gap-end"/>
      <line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" class="profile-gap"/>`;
  }

  const svg = `<svg viewBox="0 0 ${PROFILE_W} ${PROFILE_H}" preserveAspectRatio="none" role="img" aria-label="${t('chart.profile')}">
      ${area}${gapMarkup}${stroke}
      <g class="profile-cursor" hidden>
        <line y1="0" y2="${PROFILE_H}" class="profile-cursor-line"/>
        <circle r="4" class="profile-cursor-dot"/>
      </g>
    </svg>`;

  return { svg, px, py, viewBox: { w: PROFILE_W, h: PROFILE_H } };
}

/** Distance along the track for the trace point nearest to (x, y) in viewBox
 *  units. The trace keeps its aspect ratio, so the caller has to undo the
 *  letterboxing before asking. */
export function nearestOnTrace(coords, cumulative, x, y) {
  let best = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < coords.length; i++) {
    const d = (coords[i].x - x) ** 2 + (coords[i].y - y) ** 2;
    if (d < bestDistance) {
      bestDistance = d;
      best = i;
    }
  }
  return { index: best, distanceM: cumulative[best] };
}

/** Index of the point at a given distance along the track. */
export function indexAtDistance(cumulative, distanceM) {
  let low = 0;
  let high = cumulative.length - 1;
  while (high - low > 1) {
    const mid = (low + high) >> 1;
    if (cumulative[mid] <= distanceM) low = mid;
    else high = mid;
  }
  return Math.abs(cumulative[low] - distanceM) <= Math.abs(cumulative[high] - distanceM)
    ? low
    : high;
}
