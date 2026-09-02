"""Two ways of arriving at a Komoot URL.

This service converts one URL into a GPX. Search and Nearby do not change that.
They hand back URLs, each carrying the figures Komoot publishes beside it, and
the URL then goes through `komoot.py` unchanged. A row is a link, never a track:
nothing here returns coordinates, a GPX, or a measurement of any kind.

It sits beside `komoot.py` rather than inside it because the two answer
different questions. `komoot.py` is the file you open to learn how one link
becomes a track, and every line in it is about that. What the two share is the
link vocabulary, and this module borrows it rather than restating it: `_link()`
decides which id space a row URL lands in, and `_first()` and `_number()` read
a figure that may not be there at all.

Komoot's robots.txt disallows /api for crawlers. That is a directive about
walking the site, so this module answers one visitor action with exactly one
upstream call: no id is ever incremented, no page is fetched ahead of being
asked for, and nothing outlives the request. The page cap here and the fan-out
ceiling in `api/http.py` are that rule written as code.

Every figure on a row is Komoot's claim about the route, not a measurement. It
travels in a `published` object, under the same name and through the same
`Published` dataclass that `/api/convert` already uses, so a reader learns that
vocabulary once and a page renders it with the habits it already has.
"""

from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple
from urllib.parse import unquote, urlencode, urlparse, urlunparse

from . import Published, SourceError, komoot
from .discovery import Listing, Place, Row, place_name, thumbnail
from . import polyline
from ..http import ALLOWED_HOST, fetch_json

SOURCE_ID = "komoot"
SOURCE_LABEL = "Komoot"

SEARCH_URL = "https://www.komoot.com/api/search/discover"
NEARBY_URL = "https://www.komoot.com/api/v007/discover_tours/from_location/"

# Komoot's own vocabulary, read from
# https://www.komoot.com/webapi/v007/discover_sports/ on 2026-09-02. To refresh
# it, open that address and read `_embedded.items[].sport`.
#
# It is written down rather than fetched because fetching it at import would be
# work no visitor asked for, would stop this service starting whenever Komoot is
# down, and would put the network into the test suite. Written down, a bad sport
# is refused before a token is spent learning it was bad.
SPORTS = ("hike", "touringbicycle", "mtb", "racebike", "jogging", "mountaineering")
DEFAULT_SPORT = "hike"
ANY_SPORT = "all"

# The list is a means of reaching one URL, never the destination. Ten rows is
# enough to recognise the route you meant, and the caps keep one upstream page
# and one response bounded.
LIMIT_DEFAULT = 10
LIMIT_MAX = 25

# Five pages. If the route is not in the first hundred-odd results the query is
# wrong, not the paging, and without a cap, `page=999999` is a crawl with extra
# steps. `hasMore` is forced false here, so the page cannot render a next button
# into page five.
PAGE_MAX = 4

# Nearby pages correctly at 6 rows and no higher. Measured against the live
# endpoint on 2026-09-02: sizes 1 to 6 echo `page.number` back and return fresh
# ids, while 7 and above silently answer page 0 again with 12 rows and
# `number: 0`. Asking for 9 therefore repeats every row the visitor has already
# seen, with nothing in the response saying so. Search has no such limit and is
# left alone.
NEARBY_LIMIT_MAX = 6

# 25 km is a morning's drive from a trailhead. 50 km is where "near me" stops
# meaning near me and starts meaning "sweep the region"; a capped radius and
# capped pages together mean no coordinate-grid sweep can be expressed at all.
RADIUS_DEFAULT = 25000
RADIUS_MIN = 1000
RADIUS_MAX = 50000

# Places exist to turn a place name into coordinates for the nearby form. Five
# is enough to pick from, and they carry no figures and no Komoot link: a place
# link is a browse page, and linking to browse pages is the discovery product
# this must not become.
PLACES_MAX = 5

QUERY_MAX_CHARS = 120
# Komoot itself refuses a one-character query with a 400, so refusing it here
# costs the visitor an instant answer instead of a wasted upstream call.
QUERY_MIN_CHARS = 2

# A list that takes longer than this has already failed the visitor, and a short
# wait bounds how long a spent token stays in flight.
LIST_TIMEOUT_SECONDS = 8

