// The two drawings: the track seen from above, and its elevation profile.
//
// They share one job. Both must make the recording gap impossible to miss,
// because that is the one measurement that changes what you do on the
// mountain. So the gap gets the same weight in both: a heavy dashed chord in
// the warning colour, end marks where the recording stopped and resumed, and a
// label anchored to it. A small ringed dot is not enough on the map when the
// profile shows a tinted band.
//
// Everything here is arithmetic and strings. Fetching tiles, painting them and
// writing the axis numbers are the caller's work, so this file runs and is
// tested without a browser.

const TRACE_W = 1000;
const TRACE_H = 600;
const TRACE_PAD = 34;
const PROFILE_W = 1000;
const PROFILE_H = 230;
const TILE_SIZE = 256;
// A backstop for shapes that would otherwise ask for a wall of tiles, not a
// number the ordinary case is meant to hit. When this fires the map has already
// given up more sharpness than ZOOM_BIAS intended.
const MAX_TILES = 64;

// The basemap is drawn one zoom coarser than the screen could resolve, on
// purpose. It is ground, damped to a fraction of its brightness and sitting
// under the only two things on the chart that matter, so the sharpness buys
// nothing; a level costs four times the requests, and they are made to a
// service funded by donations. Each tile ends up enlarged about 16%, which is
// not visible through the damping.
const ZOOM_BIAS = 1;

/** Where Web Mercator is cut off, north and south. Cutting here is what makes
 *  the projected world square, which is what map tiles are cut on. */
export const MAX_LATITUDE = 85.05112877980659;

// ------------------------------------------------------------------ mercator
//
// World coordinates run 0 to 1 across the whole world, x east and y south.
// The track is projected the same way the basemap is cut, so a tile laid under
// the trace lines up with it at every size instead of sliding off as you move
// away from the middle of the route.

export function lonToWorldX(lon) {
  return (lon + 180) / 360;
}

export function latToWorldY(lat) {
  // One corrupt latitude past the cut-off would come back as infinity and
  // blank the whole chart, so it is clamped before the tangent, not after.
  const clamped = Math.min(MAX_LATITUDE, Math.max(-MAX_LATITUDE, lat));
  const phi = (clamped * Math.PI) / 180;
  return 0.5 - Math.asinh(Math.tan(phi)) / (2 * Math.PI);
}

export function worldXToLon(worldX) {
  return worldX * 360 - 180;
}

export function worldYToLat(worldY) {
  return (Math.atan(Math.sinh(Math.PI * (1 - 2 * worldY))) * 180) / Math.PI;
}

/** How a shape sits in a box: the world point that lands at (0, 0), and how
 *  many box units one world unit covers. Mercator keeps angles, so one factor
 *  serves both axes, and that single factor is what lets the tile layer
 *  register with the drawing exactly.
 *
 *  The box is a parameter because the same shape is drawn at two sizes now:
 *  the report's chart, and the small drawing on a card. Two fits written out
 *  twice would disagree eventually, and a card that disagrees with the chart it
 *  leads to is worse than a card with no drawing on it. */
export function fitFrame(points, box) {
  let minWX = Infinity;
  let maxWX = -Infinity;
  let minWY = Infinity;
  let maxWY = -Infinity;
  // A long recording is tens of thousands of points, which is more arguments
  // than Math.min(...array) can take, so the bounds are found by walking.
  for (const p of points) {
    const wx = lonToWorldX(p.lon);
    const wy = latToWorldY(p.lat);
    if (wx < minWX) minWX = wx;
    if (wx > maxWX) maxWX = wx;
    if (wy < minWY) minWY = wy;
    if (wy > maxWY) maxWY = wy;
  }

  // A track that never moved has no extent to fit. The floor keeps the scale
  // finite, and the zoom clamp downstream turns it into a single tile.
  const spanX = maxWX - minWX || 1e-12;
  const spanY = maxWY - minWY || 1e-12;
  const unitsPerWorld = Math.min(
    (box.width - 2 * box.pad) / spanX,
    (box.height - 2 * box.pad) / spanY,
  );
  const offsetX = (box.width - spanX * unitsPerWorld) / 2;
  const offsetY = (box.height - spanY * unitsPerWorld) / 2;

  return {
    worldX0: minWX - offsetX / unitsPerWorld,
    worldY0: minWY - offsetY / unitsPerWorld,
    unitsPerWorld,
  };
}

/** The report chart's own fit. The tile layer reads this frame, so the box it
 *  is measured in is the one the basemap is cut to. */
