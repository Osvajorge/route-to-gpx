"""The link-fetching service.

A browser is not allowed to read another website directly, so this small
service does that one job: given a route link, it returns the track as GPX plus
whatever figures the source site publishes about it.

Search and Nearby are two ways of arriving at such a link. They are not a
discovery product: they return URLs with the source's claims attached, and the
URL still has to go through `/api/convert` to become a track. The list is a
means, never the destination.

It does not measure anything. Measuring happens in the visitor's browser, from
the file itself, so the numbers on screen can always be checked against the file
that was downloaded.

Nothing is written to disk. One thing is kept between requests and it is worth
naming rather than glossing: a card's outline, once fetched, is held in memory
so the same card is not fetched twice (see `_shapes` below). It is a shape and
a URL, it is bounded, it never leaves this process, and dropping it would cost
a source site a second call for an answer it already gave. Everything else --
every route, every search, every place -- is worked out inside the request that
asked for it and then forgotten.
"""

import logging
import math
import os
import re
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse

from fastapi import APIRouter, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import http, limits
from .core import gpx
from .http import BlockedHost
from .sources import (
    shape as shapes,
    Route,
    SourceError,
    alltrails,
    komoot,
    komoot_discovery,
    merged,
    wikiloc,
    wikiloc_discovery,
)

app = FastAPI(title="route-to-gpx", docs_url=None, redoc_url=None)
api = APIRouter(prefix="/api")

# Everything this service sends is text, and none of it was compressed. A cold
# load of the page and its ten assets was 420,421 bytes off the wire and is now
# 134,630; one convert of a 12,000-point route was 864,643 bytes and is now
# 111,998. Both counted off the socket against a local uvicorn, not estimated.
#
# 1024 rather than Starlette's default of 500, because a kilobyte is where gzip
# starts paying for the bodies this service actually writes. Measured on the
# real ones: the liveness answer grows from 11 bytes to 31, the error envelope
# from 82 to 90, and the sports list goes 107 to 105, which is nothing for a
# compression pass on every request. The smallest answer worth packing is a
# card outline, 3,677 bytes to 838.
#
# Added before CORS on purpose. Starlette puts the middleware added last on the
# outside, so registering this one first leaves CORS where it already was,
# outermost, still able to put its header on a failure raised above this.
app.add_middleware(GZipMiddleware, minimum_size=1024)

# The web page can be served from anywhere, including a file:// copy during
# development, and the service holds no session and no secret.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["POST", "GET", "OPTIONS"],
    allow_headers=["Content-Type"],
)

ADAPTERS = {
    r"(^|\.)komoot\.[a-z.]+$": komoot.fetch,
    r"(^|\.)wikiloc\.[a-z.]+$": wikiloc.fetch,
    r"(^|\.)alltrails\.[a-z.]+$": alltrails.fetch,
}

# Which site answers a list. Komoot when nobody says, so every request written
# before Wikiloc existed still means what it meant.
#
# The two modules are not interchangeable and are not called through one
# signature: Komoot takes a sport and can be biased towards a point, Wikiloc
# takes an activity and works out a bounding box. Pretending otherwise would put
# a Komoot word in a Wikiloc request eventually. So the endpoints below choose in
# the open, in two lines each.
DISCOVERY = {
    merged.SOURCE_ID: merged,
    komoot_discovery.SOURCE_ID: komoot_discovery,
    wikiloc_discovery.SOURCE_ID: wikiloc_discovery,
}
# Both sites, because nobody looking for a route near a village cares which
# website holds it. Asking one at a time is a filing system leaking into a
# question. A visitor who wants one site can still choose it, and gets that
# site's whole vocabulary rather than the shorter shared one.
DEFAULT_SOURCE = merged.SOURCE_ID

# Which HTTP status each failure is. One table, so the three endpoints cannot
# drift apart in what a code means.
ERROR_STATUS = {
    "query": 400,
    "location": 400,
    "sport": 400,
    "source": 400,
    "domain": 400,
    "request": 400,
    "notfound": 404,
    "private": 404,
    "track": 422,
    "network": 422,
    "busy": 429,
}

