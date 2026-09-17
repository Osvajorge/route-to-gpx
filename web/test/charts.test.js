// Run with:  node --test web/test/
//
// The drawings are geometry, and geometry is where a chart lies quietly: a
// mirrored track or a map half a tile out still looks like a map. These check
// the arithmetic that decides where things land. Nothing here needs a browser.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DRAG_SLOP_PX,
  KEY_PAN_FRACTION,
  MAP_MAX_SCALE,
  MAP_MIN_SCALE,
  MAP_ZOOM_STEP,
  MAX_LATITUDE,
  distanceTicks,
  elevationTicks,
  homeView,
  isDrag,
  latToWorldY,
  lonToWorldX,
  panView,
  pinchView,
  pointInBox,
  projectInFrame,
  projectTrace,
  renderProfile,
  renderTrace,
  tileLayer,
  traceFrame,
  viewAfterKey,
  viewFrame,
  worldXToLon,
  worldYToLat,
  zoomViewAt,
} from '../assets/charts.js';
import { measure } from '../assets/measure.js';

const t = (key) => key;

/** The corners of a Pyrenean route, and a point inside it. */
const ROUTE = [
  { lat: 42.6, lon: 0.6 },
  { lat: 42.68, lon: 0.72 },
  { lat: 42.64, lon: 0.66 },
];

/** A 24.37 km climb with a hole in the recording at 14.6 km. */
function fixture({ gapIndex = 60 } = {}) {
  const points = [];
  const cumulative = [];
  for (let i = 0; i <= 100; i++) {
    points.push({ lat: 42.6 + i * 0.0008, lon: 0.6 + i * 0.0006, ele: 1456 + (1951 * i) / 100 });
    cumulative.push(i * 243.7);
  }
  return {
    points,
    measurements: {
      cumulative,
      distanceM: 24370,
      elevationMinM: 1456,
      elevationMaxM: 3407,
      gapExceedsThreshold: true,
      largestGapM: 340,
      largestGapAtM: cumulative[gapIndex],
    },
  };
}

// ------------------------------------------------------------------ mercator

test('the projection agrees with the tile grid it has to sit under', () => {
  // At 45 north the Mercator distance from the equator is ln(1 + root 2)
  // radians, so that parallel falls at a known fraction down the square the
  // tiles are cut on, and inside a known row of them.
  assert.ok(Math.abs(latToWorldY(45) - (0.5 - Math.log(1 + Math.SQRT2) / (2 * Math.PI))) < 1e-15);
  assert.equal(Math.floor(latToWorldY(45) * 2 ** 8), 92);
  assert.equal(Math.floor(lonToWorldX(-74.006) * 2 ** 12), 1205);

  assert.equal(lonToWorldX(0), 0.5);
  assert.equal(lonToWorldX(180), 1);
  assert.ok(Math.abs(latToWorldY(0) - 0.5) < 1e-15);
  assert.ok(Math.abs(latToWorldY(MAX_LATITUDE)) < 1e-9);
});

test('the asinh form matches the log-tangent one it replaces', () => {
  for (let lat = -80; lat <= 80; lat += 7) {
    const phi = (lat * Math.PI) / 180;
    const classic = 0.5 - Math.log(Math.tan(Math.PI / 4 + phi / 2)) / (2 * Math.PI);
    assert.ok(Math.abs(latToWorldY(lat) - classic) < 1e-12, `lat ${lat}`);
  }
});

test('a latitude survives the round trip', () => {
  for (let lat = -80; lat <= 80; lat += 3.5) {
    assert.ok(Math.abs(worldYToLat(latToWorldY(lat)) - lat) < 1e-9, `lat ${lat}`);
  }
});

test('a corrupt coordinate is clamped instead of blanking the chart', () => {
  assert.ok(Number.isFinite(latToWorldY(90)));
  assert.ok(Number.isFinite(latToWorldY(-1000)));
});

test('north is up', () => {
  // Mercator y already grows south. The old projection needed a flip and this
  // one must not have it, or the track comes out mirrored against the map.
  const [south, north] = projectTrace([
    { lat: 42.6, lon: 0.66 },
    { lat: 42.68, lon: 0.66 },
  ]);
  assert.ok(north.y < south.y, `north ${north.y} south ${south.y}`);
});

