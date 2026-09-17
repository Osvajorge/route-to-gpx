// The two drawings: the track seen from above, and its elevation profile.
//
// They share one job. Both must make the recording gap impossible to miss,
// because that is the one measurement that changes what you do on the
// mountain. So the gap gets the same weight in both: a heavy dashed chord in
// the warning colour, end marks where the recording stopped and resumed, and a
// label anchored to it. A small ringed dot is not enough on the map when the
// profile shows a tinted band.
//
// Everything here is arithmetic and strings. Fetching tiles, painting them and
// writing the axis numbers are the caller's work, so this file runs and is
// tested without a browser.

const TRACE_W = 1000;
const TRACE_H = 600;
const TRACE_PAD = 34;
const PROFILE_W = 1000;
const PROFILE_H = 230;
const TILE_SIZE = 256;
// A backstop for shapes that would otherwise ask for a wall of tiles, not a
// number the ordinary case is meant to hit. When this fires the map has already
// given up more sharpness than ZOOM_BIAS intended.
const MAX_TILES = 64;

// The basemap is drawn one zoom coarser than the screen could resolve, on
// purpose. It is ground, damped to a fraction of its brightness and sitting
// under the only two things on the chart that matter, so the sharpness buys
// nothing; a level costs four times the requests, and they are made to a
// service funded by donations. Each tile ends up enlarged about 16%, which is
// not visible through the damping.
const ZOOM_BIAS = 1;

/** Where Web Mercator is cut off, north and south. Cutting here is what makes
 *  the projected world square, which is what map tiles are cut on. */
export const MAX_LATITUDE = 85.05112877980659;

// ------------------------------------------------------------------ mercator
//
// World coordinates run 0 to 1 across the whole world, x east and y south.
// The track is projected the same way the basemap is cut, so a tile laid under
// the trace lines up with it at every size instead of sliding off as you move
// away from the middle of the route.

export function lonToWorldX(lon) {
  return (lon + 180) / 360;
}

export function latToWorldY(lat) {
  // One corrupt latitude past the cut-off would come back as infinity and
  // blank the whole chart, so it is clamped before the tangent, not after.
  const clamped = Math.min(MAX_LATITUDE, Math.max(-MAX_LATITUDE, lat));
  const phi = (clamped * Math.PI) / 180;
  return 0.5 - Math.asinh(Math.tan(phi)) / (2 * Math.PI);
}

export function worldXToLon(worldX) {
  return worldX * 360 - 180;
}

export function worldYToLat(worldY) {
  return (Math.atan(Math.sinh(Math.PI * (1 - 2 * worldY))) * 180) / Math.PI;
}

/** A recording in world units, worked out once and kept.
 *
 *  A pinch asks for the same projection of the same recording sixty times a
 *  second, and the expensive half of it -- a tangent and an inverse hyperbolic
 *  sine per point -- does not depend on where the fingers are. Only the
 *  subtract and the multiply below do. So the trigonometry is done once per
 *  recording and what a frame costs is two arithmetic operations per point.
 *
 *  Held weakly against the array the caller owns, so a route the page has
 *  finished with takes its numbers with it. Nothing here edits a recording in
 *  place -- a re-arranged route is a new array -- so what is kept cannot go
 *  stale under it. Two plain arrays rather than objects: a day-long recording
 *  is tens of thousands of points, and this is a copy of all of them. */
const worldUnits = new WeakMap();

function worldOf(points) {
  const held = worldUnits.get(points);
  if (held && held.length === points.length) return held;
  const count = points.length;
  const wx = new Float64Array(count);
  const wy = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    wx[i] = lonToWorldX(points[i].lon);
    wy[i] = latToWorldY(points[i].lat);
  }
  const made = { wx, wy, length: count };
  worldUnits.set(points, made);
  return made;
}

/** How a shape sits in a box: the world point that lands at (0, 0), and how
 *  many box units one world unit covers. Mercator keeps angles, so one factor
 *  serves both axes, and that single factor is what lets the tile layer
 *  register with the drawing exactly.
 *
 *  The box is a parameter because the same shape is drawn at two sizes now:
 *  the report's chart, and the small drawing on a card. Two fits written out
 *  twice would disagree eventually, and a card that disagrees with the chart it
 *  leads to is worse than a card with no drawing on it. */
export function fitFrame(points, box) {
  let minWX = Infinity;
  let maxWX = -Infinity;
  let minWY = Infinity;
  let maxWY = -Infinity;
  // A long recording is tens of thousands of points, which is more arguments
  // than Math.min(...array) can take, so the bounds are found by walking.
  const world = worldOf(points);
  for (let i = 0; i < world.length; i++) {
    const wx = world.wx[i];
    const wy = world.wy[i];
    if (wx < minWX) minWX = wx;
    if (wx > maxWX) maxWX = wx;
    if (wy < minWY) minWY = wy;
    if (wy > maxWY) maxWY = wy;
  }

  // A track that never moved has no extent to fit. The floor keeps the scale
  // finite, and the zoom clamp downstream turns it into a single tile.
  const spanX = maxWX - minWX || 1e-12;
  const spanY = maxWY - minWY || 1e-12;
  const unitsPerWorld = Math.min(
    (box.width - 2 * box.pad) / spanX,
    (box.height - 2 * box.pad) / spanY,
  );
  const offsetX = (box.width - spanX * unitsPerWorld) / 2;
  const offsetY = (box.height - spanY * unitsPerWorld) / 2;

  return {
    worldX0: minWX - offsetX / unitsPerWorld,
    worldY0: minWY - offsetY / unitsPerWorld,
    unitsPerWorld,
  };
}

/** The report chart's own fit. The tile layer reads this frame, so the box it
 *  is measured in is the one the basemap is cut to. */
export function traceFrame(points) {
  return fitFrame(points, { width: TRACE_W, height: TRACE_H, pad: TRACE_PAD });
}

