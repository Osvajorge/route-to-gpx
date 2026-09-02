"""Two ways of arriving at a Wikiloc URL.

This service converts one URL into a GPX. Search and Nearby do not change that.
They hand back URLs, each carrying the figures Wikiloc publishes beside it, and
the URL then goes through `wikiloc.py` unchanged. A row is a link, never a
track: nothing here returns coordinates, a GPX, or a measurement of any kind.

It is the Wikiloc twin of `komoot_discovery.py` and answers in the same shape,
through the same `Row`, `Place` and `Listing` in `discovery.py`. What differs is
everything the site itself decides: Wikiloc asks for a bounding box rather than
a centre and a radius, it publishes miles and feet, and it will not filter by
activity for a caller who is not signed in.

ROBOTS. `https://www.wikiloc.com/robots.txt` opens its `User-agent: *` group
with `Allow: /` and then names its exclusions one at a time. Two of them decide
what this module may do:

    Disallow: /wikiloc/map.do
    Disallow: /wikiloc/geocode.do

`find.do` is not on that list, and it is the only Wikiloc address read here.
`map.do` and `geocode.do` are on it, and this service calls neither, ever, not
even to try something out. Wikiloc's own text search geocodes through
`geocode.do`, so the place search below goes somewhere else entirely.

The same file also names crawlers one at a time -- `AnthropicBot`, `GPTBot`,
`CCBot`, `PerplexityBot`, `Google-Extended`, `Diffbot` -- with `Disallow: /`.
Those rules are about walking the site. This module does not walk it: one
visitor action makes exactly one call to `find.do`, no page is fetched ahead of
being asked for, no id is ever incremented, and nothing outlives the request.
The page cap here and the fan-out ceiling in `api/http.py` are that promise
written as code. Which group applies to a visitor-driven fetch is a judgement,
and it is written down here so it stays a decision somebody made rather than
something nobody looked at.

THE PLACE SEARCH. Because `geocode.do` is closed to us, Search turns words into
a place through Photon, `https://photon.komoot.io/api/`, which is komoot's open
geocoder over OpenStreetMap data. Two things come with it, and both are
obligations rather than notes.

Its usage policy, from the Terms of Use at `https://photon.komoot.io/` and
repeated in the komoot/photon README: the demo server may be used for a
project, callers are asked to be fair and to stay within a reasonable limit,
"extensive usage will be throttled" or banned, availability is not guaranteed,
and anyone with real volume is asked to run their own instance. This service
answers one visitor action with one geocode, and `api/http.py` gives Photon its
own small budget rather than letting it share Wikiloc's. Photon's own
robots.txt is `Disallow: /`, which is the same shape as the Komoot `/api` rule
this service already reasons about: a directive about crawling, answered by the
rule that nothing is fetched unless an inbound request is paying for it.

Its attribution, required by the ODbL and the OSMF attribution guidelines: a
page showing these results must credit OpenStreetMap and make clear the data is
under the Open Database License. `ATTRIBUTION` below is the wording, and it
travels in the response so a page cannot render places without it.

THE ACTIVITY FILTER IS LOCAL, AND HAS TO BE. `find.do` does read an activity
parameter. It is `a`, and its value is the same numeric picto id that arrives on
a row, comma-joined for several: `a=1` is Hiking, `a=1,60` is Hiking and Via
Ferrata. That is not a guess -- Wikiloc's own map bundle builds the request with
`n.act = null, n.a = e.act`, which is why every `act=<n>` probe came back empty.

The parameter is right and it still cannot be used. Measured against the live
endpoint on 2026-09-02, all on one box near Montserrat
(sw 41.55,1.75 ne 41.68,1.92):

    no filter          count 224326, 24 rows
    sort=last          count 224326, 24 rows   honoured
    from=24&to=48      count 224326, 24 rows   honoured, and no row repeated
    a=1                count 0,       0 rows
    a=60               count 0,       0 rows
    a=1,60             count 0,       0 rows
    act=1              count 0,       0 rows
    lfr=10&lto=20      count 0,       0 rows   (distance)
    ufr=100&uto=2000   count 0,       0 rows   (elevation)

Paging, sorting, units and free text are honoured; every filter answers zero.
Wikiloc's map code refuses to issue a filtered search at all for a caller who is
not signed in, and the server agrees with it silently: `restricted` is false and
`filterType` is `"null"` on both the working call and the zeroed one. So a wrong
value is not the explanation, and there is no value that would work.

The activity is therefore checked against Wikiloc's vocabulary here, sent to
nobody, and applied to the page of rows Wikiloc did return. Two consequences,
and the response states both rather than hiding them:

  * A filtered page can come back shorter than the size asked for. `setAside`
    says how many rows were removed and why, so a page can say "4 of 24" instead
    of implying the area holds nothing else.
  * A rare activity fills no page at all. In that box hiking is 92% of the rows
    and Via Ferrata about 0.25%, so six via-ferratas would need roughly 600 rows
    and two dozen calls. This service does not make two dozen calls for one
    click, so the honest answer is a short page with the numbers beside it.

For the same reason `totalKnown` is null here. Wikiloc does publish a `count`,
but it counts the whole box before either filter, and printing "224,326" beside
four rows would answer a question nobody asked.
"""

import html
import re
from math import asin, cos, degrees, radians, sin, sqrt
from typing import Any, Dict, Iterable, List, Optional, Tuple
from urllib.parse import urlencode, urlparse

from . import Published, SourceError, wikiloc
from .discovery import Listing, Place, Row, place_name, thumbnail
from ..http import ALLOWED_HOST, fetch_json

SOURCE_ID = "wikiloc"
SOURCE_LABEL = "Wikiloc"

