# Route to GPX

Paste a hiking-route link, get a GPX file **and the measurements behind it**.

Any site will hand you a GPX. This one tells you how good the track actually
is, and above all where the recording has holes, because a hole is the one
thing that changes what you do on the mountain: your watch will draw a straight
line across it and you will be navigating that stretch on your own.

Every figure on screen is measured in your browser, from the file you are about
to download. The figures the source site publishes are shown next to ours, so
you can see where they disagree.

## What it reads

| Source | How | Works from a plain server |
| --- | --- | --- |
| **Komoot** | the public read-only tour endpoint the site's own pages call | yes |
| **Wikiloc** | the track embedded in the trail page, base64 over TWKB | needs a browser TLS handshake, see below |
| **Your own `.gpx`** | dropped on the page, read in the browser | the file never leaves the browser |

Two more ways to arrive at a link, rather than pasting one:

| Surface | What it does | Cost |
| --- | --- | --- |
| **Search** | words, and a place | 1 call for Komoot, 1 or 2 for Wikiloc |
| **Nearby** | routes around a point, by radius and activity | 1 call for Komoot, up to 4 for Wikiloc |

And one thing to do with a route once you have it:

| Surface | What it does |
| --- | --- |
| **Re-arrange** | move a closed ring's start, or reverse the direction |

Moving the start of a ring that does not quite close puts the unclosed part
into the middle of the file, as a straight line your watch will cut across. So
the re-arranger measures that seam and says how long it is and where, and the
gap tile turns to the warning skin for it like any other gap. A ring is a ring
when its ends are within 2% of the route's length, floored at 30 m and capped
at 1 km, because half a kilometre is a quarter of a 2 km stroll and a third of
a percent of a 140 km ride.

Changing the order of a recording makes its times wrong, whichever change you
make, so a re-arranged file carries no times and none are invented to replace
them. The page says how many it is about to drop before you press anything.

Both ask **both sites by default**, and interleave the answers one from each in
turn. That is a fair merge and not a ranking: the moment this code starts
scoring rows it has become a search engine, which it has no business being.

Neither surface is a discovery product. A result row is a name, what the source
claims about it, and a link. Picking one sends that link to the same converter,
which is where the real numbers come from.

**The filter is ours, on both sites.** Wikiloc will not filter for a caller
without an account and Komoot accepts a difficulty parameter and ignores it, so
the filtering happens here, over rows already fetched. That has a price worth
knowing: one window of 25 rows in a box at Montserrat is 91% hiking and 1% via
ferrata, so filling six via ferrata rows would take about twenty-four calls.
That is a crawl. The scan stops after four windows instead and the answer says
how far it looked, because one route out of a hundred examined is a short page
and also a true thing about that valley.

**A card draws the route, and the drawing is ours.** Komoot's thumbnail URL is
a request to draw a picture, and the shape to draw is encoded into its path, so
the geometry arrives with every row already. Reading it means the card draws
the line in this project's own colours over the same tiles the report uses,
instead of loading a PNG from a third party with somebody else's blue line in
the pixels. A hundred points is enough to draw a card and nowhere near enough
to measure with; measuring still means converting the file.

Four honest notes.

**Wikiloc needs `curl_cffi`.** Wikiloc answers an ordinary HTTP client with 403
and a browser with 200, and the difference is the TLS handshake, not the
headers. `curl_cffi` reproduces a browser handshake. That is why the link
service is a small Python process rather than an edge function: a Cloudflare
Worker cannot choose its TLS fingerprint.

**The map background is a third party.** The charts draw over OpenStreetMap
tiles, which the visitor's browser fetches straight from
`tile.openstreetmap.org`. So even a dropped file, which is otherwise read
entirely in the browser, causes requests that show OpenStreetMap an IP address
and roughly where the route is. The page says so in its footer, credits
OpenStreetMap on the chart as the licence requires, and carries a switch that
turns the map off and is remembered. With it off, no tile is requested at all.