test('the fit keeps the shape and lands on the padding', () => {
  const coords = projectTrace(ROUTE);
  const frame = traceFrame(ROUTE);

  // One scale for both axes, so nothing is stretched.
  const eastWest = (coords[1].x - coords[0].x) / (lonToWorldX(0.72) - lonToWorldX(0.6));
  const northSouth = (coords[1].y - coords[0].y) / (latToWorldY(42.68) - latToWorldY(42.6));
  assert.ok(Math.abs(eastWest - northSouth) < 1e-6);
  assert.ok(Math.abs(eastWest - frame.unitsPerWorld) < 1e-6);

  // This route is taller than it is wide against the box, so the north and
  // south ends are the pair that touch the padding.
  assert.ok(Math.abs(coords[1].y - 34) < 1e-6, `top ${coords[1].y}`);
  assert.ok(Math.abs(coords[0].y - (600 - 34)) < 1e-6, `bottom ${coords[0].y}`);
});

// ---------------------------------------------------------------- tile layer

/** The zoom the screen could resolve, before the deliberate step back. */
function idealZoom(frame, layer) {
  return Math.ceil(
    Math.log2((layer.cssPerUnit * frame.unitsPerWorld * layer.devicePixelRatio) / 256),
  );
}

test('the zoom steps back one from what the screen could show', () => {
  const frame = traceFrame(ROUTE);

  const retina = tileLayer(frame, { width: 810, height: 330, devicePixelRatio: 2 });
  const plain = tileLayer(frame, { width: 810, height: 330, devicePixelRatio: 1 });

  // Asserted against the rule rather than a number, so this still means
  // something when the chart box or the route changes.
  assert.equal(retina.zoom, idealZoom(frame, retina) - 1);
  assert.equal(plain.zoom, idealZoom(frame, plain) - 1);

  // Half the pixels to fill means one level less, never a fudged half level.
  assert.equal(retina.zoom - plain.zoom, 1);

  // Stepping back a level enlarges each tile. Past roughly double, contour
  // lines go to porridge and MAX_TILE_STRETCH in the page takes over.
  for (const layer of [retina, plain]) {
    assert.ok(layer.tileShrink > 1 && layer.tileShrink < 2.5, `shrink ${layer.tileShrink}`);
  }
});

test('a huge box zooms out and a point zooms in, without either crashing', () => {
  const worldFrame = traceFrame([{ lat: -80, lon: -179 }, { lat: 80, lon: 179 }]);
  const world = tileLayer(worldFrame, {
    width: 810,
    height: 330,
    devicePixelRatio: 2,
  });
  assert.equal(world.zoom, Math.max(0, idealZoom(worldFrame, world) - 1));
  assert.ok(world.tileShrink > 1 && world.tileShrink < 2.5);

  // A track that never moved has no extent to fit, so it is pinned to the
  // deepest zoom the source has and asks for exactly one tile. The step back
  // cannot reach past that clamp.
  const still = tileLayer(traceFrame([{ lat: 42.5, lon: 0.7 }]), {
    width: 810,
    height: 330,
    devicePixelRatio: 2,
    maxZoom: 17,
  });
  assert.equal(still.zoom, 17);
  assert.equal(still.tiles.length, 1);
});

test('the phone is not asked for three times the pixels', () => {
  const layer = tileLayer(traceFrame(ROUTE), {
    width: 324,
    height: 210,
    devicePixelRatio: 3,
  });
  assert.equal(layer.devicePixelRatio, 2);
  assert.equal(layer.backing.width, Math.round(layer.plate.width * 2));
});

test('the tiles cover the plate once, with no seam and no spare column', () => {
  const layer = tileLayer(traceFrame(ROUTE), {
    width: 810,
    height: 330,
    devicePixelRatio: 2,
  });

  const columns = new Set(layer.tiles.map((tile) => tile.left));
  const rows = new Set(layer.tiles.map((tile) => tile.top));
  assert.equal(layer.tiles.length, columns.size * rows.size);
  // A canary on the request count, not a law. The map covers the whole chart
  // box rather than the letterboxed track rectangle, so this went up when that
  // changed; it is here so the next change to the geometry has to look at it.
  assert.equal(layer.tiles.length, 15);

  // Neighbours share an exact edge: a rounded width instead would leave a
  // hairline of background showing between every pair.
  const across = [...columns].sort((a, b) => a - b);
  for (let i = 1; i < across.length; i++) {
    const left = layer.tiles.find((tile) => tile.left === across[i - 1]);
    assert.equal(left.left + left.width, across[i]);
  }

  // And the covered strip runs past both edges of the plate.
  const first = layer.tiles.find((tile) => tile.left === across[0]);
  const last = layer.tiles.find((tile) => tile.left === across[across.length - 1]);
  assert.ok(first.left <= 0);
  assert.ok(last.left + last.width >= layer.backing.width);
});