# The one Wikiloc address this module reads. `event=map` is what the map view
# sends; without it the endpoint answers a different shape.
FIND_URL = "https://www.wikiloc.com/wikiloc/find.do"
# Rows carry a site-relative `prettyURL`, and this is what makes it a link.
TRAIL_ROOT = "https://www.wikiloc.com"
# The place search. Never `/wikiloc/geocode.do`, which robots.txt disallows.
GEOCODE_URL = "https://photon.komoot.io/api/"

# Required wherever those places are shown. It travels in the response so a page
# cannot render them without it. The ODbL words should link to
# https://www.openstreetmap.org/copyright.
ATTRIBUTION = "Place search by Photon, data © OpenStreetMap contributors, ODbL"

# Wikiloc's own vocabulary, as (picto id, slug, label, group).
#
# The picto id is Wikiloc's; it arrives on every row as `picto` and it is what
# the `a` parameter would take if that parameter worked. The slug is ours, and
# it is what travels over this service's API in both directions: a request names
# an activity by slug, and a row's `sport` comes back as one. A number would be
# a Wikiloc detail leaking into our contract, and `sport: 60` tells a reader
# nothing.
#
# Written down rather than fetched, for the reasons `komoot_discovery` gives
# about its own list: fetching it at import would be work no visitor asked for,
# would stop this service starting whenever Wikiloc is down, and would put the
# network into the test suite.
#
# Read from Wikiloc's activity filter on 2026-09-02, and confirmed against the
# `picto`/`pictoText` pairs on live rows. The ten a walker reaches for come
# first, because a dropdown of eighty is otherwise a wall; the rest follow in
# Wikiloc's own groups. Two entries Wikiloc lists twice appear once here, under
# the group a visitor would look in first: Alpine Climbing under On Foot, and
# Handbike under Bicycle.
ACTIVITIES: Tuple[Tuple[int, str, str, str], ...] = (
    (1, "hiking", "Hiking", "On Foot"),
    (48, "trail-running", "Trail Running", "On Foot"),
    (43, "walking", "Walking", "On Foot"),
    (21, "running", "Running", "On Foot"),
    (14, "alpine-climbing", "Alpine Climbing", "On Foot"),
    (17, "snowshoe", "Snowshoe", "Snow"),
    (60, "via-ferrata", "Via Ferrata", "Climb"),
    (40, "backcountry-ski", "Backcountry Ski", "Snow"),
    (62, "orienteering", "Orienteering", "On Foot"),
    (57, "nordic-walking", "Nordic Walking", "On Foot"),
    (140, "plogging", "Plogging", "On Foot"),
    (65, "barefoot", "Barefoot", "On Foot"),
    (2, "mountain-bike", "Mountain Bike", "Bicycle"),
    (29, "road-bike", "Road Bike", "Bicycle"),
    (47, "bicycle-touring", "Bicycle Touring", "Bicycle"),
    (144, "bikepacking", "Bikepacking", "Bicycle"),
    (118, "ebike", "eBike", "Bicycle"),
    (135, "gravel-bike", "Gravel Bike", "Bicycle"),
    (117, "downhill-mtb", "Downhill MTB", "Bicycle"),
    (69, "mountain-unicycle", "Mountain Unicycle", "Bicycle"),
    (113, "trailer-bike", "Trailer Bike", "Bicycle"),
    (115, "handbike", "Handbike", "Bicycle"),
    (54, "kickbike", "Kickbike", "Bicycle"),
    (46, "canyoneering", "Canyoneering", "Climb"),
    (24, "rock-climbing", "Rock Climbing", "Climb"),
    (41, "spelunking", "Spelunking", "Climb"),
    (28, "ice-climbing", "Ice Climbing", "Climb"),
    (4, "alpine-ski", "Alpine Ski", "Snow"),
    (13, "cross-country-ski", "Cross Country Ski", "Snow"),
    (18, "snowboarding", "Snowboarding", "Snow"),
    (12, "snowmobile", "Snowmobile", "Snow"),
    (134, "splitboard", "Splitboard", "Snow"),
    (109, "freeride-ski", "Freeride Ski", "Snow"),
    (52, "kite-ski", "Kite Ski", "Snow"),
    (53, "sledding", "Sledding", "Snow"),
    (11, "kayak-canoe", "Kayak/Canoe", "Water"),
    (111, "motorboat", "Motorboat", "Water"),
    (61, "swimming", "Swimming", "Water"),
    (9, "sail-boat", "Sail Boat", "Water"),
    (64, "stand-up-paddle", "Stand up Paddle", "Water"),
    (49, "rowing", "Rowing", "Water"),
    (114, "jet-ski", "Jet Ski", "Water"),
    (51, "kitesurfing", "Kitesurfing", "Water"),
    (19, "diving", "Diving", "Water"),
    (106, "airboat", "Airboat", "Water"),
    (116, "rafting", "Rafting", "Water"),
    (27, "horseback-riding", "Horseback Riding", "With Animals"),
    (66, "canicross", "Canicross", "With Animals"),
    (112, "birdwatching", "Birdwatching", "With Animals"),
    (137, "wildlife-watching", "Wildlife Watching", "With Animals"),
    (39, "dog-sledding", "Dog Sledding", "With Animals"),
    (108, "camel", "Camel", "With Animals"),
    (37, "skating", "Skating", "On Wheels"),
    (55, "inline-skate", "Inline Skate", "On Wheels"),
    (107, "segway", "Segway", "On Wheels"),
    (68, "longboard-skateboard", "Longboard/Skateboard", "On Wheels"),
    (136, "scooter", "Scooter", "On Wheels"),
    (67, "roller-ski", "Roller Ski", "On Wheels"),
    (133, "baby-stroller", "Baby Stroller", "On Wheels"),
    (44, "reduced-mobility", "Reduced Mobility", "Accessible"),
    (56, "blind-people", "Blind People", "Accessible"),
    (121, "joelette", "Joelette", "Accessible"),
    (50, "car", "Car", "Motor"),
    (3, "off-road", "Off Road", "Motor"),
    (8, "road-motorbike", "Road Motorbike", "Motor"),
    (38, "dual-sport-motorcycle", "Dual-sport Motorcycle", "Motor"),
    (6, "quad", "Quad", "Motor"),
    (59, "enduro-motorcycle", "Enduro Motorcycle", "Motor"),
    (105, "motorhome", "Motorhome", "Motor"),
    (58, "motorcycle-trials", "Motorcycle Trials", "Motor"),
    (26, "plane", "Plane", "Air"),
    (20, "paragliding", "Paragliding", "Air"),
    (16, "hot-air-balloon", "Hot Air Balloon", "Air"),
    (15, "hang-gliding", "Hang Gliding", "Air"),
    (110, "drone", "Drone", "Air"),
    (120, "base-jumping", "BASE Jumping", "Air"),
    (138, "flora-observation", "Flora Observation", "Other"),
    (45, "train", "Train", "Other"),
    (63, "multisport", "Multisport", "Other"),
    (70, "golf", "Golf", "Other"),
)

