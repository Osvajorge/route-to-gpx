import {
  appendPage,
  catalogueFrom,
  claimSentence,
  sourcesFrom,
  sportAfterSource,
} from './discovery.js';
import { detectLanguage, rememberLanguage, translate } from './i18n.js';
import { icon } from './icons.js';
import {
  buildGpx,
  DEFAULT_GAP_THRESHOLD_M,
  measure,
  parseGpx,
  TrackError,
} from './measure.js';
import {
  indexAtDistance,
  nearestOnTrace,
  renderProfile,
  renderTrace,
  tileLayer,
} from './charts.js';

// Where the link-fetching service lives. A browser cannot read another site
// directly, so links go through this; dropped files never do.
const API_BASE = window.ROUTE_TO_GPX_API ?? '/api';

const EXAMPLE_URL =
  'https://www.wikiloc.com/mountaineering-trails/aneto-desde-artiga-de-lin-8001213';

const state = {
  lang: detectLanguage(),
  view: 'idle',
  url: '',
  stage: 0,
  errorKey: null,
  result: null,
  hover: null,
};

const el = {};
const t = (key, values) => translate(state.lang, key, values);

// ---------------------------------------------------------------- formatting

function formatNumber(value, decimals = 0) {
  return new Intl.NumberFormat(state.lang === 'es' ? 'es-ES' : 'en-GB', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

function formatKm(metres, decimals = 2) {
  return formatNumber(metres / 1000, decimals);
}

function formatBytes(bytes) {
  return bytes < 1024 * 1024
    ? `${formatNumber(bytes / 1024)} KB`
    : `${formatNumber(bytes / (1024 * 1024), 1)} MB`;
}

/** "a, b and c", in the reader's language. */
function joinList(items) {
  try {
    return new Intl.ListFormat(state.lang === 'es' ? 'es-ES' : 'en-GB', {
      style: 'long',
      type: 'conjunction',
    }).format(items);
  } catch {
    // A browser without Intl.ListFormat. Commas still read as a list.
    return items.join(', ');
  }
}

/** Text from a source site, made safe to put inside markup.
 *
 *  Route titles and place names are written by whoever uploaded them, so they
 *  reach this page as somebody else's words and are never trusted as markup. */
function escapeText(value) {
  return String(value).replace(
    /[&<>"]/g,
    (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[character],
  );
}

// ------------------------------------------------------------------- sources

/** Which service a pasted link belongs to. Returns null when we cannot read it. */
export function classifyLink(raw) {
  const value = raw.trim();
  if (!value) return null;
  if (/\.gpx($|\?)/i.test(value)) return { id: 'file' };

  let host;
  try {
    host = new URL(value.startsWith('http') ? value : `https://${value}`).hostname;
  } catch {
    return null;
  }
  if (/(^|\.)komoot\.[a-z.]+$/i.test(host)) return { id: 'komoot', label: 'Komoot' };
  if (/(^|\.)wikiloc\.[a-z.]+$/i.test(host)) return { id: 'wikiloc', label: 'Wikiloc' };
  return null;
}

// --------------------------------------------------------------------- views

function setView(view) {
  state.view = view;
  render();
}

function setStage(stage) {
  state.stage = stage;
  if (state.view === 'working') renderStages();
}

// Hints the service sends to narrow a `domain` failure. Each has its own
// sentence in both languages; anything else falls back to the plain code, so a
// new hint on the service can never leave the page with a missing string.
const HINTS = new Set(['highlight', 'collection', 'guide']);

function errorKeyFor(payload) {
  if (!payload) return 'track';
  if (payload.hint && HINTS.has(payload.hint)) return payload.hint;
  return payload.error ?? 'track';
}

function fail(errorKey) {
  state.errorKey = errorKey;
  setView('error');
}

async function convertFromUrl(url) {
  const source = classifyLink(url);
  if (!source || source.id === 'file') return fail('domain');

  state.url = url;
  state.errorKey = null;
  state.stage = 1;
  setView('working');

  let payload;
  try {
    const response = await fetch(`${API_BASE}/convert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    payload = await response.json();
  } catch {
    return fail('network');
  }

  if (!payload || payload.ok !== true) {
    return fail(errorKeyFor(payload));
  }

  setStage(2);
  await yieldToPaint();

  let track;
  try {
    track = parseGpx(payload.gpx);
  } catch {
    return fail('track');
  }

  setStage(3);
  await yieldToPaint();

  showReport({
    track,
    gpxText: payload.gpx,
    published: payload.published ?? null,
    source: payload.source,
    fileName: payload.fileName || 'route.gpx',
  });
}

async function convertFromFile(file) {
  state.url = file.name;
  state.errorKey = null;
  state.stage = 2;
  setView('working');

  let text;
  try {
    text = await file.text();
  } catch {
    return fail('file');
  }

  let track;
  try {
    track = parseGpx(text);
  } catch (error) {
    return fail(error instanceof TrackError ? 'file' : 'file');
  }

  setStage(3);
  await yieldToPaint();

  const base = file.name.replace(/\.gpx$/i, '');
  showReport({
    track,
    gpxText: text,
    published: null,
    // The label is looked up when the report is drawn, not stamped here, so a
    // language switch reaches it like every other string on the page.
    source: { id: 'file', title: track.name || base, url: null },
    fileName: `${base}-checked.gpx`,
  });
}

function showReport({ track, gpxText, published, source, fileName }) {
  const measurements = measure(track, DEFAULT_GAP_THRESHOLD_M);
  const rebuilt = source.url ? buildGpx(track, source) : gpxText;
  state.result = {
    track,
    measurements,
    published,
    source,
    fileName,
    gpxText: rebuilt,
    sizeBytes: new Blob([rebuilt]).size,
  };
  state.hover = null;
  setView('report');
}

function reset() {
  state.url = '';
  state.stage = 0;
  state.errorKey = null;
  state.result = null;
  state.hover = null;
  // The painted ground belongs to the route that is being left behind.
  hideBasemap();
  setView('idle');
}

/** Hands the browser a moment to paint the stage that just changed.
 *
 *  A timer, not `requestAnimationFrame`: a background tab never paints, so
 *  waiting on a frame there would leave the conversion stopped halfway with a
 *  stage lit up, until the visitor came back to look at it. */
const yieldToPaint = () => new Promise((resolve) => setTimeout(resolve, 0));

// ------------------------------------------------------------------ rendering

function render() {
  document.documentElement.lang = state.lang;
  document.title = t('doc.title');

  el.root.dataset.view = state.view;
  el.skip.textContent = t('skip.main');
  el.langButton.innerHTML = `${icon('language')}<span>${t('lang.switch')}</span>`;
  el.langButton.setAttribute('aria-label', t('lang.switch'));

  // Step two replaces step one. Two steps, not a page that keeps growing.
  el.stepOne.hidden = state.view === 'report';

  renderStepOne();
  renderStages();
  renderError();
  renderReport();
  renderFooter();
}

function renderStepOne() {
  if (state.view === 'report') return;
  el.heading.textContent = t('step1.heading');
  el.subLink.textContent = t('step1.sub.link');
  el.subSearch.textContent = t('step1.sub.search');
  el.subNearby.textContent = t('step1.sub.nearby');
  el.fieldPrefix.textContent = t('field.prefix');
  el.input.placeholder = t('field.placeholder');
  el.input.setAttribute('aria-label', t('field.label'));
  el.input.value = state.url && state.view !== 'report' ? state.url : el.input.value;
  el.input.disabled = state.view === 'working';
  el.pasteButton.innerHTML = `${icon('clipboard')}<span>${t('action.paste')}</span>`;
  el.pasteButton.setAttribute('aria-label', t('action.paste'));
  el.pasteButton.disabled = state.view === 'working';
  el.convertButton.textContent =
    state.view === 'working' ? t('action.converting') : t('action.convert');
  el.convertButton.disabled = state.view === 'working';
  el.hint.textContent = t('step1.hint');
  el.exampleButton.textContent = t('action.example');
  el.exampleButton.hidden = state.view === 'working';
  el.dropNote.textContent = t('step1.drop');
  renderFinder();
}

const STAGES = [
  { key: 'stage.fetch', active: 'stage.fetch.active' },
  { key: 'stage.extract', active: 'stage.extract.active' },
  { key: 'stage.measure', active: 'stage.measure.active' },
];

function renderStages() {
  el.progress.hidden = state.view !== 'working';
  if (state.view !== 'working') return;
  el.progress.setAttribute('aria-label', t('stage.progress'));

  el.progress.innerHTML = STAGES.map((stage, index) => {
    const position = index + 1;
    const status =
      position < state.stage ? 'done' : position === state.stage ? 'active' : 'pending';
    const note = status === 'active' ? t(stage.active) : status === 'pending' ? t('stage.pending') : '';
    return `<li class="stage" data-status="${status}">
        ${icon(status)}
        <span class="stage-name">${t(stage.key)}</span>
        <span class="stage-note">${note}</span>
      </li>`;
  }).join('');
}

function renderError() {
  el.error.hidden = state.view !== 'error';
  if (state.view !== 'error') return;
  const key = state.errorKey;
  el.error.innerHTML = `
    ${icon('warning', 'icon-warning')}
    <div>
      <h2>${t(`error.${key}.title`)}</h2>
      <p>${t(`error.${key}.body`)}</p>
    </div>`;
}

function comparison(measured, publishedValue, unit, decimals) {
  if (publishedValue === null || publishedValue === undefined) {
    return `<span class="compare-missing">${t('compare.notPublished')}</span>`;
  }
  const delta = measured - publishedValue;
  const shown = formatNumber(publishedValue / (unit === 'km' ? 1000 : 1), decimals);
  const tolerance = unit === 'km' ? 20 : 15;
  if (Math.abs(delta) <= tolerance) {
    return `${t('compare.source')} ${shown} · <span class="compare-ok">${t('compare.matches')}</span>`;
  }
  const sign = delta > 0 ? '+' : '';
  const shownDelta = formatNumber(delta / (unit === 'km' ? 1000 : 1), decimals);
  return `${t('compare.source')} ${shown} · ${sign}${shownDelta} ${unit}`;
}

function renderReport() {
  el.report.hidden = state.view !== 'report';
  if (state.view !== 'report' || !state.result) return;

  const { track, measurements, published, source, fileName, sizeBytes } = state.result;
  const warn = measurements.gapExceedsThreshold;

  el.reportTitle.textContent = source.title || track.name || fileName;
  el.reportSource.textContent = t('source.line', {
    // A site names itself; a dropped file is named in the visitor's language.
    source: source.label || t('source.file'),
    when: t('when.today'),
  });
  el.downloadButton.innerHTML = `${icon('download')}<span>${t('step2.download')}</span>`;
  el.resetButton.innerHTML = `${icon('back')}<span>${t('step2.reset')}</span>`;

  el.tiles.innerHTML = `
    ${tile(
      t('measure.distance'),
      formatKm(measurements.distanceM),
      'km',
      comparison(measurements.distanceM, published?.distanceM ?? null, 'km', 2),
      false,
    )}
    ${tile(
      t('measure.ascent'),
      formatNumber(measurements.ascentM),
      'm',
      comparison(measurements.ascentM, published?.ascentM ?? null, 'm', 0),
      false,
    )}
    ${tile(
      t('measure.gap'),
      formatNumber(measurements.largestGapM),
      'm',
      warn
        ? `${t('gap.at', { km: formatKm(measurements.largestGapAtM, 1) })} · ${t('gap.threshold', { threshold: measurements.gapThresholdM })}`
        : t('gap.none', { threshold: measurements.gapThresholdM }),
      warn,
    )}`;

  renderCharts();

  el.warning.hidden = !warn;
  if (warn) {
    el.warning.innerHTML = `${icon('warning', 'icon-warning')}<p>${t('warning.gap', {
      gap: formatNumber(measurements.largestGapM),
      km: formatKm(measurements.largestGapAtM, 1),
    })}</p>`;
  }

  const elevation =
    measurements.elevationMinM === null
      ? '-'
      : `${formatNumber(measurements.elevationMinM)}-${formatNumber(measurements.elevationMaxM)} m`;
  el.secondary.innerHTML = `
    ${measureRow(t('measure.rawAscent'), `${formatNumber(measurements.rawAscentM)} m`)}
    ${measureRow(t('measure.points'), formatNumber(measurements.pointCount))}
    ${measureRow(t('measure.spacing'), `${formatNumber(measurements.meanSpacingM, 1)} m`)}
    ${measureRow(t('measure.elevation'), elevation)}`;

  el.provenance.innerHTML = `${t('provenance')}<br><span class="provenance-file">${t(
    'provenance.file',
    { name: fileName, size: formatBytes(sizeBytes) },
  )}</span>`;
}

function tile(label, value, unit, note, warn) {
  return `<div class="tile${warn ? ' tile-warn' : ''}">
      <span class="tile-label">${label}</span>
      <span class="tile-value">${value}<span class="tile-unit">${unit}</span></span>
      <span class="tile-note">${note}</span>
    </div>`;
}

function measureRow(label, value) {
  return `<div class="measure-row"><dt>${label}</dt><dd>${value}</dd></div>`;
}

// --------------------------------------------------------------------- charts

let chartData = null;

// Only the tick counts differ across the breakpoint, so this is read once and
// the charts are rebuilt when it actually flips, not on every resize event.
const compactQuery = window.matchMedia('(max-width: 640px)');
let compactCharts = compactQuery.matches;

function renderCharts() {
  const { track, measurements } = state.result;
  const trace = renderTrace(track.points, measurements, t);
  const profile = renderProfile(track.points, measurements, t, { compact: compactCharts });
  chartData = { trace, profile };

  el.traceFigure.querySelector('.chart-title').textContent = t('chart.trace');
  el.traceFigure.querySelector('.chart-svg').innerHTML = trace.svg;
  el.traceFigure.querySelector('.chart-caption').innerHTML = measurements.gapExceedsThreshold
    ? `<span>${t('chart.start')}</span><span class="caption-warn">${t('chart.gapDrawn')}</span>`
    : `<span>${t('chart.start')}</span>`;
  el.mapToggle.textContent = basemapOn ? t('map.hide') : t('map.show');
  el.traceCredit.innerHTML = t('map.attribution');

  el.profileFigure.querySelector('.chart-title').textContent = t('chart.profile');
  el.profileFigure.querySelector('.chart-svg').innerHTML = profile.svg;
  renderAxes(profile.axis);

  positionGapLabel();
  paintBasemap();
}

/** The profile's axis numbers, written into the gutters either side of the
 *  plot. charts.js hands out fractions of the plot rather than pixels, because
 *  that chart is stretched to whatever box it is given: a percentage is exact
 *  at every size, so none of this is redone when the window moves.
 *
 *  charts.js has already dropped any distance tick that would collide with the
 *  gap label, so the list arrives ready to print. It also hands over the step
 *  it used, which is why that is not measured from the ticks here: the dropped
 *  one would make the step look twice its size. */
function renderAxes(axis) {
  const { measurements } = state.result;
  const step = axis.stepM;
  // Enough decimals to tell one tick from the next, and no more: 5 km steps
  // read 5, 10, 15, and 250 m steps read 0.25, 0.5, 0.75.
  const decimals =
    step % 1000 === 0 ? 0 : step % 100 === 0 ? 1 : step % 50 === 0 ? 2 : 3;

  // The unit is printed once, on the origin. Every other tick is a bare number,
  // the way a ruler is numbered. The total is never printed at all: it is
  // already the headline of the distance tile, and the right edge of the plot
  // is the finish by construction.
  const marks = axis.x.map((tick, index) =>
    axisLabel(index === 0 ? '0 km' : formatKm(tick.valueM, decimals), tick.fraction),
  );

  if (axis.gapFraction !== null && measurements.gapExceedsThreshold) {
    // Warm, because it changes what you do on the hill. It says the size only:
    // the axis it sits on already says where.
    const anchored = axis.gapFraction > 0.85 ? ' axis-gap-end' : '';
    marks.push(
      axisLabel(
        t('chart.gapLabel', { gap: formatNumber(measurements.largestGapM) }),
        axis.gapFraction,
        `axis-gap${anchored}`,
      ),
    );
  }
  el.axisX.innerHTML = marks.join('');

  el.axisY.innerHTML = axis.y
    .map((tick, index) =>
      axisLabel(
        // The top height carries the unit. It has the sky to itself, and it is
        // what sets the gutter's width.
        index === axis.y.length - 1
          ? `${formatNumber(tick.valueM)} m`
          : formatNumber(tick.valueM),
        tick.fraction,
      ),
    )
    .join('');
}

function axisLabel(text, fraction, className = '') {
  const at = `--at:${(fraction * 100).toFixed(3)}%`;
  return `<span${className ? ` class="${className}"` : ''} style="${at}">${text}</span>`;
}

/** The gap label is HTML over the SVG, not <text> inside it: text in the SVG
 *  namespace scales with the viewBox and becomes unreadable on a phone. */
function positionGapLabel() {
  const { measurements } = state.result;
  const label = el.traceFigure.querySelector('.gap-label');
  if (!measurements.gapExceedsThreshold || !chartData.trace.gapAnchor) {
    label.hidden = true;
    return;
  }
  const canvas = el.traceFigure.querySelector('.chart-canvas');
  const { width, height } = canvas.getBoundingClientRect();
  const { w, h } = chartData.trace.viewBox;
  const k = Math.min(width / w, height / h);
  const left = (width - w * k) / 2 + chartData.trace.gapAnchor.x * k;
  const top = (height - h * k) / 2 + chartData.trace.gapAnchor.y * k;

  label.hidden = false;
  label.textContent = t('chart.gapLabel', {
    gap: formatNumber(measurements.largestGapM),
  });
  label.style.left = `${left}px`;
  label.style.top = `${top}px`;
  // A gap at the top of the bounding box, which is where a there-and-back
  // recording usually stops, leaves no room above the chord: the canvas clips
  // its own overflow, and half the label goes with it. Flip it under the chord
  // rather than let the one label the report exists for get cut in half.
  label.classList.toggle('gap-label-below', top - label.offsetHeight - 14 < 0);
}

// -------------------------------------------------------------------- basemap
//
// Ground under the trace, and nothing more. It says what the track crosses; it
// must never argue with the track or with the gap, so it is drawn first, sunk
// into the background by CSS, and it can be switched off. Losing it is not an
// error the walker needs to read about, so nothing is ever said when it fails.

// The source is named once, here. The OpenStreetMap tile usage policy asks that
// it not be hard-coded through the drawing code, so that it can be swapped
// without one. No subdomains: the policy says to use this host alone and warns
// the old a/b/c names may be withdrawn.
const BASEMAP = {
  urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  maxZoom: 19,
};

const BASEMAP_STORAGE_KEY = 'route-to-gpx:basemap';

// Roughly two screens' worth of tiles. Enough that resizing a window repaints
// from memory instead of from the network, small enough that a page left open
// all day does not hold every tile it has ever drawn.
const TILE_CACHE_MAX = 128;
const tileCache = new Map();

// Tiles blown up more than this are mush. It happens only on a recording with
// almost no extent, where the finest zoom still cannot fill the plate.
const MAX_TILE_STRETCH = 4;

let basemapOn = readBasemapChoice();
let basemapToken = 0;
let basemapKey = '';

function readBasemapChoice() {
  try {
    return localStorage.getItem(BASEMAP_STORAGE_KEY) !== 'off';
  } catch {
    // A private window, or site data blocked. The map is the default.
    return true;
  }
}

function rememberBasemapChoice(on) {
  try {
    localStorage.setItem(BASEMAP_STORAGE_KEY, on ? 'on' : 'off');
  } catch {
    // Not being able to remember the choice is not worth an error.
  }
}

function tileUrl(tile) {
  return BASEMAP.urlTemplate
    .replace('{z}', tile.z)
    .replace('{x}', tile.x)
    .replace('{y}', tile.y);
}

// Set once OpenStreetMap has told us to stop. It is never cleared: a service
// that has just asked us to go away is the last thing to poll.
let basemapBlocked = false;

/** One tile, or null if it did not arrive. This never rejects: a tile that
 *  fails is a quieter chart, not something to report.
 *
 *  Fetched rather than loaded through an Image, because refusal does not look
 *  like failure here. When OpenStreetMap blocks a client it answers 200 with a
 *  valid PNG, and that PNG is a white square carrying a notice. An Image would
 *  report that as a successful load and the chart would paint white ground
 *  under the track. The refusal is only legible in the headers, and only fetch
 *  can read them. */
function loadTile(url) {
  const pending = tileCache.get(url);
  if (pending) return pending;

  const request = (async () => {
    try {
      // CORS keeps the canvas readable rather than tainted. OpenStreetMap
      // sends access-control-allow-origin, so the headers arrive with it.
      const response = await fetch(url, { mode: 'cors', credentials: 'omit' });
      if (response.headers.has('x-blocked')) {
        basemapBlocked = true;
        return null;
      }
      if (!response.ok) return null;
      return await createImageBitmap(await response.blob());
    } catch {
      // A lost signal, a decode that failed, or a browser without
      // createImageBitmap. All of them mean the same thing to this page.
      return null;
    }
  })();

  if (tileCache.size >= TILE_CACHE_MAX) tileCache.clear();
  tileCache.set(url, request);
  return request.then((image) => {
    // A tile that failed is dropped rather than remembered, so a later frame
    // can try again once the signal is back. A blocked one is kept, because
    // asking again is the behaviour that earned the block.
    if (image === null && !basemapBlocked) tileCache.delete(url);
    return image;
  });
}

/** Back to the drawing on its own, which is exactly what the page was before
 *  the map existed. Bumping the token abandons anything still in the air. */
function hideBasemap() {
  basemapKey = '';
  basemapToken++;
  if (!el.traceMap) return;
  el.traceMap.hidden = true;
  el.traceCredit.hidden = true;
  delete el.traceCanvas.dataset.map;
}

async function paintBasemap() {
  if (!basemapOn || basemapBlocked || !chartData || state.view !== 'report') {
    hideBasemap();
    return;
  }

  const rect = el.traceCanvas.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return;

  const frame = chartData.trace.frame;
  const layer = tileLayer(frame, {
    width: rect.width,
    height: rect.height,
    devicePixelRatio: window.devicePixelRatio,
    maxZoom: BASEMAP.maxZoom,
  });

  if (layer.tileShrink > MAX_TILE_STRETCH) {
    // A recording that barely moved. One tile stretched over the whole plate is
    // worse than no ground at all.
    hideBasemap();
    return;
  }

  // Nothing about the picture moved, so nothing is asked for again. This is
  // what keeps a language switch, a re-render and a run of resize events from
  // going back to the tile server.
  const key = [
    frame.worldX0,
    frame.worldY0,
    frame.unitsPerWorld,
    layer.zoom,
    layer.backing.width,
    layer.backing.height,
  ].join();
  if (key === basemapKey) return;
  basemapKey = key;
  const token = ++basemapToken;

  const images = await Promise.all(layer.tiles.map((tile) => loadTile(tileUrl(tile))));
  // The window moved, the language changed or the map was switched off while
  // these were in the air. Whatever is on screen now belongs to someone else.
  if (token !== basemapToken) return;

  // A frame goes on whole or not at all. A part-covered plate leaves holes
  // under the track, and on this page a hole in the ground is what "the
  // recording is missing here" looks like. It must not be able to mean
  // "a tile did not load".
  if (basemapBlocked || images.some((image) => image === null)) {
    hideBasemap();
    return;
  }

  // Composed off screen, so the visible canvas is never seen half built.
  const buffer = document.createElement('canvas');
  buffer.width = layer.backing.width;
  buffer.height = layer.backing.height;
  const compose = buffer.getContext('2d');
  const target = el.traceMap.getContext('2d');
  // A browser that has run out of canvas memory hands back null. Nothing to
  // draw on is the same outcome as nothing to draw: the chart on its own.
  if (!compose || !target) {
    hideBasemap();
    return;
  }
  layer.tiles.forEach((tile, index) => {
    // Tile rectangles are already in device pixels, so the context is not
    // scaled by the device pixel ratio: doing both would draw at double size.
    compose.drawImage(images[index], tile.left, tile.top, tile.width, tile.height);
  });

  const canvas = el.traceMap;
  // The trace SVG keeps its aspect ratio and is letterboxed inside the canvas.
  // The plate is that same rectangle, so the map cannot sit off register from
  // the track.
  canvas.style.left = `${layer.plate.left}px`;
  canvas.style.top = `${layer.plate.top}px`;
  canvas.style.width = `${layer.plate.width}px`;
  canvas.style.height = `${layer.plate.height}px`;
  canvas.width = layer.backing.width;
  canvas.height = layer.backing.height;
  target.drawImage(buffer, 0, 0);
  canvas.hidden = false;

  // The credit appears only now. Attribution for a map that did not load would
  // be a false statement, and the licence asks for the opposite.
  el.traceCredit.hidden = false;
  el.traceCanvas.dataset.map = 'on';
}

function toggleBasemap() {
  basemapOn = !basemapOn;
  rememberBasemapChoice(basemapOn);
  el.mapToggle.textContent = basemapOn ? t('map.hide') : t('map.show');
  paintBasemap();
}

function readingAt(distanceM) {
  const { track, measurements } = state.result;
  const index = indexAtDistance(measurements.cumulative, distanceM);
  const insideGap =
    measurements.gapExceedsThreshold &&
    Math.abs(measurements.cumulative[index] - measurements.largestGapAtM) <
      measurements.largestGapM / 2;
  const ele = track.points[index].ele;
  const label = insideGap || ele === null
    ? `km ${formatKm(distanceM)} · ${t('chart.noData')}`
    : `km ${formatKm(distanceM)} · ${formatNumber(ele)} m`;
  return { index, label };
}

function showHover(distanceM) {
  if (!state.result || !chartData) return;
  const { track, measurements } = state.result;
  const { index, label } = readingAt(distanceM);

  const traceCursor = el.traceFigure.querySelector('.trace-cursor');
  const point = chartData.trace.coords[index];
  traceCursor.removeAttribute('hidden');
  traceCursor.setAttribute('transform', `translate(${point.x} ${point.y})`);

  const profileCursor = el.profileFigure.querySelector('.profile-cursor');
  const x = chartData.profile.px(index);
  const y = chartData.profile.py(track.points[index].ele ?? measurements.elevationMinM ?? 0);
  profileCursor.removeAttribute('hidden');
  profileCursor.querySelector('line').setAttribute('x1', x);
  profileCursor.querySelector('line').setAttribute('x2', x);
  profileCursor.querySelector('circle').setAttribute('cx', x);
  profileCursor.querySelector('circle').setAttribute('cy', y);

  el.traceFigure.querySelector('.chart-reading').textContent = label;
  el.profileFigure.querySelector('.chart-reading').textContent = label;

  const canvas = el.traceFigure.querySelector('.chart-canvas');
  const { width, height } = canvas.getBoundingClientRect();
  const { w, h } = chartData.trace.viewBox;
  const k = Math.min(width / w, height / h);
  const tooltip = el.traceFigure.querySelector('.chart-tooltip');
  tooltip.hidden = false;
  tooltip.textContent = label;
  tooltip.style.left = `${(width - w * k) / 2 + point.x * k}px`;
  tooltip.style.top = `${(height - h * k) / 2 + point.y * k}px`;
}

function clearHover() {
  if (!state.result) return;
  el.traceFigure.querySelector('.trace-cursor')?.setAttribute('hidden', '');
  el.profileFigure.querySelector('.profile-cursor')?.setAttribute('hidden', '');
  const tooltip = el.traceFigure.querySelector('.chart-tooltip');
  if (tooltip) tooltip.hidden = true;
  for (const figure of [el.traceFigure, el.profileFigure]) {
    figure.querySelector('.chart-reading').textContent = '';
  }
}

function renderFooter() {
  // Three separate facts, in the order the visitor meets them: the file never
  // leaves, the link is fetched by us, and the map is fetched by them. The map
  // sentence is not optional dressing: it is the one request this page makes
  // that our server never sees.
  el.footerProcessing.innerHTML = `<span>${t('footer.processing.file')}</span><span>${t(
    'footer.processing.url',
  )}</span><span>${t('footer.processing.map')}</span>`;
  el.footerSource.textContent = t('footer.source');
}

// -------------------------------------------------------------------- finder
//
// Search and Nearby are two more ways of arriving at a URL, and nothing else.
// A row carries a name, what the source claims about it, and a way to convert
// it; pressing one runs the same conversion the link field runs, and the report
// that follows is the only place on this page a measurement appears. There is
// no ordering, no ranking and no picture here on purpose: those invite
// browsing, and this list is a means, never the destination.

const TAB_STORAGE_KEY = 'route-to-gpx:tab';
const TABS = ['search', 'nearby', 'link'];

// Decided by the owner. Nearby pages cleanly at six and repeats itself above
// that; search pages cleanly at nine.
const SEARCH_PAGE_SIZE = 9;
const NEARBY_PAGE_SIZE = 6;
// A place lookup wants the `places` a search answer already carries, not its
// routes. Not smaller than this: places and routes share one upstream page, so
// too small a page comes back with routes only and no place at all.
const PLACE_PAGE_SIZE = 5;

const RADII_M = [5000, 10000, 20000, 50000, 100000];

// The sites this page can already convert a link from, longest served first.
// Only the first is offered until the service says it can search another.
const KNOWN_SOURCES = [
  { id: 'komoot', label: 'Komoot' },
  { id: 'wikiloc', label: 'Wikiloc' },
];

// Failures a list endpoint can answer with that have a sentence of their own.
// Anything else, including a body this page and the service disagree about,
// reads as the question having gone unanswered, which is what happened.
const LIST_ERRORS = new Set(['busy', 'network', 'query', 'location', 'sport', 'domain']);

const finder = {
  tab: readTab(),
  sources: KNOWN_SOURCES.slice(0, 1),
  sourceId: KNOWN_SOURCES[0].id,
  // One activity list per source, so switching back and forth costs nothing.
  catalogues: new Map(),
  search: {
    query: '',
    sport: '',
    status: 'idle',
    errorKey: null,
    shown: null,
    more: false,
    addedNothing: false,
    asked: 0,
  },
  nearby: {
    lat: '',
    lng: '',
    radiusM: 20000,
    sport: '',
    geo: null,
    status: 'idle',
    errorKey: null,
    shown: null,
    more: false,
    addedNothing: false,
    asked: 0,
  },
  place: { open: false, query: '', status: 'idle', errorKey: null, results: [] },
};

function readTab() {
  try {
    const stored = localStorage.getItem(TAB_STORAGE_KEY);
    if (TABS.includes(stored)) return stored;
  } catch {
    // A private window, or site data blocked. The link field is the default.
  }
  return 'link';
}

function rememberTab(tab) {
  try {
    localStorage.setItem(TAB_STORAGE_KEY, tab);
  } catch {
    // Not being able to remember the choice is not worth an error.
  }
}

const panelState = (mode) => (mode === 'search' ? finder.search : finder.nearby);

function sourceLabel(id) {
  return finder.sources.find((source) => source.id === id)?.label ?? id;
}

/** An activity in the reader's language, or the source's own word for it.
 *
 *  The list comes from the service and belongs to the source site, so it can
 *  hold a word this page has not learned yet. Printing the slug is honest;
 *  guessing at a translation, or dropping the row, would not be. */
function sportLabel(slug) {
  const key = `sport.${slug}`;
  const text = t(key);
  return text === key ? slug : text;
}

// ------------------------------------------------------------ finder service

/** The activity list for one source, read from the service rather than
 *  written down here, because the vocabularies belong to the sites.
 *
 *  The `source` parameter is sent whether or not the service reads it yet. One
 *  that does not answers with the single list it has, which is the right list
 *  for the single source it can search. */
async function loadCatalogue(sourceId) {
  if (finder.catalogues.has(sourceId)) return;

  let payload;
  try {
    const response = await fetch(
      `${API_BASE}/sports?source=${encodeURIComponent(sourceId)}`,
    );
    payload = await response.json();
  } catch {
    // No list is not something to put a panel on screen for: the dropdown
    // waits, and choosing a source asks again.
    return;
  }
  if (!payload || payload.ok !== true) return;

  finder.sources = sourcesFrom(payload, KNOWN_SOURCES);
  const catalogue = catalogueFrom(payload, null);
  if (!catalogue) return;

  finder.catalogues.set(sourceId, catalogue);
  if (sourceId === finder.sourceId) applyCatalogue(catalogue);
  renderFinder();
}

function applyCatalogue(catalogue) {
  finder.search.sport = sportAfterSource(catalogue, finder.search.sport, true);
  finder.nearby.sport = sportAfterSource(catalogue, finder.nearby.sport, true);
}

/** One list, or the key to a sentence saying why there is none. */
async function askList(path, body) {
  let payload;
  try {
    const response = await fetch(`${API_BASE}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    payload = await response.json();
  } catch {
    return { errorKey: 'network' };
  }

  if (!payload || payload.ok !== true || !Array.isArray(payload.results)) {
    const code = payload?.error;
    return { errorKey: LIST_ERRORS.has(code) ? code : 'network' };
  }
  return { listing: payload };
}

/** The service echoes what it actually used, after its own clamping. Reading
 *  that back into the form is what stops a radius the service will not go to
 *  from looking like one it did. */
function adoptEcho(panel, echo) {
  if (!echo) return;
  if (typeof echo.radiusM === 'number') panel.radiusM = echo.radiusM;
  const catalogue = finder.catalogues.get(finder.sourceId);
  if (typeof echo.sport === 'string' && catalogue?.sports.includes(echo.sport)) {
    panel.sport = echo.sport;
  }
}

async function runList(mode, { append = false } = {}) {
  const panel = panelState(mode);
  // Load more asks the SAME question the rows on screen already answer. Reading
  // the form again here is how six routes near Montseny get a second page from
  // wherever the coordinate boxes happen to say by then, and how a count from
  // one question ends up printed under the rows of another.
  const body =
    append && panel.askedBody && panel.shown
      ? { body: { ...panel.askedBody, page: panel.shown.page + 1 } }
      : mode === 'search'
        ? searchBody(panel)
        : nearbyBody(panel);
  if (body.errorKey) {
    // Refused here rather than upstream: a blank query or a latitude that is
    // not a number spends a request to be told what this page already knows.
    panel.errorKey = body.errorKey;
    panel.status = 'error';
    if (!append) panel.shown = null;
    renderFinder();
    return;
  }

  if (append) {
    panel.more = true;
  } else {
    panel.status = 'working';
    panel.errorKey = null;
    panel.shown = null;
    panel.addedNothing = false;
    // The question, frozen at the moment it was asked. Every later page is this
    // with a different page number and nothing else.
    panel.askedBody = { ...body.body };
  }
  // Which question is on screen. An older answer that arrives after a newer
  // one was asked belongs to nobody, the same way an old tile does on the map.
  const token = ++panel.asked;
  renderFinder();

  const { listing, errorKey } = await askList(mode, body.body);
  if (token !== panel.asked) return;
  panel.more = false;

  if (errorKey) {
    panel.errorKey = errorKey;
    panel.status = 'error';
    // The rows already on screen stay: a failed next page is no reason to take
    // away the page that worked.
    renderFinder();
    return;
  }

  adoptEcho(panel, listing.query);
  const before = append && panel.shown ? panel.shown.rows.length : 0;
  panel.shown = appendPage(append ? panel.shown : null, listing);
  // The source can answer a later page with nothing this converter can list,
  // while still saying there is more behind it. Said out loud, because a button
  // that visibly does nothing reads as broken.
  panel.addedNothing = append && panel.shown.rows.length === before;
  panel.errorKey = null;
  panel.status = panel.shown.rows.length === 0 ? 'empty' : 'ready';
  renderFinder();
}

function searchBody(panel) {
  const query = panel.query.trim();
  if (query.length < 2) return { errorKey: 'query' };
  return {
    body: {
      source: finder.sourceId,
      query,
      sport: panel.sport || null,
      near: null,
      limit: SEARCH_PAGE_SIZE,
      page: 0,
    },
  };
}

function nearbyBody(panel) {
  const lat = readCoordinate(panel.lat, 90);
  const lng = readCoordinate(panel.lng, 180);
  if (lat === null || lng === null) return { errorKey: 'location' };
  return {
    body: {
      source: finder.sourceId,
      lat,
      lng,
      sport: panel.sport || null,
      radiusM: panel.radiusM,
      limit: NEARBY_PAGE_SIZE,
      page: 0,
    },
  };
}

/** A typed coordinate, or null when it is not one.
 *
 *  A comma is accepted as the decimal mark: half this page's readers write
 *  42,6417, and rejecting that would be rejecting their own notation. */
function readCoordinate(text, limit) {
  const value = Number(String(text).trim().replace(',', '.'));
  if (!Number.isFinite(value) || String(text).trim() === '') return null;
  return Math.abs(value) <= limit ? value : null;
}

// --------------------------------------------------------------- my location

/** Asked once, on the click, and never on load or on a timer.
 *
 *  A refusal is a choice, not a failure: it is answered with the two ways of
 *  giving a point by hand, in the same quiet voice as everything else. */
function useMyLocation() {
  if (!navigator.geolocation) {
    finder.nearby.geo = 'unavailable';
    renderFinder();
    return;
  }

  finder.nearby.geo = 'asking';
  renderFinder();
  navigator.geolocation.getCurrentPosition(
    (position) => {
      // Four decimals is about eleven metres, which is exact enough for a
      // radius measured in kilometres and shares no more than that.
      finder.nearby.lat = position.coords.latitude.toFixed(4);
      finder.nearby.lng = position.coords.longitude.toFixed(4);
      finder.nearby.geo = 'filled';
      renderFinder();
    },
    (error) => {
      finder.nearby.geo =
        error.code === error.PERMISSION_DENIED ? 'refused' : 'unavailable';
      renderFinder();
    },
    { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 },
  );
}

// ---------------------------------------------------------------- the places

/** Place names come from the search answer this service already sends.
 *
 *  No geocoder is called from the browser, which is why the footer's three
 *  sentences about where requests go are still the whole truth. */
async function findPlaces() {
  const place = finder.place;
  const query = place.query.trim();
  if (query.length < 2) {
    place.status = 'error';
    place.errorKey = 'query';
    place.results = [];
    renderFinder();
    return;
  }

  place.status = 'working';
  place.errorKey = null;
  renderFinder();

  const { listing, errorKey } = await askList('search', {
    source: finder.sourceId,
    query,
    // A place is not narrowed by an activity, so this asks with the source's
    // own default rather than with the form's.
    sport: null,
    limit: PLACE_PAGE_SIZE,
    page: 0,
  });

  if (errorKey) {
    place.status = 'error';
    place.errorKey = errorKey;
    place.results = [];
    renderFinder();
    return;
  }

  place.results = Array.isArray(listing.places) ? listing.places : [];
  place.status = place.results.length === 0 ? 'empty' : 'ready';
  renderFinder();
}

function pickPlace(index) {
  const place = finder.place.results[index];
  if (!place) return;
  finder.nearby.lat = place.lat.toFixed(4);
  finder.nearby.lng = place.lng.toFixed(4);
  finder.nearby.geo = null;
  finder.place.open = false;
  renderFinder();
  el.nearbySubmit.focus();
}

// ------------------------------------------------------------ finder drawing

function chooseTab(tab, focus) {
  finder.tab = tab;
  rememberTab(tab);
  renderFinder();
  if (focus) el.tabButtons.find((button) => button.dataset.tab === tab).focus();
}

function chooseSource(id) {
  if (id === finder.sourceId) return;
  finder.sourceId = id;
  const catalogue = finder.catalogues.get(id);
  if (catalogue) applyCatalogue(catalogue);
  else {
    // Nothing is shown from the old source's vocabulary while the new one is
    // on its way: the two are different lists, not two spellings of one.
    finder.search.sport = '';
    finder.nearby.sport = '';
  }
  renderFinder();
  loadCatalogue(id);
}

/** The field the open tab is about. Nearby has no single one, so focus is left
 *  where the visitor put it. */
function focusActiveField() {
  if (finder.tab === 'link') el.input.focus();
  if (finder.tab === 'search') el.searchQuery.focus();
}

/** Writing a value only when it changed keeps the caret where the visitor is
 *  typing: assigning the same string back can collapse the selection. */
function setValue(input, value) {
  if (input.value !== value) input.value = value;
}

function renderFinder() {
  renderTabs();
  renderSearchForm();
  renderNearbyForm();
  renderPlacePanel();
  renderResults('search');
  renderResults('nearby');
}

function renderTabs() {
  el.tabs.setAttribute('aria-label', t('tabs.label'));
  for (const button of el.tabButtons) {
    const tab = button.dataset.tab;
    const selected = tab === finder.tab;
    button.textContent = t(`tab.${tab}`);
    button.setAttribute('aria-selected', selected ? 'true' : 'false');
    button.tabIndex = selected ? 0 : -1;
    document.getElementById(button.getAttribute('aria-controls')).hidden = !selected;
  }
}

function renderSearchForm() {
  const busy = state.view === 'working';
  el.searchLabel.textContent = t('search.label');
  el.searchQuery.placeholder = t('search.placeholder');
  setValue(el.searchQuery, finder.search.query);
  el.searchQuery.disabled = busy;
  fillSources(el.searchSource, el.searchSourceLabel);
  fillSports(el.searchSport, el.searchSportLabel, finder.search.sport);
  el.searchSource.disabled = busy;
  el.searchSport.disabled = busy || el.searchSport.options.length === 0;
  el.searchSubmit.textContent = t('search.submit');
  el.searchSubmit.disabled = busy || finder.search.status === 'working';
}

function renderNearbyForm() {
  const busy = state.view === 'working';
  el.geoHere.innerHTML = `${icon('crosshair')}<span>${t('nearby.here')}</span>`;
  el.placeOpen.innerHTML = `${icon('search')}<span>${t('nearby.place')}</span>`;
  el.placeOpen.setAttribute('aria-expanded', finder.place.open ? 'true' : 'false');
  el.geoNote.textContent = finder.nearby.geo ? t(`geo.${finder.nearby.geo}`) : '';

  el.nearbyLatLabel.textContent = t('nearby.lat');
  el.nearbyLngLabel.textContent = t('nearby.lng');
  setValue(el.nearbyLat, finder.nearby.lat);
  setValue(el.nearbyLng, finder.nearby.lng);
  el.nearbyRadiusLabel.textContent = t('nearby.radius');

  // The value the service last echoed is offered too, so a radius it clamped
  // shows the number it really used rather than nothing at all.
  const radii = RADII_M.includes(finder.nearby.radiusM)
    ? RADII_M
    : [...RADII_M, finder.nearby.radiusM].sort((a, b) => a - b);
  fillSelect(
    el.nearbyRadius,
    radii.map((metres) => ({
      value: String(metres),
      label: t('nearby.radiusOption', { km: formatNumber(metres / 1000) }),
    })),
    String(finder.nearby.radiusM),
  );

  fillSources(el.nearbySource, el.nearbySourceLabel);
  fillSports(el.nearbySport, el.nearbySportLabel, finder.nearby.sport);
  el.nearbySubmit.textContent = t('nearby.submit');
  for (const control of [
    el.geoHere,
    el.placeOpen,
    el.nearbyLat,
    el.nearbyLng,
    el.nearbyRadius,
    el.nearbySource,
  ]) {
    control.disabled = busy;
  }
  el.nearbySubmit.disabled = busy || finder.nearby.status === 'working';
  el.nearbySport.disabled = busy || el.nearbySport.options.length === 0;
}

function renderPlacePanel() {
  el.placePanel.hidden = !finder.place.open;
  el.placeTitle.textContent = t('place.title');
  el.placeQueryLabel.textContent = t('place.label');
  el.placeQuery.placeholder = t('place.placeholder');
  setValue(el.placeQuery, finder.place.query);
  el.placeFind.innerHTML = `${icon('search')}<span>${t('place.find')}</span>`;
  el.placeClose.textContent = t('place.close');

  const place = finder.place;
  if (place.status === 'working') {
    el.placeOut.innerHTML = `<p class="finder-status" role="status">${icon('active')}<span>${t(
      'place.working',
    )}</span></p>`;
    return;
  }
  if (place.status === 'empty') {
    el.placeOut.innerHTML = `<p class="place-note" role="status">${t('place.empty')}</p>`;
    return;
  }
  if (place.status === 'error') {
    el.placeOut.innerHTML = errorMarkup(place.errorKey);
    return;
  }
  el.placeOut.innerHTML = place.results
    .map(
      // The pair is separated by a dot, not a comma: in Spanish the comma is
      // already the decimal mark, and "41,1310, -3,1721" reads as four numbers.
      (found, index) => `<button class="place-row" type="button" data-place="${index}">
        <span class="row-title">${escapeText(found.name)}</span>
        <span class="row-claim">${formatNumber(found.lat, 4)} · ${formatNumber(found.lng, 4)}</span>
        ${icon('crosshair', 'row-go')}
      </button>`,
    )
    .join('');
}

function fillSources(select, label) {
  label.textContent = t('field.source');
  fillSelect(
    select,
    finder.sources.map((source) => ({ value: source.id, label: source.label })),
    finder.sourceId,
  );
}

function fillSports(select, label, chosen) {
  label.textContent = t('field.activity');
  const catalogue = finder.catalogues.get(finder.sourceId);
  fillSelect(
    select,
    (catalogue?.sports ?? []).map((sport) => ({ value: sport, label: sportLabel(sport) })),
    chosen,
  );
}

function fillSelect(select, options, value) {
  select.innerHTML = options
    .map(
      (option) =>
        `<option value="${escapeText(option.value)}">${escapeText(option.label)}</option>`,
    )
    .join('');
  select.value = value;
}

/** Puts focus back after Load more redrew the list.
 *
 *  The replacement button when there is one, the first row that was appended
 *  when there is not, so the visitor lands on what they asked for either way. */
function restoreMoreFocus(mode) {
  const out = mode === 'search' ? el.searchOut : el.nearbyOut;
  const again = out.querySelector('[data-more]:not([disabled])');
  if (again) {
    again.focus();
    return;
  }
  const rows = out.querySelectorAll('.row');
  if (rows.length) rows[rows.length - 1].focus();
}


function renderResults(mode) {
  const panel = panelState(mode);
  const out = mode === 'search' ? el.searchOut : el.nearbyOut;
  const shown = panel.shown;
  const source = shown?.source || sourceLabel(finder.sourceId);
  const parts = [];

  if (panel.status === 'working') {
    parts.push(`<p class="finder-status" role="status">${icon('active')}<span>${t(
      `finder.working.${mode}`,
      { source },
    )}</span></p>`);
  }

  if (shown && shown.rows.length > 0) {
    parts.push(`<div class="results">${shown.rows.map(rowMarkup).join('')}</div>`);

    const count =
      shown.totalKnown === null
        ? ''
        : // The total is the source's count, not ours, so it carries the
          // source's name like every other figure this page repeats.
          `<span class="more-count">${t('finder.count', {
            source,
            shown: formatNumber(shown.rows.length),
            total: formatNumber(shown.totalKnown),
          })}</span>`;
    const more = shown.hasMore
      ? `<button class="ghost-button" type="button" data-more="${mode}"${
          panel.more ? ' disabled' : ''
        }>${panel.more ? t('finder.moreWorking') : t('finder.more')}</button>`
      : '';
    if (more || count) parts.push(`<div class="more-row">${more}${count}</div>`);
    if (panel.addedNothing) parts.push(`<p class="more-note">${t('finder.moreEmpty')}</p>`);

    if (shown.dropped > 0) {
      const key = shown.dropped === 1 ? 'finder.dropped.one' : 'finder.dropped.many';
      parts.push(
        `<p class="dropped-note">${t(key, {
          source,
          count: formatNumber(shown.dropped),
        })}</p>`,
      );
    }
  }

  if (panel.status === 'empty') {
    parts.push(`<div class="finder-empty" role="status">
        <h2>${t(`empty.${mode}.title`)}</h2>
        <p>${t(`empty.${mode}.body`)}</p>
      </div>`);
  }
  if (panel.status === 'error') parts.push(errorMarkup(panel.errorKey));

  out.innerHTML = parts.join('');
  out.setAttribute('aria-busy', panel.status === 'working' ? 'true' : 'false');
}

/** One row: a name, what the source claims, and a way to convert it. */
function rowMarkup(row, index) {
  const claim = claimSentence(row.published, {
    source: row.publishedBy || sourceLabel(finder.sourceId),
    t,
    // One decimal on a row, two in the report. A row only has to be enough to
    // recognise the route by; the report is the measurement.
    km: (metres) => formatKm(metres, 1),
    metres: (value) => formatNumber(value),
    joinList,
  });
  // Only when it is not the activity that was asked for. On Komoot the filter
  // is real, so every row would repeat the word the visitor just chose, six
  // times down the screen. On Wikiloc there is no filter to trust, so the word
  // is the only thing telling a walker that row four is a via ferrata.
  const asked = panelState(finder.tab === 'nearby' ? 'nearby' : 'search').sport;
  const sport =
    row.sport && row.sport !== asked
      ? `<span class="row-sport">${escapeText(sportLabel(row.sport))}</span>`
      : '';
  return `<button class="row" type="button" data-index="${index}"${
    state.view === 'working' ? ' disabled' : ''
  }>
      <span class="row-title">${escapeText(row.title)}</span>
      ${sport}
      <span class="row-claim">${escapeText(claim)}</span>
      ${icon('link', 'row-go')}
    </button>`;
}

function errorMarkup(key) {
  return `<div class="panel-warn finder-error" role="alert">
      ${icon('warning', 'icon-warning')}
      <div>
        <h2>${t(`error.${key}.title`)}</h2>
        <p>${t(`error.${key}.body`)}</p>
      </div>
    </div>`;
}

// -------------------------------------------------------------------- wiring

function collect() {
  el.root = document.getElementById('app');
  el.stepOne = document.getElementById('step-one');
  el.skip = document.querySelector('.skip-link');
  el.langButton = document.getElementById('lang-toggle');
  el.heading = document.getElementById('step1-heading');
  el.subLink = document.getElementById('sub-link');
  el.subSearch = document.getElementById('sub-search');
  el.subNearby = document.getElementById('sub-nearby');
  el.fieldPrefix = document.querySelector('.field-prefix');
  el.input = document.getElementById('route-url');
  el.pasteButton = document.getElementById('paste');
  el.convertButton = document.getElementById('convert');
  el.hint = document.getElementById('step1-hint');
  el.exampleButton = document.getElementById('example');
  el.dropNote = document.querySelector('.drop-note');

  el.tabs = document.getElementById('tabs');
  el.tabButtons = [...el.tabs.querySelectorAll('[role="tab"]')];
  const labelFor = (id) => document.querySelector(`label[for="${id}"]`);

  el.searchQuery = document.getElementById('search-query');
  el.searchLabel = labelFor('search-query');
  el.searchSource = document.getElementById('search-source');
  el.searchSourceLabel = labelFor('search-source');
  el.searchSport = document.getElementById('search-sport');
  el.searchSportLabel = labelFor('search-sport');
  el.searchSubmit = document.getElementById('search-submit');
  el.searchForm = document.getElementById('search-form');
  el.searchOut = document.getElementById('search-out');

  el.geoHere = document.getElementById('geo-here');
  el.geoNote = document.getElementById('geo-note');
  el.placeOpen = document.getElementById('place-open');
  el.placePanel = document.getElementById('place-panel');
  el.placeTitle = document.getElementById('place-title');
  el.placeQuery = document.getElementById('place-query');
  el.placeQueryLabel = labelFor('place-query');
  el.placeFind = document.getElementById('place-find');
  el.placeClose = document.getElementById('place-close');
  el.placeOut = document.getElementById('place-out');

  el.nearbyLat = document.getElementById('nearby-lat');
  el.nearbyLatLabel = labelFor('nearby-lat');
  el.nearbyLng = document.getElementById('nearby-lng');
  el.nearbyLngLabel = labelFor('nearby-lng');
  el.nearbyRadius = document.getElementById('nearby-radius');
  el.nearbyRadiusLabel = labelFor('nearby-radius');
  el.nearbySource = document.getElementById('nearby-source');
  el.nearbySourceLabel = labelFor('nearby-source');
  el.nearbySport = document.getElementById('nearby-sport');
  el.nearbySportLabel = labelFor('nearby-sport');
  el.nearbySubmit = document.getElementById('nearby-submit');
  el.nearbyForm = document.getElementById('nearby-form');
  el.nearbyOut = document.getElementById('nearby-out');

  el.progress = document.getElementById('progress');
  el.error = document.getElementById('error');
  el.report = document.getElementById('report');
  el.reportTitle = document.getElementById('report-title');
  el.reportSource = document.getElementById('report-source');
  el.downloadButton = document.getElementById('download');
  el.resetButton = document.getElementById('reset');
  el.tiles = document.getElementById('tiles');
  el.traceFigure = document.getElementById('trace');
  el.profileFigure = document.getElementById('profile');
  el.traceCanvas = el.traceFigure.querySelector('.chart-canvas');
  el.traceMap = el.traceFigure.querySelector('.chart-map');
  el.traceCredit = el.traceFigure.querySelector('.chart-attribution');
  el.mapToggle = document.getElementById('map-toggle');
  el.axisX = el.profileFigure.querySelector('.axis-x');
  el.axisY = el.profileFigure.querySelector('.axis-y');
  el.warning = document.getElementById('warning');
  el.secondary = document.getElementById('secondary');
  el.provenance = document.getElementById('provenance');
  el.footerProcessing = document.getElementById('footer-processing');
  el.footerSource = document.getElementById('footer-source');
}

function submit() {
  const value = el.input.value.trim();
  if (!value) return;
  convertFromUrl(value);
}

function wire() {
  el.langButton.addEventListener('click', () => {
    state.lang = state.lang === 'en' ? 'es' : 'en';
    rememberLanguage(state.lang);
    render();
    if (state.view === 'report') {
      renderCharts();
      // The hover reading is a sentence in the old language. Drop it rather
      // than leave half the page translated.
      clearHover();
    }
  });

  el.convertButton.addEventListener('click', submit);
  el.input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      submit();
    }
  });

  el.pasteButton.addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) el.input.value = text.trim();
    } catch {
      // Clipboard permission refused or unsupported. Focusing the field is the
      // useful fallback: the visitor pastes it themselves.
    }
    el.input.focus();
  });

  el.exampleButton.addEventListener('click', () => {
    el.input.value = EXAMPLE_URL;
    submit();
  });

  el.downloadButton.addEventListener('click', () => {
    const { gpxText, fileName } = state.result;
    const url = URL.createObjectURL(new Blob([gpxText], { type: 'application/gpx+xml' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    URL.revokeObjectURL(url);
  });

  el.resetButton.addEventListener('click', () => {
    el.input.value = '';
    reset();
    // Back to the tab the visitor came from, with the rows they were looking
    // at still on it. Losing a page of results because you opened one of them
    // is the kind of thing that makes a tool annoying.
    focusActiveField();
  });

  // Drag and drop anywhere on the page.
  let dragDepth = 0;
  document.addEventListener('dragenter', (event) => {
    if (![...event.dataTransfer.types].includes('Files')) return;
    dragDepth++;
    el.root.dataset.dragging = 'true';
  });
  document.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) delete el.root.dataset.dragging;
  });
  document.addEventListener('dragover', (event) => event.preventDefault());
  document.addEventListener('drop', (event) => {
    event.preventDefault();
    dragDepth = 0;
    delete el.root.dataset.dragging;
    const file = event.dataTransfer.files[0];
    if (file) convertFromFile(file);
  });

  wireChartPointer(el.profileFigure, (event, rect) => {
    const fraction = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    return fraction * state.result.measurements.distanceM;
  });

  wireChartPointer(el.traceFigure, (event, rect) => {
    const { w, h } = chartData.trace.viewBox;
    const k = Math.min(rect.width / w, rect.height / h);
    const x = (event.clientX - rect.left - (rect.width - w * k) / 2) / k;
    const y = (event.clientY - rect.top - (rect.height - h * k) / 2) / k;
    return nearestOnTrace(
      chartData.trace.coords,
      state.result.measurements.cumulative,
      x,
      y,
    ).distanceM;
  });

  el.mapToggle.addEventListener('click', toggleBasemap);

  let redrawTimer = 0;
  window.addEventListener('resize', () => {
    if (state.view !== 'report') return;
    // The label is anchored to a point on the drawing, so it moves with it,
    // immediately. The map is a full repaint of a canvas, so it waits until the
    // window has stopped moving.
    positionGapLabel();
    clearTimeout(redrawTimer);
    redrawTimer = setTimeout(paintBasemap, 180);
  });

  // The axis label positions are percentages and need no help on resize. Only
  // the number of ticks changes at the breakpoint, so the charts are rebuilt
  // when it flips and not otherwise.
  compactQuery.addEventListener('change', (event) => {
    compactCharts = event.matches;
    if (state.view !== 'report') return;
    renderCharts();
    // The redrawn SVGs have no cursors in them, so the reading beside the title
    // would be left describing a point nothing is pointing at.
    clearHover();
  });
}