export function traceFrame(points) {
  return fitFrame(points, { width: TRACE_W, height: TRACE_H, pad: TRACE_PAD });
}

export function projectInFrame(points, frame) {
  return points.map((p) => ({
    x: (lonToWorldX(p.lon) - frame.worldX0) * frame.unitsPerWorld,
    y: (latToWorldY(p.lat) - frame.worldY0) * frame.unitsPerWorld,
  }));
}

/** Track points as viewBox coordinates. There is no north-south flip here:
 *  Mercator y already grows south, the way SVG y does. Flipping it as well
 *  would mirror the track against the map underneath it. */
export function projectTrace(points) {
  return projectInFrame(points, traceFrame(points));
}

// ---------------------------------------------------------------- tile layer

/** Everything a basemap under a drawing needs: which zoom, which tiles, where
 *  each one lands, and where a coordinate falls on screen.
 *
 *  `frame` comes from fitFrame, so the tiles inherit the drawing's own fit and
 *  cannot drift from it. `view` is the canvas in CSS pixels, and `view.box` is
 *  the drawing's box in frame units: the report passes nothing and gets its own
 *  1000x600, a card passes 320x180. `view.maxTiles` is the caller's ceiling on
 *  how much it is willing to ask the tile server for, which a card sets far
 *  lower than the report because nine of them are on screen at once.
 *
 *  Nothing is fetched and no URL is built: the caller owns the tile source. */
export function tileLayer(frame, view) {
  // The drawing's own box, in the units the frame was fitted in. It defaults to
  // the report chart because that is the only caller that existed first; a card
  // fits its shape into a 320x180 box and passes that, so the same arithmetic
  // serves both. Reading it from the caller rather than assuming 1000x600 is
  // what stops a card's tiles from being cut to a 5:3 rectangle its drawing
  // does not occupy, which would slide the ground off the line at every size.
  const boxW = view.box?.width ?? TRACE_W;
  const boxH = view.box?.height ?? TRACE_H;
  // The SVG keeps its aspect ratio, so it is letterboxed inside the canvas and
  // the map covers that same rectangle, not the whole box.
  const cssPerUnit = Math.min(view.width / boxW, view.height / boxH);
  // Above 2 the extra pixels cost four times the data for a difference nobody
  // sees on a chart this small, on the connection most likely to be a phone in
  // a car park.
  const dpr = Math.min(view.devicePixelRatio || 1, 2);
  const maxZoom = view.maxZoom ?? 19;
  const maxTiles = view.maxTiles ?? MAX_TILES;

  // Where the drawing's own box lands once the SVG is letterboxed. The
  // map is NOT cut to it: the ground carries on past the route in life, and a
  // lighter rectangle inset in a darker card reads as a picture pasted into the
  // chart rather than as the ground the chart sits on. So the plate is the
  // whole box, and the extra is real map either side.
  const traceW = boxW * cssPerUnit;
  const traceH = boxH * cssPerUnit;
  const traceLeft = (view.width - traceW) / 2;
  const traceTop = (view.height - traceH) / 2;
  // The overspill, back in trace units, so the tile maths can stay in them.
  const spillU = traceLeft / cssPerUnit;
  const spillV = traceTop / cssPerUnit;
  const plate = { left: 0, top: 0, width: view.width, height: view.height };

  function enumerate(z) {
    const worldPx = TILE_SIZE * 2 ** z;
    // Screen pixels per tile pixel. Rounding the zoom up would keep this at or
    // below 1, but ZOOM_BIAS then gives a level back, so it sits near 1.16:
    // tiles slightly enlarged. Anything much above that turns contour lines
    // into porridge, which is what MAX_TILE_STRETCH watches for.
    const shrink = (cssPerUnit * dpr * frame.unitsPerWorld) / worldPx;
    const perUnit = worldPx / frame.unitsPerWorld;
    // Shifted out by exactly the letterbox margin, so the scale is untouched
    // and the track still lands where it landed. Only more ground is shown.
    const px0 = frame.worldX0 * worldPx - spillU * perUnit;
    const py0 = frame.worldY0 * worldPx - spillV * perUnit;
    const px1 = px0 + (boxW + 2 * spillU) * perUnit;
    const py1 = py0 + (boxH + 2 * spillV) * perUnit;

    const columns = 2 ** z;
    const txMin = Math.floor(px0 / TILE_SIZE);
    const txMax = Math.ceil(px1 / TILE_SIZE) - 1;
    // There is nothing above the pole or below it, so those rows are dropped
    // rather than requested.
    const tyMin = Math.max(0, Math.floor(py0 / TILE_SIZE));
    const tyMax = Math.min(columns - 1, Math.ceil(py1 / TILE_SIZE) - 1);

    const tiles = [];
    for (let ty = tyMin; ty <= tyMax; ty++) {
      const top = Math.round((ty * TILE_SIZE - py0) * shrink);
      const bottom = Math.round(((ty + 1) * TILE_SIZE - py0) * shrink);
      for (let tx = txMin; tx <= txMax; tx++) {
        // The edges are rounded, never the widths, so two neighbours share one
        // integer boundary and no hairline of background shows between them.
        const left = Math.round((tx * TILE_SIZE - px0) * shrink);
        const right = Math.round(((tx + 1) * TILE_SIZE - px0) * shrink);
        tiles.push({
          z,
          // A route that crosses the date line asks for columns off the end of
          // the grid; the world wraps there even though the numbering does not.
          x: ((tx % columns) + columns) % columns,
          y: ty,
          left,
          top,
          width: right - left,
          height: bottom - top,
        });
      }
    }
    return { tiles, shrink };
  }

  // The finest zoom the screen can actually show. Clamping happens before any
  // tile is counted, which is also what keeps a zero-extent track to one tile.
  let zoom = Math.ceil(
    Math.log2((cssPerUnit * frame.unitsPerWorld * dpr) / TILE_SIZE),
  );
  zoom = Math.max(0, Math.min(maxZoom, zoom - ZOOM_BIAS));
  let range = enumerate(zoom);
  // Each step down quarters the request count. A burst of requests costs more
  // on a mountain connection than one level of sharpness is worth.
  while (range.tiles.length > maxTiles && zoom > 0) {
    zoom -= 1;
    range = enumerate(zoom);
  }

  return {
    zoom,
    tileSize: TILE_SIZE,
    devicePixelRatio: dpr,
    cssPerUnit,
    // Where to put the canvas element, in CSS pixels inside the chart box.
    plate,
    // Where the track's own box starts inside that same space. It is not the
    // plate's corner any more, and a caller that assumes it is will place
    // markers off the line, so the two are named separately.
    traceOrigin: { left: traceLeft, top: traceTop },
    // How big its backing store must be, in device pixels. Tile positions are
    // in this space, so nothing has to be scaled at draw time.
    backing: {
      width: Math.round(plate.width * dpr),
      height: Math.round(plate.height * dpr),
    },
    tiles: range.tiles,
    tileShrink: range.shrink,
    /** A coordinate as CSS pixels inside the chart box, the same space the
     *  gap label and the tooltip are positioned in. */
    project(lat, lon) {
      return {
        x: traceLeft + (lonToWorldX(lon) - frame.worldX0) * frame.unitsPerWorld * cssPerUnit,
        y: traceTop + (latToWorldY(lat) - frame.worldY0) * frame.unitsPerWorld * cssPerUnit,
      };
    },
  };
}