# "Everything", and the default. Komoot's nearby demands a sport because
# upstream refuses without one; nothing here refuses, and since the filtering is
# ours, `all` is the one setting that removes nothing and hides nothing. So it
# is what a visitor starts with, and narrowing is their decision.
ANY_ACTIVITY = "all"
DEFAULT_ACTIVITY = ANY_ACTIVITY

ACTIVITY_SLUGS = tuple(slug for _, slug, _, _ in ACTIVITIES)
PICTO_BY_SLUG = {slug: picto for picto, slug, _, _ in ACTIVITIES}
SLUG_BY_PICTO = {picto: slug for picto, slug, _, _ in ACTIVITIES}
# Named in the error when an activity is not one of ours. Eighty slugs in one
# sentence is not something a person can act on, so the error names the ten a
# walker reaches for and says where the other seventy are.
ACTIVITIES_NAMED_IN_ERRORS = 10

# The same caps as the Komoot side, and for the same reasons, except where
# Wikiloc measured differently.
LIMIT_DEFAULT = 10
# `to` is capped upstream: asking for 100 rows returns 25. Measured 2026-09-02.
LIMIT_MAX = 25
PAGE_MAX = 4

# Six rows a page, the size the owner set for Nearby. On the Komoot side that
# number is also an upstream defect -- above six it silently repeats page 0.
# Wikiloc has no such defect: pages of 6 and of 24 were both checked on
# 2026-09-02 and page 1 repeated nothing from page 0. Six here is a product
# decision, not a workaround, and the tests check the repeat anyway.
NEARBY_LIMIT_MAX = 6

# How many upstream windows one filtered question may read. Four windows of 25
# is a hundred rows, which fills a page of the common activity many times over
# and returns two or three of a rare one. Filling six via ferrata rows would
# take about twenty-four windows, measured on a real box in the Alps, and that
# is a crawl rather than a question. So the scan stops and the answer says how
# far it looked.
FILTER_WINDOWS = 4
SCAN_WINDOW = LIMIT_MAX

RADIUS_DEFAULT = 25000
RADIUS_MIN = 1000
RADIUS_MAX = 50000

PLACES_MAX = 5
QUERY_MAX_CHARS = 120
QUERY_MIN_CHARS = 2
LIST_TIMEOUT_SECONDS = 8

# WHETHER A POINT CAN AIM A TEXT SEARCH AT A PLACE. Here it is the only thing
# that can: a Wikiloc search IS a bounding box, so `search(near=...)` turns the
# point into that box and the rows can be from nowhere else. Nothing was
# measured to learn this and nothing needs to be -- there is no text of the
# visitor's anywhere in the request, only the box.
#
# The opposite number is `komoot_discovery.POINT_APPLIED`, which is False and
# carries the measurements. `merged.py` reads both, so a page can say which of
# the two sites in one list looked where the visitor pointed.
POINT_APPLIED = True

# Mean Earth radius. A sphere is close enough for a search box: the flattening
# it ignores moves a 25 km edge by about a hundred metres, and the box is only a
# coarse pre-filter for a circle that is then checked exactly.
EARTH_RADIUS_M = 6371008.8

# Wikiloc writes a row's unit as a short code, and the codes are not the words
# the trail page uses: a climb comes back as "f", not "ft". `wikiloc.py` already
# reads "7,267 ft" correctly in whichever way a locale groups its digits, so the
# code is translated into that spelling and the reading is done once, there.
# Anonymous callers are served the English locale, which is miles and feet;
# `uom` and `uomslope` are read rather than assumed all the same, because the
# day they change, assuming would multiply every distance by 1.6 in silence.
UNIT_SPELLING = {"km": "km", "mi": "mi", "m": "m", "f": "ft", "ft": "ft"}


