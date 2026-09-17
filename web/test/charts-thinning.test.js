// Run with:  node --test web/test/
//
// What the report draws, and how little of it has to be drawn. A watch records
// a point a second, so a long day arrives as tens of thousands of them, and
// the trace paints every one of them three times over, twice through a blur.
// The drawing is allowed to simplify. The measurement is not: these check both
// halves of that sentence, because a decimation that quietly rounded the
// distance or lost a peak would be the worse bug of the two.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  homeView,
  projectInFrame,
  renderProfile,
  renderTrace,
  thinForDrawing,
} from '../assets/charts.js';

const t = (key) => key;

/** A track of `count` points with a hole in the recording two thirds along. */
function longRoute(count) {
  const points = [];
  const cumulative = [];
  let metres = 0;
  for (let i = 0; i < count; i++) {
    const along = i / count;
    points.push({
      lat: 42.6 + along * 0.08 + Math.sin(i / 180) * 0.004,
      lon: 0.6 + along * 0.12 + Math.cos(i / 140) * 0.005,
      ele: 1500 + along * 1400 + Math.sin(i / 90) * 120,
    });
    metres += 1.2;
    cumulative.push(metres);
  }
  return {
    points,
    measurements: {
      cumulative,
      distanceM: metres,
      elevationMinM: 1400,
      elevationMaxM: 3000,
      gapExceedsThreshold: true,
      largestGapAtM: metres * (2 / 3),
    },
  };
}

/** How many points a path actually draws through. */
function vertices(svg, className) {
  let total = 0;
  for (const path of svg.matchAll(new RegExp(`<path d="([^"]*)" class="${className}"`, 'g'))) {
    total += (path[1].match(/[ML]/g) || []).length;
  }
  return total;
}

test('a short recording is drawn point for point', () => {
  const { points, measurements } = longRoute(400);
  const trace = renderTrace(points, measurements, t);
  // Two runs, either side of the gap, and every recorded point in one of them.
  assert.equal(vertices(trace.svg, 'trace-line'), 400);
});

test('a day-long recording is drawn at the resolution the box can show', () => {
  // Measured on a 20 000-point track: the trace markup went from 715 180 bytes
  // to 143 884, and the vertices actually painted — the line, its halo and its
  // glow, so three paths over the same run — from 60 000 to 12 000. Parsing,
  // styling and laying out one trace in Chromium at 375 px went from 3.6 ms to
  // 0.7 ms, median of eleven.
  const { points, measurements } = longRoute(20000);
  const trace = renderTrace(points, measurements, t);
  const profile = renderProfile(points, measurements, t);

  assert.ok(vertices(trace.svg, 'trace-line') <= 4000, vertices(trace.svg, 'trace-line'));
  assert.ok(vertices(profile.svg, 'profile-line') <= 4000, vertices(profile.svg, 'profile-line'));
  // Still two runs with a hole between them, not one line and not none.
  assert.equal(trace.svg.match(/class="trace-line"/g).length, 2);
  assert.equal(profile.svg.match(/class="profile-line"/g).length, 2);
});

test('thinning the drawing leaves every recorded point where the cursor looks for it', () => {
  // `coords` is what nearestOnTrace searches and it is indexed against
  // `cumulative`, so dropping a point from it would not simplify the drawing,
  // it would move the hover reading to a different place on the mountain.
  const { points, measurements } = longRoute(20000);
  const trace = renderTrace(points, measurements, t);
  assert.equal(trace.coords.length, points.length);

  // And the count of readings outside the elevation range is a figure the
  // report prints, so it is counted over the recording and not over the line.
  const clipped = points.filter((p) => p.ele > 3000 || p.ele < 1400).length;
  assert.ok(clipped > 0, 'the fixture no longer clips anything');
  assert.equal(renderProfile(points, measurements, t).clipped, clipped);
});

