// Run with:  node --test web/test/
//
// These cover the arithmetic, which is where the wrong answers live. Reading
// the GPX itself needs a browser, and is checked in the browser.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  buildGpx,
  ELEVATION_COVERAGE_FLOOR,
  GAP_FLOOR_M,
  GAP_SPACING_MULTIPLE,
  gapThresholdFor,
  haversine,
  measure,
} from '../assets/measure.js';

const M_PER_DEGREE = 111195;

/** A straight track climbing at a fixed rate, one point every `spacingM`. */
function ramp({ spacingM, totalM, climbM, baseEle = 1000 }) {
  const count = Math.round(totalM / spacingM) + 1;
  const points = [];
  for (let i = 0; i < count; i++) {
    points.push({
      lat: 42 + (i * spacingM) / M_PER_DEGREE,
      lon: 0.7,
      ele: baseEle + (climbM * i) / (count - 1),
    });
  }
  return { name: 'ramp', points };
}

/** The same track with a repeating wobble laid over it. A period longer than
 *  the median window is the honest test: a two sample alternation the filter
 *  flattens on its own proves nothing about the accumulator. */
function wobble(track, amplitudeM, period = 7) {
  return {
    ...track,
    points: track.points.map((p, i) => ({
      ...p,
      ele: p.ele + ((i % period) - (period - 1) / 2) * ((2 * amplitudeM) / (period - 1)),
    })),
  };
}

/** A closed ring round a square, carrying a profile that comes back to where
 *  it started. Every edge is an edge that was recorded. */
function closedRing({ sideM = 900, stepM = 18, climbs = 3, amplitudeM = 200, driftM = 0 }) {
  const east = 1 / (M_PER_DEGREE * Math.cos((42 * Math.PI) / 180));
  const onSquare = (d) =>
    d <= sideM
      ? [d, 0]
      : d <= 2 * sideM
        ? [sideM, d - sideM]
        : d <= 3 * sideM
          ? [sideM - (d - 2 * sideM), sideM]
          : [0, sideM - (d - 3 * sideM)];
  const total = 4 * sideM;
  const points = [];
  for (let d = 0; d < total; d += stepM) {
    const [north, eastM] = onSquare(d);
    points.push({
      lat: 42 + north / M_PER_DEGREE,
      lon: 0.7 + eastM * east,
      ele: 1400 + (amplitudeM * (1 - Math.cos((climbs * 2 * Math.PI * d) / total))) / 2 + (driftM * d) / total,
    });
  }
  points.push({ ...points[0], ele: points[0].ele + driftM });
  return { name: 'ring', points };
}

test('haversine matches a degree of latitude', () => {
  const metres = haversine({ lat: 42, lon: 0 }, { lat: 43, lon: 0 });
  assert.ok(Math.abs(metres - 111195) < 60, `got ${metres}`);
});

// ------------------------------------------------------- ascent, and its noise

test('a dense recording does not lose its climb to the noise threshold', () => {
  // Two metres between points puts every single elevation change below any
  // sane noise threshold. Accumulating point to point would report almost no
  // ascent at all; sampling along the track is what keeps the climb.
  const track = ramp({ spacingM: 2, totalM: 4000, climbM: 600 });
  const result = measure(track);
  assert.ok(result.ascentM > 540, `ascent collapsed to ${result.ascentM}`);
  assert.ok(result.ascentM <= 600 + 1);
});

test('an ordinary gradient on a dense recording is not thrown away', () => {
  // THE FAILURE THIS SUITE DID NOT HAVE, and the reason it did not have it.
  // Every ascent test above and below this one climbed at 15%, which is steep
  // enough to clear a threshold applied per sample step. So a noise threshold
  // that had quietly become a gradient cutoff passed all of them, and an 800 m
  // col recorded at 1 Hz, climbing at the grade a path is actually built at,
  // reported nothing at all:
  //
  //     grade      2.0%   4.0%   6.7%   10.0%   13.3%
  //     per step      0      0      0     797     797
  //     on reversal 800    800    799     798     798
  //
  // The cutoff was the threshold divided by the sample step: 1 m per 10 m is a
  // 10% grade, and every watch file is denser than 10 m.
  for (const grade of [0.02, 0.04, 0.067, 0.1, 0.133]) {
    const track = ramp({ spacingM: 1.4, totalM: 800 / grade, climbM: 800 });
    const result = measure(track);
    assert.ok(
      result.ascentM > 790,
      `a ${(100 * grade).toFixed(1)}% climb of 800 m reported ${result.ascentM}`,
    );
  }
});