def search(
    query: Optional[str] = None,
    activity: Optional[str] = None,
    limit: Optional[Any] = None,
    page: Optional[Any] = None,
    windows: int = FILTER_WINDOWS,
    near: Optional[Tuple[Any, Any]] = None,
) -> Listing:
    """Words in, links out.

    Two upstream calls when the place has to be looked up, and one when it does
    not, which is what `near` is for.

    THE PLACE IS THE WHOLE PROBLEM WITH THIS SURFACE. Wikiloc searches a box,
    so words have to become a box, and the geocoder is asked to guess which
    place the words meant. It guesses badly: `montserrat` returns a village in
    Valencia before the mountain in Catalonia, which is 300 km away, so a
    merged answer would put routes from two different places in one list with
    nothing saying so.

    So the guess is never hidden. The place actually used is echoed, the
    alternatives come back in `places`, and a caller that already knows which
    one the visitor meant passes `near` and no guessing happens at all.
    """
    text = _query_text(query)
    chosen = _activity(activity)
    size = _clamp(limit, 1, LIMIT_MAX, LIMIT_DEFAULT)
    number = _clamp(page, 0, PAGE_MAX, 0)
    echo = {"query": text, "sport": chosen, "limit": size, "page": number}

    chosen_point = _point(near)
    if chosen_point is not None:
        # Somebody already said which place they meant, so nothing is guessed
        # and the geocoder is not asked. One call instead of two.
        here = Place(name=text, lat=chosen_point[0], lng=chosen_point[1])
        return _look(here, None, text, chosen, size, number, windows, places=[])

    found = _geocode(text)
    if not found:
        # No place, so there is no box and nothing to ask Wikiloc about. That is
        # a question answered, not a failure: the second call is not made.
        return Listing(
            source_id=SOURCE_ID,
            source_label=SOURCE_LABEL,
            echo={**echo, "box": None},
            rows=[],
            places=[],
            attribution=ATTRIBUTION,
            has_more=False,
            total_known=None,
            dropped=0,
            set_aside={"otherActivity": 0, "outsideRadius": 0},
        )

    # The first answer, because there is nothing better to go on, but never
    # silently: the caller is told which one was used and what the others were.
    place, extent = found[0]
    return _look(
        place,
        extent,
        text,
        chosen,
        size,
        number,
        windows,
        places=[each for each, _ in found][:PLACES_MAX],
    )


def _look(
    place: Place,
    extent: Optional[Tuple[float, float, float, float]],
    text: str,
    chosen: str,
    size: int,
    number: int,
    windows: int,
    places: List[Place],
) -> Listing:
    """One place, read."""
    echo = {"query": text, "sport": chosen, "limit": size, "page": number}
    southwest, northeast = _place_box(place, extent)
    payload = _answer(_find_url(southwest, northeast, number, size), SOURCE_LABEL)
    spas = _spas(payload)
    # No circle here. The box is the place's own extent, and a place is an area,
    # not a point with a radius. Nearby is the surface that promises a radius.
    rows, dropped, set_aside = _rows(spas, PICTO_BY_SLUG.get(chosen), circle=None)

    return Listing(
        source_id=SOURCE_ID,
        source_label=SOURCE_LABEL,
        echo={
            **echo,
            "box": _box_as_dict(southwest, northeast),
            # Which place these rows are from. Without it a list of routes in
            # Valencia looks exactly like a list of routes in Catalonia.
            "place": {"name": place.name, "lat": place.lat, "lng": place.lng},
        },
        rows=rows,
        places=places,
        attribution=ATTRIBUTION,
        # A full window is the evidence there is more, and it is counted before
        # our own filtering: a short page after filtering says nothing about
        # whether Wikiloc has another window to give.
        has_more=len(spas) >= size and number < PAGE_MAX,
        total_known=None,
        dropped=dropped,
        set_aside=set_aside,
    )


def nearby(
    lat: Optional[Any] = None,
    lng: Optional[Any] = None,
    activity: Optional[str] = None,
    radius_m: Optional[Any] = None,
    limit: Optional[Any] = None,
    page: Optional[Any] = None,
    windows: int = FILTER_WINDOWS,
) -> Listing:
    """A point in, links out.

    The point is turned into a box because `find.do` takes two corners, and it
    is then used a second time to check each row against the circle the visitor
    actually asked for. Nothing keeps it and nothing else is derived from it.
    """
    latitude, longitude = _coordinates(lat, lng)
    chosen = _activity(activity)
    radius = _clamp(radius_m, RADIUS_MIN, RADIUS_MAX, RADIUS_DEFAULT)
    size = _clamp(limit, 1, NEARBY_LIMIT_MAX, NEARBY_LIMIT_MAX)
    number = _clamp(page, 0, PAGE_MAX, 0)

    southwest, northeast = _box(latitude, longitude, radius)
    rows, dropped, set_aside, examined, more = _scan(
        southwest,
        northeast,
        picto=PICTO_BY_SLUG.get(chosen),
        circle=(latitude, longitude, radius),
        size=size,
        page=number,
        windows=windows,
    )

    return Listing(
        source_id=SOURCE_ID,
        source_label=SOURCE_LABEL,
        echo={
            "lat": latitude,
            "lng": longitude,
            "sport": chosen,
            "radiusM": radius,
            "limit": size,
            "page": number,
            # The box is echoed because it is worked out here rather than sent
            # by the visitor, and a figure this service invents should be one
            # the visitor can see.
            "box": _box_as_dict(southwest, northeast),
        },
        rows=rows,
        places=None,
        # What the scan saw, not what one window held: with a filter running,
        # a full window can yield nothing and an empty-looking page can still
        # have more behind it.
        has_more=more and number < PAGE_MAX,
        # Wikiloc's `count` is a count of the whole box, before the activity and
        # the radius are applied. Reporting it would put a number about a
        # different question beside these rows.
        total_known=None,
        dropped=dropped,
        set_aside=set_aside,
        examined=examined,
    )