# WHETHER A POINT CAN AIM A TEXT SEARCH AT A PLACE. It cannot, and this is what
# was tried before saying so, all against the live endpoint on 2026-09-02 with
# the query `montserrat`, which is the whole problem in one word: a mountain in
# Catalonia, a village in Valencia, and an island in the Caribbean.
#
#   no point at all              first tour "View of Montserrat's north face
#                                ... from Manresa Baixador", start 41.732 1.828
#   lat/lng at Sanabria,         the same row, the same three tours, in the same
#   42.117 -6.717, 600 km away   order. Byte-identical.
#   lat/lng on the island,       three DIFFERENT tours, and every one of them
#   16.742 -62.192               still in Catalonia, 41.57 to 41.59
#   bbox=-62.3,16.6,-62.1,16.9   the same three tours as no point at all
#   map_bounds, same box         the same three tours as no point at all
#   lat/lng + max_distance       nothing beyond what lat/lng had already done
#   lat/lng + radius             nothing beyond what lat/lng had already done
#
# So `lat`/`lng` nudges the ranking and does not choose a place: Komoot reads
# the words as a place itself and the words win. The parameter is not dead, and
# that is worth knowing before anyone calls it broken -- with a query naming
# nowhere (`trail`) and that same island point, Komoot answered with tours at
# 18.31 -64.71, in the Caribbean. It is only a search whose words name a place
# that cannot be pointed at a different one.
#
# Komoot does not publish what this endpoint accepts, so the rows above are what
# was tried, not a proof that nothing else exists. Anyone finding a parameter
# that does aim the search changes this constant and the table in `merged.py`
# reads the new value; nothing else has to move.
POINT_APPLIED = False


def search(
    query: Optional[str] = None,
    sport: Optional[str] = None,
    near: Optional[Sequence[Any]] = None,
    limit: Optional[Any] = None,
    page: Optional[Any] = None,
) -> Listing:
    """Words in, links out. One upstream call, always."""
    text = _query_text(query)
    chosen = _sport(sport, required=False)
    size = _clamp(limit, 1, LIMIT_MAX, LIMIT_DEFAULT)
    number = _clamp(page, 0, PAGE_MAX, 0)

    parameters = {
        # Places ride along in the same call, so the nearby form gets its
        # geocoder without a second request and without a second token.
        "entities": "editorial_tours,places",
        "query": text,
        "sport": chosen,
        "limit": size,
        "page": number,
    }
    if near is not None:
        latitude, longitude = _coordinates(near[0] if len(near) > 0 else None,
                                           near[1] if len(near) > 1 else None)
        parameters["lat"] = latitude
        parameters["lng"] = longitude

    items = _items(_answer(f"{SEARCH_URL}?{urlencode(parameters)}"))

    # Read by the item's own `content_type`, never by position: one call
    # returns both kinds, mixed in relevance order.
    rows, dropped = _rows(item for item in items if item.get("content_type") == "editorial_tour")
    places = [
        place
        for place in (
            _place(item) for item in items if item.get("content_type") == "location"
        )
        if place is not None
    ][:PLACES_MAX]

    return Listing(
        source_id=SOURCE_ID,
        source_label=SOURCE_LABEL,
        echo={"query": text, "sport": chosen, "limit": size, "page": number},
        rows=rows,
        places=places,
        # Search has no paging envelope, so a full page is the only evidence
        # there is more. The count is of every item, not of the rows: Komoot
        # fills one page with tours and places together, and counting the tours
        # alone would report "nothing more" whenever places took the room.
        has_more=len(items) >= size and number < PAGE_MAX,
        total_known=None,
        dropped=dropped,
    )


def nearby(
    lat: Optional[Any] = None,
    lng: Optional[Any] = None,
    sport: Optional[str] = None,
    radius_m: Optional[Any] = None,
    limit: Optional[Any] = None,
    page: Optional[Any] = None,
) -> Listing:
    """A point in, links out. One upstream call, always.

    The point is pass-through: it goes into one upstream query string and
    leaves. Nothing is derived from it and nothing keeps it.
    """
    latitude, longitude = _coordinates(lat, lng)
    # Required, not defaulted. Upstream demands it, and a hidden server default
    # would answer a question nobody asked by handing hiking routes to a
    # cyclist. A visible default in the form is a different thing: the visitor
    # can see it and change it.
    chosen = _sport(sport, required=True)
    radius = _clamp(radius_m, RADIUS_MIN, RADIUS_MAX, RADIUS_DEFAULT)
    size = _clamp(limit, 1, NEARBY_LIMIT_MAX, NEARBY_LIMIT_MAX)
    number = _clamp(page, 0, PAGE_MAX, 0)

    parameters = {
        "lat": latitude,
        "lng": longitude,
        "sport": chosen,
        "max_distance": radius,
        "limit": size,
        "page": number,
    }
    payload = _answer(f"{NEARBY_URL}?{urlencode(parameters)}")

    # Nearby ids arrive with the "e" prefix that picks the endpoint, so the id
    # is handed to the row builder untouched as the fallback for an item that
    # carries no share_url of its own.
    rows, dropped = _rows(_items(payload), id_key="id")

    envelope = payload.get("page")
    envelope = envelope if isinstance(envelope, dict) else {}
    total_pages = envelope.get("totalPages")
    total_elements = envelope.get("totalElements")

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
        },
        rows=rows,
        places=None,
        has_more=isinstance(total_pages, int) and number + 1 < total_pages and number < PAGE_MAX,
        # Here the source did say, so this is not `None`.
        total_known=total_elements if isinstance(total_elements, int) else None,
        dropped=dropped,
    )