test('a headline ascent and an elevation range may not contradict each other', () => {
  // The shape of the bug as a reader met it: one table printing an ascent of
  // nothing beside a range 798 m wide, with no warning between them. Whatever
  // the estimator does, a route that spans that much height has climbed.
  const track = ramp({ spacingM: 1.4, totalM: 12000, climbM: 800 });
  const result = measure(track);
  const span = result.elevationMaxM - result.elevationMinM;
  assert.ok(span > 700, span);
  assert.ok(
    result.ascentM > span * 0.9,
    `an ${span.toFixed(0)} m span reported ${result.ascentM.toFixed(0)} m of ascent`,
  );
});

test('a wobble is still not a climb', () => {
  // The other half of the same rule, and the half a reversal threshold could
  // have given away. The period is longer than the median window on purpose: a
  // two sample alternation the filter flattens by itself would prove nothing
  // about the accumulator underneath it.
  const flat = wobble(ramp({ spacingM: 10, totalM: 5000, climbM: 0 }), 0.4);
  assert.equal(measure(flat).ascentM, 0, 'half a metre of jitter is not a climb');

  const climbing = wobble(ramp({ spacingM: 10, totalM: 5000, climbM: 500 }), 0.4);
  const result = measure(climbing).ascentM;
  assert.ok(result > 490 && result < 510, `the same jitter over a real climb: ${result}`);
});

test('the raw figure is the plain point to point sum, unchanged', () => {
  // Raw ascent exists to show what a portal publishes, so it is the sum of
  // every rise with no threshold and no filter. The accumulator is shared with
  // the smoothed figure, and at threshold zero it has to degenerate to exactly
  // that sum or the two figures stop meaning different things.
  const heights = [1, 3, 2, 2, 7, 4, 4, 9, 1];
  let expected = 0;
  for (let i = 1; i < heights.length; i++) {
    if (heights[i] > heights[i - 1]) expected += heights[i] - heights[i - 1];
  }
  const points = heights.map((ele, i) => ({ lat: 42 + i / M_PER_DEGREE, lon: 0.7, ele }));
  assert.equal(measure({ points }).rawAscentM, expected);
});

test('a sparse recording is not resampled below its own spacing', () => {
  // Interpolating extra points into a track recorded every 20 m invents detail
  // the recording does not have.
  const track = ramp({ spacingM: 20, totalM: 4000, climbM: 600 });
  const result = measure(track);
  assert.ok(result.ascentM > 540, `ascent collapsed to ${result.ascentM}`);
});

test('the ascent figure hands back the three parameters it was made from', () => {
  // The tile prints the step and the fold under the tiles prints all three.
  // They are read off the measurement rather than off constants of their own,
  // so a page can never show a parameter the arithmetic has stopped using.
  const dense = measure(ramp({ spacingM: 2, totalM: 4000, climbM: 600 }));
  assert.equal(dense.sampleStepM, 10, 'a dense track is never sampled finer than 10 m');

  const sparse = measure(ramp({ spacingM: 28, totalM: 5600, climbM: 600 }));
  assert.equal(sparse.sampleStepM, sparse.meanSpacingM, 'a sparse track is sampled at its own spacing');
  assert.ok(sparse.sampleStepM > 27 && sparse.sampleStepM < 29, sparse.sampleStepM);

  for (const result of [dense, sparse]) {
    assert.equal(result.medianWindow, 5);
    // The noise floor is derived from the recording's own jitter, so this
    // asserts the floor and the shape rather than a constant: a clean
    // synthetic ramp has almost no jitter and lands on the floor, and a noisy
    // file reports the larger figure it was actually measured with. Pinning
    // the constant here would be the very thing the comment above forbids,
    // a page showing a parameter the arithmetic had stopped using.
    assert.ok(result.ascentNoiseM >= 1, result.ascentNoiseM);
    assert.ok(result.ascentNoiseM < 1.5, `a clean ramp should sit on the floor: ${result.ascentNoiseM}`);
  }
});

