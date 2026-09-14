// Parses a GPX file and measures the track.
//
// Every number the report shows is computed here, in the visitor's browser,
// from the file itself. Nothing is taken on trust from the source site: the
// site's own published figures are only ever shown next to ours, for
// comparison.

export const EARTH_RADIUS_M = 6371008.8;

// ------------------------------------------------------------- the gap rule
//
// WHAT COUNTS AS A GAP, AND WHY IT CANNOT BE A PLAIN NUMBER OF METRES.
//
// A gap is a straight line between two consecutive points that a watch will
// draw across ground nobody recorded. For years this page called that any step
// over 100 m, and a fixed number of metres is the wrong question asked twice:
//
//   too low for a drawn route. A planned route exported at 150 m spacing has
//   every step over 100 m, so the page reported the whole route as straight
//   line across untracked ground. A 150 m straight on a route drawn at 150 m
//   spacing is a straight road, not a hole.
//   too high for a recording. Twenty holes of 60 m in a track recorded every
//   20 m is 1 200 m of straight line, and every one of them sat under 100 m,
//   so the page reported nothing at all. A watch with intermittent sky view
//   makes exactly that pattern.
//
// So the question is asked against the track's own cadence: a gap is a step
// far outside the spacing this file otherwise keeps. The scale is the 95th
// percentile of the steps, which the holes themselves cannot move because they
// are a few steps in a thousand, and the floor stops a dense recording calling
// its own ordinary variation a hole.
//
// MEASURED, NOT PICKED. Twenty one real files, seventeen recordings and four
// drawn routes, plus the four fixtures. The largest single step in a recording
// with no visible hole in it was 42.4 m; the smallest step that was plainly a
// hole was 58.5 m. The floor sits in that band. The multiple was read off the
// drawn routes: at two, a 221 m straight on a 47 km route is still disclosed;
// at three it disappears.
export const GAP_FLOOR_M = 50;
export const GAP_SPACING_MULTIPLE = 2;

// A rise smaller than this is GPS jitter, not climbing.
//
// IT IS A THRESHOLD ON THE CHANGE OF DIRECTION, NOT ON EACH STEP, and that
// distinction is the whole of it. Applied per sample step it stops being a
// noise filter and becomes a gradient cutoff: at a 10 m step, 1 m per step is
// a 10% grade, so every climb gentler than that was discarded in full. A
// 17 143 point recording of an 800 m col reported an ascent of zero next to an
// elevation range 798 m wide. Applied to the reversal it drops jitter and
// keeps the climb:
//     a gentle 300 m ramp        per step   0    on reversal  300
//     plus-minus 0.4 m of noise  per step   0    on reversal    0
//     noise over a 500 m climb   per step 450    on reversal  501
const ASCENT_NOISE_THRESHOLD_M = 1;

// How many standard deviations of the recording's own jitter a rise has to
// clear before it counts as a climb. Three is the usual line for "this is not
// the noise": under a normal spread it leaves about one reading in 370 able to
// open a leg on its own.
const NOISE_MULTIPLE = 3;

// Below this share of points carrying a height, the ascent figure stops being
// trustworthy enough to print unqualified.
//
// MEASURED, NOT PICKED, and re-measured against the accumulator above rather
// than carried over from the one it replaced. Heights were removed from rolling
// tracks of 4 m to 25 m spacing in every pattern a device actually fails in (a
// run at the head, at the tail, in the middle, and scattered), and the worst
// error in the ascent figure was read off at each coverage:
//
//   99.9%  0.1%     99%   0.6%     95%   9.8%
//   99.5%  0.3%     98%   1.8%     90%  23.2%
//                   97%   4.4%     80%  25.0%
//
// The sample step, which the tile already discloses, moves the same figure by
// 0.4% when it is taken a fifth either side of the value the rule picks. So 99%
// is the first coverage where missing heights beat the parameter this page
// already thought was worth a line. Above it, saying so would be noise on a
// figure nothing is wrong with.
export const ELEVATION_COVERAGE_FLOOR = 0.99;

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