test('the tile budget trades one level of sharpness for a bounded burst', () => {
  const frame = traceFrame(ROUTE);
  const free = tileLayer(frame, { width: 810, height: 330, devicePixelRatio: 2 });
  const capped = tileLayer(frame, {
    width: 810,
    height: 330,
    devicePixelRatio: 2,
    maxTiles: 12,
  });
  assert.ok(capped.tiles.length <= 12, `${capped.tiles.length} tiles`);
  // How many levels it gives up depends on how much ground is on screen. What
  // has to hold is that it gives one up rather than blowing the budget.
  assert.ok(capped.zoom < free.zoom, `${capped.zoom} vs ${free.zoom}`);
});

test('a coordinate lands on the same pixel as the drawn track', () => {
  // This is the whole point of the rewrite: the map and the trace have to be
  // the same picture, at every zoom and on every screen.
  const frame = traceFrame(ROUTE);
  const coords = projectTrace(ROUTE);
  for (const view of [
    { width: 810, height: 330, devicePixelRatio: 2 },
    { width: 324, height: 210, devicePixelRatio: 3 },
    { width: 309, height: 130, devicePixelRatio: 1 },
  ]) {
    const layer = tileLayer(frame, view);
    ROUTE.forEach((point, i) => {
      const onScreen = layer.project(point.lat, point.lon);
      assert.ok(Math.abs(onScreen.x - (layer.traceOrigin.left + coords[i].x * layer.cssPerUnit)) < 1e-9);
      assert.ok(Math.abs(onScreen.y - (layer.traceOrigin.top + coords[i].y * layer.cssPerUnit)) < 1e-9);
    });
  }
});

// --------------------------------------------------------------------- ticks

test('the distance axis stops short of the total', () => {
  assert.deepEqual(distanceTicks(24370, 7), [0, 5000, 10000, 15000, 20000]);
  assert.deepEqual(distanceTicks(4200, 7), [0, 1000, 2000, 3000, 4000]);

  // 120 km is an exact multiple of the 20 km step, and the axis still does not
  // print it: the right edge is the finish, and the total is already a tile.
  assert.deepEqual(distanceTicks(120000, 7), [0, 20000, 40000, 60000, 80000, 100000]);
  assert.deepEqual(distanceTicks(120000, 5), [0, 50000, 100000]);

  assert.deepEqual(distanceTicks(0, 7), [0]);
});

test('the elevation axis reads in round heights inside the climb', () => {
  assert.deepEqual(elevationTicks(1456, 3407, 4), [1500, 2000, 2500, 3000]);
  assert.deepEqual(elevationTicks(1456, 3407, 3), [2000, 3000]);
  assert.deepEqual(elevationTicks(120, 420, 4), [200, 300, 400]);
  assert.deepEqual(elevationTicks(120, 420, 3), [200, 300, 400]);
  assert.deepEqual(elevationTicks(200, 2600, 4), [1000, 2000]);

  // A towpath is still worth a scale.
  assert.deepEqual(elevationTicks(11, 14, 4), [11, 12, 13, 14]);
});

// -------------------------------------------------------------------- charts

test('the profile hands out its ticks as fractions of the plot', () => {
  const { points, measurements } = fixture();
  const chart = renderProfile(points, measurements, t);

  assert.deepEqual(chart.axis.y.map((tick) => tick.valueM), [1500, 2000, 2500, 3000]);
  assert.ok(Math.abs(chart.axis.y[0].fraction - 0.928) < 0.001);
  assert.ok(Math.abs(chart.axis.y[0].fraction - chart.py(1500) / 230) < 1e-12);

  // Every tick sits clear of the top and bottom edges, so its number fits in
  // the gutter beside the plot.
  for (const tick of chart.axis.y) {
    assert.ok(tick.fraction > 0.05 && tick.fraction < 0.95, `${tick.valueM} at ${tick.fraction}`);
  }

  const compact = renderProfile(points, measurements, t, { compact: true });
  assert.deepEqual(compact.axis.y.map((tick) => tick.valueM), [2000, 3000]);
});

