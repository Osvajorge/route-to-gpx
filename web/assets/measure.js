// Parses a GPX file and measures the track.
//
// Every number the report shows is computed here, in the visitor's browser,
// from the file itself. Nothing is taken on trust from the source site: the
// site's own published figures are only ever shown next to ours, for
// comparison.

export const EARTH_RADIUS_M = 6371008.8;

// Above this, a straight line between two consecutive points is long enough
// that a watch following the track would cut across untracked ground.
export const DEFAULT_GAP_THRESHOLD_M = 100;

// A rise smaller than this between two samples of the profile is GPS jitter,
// not climbing, and is dropped.
const ASCENT_NOISE_THRESHOLD_M = 1;

// Width of the median filter over the sampled profile. Five samples is enough
// to kill a single bad reading and short enough to leave real steps alone.
const MEDIAN_WINDOW = 5;

export function haversine(a, b) {
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const dLat = lat2 - lat1;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/** Reads the track points out of a GPX document. Throws with a readable
 *  reason when the file is not a GPX or carries no track. */
export function parseGpx(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');

  if (doc.querySelector('parsererror')) {
    throw new TrackError('not_xml');
  }
  const root = doc.documentElement;
  if (!root || root.localName !== 'gpx') {
    throw new TrackError('not_gpx');
  }

  // Track points first; a route (<rtept>) is the fallback for planned routes
  // exported without a recording.
  let nodes = Array.from(doc.getElementsByTagName('trkpt'));
  if (nodes.length === 0) nodes = Array.from(doc.getElementsByTagName('rtept'));
  if (nodes.length < 2) throw new TrackError('no_track');

  const points = [];
  for (const node of nodes) {
    const lat = Number(node.getAttribute('lat'));
    const lon = Number(node.getAttribute('lon'));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const eleNode = node.getElementsByTagName('ele')[0];
    const ele = eleNode ? Number(eleNode.textContent) : null;
    // Read but never measured with. It is here so the re-arranger can say how
    // many points carry a recorded time before it drops them: changing the
    // order of a recording makes its times wrong, and losing them silently is
    // the failure this page is not allowed to have.
    const timeNode = node.getElementsByTagName('time')[0];
    const time = timeNode ? timeNode.textContent.trim() : '';
    points.push({ lat, lon, ele: Number.isFinite(ele) ? ele : null, time: time || null });
  }
  if (points.length < 2) throw new TrackError('no_track');

  return {
    name: textOf(doc, 'trk', 'name') || textOf(doc, 'metadata', 'name') || null,
    link: linkOf(doc),
    points,
  };
}

function textOf(doc, parentTag, childTag) {
  const parent = doc.getElementsByTagName(parentTag)[0];
  if (!parent) return null;
  const child = parent.getElementsByTagName(childTag)[0];
  return child ? child.textContent.trim() : null;
}

function linkOf(doc) {
  const link = doc.getElementsByTagName('link')[0];
  return link ? link.getAttribute('href') : null;
}

export class TrackError extends Error {
  constructor(reason) {
    super(reason);
    this.reason = reason;
  }
}

/** Cumulative ascent and descent, dropping steps smaller than `threshold`.
 *  Pass threshold 0 for the raw figure, which is what most portals publish. */
function accumulate(elevations, threshold) {
  let gain = 0;
  let loss = 0;
  for (let i = 1; i < elevations.length; i++) {
    const change = elevations[i] - elevations[i - 1];
    if (change > threshold) gain += change;
    else if (change < -threshold) loss -= change;
  }
  return { gain, loss };
}

/** Median filter. Removes a single bad elevation reading without eating a
 *  real climb, which a mean filter would. */
function median(values, window = MEDIAN_WINDOW) {
  const half = window >> 1;
  return values.map((_, i) => {
    const slice = values
      .slice(Math.max(0, i - half), Math.min(values.length, i + half + 1))
      .sort((a, b) => a - b);
    return slice[slice.length >> 1];
  });
}

/** Elevation sampled at a fixed step along the track.
 *
 *  Dense recordings put consecutive points a couple of metres apart, so every
 *  single elevation change falls under the noise threshold and the accumulator
 *  throws the whole climb away. Sampling at a fixed along-track step fixes it.
 *
 *  Never sample finer than the track's own spacing: interpolating extra points
 *  splits each real climb into changes under the threshold and loses it the
 *  same way. A track recorded every 19.5 m, resampled to 5 m, reported 120 m of
 *  ascent where the real figure was 624 m. */
function resampleByDistance(points, cumulative, step) {
  const withElevation = [];
  for (let i = 0; i < points.length; i++) {
    if (points[i].ele !== null) withElevation.push([cumulative[i], points[i].ele]);
  }
  if (withElevation.length < 2) return [];

  const samples = [];
  const end = withElevation[withElevation.length - 1][0];
  let cursor = 0;
  for (let distance = 0; distance <= end; distance += step) {
    while (cursor < withElevation.length - 2 && withElevation[cursor + 1][0] < distance) {
      cursor++;
    }
    const [d0, e0] = withElevation[cursor];
    const [d1, e1] = withElevation[cursor + 1];
    samples.push(d1 === d0 ? e0 : e0 + ((e1 - e0) * (distance - d0)) / (d1 - d0));
  }
  return samples;
}

/**
 * Measures a parsed track.
 *
 * @param {{points: Array}} track
 * @param {number} gapThreshold  metres; above this a gap is called out
 * @returns measurements, distances in metres unless the name says otherwise
 */
export function measure(track, gapThreshold = DEFAULT_GAP_THRESHOLD_M) {
  const points = track.points;

  const cumulative = [0];
  const steps = [];
  for (let i = 1; i < points.length; i++) {
    const step = haversine(points[i - 1], points[i]);
    steps.push(step);
    cumulative.push(cumulative[i - 1] + step);
  }
  const distance = cumulative[cumulative.length - 1];

  let largestGap = 0;
  let largestGapAt = 0;
  for (let i = 0; i < steps.length; i++) {
    if (steps[i] > largestGap) {
      largestGap = steps[i];
      largestGapAt = cumulative[i];
    }
  }

  const elevations = points.map((p) => p.ele).filter((e) => e !== null);
  const nativeSpacing = steps.length ? distance / steps.length : 0;
  // Returned, not just used. Ascent is the output of three parameters and the
  // page showed none of them, next to a gap figure that showed its one. This
  // is the parameter that moves the number, so it is the one the tile prints.
  const sampleStep = Math.max(10, nativeSpacing);
  const samples = resampleByDistance(points, cumulative, sampleStep);

  const smoothed = samples.length
    ? accumulate(median(samples), ASCENT_NOISE_THRESHOLD_M)
    : { gain: 0, loss: 0 };
  const raw = elevations.length ? accumulate(elevations, 0) : { gain: 0, loss: 0 };

  return {
    distanceM: distance,
    ascentM: smoothed.gain,
    descentM: smoothed.loss,
    rawAscentM: raw.gain,
    elevationMinM: elevations.length ? Math.min(...elevations) : null,
    elevationMaxM: elevations.length ? Math.max(...elevations) : null,
    pointCount: points.length,
    pointsWithElevation: elevations.length,
    meanSpacingM: nativeSpacing,
    sampleStepM: sampleStep,
    medianWindow: MEDIAN_WINDOW,
    ascentNoiseM: ASCENT_NOISE_THRESHOLD_M,
    largestGapM: largestGap,
    largestGapAtM: largestGapAt,
    gapThresholdM: gapThreshold,
    gapExceedsThreshold: largestGap > gapThreshold,
    cumulative,
  };
}

/** Rebuilds a clean GPX 1.1 file, recording where the track came from.
 *
 *  `notes` is an optional plain sentence saying what was done to the track,
 *  written into the description in both places a reader might look.
 *
 *  NO POINT IN A FILE THIS FUNCTION WRITES EVER CARRIES A TIME, and that is a
 *  rule, not an omission. A time on a track point is a claim that somebody
 *  stood there at that instant, and the only honest source for one is a
 *  recording of somebody standing there. The competitor stamps a time on every
 *  point of routes nobody has ever walked: the span is the source site's
 *  estimated duration to the second, and the first instant is the day the route
 *  was drawn. We rebuild geometry, so we write geometry. */
export function buildGpx(track, source, notes = null) {
  const escape = (text) =>
    String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  const name = escape(track.name || source.title || 'Route');
  const link = source.url
    ? `<link href="${escape(source.url)}"><text>${escape(source.label || 'source')}</text></link>`
    : '';
  // GPX 1.1 fixes the order of these children, so the description goes after
  // the name and before the link in <metadata>, and after the name in <trk>.
  // A file that reads correctly and validates costs the same as one that does
  // not.
  const desc = notes ? `<desc>${escape(notes)}</desc>` : '';

  const body = track.points
    .map((p) => {
      const ele = p.ele === null ? '' : `<ele>${p.ele.toFixed(1)}</ele>`;
      return `    <trkpt lat="${p.lat.toFixed(6)}" lon="${p.lon.toFixed(6)}">${ele}</trkpt>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="route-to-gpx" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${name}</name>${desc}${link}</metadata>
  <trk><name>${name}</name>${desc}<trkseg>
${body}
  </trkseg></trk>
</gpx>
`;
}
