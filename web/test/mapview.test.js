// Run with:  node --test web/test/
//
// Moving a map, without a browser. The listeners are attached to a stand-in
// that records what it was given, so the rules that matter -- a drag is not a
// press, a second finger ends a press, a wheel zooms the point under it -- are
// asserted rather than described.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { MAP_ROAM_MIN_SCALE, homeView, traceBox } from '../assets/charts.js';
import {
  makeMovable,
  roamingBox,
  steppedView,
  ZOOM_STEP,
  DOUBLE_PRESS_STEP,
} from '../assets/mapview.js';

/** The smallest thing that behaves like the canvas this code talks to. */
function fakeCanvas() {
  const listeners = new Map();
  return {
    style: {},
    tabIndex: -1,
    hasAttribute: () => false,
    setPointerCapture: () => {},
    addEventListener: (type, fn) => listeners.set(type, fn),
    removeEventListener: (type) => listeners.delete(type),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 600 }),
    fire(type, event = {}) {
      const fn = listeners.get(type);
      assert.ok(fn, `nothing listening for ${type}`);
      fn({ preventDefault() {}, ...event });
    },
    has: (type) => listeners.has(type),
    count: () => listeners.size,
  };
}

function movable(onPress = null) {
  const canvas = fakeCanvas();
  const state = { view: homeView(), redraws: 0 };
  const off = makeMovable(canvas, {
    getView: () => state.view,
    setView: (v) => { state.view = v; },
    redraw: () => { state.redraws++; },
    onPress,
  });
  return { canvas, state, off };
}

test('a map that a finger drags must not scroll what is under it', () => {
  const { canvas } = movable();
  assert.equal(canvas.style.touchAction, 'none');
  assert.equal(canvas.tabIndex, 0, 'unreachable without a pointer');
});

test('a drag moves the map', () => {
  const { canvas, state } = movable();
  // Zoomed in, or there is nowhere to pan: a route you see whole cannot move.
  canvas.fire('wheel', { deltaY: -120, clientX: 500, clientY: 300 });
  const afterZoom = { ...state.view };
  assert.ok(afterZoom.scale > 1, 'the wheel did not zoom');

  canvas.fire('pointerdown', { pointerId: 1, clientX: 500, clientY: 300 });
  canvas.fire('pointermove', { pointerId: 1, clientX: 560, clientY: 340 });
  canvas.fire('pointerup', { pointerId: 1, clientX: 560, clientY: 340 });
  assert.notDeepEqual(state.view, afterZoom, 'the drag moved nothing');
});

test('a map can be looked around from the fit, which is the whole point of a map', () => {
  // "el mapa es estatico, si quiero ver que hay al rededor deberia de poder".
  // Before this, a drag at the fit moved nothing: the window was pinned inside
  // the route's own box, so the road to the trailhead and the village below the
  // ridge were never on the screen at all.
  const { canvas, state } = movable();
  assert.deepEqual(state.view, homeView(), 'the map did not open at the fit');

  canvas.fire('pointerdown', { pointerId: 1, clientX: 500, clientY: 300 });
  canvas.fire('pointermove', { pointerId: 1, clientX: 300, clientY: 200 });
  canvas.fire('pointerup', { pointerId: 1, clientX: 300, clientY: 200 });
  assert.notDeepEqual(state.view, homeView(), 'a drag at the fit moved nothing');

  // And the route is never lost: the whole route is one key away, exactly.
  canvas.fire('keydown', { key: '0' });
  assert.deepEqual(state.view, homeView());

  // The freedom is granted here and nowhere else. A drawing charts.js is asked
  // about on its own -- the chart on a report, the shape on a card -- stays
  // pinned, which is the right rule for a picture of one route.
  assert.equal(roamingBox().roam, true);
  assert.equal(traceBox().roam, undefined);
});

test('a map is pulled out past the route, and the buttons go where the fingers go', () => {
  const far = steppedView(homeView(), 1 / ZOOM_STEP);
  assert.ok(far.scale < 1, 'the button stopped at the fit');

  let out = homeView();
  for (let i = 0; i < 6; i++) out = steppedView(out, 1 / ZOOM_STEP);
  assert.equal(out.scale, MAP_ROAM_MIN_SCALE, 'the way out has no floor of its own');

  // A view that has been looked around does not lose that to a button, which
  // would snap the map back inside the route between one press and the next.
  assert.equal(steppedView(far, ZOOM_STEP).roam, true);
});

test('a hand on the glass is marked on the view, and letting go clears it', () => {
  // What the mark buys is in renderTrace: a moving map is drawn at a moving
  // map's resolution. It rides on the view because a redraw is handed a view
  // and nothing else.
  const { canvas, state } = movable();
  canvas.fire('pointerdown', { pointerId: 1, clientX: 500, clientY: 300 });
  canvas.fire('pointermove', { pointerId: 1, clientX: 400, clientY: 240 });
  assert.equal(state.view.moving, true, 'the drawing was not told it is moving');

  const duringDrag = state.redraws;
  canvas.fire('pointerup', { pointerId: 1, clientX: 400, clientY: 240 });
  assert.ok(!state.view.moving, 'the map was left in its moving drawing at rest');
  assert.equal(state.redraws, duringDrag + 1, 'nothing redrew at full detail when the hand came off');
  // The settled view is the view the hand left, not a view of its own.
  assert.equal(state.view.scale, 1);

  // A press that never travelled asks for no redraw at all.
  const still = movable();
  still.canvas.fire('pointerdown', { pointerId: 1, clientX: 500, clientY: 300 });
  still.canvas.fire('pointerup', { pointerId: 1, clientX: 502, clientY: 301 });
  assert.equal(still.state.redraws, 0);
});

