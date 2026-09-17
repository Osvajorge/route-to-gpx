/** Moving a drawn map, and opening one big enough to read.
 *
 *  Its own file because the same gestures serve two places and neither of them
 *  is about gestures. The re-arranger needs a map it can move so a start point
 *  on a ring can be found at all; the report needs one that opens large,
 *  because a route drawn into a phone's card is a shape rather than a map, and
 *  somebody about to walk it wants to see where it actually goes.
 *
 *  Nothing here fetches a tile or knows a tile URL. It moves a view and asks
 *  its caller to redraw; whoever owns the drawing decides what that costs.
 */

import {
  isDrag,
  homeView,
  panView,
  pinchView,
  pointInBox,
  traceBox,
  zoomViewAt,
  viewAfterKey,
} from './charts.js';

/** How far a double press zooms, and one press of the buttons. */
export const ZOOM_STEP = 1.6;
export const DOUBLE_PRESS_STEP = 2;
const WHEEL_STEP = 1.2;

/** A box whose views may be looked around from.
 *
 *  THIS IS WHERE THE DECISION LIVES. A drawing that can be moved is a map, and
 *  a map you cannot look past the edges of is a picture: somebody about to walk
 *  a route wants the road that reaches the trailhead and the village below the
 *  ridge, neither of which is on the route. A drawing that cannot be moved --
 *  the chart on the report, the small one on a card -- is an illustration of
 *  one route, and it keeps the old pinning, which is what it was always right
 *  for. So the freedom is granted by this file and by nothing else, and it is
 *  granted to every drawing this file is asked to make movable.
 *
 *  `charts.js` holds the rule itself and its reasons: half a window past the
 *  fitted box, and out to a quarter of the fit. */
export function roamingBox(box = traceBox()) {
  return { ...box, roam: true };
}

/** Gives one drawing a map's manners.
 *
 *  A DRAG IS NOT A PRESS, and that is the whole reason a map can both move and
 *  be chosen from. A pointer that travelled further than the slop moved the
 *  map; one that did not is handed to `onPress`, if the caller wanted presses
 *  at all. A second finger ends any press the first was making, because nobody
 *  pinches in order to choose something.
 *
 *  `redraw` is called on every change and must be cheap: it runs on each
 *  pointermove during a drag.
 *
 *  Returns a function that takes the listeners off again, so a viewer that is
 *  built and thrown away does not leave them behind.
 */