export function projectInFrame(points, frame) {
  const world = worldOf(points);
  const out = new Array(world.length);
  for (let i = 0; i < world.length; i++) {
    out[i] = {
      x: (world.wx[i] - frame.worldX0) * frame.unitsPerWorld,
      y: (world.wy[i] - frame.worldY0) * frame.unitsPerWorld,
    };
  }
  return out;
}

/** Track points as viewBox coordinates. There is no north-south flip here:
 *  Mercator y already grows south, the way SVG y does. Flipping it as well
 *  would mirror the track against the map underneath it. */
export function projectTrace(points) {
  return projectInFrame(points, traceFrame(points));
}

// ------------------------------------------------------------------ map view
//
// Moving and zooming a drawing, as arithmetic on its own fit.
//
// WHY THIS EXISTS. The re-arranger asks somebody to pick one recorded point out
// of hundreds. On a phone that drawing gets a box 324 CSS px wide, and on the
// 551 point route this was measured against, two points next to each other land
// a median 1.1 px apart in it. The point being picked cannot be seen, so it
// cannot be picked.
//
// WHAT IT COSTS THE TILE SERVER, measured before it was written. Nothing per
// frame. A view is the same box as it was, so it takes the same handful of
// tiles to cover it; what a zoom changes is which level they are cut from.
// Walked from the fit to the ceiling in the 121 steps a pinch actually arrives
// in, that route drew 754 plates and wanted 41 different tiles across five
// levels. The page's tile cache is the whole difference between those two
// numbers, which is why nothing here fetches anything itself.
//
// A view is how much closer than the fit to stand, and which point of the
// fitted box to stand in front of: `{ scale, centerX, centerY }`, all in box
// units, so one view means the same thing on every screen.
//
// It is applied by moving the frame, never by scaling the finished picture.
// Everything downstream reads the frame: the projected track, the tiles, the
// start dot, the gap label. One set of numbers moves all of them at once and
// they cannot come out of register with each other, which is exactly what a CSS
// transform over the top would have done, leaving the ground underneath at the
// sharpness and the position it had before the fingers moved.

/** No further out than the fit, for a drawing that is only ever looked at. A
 *  chart on a report is an illustration of one route and nothing else, so it
 *  stays where it was put. */
export const MAP_MIN_SCALE = 1;

/** No further out than the route at a quarter of the window, for a map.
 *
 *  A map that stopped at the fit could never show the valley the route does not
 *  enter, which is half of what somebody reads a map for the night before. A
 *  quarter each way is sixteen times the route's own area: the village below
 *  the ridge and the road to the trailhead, and not a continent.
 *
 *  It does not cost the tile server anything, which was measured before it was
 *  written. Going out one step drops the tile level by one at the same time, so
 *  the same window still takes the same handful of tiles: on the 551 point
 *  route in a 390x677 phone canvas, 12 tiles at the fit, 12 at this floor, and
 *  12 pushed as far into the corner as the margin below allows, against the
 *  ceiling of 64 in `tileLayer`. What limits this is meaning, not tiles. */
export const MAP_ROAM_MIN_SCALE = 0.25;

/** How far past the fitted box a map may be pushed, as a share of the window.
 *
 *  A half means the centre of the window stays inside the box the route was
 *  fitted into. At the fit that is exactly half a screen of new ground in any
 *  direction with the other half still route. Zoomed in it is half a screen
 *  past the box, and the box has corners a diagonal route never visits, so the
 *  route can be off the screen there -- as it could before any of this, at the
 *  same zoom, under the old rule. What answers that is Fit, which is a labelled
 *  button, the 0 key and the Home key, and which lands back on the drawing the
 *  map opened with.
 *
 *  The alternatives were weighed and refused. A multiple of the route's own box
 *  would let a 2 km stroll be pushed behind a mountain range while a 140 km ride
 *  barely moved, because the allowance would grow with the route rather than
 *  with the screen. Unbounded panning turns
 *  "where has my route gone" into a page reload, which is the one thing a
 *  drawing this page has already measured must never need. */
export const ROAM_MARGIN = 0.5;

/** As close as the map goes. It puts the 1.1 px measured above at 17, so the
 *  point being picked can be told from the ones either side of it, and it is
 *  four doublings, which is four tile levels and no more. */
export const MAP_MAX_SCALE = 16;

/** One press in, one press out. Two is one tile level exactly, so a step never
 *  leaves the map between two sets of tiles, and four steps cover the range. */
export const MAP_ZOOM_STEP = 2;

/** How far one arrow key moves the map: a fifth of what is on screen, so the
 *  ground that was in the middle is still on screen after the press. */
export const KEY_PAN_FRACTION = 0.2;

/** How far a finger may slide and still have meant to tap.
 *
 *  A pick that fired at the end of a pan would move the start of somebody's
 *  route every time they looked at the far side of it. Eight px is above the
 *  wobble of a finger held still on glass and well below a deliberate drag. */
export const DRAG_SLOP_PX = 8;

/** The box the report's trace is fitted into. */
export function traceBox() {
  return { width: TRACE_W, height: TRACE_H };
}

/** The whole route, which is where every drawing starts and what the reset goes
 *  back to.
 *
 *  It carries no permission either way, because the fit is the same view under
 *  both rules: the route whole, in the middle. Whatever moves it next says what
 *  that move is allowed to do. */
export function homeView(box = traceBox()) {
  return { scale: 1, centerX: box.width / 2, centerY: box.height / 2 };
}

/** Which floor a view is held to, in one place: the clamp and the zoom both
 *  need it and a second copy of it would be a map that stops in one direction
 *  and not the other. */
function scaleFloor(view, box) {
  return (view?.roam ?? box?.roam) === true ? MAP_ROAM_MIN_SCALE : MAP_MIN_SCALE;
}

