// A row, worked out into the parts a card is made of.
//
// A card is denser than a row, and density is where a claim quietly turns into
// a reading. So the arithmetic that decides what a card is allowed to show
// lives here, away from the markup, and can be checked without a browser: a
// figure the source never published is absent rather than zero, a drawing
// appears only when the source handed over the route's own shape, and a rating
// that is not a number does not become a row of stars.
//
// Nothing here formats anything for a reader. Numbers come out as numbers and
// the page turns them into the reader's language, because the decimal mark
// changes with the language and none of that belongs in a rule about nulls.

/** One published figure, or null when the source did not say.
 *
 *  Anything that is not a finite number is the same as absent. Both must stop
 *  here, before a formatter: a 0 printed in a stat grid reads as a measurement,
 *  and this page exists to doubt the source's measurements, not to invent them. */
function figure(published, key) {
  const value = published ? published[key] : null;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** The figures a card puts in its grid, in reading order, with the absent ones
 *  gone rather than blanked.
 *
 *  Four slots at most, and the four the owner asked for: how far, how much
 *  climbing, how long the source thinks it takes, and where it starts from. A
 *  card that has two of them shows two. It never holds a slot open with a dash,
 *  because an empty slot in a grid reads as a template that broke, and a dash
 *  reads as a figure of zero.
 *
 *  Every one of these belongs to the source, which is why they come out of one
 *  function: the page renders them into one region with the source's name on
 *  it, and there is no way to take one out and print it somewhere else. */
export function cardFigures(row) {
  const published = row?.published ?? null;
  const figures = [];

  const distanceM = figure(published, 'distanceM');
  if (distanceM !== null) figures.push({ key: 'distance', metres: distanceM });

  const ascentM = figure(published, 'ascentM');
  if (ascentM !== null) figures.push({ key: 'ascent', metres: ascentM });

  const durationS = figure(published, 'durationS');
  // A duration of zero is not a walk anybody took. It is a field the source
  // filled with a default, and it would print as "0 min" beside 16 km.
  if (durationS !== null && durationS > 0) figures.push({ key: 'duration', seconds: durationS });

  const start = row?.start ?? null;
  const lat = typeof start?.lat === 'number' && Number.isFinite(start.lat) ? start.lat : null;
  const lng = typeof start?.lng === 'number' && Number.isFinite(start.lng) ? start.lng : null;
  // Both or neither: half a coordinate is not a place.
  if (lat !== null && lng !== null) figures.push({ key: 'start', lat, lng });

  return figures;
}

/** Hours and minutes from a number of seconds, or null.
 *
 *  Rounded to the minute, because that is the only precision a source's own
 *  estimate deserves. An estimate that rounds up to a whole hour comes back as
 *  hours and no minutes, not as "3 h 0 min". */
export function durationParts(seconds) {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return null;
  const total = Math.round(seconds / 60);
  return { hours: Math.floor(total / 60), minutes: total % 60 };
}

// -------------------------------------------------------------- the drawing

// The box a card's drawing is fitted into, in its own units. 16:9, the shape
// the card gives it, and small enough that the path stays short in the markup.
export const CARD_TRACE_W = 320;
export const CARD_TRACE_H = 180;
// Room for the stroke and its glow at the edges. A route that ran to the very
// corner of the box would be clipped along the outside of its own line.
const CARD_TRACE_PAD = 12;

/** The route's own shape, ready to draw, or null when there is none.
 *
 *  THE DECISION, and it is not symmetric between the two sources.
 *
 *  Komoot hands over the route's shape: `trace` is the line itself, twenty-odd
 *  to a couple of hundred points of it. The shape says loop, or out and back,
 *  or a line from one valley to another, and that is the first thing a walker
 *  wants to know and the one thing no figure on the card can say. It is drawn.
 *
 *  Wikiloc hands over a photograph somebody took on the path, and no shape. A
 *  photograph is a real picture of a real place and it says nothing whatsoever
 *  about the route: the same rock face fronts a two hour stroll and a fourteen
 *  hour traverse. Shown at card size it would do one job only, which is to make
 *  the list pretty enough to scroll. This product converts a link and doubts a
 *  number; it is not a shelf to browse. So a Wikiloc card carries no drawing,
 *  and is designed for that.
 *
 *  Nothing is fetched to draw this. The shape arrived with the row, so no
 *  request leaves the browser for a picture at all, which is why the footer no
 *  longer has a sentence about an image server: there is nothing to warn about.
 *
 *  IT IS NOT A MEASUREMENT and must never be read as one. Around a hundred
 *  points where the recording has thousands is enough to show a shape and
 *  nowhere near enough to measure it. That is what converting the route is for,
 *  and the drawing carries no number, no scale bar and no length.
 *
 *  The projection is charts.js's, passed in rather than written again here, so
 *  a card and the chart it leads to draw the same route the same way.
 *
 *  `fit` is charts.js `fitFrame` and `project` is its `projectInFrame`. */
export function cardTrace(row, { fit, project }) {
  const trace = row?.trace;
  if (!Array.isArray(trace) || trace.length < 2) return null;

  const points = [];
  for (const pair of trace) {
    if (!Array.isArray(pair) || pair.length < 2) continue;
    const [lat, lon] = pair;
    if (typeof lat !== 'number' || !Number.isFinite(lat)) continue;
    if (typeof lon !== 'number' || !Number.isFinite(lon)) continue;
    points.push({ lat, lon });
  }
  // One point is a dot, not a shape, and a dot on a card says nothing at all.
  if (points.length < 2) return null;

  const box = { width: CARD_TRACE_W, height: CARD_TRACE_H, pad: CARD_TRACE_PAD };
  const frame = fit(points, box);
  const coords = project(points, frame);
  return {
    // The fit itself, handed back rather than kept private, because the ground
    // under the line has to be cut to exactly this fit. A second fit worked out
    // at paint time would drift from the drawing by a rounding step and slide
    // the map off the route.
    frame,
    // One decimal in a 320 unit box is about a third of a screen pixel, which
    // is below what the stroke can show and keeps the path short.
    d: coords
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
      .join(''),
    start: coords[0],
    width: CARD_TRACE_W,
    height: CARD_TRACE_H,
  };
}

/** Everything inside a card's shape slot: the ground, then the line.
 *
 *  One function so the first render and the observer's later injection write
 *  the same thing. The canvas is empty and hidden until tiles arrive, and it is
 *  hidden from assistive technology outright: it carries no information the
 *  line does not, and "canvas" announced nine times is nine announcements of
 *  nothing. What the ground is, and whose it is, is said once under the grid. */
function shapeContents(drawing, alt) {
  return `<canvas class="card-map" aria-hidden="true" hidden></canvas>${shapeSvg(drawing, alt)}`;
}

/** The markup of one card's shape slot, and whether it has to go and get one.
 *
 *  WHY EVERY CARD HAS THE SLOT. A Komoot row arrives with its geometry read
 *  out of its thumbnail URL, so it can draw at once. A Wikiloc search row
 *  carries no coordinates at all, so it used to draw nothing, and one grid held
 *  cards with a picture beside cards with a hole where one would go. The owner
 *  saw that and said the design was nowhere, which it was.
 *
 *  The shape is not missing from Wikiloc, only from its search results: its
 *  trail page carries it, so a card can ask. `url` is set on the slot when
 *  there is something to ask for, and the page asks when the reader reaches
 *  that card and not before, because a trail page is 354 KB and nine of them
 *  for a reader who will open one is crawling rather than answering.
 *
 *  `drawing` is null while the slot is still waiting. An empty slot is quiet on
 *  purpose: nothing spins, because a spinner on nine cards is nine things
 *  moving for a reader who is trying to read. If the shape never comes the
 *  caller drops the slot entirely, which is what a Wikiloc card looked like
 *  before any of this and is honest rather than broken. */
export function shapeSlot(drawing, { url = null, alt = '' } = {}) {
  if (!drawing) {
    return url ? `<div class="card-shape is-waiting" data-shape-url="${escapeAttribute(url)}"></div>` : '';
  }
  return `<div class="card-shape">${shapeContents(drawing, alt)}</div>`;
}

/** The slot's contents, for the observer that fills one in after the fact. */
export function shapeFilled(drawing, alt) {
  return shapeContents(drawing, alt);
}

/** The drawing itself, so the observer can inject exactly what the first render
 *  would have written and the two can never drift apart. */
export function shapeSvg(drawing, alt) {
  return `<svg
      class="card-trace"
      viewBox="0 0 ${drawing.width} ${drawing.height}"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="${escapeAttribute(alt)}"
    >
      <path d="${drawing.d}" class="card-trace-halo"/>
      <path d="${drawing.d}" class="card-trace-line"/>
      <circle cx="${drawing.start.x.toFixed(1)}" cy="${drawing.start.y.toFixed(1)}" r="3" class="card-trace-start"/>
    </svg>`;
}

function escapeAttribute(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------- the grid

// Never more than four across. Five 340px cards is 1760px of grid, wider than
// the panel is ever allowed to grow, and a fifth column would only appear by
// making every card too narrow to read.
const MAX_CARD_COLUMNS = 4;

/** How many columns a grid of `count` cards should use.
 *
 *  THE BUG THIS FIXES, in the owner's words: four columns and one left over.
 *  `repeat(auto-fit, minmax(340px, 1fr))` answers one question only, which is
 *  how many columns the width can hold. At 1512 that is four, so nine cards
 *  came out four, four, and then a single card alone on the last row, which
 *  reads as a card that failed to load rather than as the end of a list. The
 *  same rule stretched one result across the whole 1410px panel and two results
 *  to 699px each: a route card as wide as a broadsheet, with a 793px drawing
 *  on top of two lines of text.
 *
 *  So the count is asked as well as the width, in this order:
 *
 *    1. how many fit          the widest that still gives every card `min`
 *    2. never more than four  see above
 *    3. never more than there are cards to put in them
 *    4. never a last row of one
 *
 *  Step four steps down one column at a time and stops at two, because a single
 *  column of nine cards is a worse answer than a ragged row. If no width from
 *  the fit down to two avoids the lone card, the widest is kept: that is what
 *  the page does today, so the rule can never make a layout worse than the one
 *  it replaces.
 *
 *  A last row of two, or three, is left alone. A ragged edge is what a grid of
 *  an arbitrary number of things looks like; one card by itself is what a
 *  mistake looks like. Only the second is worth moving the whole layout for.
 *
 *  `available` is the space the grid has, in CSS pixels. Everything is in the
 *  same units and nothing here reads the document, so it is checkable without a
 *  browser, which is the point of it living beside the other card rules. */
export function columnCount({ available, count, min = 340, gap = 12 }) {
  if (!Number.isFinite(count) || count < 1) return 1;
  if (!Number.isFinite(available) || available <= 0) return 1;

  // c columns of `min` with a gap between each pair: c*min + (c-1)*gap.
  const fits = Math.floor((available + gap) / (min + gap));
  const widest = Math.max(1, Math.min(fits, MAX_CARD_COLUMNS, Math.round(count)));

  for (let columns = widest; columns >= 2; columns--) {
    if (count % columns !== 1) return columns;
  }
  return widest;
}

// --------------------------------------------------------------- the rating

/** A score out of five as a fraction of the star row, or null.
 *
 *  A fraction rather than a count of whole stars: 4.46 is not four stars and it
 *  is not five, and rounding it to either is editing the source's figure. The
 *  page draws the row filled 89.2% of the way across and prints the number
 *  beside it.
 *
 *  A count is optional and separate. A score with no count is still a score;
 *  a count with no score is nothing to draw.
 *
 *  A COUNT OF ZERO IS NOT A RATING. It is the absence of one, and it must not
 *  reach a card: five empty stars and "0 (0)" beside them is this page saying
 *  other walkers scored the route and scored it nothing, when nobody scored it
 *  at all. Wikiloc sends every unrated trail that way -- on `mazunte`, eight
 *  cards of nine -- so the card shows no star row, the same way it shows no
 *  duration for a source that publishes none.
 *
 *  Refused here as well as at the source that sends it, because this is the
 *  function that decides whether stars are drawn, and a rule about what may be
 *  drawn belongs where the drawing is decided. */
export function starPortion(rating) {
  const score = rating?.score;
  if (typeof score !== 'number' || !Number.isFinite(score)) return null;
  if (score < 0 || score > 5) return null;

  const count = rating?.count;
  const counted =
    typeof count === 'number' && Number.isFinite(count) && count >= 0 ? Math.round(count) : null;
  if (counted === 0) return null;
  return { score, count: counted, fraction: score / 5 };
}

// ----------------------------------------------------------------- the date

/** The month a route last changed, or null.
 *
 *  A month and a year, never a day: the source's timestamp is precise to the
 *  millisecond and none of that precision means anything to somebody deciding
 *  whether a track is stale. The parts come back as numbers so the page can
 *  name the month in the reader's language.
 *
 *  A date in the future is refused. It is either a clock that is wrong or a
 *  field that means something other than what we think, and "Updated March
 *  2031" is the kind of thing a reader trusts a page less for. */
export function updatedMonth(iso, now = Date.now()) {
  if (typeof iso !== 'string' || !iso.trim()) return null;
  const when = new Date(iso);
  const stamp = when.getTime();
  if (!Number.isFinite(stamp) || stamp > now) return null;
  return { year: when.getUTCFullYear(), month: when.getUTCMonth() + 1 };
}

// ------------------------------------------------------------- the activity

/** The activity word a card shows, or null when it would be noise.
 *
 *  On a source whose filter we can trust, every row is the activity that was
 *  just chosen, so printing it on all nine cards repeats the visitor's own word
 *  back at them nine times. It is shown only when it differs.
 *
 *  `always` is for a source that does not filter upstream. There the word is
 *  the only thing on the card telling a walker that this one is a via ferrata,
 *  and the page has promised in writing that every card states its own
 *  activity, so it is shown even when it matches. */
export function activityWord(row, asked, { always = false } = {}) {
  const sport = row?.sport;
  if (typeof sport !== 'string' || !sport) return null;
  if (always) return sport;
  return sport === asked ? null : sport;
}

/** The source's own word for an activity, made readable. The last resort, and
 *  it must never fail: a raw slug on a card is a leaked internal name.
 *
 *  A SLUG IS NOT A WORD. Komoot publishes six activities and its rows return
 *  more than six: `mtb_easy` arrives on a live search for `delta del ebro`, and
 *  it reached a card underscore and all, in both languages. There is no list to
 *  add it to that stays complete, because Komoot does not publish the list its
 *  rows draw from.
 *
 *  So the separators are opened into spaces and the first letter is raised, and
 *  that is the whole of it. Nothing is translated, nothing is expanded, nothing
 *  is reordered: those would be this page guessing at what another site's word
 *  means, which is the one thing it must not do with a vocabulary it does not
 *  own. `mtb_easy` becomes `Mtb easy` -- plainly the source's own word, plainly
 *  not ours, and readable. The sentence under the activity picker says so
 *  whenever such a word is on screen.
 *
 *  Callers reach this only after looking for the word in this page's own
 *  vocabulary and in the source's published labels, both of which say more. */
export function sourceOwnWord(slug) {
  if (typeof slug !== 'string') return '';
  const words = slug.replace(/[_-]+/g, ' ').trim();
  if (!words) return '';
  return words[0].toUpperCase() + words.slice(1);
}

/** The three places a word for a slug can come from, in the order they are
 *  worth showing, ending somewhere that is never a machine name.
 *
 *  This exists because the rule was written twice and only one copy was right.
 *  The activity word walked all three steps; the grade word walked one and then
 *  returned the raw slug, so an unknown grade would have reached a reader as
 *  `very_difficult`. No source has sent one yet, which is exactly why it went
 *  unnoticed: a rule with no live case is a rule nobody is checking. One
 *  function now, and a test that no slug survives it.
 *
 *  `ours` and `published` each return a word or nothing. `ours` is this page's
 *  own vocabulary, a translation somebody wrote and checked. `published` is the
 *  source's own spelling of its own slug, which invents nothing. Neither is
 *  required: a grade has no published labels to look in, so it passes only the
 *  first and falls straight through to the last.
 *
 *  The returned `ours` flag is false for both of the last two steps, because in
 *  both the word on screen belongs to the site and not to us, and the sentence
 *  under the activity picker says so out loud. */
export function wording(slug, { ours = null, published = null } = {}) {
  const mine = ours ? ours(slug) : null;
  if (mine) return { text: mine, ours: true };

  const theirs = published ? published(slug) : null;
  if (theirs) return { text: theirs, ours: false };

  return { text: sourceOwnWord(slug), ours: false };
}