# A cheap guard on requests that never reach a source site at all: malformed
# JSON, a blank query, an unknown sport. Those spend no upstream token, so the
# outbound budget in `api/http.py` never sees them, and without this one
# visitor could still spin this process for free.
INBOUND_MAX_REQUESTS = 20
INBOUND_WINDOW_SECONDS = 60
_inbound = limits.Buckets(
    INBOUND_MAX_REQUESTS, INBOUND_MAX_REQUESTS / INBOUND_WINDOW_SECONDS
)


class ConvertRequest(BaseModel):
    url: str


class ShapeRequest(BaseModel):
    url: str


class NearPoint(BaseModel):
    lat: Optional[float] = None
    lng: Optional[float] = None


class SearchRequest(BaseModel):
    """POST, not GET, and on purpose.

    It matches `/api/convert`, it keeps the visitor's words and their
    approximate position out of the access log and out of any intermediary
    cache, and nothing caches a POST, which is how "keeps nothing" stays true
    from end to end.

    Every field is permissive here and range-checked by hand further in. A
    pydantic failure leaves through FastAPI's own body shape, not this
    service's, and the page reading it would show a sentence about a route for
    what was really a malformed request.
    """

    # Which site to ask. Left out, it is Komoot.
    source: Optional[str] = None
    query: Optional[str] = None
    # The activity dropdown, whichever site it belongs to. One field, because a
    # page has one dropdown; the words in it come from `/api/sports` for the
    # source being asked, and the two vocabularies are never mixed.
    sport: Optional[str] = None
    # The place the caller already knows they meant, so nothing has to be
    # guessed from the words. The two sites do very different things with it,
    # and neither is a matter of opinion: a Wikiloc search IS a box, so the
    # point becomes that box; Komoot geocodes the words itself and takes the
    # point only as a nudge to the ranking. Both are written down beside the
    # code that acts on them, as `POINT_APPLIED` in each site's module, with
    # what was measured to establish it. An answer from both sites reports it
    # per site, on the `sources` rows, because it is not the same for both.
    near: Optional[NearPoint] = None
    limit: Optional[int] = None
    page: Optional[int] = None


class NearbyRequest(BaseModel):
    """POST for the same reasons, and one more: the body is where the visitor
    is. In a POST body it never reaches the access log, a referrer header or a
    proxy cache. In a query string it would reach all three."""

    source: Optional[str] = None
    lat: Optional[float] = None
    lng: Optional[float] = None
    sport: Optional[str] = None
    radiusM: Optional[int] = None
    limit: Optional[int] = None
    page: Optional[int] = None


def adapter_for(url: str):
    host = (urlparse(url).hostname or "").lower()
    for pattern, function in ADAPTERS.items():
        if re.search(pattern, host):
            return function
    return None


def discovery_for(source: Optional[str]):
    """Which module answers, checked before anything is spent on it."""
    if source is None or (isinstance(source, str) and not source.strip()):
        return DISCOVERY[DEFAULT_SOURCE]
    module = DISCOVERY.get(source.strip().lower()) if isinstance(source, str) else None
    if module is None:
        raise SourceError(
            "source", f"this service reads {' and '.join(DISCOVERY)}, and no other site"
        )
    return module


def client_key(request: Request) -> str:
    """Who to charge, and the only place that is decided.

    `X-Forwarded-For` is never read here, not even as a fallback. Any caller can
    send that header, so trusting it in this file would hand every visitor an
    unlimited share for the price of a random string, worse than the state
    where everyone behind a proxy shares one bucket.

    The trust decision belongs to the deployment instead: uvicorn rewrites this
    address from the forwarded header only when the immediate peer is listed in
    `--forwarded-allow-ips` (the FORWARDED_ALLOW_IPS environment variable). See
    the Dockerfile.
    """
    return request.client.host if request.client else "unknown"


def inbound_wait(client: str) -> float:
    """Seconds this client should wait. `0.0` means the request may proceed."""
    now = limits.now()
    with limits.LOCK:
        waiting = _inbound.wait(client, now)
        if waiting > 0:
            return waiting
        _inbound.spend(client, now)
        return 0.0