test('a noisy recording says the larger noise floor it was measured with', () => {
  // The figure on the page has to be the one the arithmetic used. A file whose
  // readings scatter by a metre is not measured with the same threshold as one
  // that does not scatter at all, and the fold under the tiles says which.
  const clean = ramp({ spacingM: 10, totalM: 5000, climbM: 400 });
  const noisy = {
    ...clean,
    points: clean.points.map((point, index) => ({
      ...point,
      // Deterministic, and large enough to be jitter rather than shape.
      ele: point.ele + (Math.sin(index * 2.399963) + Math.sin(index * 5.113)) * 1.2,
    })),
  };
  const before = measure(clean);
  const after = measure(noisy);
  assert.ok(after.ascentNoiseM > before.ascentNoiseM, `${after.ascentNoiseM} against ${before.ascentNoiseM}`);
  // And the climb survives being measured with the larger threshold.
  assert.ok(after.ascentM > 350, after.ascentM);
});

test('the worse the recording, the more of it is disclosed', () => {
  // Monotonicity, which is the property a percentile silently broke. The
  // threshold used to be a multiple of the 95th percentile step, so a file with
  // more than one step in twenty missing had a HOLE as its ordinary step and
  // every hole fell under the line. 60 holes disclosed nothing where 50 of the
  // same size disclosed 7.3 km.
  //
  // No count of holes may disclose less than a smaller count of the same holes.
  const borrowed = (holes) => {
    const spacing = 10 / 111320;
    const jump = 150 / 111320;
    const points = [];
    let at = 0;
    const every = Math.floor(1000 / holes);
    for (let i = 0; i < 1000; i++) {
      at += i % every === 0 ? jump : spacing;
      points.push({ lat: 41 + at, lon: 2, ele: 1000, time: null });
    }
    return measure({ points }).gapTotalM;
  };

  let previous = 0;
  for (const holes of [10, 40, 50, 60, 100, 200]) {
    const total = borrowed(holes);
    assert.ok(total > previous, `${holes} holes disclosed ${total} against ${previous} for fewer`);
    previous = total;
  }
});

test('jitter on flat ground is not accumulated into a climb', () => {
  // The reversal accumulator fixed a gradient cutoff and introduced its
  // opposite: every excursion past a fixed metre committed a little climb, so
  // 10 km of dead level ground under a metre of jitter reported 63 m of ascent.
  // Deriving the threshold from the scatter is what stops that, and this is the
  // case that proves it, because the truth is exactly zero.
  const flat = ramp({ spacingM: 10, totalM: 10000, climbM: 0 });
  const noisy = {
    ...flat,
    points: flat.points.map((point, index) => ({
      ...point,
      ele: point.ele + (Math.sin(index * 2.399963) + Math.sin(index * 5.113)) * 1.4,
    })),
  };
  const result = measure(noisy);
  assert.ok(result.ascentM < 25, `flat ground climbed ${result.ascentM} m`);
});

test('raw ascent is reported next to the smoothed one', () => {
  const track = ramp({ spacingM: 10, totalM: 1000, climbM: 100 });
  const result = measure(track);
  assert.ok(result.rawAscentM >= result.ascentM);
});

// ----------------------------------------------- the profile and its two ends