test('a press that did not travel is a press, and one that did is not', () => {
  const pressed = [];
  const { canvas } = movable((where) => pressed.push(where));

  // Still: a press.
  canvas.fire('pointerdown', { pointerId: 1, clientX: 400, clientY: 300 });
  canvas.fire('pointerup', { pointerId: 1, clientX: 400, clientY: 300 });
  assert.equal(pressed.length, 1, 'a still press was not reported');

  // Travelled: a drag, and no press.
  canvas.fire('pointerdown', { pointerId: 2, clientX: 100, clientY: 100 });
  canvas.fire('pointermove', { pointerId: 2, clientX: 300, clientY: 260 });
  canvas.fire('pointerup', { pointerId: 2, clientX: 300, clientY: 260 });
  assert.equal(pressed.length, 1, 'a drag was mistaken for a press');
});

test('a second finger ends the press the first was making', () => {
  // Nobody pinches in order to choose something.
  const pressed = [];
  const { canvas } = movable((where) => pressed.push(where));
  canvas.fire('pointerdown', { pointerId: 1, clientX: 400, clientY: 300 });
  canvas.fire('pointerdown', { pointerId: 2, clientX: 600, clientY: 300 });
  canvas.fire('pointerup', { pointerId: 2, clientX: 600, clientY: 300 });
  canvas.fire('pointerup', { pointerId: 1, clientX: 400, clientY: 300 });
  assert.equal(pressed.length, 0, 'a pinch chose something');
});

test('a pinch zooms', () => {
  const { canvas, state } = movable();
  const before = { ...state.view };
  canvas.fire('pointerdown', { pointerId: 1, clientX: 400, clientY: 300 });
  canvas.fire('pointerdown', { pointerId: 2, clientX: 600, clientY: 300 });
  // Fingers apart: zoom in.
  canvas.fire('pointermove', { pointerId: 1, clientX: 300, clientY: 300 });
  canvas.fire('pointermove', { pointerId: 2, clientX: 700, clientY: 300 });
  assert.ok(state.view.scale > before.scale, 'spreading two fingers did not zoom in');
});

test('the wheel zooms and the keyboard does everything a pointer does', () => {
  const { canvas, state } = movable();
  canvas.fire('wheel', { deltaY: -120, clientX: 500, clientY: 300 });
  const zoomed = state.view.scale;
  assert.ok(zoomed > 1);

  canvas.fire('keydown', { key: 'ArrowRight' });
  canvas.fire('keydown', { key: '-' });
  assert.ok(state.view.scale < zoomed, 'minus did not zoom out');

  // Zero is the whole route again.
  canvas.fire('wheel', { deltaY: -120, clientX: 500, clientY: 300 });
  canvas.fire('keydown', { key: '0' });
  assert.deepEqual(state.view, homeView(), 'zero did not go back to the fit');
});

test('a key the map has no use for is left to the page', () => {
  const { canvas, state } = movable();
  const before = { ...state.view };
  canvas.fire('keydown', { key: 'Tab' });
  canvas.fire('keydown', { key: 'q' });
  assert.deepEqual(state.view, before);
});

test('a viewer thrown away takes its listeners with it', () => {
  // A fullscreen map is built and destroyed every time it opens, and listeners
  // left behind on a canvas that is still in the document would stack up.
  const { canvas, off } = movable();
  assert.ok(canvas.count() > 0);
  off();
  assert.equal(canvas.count(), 0, 'listeners survived the teardown');
});

test('the buttons a phone needs do what the wheel and the keyboard do', () => {
  const fit = homeView();
  const closer = steppedView(fit, ZOOM_STEP);
  assert.ok(closer.scale > fit.scale);
  assert.deepEqual(steppedView(closer, null), fit, 'reset did not return to the fit');
  assert.ok(DOUBLE_PRESS_STEP > ZOOM_STEP, 'a double press should move further than a button');
});

test('the map refuses the browser its own pinch, and only inside the map', () => {
  // Safari does not honour touch-action for ITS pinch: on iOS the browser
  // zooms the page through gesturestart/gesturechange whatever touch-action
  // says. So a pinch meant for the map zoomed the document, the vector line
  // stayed crisp and the raster ground went soft -- which is what "the line is
  // on top, not the real map" looks like from the outside.
  const source = readFileSync(fileURLToPath(new URL('../assets/mapview.js', import.meta.url)), 'utf8');
  for (const gesture of ['gesturestart', 'gesturechange', 'gestureend']) {
    assert.match(source, new RegExp(`addEventListener\\('${gesture}'`), `${gesture} not refused`);
    assert.match(source, new RegExp(`removeEventListener\\('${gesture}'`), `${gesture} survives teardown`);
  }

  // And nowhere else. Page zoom is how somebody with poor sight reads this;
  // user-scalable=no would trade one person's map for another person's text.
  const html = readFileSync(fileURLToPath(new URL('../index.html', import.meta.url)), 'utf8');
  assert.doesNotMatch(html, /user-scalable\s*=\s*no/, 'page zoom was taken off the document');
  assert.doesNotMatch(html, /maximum-scale\s*=\s*1/, 'page zoom was capped');
});