def vocabulary() -> Dict[str, Any]:
    """What the activity dropdown should hold, for `/api/sports`.

    Zero upstream calls: the list is written down above, with where it came
    from and how to refresh it.
    """
    return {
        "sports": [ANY_ACTIVITY, *ACTIVITY_SLUGS],
        "default": DEFAULT_ACTIVITY,
        "activities": [
            {"id": ANY_ACTIVITY, "label": "Any activity", "group": None},
            *(
                {"id": slug, "label": label, "group": group}
                for _, slug, label, group in ACTIVITIES
            ),
        ],
    }


# --- what was asked -----------------------------------------------------------


def _query_text(query: Optional[str]) -> str:
    text = query.strip() if isinstance(query, str) else ""
    if len(text) < QUERY_MIN_CHARS:
        raise SourceError("query", "a search needs at least two characters to look for")
    return text[:QUERY_MAX_CHARS]


def _activity(value: Optional[str]) -> str:
    """The activity slug, checked against Wikiloc's vocabulary before any request.

    Checked here even though it is never sent anywhere, for the same reason the
    Komoot side checks a sport: a word Wikiloc has no idea about is a question
    this service cannot answer, and saying so costs nothing. Silently treating
    it as "everything" would answer a narrower question with a wider one.
    """
    if not isinstance(value, str) or not value.strip():
        return ANY_ACTIVITY

    slug = value.strip().lower()
    if slug == ANY_ACTIVITY or slug in PICTO_BY_SLUG:
        return slug

    named = ", ".join(ACTIVITY_SLUGS[:ACTIVITIES_NAMED_IN_ERRORS])
    raise SourceError(
        "sport",
        "Wikiloc has no activity called that. The commonest are: "
        f"{named}, or {ANY_ACTIVITY} for every activity. "
        f"All {len(ACTIVITY_SLUGS)} are at GET /api/sports?source=wikiloc",
    )


def _coordinates(lat: Any, lng: Any) -> Tuple[float, float]:
    """Rejected rather than clamped, unlike every other number here.

    A mistyped latitude clamped to 90 answers with Arctic routes for somebody
    who meant Catalonia, and that is worse than being told the point is wrong.
    """
    latitude = _finite(lat)
    longitude = _finite(lng)
    if latitude is None or longitude is None:
        raise SourceError("location", "a latitude and a longitude are both needed")
    if not -90.0 <= latitude <= 90.0 or not -180.0 <= longitude <= 180.0:
        raise SourceError("location", "that latitude and longitude are not a place on earth")
    return latitude, longitude


def _finite(value: Any) -> Optional[float]:
    # A bool is an int in Python, and `True` is not a latitude.
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    try:
        number = float(value)
    except OverflowError:
        # Python integers have no ceiling; floats do. A number past 1e308 is
        # still a caller saying "a lot", so it clamps like any other, and must
        # not fall out of the one-envelope contract as a 500.
        return None
    # NaN is the one value that is not equal to itself, and it survives every
    # comparison below without failing one.
    if number != number or number in (float("inf"), float("-inf")):
        return None
    return number


def _clamp(value: Any, low: int, high: int, default: int) -> int:
    """Clamped, never rejected.

    A caller asking for a thousand results wants "a lot", and answering with
    twenty-five serves them. What actually happened comes back in the echoed
    `query`, so nothing is hidden. Only what cannot be guessed at is refused.
    """
    number = _finite(value)
    if number is None:
        return default
    return int(min(high, max(low, number)))


# --- a centre and a radius, as two corners ------------------------------------


def _box(
    latitude: float, longitude: float, radius_m: int
) -> Tuple[Tuple[float, float], Tuple[float, float]]:
    """The smallest box holding the circle of `radius_m` around the point.

    A degree of latitude is the same length everywhere, because every meridian
    is a great circle: one degree is `R * pi / 180`, about 111.2 km.

    A degree of longitude is that length times the cosine of the latitude,
    because the parallel through a point is a smaller circle than the equator.
    At Montserrat, 41.6 degrees north, a degree of longitude is about 83 km, not
    111 km. Using the latitude figure for both would draw a box a third too
    narrow there, and half too narrow in Iceland: rows would be missing from the
    east and west of the circle and nothing would say so.

        half_lat = degrees(radius / R)
        half_lng = degrees(radius / (R * cos(latitude)))

    The box reaches `radius * sqrt(2)` at its corners, so about 21% of it lies
    outside the circle that was asked for. `_within()` removes that afterwards,
    from each row's own coordinates, at no upstream cost.

    Two edges of the world are handled by clamping rather than by wrapping.
    Latitude clamps at the poles, where a box is meaningless anyway. Longitude
    clamps at the date line instead of wrapping, because `find.do` reads `sw`
    and `ne` as two corners: a wrapped box would ask for the whole planet the
    long way round. A visitor within one radius of the date line therefore gets
    the half of their circle on their own side of it.
    """
    half_lat = degrees(radius_m / EARTH_RADIUS_M)
    scale = cos(radians(latitude))
    if scale <= 0.0:
        # Standing on a pole, every direction is south and a longitude span
        # means nothing.
        half_lng = 180.0
    else:
        half_lng = min(180.0, degrees(radius_m / (EARTH_RADIUS_M * scale)))

    south = max(-90.0, latitude - half_lat)
    north = min(90.0, latitude + half_lat)
    west = max(-180.0, longitude - half_lng)
    east = min(180.0, longitude + half_lng)
    return (south, west), (north, east)


def _point(near: Optional[Tuple[Any, Any]]) -> Optional[Tuple[float, float]]:
    """A caller's chosen point, or nothing. Bad numbers are nothing, not an
    error: the words are still a question worth answering by other means."""
    if not near:
        return None
    try:
        lat, lng = float(near[0]), float(near[1])
    except (TypeError, ValueError, IndexError):
        return None
    if not (-90 <= lat <= 90 and -180 <= lng <= 180):
        return None
    return lat, lng