def _query_text(query: Optional[str]) -> str:
    text = query.strip() if isinstance(query, str) else ""
    if len(text) < QUERY_MIN_CHARS:
        raise SourceError("query", "a search needs at least two characters to look for")
    return text[:QUERY_MAX_CHARS]


def _sport(value: Optional[str], required: bool) -> str:
    """The sport slug, checked against Komoot's vocabulary before any request.

    Search accepts `all` and defaults to it, because "everything near this word"
    is a real question. Nearby has no such answer: upstream refuses without a
    sport, so an unset one is the visitor's question left incomplete.
    """
    named = ", ".join(SPORTS)
    if not isinstance(value, str) or not value.strip():
        if required:
            raise SourceError("sport", f"a sport is needed, one of: {named}")
        return ANY_SPORT

    slug = value.strip().lower()
    if slug in SPORTS:
        return slug
    if slug == ANY_SPORT and not required:
        return ANY_SPORT

    allowed = named if required else f"{named}, {ANY_SPORT}"
    raise SourceError("sport", f"Komoot has no sport called that; it has: {allowed}")


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


def _items(payload: Dict[str, Any]) -> List[Dict[str, Any]]:
    embedded = payload.get("_embedded")
    items = embedded.get("items") if isinstance(embedded, dict) else payload.get("items")
    return [item for item in items if isinstance(item, dict)] if isinstance(items, list) else []


def _rows(
    items: Iterable[Dict[str, Any]], id_key: Optional[str] = None
) -> Tuple[List[Row], int]:
    rows: List[Row] = []
    dropped = 0
    for item in items:
        row = _row(item, item.get(id_key) if id_key else None)
        if row is None:
            dropped += 1
        else:
            rows.append(row)
    return rows, dropped


def _row(item: Dict[str, Any], identifier: Optional[Any]) -> Optional[Row]:
    """One row, or `None` when it could not be made into something clickable."""
    url = _convertible_url(item.get("share_url"), identifier)
    title = item.get("name")
    if url is None or not isinstance(title, str) or not title.strip():
        return None

    sport = item.get("sport")
    return Row(
        published_by=SOURCE_LABEL,
        url=url,
        title=title.strip(),
        sport=sport if isinstance(sport, str) and sport else None,
        start=_start(item),
        # Komoot draws the route itself, so its picture is the shape of the
        # walk. The small variant: a card is a card, and the big one is four
        # times the bytes for pixels nobody sees at this size.
        thumbnail=thumbnail(
            _nested(item, "map_image_preview", "src")
            or _nested(item, "vector_map_image_preview", "src"),
            "route-map",
        ),
        trace=_trace(item),
        rating=_rating(item),
        # A word Komoot assigns, not a number we could check. Nearby carries it
        # and search does not, which is why it is nullable rather than a
        # default.
        difficulty=_nested(item, "difficulty", "grade"),
        updated_at=item.get("changed_at") if isinstance(item.get("changed_at"), str) else None,
        published=Published(
            # Metres and seconds, as given. Nothing is rounded, converted or
            # worked out from a neighbour: rounding is a small measurement, and
            # measuring happens in the browser, from the file itself.
            distance_m=komoot._first(item, "distance", "distance_m"),
            ascent_m=komoot._first(item, "elevation_up", "uphill"),
            descent_m=komoot._first(item, "elevation_down", "downhill"),
            duration_s=komoot._first(item, "duration", "duration_s"),
            # How many points a track carries is the figure this whole product
            # exists to check, and a list never says. Null is the honest answer.
        ),
    )