test('a distance tick gives way to the gap label, but the origin never does', () => {
  const middle = fixture({ gapIndex: 60 });
  const chart = renderProfile(middle.points, middle.measurements, t);
  assert.ok(Math.abs(chart.axis.gapFraction - 0.595) < 1e-9);
  // 15 km would print on top of the gap label.
  assert.deepEqual(chart.axis.x.map((tick) => tick.valueM), [0, 5000, 10000, 20000]);
  assert.ok(Math.abs(chart.axis.x[1].fraction - 5000 / 24370) < 1e-12);

  const early = fixture({ gapIndex: 2 });
  const start = renderProfile(early.points, early.measurements, t);
  assert.equal(start.axis.gapFraction, null);
  assert.equal(start.axis.x[0].valueM, 0);
});

test('a recording with no heights gets no elevation scale', () => {
  const { points, measurements } = fixture();
  const flat = points.map((p) => ({ ...p, ele: null }));
  const chart = renderProfile(flat, { ...measurements, elevationMinM: null, elevationMaxM: null }, t);
  assert.deepEqual(chart.axis.y, []);
  assert.ok(!chart.svg.includes('<line x1="0"'));
});

test('the gap keeps its weight in both drawings', () => {
  const { points, measurements } = fixture();
  const trace = renderTrace(points, measurements, t);
  const profile = renderProfile(points, measurements, t);

  // The chord, both end marks, and a track broken either side of it.
  assert.equal(trace.svg.match(/class="trace-gap"/g).length, 1);
  assert.equal(trace.svg.match(/class="trace-gap-end"/g).length, 2);
  assert.equal(trace.svg.match(/class="trace-line"/g).length, 2);
  assert.ok(trace.gapAnchor);

  // The band, both edges, and the straight line the watch drew.
  assert.ok(profile.svg.includes('profile-gap-band'));
  assert.equal(profile.svg.match(/class="profile-gap-end"/g).length, 2);
  assert.equal(profile.svg.match(/class="profile-gap"/g).length, 1);

  // And the rest of the drawing is untouched by the new projection.
  assert.ok(trace.svg.includes('class="trace-start"'));
  assert.ok(trace.svg.includes('class="trace-cursor"'));
  assert.ok(profile.svg.includes('class="profile-cursor"'));
  assert.deepEqual(trace.viewBox, { w: 1000, h: 600 });
  assert.ok(trace.frame.unitsPerWorld > 0);
});

test('sea level is written as zero, never as minus zero', () => {
  // Math.ceil of a small negative gives -0, it survives the multiplication,
  // and Intl.NumberFormat prints it as "-0". A seaside path found this.
  const levels = elevationTicks(-4, 45, 4);
  assert.ok(levels.includes(0), `no zero level in ${JSON.stringify(levels)}`);
  for (const level of levels) {
    assert.ok(!Object.is(level, -0), 'a level came back as negative zero');
  }
});

test('the axis step survives a tick being dropped for the gap label', () => {
  // A gap a quarter of the way along displaces the tick beside it. The step
  // has to stay the step: read from what survived, it doubles, and the label
  // that should say 1.5 km rounds to 2 and repeats the tick before it.
  const points = [];
  for (let i = 0; i <= 40; i++) {
    points.push({ lat: 42 + i * 0.00018, lon: 0.7, ele: 800 + i });
  }
  const measurements = measure({ name: 'gap', points });
  // Force a gap a quarter along, the shape the failing route had.
  const cut = 10;
  measurements.gapExceedsThreshold = true;
  measurements.largestGapAtM = measurements.cumulative[cut];
  measurements.largestGapM = 261;

  const profile = renderProfile(points, measurements, (k) => k);
  assert.equal(typeof profile.axis.stepM, 'number');
  assert.ok(profile.axis.stepM > 0);
  // Every printed tick is a whole number of steps from the origin.
  for (const tick of profile.axis.x) {
    const steps = tick.valueM / profile.axis.stepM;
    assert.ok(
      Math.abs(steps - Math.round(steps)) < 1e-9,
      `tick ${tick.valueM} is not a multiple of step ${profile.axis.stepM}`,
    );
  }
});