def _place_box(
    place: Place, extent: Optional[Tuple[float, float, float, float]]
) -> Tuple[Tuple[float, float], Tuple[float, float]]:
    """The box for a place: its own outline, never wider than the radius cap.

    Photon publishes an `extent` for most places, and a place's own outline is a
    better answer than a circle drawn around its centre -- a valley is not
    round. But an extent can be a whole country, and a box that size answers
    "trails in Spain" with twenty-four rows from anywhere in it. So the extent
    is trimmed to the box a `RADIUS_DEFAULT` circle would have drawn.

    A place with no extent is a point, and a point gets that circle's box.
    """
    limit_sw, limit_ne = _box(place.lat, place.lng, RADIUS_DEFAULT)
    if extent is None:
        return limit_sw, limit_ne

    west, north, east, south = extent
    trimmed_south = max(south, limit_sw[0])
    trimmed_west = max(west, limit_sw[1])
    trimmed_north = min(north, limit_ne[0])
    trimmed_east = min(east, limit_ne[1])
    if trimmed_south >= trimmed_north or trimmed_west >= trimmed_east:
        # The centre is outside its own outline, or the trim closed the box.
        # Neither is worth a guess, so the circle's box stands.
        return limit_sw, limit_ne
    return (trimmed_south, trimmed_west), (trimmed_north, trimmed_east)


def _within(latitude: float, longitude: float, circle: Tuple[float, float, int]) -> bool:
    """Is this row really inside the radius, rather than merely inside the box?

    Great-circle distance, the haversine form, which stays accurate for the
    small distances this asks about where the cosine form loses precision.
    """
    centre_lat, centre_lng, radius_m = circle
    lat1, lng1, lat2, lng2 = map(radians, (centre_lat, centre_lng, latitude, longitude))
    half_lat = (lat2 - lat1) / 2.0
    half_lng = (lng2 - lng1) / 2.0
    a = sin(half_lat) ** 2 + cos(lat1) * cos(lat2) * sin(half_lng) ** 2
    return 2.0 * EARTH_RADIUS_M * asin(min(1.0, sqrt(a))) <= radius_m


def _box_as_dict(
    southwest: Tuple[float, float], northeast: Tuple[float, float]
) -> Dict[str, float]:
    return {
        "south": southwest[0],
        "west": southwest[1],
        "north": northeast[0],
        "east": northeast[1],
    }


def _scan(
    southwest: Tuple[float, float],
    northeast: Tuple[float, float],
    picto: Optional[int],
    circle: Optional[Tuple[float, float, int]],
    size: int,
    page: int,
    windows: int = FILTER_WINDOWS,
) -> Tuple[List[Row], int, Dict[str, int], int, bool]:
    """Reads upstream windows until this page is full, or until it has looked
    far enough.

    Wikiloc pages by row offset and will not filter for a caller without an
    account, so a filtered page cannot land on a fixed offset: which rows match
    is only known after they are read. The scan therefore starts at the
    beginning and skips the matches an earlier page already showed. That costs
    the same windows again for a later page, which is why PAGE_MAX is small and
    why the window count is capped rather than the row count.

    Returns the rows, the ones that could not be converted, the ones set aside
    on purpose, how many were read to get here, and whether the source had more
    to give when the scan stopped.
    """
    skip = page * size
    kept: List[Row] = []
    dropped = 0
    # Seeded from an empty read so the reasons are always named, even when the
    # box held nothing. A page that has to check whether a key exists before
    # printing a zero is a page that will one day print nothing by accident.
    _, _, aside = _rows([], picto, circle)
    examined = 0
    more = False

    for window in range(max(1, min(windows, FILTER_WINDOWS))):
        payload = _answer(
            _find_url(southwest, northeast, window, SCAN_WINDOW), SOURCE_LABEL
        )
        spas = _spas(payload)
        if not spas:
            break
        examined += len(spas)

        rows, window_dropped, window_aside = _rows(spas, picto, circle)
        dropped += window_dropped
        for reason, count in window_aside.items():
            aside[reason] = aside.get(reason, 0) + count

        for row in rows:
            if skip > 0:
                skip -= 1
                continue
            if len(kept) < size:
                kept.append(row)
            else:
                # One match beyond a full page is all it takes to know there is
                # another page, and it costs nothing to notice.
                more = True
                break

        if len(kept) >= size and more:
            break
        # A short window means the box is exhausted, not that we should ask again.
        if len(spas) < SCAN_WINDOW:
            break
    else:
        # The cap stopped the scan rather than the data running out, so there
        # may well be more behind it. Saying otherwise would be a guess.
        more = more or True

    return kept, dropped, aside, examined, more


def _find_url(
    southwest: Tuple[float, float],
    northeast: Tuple[float, float],
    page: int,
    size: int,
) -> str:
    """One window of one box.

    `from` and `to` are row offsets, half-open, and they page honestly: page 1
    of size 6 and page 1 of size 24 were both checked against the live endpoint
    on 2026-09-02 and shared no id with page 0. The Komoot side had exactly this
    bug, so it is checked here rather than assumed.
    """
    first = page * size
    return f"{FIND_URL}?" + urlencode(
        {
            "event": "map",
            "from": first,
            "to": first + size,
            # Six decimals is about eleven centimetres, which is far finer than
            # any of this needs and short enough to read in a log.
            "sw": f"{southwest[0]:.6f},{southwest[1]:.6f}",
            "ne": f"{northeast[0]:.6f},{northeast[1]:.6f}",
        }
    )