def error_response(
    code: str,
    hint: Optional[str] = None,
    detail: str = "",
    retry_after: Optional[int] = None,
) -> JSONResponse:
    """The one failure shape, for every endpoint.

    `detail` stays English and literal, for the log. It never interpolates the
    visitor's words or their coordinates: those pass through this service and
    are not written down anywhere, and a log line is somewhere.
    """
    headers = {"Retry-After": str(retry_after)} if retry_after is not None else None
    return JSONResponse(
        {"ok": False, "error": code, "hint": hint, "detail": detail},
        status_code=ERROR_STATUS.get(code, 422),
        headers=headers,
    )


def busy_response(waiting: float) -> JSONResponse:
    return error_response(
        "busy",
        hint="self",
        detail="too many requests in a minute",
        retry_after=max(1, math.ceil(waiting)),
    )


logger = logging.getLogger(__name__)


def source_failure(error: Exception) -> Optional[JSONResponse]:
    """Turns everything a source adapter can raise into the shared envelope."""
    if isinstance(error, http.BudgetExhausted):
        return error_response(
            "busy", hint=error.hint, detail=error.detail, retry_after=error.retry_after
        )
    if isinstance(error, http.OutsideRequest):
        # Not the visitor's problem: either an endpoint forgot to open a budget
        # or the fan-out ceiling was reached, and both are bugs in here.
        return error_response("network", detail=str(error))
    if isinstance(error, SourceError):
        return error_response(error.code, hint=error.hint, detail=error.detail)
    if isinstance(error, BlockedHost):
        return error_response("domain", detail=str(error))

    # Everything else. This used to return None, and the four callers then
    # re-raised, which FastAPI answers as a 500 in text/plain -- the one shape
    # `malformed_request` below says this service must never return, and one
    # the page cannot read, so a visitor met the last-resort message instead of
    # a true one.
    #
    # An adapter raising something unforeseen means the page it reads has
    # stopped parsing, which for the visitor is exactly "the track is not where
    # we expected", and that message already tells them to export the GPX and
    # drop it here. For the operator it is a bug, so it is logged with its
    # traceback rather than swallowed. Those are different audiences and they
    # get different things.
    logger.exception("an adapter raised %s", type(error).__name__)
    return error_response("track", detail=f"the source page could not be read ({type(error).__name__})")


@app.exception_handler(RequestValidationError)
def malformed_request(request: Request, error: RequestValidationError) -> JSONResponse:
    """A body of the wrong shape, answered in this service's own shape.

    Without this, FastAPI answers with `{"detail": [...]}`, the page finds no
    `error` key and falls back to its last resort, and a visitor who sent bad
    JSON is told the page no longer carries the track where we expected it.
    """
    return error_response("request", detail="the request body was not the shape this endpoint reads")


def as_payload(route: Route) -> dict:
    return {
        "ok": True,
        "source": {
            "id": route.source_id,
            "label": route.source_label,
            "title": route.title,
            "url": route.url,
            "routeType": route.route_type,
        },
        "published": route.published.as_dict(),
        "fileName": f"{route.file_stem}.gpx",
        "gpx": gpx.build(
            route.points,
            name=route.title,
            source_url=route.url,
            source_label=route.source_label,
        ),
    }


@api.get("/health")
def health():
    # Exempt from the inbound guard: it makes no upstream call, the platform
    # calls it on a schedule, and counting it would evict real entries and
    # eventually refuse the liveness probe itself.
    return {"ok": True}