// --------------------------------------------------------------------- ticks
//
// Steps a walker reads without doing arithmetic. Both ladders climb, so the
// first step that fits the space is also the finest one available.

const DISTANCE_STEPS_M = [10, 25, 50, 100, 250, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000];
const ELEVATION_STEPS_M = [1, 2, 5, 10, 25, 50, 100, 200, 250, 500, 1000, 2000];

/** Distance ticks from zero. The last one always falls short of the total: the
 *  right edge of the plot is the finish by construction, and the total is
 *  already the headline of the distance tile. */
export function distanceTicks(totalM, maxLabels) {
  for (const step of DISTANCE_STEPS_M) {
    const count = Math.max(1, Math.ceil(totalM / step));
    if (count <= maxLabels) {
      return Array.from({ length: count }, (_, i) => i * step);
    }
  }
  return [0];
}

/** Round heights inside the range that was drawn. The chart is not rescaled to
 *  fit them: on a plot this short the silhouette is the measurement, and
 *  stretching it up to a round ceiling would draw the climb shallower than it
 *  is. So the top tick usually sits below the summit, which is correct. */
export function elevationTicks(minM, maxM, maxLabels) {
  for (const step of ELEVATION_STEPS_M) {
    const first = Math.ceil(minM / step);
    const last = Math.floor(maxM / step);
    if (last - first + 1 <= maxLabels) {
      const levels = [];
      // `|| 0` is not tidying: Math.ceil of a small negative gives negative
      // zero, it survives the multiplication, and Intl formats it as "-0".
      // Sea level is 0.
      for (let i = first; i <= last; i++) levels.push(i * step || 0);
      return levels;
    }
  }
  return [];
}

