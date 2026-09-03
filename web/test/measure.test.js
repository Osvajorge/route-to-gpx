// Run with:  node --test web/test/
//
// These cover the arithmetic, which is where the wrong answers live. Reading
// the GPX itself needs a browser, and is checked in the browser.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildGpx,
  ELEVATION_COVERAGE_FLOOR,
  haversine,
  measure,
} from '../assets/measure.js';

/** A straight track climbing at a fixed rate, one point every `spacingM`. */
function ramp({ spacingM, totalM, climbM }) {
  const count = Math.round(totalM / spacingM) + 1;
  const degreesPerMetre = 1 / 111195;
  const points = [];
  for (let i = 0; i < count; i++) {
    points.push({
      lat: 42 + i * spacingM * degreesPerMetre,
      lon: 0.7,
      ele: 1000 + (climbM * i) / (count - 1),
    });
  }
  return { name: 'ramp', points };
}

test('haversine matches a degree of latitude', () => {
  const metres = haversine({ lat: 42, lon: 0 }, { lat: 43, lon: 0 });
  assert.ok(Math.abs(metres - 111195) < 60, `got ${metres}`);
});

test('a dense recording does not lose its climb to the noise threshold', () => {
  // Two metres between points puts every single elevation change below any
  // sane noise threshold. Accumulating point to point would report almost no
  // ascent at all; sampling along the track is what keeps the climb.
  const track = ramp({ spacingM: 2, totalM: 4000, climbM: 600 });
  const result = measure(track);
  assert.ok(result.ascentM > 540, `ascent collapsed to ${result.ascentM}`);
  assert.ok(result.ascentM <= 600 + 1);
});

test('a sparse recording is not resampled below its own spacing', () => {
  // Interpolating extra points into a track recorded every 20 m splits each
  // real climb into changes under the threshold, and loses it the same way.
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
    assert.equal(result.ascentNoiseM, 1);
  }
});

test('raw ascent is reported next to the smoothed one', () => {
  const track = ramp({ spacingM: 10, totalM: 1000, climbM: 100 });
  const result = measure(track);
  assert.ok(result.rawAscentM >= result.ascentM);
});

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

test('a gap under the threshold is not counted as borrowed distance', () => {
  // Every recording has chords between its points. The ones this page calls
  // gaps are the ones this figure is about, and no others.
  const track = ramp({ spacingM: 10, totalM: 2000, climbM: 0 });
  track.points.splice(100, 8); // an 80 m hole, under the 100 m threshold
  const result = measure(track);
  assert.ok(result.largestGapM > 70 && result.largestGapM < 100, result.largestGapM);
  assert.equal(result.gapTotalM, 0);
});

test('descent is measured and handed back beside the ascent', () => {
  // Shown nowhere for as long as it existed, which is what made reversing a
  // route look like it had changed the ascent: reversal trades the two, and the
  // figure a reader needed to see that was never on the page.
  //
  // Trades, not trades exactly, and the tolerance below is why. Reversing moves
  // where the resample grid falls, so the smoothed pair comes back a metre or
  // two off its mirror: measured 447.0 up / 234.0 down, reversed 235.2 up /
  // 445.5 down. Same phase artefact the rotation test bounds. At whole metres
  // on screen a reader sees the two figures change places, which is the point,
  // but nothing here may claim an exactness the arithmetic does not have.
  const track = ramp({ spacingM: 10, totalM: 2000, climbM: 300 });
  const up = measure(track);
  assert.ok(up.ascentM > 250, up.ascentM);
  assert.ok(up.descentM < 5, `a climb should not descend: ${up.descentM}`);

  const down = measure({ ...track, points: track.points.slice().reverse() });
  assert.ok(Math.abs(down.descentM - up.ascentM) < 5, `${down.descentM} against ${up.ascentM}`);
  assert.ok(Math.abs(down.ascentM - up.descentM) < 5, `${down.ascentM} against ${up.descentM}`);
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
  // about 1.6%. The floor has to sit where missing heights start moving the
  // same figure by more than that, and the sweep behind it put that at 99%.
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
    Math.abs(worse.ascentM - full) / full > 0.016,
    `below the floor the error should beat the step's 1.6%: ${worse.ascentM} against ${full}`,
  );
});

test('a clean recording reports no gap worth calling out', () => {
  const result = measure(ramp({ spacingM: 10, totalM: 1000, climbM: 50 }));
  assert.equal(result.gapExceedsThreshold, false);
  assert.ok(result.largestGapM < 100);
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

test('the rebuilt file carries the link it came from', () => {
  const document = buildGpx(
    { name: 'A & B', points: [{ lat: 42.5, lon: 0.7, ele: 1456.5 }] },
    { url: 'https://example.org/trail-1', label: 'Example', title: 'A & B' },
  );
  assert.match(document, /A &amp; B/);
  assert.match(document, /<link href="https:\/\/example\.org\/trail-1">/);
  assert.match(document, /<ele>1456\.5<\/ele>/);
});