@api.get("/sports")
def sports(request: Request, source: Optional[str] = None):
    """One source's vocabulary, so a word can be checked before a token is spent.

    Zero upstream calls, for either source. Both lists are written down in their
    own module, with the address they came from and how to refresh them.

    This is what fills the activity dropdown, and the dropdown changes with the
    source: Komoot says `hike` where Wikiloc says `hiking`, and Wikiloc has
    eighty activities Komoot has no word for at all. The two lists are never
    merged, because a merged list would offer a visitor words the site they are
    asking cannot answer.

    Wikiloc's answer carries one extra key, `activities`, which is the same list
    with a label and a group for each entry. Komoot's has no such key: this
    service does not know Komoot's display names, and inventing them is how a
    dropdown starts showing words nobody chose.
    """
    waiting = inbound_wait(client_key(request))
    if waiting:
        return busy_response(waiting)

    try:
        module = discovery_for(source)
    except SourceError as error:
        return error_response(error.code, hint=error.hint, detail=error.detail)

    if module is wikiloc_discovery:
        return {"ok": True, **wikiloc_discovery.vocabulary()}
    return {
        "ok": True,
        "sports": list(komoot_discovery.SPORTS),
        "default": komoot_discovery.DEFAULT_SPORT,
    }


@api.post("/convert")
def convert(body: ConvertRequest, request: Request):
    url = body.url.strip()
    if not url.startswith("http"):
        url = f"https://{url}"

    client = client_key(request)
    waiting = inbound_wait(client)
    if waiting:
        return busy_response(waiting)

    fetch = adapter_for(url)
    if fetch is None:
        return error_response("domain")

    try:
        with http.request_budget(client):
            route = fetch(url)
    except Exception as error:
        answer = source_failure(error)
        if answer is None:
            raise
        return answer

    return as_payload(route)


# One outline for one card, and the rules that let it exist.
#
# Komoot rows arrive with their geometry already, read out of the thumbnail
# URL, so nothing here serves them. This is for Wikiloc, whose search results
# carry no coordinates at all while its trail pages do.
#
# A trail page is 354 KB and does not honour a Range request, so a shape costs
# one full fetch. That is why the page asks for one card at a time, as the
# reader reaches it, and why this endpoint takes one URL rather than a list: a
# list is a sweep with extra steps, and nine shapes for a reader who will open
# one of them is crawling rather than answering.
#
# What goes back is an outline decimated to half a pixel at card size. It is
# enough to recognise a route and nowhere near enough to measure one, so
# converting the file stays the only way to get a figure.
_shapes = shapes.Shapes()


@api.post("/shape")
def shape(body: ShapeRequest, request: Request):
    url = body.url.strip()
    if not url.startswith("http"):
        url = f"https://{url}"

    client = client_key(request)
    waiting = inbound_wait(client)
    if waiting:
        return busy_response(waiting)

    # After the inbound token, not before it. A hit spends nothing upstream,
    # which was the old reason for looking first, but it does spend this
    # process: a body parsed, a lookup, and kilobytes of JSON written back. The
    # inbound bucket exists for exactly that kind of work, the kind no source
    # site ever sees. Answering above it left this one endpoint with no ceiling
    # at all, so a caller who knew a single cached URL could ask for it as fast
    # as the socket allowed while the other four endpoints stayed bounded.
    #
    # What the cache is for survives the move: a reader scrolling back up a
    # list still gets the outline without Wikiloc being asked a second time.
    # Twenty requests a minute is a reader, not a charge for looking twice.
    cached = _shapes.get(url)
    if cached is not None:
        return {"ok": True, "trace": cached}

    fetch = adapter_for(url)
    if fetch is None:
        return error_response("domain")

    try:
        with http.request_budget(client):
            route = fetch(url)
    except Exception as error:
        answer = source_failure(error)
        if answer is None:
            raise
        return answer

    trace = shapes.from_route(route)
    if len(trace) < 2:
        return error_response("track")

    _shapes.put(url, trace)
    return {"ok": True, "trace": trace}