test('a profile carries no height for ground the file has none for', () => {
  // THE FAILURE. The sample grid started at distance zero but took its first
  // height from the first point that carried one, so a head with no heights was
  // extrapolated backwards along the first recorded leg, over ground with no
  // height in the file at all. The invention was that leg's grade times the
  // length of the head, so nothing bounded it:
  //
  //     heights missing      2      10     100
  //     range printed  400-1456  400-1504  400-2044
  //     file holds     400-1450  400-1450  400-1450
  //
  // and the ceiling scales the profile's own axis, so the drawing went with it.
  for (const missing of [2, 10, 100]) {
    const points = [];
    for (let i = 0; i < 600; i++) {
      const d = i * 20;
      points.push({
        lat: 42 + d / M_PER_DEGREE,
        lon: 0.7,
        ele: i < missing ? null : Math.max(400, 1450 - 0.3 * (d - missing * 20)),
      });
    }
    const result = measure({ points });
    assert.ok(
      result.elevationMaxM <= result.rawElevationMaxM,
      `${missing} missing heights invented ${(result.elevationMaxM - result.rawElevationMaxM).toFixed(0)} m of ceiling`,
    );
    assert.ok(result.elevationMinM >= result.rawElevationMinM);
  }
});

test('the range we publish is always inside the range the file holds', () => {
  // The invariant behind the test above, asked of every shape this suite has.
  // Resampling interpolates and the median picks a value that was there, so
  // neither can leave the file's own bounds. If one ever does, something is
  // extrapolating again.
  const tracks = [
    ramp({ spacingM: 10, totalM: 2000, climbM: 300 }),
    ramp({ spacingM: 1.4, totalM: 12000, climbM: 800 }),
    wobble(ramp({ spacingM: 10, totalM: 5000, climbM: 500 }), 3),
    closedRing({ sideM: 900, stepM: 18 }),
    closedRing({ sideM: 1000, stepM: 23 }),
  ];
  for (const track of tracks) {
    const result = measure(track);
    assert.ok(result.elevationMaxM <= result.rawElevationMaxM, `${track.name} ceiling`);
    assert.ok(result.elevationMinM >= result.rawElevationMinM, `${track.name} floor`);
  }
});

test('the last sample lands on the last recorded height, not a step short of it', () => {
  // A grid that stopped at the last whole step left the end of the route out of
  // the profile, which put the tail of every climb outside the figure and then
  // showed up as the file and the page disagreeing about the range.
  const track = ramp({ spacingM: 7, totalM: 3003, climbM: 300 });
  const result = measure(track);
  assert.ok(
    result.rawElevationMaxM - result.elevationMaxM <= result.elevationFilterEffectM,
    `${result.elevationMaxM} against ${result.rawElevationMaxM}`,
  );
});

test('the range disclosure is silent on a file with nothing wrong with it', () => {
  // THE FAILURE. The note fired whenever the file's range and ours differed by
  // more than a metre, and on a clean ramp they always do: the median window is
  // truncated at the two ends of an open track, so it pulls each terminal
  // sample in by one step of whatever gradient is there. A defect free 6% ramp
  // printed "1,001-1,599, file holds 1,000-1,600" and nothing was wrong with
  // the file. The allowance is now that end effect, measured off the profile.
  const clean = measure(ramp({ spacingM: 20, totalM: 10000, climbM: 600 }));
  assert.ok(clean.elevationFilterEffectM > 0, 'a filtered profile has a reach');
  assert.ok(
    Math.abs(clean.rawElevationMaxM - clean.elevationMaxM) <= clean.elevationFilterEffectM &&
      Math.abs(clean.elevationMinM - clean.rawElevationMinM) <= clean.elevationFilterEffectM,
    `a clean ramp is outside its own end effect: ${clean.elevationMinM}-${clean.elevationMaxM} against ${clean.rawElevationMinM}-${clean.rawElevationMaxM}`,
  );
});

test('the range disclosure still speaks up for a reading the filter removed', () => {
  // And the half that has to survive the fix. One barometric spike, the kind a
  // door makes, has to stay visible: the filter keeps it out of the chart's
  // axis and the note keeps it in the reader's sight.
  const track = ramp({ spacingM: 20, totalM: 10000, climbM: 600 });
  const spiked = { ...track, points: track.points.map((p, i) => (i === 250 ? { ...p, ele: p.ele + 625 } : p)) };
  const result = measure(spiked);
  assert.ok(result.rawElevationMaxM - result.elevationMaxM > result.elevationFilterEffectM, 'the spike must be disclosed');
  assert.ok(result.elevationMaxM < 1650, `the spike reached the published ceiling: ${result.elevationMaxM}`);
});

