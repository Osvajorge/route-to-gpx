"""Komoot.

Komoot publishes every public tour through the same read-only endpoints its own
website calls, and those endpoints answer a plain request with plain JSON. So
there is no page to scrape. We ask for the tour, and Komoot answers 403 when the
tour is private and 404 when it does not exist. Those two are different problems
for the visitor, so we keep them apart.

The one trap is that Komoot has two id spaces, and their numbers overlap:

    /tour/1389649060        a tour        -> /api/v007/tours/{id}
    /smarttour/e1389649060  the same tour -> /api/v007/tours/{id without the e}
    /smarttour/20807594     a smart tour  -> /api/v007/smart_tours/{id}

The `e` is Komoot's own marker for a smart tour that is backed by a real tour;
its own site code strips it before calling the tour endpoint, and keeps the id
whole otherwise. Reading the id without reading that prefix is worse than
failing: a bare smart tour id is usually a valid tour id too, belonging to
somebody else's route, so the visitor would get a GPX of a different mountain
and no error at all.

A link also arrives in whatever shape the visitor copied it: any country domain,
an optional locale segment such as `/es-es/`, a slug after the id that Komoot
itself ignores, and a query string. None of that carries meaning, so none of it
is read.
"""

import re
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlparse

from . import Published, Route, SourceError
from ..http import fetch_json

TOUR_URL = "https://www.komoot.com/api/v007/tours/{id}?_embedded=coordinates"
SMART_TOUR_URL = "https://www.komoot.com/api/v007/smart_tours/{id}"
# A smart tour keeps its track behind a second request. Asking the line above
# for `_embedded=coordinates` answers 200 with an empty track, which would look
# like a route with no coordinates rather than like a missing request.
SMART_TOUR_TRACK_URL = "https://www.komoot.com/api/v007/smart_tours/{id}/coordinates"

# The path segment before the id is what tells the two id spaces apart, so it is
# matched from the start of the path: an unanchored `/tour/` also matches the
# `/images/tour/placeholder.webp` that sits in the markup of every Komoot page.
ROUTE_PATH = re.compile(
    r"^(?:/[a-z]{2}(?:-[a-z]{2})?)?"  # locale, as in /es-es/ or /es/
    r"(?:/api)?(?:/v\d+)?"  # the API origin carries the same ids
    r"/(?P<kind>smart_tours|smarttour|invite-tour|tours|tour)"
    r"/(?P<id>e?\d+)(?:[/?#]|$)",
    re.I,
)

# Links that sit next to tours on Komoot and are not tours. A visitor who pasted
# one made a category mistake, and naming the mistake is more use than the
# generic "we do not recognise that link".
NOT_A_TOUR_PATH = re.compile(
    r"^(?:/[a-z]{2}(?:-[a-z]{2})?)?/(?P<kind>highlight|collection|guide)/\d+",
    re.I,
)

NOT_A_TOUR_DETAIL = {
    "highlight": (
        "that Komoot link is a highlight: a single place, not a route. Open it "
        "and paste the link of one of the tours that pass through it"
    ),
    "collection": (
        "that Komoot link is a collection: a list of tours, often the stages of "
        "one long route. Open one stage and paste its link"
    ),
    "guide": (
        "that Komoot link is a region guide, which lists many routes. Open one "
        "route and paste its link"
    ),
}


def tour_id(url: str) -> Optional[str]:
    """The numeric id, whichever shape the link came in."""
    link = _link(url)
    return link[1] if link else None