@api.post("/search")
def search(body: SearchRequest, request: Request):
    client = client_key(request)
    waiting = inbound_wait(client)
    if waiting:
        return busy_response(waiting)

    near = (body.near.lat, body.near.lng) if body.near is not None else None
    try:
        module = discovery_for(body.source)
        # A listing may have to read several windows to fill one filtered page,
        # because one source will not filter for a caller without an account and
        # the other accepts the parameter and ignores it. A conversion still gets
        # the plain two: it asks for one route and knows where it lives.
        with http.request_budget(client, calls=http.FILTER_FAN_OUT):
            if module is merged:
                listing = merged.search(
                    query=body.query,
                    activity=body.sport,
                    limit=body.limit,
                    page=body.page,
                    near=near,
                )
            elif module is wikiloc_discovery:
                listing = wikiloc_discovery.search(
                    query=body.query,
                    activity=body.sport,
                    limit=body.limit,
                    page=body.page,
                    # Passed on, because Wikiloc is the site the point works on:
                    # its search is a box and the point becomes that box.
                    # Dropping it here spent the visitor's pick and then let the
                    # geocoder choose the place anyway, which the page could
                    # only read as Wikiloc refusing to be pointed. It was this
                    # endpoint refusing, and blaming a source site for our own
                    # doing is the worst version of getting this wrong.
                    near=near,
                )
            else:
                listing = komoot_discovery.search(
                    query=body.query,
                    sport=body.sport,
                    near=near,
                    limit=body.limit,
                    page=body.page,
                )
    except Exception as error:
        answer = source_failure(error)
        if answer is None:
            raise
        return answer

    # An empty list is a successful answer, so it leaves here as one. The page
    # owns the sentence about nothing matching.
    return {"ok": True, **listing.as_dict()}


@api.post("/nearby")
def nearby(body: NearbyRequest, request: Request):
    client = client_key(request)
    waiting = inbound_wait(client)
    if waiting:
        return busy_response(waiting)

    try:
        module = discovery_for(body.source)
        with http.request_budget(client, calls=http.FILTER_FAN_OUT):
            if module is merged:
                listing = merged.nearby(
                    lat=body.lat,
                    lng=body.lng,
                    activity=body.sport,
                    radius_m=body.radiusM,
                    limit=body.limit,
                    page=body.page,
                )
            elif module is wikiloc_discovery:
                listing = wikiloc_discovery.nearby(
                    lat=body.lat,
                    lng=body.lng,
                    activity=body.sport,
                    radius_m=body.radiusM,
                    limit=body.limit,
                    page=body.page,
                )
            else:
                listing = komoot_discovery.nearby(
                    lat=body.lat,
                    lng=body.lng,
                    sport=body.sport,
                    radius_m=body.radiusM,
                    limit=body.limit,
                    page=body.page,
                )
    except Exception as error:
        answer = source_failure(error)
        if answer is None:
            raise
        return answer

    return {"ok": True, **listing.as_dict()}


app.include_router(api)

# One process can serve both halves, which is all a small deployment needs.
# Point WEB_ROOT somewhere else, or leave the folder out, to run the service on
# its own behind a separate static host.
WEB_ROOT = Path(os.environ.get("WEB_ROOT", Path(__file__).resolve().parent.parent / "web"))


class RevalidatedFiles(StaticFiles):
    """Static files a browser must ask about before reusing.

    The mount sent an ETag and a Last-Modified and no Cache-Control at all,
    which does not mean "do not cache": with no freshness given, a browser
    invents one from the age of the file. So it holds a module and serves it
    back without asking, and a page ends up running yesterday's JavaScript
    against today's API.

    Found the slow way, twice: an edit to app.css and later one to app.js were
    both live on the server, correct on disk, and invisible in the browser,
    which reads as a code bug for as long as it takes to check the network
    panel. A visitor gets the same thing after a deploy, without the network
    panel and without knowing to look.

    `no-cache` is revalidate, not refuse. The ETag above still answers 304 for
    a file that has not changed, so nothing is re-downloaded needlessly; the
    browser simply never decides on its own that stale is good enough. There is
    no build step here and no hashed filenames to make staleness impossible, so
    asking is the honest way to be current.
    """

    def is_not_modified(self, response_headers, request_headers) -> bool:
        return super().is_not_modified(response_headers, request_headers)

    async def get_response(self, path: str, scope):
        response = await super().get_response(path, scope)
        response.headers.setdefault("Cache-Control", "no-cache")
        return response


if WEB_ROOT.is_dir():
    app.mount("/", RevalidatedFiles(directory=WEB_ROOT, html=True), name="web")
