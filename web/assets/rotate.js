// Re-arranging a route, and the honest accounting for what that costs.
//
// Two changes are offered: turn the route around, and on a ring, start it
// somewhere else. Everything here is arithmetic over a list of points, so it
// runs and is tested without a browser, and nothing here writes a file or
// draws anything.
//
// THE REASON THIS MODULE EXISTS AT ALL. Moving the start of a ring that does
// not quite close takes the distance between its two ends and puts it in the
// middle of the track, as a straight line across ground nobody recorded. That
// is precisely the thing this whole product measures and calls a gap. So it is
// measured here too, handed back with every arrangement as `seamM`, and never
// left in the file for somebody to find on the hill.

import { haversine } from './measure.js';

/** Length of a path, in metres. Same arithmetic the report uses, kept here so
 *  the loop rule can be checked on its own. */
export function pathLengthM(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += haversine(points[i - 1], points[i]);
  return total;
}

// ------------------------------------------------------------- the loop rule
//
// WHEN IS A TRACK A RING?
//
// The competitor asks one question of every route: are the two ends within
// 500 m of each other? That asks the same thing of a 2 km stroll and a 140 km
// ride, and it is the wrong question for both. Half a kilometre is a quarter of
// the stroll and a third of a percent of the ride.
//
// So the separation between the ends is read against the length of the route
// that comes back to them: a track is a ring when its ends are within 2% of the
// distance walked. Two bounds keep that sensible at the extremes.
//
//   floor    Below 30 m we would be calling GPS noise an open track. Two
//            readings of the same gate post, under trees, differ by more than
//            a walker ever would.
//   ceiling  Above a kilometre the fraction stops meaning anything. A kilometre
//            of unrecorded ground is not a rounding error, however long the
//            ride was.
//
// Being a ring and being safe to rotate are two different questions, kept
// apart on purpose. This rule decides only whether moving the start is a
// meaningful thing to offer. What it costs is a separate measurement, `seamM`,
// which is stated every time and warned about when it crosses the same gap
// threshold the report uses.
export const LOOP_FRACTION = 0.02;
export const LOOP_FLOOR_M = 30;
export const LOOP_CEILING_M = 1000;

/** How far apart the two ends of a route this long are allowed to be before it
 *  stops being a ring. */
export function loopToleranceM(distanceM) {
  const share = distanceM * LOOP_FRACTION;
  return Math.min(LOOP_CEILING_M, Math.max(LOOP_FLOOR_M, share));
}

/** True when the file literally repeats its first point at the end.
 *
 *  Exact equality, not a tolerance. A recording whose two ends are thirty
 *  centimetres apart has two real points there and both of them stay in the
 *  file: dropping one to make a tidy ring would be editing somebody's recording
 *  to fit our idea of its shape. Rotating such a track opens a thirty
 *  centimetre seam, which is measured and reported like any other and rounds to
 *  nothing. */
function repeatsFirstPoint(points) {
  const first = points[0];
  const last = points[points.length - 1];
  return first.lat === last.lat && first.lon === last.lon;
}

/**
 * What the two ends of a track say about its shape.
 *
 * @param points      the recording, in the order it was made
 * @param distanceM   its length; measured here when the caller has not got it
 * @returns {{closingM, toleranceM, distanceM, isLoop, closed}}
 *          `closed` means the file repeats its first point at the end, so
 *          moving the start costs nothing at all.
 */
export function loopCheck(points, distanceM = pathLengthM(points)) {
  const closingM = points.length < 2 ? 0 : haversine(points[0], points[points.length - 1]);
  const toleranceM = loopToleranceM(distanceM);
  return {
    closingM,
    toleranceM,
    distanceM,
    isLoop: closingM <= toleranceM,
    closed: points.length >= 2 && repeatsFirstPoint(points),
  };
}

/** How many different points the start can be moved to.
 *
 *  One fewer than the file holds when the file repeats its first point at the
 *  end, because that repeat is the same place, not another choice. */
export function ringLength(points) {
  return repeatsFirstPoint(points) ? points.length - 1 : points.length;
}

// ----------------------------------------------------------- the arrangement