def fetch(url: str) -> Route:
    link = _link(url)
    if not link:
        kind, detail = _why_not_a_tour(url)
        raise SourceError("domain", detail, hint=kind)
    kind, identifier = link

    if kind == "smart_tour":
        payload, points = _smart_tour(identifier)
        page_url = f"https://www.komoot.com/smarttour/{identifier}"
        file_stem = f"komoot-smarttour-{identifier}"
    else:
        payload, points = _tour(identifier)
        page_url = f"https://www.komoot.com/tour/{identifier}"
        file_stem = f"komoot-{identifier}"

    if len(points) < 2:
        raise SourceError("track", "the tour carries no coordinates")

    published = Published(
        distance_m=_number(payload.get("distance")),
        # The two endpoints name the same figure differently: a tour publishes
        # `elevation_up`, a smart tour publishes `uphill`. Reading only the
        # first name loses the climb on every bare smart tour link, and the
        # comparison against our own measurement is the point of the report.
        ascent_m=_first(payload, "elevation_up", "uphill"),
        descent_m=_first(payload, "elevation_down", "downhill"),
        point_count=len(points),
    )

    return Route(
        source_id="komoot",
        source_label="Komoot",
        title=payload.get("name") or f"Komoot tour {identifier}",
        url=page_url,
        points=points,
        published=published,
        file_stem=file_stem,
    )


def _link(url: str) -> Optional[Tuple[str, str]]:
    """Returns `(kind, id)`, where kind is `tour` or `smart_tour`.

    The kind is the endpoint the id belongs to, not the word in the link: a
    `/smarttour/` id starting with `e` addresses a tour, and only a bare one
    addresses a smart tour.
    """
    found = ROUTE_PATH.match(_path(url))
    if not found:
        return None

    kind = found.group("kind").lower()
    identifier = found.group("id").lower()
    if kind == "smart_tours" or (kind == "smarttour" and not identifier.startswith("e")):
        return "smart_tour", identifier
    return "tour", identifier.removeprefix("e")


def _path(url: str) -> str:
    # A link copied from a phone often arrives with no scheme, and urlparse
    # would then read the host as the first segment of the path.
    if "//" not in url:
        url = f"//{url}"
    return urlparse(url).path


def _why_not_a_tour(url: str) -> Tuple[Optional[str], str]:
    """Returns `(hint, detail)`.

    The hint is a word the web page can translate. The detail is the same
    thing in English, for the log and for anything reading the API directly.
    """
    found = NOT_A_TOUR_PATH.match(_path(url))
    if found:
        kind = found.group("kind").lower()
        return kind, NOT_A_TOUR_DETAIL[kind]
    return None, "a Komoot link has to carry a tour id, as in /tour/123456"


def _tour(identifier: str) -> Tuple[dict, List[Tuple[float, float, Optional[float]]]]:
    payload = _answer(TOUR_URL.format(id=identifier))
    embedded = payload.get("_embedded") or {}
    coordinates = embedded.get("coordinates") or {}
    return payload, _points(coordinates.get("items"))


def _smart_tour(identifier: str) -> Tuple[dict, List[Tuple[float, float, Optional[float]]]]:
    payload = _answer(SMART_TOUR_URL.format(id=identifier))
    track = _answer(SMART_TOUR_TRACK_URL.format(id=identifier))
    return payload, _points(track.get("items"))


def _answer(url: str) -> Dict[str, Any]:
    status, payload = fetch_json(url)
    if status == 403:
        raise SourceError("private")
    if status in (404, 410):
        raise SourceError("notfound")
    if status != 200 or not isinstance(payload, dict):
        raise SourceError("network", f"Komoot answered {status}")
    return payload


def _points(items) -> List[Tuple[float, float, Optional[float]]]:
    return [
        (item["lat"], item["lng"], item.get("alt"))
        for item in (items or [])
        if "lat" in item and "lng" in item
    ]


def _first(payload: Dict[str, Any], *names: str) -> Optional[float]:
    """The first of these fields the payload actually carries.

    Tested against `None` rather than truthiness: a flat route publishes an
    ascent of 0.0, and that is an answer, not a missing field.
    """
    for name in names:
        value = _number(payload.get(name))
        if value is not None:
            return value
    return None


def _number(value) -> Optional[float]:
    return float(value) if isinstance(value, (int, float)) else None