If you deploy this, the [OSM tile usage
policy](https://operations.osmfoundation.org/policies/tiles/) is yours to
respect, and it is not generous: it covers ordinary browsing, not heavy or
automated use. One report is one fixed view, a handful of tiles, which is well
inside it. Note also that OpenStreetMap does not refuse a blocked client with an
error. It answers 200 with a white tile and an `x-blocked` header, so the page
reads that header and stops asking for the rest of the session.

**Search sends what you typed to a second third party.** A Wikiloc search has
to turn a place name into coordinates, and Wikiloc's own geocoder is one of the
two endpoints its `robots.txt` names, so we do not call it. We use
[Photon](https://photon.komoot.io) instead, which is open source and needs no
key. That means the words you type reach `photon.komoot.io`. Komoot search does
its own geocoding, so it does not.

Photon also answers the wrong place surprisingly often: `montserrat` returns a
village in the Valencian Community before the mountain in Catalonia, 300 km
away. Merged with Komoot, which gets the mountain right, that would put routes
from two different places in one list with nothing saying so.

So the guess is never hidden. The answer names the place it actually used and
returns the alternatives beside it, and a caller who already knows which one
was meant passes a point, in which case nothing is guessed and the geocoder is
not called at all.

**Nothing here defeats a bot check or a login.** A private route stays private,
and the page says so instead of pretending the track went missing. If a site
puts a CAPTCHA in front of a page, this tool tells you to export the GPX there
and drop the file in, which works offline and needs nobody's permission.

**Your browser talks to Google on every page load.** The two typefaces come
from Google Fonts, so Google sees an IP address before anything is pressed. The
footer says so. Cards fetch nothing at all: a card's route drawing is drawn
here, from geometry that arrived with the row.

**Komoot cannot be pointed at a place on a text search.** Measured on the live
API, not assumed: the same query with a point 600 km away returns a
byte-identical row, and `bbox`, `map_bounds`, `max_distance` and `radius`
change nothing either. The `lat`/`lng` pair nudges the ranking; it does not
choose where to look. It is not dead, though: with a query naming nowhere
(`trail`) the same point does move the results. It is only a search whose words
name a place that cannot be aimed somewhere else.

That matters because Wikiloc obeys a point exactly. So on a merged search where
you picked a place, one site went where you pointed and the other looked up
your words. The page says which did which, per source, rather than claiming
over the whole list that nothing was guessed.

## What it measures

| Measure | Note |
| --- | --- |
| Distance | haversine over consecutive points |
| Ascent | profile resampled along the track, median filtered, 1 m step threshold |
| Raw ascent | no filter and no threshold, which is how most portals publish it |
| Elevation range | lowest and highest point |
| Points, points with elevation | how much of the track carries height at all |
| Mean spacing | distance between consecutive points |
| **Largest gap, and the distance it happens at** | the headline number |

Two details that are easy to get wrong, and were:

- **Do not accumulate ascent point to point on a dense track.** A recording
  with points two metres apart puts every single elevation change below any
  sane noise threshold, and a threshold-based accumulator then throws the whole
  climb away. Sampling the profile at a fixed along-track step fixes it.
- **Do not resample finer than the track's own spacing.** Interpolating extra
  points splits each real climb into changes under the threshold and loses it
  the same way. A track recorded every 19.5 m, resampled to 5 m, reported 120 m
  of ascent where the real figure was 624 m. The step is
  `max(10 m, mean spacing)`.

Gap threshold defaults to 100 m. Above it the report escalates: the tile turns
to the warning skin, both charts draw the gap as a straight dashed chord in the
warning colour with a mark at each end, and a line underneath says what it
means for the walk.

## Running it

```bash
python3 -m venv .venv && .venv/bin/pip install -r api/requirements.txt
.venv/bin/uvicorn api.app:app --reload --port 8000
```

That serves both halves on <http://localhost:8000>: the API under `/api` and
the web page at the root.

To run the two apart, set `WEB_ROOT` to a directory that does not exist (the
static mount is skipped), host `web/` anywhere, and tell the page where the API
lives:

```html
<script>window.ROUTE_TO_GPX_API = 'https://api.example.org';</script>
```

Docker:

```bash
docker build -t route-to-gpx api/ && docker run -p 8000:8000 route-to-gpx
```

## Tests

```bash
.venv/bin/python -m pytest api/tests -q
```

```bash
node --test 'web/test/*.test.js'
```

The Python tests cover the TWKB reader against an encoder written from the
specification, the URL parsing, and Wikiloc's statistics block in both the
metric and the imperial rendering of the same route. The Node tests cover the
arithmetic, including the two ascent mistakes described above. Neither suite
touches the network.

## Layout

```
web/                the page. No framework, no build step.
  index.html
  assets/measure.js parses GPX and measures it. All the arithmetic.
  assets/charts.js  route trace and elevation profile.
  assets/app.js     state machine and rendering.
  assets/i18n.js    English and Spanish, both complete.
  assets/icons.js   the drawn icon set.
  test/             node --test
api/                the link-fetching service. Fetches, extracts, hands back GPX.
  app.py            FastAPI. Does not measure anything.
  http.py           the only place that talks to the outside world.
  sources/          one adapter per site.
  core/twkb.py      Tiny Well-Known Binary reader.
  core/gpx.py       GPX 1.1 writer.
  tests/
```

The service deliberately does not measure. Measuring happens in the browser,
from the file itself, so what you read on screen can always be checked against
what you downloaded.

## Provenance

Every file written here says where it came from, in two places you can find
later: `<metadata><link>` and the track name. A GPX with no provenance is a
file you cannot check.

## Licence

MIT. See [LICENSE](LICENSE).

Tracks belong to the people who recorded them, and to the sites that host them.
This tool reads a page you could have opened yourself and writes the result to
your disk. It does not republish anything, and it keeps nothing.