/** A view with the route still findable from it.
 *
 *  TWO RULES, AND WHICH ONE APPLIES IS SAID OUT LOUD. A drawing that is only
 *  ever looked at is PINNED: its window stays inside the fitted box, so it
 *  cannot be pushed off its own edge, and at the fit it cannot move at all,
 *  because panning a route you can already see whole would do nothing. That is
 *  the right rule for the chart on the report and for a card, and it was the
 *  wrong rule for the map that opens: it made a map you cannot look around,
 *  which is a picture. A drawing that ROAMS may be pushed half a window past
 *  the fitted box in any direction and pulled out to a quarter of the fit.
 *
 *  THE FLAG TRAVELS ON THE VIEW, not on the box, because the view is the one
 *  thing that reaches every clamp: the gesture makes a view, the page stores
 *  it, and `renderTrace` clamps it again a frame later through `viewFrame`,
 *  where no box of the caller's is in hand. A box may carry `roam` to say what
 *  a view it produces is allowed; the view then carries it onward itself. A
 *  drawing nobody made movable never sees either, and is pinned exactly as it
 *  was before any of this. */
export function clampView(view, box = traceBox()) {
  const roams = (view?.roam ?? box?.roam) === true;
  const floor = scaleFloor(view, box);
  const asked = Number.isFinite(view?.scale) ? view.scale : 1;
  const scale = Math.min(MAP_MAX_SCALE, Math.max(floor, asked));
  const halfW = box.width / (2 * scale);
  const halfH = box.height / (2 * scale);
  // Half a window each way, which puts the edge of the fitted box no further in
  // than the middle of the screen.
  const marginX = roams ? 2 * ROAM_MARGIN * halfW : 0;
  const marginY = roams ? 2 * ROAM_MARGIN * halfH : 0;
  const centerX = Number.isFinite(view?.centerX) ? view.centerX : box.width / 2;
  const centerY = Number.isFinite(view?.centerY) ? view.centerY : box.height / 2;
  const at = {
    scale,
    centerX: Math.min(box.width - halfW + marginX, Math.max(halfW - marginX, centerX)),
    centerY: Math.min(box.height - halfH + marginY, Math.max(halfH - marginY, centerY)),
  };
  if (roams) at.roam = true;
  return at;
}

/** The same fit, seen from where the view stands.
 *
 *  The frame is the one thing the tile layer and the projection share, so
 *  handing them a moved frame is all it takes to move the whole picture
 *  together. The tiles come back cut for the ground now on screen and at the
 *  level that ground deserves, because `tileLayer` works its zoom out from
 *  `unitsPerWorld`, which this multiplies. */
export function viewFrame(frame, view, box = traceBox()) {
  const at = clampView(view, box);
  const left = at.centerX - box.width / (2 * at.scale);
  const top = at.centerY - box.height / (2 * at.scale);
  return {
    worldX0: frame.worldX0 + left / frame.unitsPerWorld,
    worldY0: frame.worldY0 + top / frame.unitsPerWorld,
    unitsPerWorld: frame.unitsPerWorld * at.scale,
  };
}

/** The map dragged by (dx, dy) box units, the way a finger drags paper: the
 *  ground under the finger stays under it. */
export function panView(view, dx, dy, box = traceBox()) {
  const at = clampView(view, box);
  // Spread rather than rebuilt, so a view that was allowed to roam is still
  // allowed to after it has moved. A fresh literal here dropped the permission
  // and the next clamp pulled the map back inside the route.
  return clampView(
    { ...at, centerX: at.centerX - dx / at.scale, centerY: at.centerY - dy / at.scale },
    box,
  );
}

/** Closer or further by `factor`, with `anchor` left where it is.
 *
 *  Anchoring is what makes pinching and double-tapping feel like a map rather
 *  than a slider: you get closer to the thing you put your fingers on, not to
 *  whatever happened to be in the middle. `anchor` is in box units, the same
 *  ones the drawing is in. */
export function zoomViewAt(view, factor, anchor, box = traceBox()) {
  const at = clampView(view, box);
  const step = Number.isFinite(factor) && factor > 0 ? factor : 1;
  // The same floor the clamp below would apply. Worked out here as well because
  // the anchoring needs the scale it is about to land on, not the one it asked
  // for: a zoom that was cut short by the floor and anchored as if it had not
  // been would slide the ground out from under the fingers at the far end.
  const scale = Math.min(MAP_MAX_SCALE, Math.max(scaleFloor(at, box), at.scale * step));
  // Where the anchor sits on the fit. That is the point that must not move, so
  // it is found before the scale changes and put back after.
  const held = {
    x: at.centerX + (anchor.x - box.width / 2) / at.scale,
    y: at.centerY + (anchor.y - box.height / 2) / at.scale,
  };
  return clampView(
    {
      ...at,
      scale,
      centerX: held.x - (anchor.x - box.width / 2) / scale,
      centerY: held.y - (anchor.y - box.height / 2) / scale,
    },
    box,
  );
}

/** Two fingers, from where they were to where they are.
 *
 *  Pinching and dragging are one gesture, not two: the fingers spread and the
 *  hand moves at the same time, and a map that honoured only the spread would
 *  slide out from under them. Each pair is `{ a, b }` in box units. */
export function pinchView(view, before, after, box = traceBox()) {
  const wasApart = Math.hypot(before.a.x - before.b.x, before.a.y - before.b.y);
  const nowApart = Math.hypot(after.a.x - after.b.x, after.a.y - after.b.y);
  // Two fingers landing on one pixel would otherwise divide by nothing and
  // throw the map to the far side of the world.
  const factor = wasApart > 0 && nowApart > 0 ? nowApart / wasApart : 1;
  const wasMiddle = { x: (before.a.x + before.b.x) / 2, y: (before.a.y + before.b.y) / 2 };
  const nowMiddle = { x: (after.a.x + after.b.x) / 2, y: (after.a.y + after.b.y) / 2 };
  const zoomed = zoomViewAt(view, factor, wasMiddle, box);
  return panView(zoomed, nowMiddle.x - wasMiddle.x, nowMiddle.y - wasMiddle.y, box);
}

