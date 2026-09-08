// A row, worked out into the parts a card is made of.
//
// A card is denser than a row, and density is where a claim quietly turns into
// a reading. So the arithmetic that decides what a card is allowed to show
// lives here, away from the markup, and can be checked without a browser: a
// figure the source never published is absent rather than zero, a picture is
// shown only when it is a picture OF the route, and a rating that is not a
// number does not become a row of stars.
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

// -------------------------------------------------------------- the picture

// The size asked of the source's image server. 16:9, and twice the width a
// card is given at the widest, so it is still sharp on a phone screen that
// packs two device pixels into one.
export const THUMBNAIL_WIDTH = 480;
export const THUMBNAIL_HEIGHT = 270;

/** The picture a card may show, or null when there is nothing worth showing.
 *
 *  THE DECISION, and it is not symmetric between the two sources.
 *
 *  Komoot hands over a drawing of the route on a map. That is about the route:
 *  the shape says loop, or out and back, or a line from one valley to another,
 *  and that is the first thing a walker wants to know and the one thing no
 *  figure on the card can say. It is shown.
 *
 *  Wikiloc hands over a photograph somebody took on the path. It is a real
 *  picture of a real place and it says nothing whatsoever about the route: the
 *  same rock face fronts a two hour stroll and a fourteen hour traverse. Shown
 *  at card size it would do one job only, which is to make the list pretty
 *  enough to scroll. This product converts a link and doubts a number; it is
 *  not a shelf to browse, and a picture that invites browsing is working
 *  against the page it sits on. It is not shown, on search or on nearby.
 *
 *  So the test is `kind`, never the source's name: the day Wikiloc starts
 *  drawing routes, or Komoot starts sending photographs, this rule already
 *  says the right thing.
 *
 *  The cost of showing one is real and it is the visitor's, not ours: their
 *  browser fetches it straight from the source's own image server, which puts
 *  their address and roughly where they are looking in front of a third party
 *  our server never talks to. That is why the footer names Komoot's image
 *  server beside OpenStreetMap, and why dropping Wikiloc's photographs also
 *  drops a whole host from the set of people watching. */
export function cardImage(row) {
  const thumbnail = row?.thumbnail ?? null;
  if (!thumbnail || thumbnail.kind !== 'route-map') return null;
  const src = thumbnailSrc(thumbnail.url, THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT);
  return src === null ? null : { src, width: THUMBNAIL_WIDTH, height: THUMBNAIL_HEIGHT };
}

/** A thumbnail URL with a size in it, or null when it cannot be made into one.
 *
 *  Komoot writes its image links in two shapes and only one of them is ready to
 *  put in an `img`. Nearby sends the template
 *  `...?width={width}&height={height}&crop={crop}`, and those braces are
 *  literal: asked for as they arrive, the server answers 400 and the card shows
 *  a broken picture. Search sends the same path with no query at all, and that
 *  one answers with a 144 by 144 square, which is not the shape of a card.
 *  Both checked against the live server on 2026-09-02.
 *
 *  So the braces are filled in when they are there, and a size is added when
 *  there is no query to fill in. A URL that already carries a query of its own
 *  and no placeholders is left exactly as the source wrote it: at that point we
 *  would be guessing at somebody else's parameters. */
export function thumbnailSrc(url, width, height) {
  if (typeof url !== 'string' || !url.startsWith('https://')) return null;

  if (url.includes('{width}')) {
    return url
      .replaceAll('{width}', String(width))
      .replaceAll('{height}', String(height))
      .replaceAll('{crop}', 'true');
  }
  if (!url.includes('?')) return `${url}?width=${width}&height=${height}&crop=true`;
  return url;
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
 *  a count with no score is nothing to draw. */
export function starPortion(rating) {
  const score = rating?.score;
  if (typeof score !== 'number' || !Number.isFinite(score)) return null;
  if (score < 0 || score > 5) return null;

  const count = rating?.count;
  const counted =
    typeof count === 'number' && Number.isFinite(count) && count >= 0 ? Math.round(count) : null;
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
