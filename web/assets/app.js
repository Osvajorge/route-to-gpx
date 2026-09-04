import {
  activityWord,
  cardFigures,
  cardTrace,
  shapeSlot,
  shapeSvg,
  durationParts,
  sourceOwnWord,
  wording,
  starPortion,
  updatedMonth,
} from './cards.js';
import {
  activityChoices,
  appendPage,
  catalogueFrom,
  claimSentence,
  nearbyRequest,
  placeAtPoint,
  placeChoices,
  pointHonoured,
  samePoint,
  searchRequest,
  sourceChosen,
  sourcesMissing,
  sourcesOffered,
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
  fitFrame,
  indexAtDistance,
  nearestOnTrace,
  projectInFrame,
  renderProfile,
  renderTrace,
  tileLayer,
} from './charts.js';
import { closeDialog, dialogIsOpen, openDialog } from './modal.js';
import {
  arrange,
  changedFileName,
  countTimes,
  LOOP_CEILING_M,
  LOOP_FLOOR_M,
  loopCheck,
  ringLength,
} from './rotate.js';

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

/** A month named in the reader's language, from the year and month numbers
 *  `updatedMonth` worked out.
 *
 *  Built in UTC and read back in UTC, so a route changed on the first of the
 *  month does not slide into the one before for a reader west of Greenwich. */
function formatMonth({ year, month }) {
  return new Intl.DateTimeFormat(state.lang === 'es' ? 'es-ES' : 'en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, 1)));
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

/** Takes the link field's error panel down when work starts somewhere else.
 *
 *  The panel belongs to step one, which every tab shares, so without this a
 *  refused link keeps a live `role="alert"` under a search that worked: two
 *  failures on screen at once, one of them about a URL nobody is looking at
 *  any more. */
function clearRouteError() {
  if (state.view !== 'error') return;
  state.errorKey = null;
  setView('idle');
}

/** Fetches one link, rebuilds the track and measures it. Hands back the
 *  result, or null when something went wrong and the error panel is already
 *  saying what.
 *
 *  Where the result ends up is the caller's business: the link field puts it on
 *  the report, and a card puts it in a dialog without moving the list. */
async function convertRoute(url) {
  const source = classifyLink(url);
  if (!source || source.id === 'file') {
    fail('domain');
    return null;
  }

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
    fail('network');
    return null;
  }

  if (!payload || payload.ok !== true) {
    fail(errorKeyFor(payload));
    return null;
  }

  setStage(2);
  await yieldToPaint();

  let track;
  try {
    track = parseGpx(payload.gpx);
  } catch {
    fail('track');
    return null;
  }

  setStage(3);
  await yieldToPaint();

  return makeResult({
    track,
    gpxText: payload.gpx,
    published: payload.published ?? null,
    source: payload.source,
    fileName: payload.fileName || 'route.gpx',
  });
}

async function convertFromUrl(url) {
  const result = await convertRoute(url);
  if (result) showReport(result);
}

/** A card asked for a dialog. Same conversion, but the list stays where it was:
 *  pressing map on the fourth of nine routes and finding the other eight gone
 *  is what makes a list not worth using. */
async function convertForDialog(url, open, opener) {
  const result = await convertRoute(url);
  if (!result) return;
  setView('idle');
  open(result, opener);
}

/** The file, handed to the browser. One place, because two buttons ask for it:
 *  the one on the report and the one on every card. */
function handOverFile(text, fileName) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/gpx+xml' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function downloadResult() {
  if (!state.result) return;
  handOverFile(state.result.gpxText, state.result.fileName);
}

/** What a card's GPX button does: the same conversion the link field runs, and
 *  then the file.
 *
 *  It is not a link to the source's own export, and that is the point. The file
 *  that arrives is the one this page rebuilt, so it carries the provenance link
 *  in its metadata, and the report it came from is left on screen with the
 *  measurement beside the source's claim.
 *
 *  A conversion takes a second or two, and a browser may by then have decided
 *  the click that started it is too old to hand over a file without asking. If
 *  it does, the report is already open with its own Download button on it, so
 *  the file is one press away rather than lost. */
async function convertAndDownload(url) {
  await convertFromUrl(url);
  if (state.view === 'report') downloadResult();
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
  showReport(makeResult({
    track,
    gpxText: text,
    published: null,
    // The label is looked up when the report is drawn, not stamped here, so a
    // language switch reaches it like every other string on the page.
    source: { id: 'file', title: track.name || base, url: null },
    fileName: `${base}-checked.gpx`,
  }));
}

/** One converted route: the track, our measurement of it, the file we would
 *  hand over, and where it came from.
 *
 *  The report holds one of these and so does each dialog, separately. A dialog
 *  opened from a card must never read the report's: the two can be different
 *  routes at the same moment. */
function makeResult({ track, gpxText, published, source, fileName }) {
  const measurements = measure(track, DEFAULT_GAP_THRESHOLD_M);
  const rebuilt = source.url ? buildGpx(track, source) : gpxText;
  return {
    track,
    measurements,
    published,
    source,
    fileName,
    gpxText: rebuilt,
    sizeBytes: new Blob([rebuilt]).size,
  };
}

