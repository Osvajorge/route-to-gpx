// Run with:  node --test web/test/
//
// These cover the arithmetic, which is where the wrong answers live. Reading
// the GPX itself needs a browser, and is checked in the browser.

import assert from 'node:assert/strict';
import test from 'node:test';

import { buildGpx, haversine, measure } from '../assets/measure.js';

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
