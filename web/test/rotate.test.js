// Run with:  node --test web/test/
//
// Re-arranging a route is the one place on this page where we create a hole
// rather than find one. Every test here is about that: the count that must not
// change, the ring that must still close, the seam that must be measured and
// named, and the rule that decides whether moving the start is a meaningful
// thing to offer at all. None of it needs a browser.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildGpx,
  DEFAULT_GAP_THRESHOLD_M,
  haversine,
  measure,
} from '../assets/measure.js';
import {
  arrange,
  changedFileName,
  countTimes,
  LOOP_CEILING_M,
  LOOP_FLOOR_M,
  loopCheck,
  loopToleranceM,
  pathLengthM,
  ringLength,
} from '../assets/rotate.js';

const M_PER_DEGREE = 111195;
const EAST_PER_METRE = 1 / (M_PER_DEGREE * Math.cos((42 * Math.PI) / 180));

/** A point `northM` north and `eastM` east of one corner of the Pyrenees. */
function at(northM, eastM, ele = null, time = null) {
  return { lat: 42 + northM / M_PER_DEGREE, lon: 0.7 + eastM * EAST_PER_METRE, ele, time };
}

/** Where a walk `d` metres round a square of side `sideM` has got to. */
function onSquare(d, sideM) {
  if (d <= sideM) return [d, 0];
  if (d <= 2 * sideM) return [sideM, d - sideM];
  if (d <= 3 * sideM) return [sideM - (d - 2 * sideM), sideM];
  return [0, sideM - (d - 3 * sideM)];
}

/**
 * A ring walked anticlockwise round a square.
 *
 * `closeM` is how far short of the start the recording stops. Zero repeats the
 * first point exactly, which is what a watch writes for a lap that closed.
 */
function ring({ sideM, stepM, closeM = 0, withElevation = false }) {
  const total = 4 * sideM;
  const last = total - closeM;
  const points = [];
  for (let d = 0; d < last; d += stepM) {
    const [north, east] = onSquare(d, sideM);
    points.push(at(north, east, withElevation ? 1000 + (200 * d) / total : null));
  }
  if (closeM === 0) {
    points.push({ ...points[0] });
  } else {
    const [north, east] = onSquare(last, sideM);
    points.push(at(north, east, withElevation ? 1200 : null));
  }
  return points;
}

/** The same square ring, carrying a height profile that comes back to where it
 *  started. Rotating this changes not one thing about the ground: every edge in
 *  the result is an edge that was recorded, and each carries the same rise. */
function ringWithClosedProfile({ sideM, stepM, climbs = 3, amplitudeM = 200 }) {
  const total = 4 * sideM;
  const points = [];
  for (let d = 0; d < total; d += stepM) {
    const [north, east] = onSquare(d, sideM);
    const ele = 1400 + (amplitudeM * (1 - Math.cos((climbs * 2 * Math.PI * d) / total))) / 2;
    points.push(at(north, east, ele));
  }
  points.push({ ...points[0] });
  return points;
}

/** A walk from one valley to another. */
function line(totalM, stepM = 100) {
  const points = [];
  for (let d = 0; d <= totalM; d += stepM) points.push(at(d, 0));
  return points;
}

const key = (point) => `${point.lat},${point.lon}`;

// ------------------------------------------------------------------ reversal

test('reversal preserves the point count and carries elevation with its own point', () => {
  const points = ring({ sideM: 500, stepM: 100, withElevation: true });
  const out = arrange(points, { reverse: true });

  assert.equal(out.points.length, points.length);
  for (let i = 0; i < points.length; i++) {
    const twin = points[points.length - 1 - i];
    assert.equal(out.points[i].lat, twin.lat);
    assert.equal(out.points[i].lon, twin.lon);
    assert.equal(out.points[i].ele, twin.ele);
  }
});