// -------------------------------------------------------------------- charts

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
  const frame = traceFrame(points);
  const coords = projectInFrame(points, frame);
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

  return { svg, coords, gapAnchor, viewBox: { w: TRACE_W, h: TRACE_H }, frame };
}

/** `options.compact` asks for the phone's tick counts. It is a count, not a
 *  measurement of the box: a count fixed per breakpoint means the axis does
 *  not reshuffle itself while a window is being dragged. */
export function renderProfile(points, measurements, t, options = {}) {
  const cumulative = measurements.cumulative;
  const total = measurements.distanceM || 1;
  const min = measurements.elevationMinM ?? 0;
  const max = measurements.elevationMaxM ?? 1;
  const span = max - min || 1;

  const showGap = measurements.gapExceedsThreshold;
  const cut = showGap ? gapIndex(measurements) : -1;

  const px = (i) => (cumulative[i] / total) * PROFILE_W;

  // The axis is the filtered range, so a single bad reading cannot squash the
  // terrain into the bottom of the box. A reading outside it is drawn at the
  // edge rather than off the chart, and `clipped` tells the caller it happened
  // so the report can say so: silently flattening a spike would hide something
  // that is really in the file.
  let clipped = 0;
  const py = (ele) => {
    const inside = Math.max(min, Math.min(max, ele));
    if (inside !== ele) clipped += 1;
    return PROFILE_H - 12 - ((inside - min) / span) * (PROFILE_H - 24);
  };

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

  // A recording with no heights has no scale to read, so it gets no levels.
  const hasElevation = measurements.elevationMinM !== null && measurements.elevationMinM !== undefined;
  const levels = hasElevation ? elevationTicks(min, max, options.compact ? 3 : 4) : [];
  // The lines belong in the SVG and the numbers do not: this chart is drawn
  // with preserveAspectRatio="none", which leaves a horizontal line horizontal
  // but squashes glyphs out of shape. The caller writes the numbers as HTML in
  // a gutter beside the plot.
  const levelMarkup = levels
    .map((ele) => `<line x1="0" y1="${py(ele).toFixed(1)}" x2="${PROFILE_W}" y2="${py(ele).toFixed(1)}"/>`)
    .join('');

  let gapMarkup = '';
  let gapFraction = null;
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
    gapFraction = (x1 + bandWidth / 2) / PROFILE_W;
  }

  // The gap label owns its slot under the plot, so a distance tick too close to
  // it is dropped. The origin never gives way: a gap in the first stretch of
  // the route gives up its label instead, and the trace and the warning panel
  // carry it.
  const CROWDED = 0.08;
  if (gapFraction !== null && gapFraction < CROWDED) gapFraction = null;
  const spacedTicks = distanceTicks(total, options.compact ? 5 : 7);
  // The step is read here, from the full list, and handed to the caller. Work
  // it out downstream from the ticks that survived the filter below and a
  // dropped tick reads as a doubled step, which rounds 1.5 km to 2 and prints
  // the same number twice.
  const distanceStepM = spacedTicks.length > 1 ? spacedTicks[1] - spacedTicks[0] : total;
  const distances = spacedTicks
    .map((valueM) => ({ valueM, fraction: valueM / total }))
    .filter(
      (tick) =>
        gapFraction === null ||
        tick.valueM === 0 ||
        Math.abs(tick.fraction - gapFraction) >= CROWDED,
    );

  const svg = `<svg viewBox="0 0 ${PROFILE_W} ${PROFILE_H}" preserveAspectRatio="none" role="img" aria-label="${t('chart.profile')}">
      ${area}<g class="profile-grid">${levelMarkup}</g>${gapMarkup}${stroke}
      <g class="profile-cursor" hidden>
        <line y1="0" y2="${PROFILE_H}" class="profile-cursor-line"/>
        <circle r="4" class="profile-cursor-dot"/>
      </g>
    </svg>`;

  return {
    svg,
    px,
    py,
    // How many readings sat outside the filtered range and were drawn at the
    // edge. Non-zero means the file holds a height the profile could not show
    // at a scale that keeps the ground readable, and the report says so.
    clipped,
    viewBox: { w: PROFILE_W, h: PROFILE_H },
    // Fractions of the plot, not pixels: this chart is stretched to whatever
    // box it is given, so a fraction is right at every size and needs no
    // recalculating when the window moves.
    axis: {
      x: distances,
      stepM: distanceStepM,
      y: levels.map((valueM) => ({ valueM, fraction: py(valueM) / PROFILE_H })),
      gapFraction,
    },
  };
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