def _convertible_url(share_url: Any, identifier: Optional[Any]) -> Optional[str]:
    """A row URL that `/api/convert` is already proven able to open.

    Three rules, and the third is what makes "every row is convertible" an
    invariant rather than a hope.

    Komoot's own `share_url` comes first: Komoot wrote it, so it lands in the
    right id space with no guessing from us. Its query string is dropped, because
    that carries a search token, and on a nearby row that token is derived from
    the visitor's own coordinates, which have no business travelling back out
    inside a URL of ours.

    `_links.self` is never read. On search it is an api.komoot.de address that
    the converter does not recognise as a route at all.

    Whatever the source, the result must be https, on a host this service reads,
    and something `komoot._link()` resolves. A URL that is not is dropped and
    counted, never returned.
    """
    url = None
    composed_here = False
    if isinstance(share_url, str) and share_url.strip():
        url = _without_query(share_url.strip())
    elif isinstance(identifier, str) and identifier.strip():
        url = f"https://www.komoot.com/smarttour/{identifier.strip()}"
        composed_here = True

    if url is None:
        return None

    parsed = urlparse(url)
    if parsed.scheme != "https":
        return None
    if not parsed.hostname or not ALLOWED_HOST.match(parsed.hostname):
        return None

    link = komoot._link(url)
    if link is None:
        return None

    # When we composed the URL ourselves, check the id landed where the id says
    # it belongs. This is the silent trap: `/smarttour/e945461356` is tour
    # 945461356, and dropping the "e" gives `/smarttour/945461356`, which is a
    # different route on the smart-tour endpoint and answers 200 with somebody
    # else's mountain. Nothing goes wrong loudly, so it is checked here.
    if composed_here and link != _expected_link(str(identifier).strip()):
        return None
    return url


def _expected_link(identifier: str) -> Tuple[str, str]:
    """Which endpoint an id belongs to, worked out from the id and nothing else."""
    slug = identifier.lower()
    if slug.startswith("e"):
        return "tour", slug[1:]
    return "smart_tour", slug


def _without_query(url: str) -> str:
    return urlunparse(urlparse(url)._replace(query="", fragment=""))



def _nested(item: Dict[str, Any], *path: str) -> Any:
    """A value from a nested object, or None the moment a step is missing."""
    current: Any = item
    for step in path:
        if not isinstance(current, dict):
            return None
        current = current.get(step)
    return current


def _trace(item: Dict[str, Any]) -> Optional[List[List[float]]]:
    """The route's shape, read out of the address of its own picture.

    Komoot's thumbnail URL is a drawing request, and what it asks to have drawn
    is encoded into the path. Reading it costs nothing: no request, no key, no
    third party. The alternative was to load their PNG, which arrives with
    their blue line already in the pixels.
    """
    src = _nested(item, "vector_map_image_preview", "src") or _nested(
        item, "map_image_preview", "src"
    )
    if not isinstance(src, str) or not src:
        return None
    encoded = unquote(src.rstrip("/").rsplit("/", 1)[-1])
    points = polyline.decode(encoded)
    # Two points is a straight line, which says nothing about a route and would
    # draw a card that lies about its shape.
    if len(points) < 3:
        return None
    return [[round(lat, 5), round(lng, 5)] for lat, lng in points]


def _rating(item: Dict[str, Any]) -> Optional[Dict[str, float]]:
    """What other walkers scored it, or nothing.

    Both halves or neither: a score with no count cannot be weighed, and a
    count with no score says nothing at all.
    """
    score = komoot._number(item.get("rating_score"))
    count = komoot._number(item.get("rating_count"))
    if score is None or count is None:
        return None
    return {"score": round(score, 2), "count": int(count)}


def _start(item: Dict[str, Any]) -> Optional[Dict[str, float]]:
    point = item.get("start_point") or item.get("point")
    if not isinstance(point, dict):
        return None
    latitude = komoot._number(point.get("lat"))
    longitude = komoot._number(point.get("lng"))
    if latitude is None or longitude is None:
        return None
    return {"lat": latitude, "lng": longitude}


def _place(item: Dict[str, Any]) -> Optional[Place]:
    point = item.get("point")
    name = item.get("name")
    if not isinstance(point, dict) or not isinstance(name, str) or not name.strip():
        return None
    # Komoot writes a place as x and y. x is the longitude: reading them in the
    # order they are written puts every place in the sea off Somalia.
    longitude = komoot._number(point.get("x"))
    latitude = komoot._number(point.get("y"))
    if latitude is None or longitude is None:
        return None
    # The region Komoot already sent, so two places of the same name are two
    # different answers rather than one printed twice. `montserrat` returns
    # `Montserrat` for the Valencian village and `Montserrat` for the Caribbean
    # island, and the `address_entry` beside each is the only thing in the
    # payload that tells them apart. The rule is shared with the other site, in
    # `discovery.place_name`, and it takes the region and nothing narrower: the
    # `zip_code` sitting in the same object is somebody's address.
    address = item.get("address_entry")
    address = address if isinstance(address, dict) else {}
    return Place(
        place_name(name, address.get("state"), address.get("country")),
        latitude,
        longitude,
    )


def _answer(url: str) -> Dict[str, Any]:
    status, payload = fetch_json(url, timeout=LIST_TIMEOUT_SECONDS)
    if status != 200 or not isinstance(payload, dict):
        # Deliberately not the 403 and 404 reading that `komoot.py` does. There
        # the status is about one identified route, so it can mean private or
        # gone. A list endpoint refusing only ever means the question went
        # unanswered.
        raise SourceError("network", f"Komoot answered {status}")
    return payload