test('a spike at the very first sample cannot buy its own silence', () => {
  // The allowance is read just inside each end, where the window is whole, and
  // this is why. Read off the terminal samples themselves, one bad reading
  // there would inflate the allowance that exists to reveal it.
  const track = ramp({ spacingM: 20, totalM: 10000, climbM: 600 });
  const spiked = { ...track, points: track.points.map((p, i) => (i === 0 ? { ...p, ele: p.ele + 625 } : p)) };
  const result = measure(spiked);
  assert.ok(
    result.rawElevationMaxM - result.elevationMaxM > result.elevationFilterEffectM,
    `allowance ${result.elevationFilterEffectM} swallowed a 625 m spike`,
  );
});

// ---------------------------------------------------------------- gaps

test('the largest gap is found, with the distance it happens at', () => {
  const track = ramp({ spacingM: 10, totalM: 1000, climbM: 50 });
  // Drop the points that would cover 500 m to 900 m: a 400 m hole.
  track.points.splice(51, 39);
  const result = measure(track);
  assert.ok(result.largestGapM > 380 && result.largestGapM < 420, result.largestGapM);
  assert.ok(Math.abs(result.largestGapAtM - 500) < 30, result.largestGapAtM);
  assert.equal(result.gapExceedsThreshold, true);
});

test('the distance says how much of itself it never saw walked', () => {
  // THE FAILURE. Distance is a haversine sum over consecutive points, so the
  // straight chord across a hole is counted as walked. An intact recording and
  // the same one with the middle cut out print the same distance, and the tile
  // beside them calls that same ground untracked.
  const intact = measure(ramp({ spacingM: 10, totalM: 4000, climbM: 200 }));
  assert.equal(intact.gapTotalM, 0, 'a recording with no holes has borrowed nothing');

  const holed = ramp({ spacingM: 10, totalM: 4000, climbM: 200 });
  // Three holes: 300 m, 200 m and 400 m of track lifted out of it.
  holed.points.splice(300, 40);
  holed.points.splice(200, 20);
  holed.points.splice(100, 30);
  const result = measure(holed);

  assert.ok(
    Math.abs(result.distanceM - intact.distanceM) < 5,
    `the hole was absorbed silently: ${result.distanceM} against ${intact.distanceM}`,
  );
  // 900 m of track lifted out, and each chord spans one step wider than the
  // hole it crosses, so the straight ground is 930 m.
  assert.ok(Math.abs(result.gapTotalM - 930) < 15, result.gapTotalM);

  // WHY THE TOTAL AND NOT THE LARGEST. The distance is a sum, so what it
  // absorbed is a sum. The widest hole here is 400 m of the 900 m that is not
  // ground anybody walked, so printing the largest would understate it.
  assert.ok(
    result.gapTotalM > result.largestGapM * 2,
    `the largest gap stands in for the total: ${result.largestGapM} of ${result.gapTotalM}`,
  );
});

test('many small holes are as visible as one big one', () => {
  // THE FAILURE. The threshold was a flat 100 m, so twenty holes of 60 m in a
  // track recorded every 20 m were 1 200 m of straight line that the page
  // reported as nothing at all, while the same 1 200 m in one piece was fully
  // disclosed. A watch with intermittent sky view makes the first pattern, not
  // the second.
  //
  //     1 200 m borrowed as      one hole   five of 240   twenty of 60
  //     before                      1 220          1 300              0
  //     after                       1 220          1 300          1 600
  //
  // The chords are one ordinary step wider than the holes they cross, which is
  // why the totals sit above 1 200.
  const holes = (count) => {
    const hole = 1200 / count;
    const segment = 20000 / (count + 1);
    const points = [];
    let d = 0;
    for (let g = 0; g <= count; g++) {
      for (let x = 0; x < segment; x += 20) {
        points.push({ lat: 42 + d / M_PER_DEGREE, lon: 0.7, ele: 1000 + d / 200 });
        d += 20;
      }
      if (g < count) d += hole;
    }
    return measure({ points });
  };
  for (const count of [1, 5, 20]) {
    const result = holes(count);
    assert.ok(
      result.gapTotalM > 1200,
      `${count} holes totalling 1 200 m reported ${result.gapTotalM.toFixed(0)} m of borrowed distance`,
    );
    assert.equal(result.gapExceedsThreshold, true, `${count} holes raised no warning`);
  }
});