/** The view after a key press, or null when the key was not one of ours.
 *
 *  Null rather than the view unchanged, so the caller knows to leave the event
 *  alone: a page that swallowed every key over a map would take the arrows away
 *  from anybody scrolling past it.
 *
 *  The arrows point where the reader wants to go, plus and minus do what one
 *  double-tap does, and Home is the whole route back. A map that can only be
 *  reached with a finger is a map half this page's readers cannot use. */
export function viewAfterKey(view, key, box = traceBox()) {
  const acrossX = box.width * KEY_PAN_FRACTION;
  const acrossY = box.height * KEY_PAN_FRACTION;
  const middle = { x: box.width / 2, y: box.height / 2 };
  switch (key) {
    case 'ArrowLeft':
      return panView(view, acrossX, 0, box);
    case 'ArrowRight':
      return panView(view, -acrossX, 0, box);
    case 'ArrowUp':
      return panView(view, 0, acrossY, box);
    case 'ArrowDown':
      return panView(view, 0, -acrossY, box);
    case '+':
    case '=':
    case 'Add':
      return zoomViewAt(view, MAP_ZOOM_STEP, middle, box);
    case '-':
    case '_':
    case 'Subtract':
      return zoomViewAt(view, 1 / MAP_ZOOM_STEP, middle, box);
    case '0':
    case 'Home':
      return homeView(box);
    default:
      return null;
  }
}

/** Whether a finger that went down at `from` and came up at `to` was dragging
 *  the map rather than pointing at something on it. Both are in CSS pixels,
 *  which is where the slop is a finger's worth on every screen. */
export function isDrag(from, to) {
  return Math.hypot(to.x - from.x, to.y - from.y) > DRAG_SLOP_PX;
}

/** Where a pointer is, in box units.
 *
 *  The drawing keeps its aspect ratio and is letterboxed inside its canvas, so
 *  the margin comes off before anything can be asked about the picture. Written
 *  once here because every caller that reads a pointer over a trace needs it,
 *  and copies of it would disagree the first time the box changed. */
export function pointInBox(rect, clientX, clientY, box = traceBox()) {
  const k = Math.min(rect.width / box.width, rect.height / box.height);
  return {
    x: (clientX - rect.left - (rect.width - box.width * k) / 2) / k,
    y: (clientY - rect.top - (rect.height - box.height * k) / 2) / k,
  };
}

// ---------------------------------------------------------------- tile layer

/** Everything a basemap under a drawing needs: which zoom, which tiles, where
 *  each one lands, and where a coordinate falls on screen.
 *
 *  `frame` comes from fitFrame, so the tiles inherit the drawing's own fit and
 *  cannot drift from it. `view` is the canvas in CSS pixels, and `view.box` is
 *  the drawing's box in frame units: the report passes nothing and gets its own
 *  1000x600, a card passes 320x180. `view.maxTiles` is the caller's ceiling on
 *  how much it is willing to ask the tile server for, which a card sets far
 *  lower than the report because nine of them are on screen at once.
 *
 *  Nothing is fetched and no URL is built: the caller owns the tile source. */
