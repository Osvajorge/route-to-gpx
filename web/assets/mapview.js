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

import { isDrag, homeView, panView, pinchView, pointInBox, zoomViewAt, viewAfterKey } from './charts.js';

/** How far a double press zooms, and one press of the buttons. */
export const ZOOM_STEP = 1.6;
export const DOUBLE_PRESS_STEP = 2;
const WHEEL_STEP = 1.2;

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
      apply(pinchView(getView(), pinchFrom, after, box));
      pinchFrom = after;
      return;
    }

    if (pressedAt && !moved && isDrag(pressedAt, now)) moved = true;
    if (!moved) return;
    apply(panView(getView(), now.x - before.x, now.y - before.y, box));
  };

  const onRelease = (event) => {
    if (!active.has(event.pointerId)) return;
    const where = active.get(event.pointerId);
    active.delete(event.pointerId);
    if (active.size < 2) pinchFrom = null;
    if (active.size === 0) {
      if (pressedAt && !moved && onPress) onPress(where);
      pressedAt = null;
    }
  };

  const onDouble = (event) => {
    event.preventDefault();
    apply(zoomViewAt(getView(), DOUBLE_PRESS_STEP, at(event), box));
  };

  const onWheel = (event) => {
    event.preventDefault();
    apply(zoomViewAt(getView(), event.deltaY < 0 ? WHEEL_STEP : 1 / WHEEL_STEP, at(event), box));
  };

  const onKey = (event) => {
    // Reset is not in viewAfterKey because "back to the whole route" is a
    // decision about this drawing rather than an arithmetic step.
    if (event.key === '0') {
      event.preventDefault();
      apply(homeView(box));
      return;
    }
    const next = viewAfterKey(getView(), event.key, box);
    if (!next) return;
    event.preventDefault();
    apply(next);
  };

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onRelease);
  canvas.addEventListener('pointercancel', onRelease);
  canvas.addEventListener('dblclick', onDouble);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('keydown', onKey);

  return () => {
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
 *  neither. `null` means the whole route again. */
export function steppedView(view, step, box = undefined) {
  if (step === null) return homeView(box);
  const middle = { x: 500, y: 300 };
  return zoomViewAt(view, step, middle, box);
}