function showReport(result) {
  state.result = result;
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
  hideBasemap(surfaces.trace);
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
  renderDialogs();
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
  // The alert below names the fault; this says which control it is about, for a
  // reader who scrolled, and for a screen reader, which otherwise hears the
  // alert and never learns what it belongs to. A dropped file is excluded: that
  // failure is not the field's.
  const linkFailed = state.view === 'error' && state.errorKey !== 'file';
  el.input.setAttribute('aria-invalid', String(linkFailed));
  if (linkFailed) el.input.setAttribute('aria-describedby', 'error');
  else el.input.removeAttribute('aria-describedby');
  el.field.classList.toggle('is-invalid', linkFailed);
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
  el.reportAdjust.innerHTML = icon('sliders');
  el.reportAdjust.title = t('card.adjust');
  el.reportAdjust.setAttribute('aria-label', t('card.adjust'));
  el.resetButton.innerHTML = `${icon('back')}<span>${t('step2.reset')}</span>`;

  el.tiles.innerHTML = measuredTiles(measurements, published);
  renderMethod(measurements);

  renderCharts();

  el.warning.hidden = !warn;
  if (warn) el.warning.innerHTML = gapWarningMarkup(measurements);

  const elevation =
    measurements.elevationMinM === null
      ? '-'
      : `${formatNumber(measurements.elevationMinM)}-${formatNumber(measurements.elevationMaxM)} m`;
  el.secondary.innerHTML = `
    ${descentRow(measurements)}
    ${measureRow(t('measure.rawAscent'), `${formatNumber(measurements.rawAscentM)} m`)}
    ${measureRow(t('measure.points'), formatNumber(measurements.pointCount))}
    ${measureRow(t('measure.spacing'), `${formatNumber(measurements.meanSpacingM, 1)} m`)}
    ${measureRow(t('measure.elevation'), elevation)}`;

  // A converted link is rebuilt here, so the link goes into the file and the
  // sentence is about that. A dropped file is handed back exactly as it
  // arrived: nothing is written into it, and there is no original link to
  // write. The sentence about provenance would be false precisely where there
  // is no provenance to keep, so the other one is said instead.
  el.provenance.innerHTML = `${
    source.url ? t('provenance') : t('provenance.none')
  }<br><span class="provenance-file">${t('provenance.file', {
    name: fileName,
    size: formatBytes(sizeBytes),
  })}</span>`;
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

/** Descent. Measured all along and shown nowhere, which is what made the
 *  re-arranger look like it changed a measurement it had not: reversing a route
 *  swaps ascent and descent exactly, so a reader who reversed saw the ascent
 *  jump by 60 m with no way to see it was the descent they were never shown.
 *
 *  A row and not a fourth tile. The tiles are the three figures a reader came
 *  for; this is the one that explains one of them, which is what the table
 *  under them is for. It is in the re-arranger too, because that is where the
 *  swap happens and the report is not on screen while that dialog is open. */
function descentRow(measurements) {
  return measureRow(t('measure.descent'), `${formatNumber(measurements.descentM)} m`);
}

/** The three headline figures, ours, with the source's own beside each where
 *  the source published one. Written once and used on the report and in the
 *  preview dialog, so the two can never drift into saying different things
 *  about the same file. */
function measuredTiles(measurements, published) {
  const warn = measurements.gapExceedsThreshold;
  return `
    ${tile(
      t('measure.distance'),
      formatKm(measurements.distanceM),
      'km',
      distanceNote(comparison(measurements.distanceM, published?.distanceM ?? null, 'km', 2), measurements),
      false,
    )}
    ${tile(
      t('measure.ascent'),
      formatNumber(measurements.ascentM),
      'm',
      ascentNote(comparison(measurements.ascentM, published?.ascentM ?? null, 'm', 0), measurements),
      false,
    )}
    ${tile(t('measure.gap'), formatNumber(measurements.largestGapM), 'm', gapNote(measurements), warn)}`;
}

/** The distance tile's note, whatever else that note is already saying.
 *
 *  THE RULE THIS SOLVES. Distance is a haversine sum over consecutive points,
 *  so the straight chord across a gap is counted as walked. The tile beside it
 *  was calling that chord untracked ground in the same breath, and nothing
 *  joined the two: an intact recording and the same one with a 910 m hole in it
 *  both printed 14.017 km, and the note could still say the figure "matches"
 *  the source.
 *
 *  The figure is the total of every gap over the threshold, not the largest.
 *  What the distance absorbed is a sum, so the honest disclosure is that sum:
 *  on a three hole file the largest gap was 1 091 m and the straight ground was
 *  2 731 m, so printing the largest would have understated the borrowed
 *  distance by two and a half times. */
function distanceNote(against, measurements) {
  // Below the threshold there is no gap to have absorbed. Every recording has
  // chords between its points; the ones this page calls gaps are the ones this
  // line is about.
  if (measurements.gapTotalM <= 0) return against;
  const gaps = t('measure.distance.gaps', { gaps: metresOrKm(measurements.gapTotalM) });
  return `${against} <span class="tile-note-param">${gaps}</span>`;
}

/** The ascent tile's note, whatever else that note is already saying.
 *
 *  THE RULE THIS SOLVES. Ascent is the output of three parameters and the row
 *  showed none of them, beside a gap figure in the same skin printing its one.
 *  So the row explained the number that needed it least and hid the reason
 *  behind the number a reader can watch disagree with the source by a fifth.
 *
 *  The step is the parameter that moves the figure, so it is the one that goes
 *  in the note. The median window and the noise floor are in the fold under
 *  the tiles: three lines here would be three lines on every card-sized tile
 *  on a phone, and the reason is worth a click, not a paragraph. */
function ascentNote(against, measurements) {
  // A line of its own rather than a clause after a second dot. At 375 this note
  // is 19 characters wide, so a run-on wrapped mid-figure and left the unit
  // stranded on a line by itself.
  const lines = [];

  // A recording with no heights was never sampled, so saying at what step it
  // was would be this page inventing a parameter to look thorough.
  if (hasProfile(measurements)) {
    lines.push(t('measure.ascent.step', { step: formatNumber(measurements.sampleStepM, 1) }));
  }

  // The input that moves this figure most, and only on the recordings where it
  // is moving it. A profile built from half the points is built from half the
  // route, and the ascent came out 47% low; the step on the line above moves
  // the same figure by 1.6%. On nearly every recording this line stays off,
  // coverage is 100%, and saying so would be a line nobody needs.
  //
  // It survives the guard above on purpose. At zero coverage the figure over it
  // is a plain zero, and this is the whole difference between a flat route and
  // a file with no heights in it at all.
  if (measurements.elevationCoverageLow) {
    lines.push(
      t('measure.ascent.coverage', {
        // Rounded down, never up: a disclosure about missing data must not
        // round its way back to the full figure it is warning about.
        coverage: formatNumber(Math.floor(100 * measurements.elevationCoverage)),
      }),
    );
  }

  if (lines.length === 0) return against;
  return `${against} ${lines
    .map((line) => `<span class="tile-note-param">${line}</span>`)
    .join('')}`;
}

/** The fold. Written from the measurements rather than from constants, so a
 *  parameter that changes in measure.js cannot leave a wrong number on screen. */
function renderMethod(measurements) {
  // Nothing to disclose about a profile that does not exist.
  el.method.hidden = !hasProfile(measurements);
  if (el.method.hidden) return;
  el.methodSummary.innerHTML = `${icon('chevron', 'method-mark')}<span>${t(
    'method.summary',
  )}</span>`;
  el.methodSampling.textContent = t('method.sampling', {
    step: formatNumber(measurements.sampleStepM, 1),
    window: formatNumber(measurements.medianWindow),
    noise: formatNumber(measurements.ascentNoiseM),
  });
}

/** Whether there is a height profile to have measured an ascent from. Two
 *  points is the fewest that can carry a rise between them. */
function hasProfile(measurements) {
  return measurements.pointsWithElevation >= 2;
}

function gapNote(measurements) {
  return measurements.gapExceedsThreshold
    ? `${t('gap.at', { km: formatKm(measurements.largestGapAtM, 1) })} · ${t('gap.threshold', {
        threshold: measurements.gapThresholdM,
      })}`
    : t('gap.none', { threshold: measurements.gapThresholdM });
}

function gapWarningMarkup(measurements) {
  return `${icon('warning', 'icon-warning')}<p>${t('warning.gap', {
    gap: formatNumber(measurements.largestGapM),
    km: formatKm(measurements.largestGapAtM, 1),
  })}</p>`;
}

// --------------------------------------------------------------------- charts

// Three figures on this page draw a route trace, and they are the same
// drawing: the report's, the preview dialog's, and the re-arranger's. Each one
// gets a surface, which is the figure plus what it last drew and what it has in
// flight. They are kept apart because a dialog opening over the report must not
// be able to cancel the report's own map halfway through painting it.
let chartData = null;
const surfaces = {};

// Only the tick counts differ across the breakpoint, so this is read once and
// the charts are rebuilt when it actually flips, not on every resize event.
const compactQuery = window.matchMedia('(max-width: 640px)');
let compactCharts = compactQuery.matches;

function chartSurface(figure) {
  return {
    figure,
    canvas: figure.querySelector('.chart-canvas'),
    svg: figure.querySelector('.chart-svg'),
    map: figure.querySelector('.chart-map'),
    credit: figure.querySelector('.chart-attribution'),
    gapLabel: figure.querySelector('.gap-label'),
    toggle: figure.querySelector('[data-map-toggle]'),
    drawn: null,
    measurements: null,
    key: '',
    token: 0,
  };
}

/** Whether something is actually on the screen. A closed dialog is still in the
 *  document, and so is the report while the list is showing, so asking the
 *  element itself is the only reliable question. */
function onScreen(node) {
  return node.offsetParent !== null;
}

function liveTraceSurfaces() {
  return [surfaces.trace, surfaces.preview, surfaces.rotate].filter((surface) =>
    onScreen(surface.figure),
  );
}

/** One trace, drawn into one figure, with the ground under it. */
function drawTrace(surface, points, measurements) {
  const drawn = renderTrace(points, measurements, t);
  surface.drawn = drawn;
  surface.measurements = measurements;
  surface.svg.innerHTML = drawn.svg;
  surface.figure.querySelector('.chart-title').textContent = t('chart.trace');
  surface.figure.querySelector('.chart-caption').innerHTML = measurements.gapExceedsThreshold
    ? `<span>${t('chart.start')}</span><span class="caption-warn">${icon('warning')}${t(
        'chart.gapDrawn',
      )}</span>`
    : `<span>${t('chart.start')}</span>`;
  if (surface.toggle) surface.toggle.textContent = basemapOn ? t('map.hide') : t('map.show');
  surface.credit.innerHTML = t('map.attribution');
  positionGapLabel(surface);
  paintBasemap(surface);
  return drawn;
}

function drawProfile(figure, points, measurements) {
  const profile = renderProfile(points, measurements, t, { compact: compactCharts });
  figure.querySelector('.chart-title').textContent = t('chart.profile');
  figure.querySelector('.chart-svg').innerHTML = profile.svg;
  renderAxes(figure, profile.axis, measurements);
  return profile;
}

function renderCharts() {
  const { track, measurements } = state.result;
  chartData = {
    trace: drawTrace(surfaces.trace, track.points, measurements),
    profile: drawProfile(el.profileFigure, track.points, measurements),
  };
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
function renderAxes(figure, axis, measurements) {
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
  figure.querySelector('.axis-x').innerHTML = marks.join('');

  figure.querySelector('.axis-y').innerHTML = axis.y
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
function positionGapLabel(surface) {
  const label = surface.gapLabel;
  const measurements = surface.measurements;
  const drawn = surface.drawn;
  if (!label || !drawn) return;
  if (!measurements?.gapExceedsThreshold || !drawn.gapAnchor) {
    label.hidden = true;
    return;
  }
  const { width, height } = surface.canvas.getBoundingClientRect();
  const { w, h } = drawn.viewBox;
  const k = Math.min(width / w, height / h);
  const left = (width - w * k) / 2 + drawn.gapAnchor.x * k;
  const top = (height - h * k) / 2 + drawn.gapAnchor.y * k;

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
function hideBasemap(surface) {
  if (!surface) return;
  surface.key = '';
  surface.token++;
  if (!surface.map) return;
  surface.map.hidden = true;
  surface.credit.hidden = true;
  delete surface.canvas.dataset.map;
}

async function paintBasemap(surface) {
  const frame = surface?.drawn?.frame;
  if (!basemapOn || basemapBlocked || !frame || !onScreen(surface.figure)) {
    hideBasemap(surface);
    return;
  }

  const rect = surface.canvas.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return;

  const layer = tileLayer(frame, {
    width: rect.width,
    height: rect.height,
    devicePixelRatio: window.devicePixelRatio,
    maxZoom: BASEMAP.maxZoom,
  });

  if (layer.tileShrink > MAX_TILE_STRETCH) {
    // A recording that barely moved. One tile stretched over the whole plate is
    // worse than no ground at all.
    hideBasemap(surface);
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
  if (key === surface.key) return;
  surface.key = key;
  const token = ++surface.token;

  const images = await Promise.all(layer.tiles.map((tile) => loadTile(tileUrl(tile))));
  // The window moved, the language changed or the map was switched off while
  // these were in the air. Whatever is on screen now belongs to someone else.
  if (token !== surface.token) return;

  // A frame goes on whole or not at all. A part-covered plate leaves holes
  // under the track, and on this page a hole in the ground is what "the
  // recording is missing here" looks like. It must not be able to mean
  // "a tile did not load".
  if (basemapBlocked || images.some((image) => image === null)) {
    hideBasemap(surface);
    return;
  }

  // Composed off screen, so the visible canvas is never seen half built.
  const buffer = document.createElement('canvas');
  buffer.width = layer.backing.width;
  buffer.height = layer.backing.height;
  const compose = buffer.getContext('2d');
  const target = surface.map.getContext('2d');
  // A browser that has run out of canvas memory hands back null. Nothing to
  // draw on is the same outcome as nothing to draw: the chart on its own.
  if (!compose || !target) {
    hideBasemap(surface);
    return;
  }
  layer.tiles.forEach((tile, index) => {
    // Tile rectangles are already in device pixels, so the context is not
    // scaled by the device pixel ratio: doing both would draw at double size.
    compose.drawImage(images[index], tile.left, tile.top, tile.width, tile.height);
  });

  const canvas = surface.map;
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
  surface.credit.hidden = false;
  surface.canvas.dataset.map = 'on';
}

/** One choice, kept for every drawing on the page. A visitor who switched the
 *  ground off on the report has switched it off in the dialogs too. */
function toggleBasemap() {
  basemapOn = !basemapOn;
  rememberBasemapChoice(basemapOn);
  for (const surface of liveTraceSurfaces()) {
    if (surface.toggle) surface.toggle.textContent = basemapOn ? t('map.hide') : t('map.show');
    paintBasemap(surface);
  }
}

/** Turns the ground back on, for a visitor who asked for the map by name.
 *
 *  The card's map button is that request, so it counts as a choice and is
 *  remembered like the toggle's own. Pressing a button labelled map and getting
 *  a bare drawing, because the ground was switched off a week ago, is the kind
 *  of thing that reads as broken. */
function wantBasemap() {
  if (basemapOn) return;
  basemapOn = true;
  rememberBasemapChoice(true);
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
  // Four separate facts, in the order the visitor meets them: the file never
  // leaves, the link is fetched by us, and two things are fetched straight from
  // somebody else. Those last two are not optional dressing: they are the only
  // requests this page makes that our server never sees.
  //
  // The typefaces are named because they are the earliest of the four: the
  // stylesheet is in the head, so the visitor's browser has already spoken to
  // Google before a word of this page is on screen and before anything has been
  // pressed. Naming only the requests a visitor causes would leave the one they
  // cannot avoid unnamed.
  //
  // There is no sentence about card pictures any more, and that is not an
  // omission. Cards draw the route from the shape that came with the row, so
  // nothing at all is fetched for them.
  el.footerProcessing.innerHTML = [
    'footer.processing.file',
    'footer.processing.url',
    'footer.processing.map',
    'footer.processing.fonts',
  ]
    .map((key) => `<span>${t(key)}</span>`)
    .join('');
  el.footerSource.textContent = t('footer.source');
}

// -------------------------------------------------------------- the dialogs
//
// Two of them, and both are this page doing its own work instead of handing
// the visitor to somebody else. The competitor's version of the first embeds
// the source site's own map widget: that puts the visitor in front of the
// source's servers and shows the source's figures, which are the figures this
// product exists to doubt. Ours converts the link, measures the file and draws
// it with the two charts the report already uses, gap and all, drawn the same
// way.

let previewSubject = null;
let rotateSubject = null;

/** What the re-arranger is showing: the points that would be written, what
 *  they measure, and what the change cost. The download button reads this and
 *  nothing else, so the file that arrives is exactly the one the numbers above
 *  the button describe. */
let rotateDraft = null;
const rotateChoice = { reverse: false, startIndex: 0 };

// How long the drawing lags the slider. Short enough that it reads as the
// picture following the thumb, long enough that a long recording is measured
// twenty times a second and not two hundred.
const ROTATE_REDRAW_MS = 50;
let rotateTimer = 0;

/** A distance in the unit a walker would say it in. */
function metresOrKm(metres) {
  return metres >= 1000 ? `${formatKm(metres, 1)} km` : `${formatNumber(metres)} m`;
}

/** A seam. Under ten metres it needs a decimal to be a number at all; over ten
 *  a decimal is noise. */
function formatSeam(metres) {
  return formatNumber(metres, metres < 10 ? 1 : 0);
}

function renderDialogs() {
  if (dialogIsOpen(el.previewDialog)) renderPreview();
  if (dialogIsOpen(el.rotateDialog)) renderRotate();
}

function dressCloseButton(button) {
  button.innerHTML = icon('close');
  button.title = t('dialog.close');
  button.setAttribute('aria-label', t('dialog.close'));
}

// --------------------------------------------------------------- the preview

function openPreview(result, opener) {
  previewSubject = result;
  // Shown before it is filled, on purpose: both charts measure their own box,
  // and a box inside a hidden dialog measures zero. Nothing paints between
  // these two calls, so nothing is ever seen empty.
  openDialog(el.previewDialog, {
    returnFocusTo: opener,
    onClose: () => {
      hideBasemap(surfaces.preview);
      previewSubject = null;
    },
  });
  renderPreview();
}

function renderPreview() {
  if (!previewSubject) return;
  const { track, measurements, published, source, fileName } = previewSubject;
  const warn = measurements.gapExceedsThreshold;

  el.previewKicker.textContent = t('preview.kicker');
  el.previewTitle.textContent = source.title || track.name || fileName;
  el.previewSource.textContent = t('source.line', {
    source: source.label || t('source.file'),
    when: t('when.today'),
  });
  dressCloseButton(el.previewClose);

  el.previewTiles.innerHTML = measuredTiles(measurements, published);
  drawTrace(surfaces.preview, track.points, measurements);
  drawProfile(el.previewProfile, track.points, measurements);

  el.previewWarning.hidden = !warn;
  if (warn) el.previewWarning.innerHTML = gapWarningMarkup(measurements);

  el.previewNote.textContent = t('preview.note');
  el.previewDownload.innerHTML = `${icon('download')}<span>${t('step2.download')}</span>`;
  el.previewAdjust.innerHTML = `${icon('sliders')}<span>${t('card.adjust')}</span>`;
  el.previewReport.textContent = t('preview.report');
}

// ---------------------------------------------------------- the re-arranger

function openRotate(result, opener) {
  rotateSubject = result;
  rotateChoice.reverse = false;
  rotateChoice.startIndex = 0;
  openDialog(el.rotateDialog, {
    returnFocusTo: opener,
    // A press on the veil does not close this one. The preview only shows
    // something, so losing it by accident costs nothing; this holds an
    // arrangement the visitor made. Escape and the close button both still
    // work, and both are deliberate.
    closeOnBackdrop: false,
    onClose: () => {
      hideBasemap(surfaces.rotate);
      rotateSubject = null;
      rotateDraft = null;
    },
  });
  renderRotate();
}

function renderRotate() {
  if (!rotateSubject) return;
  const { track, measurements, source, fileName } = rotateSubject;
  const original = track.points;
  const ends = loopCheck(original, measurements.distanceM);

  // Moving the start is offered on a ring and nowhere else. On a walk from one
  // valley to another it would drive the whole distance between the two ends
  // straight through the middle of the track. The competitor offers it anyway,
  // and throws the head of the track away to do it, with no way back.
  const canMove = ends.isLoop;
  const startIndex = canMove
    ? Math.min(Math.max(0, rotateChoice.startIndex), ringLength(original) - 1)
    : 0;
  const arranged = arrange(original, { reverse: rotateChoice.reverse, startIndex });

  // RE-MEASURED AFTER EVERY CHANGE, from the points that would be written, not
  // from the recording that arrived. This is the whole reason the dialog is
  // worth building: the competitor's rotation opens a hole in the middle of the
  // file and the distance it prints does not include it.
  const after = measure({ points: arranged.points }, DEFAULT_GAP_THRESHOLD_M);
  const startM = measurements.cumulative[startIndex] ?? 0;
  const seamAtM = arranged.seamIndex > 0 ? after.cumulative[arranged.seamIndex - 1] : 0;
  const changed = arranged.reversed || arranged.startIndex > 0;
  const times = countTimes(original);
  const name = changedFileName(fileName, {
    reversed: arranged.reversed,
    startKm: arranged.startIndex > 0 ? startM / 1000 : null,
  });

  rotateDraft = { arranged, after, startM, seamAtM, changed, times, fileName: name };

  el.rotateKicker.textContent = t('rotate.kicker');
  el.rotateTitle.textContent = source.title || track.name || fileName;
  el.rotateRoute.textContent = t('rotate.lede');
  dressCloseButton(el.rotateClose);

  // What was detected, and the rule that decided it. A visitor who finds the
  // slider missing and is told nothing assumes the page is broken.
  const shape = ends.closed
    ? t('rotate.detected.closed')
    : t(ends.isLoop ? 'rotate.detected.near' : 'rotate.detected.open', {
        ends: metresOrKm(ends.closingM),
        tolerance: metresOrKm(ends.toleranceM),
        km: formatKm(ends.distanceM, 1),
      });
  el.rotateDetected.textContent = ends.closed
    ? shape
    : `${shape} ${t('rotate.rule', { floor: LOOP_FLOOR_M, ceiling: LOOP_CEILING_M })}`;

  el.rotateReverse.innerHTML = `${icon('reverse')}<span>${t('rotate.reverse')}</span>`;
  el.rotateReverse.setAttribute('aria-pressed', String(arranged.reversed));

  el.rotateStartBlock.hidden = !canMove;
  el.rotateStartLabel.textContent = t('rotate.start.label');
  el.rotateStart.max = String(Math.max(0, ringLength(original) - 1));
  el.rotateStart.value = String(startIndex);
  const startWords = t('rotate.start.value', { km: formatKm(startM, 1) });
  el.rotateStart.setAttribute('aria-valuetext', startWords);
  el.rotateStartValue.textContent = startWords;

  el.rotateReset.textContent = t('rotate.reset');
  el.rotateReset.hidden = !changed;

  drawTrace(surfaces.rotate, arranged.points, after);

  el.rotateMeasuredHead.textContent = t('rotate.measured');
  el.rotateTiles.innerHTML = arrangementTiles(after, measurements);
  el.rotateSecondary.innerHTML = descentRow(after);

  // A recording with no times loses nothing, and a line reporting that nothing
  // happened is a line the reader has to read to learn it can be ignored.
  el.rotateTimes.hidden = times === 0;
  el.rotateTimes.textContent =
    times === 1 ? t('rotate.times.one') : t('rotate.times.many', { count: formatNumber(times) });
  el.rotateNoTrim.textContent = t('rotate.notrim');

  renderSeam(arranged.seamM, seamAtM, after.gapThresholdM, changed);

  el.rotateDownload.innerHTML = `${icon('download')}<span>${t('rotate.download')}</span>`;
  el.rotateFilename.textContent = t('rotate.filename', { name });
}

/** What this arrangement measures, with the original beside each figure. */
function arrangementTiles(after, before) {
  return `
    ${tile(
      t('measure.distance'),
      formatKm(after.distanceM),
      'km',
      distanceNote(t('rotate.against', { value: `${formatKm(before.distanceM)} km` }), after),
      false,
    )}
    ${tile(
      t('measure.ascent'),
      formatNumber(after.ascentM),
      'm',
      ascentNote(t('rotate.against', { value: `${formatNumber(before.ascentM)} m` }), after),
      false,
    )}
    ${tile(
      t('measure.gap'),
      formatNumber(after.largestGapM),
      'm',
      gapNote(after),
      after.gapExceedsThreshold,
    )}`;
}

/** The line above the download button.
 *
 *  A seam wider than the threshold this page already calls a gap gets the warm
 *  panel, because it changes what happens on the hill: a watch will draw a
 *  straight line across ground nobody walked. A smaller one is stated plainly,
 *  so the visitor knows it is there and knows it is small.
 *
 *  The download is never blocked by either. This product measures and says; it
 *  does not decide for the person going out. Saying it above the button, in the
 *  footer that does not scroll away, is what makes that honest. */
function renderSeam(seamM, seamAtM, thresholdM, changed) {
  const panel = el.rotateSeam;
  if (seamM <= 0) {
    panel.hidden = changed;
    panel.className = 'dialog-note';
    panel.textContent = changed ? '' : t('rotate.unchanged');
    return;
  }
  panel.hidden = false;
  if (seamM > thresholdM) {
    panel.className = 'panel-warn warning-line';
    panel.innerHTML = `${icon('warning', 'icon-warning')}<p>${t('rotate.seam.warn', {
      gap: formatSeam(seamM),
      km: formatKm(seamAtM, 1),
    })}</p>`;
    return;
  }
  panel.className = 'dialog-note';
  panel.textContent = t('rotate.seam.small', { gap: formatSeam(seamM), threshold: thresholdM });
}

/** The sentence written into the file itself: what was done to the track and
 *  what it measures now. A downloaded file outlives the tab it came from, and
 *  the provenance link and the track name go with it either way. */
function arrangementNotes() {
  const { arranged, after, startM, seamAtM, times } = rotateDraft;
  const moved = arranged.startIndex > 0;
  const km = formatKm(startM, 1);
  const parts = [];

  if (arranged.reversed && moved) parts.push(t('rotate.desc.both', { km }));
  else if (arranged.reversed) parts.push(t('rotate.desc.reversed'));
  else if (moved) parts.push(t('rotate.desc.moved', { km }));
  else parts.push(t('rotate.desc.none'));

  if (arranged.seamM > 0) {
    parts.push(t('rotate.desc.seam', { gap: formatSeam(arranged.seamM), km: formatKm(seamAtM, 1) }));
  }
  if (times > 0) parts.push(t('rotate.desc.times'));
  parts.push(
    t('rotate.desc.measured', {
      km: formatKm(after.distanceM),
      ascent: formatNumber(after.ascentM),
    }),
  );
  return parts.join(' ');
}

function downloadArrangement() {
  if (!rotateSubject || !rotateDraft) return;
  const { track, source } = rotateSubject;
  const gpx = buildGpx(
    { name: track.name, points: rotateDraft.arranged.points },
    source,
    arrangementNotes(),
  );
  handOverFile(gpx, rotateDraft.fileName);
}

/** The readout follows the thumb at once; the measurement and the drawing
 *  follow a fraction of a second later, so dragging across a twenty thousand
 *  point recording does not queue a full re-measure per pixel crossed.
 *
 *  A timer and not a frame, for the same reason the conversion uses one: a tab
 *  that is not on screen never paints, and a visitor who drags the slider and
 *  then looks at something else must not come back to a dialog still
 *  describing where the start used to be. */
function scheduleRotateDraw() {
  if (rotateSubject) {
    const cumulative = rotateSubject.measurements.cumulative;
    const index = Math.min(Math.max(0, rotateChoice.startIndex), cumulative.length - 1);
    const words = t('rotate.start.value', { km: formatKm(cumulative[index], 1) });
    el.rotateStart.setAttribute('aria-valuetext', words);
    el.rotateStartValue.textContent = words;
  }
  if (rotateTimer) return;
  rotateTimer = setTimeout(() => {
    rotateTimer = 0;
    renderRotate();
  }, ROTATE_REDRAW_MS);
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

// The sources this page can ask for a list, both sites together first.
//
// Both at once is the default because nobody looking for a route near a
// village cares which website holds it, and asking one at a time is a filing
// system leaking into a question. A visitor who wants one site can still pick
// it, and gets that site's whole vocabulary rather than the shorter shared one.
//
// Only the first is offered until the service has answered for the others.
//
// `key` rather than `label` on the first, because its name is a sentence and
// not a proper noun: "Komoot and Wikiloc" has to become "Komoot y Wikiloc". The
// other two are the sites' own names and are never translated.
const KNOWN_SOURCES = [
  { id: 'all', key: 'source.both' },
  { id: 'komoot', label: 'Komoot' },
  { id: 'wikiloc', label: 'Wikiloc' },
];

// Sources whose own activity filter is refused to us, so the narrowing happens
// on our side of the wire.
//
// Wikiloc's `find.do` takes an activity parameter and ignores it for a caller
// with no account: it answers an empty page rather than an error, which is the
// worst of both. So `api/sources/wikiloc_discovery.py` reads several windows of
// results, keeps the rows that are the chosen activity, and reports both
// numbers: `examined`, how many rows it read, and `setAside`, how many it
// dropped and why.
//
// The control stays, because it does narrow the list, and it now narrows it
// well: a rare activity gives a short page because the activity is rare, and
// the two counts under the results are what turns that from a page that looks
// broken into a true thing about that valley.
//
// Both sites at once is in here as well, because half of that answer is
// Wikiloc's and is filtered the same way.
//
// Written down here, and named in the note's own wording, because the sentence
// is about one site by name. A source added later needs a line here and a
// sentence of its own.
const LOCAL_ACTIVITY_FILTER = new Set(['all', 'wikiloc']);

// Where the route re-arranging tool gets attached. Another job builds the
// modal; it calls `setRouteAdjuster` with a function that opens it for one row.
// Until then the button says so out loud when it is pressed, which is the one
// thing it must not do silently.
let adjustRoute = null;

/** Hands this page the tool that re-arranges a route. */
export function setRouteAdjuster(open) {
  adjustRoute = typeof open === 'function' ? open : null;
}

/** Opens that tool for one row. `opener` is the control that asked, so the tool
 *  can send focus back to it. False when there is nothing to open yet, so the
 *  caller can say so rather than leave a button that appears to do nothing. */
export function openRouteAdjuster(row, opener = null) {
  if (!adjustRoute) return false;
  adjustRoute(row, opener);
  return true;
}

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
  // The sources the service has answered for. Asking it by name and being
  // answered is the demonstration that it searches that source; a name it does
  // not know is refused outright.
  answered: new Set(),
  // Sources that have been SHOWN to work the place out from the words on their
  // own, by being handed a point and answering about somewhere else. Discovered
  // rather than written down, and only ever after the answer proves it, so the
  // control is offered wherever it works and withdrawn where it does not.
  placeStuck: new Set(),
  // Which card asked for the conversion that is running, so that card can say
  // so where the press was. Null whenever nothing is in flight.
  busyCard: null,
  search: {
    query: '',
    sport: '',
    // The place the visitor picked out of the ones the answer offered, when
    // they picked one. It is sent as a point, and the service then geocodes
    // nothing and guesses nothing.
    placePicked: null,
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

/** What to call one source. `fallback` is the name the service gave itself,
 *  used only for a source this page has no name written down for. */
function sourceLabel(id, fallback = '') {
  const known = KNOWN_SOURCES.find((source) => source.id === id);
  if (known) return known.key ? t(known.key) : known.label;
  return fallback || id;
}

/** The activities one panel's dropdown offers, and which it starts on. */
function choicesFor(mode) {
  return activityChoices(finder.catalogues.get(finder.sourceId), mode);
}

/** An activity word to show, and whether it is this page's word or the site's.
 *
 *  Three places to look, in this order, and the order is the whole design.
 *
 *  First this page's own vocabulary, which is a translation somebody wrote and
 *  checked. Then the source's own spelling, when the source publishes one:
 *  Wikiloc says "Trail Running" for the slug "trail-running", and both are its
 *  word, so showing the one meant for reading costs nothing and invents
 *  nothing. Last, the slug itself, opened out into something readable by
 *  `sourceOwnWord` and by nothing cleverer, because guessing at a translation
 *  for a word nobody here can check is exactly what this page must not do.
 *
 *  `ours` is false for both of the last two, and that is what it is for: it is
 *  the same fact in both cases, that the word on screen belongs to the site and
 *  not to us, and the sentence under the activity picker says so out loud. */
function sportWording(slug) {
  return wording(slug, { ours: (s) => translated(`sport.${s}`), published: publishedLabel });
}

/** This page's own word for a key, or nothing. `t` hands back the key itself
 *  when it has no translation, which reads as a word but is not one. */
function translated(key) {
  const text = t(key);
  return text === key ? null : text;
}

/** The source's own spelling of its own slug, from every list the service has
 *  handed over rather than only the one behind the dropdown. With both sites
 *  asked at once the rows carry each site's own word, so a Wikiloc word can
 *  land on a card while the dropdown shows the shared list, and Wikiloc's own
 *  spelling of it is still the best thing to print. */
function publishedLabel(slug) {
  const here = finder.catalogues.get(finder.sourceId)?.labels?.[slug];
  if (here) return here;
  for (const catalogue of finder.catalogues.values()) {
    if (catalogue.labels?.[slug]) return catalogue.labels[slug];
  }
  return null;
}

/** An activity in the reader's language, or the source's own word for it. */
function sportLabel(slug) {
  return sportWording(slug).text;
}

/** A grade in the reader's language, or the source's own word for it. Same
 *  rule as the activity above, and the same reason. */
function gradeLabel(slug) {
  // No `published` step: no source publishes a label for its grades, only for
  // its activities. So this walks the first step and then the last.
  return wording(slug, { ours: (s) => translated(`grade.${s}`) }).text;
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
  // A source the service does not search is refused by name rather than
  // answered with somebody else's list, so an answer at all is the proof.
  if (!payload || payload.ok !== true) return;

  finder.answered.add(sourceId);
  finder.sources = sourcesOffered(KNOWN_SOURCES, finder.answered);
  finder.sourceId = sourceChosen(finder.sources, finder.sourceId);

  const catalogue = catalogueFrom(payload, null);
  if (catalogue) {
    finder.catalogues.set(sourceId, catalogue);
    if (sourceId === finder.sourceId) applyCatalogue();
  }
  renderFinder();
}

/** Asks the service about every source this page knows a name for, once.
 *
 *  Each costs one request that makes no upstream call at all, and together they
 *  settle a question the page cannot otherwise answer: which of the three the
 *  service actually searches. The lists are needed anyway the moment somebody
 *  switches, so nothing is fetched twice. */
function probeSources() {
  for (const source of KNOWN_SOURCES) {
    if (!finder.answered.has(source.id)) loadCatalogue(source.id);
  }
}

function applyCatalogue() {
  finder.search.sport = sportAfterSource(choicesFor('search'), finder.search.sport, true);
  finder.nearby.sport = sportAfterSource(choicesFor('nearby'), finder.nearby.sport, true);
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
function adoptEcho(panel, mode, echo) {
  if (!echo) return;
  if (typeof echo.radiusM === 'number') panel.radiusM = echo.radiusM;
  const offered = choicesFor(mode).sports;
  if (typeof echo.sport === 'string' && offered.includes(echo.sport)) {
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
    clearRouteError();
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

  adoptEcho(panel, mode, listing.query);
  const before = append && panel.shown ? panel.shown.rows.length : 0;
  panel.shown = appendPage(append ? panel.shown : null, listing);
  if (mode === 'search') notePlaceIgnored(panel);
  // The source can answer a later page with nothing this converter can list,
  // while still saying there is more behind it. Said out loud, because a button
  // that visibly does nothing reads as broken.
  panel.addedNothing = append && panel.shown.rows.length === before;
  panel.errorKey = null;
  panel.status = panel.shown.rows.length === 0 ? 'empty' : 'ready';
  renderFinder();
}

function searchBody(panel) {
  return searchRequest({
    source: finder.sourceId,
    query: panel.query,
    sport: panel.sport,
    place: panel.placePicked,
    limit: SEARCH_PAGE_SIZE,
  });
}

function nearbyBody(panel) {
  return nearbyRequest({
    source: finder.sourceId,
    lat: readCoordinate(panel.lat, 90),
    lng: readCoordinate(panel.lng, 180),
    sport: panel.sport,
    radiusM: panel.radiusM,
    limit: NEARBY_PAGE_SIZE,
  });
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

/** Runs the same search again, about a different place.
 *
 *  BY POINT. Not by position, because the list this button was drawn from is
 *  redrawn by the answer it asks for, and a position into a replaced list points
 *  at the wrong place. And not by name either, which is what it used to do:
 *  `montserrat` answers with a village in Valencia and an island in the
 *  Caribbean both named `Montserrat`, the first match won, and pressing the
 *  island searched the village while the page said nothing had been guessed.
 *
 *  The point is the only thing that identifies a place, so the point is what
 *  the button carries and what this reads. `placeChoices` draws the buttons
 *  from the same rule, so what is offered and what is resolved cannot drift. */
function pickSearchPlace(point) {
  const panel = finder.search;
  const place = placeAtPoint(panel.shown?.places ?? [], point);
  if (!place) return;
  panel.placePicked = place;
  runList('search');
}

// ------------------------------------------------------------ finder drawing

function chooseTab(tab, focus) {
  finder.tab = tab;
  rememberTab(tab);
  clearRouteError();
  renderFinder();
  if (focus) el.tabButtons.find((button) => button.dataset.tab === tab).focus();
}

function chooseSource(id) {
  if (id === finder.sourceId) return;
  finder.sourceId = id;
  // A place picked for the old source's answer says nothing about the new
  // one's, so the next search asks the question from the words again.
  finder.search.placePicked = null;
  if (finder.catalogues.has(id)) applyCatalogue();
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
  fillSports(el.searchSport, el.searchSportLabel, 'search', finder.search.sport);
  el.searchSource.disabled = busy;
  el.searchSport.disabled = busy || el.searchSport.options.length === 0;
  el.searchSubmit.textContent = t('search.submit');
  el.searchSubmit.disabled = busy || finder.search.status === 'working';
  renderActivityNote(el.searchActivityNote, el.searchSport, 'search', 'search-activity-note');
}

/** Under the activity dropdown, on a source that will not filter for us.
 *
 *  The alternative was to take the control away. It is not offered, because the
 *  control does narrow the list: our own service drops the rows that are not
 *  the chosen activity. What it cannot do is claim the source did it, and the
 *  difference shows, because the narrowing happens to the page that arrived.
 *  So the control stays and the sentence says where the work happens; the count
 *  under the results then says how much of it happened. On Komoot, whose filter
 *  is real, there is nothing to explain and no line at all. */
function renderActivityNote(note, select, mode, id) {
  const said = [];
  if (LOCAL_ACTIVITY_FILTER.has(finder.sourceId)) said.push(t('activity.notFiltered'));
  if (showsSourceWords(mode)) said.push(t('activity.sourceWords'));

  note.hidden = said.length === 0;
  note.textContent = said.join(' ');
  if (said.length) select.setAttribute('aria-describedby', id);
  else select.removeAttribute('aria-describedby');
}

/** Whether any activity word ON SCREEN is the source's own rather than ours.
 *
 *  THE DROPDOWN IS NOT THE ANSWER, and testing it alone was the bug. The
 *  dropdown holds what can be asked for; the cards hold what came back, and the
 *  two are different lists. On both sites at once the dropdown is Komoot's six,
 *  every one of them translated, while the cards below carry Wikiloc's own
 *  words and Komoot's own unlisted ones, so the sentence stayed hidden over a
 *  page full of exactly what it exists to explain.
 *
 *  So both are read, and each is read the way it is drawn: through the same
 *  `sportWording` that puts the word on the screen. A test that repeats the
 *  lookup in different words is a test that will disagree with the screen one
 *  day, and the day it does the page will be lying quietly. */
function showsSourceWords(mode) {
  const panel = panelState(mode);
  const always = LOCAL_ACTIVITY_FILTER.has(finder.sourceId);
  const onScreen = [
    ...choicesFor(mode).sports,
    ...(panel.shown?.rows ?? [])
      .map((row) => activityWord(row, panel.sport, { always }))
      .filter(Boolean),
  ];
  return onScreen.some((slug) => !sportWording(slug).ours);
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
  fillSports(el.nearbySport, el.nearbySportLabel, 'nearby', finder.nearby.sport);
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
  renderActivityNote(el.nearbyActivityNote, el.nearbySport, 'nearby', 'nearby-activity-note');
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
    finder.sources.map((source) => ({ value: source.id, label: sourceLabel(source.id) })),
    finder.sourceId,
  );
}

function fillSports(select, label, mode, chosen) {
  label.textContent = t('field.activity');
  fillSelect(
    select,
    choicesFor(mode).sports.map((sport) => ({ value: sport, label: sportLabel(sport) })),
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
 *  The replacement button when there is one, the last card that was appended
 *  when there is not, so the visitor lands on what they asked for either way.
 *  A card is not a control, so it is focused rather than one of its four
 *  buttons: landing on the card reads out its name and its figures, where
 *  landing on GPX reads out one verb and nothing about which route it belongs
 *  to. That is what `tabindex="-1"` on the card is for, and it keeps the cards
 *  themselves out of the tab order. */
function restoreMoreFocus(mode) {
  const out = mode === 'search' ? el.searchOut : el.nearbyOut;
  const again = out.querySelector('[data-more]:not([disabled])');
  if (again) {
    again.focus();
    return;
  }
  const cards = out.querySelectorAll('.route-card');
  if (cards.length) cards[cards.length - 1].focus();
}


function renderResults(mode) {
  const panel = panelState(mode);
  const out = mode === 'search' ? el.searchOut : el.nearbyOut;
  const shown = panel.shown;
  // Named from the answer's own source, not from the dropdown: changing the
  // dropdown does not change the rows that are already on screen, and a list of
  // Komoot routes must not relabel itself the moment Wikiloc is selected.
  const source = sourceLabel(shown?.sourceId ?? finder.sourceId, shown?.source);
  const parts = [];

  // Which place, and which site is missing: both go above the rows, because
  // both change what the rows mean and neither can be left to be scrolled to.
  if (mode === 'search') parts.push(placeUsedMarkup(panel));
  parts.push(missingSourcesMarkup(shown));

  if (panel.status === 'working') {
    parts.push(`<p class="finder-status" role="status">${icon('active')}<span>${t(
      `finder.working.${mode}`,
      { source },
    )}</span></p>`);
  }

  if (shown && shown.rows.length > 0) {
    // `role="group"` because a label on a plain div is not announced. The cards
    // stay articles rather than list items: each one is a self-contained thing
    // with a name, which is what an article is.
    parts.push(
      `<div class="results results-wide" role="group" aria-label="${escapeText(
        t('finder.list', { source }),
      )}">${shown.rows.map((row, index) => cardMarkup(row, index, mode)).join('')}</div>`,
    );

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

  parts.push(scanMarkup(shown));
  if (panel.status === 'error') parts.push(errorMarkup(panel.errorKey));

  out.innerHTML = parts.join('');
  out.setAttribute('aria-busy', panel.status === 'working' ? 'true' : 'false');
  watchShapes(out, shown?.rows ?? []);
}


/** The URL to ask about, when a row arrived without its shape.
 *
 *  Komoot rows never reach this: their geometry rides in the thumbnail URL, so
 *  `cardTrace` already drew them. Wikiloc search results carry no coordinates
 *  at all, so their cards have to ask.
 *
 *  A row with no URL is nothing to ask about, and a row that already failed is
 *  not asked twice: a source that had no shape a minute ago still has none, and
 *  retrying on every scroll would turn a quiet failure into a loop. */
function shapeAskable(row) {
  if (!row || typeof row.url !== 'string' || !row.url) return null;
  if (Array.isArray(row.trace) && row.trace.length >= 2) return null;
  if (shapesTried.has(row.url)) return null;
  return row.url;
}

// Every URL asked about, whether it answered or not. Lives for the session,
// which is the right span: a shape that arrived is on the row already, and one
// that did not is not going to arrive by asking again while the reader scrolls
// past it a third time.
const shapesTried = new Set();

let shapeWatcher = null;

/** Ask for a card's shape when the reader reaches that card, and never before.
 *
 *  A trail page is 354 KB and does not honour a Range request, so a shape costs
 *  one full fetch. Nine of them, up front, for a reader who will open at most
 *  one route is a crawl with extra steps, and this service answers requests
 *  rather than making them. An observer is the honest form of "the reader
 *  reached it": the card is on screen, so somebody is looking at it.
 *
 *  Rebuilt on each render because the cards are, and the old one is disconnected
 *  rather than left watching nodes that no longer exist. */
function watchShapes(container, rows) {
  shapeWatcher?.disconnect();
  const slots = container.querySelectorAll('[data-shape-url]');
  if (!slots.length || typeof IntersectionObserver !== 'function') return;

  shapeWatcher = new IntersectionObserver((entries, observer) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const slot = entry.target;
      observer.unobserve(slot);
      askForShape(slot, rows);
    }
  }, {
    // A little before the card arrives, so the drawing is there by the time the
    // reader's eye is. Not a screenful: that would be fetching ahead of them,
    // which is the thing this whole design exists to avoid.
    rootMargin: '120px 0px',
  });

  for (const slot of slots) shapeWatcher.observe(slot);
}

async function askForShape(slot, rows) {
  const url = slot.dataset.shapeUrl;
  if (!url || shapesTried.has(url)) return;
  shapesTried.add(url);

  let trace = null;
  try {
    const response = await fetch(`${API_BASE}/shape`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const answer = await response.json();
    if (answer?.ok && Array.isArray(answer.trace)) trace = answer.trace;
  } catch {
    // A shape that does not arrive is not an error to announce. The card
    // simply has no drawing, which is what every Wikiloc card looked like
    // before any of this, and the route is still there to convert.
  }

  // The slot may be gone: a new search, a language switch, or Load more will
  // have rebuilt the list while this was in flight.
  if (!slot.isConnected) return;

  if (!trace) {
    slot.remove();
    return;
  }

  // Onto the row as well as the screen, so a re-render draws it without asking
  // again, and so the row and the card can never disagree about the shape.
  const row = rows.find((candidate) => candidate?.url === url);
  if (row) row.trace = trace;

  const drawing = cardTrace({ trace }, { fit: fitFrame, project: projectInFrame });
  if (!drawing) {
    slot.remove();
    return;
  }
  const source = row?.publishedBy || sourceLabel(finder.sourceId);
  slot.innerHTML = shapeSvg(drawing, t('card.shapeAlt', { source }));
  slot.classList.remove('is-waiting');
}

/** What the service read to produce this page, in its own numbers.
 *
 *  Said whether the list is full or empty, and especially when it is empty: on
 *  a source that will not filter for us, these counts are the entire difference
 *  between "there is nothing there" and "there is plenty there, and none of it
 *  is what you asked for". Without them, choosing an activity looks like a
 *  control that broke the page.
 *
 *  Every number here is read from the answer and none is inferred. An answer
 *  that mentions no scan gets no sentence about one: one via ferrata route out
 *  of a hundred examined is a short page and a true thing about that valley,
 *  but only a source that counted may be quoted for it. */
function scanMarkup(shown) {
  const said = [];

  const examined = shown?.examined ?? null;
  if (typeof examined === 'number' && examined > 0) {
    said.push(t('finder.examined', { count: formatNumber(examined) }));
  }

  const aside = shown?.setAside?.otherActivity ?? 0;
  if (aside > 0) {
    said.push(
      t(aside === 1 ? 'finder.setAside.one' : 'finder.setAside.many', {
        count: formatNumber(aside),
      }),
    );
  }

  const outside = shown?.setAside?.outsideRadius ?? 0;
  if (outside > 0) {
    said.push(
      t(outside === 1 ? 'finder.outside.one' : 'finder.outside.many', {
        count: formatNumber(outside),
      }),
    );
  }

  return said.length === 0 ? '' : `<p class="dropped-note">${said.join(' ')}</p>`;
}

/** The sites that were asked and did not answer.
 *
 *  A short list because one site was down reads exactly like a short list
 *  because a valley is empty, and they are not the same thing. An answer from a
 *  single site says nothing about sites and gets nothing here: a site that
 *  fails on its own is an error, and the page already has a panel for that. */
function missingSourcesMarkup(shown) {
  const missing = sourcesMissing(shown);
  if (missing.length === 0) return '';
  return missing
    .map((source) => {
      const key = source.error === 'busy' ? 'finder.siteBusy' : 'finder.siteFailed';
      return `<p class="panel-warn finder-missing" role="status">${icon(
        'warning',
        'icon-warning',
      )}<span>${escapeText(t(key, { source: sourceLabel(source.id) }))}</span></p>`;
    })
    .join('');
}

/** Whether the point the visitor picked is the one the answer was about.
 *
 *  A last resort, and no longer the main evidence. An answer from two sites
 *  says per site whether the point reached it, which is the fact the page needs
 *  and the only one that can be true of half a list. This is what is left for a
 *  single site, which sends no such record: the place it says it used either is
 *  the point that was sent or it is not.
 *
 *  A source shown to ignore a point has its swap buttons taken away, because a
 *  control that visibly does nothing is worse than no control. */
function notePlaceIgnored(panel) {
  const picked = panel.placePicked;
  const used = panel.shown?.placeUsed;
  if (!picked || !used || samePoint(picked, used)) return;
  if (pointHonoured(panel.shown).applied.length > 0) return;
  finder.placeStuck.add(finder.sourceId);
  panel.placePicked = null;
}

/** WHAT TO SAY ABOUT THE PLACE, in one place, so the sentence and the evidence
 *  for it cannot come apart.
 *
 *  THE SENTENCE THAT WAS FALSE. "Nothing was guessed" was said over the whole
 *  list whenever a place had been picked. On both sites at once that is false
 *  for half the rows: a Wikiloc search IS a box, so the point becomes the box
 *  and its rows can only be from there, while Komoot geocodes the words itself
 *  and its rows land wherever the words point. Picking the Caribbean island of
 *  Montserrat and being shown routes in Catalonia under a line saying nothing
 *  was guessed is the page telling the visitor something it could have known
 *  was untrue.
 *
 *  Deleting the sentence would have been the wrong fix. Somebody who pressed a
 *  place is owed an answer about whether it worked. So the answer now carries
 *  the fact per site, measured against each site and written down beside the
 *  code that sends the point, and this reads it and says the true thing: which
 *  site looked where you pointed, and which looked the words up itself. */
function placeReport(panel) {
  const shown = panel.shown;
  // No answer on screen, so there is nothing to say a place about. A search
  // that failed after a place was picked still holds the pick, and a sentence
  // about where the rows came from would be about rows nobody can see.
  if (!shown) return null;

  const used = shown.placeUsed ?? null;
  const picked = panel.placePicked ?? null;
  if (!picked) return used ? { place: used, key: 'place.guessed', names: {} } : null;

  const { applied, ignored } = pointHonoured(shown);
  const names = {
    applied: joinList(applied.map((id) => sourceLabel(id))),
    ignored: joinList(ignored.map((id) => sourceLabel(id))),
  };

  // No per-site record, so one site answered. Its own echo is the evidence.
  if (applied.length === 0 && ignored.length === 0) {
    return samePoint(picked, used)
      ? { place: picked, key: 'place.picked', names: {} }
      : {
          place: picked,
          key: 'place.pickedNone',
          names: { ignored: sourceLabel(shown.sourceId ?? finder.sourceId, shown.source) },
        };
  }
  if (ignored.length === 0) return { place: picked, key: 'place.picked', names };
  if (applied.length === 0) return { place: picked, key: 'place.pickedNone', names };
  return { place: picked, key: 'place.pickedPartly', names };
}

/** WHICH PLACE THE ROWS ARE FROM, and how to say a different one.
 *
 *  Wikiloc searches a box, so words have to become a box, and a geocoder
 *  decides which place the words meant. It decides badly often enough to
 *  matter: "montserrat" gives a village in the Valencian Community, 300 km from
 *  the mountain in Catalonia, and merged with Komoot, which gets the mountain
 *  right, that is one list holding two different valleys with nothing on screen
 *  saying so.
 *
 *  So the place goes above the rows, where it cannot be missed, and the places
 *  it could have been are offered beside it. Picking one sends the point
 *  itself, and the sentence above the rows then says, per site, what became of
 *  it.
 *
 *  A place the visitor picked says so in different words from a place a
 *  geocoder guessed, because they are not the same claim. */
function placeUsedMarkup(panel) {
  const shown = panel.shown;
  const report = placeReport(panel);
  if (!report) return '';

  const line = t(report.key, { place: report.place.name, ...report.names });
  const stuck = finder.placeStuck.has(finder.sourceId);

  // Each button carries its own point, and the press is resolved by that point.
  // The name is only something to read: the same place arrives named two ways,
  // and two different places arrive named the same way.
  const choices = stuck ? [] : placeChoices(shown?.places ?? [], report.place);
  const swap = choices.length
    ? `<p class="place-swap-label">${escapeText(t('place.others'))}</p>
       <div class="place-swap">${choices.map(placeSwapButton).join('')}</div>`
    : '';

  return `<section class="place-used" aria-label="${escapeText(t('place.usedLabel'))}">
      <p class="place-used-line">${icon('crosshair', 'place-used-mark')}<span>${escapeText(
        line,
      )}</span></p>
      ${swap}
      ${stuck ? `<p class="place-swap-label">${escapeText(t('place.stuck'))}</p>` : ''}
    </section>`;
}

/** One place to search instead, with its point on it.
 *
 *  The coordinate is printed only where the name does not separate this place
 *  from another in the same answer. Two buttons reading `Montserrat` are not a
 *  choice a person can make, and the point is the only thing this page holds
 *  that tells them apart. Where the names already differ the coordinate would
 *  be four numbers nobody needs, so it is not there.
 *
 *  Written with a middle dot rather than a comma, for the reason the card gives:
 *  in Spanish the comma is already the decimal mark. */
function placeSwapButton({ place, ambiguous }) {
  const lat = formatNumber(place.lat, 4);
  const lng = formatNumber(place.lng, 4);
  // A middle dot separates the pair on screen and reads as nothing at all out
  // loud, so the spoken name says which number is which instead.
  const point = ambiguous
    ? `<span class="place-swap-point">${escapeText(`${lat} · ${lng}`)}</span>`
    : '';
  const label = ambiguous ? t('place.swapAt', { place: place.name, lat, lng }) : place.name;
  return `<button
      class="ghost-button place-swap-button"
      type="button"
      aria-label="${escapeText(label)}"
      data-swap-lat="${escapeText(String(place.lat))}"
      data-swap-lng="${escapeText(String(place.lng))}"
    ><span>${escapeText(place.name)}</span>${point}</button>`;
}

// ----------------------------------------------------------------- the card
//
// A card is a row with more room, and the extra room is exactly where this
// page could start lying. Everything on a card that came from the source site
// is inside one region with the source's name at the top of it; nothing
// outside that region is a number. The list solved the same problem with a
// sentence per row, which a card cannot afford four times over, so it is
// solved once here, at the level of the block.
//
// What was taken from the shape the owner showed, and what was not:
//   kept    the anatomy and the density: a picture across the top, the title
//           under it, a grid of figures with a drawn mark each, the rating, the
//           date, and four controls in one row.
//   kept    the two labels over the picture, because that is the one place they
//           cost no vertical space at all.
//   dropped the coloured pills. This page has two colours and both mean
//           something: cyan for what you can press, warm red for what changes
//           what you do on the hill. An activity is neither, so it is set in
//           the same mono the rest of the page uses for a label.
//   dropped the filled green button. The primary button here is the page's own
//           cyan, and it is the only filled thing on the card, so it is
//           obviously the one that does the work.
//   dropped the rounded box on a light panel, the drop shadow and the hover
//           lift. The list is separated by hairlines like everything else, and
//           a card lifts with the accent, the way a row does.

/** One card: the source's picture, the source's figures under the source's
 *  name, and four things to do with the link. */
function cardMarkup(row, index, mode) {
  const source = row.publishedBy || sourceLabel(finder.sourceId);
  const uid = `${mode}-${index}`;
  const busy = state.view === 'working' ? ' disabled' : '';
  const working =
    state.view === 'working' &&
    finder.busyCard?.mode === mode &&
    finder.busyCard.index === index;
  // A source that cannot filter upstream has been promised, in writing under
  // its own dropdown, that every card says its own activity.
  const always = LOCAL_ACTIVITY_FILTER.has(finder.sourceId);
  const activity = activityWord(row, panelState(mode).sport, { always });
  const marks = [
    activity ? `<span class="card-mark">${escapeText(sportLabel(activity))}</span>` : '',
    row.difficulty
      ? `<span class="card-mark card-grade" title="${escapeText(
          t('grade.label', { source, grade: gradeLabel(row.difficulty) }),
        )}">${escapeText(gradeLabel(row.difficulty))}</span>`
      : '',
  ].join('');

  // Drawn here, in this page's own line colour, from geometry that either came
  // with the row or is fetched for this one card when the reader reaches it.
  //
  // Komoot encodes the shape into its thumbnail URL, so its cards draw with no
  // request at all. Wikiloc sends none in a search result, so its cards carry
  // the URL to ask about and `watchShapes` does the asking. Either way no
  // picture is loaded from anybody: what a card draws, it draws itself.
  const drawing = cardTrace(row, { fit: fitFrame, project: projectInFrame });
  const picture = shapeSlot(drawing, {
    url: drawing ? null : shapeAskable(row),
    alt: t('card.shapeAlt', { source }),
  });

  // Named by its own title, so focus landing on the card after Load more reads
  // out which route it landed on rather than the word "article".
  //
  // The three buttons go dead while a conversion runs; the link to the source
  // site does not, because it asks nothing of this page. Opening the original
  // in another tab while we work is a reasonable thing to want.
  return `<article
      class="route-card"
      data-index="${index}"${working ? ' data-busy' : ''}
      tabindex="-1"
      aria-labelledby="title-${uid}"
    >
      ${picture}
      <div class="card-text">
        <h3 class="card-title" id="title-${uid}">${escapeText(row.title)}</h3>
        ${marks ? `<span class="card-marks card-marks-inline">${marks}</span>` : ''}
        ${claimBlock(row, source, uid)}
        <div class="card-actions">
          <button class="primary-button card-primary" type="button" data-act="gpx" aria-label="${escapeText(
            t('card.gpx.label'),
          )}"${busy}>${icon('download')}<span>${t('card.gpx')}</span></button>
          ${iconButton('chart', 'map', t('card.chart'), busy)}
          ${iconButton('adjust', 'sliders', t('card.adjust'), busy)}
          <a
            class="icon-button"
            href="${escapeText(row.url)}"
            target="_blank"
            rel="noopener noreferrer"
            title="${escapeText(t('card.open', { source }))}"
            aria-label="${escapeText(t('card.open', { source }))}"
          >${icon('external')}</a>
        </div>
        <p class="card-note" data-note role="status"${working ? '' : ' hidden'}>${
          working ? escapeText(t('stage.progress')) : ''
        }</p>
      </div>
    </article>`;
}

/** Finds one card's control again after the list has been redrawn under it. */
function cardControl(listId, index, action) {
  if (!listId) return null;
  return () =>
    document
      .getElementById(listId)
      ?.querySelector(`.route-card[data-index="${index}"] [data-act="${action}"]`) ?? null;
}

/** One of the three square controls beside the GPX button. The drawing is the
 *  whole label, so the words go in both the tooltip and the accessible name. */
function iconButton(action, mark, label, busy) {
  return `<button
      class="icon-button"
      type="button"
      data-act="${action}"
      title="${escapeText(label)}"
      aria-label="${escapeText(label)}"${busy}
    >${icon(mark)}</button>`;
}

/** Everything the source claims, under the source's name, in one region.
 *
 *  THE RULE THIS SOLVES. Every figure here is the site's own and this product
 *  exists to doubt them, so not one of them may read as something we measured.
 *  A row spends a whole sentence saying so. A card cannot, so it names the
 *  source once, at the top, and puts every claimed figure inside the region
 *  that heading names, with a rule down its edge tying them together. Nothing
 *  outside this region is a number: the title is a name, the activity and the
 *  grade are words, and the four controls are verbs.
 *
 *  The heading is a real heading, and the region a real region, so a screen
 *  reader reaches the figures through "What Komoot says" rather than meeting
 *  twelve unattributed numbers in a row.
 *
 *  With nothing at all published, the sentence the list already uses stands on
 *  its own. That is not a broken card: it is the same statement, and it is
 *  worth making, because a source that publishes no figures is exactly the case
 *  where converting the route is the only way to learn anything. */
function claimBlock(row, source, uid) {
  const figures = cardFigures(row);
  const stars = starPortion(row.rating);
  const updated = updatedMonth(row.updatedAt);

  if (figures.length === 0 && !stars && !updated) {
    return `<p class="card-claim-empty">${escapeText(
      claimSentence(row.published, {
        source,
        t,
        km: (metres) => formatKm(metres, 1),
        metres: (value) => formatNumber(value),
        joinList,
      }),
    )}</p>`;
  }

  const grid = figures.length
    ? `<dl class="card-grid">${figures.map(figureMarkup).join('')}</dl>`
    : '';
  const footing = [
    stars ? ratingMarkup(stars, source) : '',
    updated
      ? `<span class="card-updated">${escapeText(
          t('card.updated', { when: formatMonth(updated) }),
        )}</span>`
      : '',
  ].join('');

  return `<section class="card-claim" aria-labelledby="claim-${uid}">
      <h4 class="card-claim-head" id="claim-${uid}">${escapeText(t('card.claim', { source }))}</h4>
      ${grid}
      ${footing ? `<p class="card-footing">${footing}</p>` : ''}
    </section>`;
}

/** One figure: a drawn mark, the site's number, and what the number is of. */
function figureMarkup(figure) {
  if (figure.key === 'distance') {
    return statMarkup('distance', t('measure.distance'), `${formatKm(figure.metres, 1)} km`);
  }
  if (figure.key === 'ascent') {
    return statMarkup('ascent', t('measure.ascent'), `${formatNumber(figure.metres)} m`);
  }
  if (figure.key === 'duration') {
    const { hours, minutes } = durationParts(figure.seconds);
    const spent =
      hours === 0
        ? t('card.time.m', { m: formatNumber(minutes) })
        : minutes === 0
          ? t('card.time.h', { h: formatNumber(hours) })
          : t('card.time.hm', { h: formatNumber(hours), m: formatNumber(minutes) });
    return statMarkup('duration', t('card.duration'), spent);
  }
  // The pair is separated by a dot, not a comma, for the reason the place rows
  // give: in Spanish the comma is already the decimal mark.
  return statMarkup(
    'start',
    t('card.start'),
    `${formatNumber(figure.lat, 4)} · ${formatNumber(figure.lng, 4)}`,
    // A coordinate pair is twice as long as any other value here and it must
    // not break across two lines: half a latitude at the end of a line reads as
    // a different number.
    'card-stat-pair',
  );
}

function statMarkup(mark, label, value, extra = '') {
  return `<div class="card-stat${extra ? ` ${extra}` : ''}">
      <dt>${icon(mark, 'stat-mark')}<span>${escapeText(label)}</span></dt>
      <dd>${escapeText(value)}</dd>
    </div>`;
}

/** The score other walkers on that site gave it.
 *
 *  Five drawn stars filled to the fraction of the score, so 4.46 is drawn as
 *  4.46 rather than rounded to a shape the source never published, and the
 *  number is printed beside them because the drawing is an impression and the
 *  number is the claim.
 *
 *  One `img` role over the whole thing, carrying the sentence that names the
 *  source. A screen reader gets "4.46 out of 5, from 13 ratings on Komoot" and
 *  not a pile of stars followed by two loose numbers. */
function ratingMarkup(stars, source) {
  const score = formatNumber(stars.score, stars.score % 1 === 0 ? 0 : 1);
  const label =
    stars.count === null
      ? t('card.rating.none', { score, source })
      : stars.count === 1
        ? t('card.rating.one', { score, source })
        : t('card.rating', { score, count: formatNumber(stars.count), source });
  const row = `${icon('star')}${icon('star')}${icon('star')}${icon('star')}${icon('star')}`;

  return `<span class="card-rating" role="img" aria-label="${escapeText(label)}">
      <span class="card-stars">
        <span class="stars-empty">${row}</span>
        <span class="stars-full" style="--fill:${(stars.fraction * 100).toFixed(2)}%">${row}</span>
      </span>
      <span class="card-score">${escapeText(score)}</span>
      ${
        stars.count === null
          ? ''
          : `<span class="card-count">(${escapeText(formatNumber(stars.count))})</span>`
      }
    </span>`;
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
  el.field = el.input.closest('.field');
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
  el.searchActivityNote = document.getElementById('search-activity-note');
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
  el.nearbyActivityNote = document.getElementById('nearby-activity-note');
  el.nearbyForm = document.getElementById('nearby-form');
  el.nearbyOut = document.getElementById('nearby-out');

  el.progress = document.getElementById('progress');
  el.error = document.getElementById('error');
  el.report = document.getElementById('report');
  el.reportTitle = document.getElementById('report-title');
  el.reportSource = document.getElementById('report-source');
  el.downloadButton = document.getElementById('download');
  el.reportAdjust = document.getElementById('report-adjust');
  el.resetButton = document.getElementById('reset');
  el.tiles = document.getElementById('tiles');
  el.method = document.getElementById('method');
  el.methodSummary = document.getElementById('method-summary');
  el.methodSampling = document.getElementById('method-sampling');
  el.traceFigure = document.getElementById('trace');
  el.profileFigure = document.getElementById('profile');
  surfaces.trace = chartSurface(el.traceFigure);
  el.warning = document.getElementById('warning');
  el.secondary = document.getElementById('secondary');
  el.provenance = document.getElementById('provenance');
  el.footerProcessing = document.getElementById('footer-processing');
  el.footerSource = document.getElementById('footer-source');

  el.previewDialog = document.getElementById('preview-dialog');
  el.previewKicker = document.getElementById('preview-kicker');
  el.previewTitle = document.getElementById('preview-title');
  el.previewSource = document.getElementById('preview-source');
  el.previewClose = document.getElementById('preview-close');
  el.previewTiles = document.getElementById('preview-tiles');
  el.previewProfile = document.getElementById('preview-profile');
  el.previewWarning = document.getElementById('preview-warning');
  el.previewNote = document.getElementById('preview-note');
  el.previewDownload = document.getElementById('preview-download');
  el.previewAdjust = document.getElementById('preview-adjust');
  el.previewReport = document.getElementById('preview-report');
  surfaces.preview = chartSurface(document.getElementById('preview-trace'));

  el.rotateDialog = document.getElementById('rotate-dialog');
  el.rotateKicker = document.getElementById('rotate-kicker');
  el.rotateTitle = document.getElementById('rotate-title');
  el.rotateRoute = document.getElementById('rotate-route');
  el.rotateClose = document.getElementById('rotate-close');
  el.rotateDetected = document.getElementById('rotate-detected');
  el.rotateReverse = document.getElementById('rotate-reverse');
  el.rotateStartBlock = document.getElementById('rotate-start-block');
  el.rotateStart = document.getElementById('rotate-start');
  el.rotateStartLabel = labelFor('rotate-start');
  el.rotateStartValue = document.getElementById('rotate-start-value');
  el.rotateReset = document.getElementById('rotate-reset');
  el.rotateMeasuredHead = document.getElementById('rotate-measured-head');
  el.rotateTiles = document.getElementById('rotate-tiles');
  el.rotateSecondary = document.getElementById('rotate-secondary');
  el.rotateSeam = document.getElementById('rotate-seam');
  el.rotateTimes = document.getElementById('rotate-times');
  el.rotateNoTrim = document.getElementById('rotate-notrim');
  el.rotateDownload = document.getElementById('rotate-download');
  el.rotateFilename = document.getElementById('rotate-filename');
  surfaces.rotate = chartSurface(document.getElementById('rotate-trace'));
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

  el.downloadButton.addEventListener('click', downloadResult);

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

  // One handler for all three trace figures. The choice is the page's, not the
  // figure's, so whichever button is pressed moves all of them.
  for (const button of document.querySelectorAll('[data-map-toggle]')) {
    button.addEventListener('click', toggleBasemap);
  }

  let redrawTimer = 0;
  window.addEventListener('resize', () => {
    const live = liveTraceSurfaces();
    if (live.length === 0) return;
    // The label is anchored to a point on the drawing, so it moves with it,
    // immediately. The map is a full repaint of a canvas, so it waits until the
    // window has stopped moving.
    for (const surface of live) positionGapLabel(surface);
    clearTimeout(redrawTimer);
    redrawTimer = setTimeout(() => {
      for (const surface of liveTraceSurfaces()) paintBasemap(surface);
    }, 180);
  });

  // The axis label positions are percentages and need no help on resize. Only
  // the number of ticks changes at the breakpoint, so the charts are rebuilt
  // when it flips and not otherwise.
  compactQuery.addEventListener('change', (event) => {
    compactCharts = event.matches;
    renderDialogs();
    if (state.view !== 'report') return;
    renderCharts();
    // The redrawn SVGs have no cursors in them, so the reading beside the title
    // would be left describing a point nothing is pointing at.
    clearHover();
  });

  wireDialogs();
}

function wireDialogs() {
  el.reportAdjust.addEventListener('click', () => {
    if (state.result) openRotate(state.result, el.reportAdjust);
  });

  el.previewClose.addEventListener('click', () => closeDialog());
  el.previewDownload.addEventListener('click', () => {
    if (previewSubject) handOverFile(previewSubject.gpxText, previewSubject.fileName);
  });
  el.previewAdjust.addEventListener('click', () => {
    // Held before the swap: opening the second dialog closes the first, and
    // closing the first is what clears this.
    const subject = previewSubject;
    if (subject) openRotate(subject, null);
  });
  el.previewReport.addEventListener('click', () => {
    const subject = previewSubject;
    closeDialog();
    if (!subject) return;
    showReport(subject);
    // The card this came from has just been hidden with the rest of the list,
    // so focus is given a real place to land rather than falling to the top of
    // the document.
    el.downloadButton.focus();
  });

  el.rotateClose.addEventListener('click', () => closeDialog());
  el.rotateReverse.addEventListener('click', () => {
    rotateChoice.reverse = !rotateChoice.reverse;
    renderRotate();
  });
  el.rotateStart.addEventListener('input', () => {
    rotateChoice.startIndex = Number(el.rotateStart.value);
    scheduleRotateDraw();
  });
  el.rotateReset.addEventListener('click', () => {
    rotateChoice.reverse = false;
    rotateChoice.startIndex = 0;
    renderRotate();
    // The reset button hides itself once there is nothing to reset, so focus
    // is moved before it goes.
    el.rotateReverse.focus();
  });
  el.rotateDownload.addEventListener('click', downloadArrangement);
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
    // A place was picked for the words that were on screen when it was picked.
    // New words are a new question, so the next search asks it from scratch.
    finder.search.placePicked = null;
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

  // One listener per list rather than one per card: the cards are rewritten
  // whenever the language or the page changes.
  for (const mode of ['search', 'nearby']) {
    const out = mode === 'search' ? el.searchOut : el.nearbyOut;
    out.addEventListener('click', (event) => {
      // The point, not the name: two places in one answer can be called the
      // same thing, and the first of them is not the one that was pressed.
      const swap = event.target.closest('[data-swap-lat]');
      if (swap) {
        pickSearchPlace({
          lat: Number(swap.dataset.swapLat),
          lng: Number(swap.dataset.swapLng),
        });
        return;
      }
      if (event.target.closest('[data-more]')) {
        // The list is redrawn wholesale, so the button that was just pressed
        // stops existing. Without this a keyboard visitor is dropped at the top
        // of the document and has to tab past everything to reach the cards they
        // just asked for.
        runList(mode, { append: true }).then(() => restoreMoreFocus(mode));
        return;
      }
      const pressed = event.target.closest('[data-act]');
      const card = event.target.closest('.route-card');
      if (!pressed || !card) return;
      const row = panelState(mode).shown?.rows[Number(card.dataset.index)];
      if (row) runCardAction(pressed.dataset.act, row, card, mode);
    });
  }
}

/** The four things a card can do with its link.
 *
 *  Three of them are the same conversion the link field runs, which is what
 *  makes the file carry our provenance and the measurement ours. The fourth is
 *  the source's own page, and it is the only one that leaves. */
function runCardAction(action, row, card, mode) {
  // Anything said about the last press belongs to the last press.
  const note = card.querySelector('[data-note]');
  if (note) note.hidden = true;

  // Where focus goes when the dialog closes. Not the button itself: converting
  // the route rewrites the whole list, so by then this exact element has been
  // replaced by an identical one. The card is found again by its place in the
  // list, which does not move.
  const home = cardControl(card.closest('.finder-out')?.id, card.dataset.index, action);

  // A conversion started from a card disables every control in the list and
  // draws its progress in step one, which is off the top of the screen by the
  // fifth card. From down here that is a page that greyed out and said nothing.
  // So the card that was pressed says it, on its own status line, where the
  // press was. The stage list stays for the link field, where it is on screen.
  const working = (start) => {
    finder.busyCard = { mode, index: Number(card.dataset.index) };
    return start().finally(() => {
      finder.busyCard = null;
      renderFinder();
    });
  };

  if (action === 'gpx') {
    working(() => convertAndDownload(row.url));
    return;
  }
  if (action === 'chart') {
    // Our map and our profile, over the list, with the ground turned on.
    // Pressing a button labelled map and getting a bare drawing, because the
    // ground was switched off a week ago, is the kind of thing that reads as
    // broken.
    wantBasemap();
    working(() => convertForDialog(row.url, openPreview, home));
    return;
  }
  if (action === 'adjust' && !openRouteAdjuster(row, home) && note) {
    // Nothing installed the tool yet. Said on the card that was pressed, in the
    // page's own quiet voice, because a button that swallows a press is the one
    // failure this page must not have.
    note.textContent = t('card.adjust.missing');
    note.hidden = false;
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
// written down here. The default source is asked first because it is the one on
// screen, then the others, which is how the page finds out which of the three
// the service actually searches.
loadCatalogue(finder.sourceId).then(probeSources);
// The tool the card's third button asks for. It is registered through the same
// hook an outside module would have used, so the button keeps its one guarantee:
// it either opens something or says why it did not.
setRouteAdjuster((row, opener) => convertForDialog(row.url, openRotate, opener));