export function tileLayer(frame, view) {
  // The drawing's own box, in the units the frame was fitted in. It defaults to
  // the report chart because that is the only caller that existed first; a card
  // fits its shape into a 320x180 box and passes that, so the same arithmetic
  // serves both. Reading it from the caller rather than assuming 1000x600 is
  // what stops a card's tiles from being cut to a 5:3 rectangle its drawing
  // does not occupy, which would slide the ground off the line at every size.
  const boxW = view.box?.width ?? TRACE_W;
  const boxH = view.box?.height ?? TRACE_H;
  // The SVG keeps its aspect ratio, so it is letterboxed inside the canvas and
  // the map covers that same rectangle, not the whole box.
  const cssPerUnit = Math.min(view.width / boxW, view.height / boxH);
  // Above 2 the extra pixels cost four times the data for a difference nobody
  // sees on a chart this small, on the connection most likely to be a phone in
  // a car park.
  const dpr = Math.min(view.devicePixelRatio || 1, 2);
  const maxZoom = view.maxZoom ?? 19;
  const maxTiles = view.maxTiles ?? MAX_TILES;

  // Where the drawing's own box lands once the SVG is letterboxed. The
  // map is NOT cut to it: the ground carries on past the route in life, and a
  // lighter rectangle inset in a darker card reads as a picture pasted into the
  // chart rather than as the ground the chart sits on. So the plate is the
  // whole box, and the extra is real map either side.
  const traceW = boxW * cssPerUnit;
  const traceH = boxH * cssPerUnit;
  const traceLeft = (view.width - traceW) / 2;
  const traceTop = (view.height - traceH) / 2;
  // The overspill, back in trace units, so the tile maths can stay in them.
  const spillU = traceLeft / cssPerUnit;
  const spillV = traceTop / cssPerUnit;
  const plate = { left: 0, top: 0, width: view.width, height: view.height };

  function enumerate(z) {
    const worldPx = TILE_SIZE * 2 ** z;
    // Screen pixels per tile pixel. Rounding the zoom up would keep this at or
    // below 1, but ZOOM_BIAS then gives a level back, so it sits near 1.16:
    // tiles slightly enlarged. Anything much above that turns contour lines
    // into porridge, which is what MAX_TILE_STRETCH watches for.
    const shrink = (cssPerUnit * dpr * frame.unitsPerWorld) / worldPx;
    const perUnit = worldPx / frame.unitsPerWorld;
    // Shifted out by exactly the letterbox margin, so the scale is untouched
    // and the track still lands where it landed. Only more ground is shown.
    const px0 = frame.worldX0 * worldPx - spillU * perUnit;
    const py0 = frame.worldY0 * worldPx - spillV * perUnit;
    const px1 = px0 + (boxW + 2 * spillU) * perUnit;
    const py1 = py0 + (boxH + 2 * spillV) * perUnit;

    const columns = 2 ** z;
    const txMin = Math.floor(px0 / TILE_SIZE);
    const txMax = Math.ceil(px1 / TILE_SIZE) - 1;
    // There is nothing above the pole or below it, so those rows are dropped
    // rather than requested.
    const tyMin = Math.max(0, Math.floor(py0 / TILE_SIZE));
    const tyMax = Math.min(columns - 1, Math.ceil(py1 / TILE_SIZE) - 1);

    const tiles = [];
    for (let ty = tyMin; ty <= tyMax; ty++) {
      const top = Math.round((ty * TILE_SIZE - py0) * shrink);
      const bottom = Math.round(((ty + 1) * TILE_SIZE - py0) * shrink);
      for (let tx = txMin; tx <= txMax; tx++) {
        // The edges are rounded, never the widths, so two neighbours share one
        // integer boundary and no hairline of background shows between them.
        const left = Math.round((tx * TILE_SIZE - px0) * shrink);
        const right = Math.round(((tx + 1) * TILE_SIZE - px0) * shrink);
        tiles.push({
          z,
          // A route that crosses the date line asks for columns off the end of
          // the grid; the world wraps there even though the numbering does not.
          x: ((tx % columns) + columns) % columns,
          y: ty,
          left,
          top,
          width: right - left,
          height: bottom - top,
        });
      }
    }
    return { tiles, shrink };
  }

  // The finest zoom the screen can actually show. Clamping happens before any
  // tile is counted, which is also what keeps a zero-extent track to one tile.
  let zoom = Math.ceil(
    Math.log2((cssPerUnit * frame.unitsPerWorld * dpr) / TILE_SIZE),
  );
  zoom = Math.max(0, Math.min(maxZoom, zoom - ZOOM_BIAS));
  let range = enumerate(zoom);
  // Each step down quarters the request count. A burst of requests costs more
  // on a mountain connection than one level of sharpness is worth.
  while (range.tiles.length > maxTiles && zoom > 0) {
    zoom -= 1;
    range = enumerate(zoom);
  }

  return {
    zoom,
    tileSize: TILE_SIZE,
    devicePixelRatio: dpr,
    cssPerUnit,
    // Where to put the canvas element, in CSS pixels inside the chart box.
    plate,
    // Where the track's own box starts inside that same space. It is not the
    // plate's corner any more, and a caller that assumes it is will place
    // markers off the line, so the two are named separately.
    traceOrigin: { left: traceLeft, top: traceTop },
    // How big its backing store must be, in device pixels. Tile positions are
    // in this space, so nothing has to be scaled at draw time.
    backing: {
      width: Math.round(plate.width * dpr),
      height: Math.round(plate.height * dpr),
    },
    tiles: range.tiles,
    tileShrink: range.shrink,
    /** A coordinate as CSS pixels inside the chart box, the same space the
     *  gap label and the tooltip are positioned in. */
    project(lat, lon) {
      return {
        x: traceLeft + (lonToWorldX(lon) - frame.worldX0) * frame.unitsPerWorld * cssPerUnit,
        y: traceTop + (latToWorldY(lat) - frame.worldY0) * frame.unitsPerWorld * cssPerUnit,
      };
    },
  };
}

// --------------------------------------------------------------------- ticks
//
// Steps a walker reads without doing arithmetic. Both ladders climb, so the
// first step that fits the space is also the finest one available.

const DISTANCE_STEPS_M = [10, 25, 50, 100, 250, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000];
const ELEVATION_STEPS_M = [1, 2, 5, 10, 25, 50, 100, 200, 250, 500, 1000, 2000];

/** Distance ticks from zero. The last one always falls short of the total: the
 *  right edge of the plot is the finish by construction, and the total is
 *  already the headline of the distance tile. */
export function distanceTicks(totalM, maxLabels) {
  for (const step of DISTANCE_STEPS_M) {
    const count = Math.max(1, Math.ceil(totalM / step));
    if (count <= maxLabels) {
      return Array.from({ length: count }, (_, i) => i * step);
    }
  }
  return [0];
}

/** Round heights inside the range that was drawn. The chart is not rescaled to
 *  fit them: on a plot this short the silhouette is the measurement, and
 *  stretching it up to a round ceiling would draw the climb shallower than it
 *  is. So the top tick usually sits below the summit, which is correct. */
export function elevationTicks(minM, maxM, maxLabels) {
  for (const step of ELEVATION_STEPS_M) {
    const first = Math.ceil(minM / step);
    const last = Math.floor(maxM / step);
    if (last - first + 1 <= maxLabels) {
      const levels = [];
      // `|| 0` is not tidying: Math.ceil of a small negative gives negative
      // zero, it survives the multiplication, and Intl formats it as "-0".
      // Sea level is 0.
      for (let i = first; i <= last; i++) levels.push(i * step || 0);
      return levels;
    }
  }
  return [];
}

// -------------------------------------------------------------------- charts

/** How many points one drawn line may keep.
 *
 *  Both boxes are 1000 units wide, so this is two vertices per unit: finer
 *  than the 2.2-unit stroke drawn over them can show, and finer still once the
 *  box is squeezed into the 250 CSS px a phone gives it. Everything above this
 *  is vertices that land on a pixel another vertex already covers, and the
 *  trace pays for each of them three times over, twice through a blur.
 *
 *  Measured on a 20 000-point track thinned to these 2000: the furthest any
 *  recorded point ends up from the line drawn through them is 0.40 units, and
 *  the average is 0.06. Both are inside the stroke, so the picture is the same
 *  picture.
 *
 *  This governs the drawing and nothing else. Distance, ascent, descent and
 *  the gaps are measured from every recorded point, upstream of this file. */
const DRAWN_POINTS = 2000;