// ------------------------------------------------------------------ map view
//
// Panning and zooming the re-arranger's map. A view is arithmetic on the fit,
// so all of it is checked here rather than through a browser: what the fingers
// and the keys produce is a view, and the view is what the drawing, the tiles
// and the picking all read.

const PHONE = { width: 324, height: 180, devicePixelRatio: 2 };

/** The box point under a screen position, as a coordinate the projection can
 *  be asked about. It is the only way to check that the ground the fingers were
 *  on is the ground still under them. */
function coordinateAt(frame, boxPoint) {
  return {
    lat: worldYToLat(frame.worldY0 + boxPoint.y / frame.unitsPerWorld),
    lon: worldXToLon(frame.worldX0 + boxPoint.x / frame.unitsPerWorld),
  };
}

test('no view is the drawing that was on the page before there were views', () => {
  const frame = traceFrame(ROUTE);
  const home = viewFrame(frame, homeView());
  assert.deepEqual(home, frame);

  const { points, measurements } = fixture();
  assert.equal(
    renderTrace(points, measurements, t).svg,
    renderTrace(points, measurements, t, { view: homeView() }).svg,
  );
});

test('zooming shows less ground, not a bigger picture', () => {
  const frame = traceFrame(ROUTE);
  const closer = viewFrame(frame, { scale: 4, centerX: 500, centerY: 300 });

  // Four times as many box units to the world unit, so a quarter of the world
  // in each direction is left inside the same box.
  assert.ok(Math.abs(closer.unitsPerWorld - frame.unitsPerWorld * 4) < 1e-12);

  // And the middle of the fit is still the middle of the box.
  const middle = coordinateAt(frame, { x: 500, y: 300 });
  const landed = projectInFrame([middle], closer)[0];
  assert.ok(Math.abs(landed.x - 500) < 1e-6, `x ${landed.x}`);
  assert.ok(Math.abs(landed.y - 300) < 1e-6, `y ${landed.y}`);
});

test('the ground under the fingers stays under them', () => {
  // The whole difference between a map and a slider. Pinching on a summit has
  // to bring the summit closer, not whatever was in the middle of the box.
  const frame = traceFrame(ROUTE);
  const anchor = { x: 650, y: 380 };
  const held = coordinateAt(frame, anchor);

  let view = homeView();
  for (const factor of [2, 2, 1.37, 0.5]) {
    view = zoomViewAt(view, factor, anchor);
    const landed = projectInFrame([held], viewFrame(frame, view))[0];
    assert.ok(Math.abs(landed.x - anchor.x) < 1e-6, `x ${landed.x} at ${view.scale}`);
    assert.ok(Math.abs(landed.y - anchor.y) < 1e-6, `y ${landed.y} at ${view.scale}`);
  }
});

test('the map cannot be pushed off its own edge', () => {
  // A route shoved out of the box is a blank chart with no way back but the
  // reset, on the one screen where the reset is not what anybody wanted.
  const far = panView({ scale: 4, centerX: 500, centerY: 300 }, -9000, -9000);
  assert.equal(far.centerX, 1000 - 1000 / 8);
  assert.equal(far.centerY, 600 - 600 / 8);

  // At the fit the whole route is already on the screen, so there is nowhere to
  // go and the map says so by not moving.
  assert.deepEqual(panView(homeView(), 400, 250), homeView());

  // And no closer than the ceiling, however hard the fingers pull.
  assert.equal(zoomViewAt(homeView(), 1000, { x: 500, y: 300 }).scale, MAP_MAX_SCALE);
  assert.equal(zoomViewAt(homeView(), 0.001, { x: 500, y: 300 }).scale, MAP_MIN_SCALE);
});