test('a drawn route does not report itself as one long gap', () => {
  // The same flat threshold, failing the other way. A planned route exported at
  // 150 m spacing has every step over 100 m, so the page reported 19 950 m of a
  // 19 950 m route as straight line across untracked ground. A 150 m straight
  // on a route drawn at 150 m spacing is a straight road.
  const drawn = measure(ramp({ spacingM: 150, totalM: 20000, climbM: 400 }));
  assert.equal(drawn.gapTotalM, 0);
  assert.equal(drawn.gapExceedsThreshold, false);
  assert.ok(drawn.gapThresholdM > 150, drawn.gapThresholdM);
});

test('the gap threshold is read off the cadence of the track it is asked about', () => {
  // The rule, on its own, away from any file. The scale is the 95th percentile
  // of the steps, so a handful of holes cannot lift the threshold that is meant
  // to catch them, and the floor stops a dense recording calling its own
  // ordinary variation a hole.
  assert.equal(gapThresholdFor([]), GAP_FLOOR_M);

  const dense = Array.from({ length: 1000 }, (_, i) => 1.4 + (i % 5) * 0.2);
  assert.equal(gapThresholdFor(dense), GAP_FLOOR_M, 'a 1 Hz recording is held at the floor');

  const drawn = Array.from({ length: 200 }, () => 150);
  assert.equal(gapThresholdFor(drawn), GAP_SPACING_MULTIPLE * 150);

  const holed = Array.from({ length: 1000 }, (_, i) => (i % 50 === 0 ? 400 : 20));
  assert.equal(gapThresholdFor(holed), GAP_FLOOR_M, 'the holes do not set the scale they are measured against');
});

test('an ordinary step is not a gap, whatever its size in metres', () => {
  // What the old flat threshold got right, kept. Every recording has chords
  // between its points, and the ones this page calls gaps are the ones far
  // outside the spacing the rest of the file keeps.
  for (const spacingM of [1.4, 10, 25, 150]) {
    const result = measure(ramp({ spacingM, totalM: 20000, climbM: 0 }));
    assert.equal(result.gapTotalM, 0, `a clean ${spacingM} m track borrowed ${result.gapTotalM}`);
    assert.equal(result.gapExceedsThreshold, false, `a clean ${spacingM} m track raised a warning`);
  }
});

test('a clean recording reports no gap worth calling out', () => {
  const result = measure(ramp({ spacingM: 10, totalM: 1000, climbM: 50 }));
  assert.equal(result.gapExceedsThreshold, false);
  assert.ok(result.largestGapM < 100);
});

// --------------------------------------------------------------- rings

test('a closed ring climbs exactly as much as it falls', () => {
  // A loop comes back to its own start, so its ascent and its descent are the
  // same number. They were not: on real recordings of loops the two figures
  // came back up to 142 m apart, because a threshold applied per step drops
  // small rises and small falls in different places. Accumulating between
  // turning points telescopes, so on a profile that returns to its start the
  // two totals are equal by construction.
  for (const stepM of [6, 17, 18, 23]) {
    const result = measure(closedRing({ sideM: 900, stepM }));
    assert.ok(
      Math.abs(result.ascentM - result.descentM) < 1e-6,
      `step ${stepM}: ${result.ascentM} up against ${result.descentM} down`,
    );
  }
});

test('a flat ring carrying barometric drift is not given a descent it never made', () => {
  // THE FAILURE. The accumulator used to wrap on a ring, joining the last
  // sample to the first across no ground at all, so 20 m of ordinary drift over
  // a dead flat loop came back as 19.86 m of hard descent. The filter's window
  // still reaches across the seam, because the ground there is continuous; the
  // accumulator does not, because there is no ground there to climb.
  const drifting = closedRing({ sideM: 900, stepM: 18, amplitudeM: 0, driftM: 20 });
  const result = measure(drifting);
  assert.ok(result.descentM < 0.5, `a flat ring descended ${result.descentM} m`);
  assert.ok(
    Math.abs(result.ascentM - 20) < 1,
    `the drift the file holds is 20 m and the ascent is ${result.ascentM}`,
  );
});