/**
 * The route with the two changes applied, and the measurement of what they
 * cost.
 *
 * The order is: move the start, then turn it around. That is the order the
 * interface reads in, so "start here, and go the other way" produces a track
 * that starts at the chosen point and runs backwards from it.
 *
 * Nothing is thrown away, ever. Every point in the recording is in the result,
 * which is why the count is preserved in both branches below and why there is
 * no trimming here at all: the competitor's slider destroys the head of a
 * non-loop with no way back, and a tool that quietly deletes half a walk is
 * worse than one that does nothing.
 *
 * @returns {{points, reversed, startIndex, seamIndex, seamM}}
 *          `seamIndex` is the index of the point on the far side of the seam,
 *          or -1 when the arrangement opened none. `seamM` is how wide it is.
 */
export function arrange(points, options = {}) {
  const reversed = options.reverse === true;
  const ring = ringLength(points);
  const asked = Number.isFinite(options.startIndex) ? Math.trunc(options.startIndex) : 0;
  const startIndex = ring > 0 ? ((asked % ring) + ring) % ring : 0;

  const closed = repeatsFirstPoint(points);
  let out;
  let seamIndex = -1;

  if (startIndex === 0) {
    out = points.slice();
  } else if (closed) {
    // A real ring. The repeated point at the end is dropped, the ring is turned
    // to the chosen start, and the new first point is repeated at the end in
    // its place. Every edge in the result is an edge that was recorded, the
    // count is what it was, and the file still closes exactly.
    const nodes = points.slice(0, points.length - 1);
    out = [...nodes.slice(startIndex), ...nodes.slice(0, startIndex)];
    out.push({ ...out[0] });
  } else {
    // A ring that does not quite close. Turning it moves the join between the
    // recording's last point and its first point out of the ends, where it was
    // only a shape, and into the middle, where it becomes a straight line the
    // walker will be asked to follow. It lands right after the old last point.
    out = [...points.slice(startIndex), ...points.slice(0, startIndex)];
    seamIndex = points.length - startIndex;
  }

  if (reversed) {
    out = out.slice().reverse();
    // The two points either side of the seam are still next to each other, at
    // the mirrored position.
    if (seamIndex > 0) seamIndex = out.length - seamIndex;
  }

  const seamM = seamIndex > 0 ? haversine(out[seamIndex - 1], out[seamIndex]) : 0;
  return { points: out, reversed, startIndex, seamIndex, seamM };
}

/**
 * Which point of the recording an arranged point is.
 *
 * The exact inverse of the shuffle above, and it exists for the map. A visitor
 * points at the drawing in front of them, which is the arrangement; the slider,
 * the file name and every other number here count points in the order the
 * recording was made. One of the two has to be translated, and translating it
 * beside the shuffle it undoes is the only way the two stay in step.
 *
 * `index` is a position in `arrangement.points`. What comes back is a position
 * in the recording, which is what `arrange` takes as `startIndex`, so pointing
 * at a place on the map and moving the slider to it are the same act.
 */
export function sourceIndexOf(arrangement, index) {
  const points = arrangement.points;
  const ring = ringLength(points);
  if (ring <= 0) return 0;
  const inRange = Math.min(points.length - 1, Math.max(0, Math.trunc(index)));
  // Reversing happens last, so it is undone first.
  const before = arrangement.reversed ? points.length - 1 - inRange : inRange;
  return (((before + arrangement.startIndex) % ring) + ring) % ring;
}

// ------------------------------------------------------------- the timestamps

/** How many points carry a recorded time.
 *
 *  Counted so the interface can say what is about to be lost. Reversing a
 *  recording makes its times wrong, and so does starting it somewhere else, so
 *  the file we write leaves them out; the one thing that must not happen is
 *  that happening quietly. Nothing is ever invented to replace them. */
export function countTimes(points) {
  let carried = 0;
  for (const point of points) if (point.time) carried++;
  return carried;
}

// -------------------------------------------------------------- the file name

/** A file name that says what was done to the route.
 *
 *  Every variant of the competitor's download has the same name, so three of
 *  them in a downloads folder are three identical rows. These say which is
 *  which.
 *
 *  The kilometre is written with a full stop whatever language the page is in.
 *  A file name is not prose: a decimal comma in one is awkward on several
 *  systems and reads as a separator in every file list. */
export function changedFileName(fileName, change = {}) {
  const base = String(fileName || 'route.gpx').replace(/\.gpx$/i, '');
  const parts = [];
  if (change.reversed) parts.push('reversed');
  if (typeof change.startKm === 'number' && Number.isFinite(change.startKm)) {
    parts.push(`start-km${change.startKm.toFixed(1)}`);
  }
  return parts.length === 0 ? `${base}.gpx` : `${base}-${parts.join('-')}.gpx`;
}