test('reversing on its own opens nothing: the two ends are still the two ends', () => {
  const out = arrange(ring({ sideM: 5000, stepM: 50, closeM: 300 }), { reverse: true });
  assert.equal(out.seamIndex, -1);
  assert.equal(out.seamM, 0);
});

// ------------------------------------------------------------------ rotation

test('rotation of a closed loop preserves the count and the closure', () => {
  const points = ring({ sideM: 500, stepM: 50 });
  const out = arrange(points, { startIndex: 7 });

  assert.equal(out.points.length, points.length);
  assert.equal(out.points[0].lat, out.points[out.points.length - 1].lat);
  assert.equal(out.points[0].lon, out.points[out.points.length - 1].lon);
  assert.equal(out.points[0].lat, points[7].lat);
  assert.equal(out.seamIndex, -1);
  assert.equal(out.seamM, 0);
});

test('rotating a ring that really closes leaves its length alone', () => {
  const points = ring({ sideM: 500, stepM: 50 });
  const out = arrange(points, { startIndex: 13 });
  assert.ok(Math.abs(pathLengthM(out.points) - pathLengthM(points)) < 0.001);
});

test('rotation of a near-closing loop opens a measurable seam and reports it', () => {
  // 20 km round, stopping 300 m short of where it started. The recording as it
  // arrived has no hole in it at all.
  const points = ring({ sideM: 5000, stepM: 50, closeM: 300 });
  assert.equal(measure({ points }).gapExceedsThreshold, false);

  const out = arrange(points, { startIndex: 20 });

  assert.equal(out.points.length, points.length);
  assert.ok(out.seamIndex > 0);
  assert.ok(Math.abs(out.seamM - 300) < 5, `seam was ${out.seamM}`);
  // The seam it reports is the edge it actually wrote into the file.
  assert.ok(
    Math.abs(haversine(out.points[out.seamIndex - 1], out.points[out.seamIndex]) - out.seamM) < 1e-6,
  );

  // And the file measures it: the hole this tool made is now the largest gap,
  // and it is over the threshold the report warns at.
  const after = measure({ points: out.points }, DEFAULT_GAP_THRESHOLD_M);
  assert.ok(Math.abs(after.largestGapM - out.seamM) < 1);
  assert.equal(after.gapExceedsThreshold, true);
});

test('nothing is trimmed: every point of the recording is still in the file', () => {
  const points = ring({ sideM: 5000, stepM: 50, closeM: 300 });
  const out = arrange(points, { startIndex: 33, reverse: true });

  assert.equal(out.points.length, points.length);
  assert.deepEqual(new Set(out.points.map(key)), new Set(points.map(key)));
});

test('moving the start to where it already is changes nothing at all', () => {
  const points = ring({ sideM: 500, stepM: 100 });
  const out = arrange(points, { startIndex: 0 });
  assert.deepEqual(out.points, points);
  assert.equal(out.seamM, 0);
});

test('a start index past the end of the ring comes back round to it', () => {
  const points = ring({ sideM: 500, stepM: 100 });
  const nodes = ringLength(points);
  assert.equal(arrange(points, { startIndex: nodes + 3 }).startIndex, 3);
  assert.equal(arrange(points, { startIndex: -1 }).startIndex, nodes - 1);
});

test('a ring that repeats its first point offers one fewer start than it has points', () => {
  const closed = ring({ sideM: 500, stepM: 100 });
  const near = ring({ sideM: 500, stepM: 100, closeM: 40 });
  assert.equal(ringLength(closed), closed.length - 1);
  assert.equal(ringLength(near), near.length);
});

test('reversing after moving the start keeps the seam between the same two points', () => {
  const points = ring({ sideM: 5000, stepM: 50, closeM: 300 });
  const forward = arrange(points, { startIndex: 20 });
  const back = arrange(points, { startIndex: 20, reverse: true });

  assert.equal(back.points.length, forward.points.length);
  assert.ok(Math.abs(back.seamM - forward.seamM) < 1e-6);
  assert.equal(back.seamIndex, forward.points.length - forward.seamIndex);
  assert.deepEqual(
    [key(back.points[back.seamIndex - 1]), key(back.points[back.seamIndex])],
    [key(forward.points[forward.seamIndex]), key(forward.points[forward.seamIndex - 1])],
  );
});

