"""One route's outline, small enough to draw on a card.

WHY THIS EXISTS. A Komoot search row carries its own geometry for free: the
thumbnail URL is a drawing request and the shape is encoded into its path, so
`polyline.py` reads it and a Komoot card costs no extra request at all. A
Wikiloc search row carries no geometry of any kind. Measured on the raw
payload, the fields are author, distance, id, lat, lon, name, near, numRatings,
picto, rating, skill, slope, thumbs, trailrank and a few more; not one
coordinate list. What it does carry is `thumbs`, which are photographs.

So one grid held Komoot cards with a drawn route and Wikiloc cards with a hole
where one would go. The shape is not missing from Wikiloc, only from its search
results: a trail page carries it as base64 TWKB, which `wikiloc.py` already
reads to convert a route. This module goes and gets that, for one route, when
somebody is looking at it.

WHAT IT COSTS, measured rather than assumed. A Wikiloc trail page answers 200
in about 0.24 s and weighs 354 KB, and the geometry sits 79% of the way into
the document. The server does not honour a Range request: it answers 200 with
the whole body, so there is no partial fetch and the cost is the full 354 KB
every time.

THAT COST IS WHY NOTHING HERE MAY RUN AHEAD OF THE READER. Nine cards fetched
eagerly would be 3.2 MB and nine hits on one site for a reader who will open at
most one of them, and a service that does that is crawling rather than
answering. A shape is fetched because somebody reached that card. There is no
pre-warming here, no background pass and no prefetch of the next page, and the
cache below exists to make a second look free rather than to fill itself in
advance.

A SHAPE IS NOT A MEASUREMENT. What leaves here is an outline decimated until it
is half a pixel from the truth at card size: enough to recognise a route,
nowhere near enough to measure one. Converting the file stays the only way to
get a number, which is the whole point of the product.
"""

import math
from typing import Dict, List, Optional, Sequence, Tuple

from . import Route

# The card draws into this many pixels across. cards.js calls the same number
# CARD_TRACE_W, and the two have to agree: the tolerance below is derived from
# it, so a card drawn wider than this would show the simplification.
CARD_WIDTH_PX = 320

# Half a pixel. Below this the decimation is invisible at card size, and above
# it corners start to cut. Measured on a 1382-point route in a 2952 x 915 m
# box, where one card pixel is 9.8 m on the ground:
#     tolerance  2 m (0.20 px)  341 points
#     tolerance  5 m (0.51 px)  166 points
#     tolerance 10 m (1.02 px)   81 points   corners visibly cut
# Half a pixel keeps about 170 points, which is the same order as the hundred
# Komoot already simplifies its own thumbnails to, so both sources reach a card
# at a comparable density and one does not look coarser than the other.
PIXEL_FRACTION = 0.5

# A backstop, not a working limit: the tolerance above decides the count. This
# only bounds what a pathological route could send.
MAX_POINTS = 400

# Enough to cover a page of results and the reader going back to an earlier
# one, and small enough that the decoded outlines cannot grow into a memory
# problem. A shape is a few thousand bytes, so this is a couple of megabytes at
# worst.
CACHE_KEEP_AT_MOST = 200

# Sweep this many writes apart rather than on a timer. Same reasoning as
# limits.Buckets: a timer is work this service would do when nobody asked it
# to, which is the one thing it has promised not to do.
CACHE_SWEEP_EVERY = 50


def _metres(points: Sequence[Tuple[float, float]]) -> List[Tuple[float, float]]:
    """Latitude and longitude to metres on a plane, near the route.

    A local plane rather than a projection, because the only thing measured
    here is how far a point sits from a straight line between its neighbours,
    over a few kilometres at most. Longitude is scaled by the cosine of the
    route's own latitude, so east and west are not stretched.
    """
    latitude, longitude = points[0]
    per_degree = 111320.0
    per_degree_east = per_degree * math.cos(math.radians(latitude))
    return [
        ((point[1] - longitude) * per_degree_east, (point[0] - latitude) * per_degree)
        for point in points
    ]


def _span(plane: Sequence[Tuple[float, float]]) -> float:
    """The longer side of the route's bounding box, in metres."""
    xs = [point[0] for point in plane]
    ys = [point[1] for point in plane]
    return max(max(xs) - min(xs), max(ys) - min(ys))


