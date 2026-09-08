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

// Below this share of points carrying a height, the ascent figure stops being
// trustworthy enough to print unqualified.
//
// MEASURED, NOT PICKED. Heights were removed from tracks of 4 m to 25 m spacing
// in every pattern a device actually fails in (a run at the head, at the tail,
// in the middle, and scattered), and the worst error in the ascent figure was
// read off at each coverage:
//
//   99%   1.5%       97%  10.9%       90%  23.4%
//   98%   4.2%       95%  24.3%       80%  33.4%
//
// The sample step, which the tile already discloses, moves the same figure by
// 1.6%. So 99% is where missing heights start moving ascent by more than the
// parameter this page already thought was worth a line. Above it, saying so
// would be noise on a figure nothing is wrong with.
export const ELEVATION_COVERAGE_FLOOR = 0.99;

// Width of the median filter over the sampled profile. Five samples is enough
// to kill a single bad reading and short enough to leave real steps alone.
const MEDIAN_WINDOW = 5;

// Two ends this close are the same place: a recording that came back to where
// it started, rather than one that finished nearby. Below this the seam is
// continuous ground and the filter reaches across it; above it the track has
// real ends and keeps them.
const RING_CLOSES_WITHIN_M = 2;

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
function accumulate(elevations, threshold, ring = false) {
  let gain = 0;
  let loss = 0;
  // On a ring the step from the last sample back to the first is ground that
  // was walked, so it counts. Leaving it out is what made a rotated ring
  // measure differently from the same ring unrotated.
  const last = ring ? elevations.length : elevations.length - 1;
  for (let i = 1; i <= last; i++) {
    const change = elevations[i % elevations.length] - elevations[i - 1];
    if (change > threshold) gain += change;
    else if (change < -threshold) loss -= change;
  }
  return { gain, loss };
}

/** Median filter. Removes a single bad elevation reading without eating a
 *  real climb, which a mean filter would.
 *
 *  `ring` makes the window wrap, and that is not a refinement: it is the
 *  difference between measuring a loop and measuring a loop cut open at an
 *  arbitrary point.
 *
 *  A closed ring has no first sample and no last one. Filtering it with a
 *  truncated window at each end treats whatever the file happens to start at as
 *  a boundary, so moving the start moved which ground got the short window and
 *  the reported ascent changed with nothing added or removed. Measured on a 600
 *  point ring over eight different starts:
 *      window clamped at the ends   1218.1 to 1238.6 m, a drift of 20.5 m
 *      window wrapped               1238.6 m at every start, drift 0.03 m
 *  The re-arranger was reporting that spread as though rearranging had caused
 *  it, when it was the measurement's own seam. */
function median(values, window = MEDIAN_WINDOW, ring = false) {
  const half = window >> 1;
  const count = values.length;
  return values.map((_, i) => {
    const slice = ring
      ? Array.from({ length: window }, (_, k) => values[(((i + k - half) % count) + count) % count])
      : values.slice(Math.max(0, i - half), Math.min(count, i + half + 1));
    const sorted = slice.slice().sort((a, b) => a - b);
    return sorted[sorted.length >> 1];
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
  // How much of `distance` above is a straight line across ground nobody
  // recorded. Every gap over the threshold, not just the widest one: the
  // distance is a sum, so what it absorbed is a sum too. On a track with three
  // holes the widest was 1 091 m and the straight ground was 2 731 m, so the
  // largest gap would have understated the borrowed distance by two and a half
  // times.
  let gapTotal = 0;
  for (let i = 0; i < steps.length; i++) {
    if (steps[i] > largestGap) {
      largestGap = steps[i];
      largestGapAt = cumulative[i];
    }
    if (steps[i] > gapThreshold) gapTotal += steps[i];
  }

  const elevations = points.map((p) => p.ele).filter((e) => e !== null);
  const nativeSpacing = steps.length ? distance / steps.length : 0;
  // Returned, not just used. Ascent is the output of three parameters and the
  // page showed none of them, next to a gap figure that showed its one. This
  // is the parameter that moves the number, so it is the one the tile prints.
  const sampleStep = Math.max(10, nativeSpacing);

  // A ring only for the purpose of the seam, and the test is strict on purpose:
  // two ends within a couple of metres is a recording that really did close,
  // not one that came near. A route that merely ends close to its start has
  // ends, and wrapping ground nobody walked would invent a climb.
  const ring =
    points.length > 2 && haversine(points[0], points[points.length - 1]) <= RING_CLOSES_WITHIN_M;

  const samples = resampleByDistance(points, cumulative, sampleStep, ring);

  // The same filtered series the ascent is accumulated from, kept so the
  // elevation range can be read off it too.
  const profile = samples.length ? median(samples, MEDIAN_WINDOW, ring) : [];
  const smoothed = profile.length
    ? accumulate(profile, ASCENT_NOISE_THRESHOLD_M, ring)
    : { gain: 0, loss: 0 };
  const raw = elevations.length ? accumulate(elevations, 0) : { gain: 0, loss: 0 };

  return {
    distanceM: distance,
    ascentM: smoothed.gain,
    descentM: smoothed.loss,
    rawAscentM: raw.gain,
    // THE RANGE IS READ OFF THE FILTERED PROFILE, and the raw one is handed
    // back beside it.
    //
    // Ascent has had a median filter since the beginning and the range never
    // did, so they sat in the same report with one defended and the other not,
    // and nothing said which. Measured on a 500 point track with one bad
    // reading in it, the kind a barometer produces going through a door:
    //     ascent            447 -> 447 m    unmoved, the filter caught it
    //     raw ascent        450 -> 1149 m   +155%
    //     elevation ceiling 550 -> 1175 m   +114%
    // and the ceiling sets the profile's own axis, so one reading squashed the
    // whole drawing into the bottom of its box.
    //
    // The published range now describes the ground. `rawElevation` keeps what
    // is literally in the file, so a reading this filter removed can still be
    // seen rather than quietly disappearing, and the report says when the two
    // disagree.
    elevationMinM: profile.length ? Math.min(...profile) : elevations.length ? Math.min(...elevations) : null,
    elevationMaxM: profile.length ? Math.max(...profile) : elevations.length ? Math.max(...elevations) : null,
    rawElevationMinM: elevations.length ? Math.min(...elevations) : null,
    rawElevationMaxM: elevations.length ? Math.max(...elevations) : null,
    pointCount: points.length,
    pointsWithElevation: elevations.length,
    meanSpacingM: nativeSpacing,
    sampleStepM: sampleStep,
    medianWindow: MEDIAN_WINDOW,
    ascentNoiseM: ASCENT_NOISE_THRESHOLD_M,
    largestGapM: largestGap,
    largestGapAtM: largestGapAt,
    gapTotalM: gapTotal,
    gapThresholdM: gapThreshold,
    gapExceedsThreshold: largestGap > gapThreshold,
    // The share of the route the profile was actually built from, and whether
    // that share is low enough to change how the ascent above should be read.
    elevationCoverage: points.length ? elevations.length / points.length : 0,
    elevationCoverageLow:
      points.length > 0 && elevations.length / points.length < ELEVATION_COVERAGE_FLOOR,
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
