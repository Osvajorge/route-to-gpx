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

Nothing is written to disk and nothing is kept between requests. There is no
cache of any kind: every answer is worked out inside the request that asked for
it and then forgotten.
"""

import math
import os
import re
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse

from fastapi import APIRouter, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import http, limits
from .core import gpx
from .http import BlockedHost
from .sources import Route, SourceError, komoot, komoot_discovery, wikiloc

app = FastAPI(title="route-to-gpx", docs_url=None, redoc_url=None)
api = APIRouter(prefix="/api")

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
}

# Which HTTP status each failure is. One table, so the three endpoints cannot
# drift apart in what a code means.
ERROR_STATUS = {
    "query": 400,
    "location": 400,
    "sport": 400,
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


class NearPoint(BaseModel):
    lat: Optional[float] = None
    lng: Optional[float] = None


class SearchRequest(BaseModel):
    """POST, not GET, and on purpose.

    It matches `/api/convert`, it keeps the visitor's words and their
    approximate position out of the access log and out of any intermediary
    cache, and nothing caches a POST — which is how "keeps nothing" stays true
    from end to end.

    Every field is permissive here and range-checked by hand further in. A
    pydantic failure leaves through FastAPI's own body shape, not this
    service's, and the page reading it would show a sentence about a route for
    what was really a malformed request.
    """

    query: Optional[str] = None
    sport: Optional[str] = None
    near: Optional[NearPoint] = None
    limit: Optional[int] = None
    page: Optional[int] = None


class NearbyRequest(BaseModel):
    """POST for the same reasons, and one more: the body is where the visitor
    is. In a POST body it never reaches the access log, a referrer header or a
    proxy cache. In a query string it would reach all three."""

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


def client_key(request: Request) -> str:
    """Who to charge, and the only place that is decided.

    `X-Forwarded-For` is never read here, not even as a fallback. Any caller can
    send that header, so trusting it in this file would hand every visitor an
    unlimited share for the price of a random string — worse than the state
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
    return None


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
def sports(request: Request):
    """Komoot's vocabulary, so a sport can be checked before a token is spent.

    Zero upstream calls. The list is written down in `komoot_discovery`, with
    the address it came from and how to refresh it.
    """
    waiting = inbound_wait(client_key(request))
    if waiting:
        return busy_response(waiting)
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


@api.post("/search")
def search(body: SearchRequest, request: Request):
    client = client_key(request)
    waiting = inbound_wait(client)
    if waiting:
        return busy_response(waiting)

    near = (body.near.lat, body.near.lng) if body.near is not None else None
    try:
        with http.request_budget(client):
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
        with http.request_budget(client):
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
if WEB_ROOT.is_dir():
    app.mount("/", StaticFiles(directory=WEB_ROOT, html=True), name="web")