test('the ring test has no cliff in the middle of nothing', () => {
  // The seam rule used to be a flat two metres, so the same walk recorded a
  // millimetre and a half differently was measured two different ways. The
  // bound is the sample step now, which is the resolution the question has: two
  // ends inside one sample are one sample.
  const near = (closeM) => {
    const points = closedRing({ sideM: 900, stepM: 18 }).points.slice(0, -1);
    const last = points[points.length - 1];
    return measure({ points: [...points, { ...last, lat: last.lat + closeM / M_PER_DEGREE }] });
  };
  const under = near(1.999);
  const over = near(2.0005);
  assert.ok(
    Math.abs(under.ascentM - over.ascentM) < 0.5,
    `1.5 mm moved the ascent from ${under.ascentM} to ${over.ascentM}`,
  );
  assert.ok(Math.abs(under.descentM - over.descentM) < 0.5);
});

// ----------------------------------------------------- coverage, and the rest

test('descent is measured and handed back beside the ascent', () => {
  // Shown nowhere for as long as it existed, which is what made reversing a
  // route look like it had changed the ascent: reversal trades the two, and the
  // figure a reader needed to see that was never on the page.
  //
  // It trades them exactly now. Accumulating between turning points does not
  // care where the sample grid falls, so the mirror is a mirror: 297.00 up and
  // 0.00 down becomes 0.00 up and 297.00 down. The per step accumulator this
  // replaced came back a metre or two off its own mirror and the tolerance here
  // used to say so.
  const track = ramp({ spacingM: 10, totalM: 2000, climbM: 300 });
  const up = measure(track);
  assert.ok(up.ascentM > 250, up.ascentM);
  assert.ok(up.descentM < 5, `a climb should not descend: ${up.descentM}`);

  const down = measure({ ...track, points: track.points.slice().reverse() });
  assert.ok(Math.abs(down.descentM - up.ascentM) < 0.5, `${down.descentM} against ${up.ascentM}`);
  assert.ok(Math.abs(down.ascentM - up.descentM) < 0.5, `${down.ascentM} against ${up.descentM}`);
});

test('the share of points carrying a height is measured, and called low when it is', () => {
  const full = measure(ramp({ spacingM: 10, totalM: 2000, climbM: 200 }));
  assert.equal(full.elevationCoverage, 1);
  assert.equal(full.elevationCoverageLow, false, 'a full profile needs no line about itself');

  // A barometer that dropped out over the last third of the walk, which is how
  // this actually fails: not scattered, but a stretch of the route with no
  // heights on it at all.
  const track = ramp({ spacingM: 10, totalM: 2000, climbM: 200 });
  const from = Math.round(track.points.length * 0.66);
  const thinned = {
    ...track,
    points: track.points.map((p, i) => (i >= from ? { ...p, ele: null } : p)),
  };
  const result = measure(thinned);
  assert.ok(Math.abs(result.elevationCoverage - 0.66) < 0.02, result.elevationCoverage);
  assert.equal(result.elevationCoverageLow, true);

  // AND WHAT IT COSTS, which is why the floor is where it is. The profile is
  // built from the part of the route that has heights, so a third of the route
  // missing loses about a third of the climb, unannounced.
  assert.ok(
    result.ascentM < full.ascentM * 0.8,
    `coverage this low should visibly move the figure: ${result.ascentM} against ${full.ascentM}`,
  );
});