test('a pinch is a spread and a drag at once, because a hand does both', () => {
  const start = { scale: 4, centerX: 500, centerY: 300 };

  // Two fingers held the same distance apart and moved together is a pan and
  // nothing else.
  const dragged = pinchView(
    start,
    { a: { x: 400, y: 300 }, b: { x: 600, y: 300 } },
    { a: { x: 440, y: 320 }, b: { x: 640, y: 320 } },
  );
  assert.deepEqual(dragged, panView(start, 40, 20));

  // Spread to twice the distance about a middle that did not move, and the
  // scale doubles with that middle still under the fingers.
  const spread = pinchView(
    start,
    { a: { x: 450, y: 300 }, b: { x: 550, y: 300 } },
    { a: { x: 400, y: 300 }, b: { x: 600, y: 300 } },
  );
  assert.ok(Math.abs(spread.scale - 8) < 1e-12);
  assert.deepEqual(spread, zoomViewAt(start, 2, { x: 500, y: 300 }));

  // Fingers on one pixel would divide by nothing. The map stays where it is.
  const pinched = pinchView(
    start,
    { a: { x: 500, y: 300 }, b: { x: 500, y: 300 } },
    { a: { x: 500, y: 300 }, b: { x: 520, y: 300 } },
  );
  assert.equal(pinched.scale, 4);
});

test('the keys do what the fingers do, which is the whole feature', () => {
  const view = { scale: 4, centerX: 500, centerY: 300 };

  assert.deepEqual(viewAfterKey(view, '+'), zoomViewAt(view, MAP_ZOOM_STEP, { x: 500, y: 300 }));
  assert.deepEqual(viewAfterKey(view, '-'), zoomViewAt(view, 1 / MAP_ZOOM_STEP, { x: 500, y: 300 }));
  assert.deepEqual(viewAfterKey(view, 'Home'), homeView());

  // The arrow points where the reader wants to go, and one press moves a fifth
  // of what is on the screen rather than a fifth of the route.
  // A quarter of the box is on screen at this scale, which is 250 units, so
  // one press is 50 of them. Written out rather than worked back from the
  // fraction, which would agree with itself whatever the fraction became.
  const east = viewAfterKey(view, 'ArrowRight');
  assert.ok(east.centerX > view.centerX);
  assert.ok(Math.abs(east.centerX - view.centerX - 50) < 1e-12, `moved ${east.centerX - view.centerX}`);
  assert.equal(KEY_PAN_FRACTION, 0.2);
  assert.ok(viewAfterKey(view, 'ArrowLeft').centerX < view.centerX);
  assert.ok(viewAfterKey(view, 'ArrowUp').centerY < view.centerY);
  assert.ok(viewAfterKey(view, 'ArrowDown').centerY > view.centerY);

  // Four presses cover the whole range, so the ceiling is reachable by hand.
  let reached = homeView();
  for (let i = 0; i < 4; i++) reached = viewAfterKey(reached, '=');
  assert.equal(reached.scale, MAP_MAX_SCALE);

  // Anything else belongs to whoever else wanted it.
  assert.equal(viewAfterKey(view, 'Enter'), null);
  assert.equal(viewAfterKey(view, 'PageDown'), null);
});

test('a drag is not a tap, so looking at a route never re-arranges it', () => {
  const down = { x: 120, y: 90 };
  assert.equal(isDrag(down, { x: 123, y: 93 }), false);
  assert.equal(isDrag(down, { x: 120 + DRAG_SLOP_PX, y: 90 }), false);
  assert.equal(isDrag(down, { x: 120 + DRAG_SLOP_PX + 1, y: 90 }), true);
  assert.equal(isDrag(down, { x: 180, y: 300 }), true);
});

test('a pointer reads the same box the drawing is in', () => {
  // The canvas is wider than the drawing's 5:3, so the picture is letterboxed
  // inside it and the margin has to come off before anything is asked.
  const rect = { left: 10, top: 20, width: 324, height: 180 };
  const middle = pointInBox(rect, 10 + 162, 20 + 90);
  assert.ok(Math.abs(middle.x - 500) < 1e-9);
  assert.ok(Math.abs(middle.y - 300) < 1e-9);

  // And it is the exact reverse of where the tile layer puts a coordinate, so
  // a tap can be turned back into a point on the track.
  const frame = viewFrame(traceFrame(ROUTE), { scale: 4, centerX: 500, centerY: 300 });
  const layer = tileLayer(frame, PHONE);
  const coords = projectInFrame(ROUTE, frame);
  ROUTE.forEach((point, i) => {
    const at = layer.project(point.lat, point.lon);
    const back = pointInBox({ left: 0, top: 0, width: PHONE.width, height: PHONE.height }, at.x, at.y);
    assert.ok(Math.abs(back.x - coords[i].x) < 1e-6, `x ${back.x} vs ${coords[i].x}`);
    assert.ok(Math.abs(back.y - coords[i].y) < 1e-6, `y ${back.y} vs ${coords[i].y}`);
  });
});