/**
 * Cumulative ascent and descent, ignoring reversals smaller than `threshold`.
 *
 * A climb is committed when the series turns back on itself by more than the
 * threshold, and its size is measured from the last turn to the extreme it
 * reached, however many samples that took. So a rise of a centimetre per
 * sample still accumulates, and a wobble of half a metre either way never
 * does, which is the pair of properties a per step threshold cannot have at
 * once. See ASCENT_NOISE_THRESHOLD_M for what it cost when this was per step.
 *
 * At threshold 0 this is the plain point to point sum, exactly, which is what
 * the raw figure wants.
 */
/** How far the readings scatter around the filtered profile, in metres.
 *
 *  The median filter's own residual, which is what jitter is: the part of each
 *  reading the filter decided was not the shape of the ground. Reading it off
 *  the file rather than assuming it is what lets one threshold serve a
 *  barometric watch on a clear day and a phone under tree cover. */
function jitter(samples, profile) {
  const count = Math.min(samples.length, profile.length);
  if (count < 2) return 0;
  let sum = 0;
  for (let i = 0; i < count; i++) sum += samples[i] - profile[i];
  const mean = sum / count;
  let spread = 0;
  for (let i = 0; i < count; i++) spread += (samples[i] - profile[i] - mean) ** 2;
  return Math.sqrt(spread / count);
}

