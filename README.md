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
| **Search** | a text query against Komoot, or a place name plus Wikiloc | 1 upstream call for Komoot, 2 for Wikiloc |
| **Nearby** | routes around a point, by radius and activity | 1 upstream call |

Neither is a discovery product. A result row is a name, what the source claims
about it, and a link. Picking one sends that link to the same converter, which
is where the real numbers come from.

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
village in Valencia before the mountain. That is why the response carries a
`places` list rather than silently taking the first hit.

**Nothing here defeats a bot check or a login.** A private route stays private,
and the page says so instead of pretending the track went missing. If a site
puts a CAPTCHA in front of a page, this tool tells you to export the GPX there
and drop the file in, which works offline and needs nobody's permission.

The same rule decides what Search and Nearby can offer. Wikiloc will not filter
by activity, distance, difficulty or date for a caller who is not logged in: it
answers those with an empty page rather than an error. So the Wikiloc activity
picker is not the filter Komoot's is, and the README would rather say that than
have the page pretend otherwise.

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