/** The same line, while a hand is still moving it.
 *
 *  A map under the fingers is read as a shape going past, and the budget above
 *  is not a shape budget: it sits above the length of most recordings, so a
 *  1 444 point route redrew all 1 444 points on every pointermove, three paths
 *  over them and two of those through a blur, while a 200 point route redrew
 *  200. The pinch went at the length of the recording, which is the one thing a
 *  gesture must not do.
 *
 *  Five hundred across a 1000 unit box is a vertex every two units, finer than
 *  a pixel on the phone this was complained from. Measured at the fit against
 *  the recording itself: on the 551 point Komoot route the furthest a dropped
 *  point falls from the moving line is 1.9 units and the average 0.03, and on a
 *  20 000 point track 0.31 and 0.09, against a line drawn 2.2 units wide inside
 *  a halo 5 wide. The whole recording is drawn again on the frame after the
 *  hand comes off. */
const MOVING_POINTS = 500;

/** That budget, at the zoom it is being drawn at.
 *
 *  The error above is in the picture's own units, so standing closer magnifies
 *  it along with everything else: a point 1.9 units off the line at the fit is
 *  30 units off at the ceiling, and that is a line visibly beside the ground it
 *  claims to be on. So the budget doubles with every doubling of the scale,
 *  which halves the error back, and the dropped points stay inside the line
 *  they are drawn under wherever the fingers are.
 *
 *  It starts doubling at twice the fit rather than at the fit, because 1.9
 *  units doubled is 3.8 and the halo the line sits in is 5 wide. Four times the
 *  fit reaches the resting budget, and past that a moving drawing simply is the
 *  resting drawing -- which is also where most of the route has left the screen,
 *  so it is the cheap end to give up. */
function movingBudget(scale) {
  const closer = Math.max(1, Number.isFinite(scale) ? scale : 1);
  const doublings = Math.max(0, Math.ceil(Math.log2(closer)) - 1);
  return Math.min(DRAWN_POINTS, MOVING_POINTS * 2 ** doublings);
}

/** The same line through fewer points, chosen so the drawing keeps its shape.
 *
 *  Largest-Triangle-Three-Buckets: one point per bucket, the one making the
 *  largest triangle with the point already kept and the average of the bucket
 *  ahead. Taking every Nth point instead would be shorter to write and wrong
 *  to look at — it keeps whichever point a fixed stride lands on, so a summit
 *  or a hairpin survives or vanishes by luck, and the elevation profile exists
 *  to show exactly those. Area-based picking keeps whatever sticks out.
 *
 *  The first and last points are always kept, so a run thinned here still
 *  starts and ends where the recording does. The two runs either side of a gap
 *  are thinned separately, which is what keeps the gap's own edges exact. */
export function thinForDrawing(pts, budget = DRAWN_POINTS) {
  const count = pts.length;
  if (budget < 3 || count <= budget) return pts;

  const bucket = (count - 2) / (budget - 2);
  const kept = [pts[0]];
  let anchor = 0;

  for (let b = 0; b < budget - 2; b++) {
    // Where the line goes next, as one point: aiming the triangle at the next
    // bucket's average is what makes the pick follow the shape rather than the
    // noise inside its own bucket.
    const aheadFrom = Math.floor((b + 1) * bucket) + 1;
    const aheadTo = Math.min(Math.floor((b + 2) * bucket) + 1, count - 1);
    let aheadX = 0;
    let aheadY = 0;
    for (let i = aheadFrom; i < aheadTo; i++) {
      aheadX += pts[i].x;
      aheadY += pts[i].y;
    }
    const span = Math.max(1, aheadTo - aheadFrom);
    aheadX /= span;
    aheadY /= span;

    const from = Math.floor(b * bucket) + 1;
    const to = Math.min(Math.floor((b + 1) * bucket) + 1, count - 1);
    let best = from;
    let bestArea = -1;
    for (let i = from; i < to; i++) {
      const area = Math.abs(
        (pts[anchor].x - aheadX) * (pts[i].y - pts[anchor].y) -
          (pts[anchor].x - pts[i].x) * (aheadY - pts[anchor].y),
      );
      if (area > bestArea) {
        bestArea = area;
        best = i;
      }
    }
    kept.push(pts[best]);
    anchor = best;
  }

  kept.push(pts[count - 1]);
  return kept;
}

function pathThrough(pts) {
  let d = '';
  for (const point of pts) {
    d += (d === '' ? 'M' : 'L') + point.x.toFixed(1) + ' ' + point.y.toFixed(1);
  }
  return d;
}

/** One run of the recording, thinned once and kept in world units.
 *
 *  Choosing in world units rather than in box units is exact rather than an
 *  approximation. A view is a uniform scale and a shift, so every candidate
 *  triangle in `thinForDrawing` has its area multiplied by the same number, and
 *  the point that wins its bucket wins it at every zoom and every position. So
 *  the choosing happens once per recording and budget, and a frame under a
 *  moving finger only has to project what was already chosen: a few hundred
 *  points instead of the whole recording, and no thinning at all.
 *
 *  Held weakly against the caller's own array, like the world units it reads. */
const drawnRuns = new WeakMap();

function drawnRun(points, from, to, budget) {
  let runs = drawnRuns.get(points);
  if (!runs) {
    runs = new Map();
    drawnRuns.set(points, runs);
  }
  const key = `${from}:${to}:${budget}`;
  const held = runs.get(key);
  if (held) return held;

  const world = worldOf(points);
  const run = new Array(to - from + 1);
  for (let i = from; i <= to; i++) run[i - from] = { x: world.wx[i], y: world.wy[i] };
  const kept = thinForDrawing(run, budget);
  runs.set(key, kept);
  return kept;
}

function pathFrom(points, from, to, budget, frame) {
  let d = '';
  for (const p of drawnRun(points, from, to, budget)) {
    const x = (p.x - frame.worldX0) * frame.unitsPerWorld;
    const y = (p.y - frame.worldY0) * frame.unitsPerWorld;
    d += (d === '' ? 'M' : 'L') + x.toFixed(1) + ' ' + y.toFixed(1);
  }
  return d;
}

