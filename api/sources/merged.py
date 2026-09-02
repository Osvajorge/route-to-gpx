"""Both sites at once, which is what a walker actually wants.

Nobody looking for a route near a village cares which website holds it. Asking
one at a time is a filing system leaking into a question, so the default is to
ask both and hand back one list.

Three rules hold here, and they are the reason this file is small.

WE DO NOT RANK. Rows are interleaved, one from each site in turn, in the order
each site returned them. That is a fair merge, not a judgement: the moment this
file starts scoring rows, the product has quietly become a search engine, and
it has no business being one.

WE DO NOT INVENT A SHARED VOCABULARY. The two sites name activities
differently, so the mapping below is written out, one line per activity, with
the word each site actually uses. Only activities that genuinely exist on both
are offered. An activity we cannot map on both sides is not in the list.

ONE ANSWER, TWO CHANCES TO FAIL. If one site is down, or refuses, or times out,
its half is missing and the answer says which one and why. A whole page of
nothing because one server had a bad minute would be worse than half a page.
"""

from typing import Any, Dict, List, Optional, Tuple

from . import SourceError
from ..http import BlockedHost
from .discovery import Listing, Row
from . import komoot_discovery, wikiloc_discovery

SOURCE_ID = "all"
SOURCE_LABEL = "Komoot and Wikiloc"

# Our word, then the word each site uses for the same thing. Read as a table,
# because that is what it is, and because the next person to add a row needs to
# see both columns to know whether they can.
#
# `running` is the one judgement call. Komoot has a single `jogging` covering
# road and trail, while Wikiloc separates them. This is a tool for mountains,
# so it maps to Wikiloc's trail running rather than its road running, and this
# comment is here so the choice is visible instead of buried.
ACTIVITIES: Tuple[Tuple[str, str, str], ...] = (
    ("hiking", "hike", "hiking"),
    ("running", "jogging", "trail-running"),
    ("mountain-bike", "mtb", "mountain-bike"),
    ("road-cycling", "racebike", "road-bike"),
    ("bike-touring", "touringbicycle", "bicycle-touring"),
    ("mountaineering", "mountaineering", "alpine-climbing"),
)

DEFAULT_ACTIVITY = "all"
KOMOOT_WORD = {ours: theirs for ours, theirs, _ in ACTIVITIES}
WIKILOC_WORD = {ours: theirs for ours, _, theirs in ACTIVITIES}

# Either site's own word is accepted for the activity it names. Refusing `hike`
# because this list happens to spell it `hiking` would be pedantry: one of the
# two sites being asked calls it exactly that. It also keeps a page written
# against a single source working when the source picker moves to both.
ALIASES: Dict[str, str] = {ours: ours for ours, _, _ in ACTIVITIES}
for _ours, _komoot, _wikiloc in ACTIVITIES:
    ALIASES.setdefault(_komoot, _ours)
    ALIASES.setdefault(_wikiloc, _ours)

# How many upstream windows each side may read when both are asked. The ceiling
# for one request is http.FILTER_FAN_OUT, and the two sides have to share it:
# Komoot answers a filtered question in one call because its own filter works,
# and Wikiloc needs a window per scan because its does not. Nearby therefore
# leaves Wikiloc four; search leaves it three, because the place has to be
# geocoded first and that is a call too.
NEARBY_WINDOWS = 4
SEARCH_WINDOWS = 3


def vocabulary() -> Dict[str, Any]:
    """What the activity picker holds when both sites are being asked.

    Shorter than either site's own list, and that is the honest shape of it:
    these are the activities we can ask both sites for and get the same thing
    back. Zero upstream calls.
    """
    return {
        "sports": [DEFAULT_ACTIVITY] + [ours for ours, _, _ in ACTIVITIES],
        "default": DEFAULT_ACTIVITY,
        "activities": [
            {"id": ours, "komoot": komoot, "wikiloc": wikiloc}
            for ours, komoot, wikiloc in ACTIVITIES
        ],
    }


