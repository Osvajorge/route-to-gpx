"""The link-fetching service.

A browser is not allowed to read another website directly, so this small
service does that one job: given a route link, it returns the track as GPX plus
whatever figures the source site publishes about it.

It does not measure anything. Measuring happens in the visitor's browser, from
the file itself, so the numbers on screen can always be checked against the file
that was downloaded.

Nothing is written to disk and nothing is kept between requests.
"""

import os
import re
import time
from collections import deque
from pathlib import Path
from typing import Deque, Dict
from urllib.parse import urlparse

from fastapi import APIRouter, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .core import gpx
from .http import BlockedHost
from .sources import Route, SourceError, komoot, wikiloc

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

# A courtesy limit, not a security boundary. It keeps one impatient visitor
# from becoming the reason the source sites start refusing this service.
RATE_WINDOW_SECONDS = 60
RATE_MAX_REQUESTS = 20
_recent: Dict[str, Deque[float]] = {}


class ConvertRequest(BaseModel):
    url: str


def adapter_for(url: str):
    host = (urlparse(url).hostname or "").lower()
    for pattern, function in ADAPTERS.items():
        if re.search(pattern, host):
            return function
    return None


def rate_limited(client: str) -> bool:
    now = time.monotonic()
    seen = _recent.setdefault(client, deque())
    while seen and now - seen[0] > RATE_WINDOW_SECONDS:
        seen.popleft()
    if len(seen) >= RATE_MAX_REQUESTS:
        return True
    seen.append(now)
    return False


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
    return {"ok": True}


@api.post("/convert")
def convert(body: ConvertRequest, request: Request):
    url = body.url.strip()
    if not url.startswith("http"):
        url = f"https://{url}"

    client = request.client.host if request.client else "unknown"
    if rate_limited(client):
        return JSONResponse(
            {"ok": False, "error": "network", "detail": "too many requests in a minute"},
            status_code=429,
        )

    fetch = adapter_for(url)
    if fetch is None:
        return JSONResponse({"ok": False, "error": "domain"}, status_code=400)

    try:
        route = fetch(url)
    except SourceError as error:
        status = 404 if error.code in ("notfound", "private") else 422
        return JSONResponse(
            {"ok": False, "error": error.code, "detail": error.detail}, status_code=status
        )
    except BlockedHost as error:
        return JSONResponse(
            {"ok": False, "error": "domain", "detail": str(error)}, status_code=400
        )

    return as_payload(route)


app.include_router(api)

# One process can serve both halves, which is all a small deployment needs.
# Point WEB_ROOT somewhere else, or leave the folder out, to run the service on
# its own behind a separate static host.
WEB_ROOT = Path(os.environ.get("WEB_ROOT", Path(__file__).resolve().parent.parent / "web"))
if WEB_ROOT.is_dir():
    app.mount("/", StaticFiles(directory=WEB_ROOT, html=True), name="web")