test('the two ends of the hole are drawn exactly where the recording stopped', () => {
  // The gap is the one measurement that changes what you do on the mountain,
  // so it is the one thing the thinning may not move. The runs either side of
  // it are thinned separately, which keeps their last and first points.
  const { points, measurements } = longRoute(20000);
  const trace = renderTrace(points, measurements, t);
  const cut = measurements.cumulative.findIndex((m) => m >= measurements.largestGapAtM);

  const chord = /class="trace-gap"/.test(trace.svg)
    ? /<line x1="([\d.-]+)" y1="([\d.-]+)" x2="([\d.-]+)" y2="([\d.-]+)" class="trace-gap"\/>/.exec(
        trace.svg,
      )
    : null;
  assert.ok(chord, 'the gap chord is gone from the trace');
  assert.equal(chord[1], trace.coords[cut - 1].x.toFixed(1));
  assert.equal(chord[2], trace.coords[cut - 1].y.toFixed(1));
  assert.equal(chord[3], trace.coords[cut].x.toFixed(1));
  assert.equal(chord[4], trace.coords[cut].y.toFixed(1));

  // And the drawn line stops at the same place the chord starts.
  const firstRun = /<path d="([^"]*)" class="trace-line"\/>/.exec(trace.svg)[1];
  const lastVertex = firstRun.split('L').pop();
  assert.equal(lastVertex, `${trace.coords[cut - 1].x.toFixed(1)} ${trace.coords[cut - 1].y.toFixed(1)}`);
});

/** Every vertex of every drawn run, as numbers. */
function drawnPoints(svg) {
  const all = [];
  for (const path of svg.matchAll(/<path d="([^"]*)" class="trace-line"/g)) {
    for (const v of path[1].matchAll(/[ML]([\d.-]+) ([\d.-]+)/g)) all.push([+v[1], +v[2]]);
  }
  return all;
}

test("a map under the fingers is drawn at a moving map's resolution", () => {
  // "Trae un poco de delay el pinch". The resting budget sits above the length
  // of most recordings, so a pinch redrew every recorded point -- three paths
  // over them, two of those through a blur -- on every pointermove, and the
  // gesture went at the length of the recording rather than at the size of the
  // screen. Measured in Chromium against a 390 px wide drawing, one move of a
  // pinch, from renderTrace through innerHTML to style and layout: a 20 000
  // point track went from 2.9 ms to 0.7 ms and from 142 318 bytes of markup
  // written per move to 36 667; a 1 444 point route from 0.7 ms to 0.6 ms and
  // 52 930 bytes to 36 298; a 200 point route was 0.3 ms and is 0.3 ms.
  const { points, measurements } = longRoute(20000);
  const still = renderTrace(points, measurements, t, { view: homeView() });
  const moving = renderTrace(points, measurements, t, { view: { ...homeView(), moving: true } });

  assert.equal(vertices(still.svg, 'trace-line'), 4000, 'the resting budget, over two runs');
  assert.equal(vertices(moving.svg, 'trace-line'), 1000, 'the moving budget, over two runs');
  assert.ok(moving.svg.length * 3 < still.svg.length, `${moving.svg.length} bytes`);

  // Still two runs with a hole between them. The gap is the one measurement
  // that changes what you do on the mountain, and a gesture does not hide it.
  assert.equal(moving.svg.match(/class="trace-line"/g).length, 2);
  assert.match(moving.svg, /class="trace-gap"/);
});

test('the moving drawing follows the zoom, so the line never leaves the ground', () => {
  // The thinning error is in the picture's own units, so standing closer
  // magnifies it with everything else. Doubling the budget with the scale
  // halves it back; four times the fit is the resting drawing again.
  const { points, measurements } = longRoute(20000);
  const at = (scale) =>
    vertices(
      renderTrace(points, measurements, t, {
        view: { scale, centerX: 500, centerY: 300, roam: true, moving: true },
      }).svg,
      'trace-line',
    );

  assert.equal(at(0.25), 1000, 'pulled out past the route');
  assert.equal(at(1), 1000);
  assert.equal(at(2), 1000);
  assert.equal(at(4), 2000);
  assert.equal(at(16), at(1) * 4, 'at the ceiling a moving map is the resting map');
  assert.equal(at(16), vertices(renderTrace(points, measurements, t).svg, 'trace-line'));
});