def _activity(value: Optional[str], required: bool = False) -> str:
    """Checked here, before a token is spent, and named in the refusal.

    `required` is for Nearby. Komoot's own endpoint for routes around a point
    will not answer without a sport, so "any activity" is a question it cannot
    be asked. Rather than quietly sending it hiking and handing back a list the
    visitor did not ask for, the choice is required and the reason is said.
    """
    if value is None or (isinstance(value, str) and not value.strip()):
        if required:
            raise SourceError(
                "sport",
                "Komoot cannot list routes around a point without an activity, "
                "so this needs one. " + _named(),
            )
        return DEFAULT_ACTIVITY
    given = value.strip().lower() if isinstance(value, str) else ""
    chosen = ALIASES.get(given, given)
    if chosen == DEFAULT_ACTIVITY or chosen in KOMOOT_WORD:
        return chosen
    if required and chosen == DEFAULT_ACTIVITY:
        raise SourceError(
            "sport",
            "Komoot cannot list routes around a point without an activity, so "
            "this needs one. " + _named(),
        )
    raise SourceError("sport", _named())


def _named() -> str:
    activities = ", ".join([DEFAULT_ACTIVITY] + list(KOMOOT_WORD))
    return (
        f"With both sites selected the activities are {activities}. Choose one "
        f"site on its own to reach the rest of what it holds"
    )


# A failure that is about the QUESTION, not about the site. These must reach
# the visitor as a refusal even when the other site answered happily: a
# mistyped latitude that comes back as six routes from somewhere else is worse
# than an error, because it looks like it worked.
ABOUT_THE_REQUEST = frozenset({"location", "sport", "query", "domain", "source"})


def _ask(call, **kwargs) -> Tuple[Optional[Listing], Optional[str]]:
    """One site's half. A site failing is reported; a bad question is raised.

    A walker would rather see six routes and a line saying Wikiloc did not
    answer than see nothing at all. That is only true when the six routes are
    an answer to what they asked.
    """
    try:
        return call(**kwargs), None
    except SourceError as error:
        if error.code in ABOUT_THE_REQUEST:
            raise
        return None, error.code
    except BlockedHost:
        # The allowlist refusing a URL is this service's own doing, not a site
        # being unavailable, but there is nothing a visitor can do about it and
        # the other half is still worth showing.
        return None, "network"

    # Everything else is left to raise ON PURPOSE. An earlier draft caught bare
    # Exception here, and a TypeError from a keyword this module passed to a
    # function that did not take it was reported to visitors as "Wikiloc did
    # not answer" for as long as it took to run it by hand. A fault in this
    # code should be loud and ours, not quiet and blamed on a source site.


def _interleave(halves: List[List[Row]], size: int) -> List[Row]:
    """One from each, in turn, until the page is full.

    Not a ranking. If one side runs out the other simply continues, which fills
    the page rather than leaving a gap for the sake of symmetry.
    """
    merged: List[Row] = []
    index = 0
    while len(merged) < size and any(index < len(half) for half in halves):
        for half in halves:
            if index < len(half) and len(merged) < size:
                merged.append(half[index])
        index += 1
    return merged


def _combine(
    parts: List[Tuple[str, Optional[Listing], Optional[str]]],
    echo: Dict[str, Any],
    size: int,
) -> Listing:
    listings = [(name, got) for name, got, _ in parts if got is not None]
    if not listings:
        # Both failed. The first reason is as good as the second, and raising
        # here keeps the endpoint's own error handling in one place.
        raise SourceError(parts[0][2] or "network", "neither site answered")

    rows = _interleave([got.rows for _, got in listings], size)
    examined = sum(got.examined or 0 for _, got in listings) or None
    aside: Dict[str, int] = {}
    for _, got in listings:
        for reason, count in (got.set_aside or {}).items():
            aside[reason] = aside.get(reason, 0) + count

    return Listing(
        source_id=SOURCE_ID,
        source_label=SOURCE_LABEL,
        echo=echo,
        rows=rows,
        places=None,
        has_more=any(got.has_more for _, got in listings),
        # Two sites counting their own boxes cannot be added into one number
        # that means anything, so no total is offered rather than a made up one.
        total_known=None,
        dropped=sum(got.dropped for _, got in listings),
        set_aside=aside or None,
        examined=examined,
        # Which sites are in this answer, and which are missing and why. The
        # page needs it: a short list because one site is down reads exactly
        # like a short list because a valley is empty, and they are not the
        # same thing.
        sources=[
            {"id": name, "ok": got is not None, "error": reason}
            for name, got, reason in parts
        ],
    )