function accumulate(elevations, threshold) {
  const count = elevations.length;
  if (count < 2) return { gain: 0, loss: 0 };

  let gain = 0;
  let loss = 0;
  // The leg in progress: which way it runs, the height it started from, and
  // the furthest it has got. `low` and `high` hold the extremes seen before
  // any leg is confirmed, so a climb is measured from the true valley rather
  // than from whichever sample the file happens to open on.
  let direction = 0;
  let legStart = elevations[0];
  let pivot = elevations[0];
  let low = elevations[0];
  let high = elevations[0];

  for (let i = 1; i < count; i++) {
    const height = elevations[i];
    if (direction === 0) {
      if (height > low + threshold) {
        direction = 1;
        legStart = low;
        pivot = height;
      } else if (height < high - threshold) {
        direction = -1;
        legStart = high;
        pivot = height;
      } else {
        if (height < low) low = height;
        if (height > high) high = height;
      }
    } else if (direction === 1) {
      if (height > pivot) pivot = height;
      else if (height < pivot - threshold) {
        gain += pivot - legStart;
        legStart = pivot;
        direction = -1;
        pivot = height;
      }
    } else if (height < pivot) {
      pivot = height;
    } else if (height > pivot + threshold) {
      loss += legStart - pivot;
      legStart = pivot;
      direction = 1;
      pivot = height;
    }
  }

  if (direction === 1) gain += pivot - legStart;
  else if (direction === -1) loss += legStart - pivot;
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
 *  a boundary, so moving the start moves which ground gets the short window and
 *  the reported ascent changes with nothing added or removed. Measured across
 *  seven ring geometries and seven starts each, ascent drift with the window
 *  clamped at the ends against the window wrapped:
 *      side 900 step 18   3.261% -> 0.001%    side 1000 step 18      3.326% -> 0.093%
 *      side 900 step 17   3.396% -> 0.089%    side 900 step 18 noisy 3.202% -> 0.076%
 *      side 900 step 23   5.023% -> 0.228%    side 900 step 6        1.769% -> 0.003%
 *                                             side 900 step 6 noisy  1.685% -> 0.028%
 *  The earlier defence of this wrap quoted 0.0% from one fixture whose step
 *  divided its perimeter exactly, and that single figure was an artefact. The
 *  wrap is kept because it holds across every geometry above, not because of
 *  the fixture. */
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
 *  Dense recordings put consecutive points a couple of metres apart, so the
 *  profile is resampled before anything is accumulated from it.
 *
 *  Never sample finer than the track's own spacing: interpolating extra points
 *  invents detail the recording does not have. A track recorded every 19.5 m,
 *  resampled to 5 m, reported 120 m of ascent where the real figure was 624 m.
 *
 *  THE GRID RUNS BETWEEN THE FIRST AND LAST RECORDED HEIGHT, AND NOT ONE METRE
 *  OUTSIDE THEM. It used to start at distance zero while taking its first
 *  height from the first point that carried one, which extrapolated the
 *  opening leg backwards over ground with no height in the file at all. On a
 *  track missing heights for its first 2 km and then descending at 30%, that
 *  invented 594 m of ceiling, printed it as the elevation range with no note,
 *  and scaled the profile's own axis to it. The invention was the grade of the
 *  first recorded leg times the length of the head, so it had no bound.
 *
 *  The last sample lands exactly on the last recorded height rather than one
 *  whole step short of it, so neither end of the profile is a stretch of the
 *  route the grid happened to miss. */
function resampleByDistance(points, cumulative, step) {
  const withElevation = [];
  for (let i = 0; i < points.length; i++) {
    if (points[i].ele !== null) withElevation.push([cumulative[i], points[i].ele]);
  }
  if (withElevation.length < 2) return [];

  const start = withElevation[0][0];
  const end = withElevation[withElevation.length - 1][0];
  // Built by multiplication rather than by repeated addition so a long track
  // cannot drift a whole extra sample onto the end of its own grid.
  const grid = [];
  for (let k = 0; ; k++) {
    const distance = start + k * step;
    if (distance >= end) break;
    grid.push(distance);
  }
  grid.push(end);

  const samples = [];
  let cursor = 0;
  for (const distance of grid) {
    while (cursor < withElevation.length - 2 && withElevation[cursor + 1][0] < distance) {
      cursor++;
    }
    const [d0, e0] = withElevation[cursor];
    const [d1, e1] = withElevation[cursor + 1];
    samples.push(d1 === d0 ? e0 : e0 + ((e1 - e0) * (distance - d0)) / (d1 - d0));
  }
  return samples;
}

/** How far the median filter can move a single reading on a file with nothing
 *  wrong with it.
 *
 *  A median shaves any extreme narrower than half its window, so the published
 *  range sits inside the file's own range on every real recording, and a flat
 *  allowance called that the file's fault. On a clean 6% ramp it printed
 *  "1,001-1,599, file holds 1,000-1,600"; on twelve of twenty one real files it
 *  printed the same kind of nothing.
 *
 *  The allowance is the profile's own relief across the filter window, which is
 *  exactly what the window can shave. Two readings of it:
 *
 *    the ordinary case  the 95th percentile of that relief over the whole
 *                       profile. Not the largest, because the largest is set by
 *                       the one steepest place on the route and would hide a
 *                       real removal anywhere else: on a 7.5 km walk the worst
 *                       relief was 72.7 m against an ordinary 13.5 m.
 *    the two ends       where the window is truncated and the filter has no
 *                       choice, so their own relief is taken whatever the rest
 *                       of the profile does. On a ring the window wraps, there
 *                       are no ends, and this term is zero.
 *
 *  MEASURED. Across twenty one files, the 95th percentile is the first quantile
 *  at which every artefact goes quiet and the one real removal stays: a walk
 *  whose file holds a reading 60.3 m below anything else on the route. At the
 *  90th, two files still report their own filter back to the reader. */
function filterEffectM(profile, window, ring) {
  const half = window >> 1;
  const count = profile.length;
  if (count < 2 || half === 0) return 0;

  const relief = profile.map((_, i) => {
    let low = Infinity;
    let high = -Infinity;
    for (let k = i - half; k <= i + half; k++) {
      if (!ring && (k < 0 || k >= count)) continue;
      const height = profile[(((k % count) + count) % count)];
      if (height < low) low = height;
      if (height > high) high = height;
    }
    return high - low;
  });

  const sorted = relief.slice().sort((a, b) => a - b);
  const ordinary = sorted[Math.floor(0.95 * (count - 1))];
  const ends = ring ? 0 : Math.max(relief[0], relief[count - 1]);
  return Math.max(ordinary, ends);
}

/** The step size a file of this cadence has to beat to be called a gap. See
 *  GAP_FLOOR_M for the sweep behind both numbers. */
export function gapThresholdFor(steps) {
  if (steps.length === 0) return GAP_FLOOR_M;

  // THE MIDDLE STEP, NOT THE 95TH PERCENTILE, and the difference is not a
  // refinement: the percentile made the threshold vanish exactly when it was
  // needed most.
  //
  // A statistic used to define "an ordinary step" must not be reachable by the
  // thing it is used to detect. At the 95th percentile, a recording where more
  // than one step in twenty is a hole has a HOLE as its ordinary step, so the
  // threshold becomes a multiple of the hole and every hole falls under it.
  // Measured on 1000 steps of 10 m with holes of 150 m:
  //     50 holes  (5%)   threshold  50 m   disclosed 7,342 m
  //     60 holes  (6%)   threshold 300 m   disclosed     0 m
  //    200 holes (20%)   threshold 300 m   disclosed     0 m
  // The worse the recording, the less of it was reported, which is exactly
  // backwards. The same files against the middle step: 8,840 m, 14,833 m and
  // 29,817 m, all disclosed.
  //
  // The median cannot be moved there by any minority of holes, and a recording
  // more than half made of holes has no ordinary cadence to speak of anyway.
  const sorted = steps.slice().sort((a, b) => a - b);
  const middle = sorted[sorted.length >> 1];
  return Math.max(GAP_FLOOR_M, GAP_SPACING_MULTIPLE * middle);
}

/**
 * Measures a parsed track.
 *
 * @param {{points: Array}} track
 * @param {number|null} gapThreshold  metres; null reads it off the track's own
 *                                    spacing, which is what the page does
 * @returns measurements, distances in metres unless the name says otherwise
 */
export function measure(track, gapThreshold = null) {
  const points = track.points;

  const cumulative = [0];
  const steps = [];
  for (let i = 1; i < points.length; i++) {
    const step = haversine(points[i - 1], points[i]);
    steps.push(step);
    cumulative.push(cumulative[i - 1] + step);
  }
  const distance = cumulative[cumulative.length - 1];

  const threshold = gapThreshold === null ? gapThresholdFor(steps) : gapThreshold;

  let largestGap = 0;
  let largestGapAt = 0;
  // How much of `distance` above is a straight line across ground nobody
  // recorded. Every gap over the threshold, not just the widest one: the
  // distance is a sum, so what it absorbed is a sum too. On a track with three
  // holes the widest was 1 091 m and the straight ground was 2 731 m, so the
  // largest gap would have understated the borrowed distance by two and a half
  // times.
  //
  // IT IS A FLOOR ON WHAT WAS MISSED, NOT A CORRECTION TO SUBTRACT. Each chord
  // counted here is a straight line, and the walker covered at least that and
  // almost certainly more, so `distance` minus this figure is not the walk: it
  // is shorter than the walk by everything the chord already stood in for.
  let gapTotal = 0;
  for (let i = 0; i < steps.length; i++) {
    if (steps[i] > largestGap) {
      largestGap = steps[i];
      largestGapAt = cumulative[i];
    }
    if (steps[i] > threshold) gapTotal += steps[i];
  }

  const elevations = points.map((p) => p.ele).filter((e) => e !== null);
  const nativeSpacing = steps.length ? distance / steps.length : 0;
  // Returned, not just used. Ascent is the output of three parameters and the
  // page showed none of them, next to a gap figure that showed its one. This
  // is the parameter that moves the number, so it is the one the tile prints.
  const sampleStep = Math.max(10, nativeSpacing);

  // A ring only for the purpose of the seam: two ends that fall inside a
  // single sample are one sample, so the filter's window reaches across them
  // rather than treating the file's first point as an edge of the world.
  //
  // THE BOUND IS THE SAMPLE STEP BECAUSE THAT IS THE RESOLUTION THIS QUESTION
  // HAS. It used to be a flat two metres, and a flat number put a cliff in the
  // middle of nothing: ends 1.999 m apart were wrapped and ends 2.0005 m apart
  // were not, so a file changed by a millimetre and a half changed its
  // reported descent by 19.5 m. Whether a route is worth offering to rotate is
  // a different question with a different answer, and rotate.js keeps it.
  const ring =
    points.length > 2 && haversine(points[0], points[points.length - 1]) <= sampleStep;

  const samples = resampleByDistance(points, cumulative, sampleStep);

  // The same filtered series the ascent is accumulated from, kept so the
  // elevation range can be read off it too.
  const profile = samples.length ? median(samples, MEDIAN_WINDOW, ring) : [];

  // The threshold comes off the recording's own jitter, not off a constant.
  //
  // A fixed metre was two mistakes in a row. Applied per step it was a GRADIENT
  // cutoff and threw away every climb gentler than threshold over step, which
  // is how an 800 m col on a 1 Hz watch came to report nothing at all. Applied
  // to the change of direction it stopped doing that, and started doing the
  // opposite: gaussian jitter on flat ground crosses a fixed metre often
  // enough that each crossing commits a little climb. Measured on 10 km of dead
  // level ground, where the truth is zero:
  //     jitter 0.5 m   10.7 m reported     jitter 1.5 m   126.7 m
  //     jitter 1.0 m   63.4 m              jitter 2.0 m   185.0 m
  //
  // A metre means nothing on its own. What decides whether a rise is real is
  // whether it is bigger than the spread of the readings it is made of, so the
  // threshold is three times the measured spread, floored at the old metre so a
  // very clean recording is not accumulated raw. Same ground, same filter:
  //     jitter 0.5 m    2.9 m reported     jitter 1.5 m     8.8 m
  //     jitter 1.0 m    5.9 m              jitter 2.0 m    11.8 m
  // and a real 500 m climb under 1 m of jitter still reports 498.5 m.
  //
  // It does not reach zero, and it should not: with two metres of spread in the
  // readings, nobody can tell flat ground from ten metres of drift, and a
  // figure that claimed to would be inventing certainty.
  const ascentThreshold = profile.length
    ? Math.max(ASCENT_NOISE_THRESHOLD_M, NOISE_MULTIPLE * jitter(samples, profile))
    : ASCENT_NOISE_THRESHOLD_M;

  const smoothed = profile.length
    ? accumulate(profile, ascentThreshold)
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
    // disagree by more than this estimator's own end effect.
    elevationMinM: profile.length ? Math.min(...profile) : elevations.length ? Math.min(...elevations) : null,
    elevationMaxM: profile.length ? Math.max(...profile) : elevations.length ? Math.max(...elevations) : null,
    rawElevationMinM: elevations.length ? Math.min(...elevations) : null,
    rawElevationMaxM: elevations.length ? Math.max(...elevations) : null,
    elevationFilterEffectM: filterEffectM(profile, MEDIAN_WINDOW, ring),
    pointCount: points.length,
    pointsWithElevation: elevations.length,
    meanSpacingM: nativeSpacing,
    sampleStepM: sampleStep,
    medianWindow: MEDIAN_WINDOW,
    ascentNoiseM: ascentThreshold,
    largestGapM: largestGap,
    largestGapAtM: largestGapAt,
    gapTotalM: gapTotal,
    gapThresholdM: threshold,
    gapExceedsThreshold: largestGap > threshold,
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