test('the tiles follow the view, one level for every doubling', () => {
  const frame = traceFrame(ROUTE);
  const fit = tileLayer(viewFrame(frame, homeView()), PHONE);
  for (const [scale, levels] of [[2, 1], [4, 2], [8, 3], [16, 4]]) {
    const closer = tileLayer(viewFrame(frame, { scale, centerX: 500, centerY: 300 }), PHONE);
    assert.equal(closer.zoom, fit.zoom + levels, `scale ${scale}`);
    // Sharper ground, not more of it: the box is the same box, so the number of
    // tiles it takes to cover does not grow with the zoom.
    assert.ok(closer.tiles.length <= fit.tiles.length + 4, `${closer.tiles.length} tiles`);
  }
});

test('a pinch asks for the levels it passes through, not a plate a frame', () => {
  // The rule the tile policy turns on. A pinch arrives as dozens of small
  // steps; every one of them is a new view, and a view that asked the network
  // for its own plate would be a burst of hundreds of requests for one gesture.
  // What bounds it is that neighbouring steps want the same tiles, so the
  // page's tile cache answers all but the first of each level.
  const frame = traceFrame(ROUTE);
  const wanted = new Set();
  const levels = new Set();
  let plates = 0;
  for (let step = 0; step <= 60; step++) {
    const scale = 1 + (3 * step) / 60;
    const layer = tileLayer(viewFrame(frame, { scale, centerX: 500, centerY: 300 }), PHONE);
    levels.add(layer.zoom);
    plates += layer.tiles.length;
    for (const tile of layer.tiles) wanted.add(`${tile.z}/${tile.x}/${tile.y}`);
  }

  // Three levels crossed on the way from the fit to four times it.
  assert.equal(levels.size, 3);
  // 346 tile rectangles were drawn across those 61 steps, and they are 33
  // different tiles. The cache is what stands between those two numbers, so
  // this is the figure that must stay small.
  assert.equal(plates, 346);
  assert.equal(wanted.size, 33);
});

test('the drawing and the ground stay one picture at every zoom', () => {
  // The register test above, asked again of a map that has been moved: this is
  // the failure that would put the start dot on the wrong side of a river.
  const base = traceFrame(ROUTE);
  for (const view of [
    homeView(),
    { scale: 2, centerX: 400, centerY: 250 },
    { scale: 16, centerX: 500, centerY: 300 },
  ]) {
    const frame = viewFrame(base, view);
    const coords = projectInFrame(ROUTE, frame);
    const layer = tileLayer(frame, PHONE);
    ROUTE.forEach((point, i) => {
      const onScreen = layer.project(point.lat, point.lon);
      assert.ok(
        Math.abs(onScreen.x - (layer.traceOrigin.left + coords[i].x * layer.cssPerUnit)) < 1e-9,
      );
      assert.ok(
        Math.abs(onScreen.y - (layer.traceOrigin.top + coords[i].y * layer.cssPerUnit)) < 1e-9,
      );
    });
  }
});

test('a view is a view, and never a measurement', () => {
  // The one thing zoom must not touch. The figures come from measure.js, which
  // never sees a view, and the drawn line is the same line through the same
  // points wherever the map is standing.
  const { points, measurements } = fixture();
  const fit = renderTrace(points, measurements, t);
  const closer = renderTrace(points, measurements, t, {
    view: { scale: 8, centerX: 300, centerY: 200 },
  });
  assert.equal(closer.coords.length, fit.coords.length);
  assert.notEqual(closer.svg, fit.svg);

  // Every drawn point moved by the same eight about the same point, which is
  // what makes it the same shape seen closer rather than a different shape.
  for (const i of [0, 37, fit.coords.length - 1]) {
    const across = (closer.coords[i].x - 500) / (fit.coords[i].x - 300);
    const down = (closer.coords[i].y - 300) / (fit.coords[i].y - 200);
    assert.ok(Math.abs(across - 8) < 1e-6, `x ${across} at ${i}`);
    assert.ok(Math.abs(down - 8) < 1e-6, `y ${down} at ${i}`);
  }
});