test('rotating a walk from one valley to another is why it is never offered', () => {
  // The whole distance between the two ends lands in the middle of the track.
  const out = arrange(line(10000), { startIndex: 5 });
  assert.ok(out.seamM > 9000, `seam was ${out.seamM}`);
});

// ----------------------------------------------------------------- loop rule

test('the loop rule reads a closed ring, a near ring and a walk from one valley to another', () => {
  const closed = loopCheck(ring({ sideM: 500, stepM: 100 }));
  assert.equal(closed.isLoop, true);
  assert.equal(closed.closed, true);
  assert.equal(closed.closingM, 0);

  const near = loopCheck(ring({ sideM: 5000, stepM: 100, closeM: 300 }));
  assert.equal(near.isLoop, true);
  assert.equal(near.closed, false);
  assert.ok(Math.abs(near.closingM - 300) < 5, `${near.closingM}`);
  assert.ok(Math.abs(near.toleranceM - 400) < 10, `${near.toleranceM}`);

  const valleyToValley = loopCheck(line(10000));
  assert.equal(valleyToValley.isLoop, false);
  assert.equal(valleyToValley.closed, false);
});

test('the same separation is a ring on a long ride and not on a short stroll', () => {
  // The competitor asks one question of both: are the ends within 500 m? So it
  // calls a quarter of a two kilometre walk a closed loop.
  const ends = [at(0, 0), at(0, 480)];
  assert.equal(loopCheck(ends, 2000).isLoop, false);
  assert.equal(loopCheck(ends, 140000).isLoop, true);
});

test('the floor keeps GPS noise from opening a short walk', () => {
  // 2% of 400 m is 8 m, which is inside the spread of two readings of one gate
  // post. The floor is what stops that being called an open track.
  assert.equal(loopToleranceM(400), LOOP_FLOOR_M);
  assert.equal(loopCheck([at(0, 0), at(0, 12)], 400).isLoop, true);
});

test('the ceiling stops the fraction from swallowing a kilometre of missing ground', () => {
  assert.equal(loopToleranceM(500000), LOOP_CEILING_M);
  assert.equal(loopCheck([at(0, 0), at(0, 1400)], 500000).isLoop, false);
});

test('between the two bounds the tolerance is two percent of the route itself', () => {
  assert.ok(Math.abs(loopToleranceM(20000) - 400) < 0.001);
});

// ---------------------------------------------------------------- timestamps

test('the times a recording carries are counted, so they can be named before they go', () => {
  assert.equal(countTimes([{ time: '2024-05-01T08:00:00Z' }, { time: null }, { time: 'x' }]), 2);
  assert.equal(countTimes([{ lat: 1 }, { lat: 2 }]), 0);
});

test('no point in a file we write carries a time, whatever the recording carried', () => {
  const points = [
    { lat: 42, lon: 0.7, ele: 1000, time: '2024-05-01T08:00:00Z' },
    { lat: 42.001, lon: 0.7, ele: 1010, time: '2024-05-01T08:05:00Z' },
  ];
  const gpx = buildGpx({ name: 'Ring', points }, { url: 'https://example.org/a', label: 'Ex' });
  assert.equal(/<time>/.test(gpx), false);
  assert.equal(/2024-05-01/.test(gpx), false);
});

test('the file says plainly what was done to it, where GPX 1.1 puts a description', () => {
  const gpx = buildGpx(
    { name: 'Ring', points: [{ lat: 42, lon: 0.7, ele: 1000 }] },
    { url: 'https://example.org/a', label: 'Ex' },
    'The direction of the recording was reversed.',
  );
  // Name, then description, then link: the order the schema fixes.
  assert.match(
    gpx,
    /<name>Ring<\/name><desc>The direction of the recording was reversed\.<\/desc><link href="https:\/\/example\.org\/a">/,
  );
  // And the same sentence on the track, where a reader is more likely to look.
  assert.match(gpx, /<trk><name>Ring<\/name><desc>The direction/);
});