def nearby(
    lat: Any,
    lng: Any,
    activity: Optional[str] = None,
    radius_m: Optional[Any] = None,
    limit: Optional[Any] = None,
    page: Optional[Any] = None,
) -> Listing:
    chosen = _activity(activity, required=True)
    size = komoot_discovery._clamp(limit, 1, 12, 6)
    # Each side is asked for enough that an interleave can fill the page even
    # when one of them comes back thin.
    half = max(1, (size + 1) // 2)

    komoot_got, komoot_bad = _ask(
        komoot_discovery.nearby,
        lat=lat,
        lng=lng,
        sport=KOMOOT_WORD[chosen],
        radius_m=radius_m,
        limit=half,
        page=page,
    )
    wikiloc_got, wikiloc_bad = _ask(
        wikiloc_discovery.nearby,
        lat=lat,
        lng=lng,
        activity=WIKILOC_WORD[chosen],
        radius_m=radius_m,
        limit=half,
        page=page,
        windows=NEARBY_WINDOWS,
    )

    echo = {
        "lat": lat,
        "lng": lng,
        "sport": chosen,
        "radiusM": radius_m,
        "limit": size,
        "page": page or 0,
    }
    for _, got in (("komoot", komoot_got), ("wikiloc", wikiloc_got)):
        if got is not None:
            echo["lat"] = got.echo.get("lat", echo["lat"])
            echo["lng"] = got.echo.get("lng", echo["lng"])
            echo["radiusM"] = got.echo.get("radiusM", echo["radiusM"])
            echo["page"] = got.echo.get("page", echo["page"])
            break

    return _combine(
        [("komoot", komoot_got, komoot_bad), ("wikiloc", wikiloc_got, wikiloc_bad)],
        echo,
        size,
    )


def search(
    query: Optional[str] = None,
    activity: Optional[str] = None,
    limit: Optional[Any] = None,
    page: Optional[Any] = None,
    near: Optional[Tuple[Any, Any]] = None,
) -> Listing:
    chosen = _activity(activity)
    size = komoot_discovery._clamp(limit, 1, 25, 9)
    half = max(1, (size + 1) // 2)
    # Komoot spends one page on places AND tours together, so asking it for
    # three routes returns three place names and no route at all. Measured:
    # limit 3 gives 0 tours, limit 5 gives 2, limit 12 gives 3. So it is asked
    # for a page big enough to contain some, and the extra is discarded by the
    # interleave rather than shown.
    komoot_half = max(half, 12)

    komoot_got, komoot_bad = _ask(
        komoot_discovery.search,
        query=query,
        sport=KOMOOT_WORD.get(chosen) if chosen != DEFAULT_ACTIVITY else None,
        limit=komoot_half,
        page=page,
        near=near,
    )
    wikiloc_got, wikiloc_bad = _ask(
        wikiloc_discovery.search,
        query=query,
        activity=WIKILOC_WORD.get(chosen, DEFAULT_ACTIVITY)
        if chosen != DEFAULT_ACTIVITY
        else DEFAULT_ACTIVITY,
        limit=half,
        page=page,
        windows=SEARCH_WINDOWS,
        # The same point Komoot was biased towards, so both sites answer about
        # the same place. Without it Wikiloc geocodes the words on its own and
        # the two halves can be 300 km apart: `montserrat` gives Komoot the
        # mountain in Catalonia and the geocoder a village in Valencia, and one
        # interleaved list would show both with nothing saying so.
        near=near,
    )

    echo = {
        "query": (query or "").strip(),
        "sport": chosen,
        "limit": size,
        "page": page or 0,
    }
    listing = _combine(
        [("komoot", komoot_got, komoot_bad), ("wikiloc", wikiloc_got, wikiloc_bad)],
        echo,
        size,
    )
    # Which place each half is about. Only Wikiloc has to resolve one, so this
    # is what lets a page say "Wikiloc looked near Montserrat, Valencia" and
    # offer the others, instead of quietly mixing two valleys into one list.
    if wikiloc_got is not None and wikiloc_got.echo.get("place"):
        listing.echo["placeUsed"] = wikiloc_got.echo["place"]
    # Only Komoot geocodes as a side effect of searching, so its places are the
    # ones there are. Wikiloc's came from Photon and are the same places.
    for got in (komoot_got, wikiloc_got):
        if got is not None and got.places:
            listing.places = got.places
            listing.attribution = got.attribution
            break
    return listing