test('the line keeps its shape wherever you stand', () => {
  // The points are chosen in world units, which a view only scales and shifts,
  // so the same ones win their buckets at every zoom and from every corner.
  // That is what lets the choosing be done once instead of on every
  // pointermove, and it is also what stops the line reshuffling its own
  // vertices under the fingers while the hand moves.
  const { points, measurements } = longRoute(20000);
  const home = renderTrace(points, measurements, t, { view: homeView() });
  const closer = renderTrace(points, measurements, t, {
    view: { scale: 4, centerX: 420, centerY: 260 },
  });

  const here = drawnPoints(home.svg);
  const there = drawnPoints(closer.svg);
  assert.equal(there.length, here.length, 'a different number of points was chosen');

  // Read back through the frames rather than compared as drawn: the same world
  // point lands somewhere else on the screen, which is the whole idea.
  there.forEach(([x, y], i) => {
    const world = {
      x: x / closer.frame.unitsPerWorld + closer.frame.worldX0,
      y: y / closer.frame.unitsPerWorld + closer.frame.worldY0,
    };
    const expected = [
      (world.x - home.frame.worldX0) * home.frame.unitsPerWorld,
      (world.y - home.frame.worldY0) * home.frame.unitsPerWorld,
    ];
    assert.ok(Math.abs(expected[0] - here[i][0]) < 0.2, `x at ${i}: ${expected[0]} vs ${here[i][0]}`);
    assert.ok(Math.abs(expected[1] - here[i][1]) < 0.2, `y at ${i}: ${expected[1]} vs ${here[i][1]}`);
  });
});

test('every recorded point is still there to be searched, worked out when asked for', () => {
  // The cursor and the press search all of them, and they ask once. A pinch
  // asks sixty times a second and never asks for this, so building it on every
  // redraw was tens of thousands of objects a second for a question nobody put.
  const { points, measurements } = longRoute(5000);
  const drawn = renderTrace(points, measurements, t, {
    view: { scale: 3, centerX: 400, centerY: 200 },
  });

  assert.equal(drawn.coords.length, points.length);
  assert.deepEqual(drawn.coords, projectInFrame(points, drawn.frame));
  // And worked out once, not once per question.
  assert.equal(drawn.coords, drawn.coords);
});

test('a summit survives the thinning that an every-Nth stride would have flattened', () => {
  // This is the whole reason the picking is area-based. The line below is flat
  // except for one spike, and the spike sits at an index a fixed stride steps
  // straight over. An elevation profile exists to show exactly that shape.
  const line = [];
  for (let i = 0; i < 1000; i++) line.push({ x: i, y: i === 497 ? 400 : 0 });

  const kept = thinForDrawing(line, 100);
  assert.equal(kept.length, 100);
  assert.ok(kept.some((point) => point.y === 400), 'the summit was thinned away');

  // Ends are never given up: a run has to start and finish where it did.
  assert.deepEqual(kept[0], line[0]);
  assert.deepEqual(kept[kept.length - 1], line[line.length - 1]);

  // Every tenth point, for contrast, lands on 490 and 500 and misses it.
  const stride = line.filter((_, i) => i % 10 === 0);
  assert.ok(!stride.some((point) => point.y === 400));
});

test('a line already short enough is handed back untouched', () => {
  const line = [{ x: 0, y: 0 }, { x: 1, y: 2 }, { x: 2, y: 1 }];
  assert.equal(thinForDrawing(line, 100), line);
  assert.equal(thinForDrawing(line, 3), line);
  // Two points are a line. There is nothing between them to choose from, and a
  // budget under three has no room for a middle.
  assert.equal(thinForDrawing(line, 2), line);
});