test('the coverage floor is the point where missing heights outweigh the sample step', () => {
  // MEASURED, NOT PICKED, and pinned here so it cannot drift into a round
  // number. The sample step is disclosed on the tile and moves the ascent by
  // 0.4% when it is taken a fifth either side of the value the rule picks. The
  // floor has to sit where missing heights start moving the same figure by more
  // than that, and the sweep behind it put that at 99%: 99.5% costs 0.3% and
  // 99% costs 0.6%.
  assert.equal(ELEVATION_COVERAGE_FLOOR, 0.99);

  const track = ramp({ spacingM: 10, totalM: 4000, climbM: 400 });
  const full = measure(track).ascentM;
  const points = track.points.slice();
  // Two per cent of the heights gone in one stretch, which is under the floor.
  const lost = Math.round(points.length * 0.02);
  const from = points.length - lost;
  const worse = measure({
    ...track,
    points: points.map((p, i) => (i >= from ? { ...p, ele: null } : p)),
  });
  assert.equal(worse.elevationCoverageLow, true, 'this is the side of the floor that speaks up');
  assert.ok(
    Math.abs(worse.ascentM - full) / full > 0.004,
    `below the floor the error should beat the step's 0.4%: ${worse.ascentM} against ${full}`,
  );
});

test('distance and spacing agree with each other', () => {
  const result = measure(ramp({ spacingM: 10, totalM: 2000, climbM: 0 }));
  assert.ok(Math.abs(result.distanceM - 2000) < 5, result.distanceM);
  assert.ok(Math.abs(result.meanSpacingM - 10) < 0.2, result.meanSpacingM);
});

test('a track with no elevation reports none rather than zero', () => {
  const points = [
    { lat: 42, lon: 0.7, ele: null },
    { lat: 42.001, lon: 0.7, ele: null },
  ];
  const result = measure({ name: 'flat', points });
  assert.equal(result.elevationMinM, null);
  assert.equal(result.pointsWithElevation, 0);
  assert.equal(result.ascentM, 0);
  // The zero above is an absent measurement, not a flat route, and coverage is
  // the only figure that can tell a reader which one they are looking at.
  assert.equal(result.elevationCoverage, 0);
  assert.equal(result.elevationCoverageLow, true);
});

test('nothing in this module is called with an argument it does not take', () => {
  // THE FAILURE, and 181 tests did not see it. `resampleByDistance` took three
  // parameters and was called with four; the fourth was silently dropped, and a
  // commit message described the behaviour that argument was supposed to buy.
  // A comment that describes code which is not there is a defect on its own, so
  // the argument lists are checked rather than trusted.
  const source = readFileSync(fileURLToPath(new URL('../assets/measure.js', import.meta.url)), 'utf8');
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  /** The arguments of one call, split at the commas that are not inside
   *  something else. */
  const argumentsAt = (text, open) => {
    let depth = 0;
    let count = 1;
    for (let i = open; i < text.length; i++) {
      const c = text[i];
      if ('([{'.includes(c)) depth++;
      else if (')]}'.includes(c)) {
        depth--;
        if (depth === 0) return text.slice(open + 1, i).trim() === '' ? 0 : count;
      } else if (c === ',' && depth === 1) count++;
    }
    return -1;
  };

  const declared = new Map();
  for (const m of code.matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\(/g)) {
    const open = m.index + m[0].length - 1;
    const list = code.slice(open + 1, code.indexOf(')', open));
    declared.set(m[1], list.trim() === '' ? 0 : list.split(',').length);
  }
  assert.ok(declared.size > 5, 'no functions were found to check');

  for (const [name, takes] of declared) {
    for (const call of code.matchAll(new RegExp(`(?<![\\w$.])${name}\\s*\\(`, 'g'))) {
      const open = call.index + call[0].length - 1;
      if (code.slice(0, call.index).trimEnd().endsWith('function')) continue;
      const passed = argumentsAt(code, open);
      assert.ok(
        passed <= takes,
        `${name} takes ${takes} arguments and is called with ${passed}`,
      );
    }
  }
});

test('the rebuilt file carries the link it came from', () => {
  const document = buildGpx(
    { name: 'A & B', points: [{ lat: 42.5, lon: 0.7, ele: 1456.5 }] },
    { url: 'https://example.org/trail-1', label: 'Example', title: 'A & B' },
  );
  assert.match(document, /A &amp; B/);
  assert.match(document, /<link href="https:\/\/example\.org\/trail-1">/);
  assert.match(document, /<ele>1456\.5<\/ele>/);
});