def _distance_to_segment(
    point: Tuple[float, float],
    start: Tuple[float, float],
    end: Tuple[float, float],
) -> float:
    dx = end[0] - start[0]
    dy = end[1] - start[1]
    if dx == 0 and dy == 0:
        return math.hypot(point[0] - start[0], point[1] - start[1])
    along = ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / (dx * dx + dy * dy)
    along = max(0.0, min(1.0, along))
    return math.hypot(point[0] - start[0] - along * dx, point[1] - start[1] - along * dy)


def simplify(plane: Sequence[Tuple[float, float]], tolerance: float) -> List[int]:
    """Ramer-Douglas-Peucker, returning the indices it keeps.

    Indices rather than points, so the caller can keep the original
    coordinates and this never has to round anything.

    Every-nth decimation would be simpler and wrong: it throws away corners,
    which are the only part of an outline a reader recognises. This keeps the
    point furthest from the straight line and recurses, so a hairpin survives
    and a long straight collapses to its two ends.

    Iterative, with an explicit stack, because the recursive form is O(n) deep
    on a track that is already nearly a straight line, and a 30,000 point
    recording would reach Python's limit.
    """
    if len(plane) < 3:
        return list(range(len(plane)))

    keep = [False] * len(plane)
    keep[0] = True
    keep[-1] = True

    stack = [(0, len(plane) - 1)]
    while stack:
        first, last = stack.pop()
        if last <= first + 1:
            continue
        furthest = 0.0
        at = first
        for index in range(first + 1, last):
            away = _distance_to_segment(plane[index], plane[first], plane[last])
            if away > furthest:
                furthest = away
                at = index
        if furthest > tolerance:
            keep[at] = True
            stack.append((first, at))
            stack.append((at, last))

    return [index for index, kept in enumerate(keep) if kept]


def for_card(
    points: Sequence[Tuple[float, float]],
    width_px: int = CARD_WIDTH_PX,
) -> List[List[float]]:
    """A route's outline, decimated to half a pixel at card size.

    The tolerance is derived from the route rather than fixed, because a 2 km
    stroll and a 140 km ride are drawn into the same box: a metre tolerance
    that is invisible on the ride would flatten the stroll.
    """
    if len(points) < 2:
        return [[point[0], point[1]] for point in points]

    plane = _metres(points)
    metres_per_pixel = _span(plane) / max(1, width_px)
    tolerance = metres_per_pixel * PIXEL_FRACTION

    kept = simplify(plane, tolerance)

    # The backstop. Raising the tolerance until the count fits keeps the
    # corners the simplification already chose, where dropping every other
    # point would cut them.
    while len(kept) > MAX_POINTS:
        tolerance *= 1.6
        kept = simplify(plane, tolerance)

    return [[points[index][0], points[index][1]] for index in kept]


class Shapes:
    """Outlines already fetched, so a second look costs nothing.

    Keyed on the route URL. Holds the decoded outline, a few thousand bytes,
    and never the 354 KB page it came from.

    Eviction happens while writing, the way limits.Buckets does it, and for the
    same reason: sweeping on a timer would be work nobody asked for. Dropping
    an entry only ever means fetching a shape again, so a loss here costs a
    request and never correctness.
    """

    def __init__(
        self,
        keep_at_most: int = CACHE_KEEP_AT_MOST,
        sweep_every: int = CACHE_SWEEP_EVERY,
    ) -> None:
        self.keep_at_most = keep_at_most
        self.sweep_every = sweep_every
        self._shapes: Dict[str, List[List[float]]] = {}
        self._order: List[str] = []
        self._since_sweep = 0

    def get(self, url: str) -> Optional[List[List[float]]]:
        return self._shapes.get(url)

    def put(self, url: str, trace: List[List[float]]) -> None:
        if url not in self._shapes:
            self._order.append(url)
        self._shapes[url] = trace
        self._since_sweep += 1

        # The same slack limits.Buckets gives itself: without it the hard cap
        # forces a sweep on every write once the table is full, which is the
        # opposite of amortised.
        over = len(self._shapes) > self.keep_at_most + self.sweep_every
        if self._since_sweep >= self.sweep_every or over:
            self._evict()

    def _evict(self) -> None:
        self._since_sweep = 0
        while len(self._order) > self.keep_at_most:
            oldest = self._order.pop(0)
            self._shapes.pop(oldest, None)

    def __len__(self) -> int:
        return len(self._shapes)


def from_route(route: Route) -> List[List[float]]:
    """The outline of a route an adapter has already fetched."""
    return for_card([(latitude, longitude) for latitude, longitude, _ in route.points])