# --- rows ---------------------------------------------------------------------


def _spas(payload: Dict[str, Any]) -> List[Dict[str, Any]]:
    """The rows. Wikiloc calls them `spas`."""
    rows = payload.get("spas")
    return [row for row in rows if isinstance(row, dict)] if isinstance(rows, list) else []


def _rows(
    spas: Iterable[Dict[str, Any]],
    picto: Optional[int],
    circle: Optional[Tuple[float, float, int]],
) -> Tuple[List[Row], int, Dict[str, int]]:
    """Rows kept, rows that could not be used, and rows removed on purpose.

    Convertibility is decided first, before either filter, so `dropped` stays an
    honest count of what Wikiloc sent that this service could not open. Checking
    the filters first would hide a broken row behind a visitor's choice of
    activity, and that is the one number here that is about Wikiloc rather than
    about the question asked.
    """
    rows: List[Row] = []
    dropped = 0
    set_aside = {"otherActivity": 0, "outsideRadius": 0}

    for spa in spas:
        row = _row(spa)
        if row is None:
            dropped += 1
            continue
        if picto is not None and spa.get("picto") != picto:
            set_aside["otherActivity"] += 1
            continue
        if circle is not None:
            # A row that does not say where it is cannot be shown as being
            # within the radius, so it is set aside with the rest rather than
            # let through on the strength of the box it arrived in.
            start = row.start
            if start is None or not _within(start["lat"], start["lng"], circle):
                set_aside["outsideRadius"] += 1
                continue
        rows.append(row)

    return rows, dropped, set_aside


def _row(spa: Dict[str, Any]) -> Optional[Row]:
    """One row, or `None` when it could not be made into something clickable."""
    url = _convertible_url(spa.get("prettyURL"), spa.get("id"))
    title = spa.get("name")
    if url is None or not isinstance(title, str) or not title.strip():
        return None

    picto = spa.get("picto")
    return Row(
        published_by=SOURCE_LABEL,
        url=url,
        title=re.sub(r"\s+", " ", html.unescape(title)).strip(),
        # An unknown picto is left null rather than guessed at. Wikiloc adds
        # activities, and inventing a name for one is how a page starts
        # displaying words nobody chose.
        sport=SLUG_BY_PICTO.get(picto) if isinstance(picto, int) else None,
        start=_start(spa),
        # Wikiloc photographs the path; it does not draw the route. So this
        # slot holds a walker's picture, and `kind` says so, because a card
        # that treats the two as the same thing would show the shape of the
        # walk for one source and somebody's view of a rock for the other
        # without ever admitting the difference.
        thumbnail=thumbnail(_first_thumb(spa), "photo"),
        rating=_rating(spa),
        difficulty=DIFFICULTY_BY_SKILL.get(spa.get("skill")),
        # Wikiloc's rows carry no date the way Komoot's do. Left null rather
        # than filled from the upload date, which is a different fact.
        updated_at=None,
        published=Published(
            # Wikiloc's own figures, in Wikiloc's own units, turned into metres
            # and nothing else. Nothing is rounded here and nothing is worked
            # out from a neighbour: measuring happens in the browser, from the
            # file itself.
            distance_m=_metres(spa.get("distance"), spa.get("uom")),
            # `slope` is the climb. Checked against the trail page it links to
            # on 2026-09-02: row 184968972 says distance 5.17 mi and slope 2838
            # f, and its page publishes 8,320 m and 865 m of ascent, which is
            # those two figures exactly.
            ascent_m=_metres(spa.get("slope"), spa.get("uomslope")),
            # A row does not publish a descent, a duration, or how many points
            # the track carries. Null is the honest answer, and the last of
            # those is the figure this whole product exists to check.
        ),
    )


def _convertible_url(pretty_url: Any, identifier: Any) -> Optional[str]:
    """A row URL that `/api/convert` is already proven able to open.

    `prettyURL` is Wikiloc's own path for the trail, so the id lands where
    Wikiloc put it rather than where we guessed. It is site-relative, and only a
    relative path is accepted: a value that already carries a scheme or a host
    would be Wikiloc pointing us off its own site, and this is not the place to
    decide whether to follow that.

    Then the same three rules the Komoot side uses -- https, a host this service
    reads, and an id its own adapter can find -- and one more: the id in the
    slug has to be the id on the row. They can only disagree if Wikiloc changed
    the shape of `prettyURL`, and a URL whose id we misread converts somebody
    else's trail while answering 200.
    """
    if not isinstance(pretty_url, str) or not pretty_url.startswith("/"):
        return None
    if pretty_url.startswith("//"):
        # `//host/path` is a URL with a host, not a path on this site.
        return None

    # Query and fragment are dropped, the way the Komoot side drops them: a row
    # link is the trail's address, and anything else on it is Wikiloc's own
    # bookkeeping travelling back out inside a URL of ours.
    parsed = urlparse(f"{TRAIL_ROOT}{pretty_url}")._replace(query="", fragment="")
    url = parsed.geturl()
    if parsed.scheme != "https":
        return None
    if not parsed.hostname or not ALLOWED_HOST.match(parsed.hostname):
        return None

    found = wikiloc.trail_id(url)
    if found is None:
        return None
    if found != _identifier(identifier):
        return None
    return url


def _identifier(value: Any) -> Optional[str]:
    """The row's own id, as digits, or `None` if it is not one."""
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return str(value)
    if isinstance(value, str) and value.strip().isdigit():
        return value.strip()
    return None


