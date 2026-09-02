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

// ------------------------------------------------------------------- sources

/** Which service a pasted link belongs to. Returns null when we cannot read it. */
export function classifyLink(raw) {
  const value = raw.trim();
  if (!value) return null;
  if (/\.gpx($|\?)/i.test(value)) return { id: 'file', label: 'Your file' };

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
    return fail(payload?.error ?? 'track');
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
    source: { id: 'file', label: t('lang.name') === 'Español' ? 'Tu fichero' : 'Your file', title: track.name || base, url: null },
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
  el.sub.textContent = t('step1.sub');
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
    source: source.label,
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
      ? '–'
      : `${formatNumber(measurements.elevationMinM)}–${formatNumber(measurements.elevationMaxM)} m`;
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

function renderCharts() {
  const { track, measurements } = state.result;
  const trace = renderTrace(track.points, measurements, t);
  const profile = renderProfile(track.points, measurements, t);
  chartData = { trace, profile };

  el.traceFigure.querySelector('.chart-title').textContent = t('chart.trace');
  el.traceFigure.querySelector('.chart-svg').innerHTML = trace.svg;
  el.traceFigure.querySelector('.chart-caption').innerHTML = measurements.gapExceedsThreshold
    ? `<span>${t('chart.start')}</span><span class="caption-warn">${t('chart.gapDrawn')}</span>`
    : `<span>${t('chart.start')}</span>`;

  el.profileFigure.querySelector('.chart-title').textContent = t('chart.profile');
  el.profileFigure.querySelector('.chart-svg').innerHTML = profile.svg;
  el.profileFigure.querySelector('.chart-caption').innerHTML = measurements.gapExceedsThreshold
    ? `<span>0 km</span><span class="caption-warn">${t('chart.gapLabel', {
        gap: formatNumber(measurements.largestGapM),
      })} ${t('gap.at', { km: formatKm(measurements.largestGapAtM, 1) })}</span><span>${formatKm(
        measurements.distanceM,
        1,
      )} km</span>`
    : `<span>0 km</span><span>${formatKm(measurements.distanceM, 1)} km</span>`;

  positionGapLabel();
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
  el.footerProcessing.innerHTML = `<span>${t('footer.processing.file')}</span><span>${t(
    'footer.processing.url',
  )}</span>`;
  el.footerSource.textContent = t('footer.source');
}

// -------------------------------------------------------------------- wiring

function collect() {
  el.root = document.getElementById('app');
  el.stepOne = document.getElementById('step-one');
  el.skip = document.querySelector('.skip-link');
  el.langButton = document.getElementById('lang-toggle');
  el.heading = document.getElementById('step1-heading');
  el.sub = document.getElementById('step1-sub');
  el.fieldPrefix = document.querySelector('.field-prefix');
  el.input = document.getElementById('route-url');
  el.pasteButton = document.getElementById('paste');
  el.convertButton = document.getElementById('convert');
  el.hint = document.getElementById('step1-hint');
  el.exampleButton = document.getElementById('example');
  el.dropNote = document.querySelector('.drop-note');
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
    el.input.focus();
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

  window.addEventListener('resize', () => {
    if (state.view === 'report') positionGapLabel();
  });
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
render();
el.input.focus();