function wireFinder() {
  // The one drawn arrow both dropdowns use, added once rather than on every
  // render: the native one differs on every platform and none of them is this
  // page's stroke.
  for (const shell of document.querySelectorAll('.select-shell')) {
    shell.insertAdjacentHTML('beforeend', icon('chevron'));
  }

  for (const button of el.tabButtons) {
    button.addEventListener('click', () => chooseTab(button.dataset.tab, false));
  }

  el.tabs.addEventListener('keydown', (event) => {
    const here = el.tabButtons.findIndex((button) => button.dataset.tab === finder.tab);
    const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
    let next = null;
    if (step !== undefined) next = (here + step + el.tabButtons.length) % el.tabButtons.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = el.tabButtons.length - 1;
    if (next === null) return;
    event.preventDefault();
    chooseTab(el.tabButtons[next].dataset.tab, true);
  });

  el.searchForm.addEventListener('submit', (event) => {
    event.preventDefault();
    runList('search');
  });
  el.searchQuery.addEventListener('input', () => {
    finder.search.query = el.searchQuery.value;
  });
  // Return runs the search itself rather than leaving it to the form's own
  // handling of the key, which is the same thing the link field does and the
  // only version that behaves the same in every browser. The default is
  // cancelled, so the search runs once and not twice.
  el.searchQuery.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    runList('search');
  });
  el.searchSport.addEventListener('change', () => {
    finder.search.sport = el.searchSport.value;
  });

  el.nearbyForm.addEventListener('submit', (event) => {
    event.preventDefault();
    runList('nearby');
  });
  for (const field of [el.nearbyLat, el.nearbyLng]) {
    field.addEventListener('input', () => {
      finder.nearby.lat = el.nearbyLat.value;
      finder.nearby.lng = el.nearbyLng.value;
    });
    field.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      runList('nearby');
    });
  }
  el.nearbyRadius.addEventListener('change', () => {
    finder.nearby.radiusM = Number(el.nearbyRadius.value);
  });
  el.nearbySport.addEventListener('change', () => {
    finder.nearby.sport = el.nearbySport.value;
  });

  for (const select of [el.searchSource, el.nearbySource]) {
    select.addEventListener('change', () => chooseSource(select.value));
  }

  el.geoHere.addEventListener('click', useMyLocation);

  el.placeOpen.addEventListener('click', () => {
    finder.place.open = !finder.place.open;
    renderFinder();
    if (finder.place.open) el.placeQuery.focus();
  });
  el.placeClose.addEventListener('click', () => {
    finder.place.open = false;
    renderFinder();
    el.placeOpen.focus();
  });
  el.placeFind.addEventListener('click', findPlaces);
  el.placeQuery.addEventListener('input', () => {
    finder.place.query = el.placeQuery.value;
  });
  el.placeQuery.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    findPlaces();
  });
  el.placeOut.addEventListener('click', (event) => {
    const chosen = event.target.closest('[data-place]');
    if (chosen) pickPlace(Number(chosen.dataset.place));
  });

  // One listener per list rather than one per row: the rows are rewritten
  // whenever the language or the page changes.
  for (const mode of ['search', 'nearby']) {
    const out = mode === 'search' ? el.searchOut : el.nearbyOut;
    out.addEventListener('click', (event) => {
      if (event.target.closest('[data-more]')) {
        // The list is redrawn wholesale, so the button that was just pressed
        // stops existing. Without this a keyboard visitor is dropped at the top
        // of the document and has to tab past everything to reach the rows they
        // just asked for.
        runList(mode, { append: true }).then(() => restoreMoreFocus(mode));
        return;
      }
      const pressed = event.target.closest('.row');
      if (!pressed) return;
      const row = panelState(mode).shown?.rows[Number(pressed.dataset.index)];
      // The whole point of the list: the row is a URL, and a URL goes through
      // the conversion the link field already runs.
      if (row) convertFromUrl(row.url);
    });
  }
}

function wireChartPointer(figure, toDistance) {
  const canvas = figure.querySelector('.chart-canvas');
  const move = (event) => {
    if (!state.result || !chartData) return;
    showHover(toDistance(event, canvas.getBoundingClientRect()));
  };
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerdown', move);
  canvas.addEventListener('pointerleave', clearHover);
}

collect();
wire();
wireFinder();
render();
focusActiveField();
// The activity list belongs to the source site, so it is asked for rather than
// written down here.
loadCatalogue(finder.sourceId);