/** Index of the point right after the largest gap. */
function gapIndex(measurements) {
  const target = measurements.largestGapAtM;
  const cumulative = measurements.cumulative;
  for (let i = 0; i < cumulative.length; i++) {
    if (cumulative[i] >= target) return i;
  }
  return -1;
}

export function renderTrace(points, measurements, t, options = {}) {
  // No view is the whole route, which is what every drawing on this page was
  // before the re-arranger's map could be moved, and still is everywhere else.
  const view = options.view ?? homeView();
  const frame = viewFrame(traceFrame(points), view);
  const showGap = measurements.gapExceedsThreshold;
  const cut = showGap ? gapIndex(measurements) : -1;
  // One recorded point, where this frame puts it. The three the markup needs
  // are asked for one at a time, because the whole recording projected is a
  // question only the cursor and the press ever ask, and they ask it once.
  const at = (i) => {
    const world = worldOf(points);
    return {
      x: (world.wx[i] - frame.worldX0) * frame.unitsPerWorld,
      y: (world.wy[i] - frame.worldY0) * frame.unitsPerWorld,
    };
  };
  // A hand still on the glass asks for a moving map, which is read at a moving
  // map's resolution. Whoever moved the view said so on the view itself,
  // because a view is all a redraw is handed.
  const budget = view?.moving === true ? movingBudget(view.scale) : DRAWN_POINTS;

  // Split the drawn track either side of the gap so the gap itself is never
  // painted as if it were recorded ground.
  const segments =
    cut > 0 && cut < points.length
      ? [
          pathFrom(points, 0, cut - 1, budget, frame),
          pathFrom(points, cut, points.length - 1, budget, frame),
        ]
      : [pathFrom(points, 0, points.length - 1, budget, frame)];

  const grid = [];
  for (let x = 100; x < TRACE_W; x += 100) {
    grid.push(`<line x1="${x}" y1="0" x2="${x}" y2="${TRACE_H}"/>`);
  }
  for (let y = 100; y < TRACE_H; y += 100) {
    grid.push(`<line x1="0" y1="${y}" x2="${TRACE_W}" y2="${y}"/>`);
  }

  const glow = segments
    .map((d) => `<path d="${d}" class="trace-glow"/><path d="${d}" class="trace-halo"/>`)
    .join('');
  const line = segments.map((d) => `<path d="${d}" class="trace-line"/>`).join('');

  let gapMarkup = '';
  let gapAnchor = null;
  if (cut > 0 && cut < points.length) {
    const a = at(cut - 1);
    const b = at(cut);
    // End marks sit across the chord, so the eye reads "the recording stopped
    // here and resumed there" rather than "there is a dot".
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy) || 1;
    const nx = (-dy / length) * 9;
    const ny = (dx / length) * 9;
    gapMarkup = `
      <line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" class="trace-gap-glow"/>
      <line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" class="trace-gap"/>
      <line x1="${(a.x - nx).toFixed(1)}" y1="${(a.y - ny).toFixed(1)}" x2="${(a.x + nx).toFixed(1)}" y2="${(a.y + ny).toFixed(1)}" class="trace-gap-end"/>
      <line x1="${(b.x - nx).toFixed(1)}" y1="${(b.y - ny).toFixed(1)}" x2="${(b.x + nx).toFixed(1)}" y2="${(b.y + ny).toFixed(1)}" class="trace-gap-end"/>`;
    gapAnchor = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  const start = at(0);
  const svg = `<svg viewBox="0 0 ${TRACE_W} ${TRACE_H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${t('chart.trace')}">
      <g class="chart-grid">${grid.join('')}</g>
      ${glow}${line}${gapMarkup}
      <circle cx="${start.x.toFixed(1)}" cy="${start.y.toFixed(1)}" r="4.5" class="trace-start"/>
      <g class="trace-cursor" hidden>
        <circle r="13" class="trace-cursor-halo"/>
        <circle r="5.5" class="trace-cursor-dot"/>
      </g>
    </svg>`;

  // `coords` is every recorded point in this frame, which is what the cursor
  // and the press search. It is worked out when it is asked for and not before:
  // a pinch redraws sixty times a second and asks for it none of those times,
  // and on a day-long recording it is tens of thousands of objects built for a
  // question nobody put.
  let searched = null;
  return {
    svg,
    gapAnchor,
    viewBox: { w: TRACE_W, h: TRACE_H },
    frame,
    get coords() {
      if (!searched) searched = projectInFrame(points, frame);
      return searched;
    },
  };
}

/** `options.compact` asks for the phone's tick counts. It is a count, not a
 *  measurement of the box: a count fixed per breakpoint means the axis does
 *  not reshuffle itself while a window is being dragged. */