test('a file with nothing said about it is the file it always was', () => {
  const gpx = buildGpx({ name: 'Ring', points: [{ lat: 42, lon: 0.7, ele: 1000 }] }, { url: null });
  assert.equal(/<desc>/.test(gpx), false);
});

// ---------------------------------------------------------------- file names

test('every download says what it is, so three of them are not three of the same row', () => {
  assert.equal(changedFileName('komoot-123.gpx', { reversed: true }), 'komoot-123-reversed.gpx');
  assert.equal(changedFileName('komoot-123.gpx', { startKm: 4.24 }), 'komoot-123-start-km4.2.gpx');
  assert.equal(
    changedFileName('komoot-123.gpx', { reversed: true, startKm: 12 }),
    'komoot-123-reversed-start-km12.0.gpx',
  );
  assert.equal(changedFileName('komoot-123.gpx', {}), 'komoot-123.gpx');
});

test('a kilometre in a file name is written with a full stop, whatever the page is set to', () => {
  assert.equal(changedFileName('a.gpx', { startKm: 4.2 }).includes(','), false);
});

// --------------------------------------------------- the artefact, measured

test('rotating a closed ring changes nothing at all, ascent included', () => {
  // Moving the start of an exactly closed ring gives back the same cyclic list
  // of edges: nothing added, nothing removed, seam zero. Every figure has to
  // say so, and the ascent used to be the one that did not.
  //
  // It drifted 1.7% across eight starts, and this test used to bound that at 5%
  // rather than fix it, on the reasoning that any fixed step resampling has a
  // phase and taking the phase out means changing the estimator. That reasoning
  // was wrong, and measuring three candidate fixes is what showed it:
  //     averaging over several grid phases   drift got WORSE, 1.69% -> 2.48%
  //     anchoring the grid to the southern    worse again, 2.54%
  //     making the filter wrap at the seam    1.685% -> 0.0025%
  // The phase was never the cause. The cause was the seam: a closed ring has no
  // first sample and no last one, and filtering it with a window clamped at
  // each end treats whatever the file happens to begin at as a boundary. Move
  // the start and different ground gets the short window.
  //
  // So this is not a tolerance any more. Rotating a ring must not move the
  // ascent, and it does not.
  const points = ringWithClosedProfile({ sideM: 900, stepM: 18 });
  const base = measure({ points });
  const ring = ringLength(points);

  for (const share of [0.05, 0.2, 0.25, 0.5, 0.75, 0.9]) {
    const out = arrange(points, { startIndex: Math.round(ring * share) });
    const after = measure({ points: out.points });

    assert.equal(out.seamM, 0, `a closed ring opened a seam at ${share}`);
    assert.equal(after.pointCount, base.pointCount);
    assert.ok(
      Math.abs(after.distanceM - base.distanceM) < 0.01,
      `distance moved at ${share}: ${after.distanceM} against ${base.distanceM}`,
    );
    // Read off the points in the order they are in, with no grid between, so
    // this one is rotation proof and shows the ground really is the same.
    assert.ok(
      Math.abs(after.rawAscentM - base.rawAscentM) < 0.1,
      `the ground changed at ${share}: ${after.rawAscentM} against ${base.rawAscentM}`,
    );

    // Floating point, not tolerance: the same sums in a different order.
    assert.ok(
      Math.abs(after.ascentM - base.ascentM) < 0.05,
      `the ascent moved at ${share}: ${after.ascentM} against ${base.ascentM}`,
    );
    assert.ok(
      Math.abs(after.descentM - base.descentM) < 0.05,
      `the descent moved at ${share}: ${after.descentM} against ${base.descentM}`,
    );
  }
});