def _metres(value: Any, unit: Any) -> Optional[float]:
    """A row's figure, in metres, or `None` when it cannot be read as one.

    An unknown unit gives `None` rather than a number, because the alternative
    is a figure that is wrong by a factor of 1.6 or 3.3 with nothing to show
    for it.
    """
    if isinstance(value, bool) or not isinstance(value, (str, int, float)):
        return None
    if not isinstance(unit, str):
        return None
    spelling = UNIT_SPELLING.get(unit.strip().lower())
    if spelling is None:
        return None
    return wikiloc._number(f"{value} {spelling}")


# Checked against the trail pages themselves: skill 1, 2 and 3 render as Easy,
# Moderate and Difficult. Wikiloc's scale may go further, and anything outside
# these three gets no word rather than a guessed one.
DIFFICULTY_BY_SKILL = {1: "easy", 2: "moderate", 3: "difficult"}


def _first_thumb(spa: Dict[str, Any]) -> Optional[str]:
    thumbs = spa.get("thumbs")
    if not isinstance(thumbs, list) or not thumbs:
        return None
    first = thumbs[0]
    return first.get("url") if isinstance(first, dict) else None


def _rating(spa: Dict[str, Any]) -> Optional[Dict[str, float]]:
    """Both halves or neither, the same rule the other source follows.

    A COUNT OF ZERO IS NOT A SCORE OF ZERO. Wikiloc sends every unrated trail as
    `rating` 0.0 with `numRatings` 0, and that pair means nobody rated it, not
    that everybody rated it nothing. Measured on 2026-09-02 over 100 rows from
    five searches: 70 arrived that way, `mazunte` alone eight rows out of nine.
    Passed on as a rating it draws a five-star row filled none of the way and
    prints "0 (0)" beside it, which is this page claiming other walkers scored
    a route they never opened.

    Komoot needs no such rule and does not get one: it leaves both fields out
    of a row nobody has rated, so the check above already returns None.
    """
    score = spa.get("rating")
    count = spa.get("numRatings")
    try:
        score = float(score)
        count = int(count)
    except (TypeError, ValueError):
        return None
    if count <= 0:
        return None
    return {"score": round(score, 2), "count": count}


def _start(spa: Dict[str, Any]) -> Optional[Dict[str, float]]:
    """Where the trail starts. Wikiloc writes the longitude as `lon`."""
    latitude = _finite(spa.get("lat"))
    longitude = _finite(spa.get("lon"))
    if latitude is None or longitude is None:
        return None
    if not -90.0 <= latitude <= 90.0 or not -180.0 <= longitude <= 180.0:
        return None
    return {"lat": latitude, "lng": longitude}


# --- the place search ---------------------------------------------------------


def _geocode(text: str) -> List[Tuple[Place, Optional[Tuple[float, float, float, float]]]]:
    """Words into places, through Photon. One call, `PLACES_MAX` answers.

    Each place comes back with the outline Photon publishes for it, where there
    is one. The first is what the search is run over; the rest are for the page
    to offer, because "Montserrat" is a mountain in Catalonia, a village near
    Valencia and an island in the Caribbean, and only the visitor knows which
    they meant.
    """
    payload = _answer(
        f"{GEOCODE_URL}?{urlencode({'q': text, 'limit': PLACES_MAX})}", "the place search"
    )
    features = payload.get("features")
    if not isinstance(features, list):
        return []

    found = []
    for feature in features:
        if not isinstance(feature, dict):
            continue
        place = _place(feature)
        if place is not None:
            found.append((place, _extent(feature.get("properties"))))
    return found[:PLACES_MAX]


def _place(feature: Dict[str, Any]) -> Optional[Place]:
    properties = feature.get("properties")
    geometry = feature.get("geometry")
    if not isinstance(properties, dict) or not isinstance(geometry, dict):
        return None
    coordinates = geometry.get("coordinates")
    if not isinstance(coordinates, list) or len(coordinates) < 2:
        return None
    # GeoJSON writes longitude first. Reading them in written order puts every
    # place in the sea off Somalia.
    longitude = _finite(coordinates[0])
    latitude = _finite(coordinates[1])
    name = properties.get("name")
    if latitude is None or longitude is None:
        return None
    if not isinstance(name, str) or not name.strip():
        return None
    if not -90.0 <= latitude <= 90.0 or not -180.0 <= longitude <= 180.0:
        return None

    # Named with what tells the five Montserrats apart, and nothing else. The
    # rule is `discovery.place_name`, shared with the other site so the two
    # halves of a merged place list are named the same way.
    return Place(
        place_name(name, properties.get("state"), properties.get("country")),
        latitude,
        longitude,
    )


def _extent(properties: Any) -> Optional[Tuple[float, float, float, float]]:
    """Photon's outline for a place, as it writes it: west, north, east, south.

    Not the order any of the other four-number boxes in this file use, which is
    why it is read in one place and turned into corners immediately.
    """
    if not isinstance(properties, dict):
        return None
    extent = properties.get("extent")
    if not isinstance(extent, list) or len(extent) != 4:
        return None
    numbers = [_finite(each) for each in extent]
    if any(number is None for number in numbers):
        return None
    west, north, east, south = numbers  # type: ignore[misc]
    if not -90.0 <= south <= north <= 90.0:
        return None
    if not -180.0 <= west <= east <= 180.0:
        return None
    return west, north, east, south


def _answer(url: str, who: str) -> Dict[str, Any]:
    status, payload = fetch_json(url, timeout=LIST_TIMEOUT_SECONDS)
    if status != 200 or not isinstance(payload, dict):
        # Deliberately not the 403 and 404 reading that `wikiloc.py` does. There
        # the status is about one identified trail, so it can mean private or
        # gone. A list endpoint refusing only ever means the question went
        # unanswered.
        raise SourceError("network", f"{who} answered {status}")
    return payload