export function renderProfile(points, measurements, t, options = {}) {
  const cumulative = measurements.cumulative;
  const total = measurements.distanceM || 1;
  const min = measurements.elevationMinM ?? 0;
  const max = measurements.elevationMaxM ?? 1;
  const span = max - min || 1;

  const showGap = measurements.gapExceedsThreshold;
  const cut = showGap ? gapIndex(measurements) : -1;

  const px = (i) => (cumulative[i] / total) * PROFILE_W;

  // The axis is the filtered range, so a single bad reading cannot squash the
  // terrain into the bottom of the box. A reading outside it is drawn at the
  // edge rather than off the chart, and `clipped` tells the caller it happened
  // so the report can say so: silently flattening a spike would hide something
  // that is really in the file.
  let clipped = 0;
  const py = (ele) => {
    const inside = Math.max(min, Math.min(max, ele));
    if (inside !== ele) clipped += 1;
    return PROFILE_H - 12 - ((inside - min) / span) * (PROFILE_H - 24);
  };

  const run = (from, to) => {
    const drawn = [];
    for (let i = from; i <= to; i++) {
      const ele = points[i].ele;
      if (ele === null) continue;
      // Every reading goes through py, including the ones the thinning is
      // about to drop from the line: py is what counts the readings outside
      // the range, and that count is a figure the report prints.
      drawn.push({ x: px(i), y: py(ele) });
    }
    return pathThrough(thinForDrawing(drawn));
  };

  const runs =
    cut > 0 && cut < points.length
      ? [run(0, cut - 1), run(cut, points.length - 1)]
      : [run(0, points.length - 1)];

  const area = runs
    .filter(Boolean)
    .map((d) => {
      const first = d.slice(1).split('L')[0].split(' ');
      const lastPair = d.split('L').pop().split(' ');
      return `<path d="${d}L${lastPair[0]} ${PROFILE_H} L${first[0]} ${PROFILE_H} Z" class="profile-area"/>`;
    })
    .join('');
  const stroke = runs
    .filter(Boolean)
    .map((d) => `<path d="${d}" class="profile-line"/>`)
    .join('');

  // A recording with no heights has no scale to read, so it gets no levels.
  const hasElevation = measurements.elevationMinM !== null && measurements.elevationMinM !== undefined;
  const levels = hasElevation ? elevationTicks(min, max, options.compact ? 3 : 4) : [];
  // The lines belong in the SVG and the numbers do not: this chart is drawn
  // with preserveAspectRatio="none", which leaves a horizontal line horizontal
  // but squashes glyphs out of shape. The caller writes the numbers as HTML in
  // a gutter beside the plot.
  const levelMarkup = levels
    .map((ele) => `<line x1="0" y1="${py(ele).toFixed(1)}" x2="${PROFILE_W}" y2="${py(ele).toFixed(1)}"/>`)
    .join('');

  let gapMarkup = '';
  let gapFraction = null;
  if (cut > 0 && cut < points.length) {
    const x1 = px(cut - 1);
    const x2 = px(cut);
    const y1 = py(points[cut - 1].ele ?? min);
    const y2 = py(points[cut].ele ?? min);
    // A short gap on a long route is only a few units wide. Give the band a
    // floor so it stays visible, and mark both edges the way the trace does.
    const bandWidth = Math.max(x2 - x1, 8);
    gapMarkup = `
      <rect x="${x1.toFixed(1)}" y="0" width="${bandWidth.toFixed(1)}" height="${PROFILE_H}" class="profile-gap-band"/>
      <line x1="${x1.toFixed(1)}" y1="0" x2="${x1.toFixed(1)}" y2="${PROFILE_H}" class="profile-gap-end"/>
      <line x1="${(x1 + bandWidth).toFixed(1)}" y1="0" x2="${(x1 + bandWidth).toFixed(1)}" y2="${PROFILE_H}" class="profile-gap-end"/>
      <line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" class="profile-gap"/>`;
    gapFraction = (x1 + bandWidth / 2) / PROFILE_W;
  }

  // The gap label owns its slot under the plot, so a distance tick too close to
  // it is dropped. The origin never gives way: a gap in the first stretch of
  // the route gives up its label instead, and the trace and the warning panel
  // carry it.
  const CROWDED = 0.08;
  if (gapFraction !== null && gapFraction < CROWDED) gapFraction = null;
  const spacedTicks = distanceTicks(total, options.compact ? 5 : 7);
  // The step is read here, from the full list, and handed to the caller. Work
  // it out downstream from the ticks that survived the filter below and a
  // dropped tick reads as a doubled step, which rounds 1.5 km to 2 and prints
  // the same number twice.
  const distanceStepM = spacedTicks.length > 1 ? spacedTicks[1] - spacedTicks[0] : total;
  const distances = spacedTicks
    .map((valueM) => ({ valueM, fraction: valueM / total }))
    .filter(
      (tick) =>
        gapFraction === null ||
        tick.valueM === 0 ||
        Math.abs(tick.fraction - gapFraction) >= CROWDED,
    );

  const svg = `<svg viewBox="0 0 ${PROFILE_W} ${PROFILE_H}" preserveAspectRatio="none" role="img" aria-label="${t('chart.profile')}">
      ${area}<g class="profile-grid">${levelMarkup}</g>${gapMarkup}${stroke}
      <g class="profile-cursor" hidden>
        <line y1="0" y2="${PROFILE_H}" class="profile-cursor-line"/>
        <circle r="4" class="profile-cursor-dot"/>
      </g>
    </svg>`;

  return {
    svg,
    px,
    py,
    // How many readings sat outside the filtered range and were drawn at the
    // edge. Non-zero means the file holds a height the profile could not show
    // at a scale that keeps the ground readable, and the report says so.
    clipped,
    viewBox: { w: PROFILE_W, h: PROFILE_H },
    // Fractions of the plot, not pixels: this chart is stretched to whatever
    // box it is given, so a fraction is right at every size and needs no
    // recalculating when the window moves.
    axis: {
      x: distances,
      stepM: distanceStepM,
      y: levels.map((valueM) => ({ valueM, fraction: py(valueM) / PROFILE_H })),
      gapFraction,
    },
  };
}

/** Distance along the track for the trace point nearest to (x, y) in viewBox
 *  units. The trace keeps its aspect ratio, so the caller has to undo the
 *  letterboxing before asking. */
export function nearestOnTrace(coords, cumulative, x, y) {
  let best = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < coords.length; i++) {
    const d = (coords[i].x - x) ** 2 + (coords[i].y - y) ** 2;
    if (d < bestDistance) {
      bestDistance = d;
      best = i;
    }
  }
  return { index: best, distanceM: cumulative[best] };
}

/** Index of the point at a given distance along the track. */
export function indexAtDistance(cumulative, distanceM) {
  let low = 0;
  let high = cumulative.length - 1;
  while (high - low > 1) {
    const mid = (low + high) >> 1;
    if (cumulative[mid] <= distanceM) low = mid;
    else high = mid;
  }
  return Math.abs(cumulative[low] - distanceM) <= Math.abs(cumulative[high] - distanceM)
    ? low
    : high;
}