export function makeMovable(canvas, { getView, setView, redraw, onPress = null, box = undefined }) {
  if (!canvas) return () => {};

  const roam = roamingBox(box);

  // A map a finger drags must not also scroll whatever is under it.
  canvas.style.touchAction = 'none';
  if (!canvas.hasAttribute('tabindex')) canvas.tabIndex = 0;

  const active = new Map();
  let pinchFrom = null;
  let pressedAt = null;
  let moved = false;

  const at = (event) => pointInBox(canvas.getBoundingClientRect(), event.clientX, event.clientY, box);
  const apply = (view) => {
    setView(view);
    redraw();
  };

  /** A view made while a hand is still on the glass.
   *
   *  The mark rides on the view because the view is the only thing that reaches
   *  the drawing: whoever redraws is handed a view and nothing else. What it
   *  buys is in `renderTrace`, which draws a moving map at the resolution a
   *  moving map is read at, and the full recording again the moment the hand
   *  comes off. */
  const applyMoving = (view) => apply({ ...view, moving: true });

  /** The same view, at rest. One last redraw at full detail, and only when the
   *  gesture actually moved something. */
  const settle = () => {
    const { moving, ...still } = getView() ?? {};
    if (!moving) return;
    apply(still);
  };

  const twoFingers = () => {
    const [a, b] = [...active.values()];
    return { a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y } };
  };

  const onDown = (event) => {
    if (canvas.setPointerCapture) canvas.setPointerCapture(event.pointerId);
    active.set(event.pointerId, at(event));
    if (active.size === 1) {
      pressedAt = at(event);
      moved = false;
    } else if (active.size === 2) {
      pinchFrom = twoFingers();
      moved = true;
    }
  };

  const onMove = (event) => {
    if (!active.has(event.pointerId)) return;
    const now = at(event);
    const before = active.get(event.pointerId);
    active.set(event.pointerId, now);

    if (active.size >= 2 && pinchFrom) {
      const after = twoFingers();
      applyMoving(pinchView(getView(), pinchFrom, after, roam));
      pinchFrom = after;
      return;
    }

    if (pressedAt && !moved && isDrag(pressedAt, now)) moved = true;
    if (!moved) return;
    applyMoving(panView(getView(), now.x - before.x, now.y - before.y, roam));
  };

  const onRelease = (event) => {
    if (!active.has(event.pointerId)) return;
    const where = active.get(event.pointerId);
    active.delete(event.pointerId);
    if (active.size < 2) pinchFrom = null;
    if (active.size === 0) {
      if (pressedAt && !moved && onPress) onPress(where);
      pressedAt = null;
      settle();
    }
  };

  const onDouble = (event) => {
    event.preventDefault();
    apply(zoomViewAt(getView(), DOUBLE_PRESS_STEP, at(event), roam));
  };

  const onWheel = (event) => {
    event.preventDefault();
    apply(zoomViewAt(getView(), event.deltaY < 0 ? WHEEL_STEP : 1 / WHEEL_STEP, at(event), roam));
  };

  const onKey = (event) => {
    // Reset is not in viewAfterKey because "back to the whole route" is a
    // decision about this drawing rather than an arithmetic step.
    if (event.key === '0') {
      event.preventDefault();
      apply(homeView(roam));
      return;
    }
    const next = viewAfterKey(getView(), event.key, roam);
    if (!next) return;
    event.preventDefault();
    apply(next);
  };

  // SAFARI DOES NOT HONOUR touch-action FOR ITS OWN PINCH. On iOS the browser
  // zooms the PAGE through gesturestart/gesturechange, which no amount of
  // touch-action prevents, so a pinch meant for the map zoomed the document
  // instead: the drawn line stayed crisp because it is vector and the ground
  // went soft because it is a raster being stretched, which is exactly what
  // "the line is on top, not the real map" looks like.
  //
  // Refused HERE and nowhere else. Page zoom is how somebody with poor sight
  // reads this, and taking it off the document -- user-scalable=no -- would
  // trade one person's map for another person's text.
  const refuseBrowserZoom = (event) => event.preventDefault();
  canvas.addEventListener('gesturestart', refuseBrowserZoom);
  canvas.addEventListener('gesturechange', refuseBrowserZoom);
  canvas.addEventListener('gestureend', refuseBrowserZoom);

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onRelease);
  canvas.addEventListener('pointercancel', onRelease);
  canvas.addEventListener('dblclick', onDouble);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('keydown', onKey);

  return () => {
    canvas.removeEventListener('gesturestart', refuseBrowserZoom);
    canvas.removeEventListener('gesturechange', refuseBrowserZoom);
    canvas.removeEventListener('gestureend', refuseBrowserZoom);
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerup', onRelease);
    canvas.removeEventListener('pointercancel', onRelease);
    canvas.removeEventListener('dblclick', onDouble);
    canvas.removeEventListener('wheel', onWheel);
    canvas.removeEventListener('keydown', onKey);
  };
}

/** The three moves the wheel and the keyboard make, for a phone that has
 *  neither. `null` means the whole route again.
 *
 *  These are the opened map's own buttons, so they move under the same rule its
 *  fingers do: zooming out with the button goes as far out as pinching out
 *  does, and neither drops a view that has been looked around back inside the
 *  route. */
export function steppedView(view, step, box = undefined) {
  const roam = roamingBox(box);
  if (step === null) return homeView(roam);
  const middle = { x: 500, y: 300 };
  return zoomViewAt(view, step, middle, roam);
}
