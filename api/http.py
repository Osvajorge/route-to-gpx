"""The only place this service talks to the outside world.

Four rules hold here, and nowhere else has to think about them:

1. We fetch a fixed list of hosts. The URL comes from a stranger on the
   internet, so an allowlist is the difference between a converter and an open
   proxy into whatever network this runs on.
2. We stop reading at a size limit. A page that never ends must not become this
   service never answering.
3. Nothing is fetched unless an inbound request is paying for it. Komoot's
   robots.txt disallows /api for crawlers, Photon's disallows everything, and
   Wikiloc's names crawlers one at a time. All three forbid anything that walks
   a site on its own. A call with no request context is refused outright, so
   that promise is code rather than a comment.
4. Every call spends from two budgets, and they do different jobs.

   The per-site bucket is SAFETY. It is what protects the source sites, and
   with them this service's ability to keep reading them at all.

   The per-client bucket is FAIRNESS. It stops one visitor drinking the shared
   bucket. Everything else follows from that split: per-client state can be
   thrown away under memory pressure, and a misconfigured deployment can even
   let a client key be forged, and neither is a safety failure: forging or
   losing a client key can only empty the shared bucket faster, never spend
   past it.

WORKER COUNT IS LOAD-BEARING. These budgets live in the process. The Dockerfile
starts one worker, so the numbers below are the numbers. Run N workers and the
site budget is multiplied by N, and has to be divided here by hand.
"""

import contextvars
import json
import logging
import math
import re
from contextlib import contextmanager
from typing import Any, Iterator, List, Optional, Tuple
from urllib.parse import unquote, urljoin, urlparse

from curl_cffi import requests

from . import limits

# The operator's only window into the one module that leaves this process.
# Level and handlers stay the deployment's business: `getLogger` configures
# nothing, so importing this file cannot change how anybody else logs.
#
# WHAT MAY BE WRITTEN DOWN. The page tells visitors their links are fetched,
# parsed and discarded, and that nothing is written down. A log line is
# written down, so the link never goes in one, and neither do the words they
# searched for or the coordinates they stood on. What goes in is the service's
# own state -- which site, which status, which refusal, how much budget was
# left -- which is the operator's, not the visitor's.
logger = logging.getLogger(__name__)

# A browser handshake, not a browser. Wikiloc answers a default client with 403
# and a browser with 200, and the difference is the TLS fingerprint.
IMPERSONATE = "chrome"

TIMEOUT_SECONDS = 20
MAX_BYTES = 8 * 1024 * 1024

# The TLDs are written out one at a time, and that is the point of this
# pattern rather than an accident of it. It used to end each branch with
# `komoot\.[a-z.]+$`, and `[a-z.]+` matches dots, so the tail was unbounded:
# `wikiloc.com.attacker.example` matched, and /api/convert fetched whatever
# that name resolved to, from this deployment's address. An allowlist whose
# last label is a wildcard is not an allowlist.
#
# `discovery.py`'s THUMBNAIL_HOST had this right the whole time. This is now
# the same shape, and a test table holds both halves in place.
ALLOWED_HOST = re.compile(
    r"^(?:[a-z0-9-]+\.)*"
    r"(?:komoot\.(?:com|de|es|fr|it|nl|pl|io|net)"
    r"|wikiloc\.(?:com|es)"
    r"|loc\.wiki"
    r"|alltrails\.com)$",
    re.I,
)

# Only the default port. A name on the allowlist pointed at :9999 is a
# different service, and reaching one is the probe an open proxy is used for.
ALLOWED_PORT = 443

# The place search for Wikiloc, and the third host this service reads. It is
# already inside the pattern above -- subdomain "photon", domain "komoot.io" --
# so nothing was added to it, but it is named here because a reader looking for
# the geocoder in the allowlist has to find it, and because narrowing the komoot
# branch later would take this with it. A test holds both halves of that.
GEOCODER_HOST = "photon.komoot.io"

# Which budget a host spends from. Keyed on the site, not the hostname: komoot
# answers on www.komoot.com, www.komoot.de and api.komoot.de, and giving each
# its own bucket would multiply the budget for free.
# This must never be looser than ALLOWED_HOST. It was: it had the same
# unbounded `[a-z.]+` tail and no left boundary, so `notkomoot.com` and
# `wikiloc.com.attacker.example` both named Wikiloc's bucket. A host that is
# refused upstream would then still have been charged to a real site, which
# is how one attacker empties the allowance every visitor shares.
SITE = re.compile(r"(?:^|\.)(komoot|wikiloc|alltrails)\.[a-z]{2,}$", re.I)

# One hostname that is its own site. Photon runs on a komoot domain but it is
# not the Komoot the route pages come from: it is a free geocoder whose
# operators ask callers to keep their volume reasonable. Left to the pattern
# above it would spend Komoot's budget, so a Wikiloc search would eat into the
# allowance for Komoot routes and neither limit would mean what it says.
# loc.wiki is Wikiloc's own link shortener -- registered to Wikiloc Outdoor,
# and every /t/<id> on it redirects into wikiloc.com. It is the ONLY shape a
# route shared from the Wikiloc phone app has, so refusing it refused the
# commonest way anyone arrives here from a phone. It spends Wikiloc's bucket
# because it IS Wikiloc: a second bucket would double the budget for free,
# which is the same mistake the pattern above exists to prevent.
SITE_BY_HOST = {GEOCODER_HOST: "photon", "loc.wiki": "wikiloc"}
GEOCODER_SITE = "photon"

# 60 upstream calls a minute, bursting 30. One person using the web page
# deliberately spends well under ten a minute, since every one of them needs a
# typed query or a click, so this carries roughly six people at full tilt and
# still sits far below anything a source site notices beside its own traffic.
SITE_CAPACITY = 30
SITE_REFILL_PER_SECOND = 1.0

# 20 upstream calls a minute per visitor, bursting 20.
#
# These numbers were 8 and one per six seconds, which was right while a question
# cost one call. Filtering made a listing cost up to FILTER_FAN_OUT, so the old
# burst was two filtered searches and then a wait: changing the activity in a
# dropdown twice was enough to be refused, which is not a limit, it is a broken
# control.
#
# Fairness is still charged per outbound call, not per question, because a
# visitor whose question costs four should spend four. What changed is how much
# a person is allowed to spend, not how the spending is counted. Three visitors
# at full tilt still reach the shared per-site ceiling and no further.
CLIENT_CAPACITY = 20
CLIENT_REFILL_PER_SECOND = 1.0 / 3.0

# Photon is a shared demo server, not an API this service is entitled to. Its
# terms ask callers to be fair and say extensive use will be throttled, so it
# gets the tightest bucket here: 30 calls a minute, bursting 10. One visitor
# search spends exactly one of them, and the geocoder runs out before Wikiloc
# does, which is the right way round for the free half of the pair.
GEOCODER_CAPACITY = 10
GEOCODER_REFILL_PER_SECOND = 0.5

# The designed fan-out is two: a smart-tour convert asks for the tour and then
# its coordinates. Every other path asks once. Code that needs a third call has
# to raise this deliberately, and that edit is the review this number exists to
# force. It is also what keeps a page size and a radius safe: they are
# parameters of one call, and they cannot quietly become a loop.
FAN_OUT_CEILING = 2

# Raised deliberately, which is what the paragraph above asks of anyone who
# needs a third call. Filtering is why. Wikiloc will not filter by activity for
# a caller without an account, and Komoot accepts a difficulty parameter and
# ignores it, so for those the filter has to happen here, over rows we fetched.
#
# One page of 25 is 91% hiking in the Alps, and 1% via ferrata. Filling six via
# ferrata rows would take about twenty-four calls, which is a crawl and is
# forbidden. So the scan is bounded instead and the answer says how far it
# looked: two rows out of a hundred examined is information a walker can use,
# and it is more than any source site will tell them.
FILTER_FAN_OUT = 5

_sites = limits.Buckets(SITE_CAPACITY, SITE_REFILL_PER_SECOND)
_geocoder = limits.Buckets(GEOCODER_CAPACITY, GEOCODER_REFILL_PER_SECOND)
_clients = limits.Buckets(CLIENT_CAPACITY, CLIENT_REFILL_PER_SECOND)


class BlockedHost(Exception):
    pass


class OutsideRequest(Exception):
    """Nothing is paying for this call, so it does not happen.

    Either no inbound request opened a budget, or this request has already
    spent the calls it was allowed. Both are bugs in this service rather than
    anything a visitor did, and both should be loud in the log.
    """


class BudgetExhausted(Exception):
    """A budget is empty. `hint` says whose, so the page can say which wait."""

    def __init__(self, hint: str, detail: str, retry_after: int):
        super().__init__(detail)
        self.hint = hint
        self.detail = detail
        self.retry_after = retry_after


class RequestBudget:
    """How many upstream calls this one inbound request may still make."""

    __slots__ = ("client", "remaining")

    def __init__(self, client: str, remaining: int):
        self.client = client
        self.remaining = remaining


_BUDGET: "contextvars.ContextVar[Optional[RequestBudget]]" = contextvars.ContextVar(
    "outbound_budget", default=None
)


@contextmanager
def request_budget(client: str, calls: int = FAN_OUT_CEILING) -> Iterator[RequestBudget]:
    """Opens the window in which outbound calls are allowed at all.

    Every endpoint that reads a source site wraps its work in this, and a test
    that reaches the network has to as well, which is the rule stated once
    more, every time somebody reads the tests.

    The object is mutated in place and never rebound, because FastAPI runs a
    synchronous endpoint in a worker thread holding a COPY of the context: a
    change to the object is visible through that copy, and a `set()` on the
    variable is not.
    """
    budget = RequestBudget(client, max(0, min(calls, FILTER_FAN_OUT)))
    token = _BUDGET.set(budget)
    try:
        yield budget
    finally:
        _BUDGET.reset(token)


# Paths the sites' own robots.txt closes, refused here rather than only in the
# module that knows about them.
#
# Two adapters state in prose that they never call these. Prose is not an
# enforcement: `wikiloc.trail_id` accepts a legacy `?id=` query, so
# `/wikiloc/map.do?id=1` parsed as a trail and was fetched, and the same URL
# would have gone through /api/convert just as easily. Found by pointing the
# card-shape endpoint at it and watching it come back with a page rather than a
# refusal.
#
# It belongs here because this is the only place that talks to the outside
# world, and because the check has to survive a redirect: a link on an allowed
# path that redirects onto a closed one is the same request with an extra step.
# So this runs at every hop, beside the host allowlist.
CLOSED_PATHS = {
    "alltrails.com": (
        "/api/",
        "/api-v4/",
        "/api-v5/",
        "/static2/",
        "/stob-dab/",
        "/register/",
        "/users/auth/",
        "/members/",
        "/explore/map/",
    ),
    "wikiloc.com": (
        "/wikiloc/map.do",
        "/wikiloc/geocode.do",
        "/wikiloc/tr.do",
        "/wikiloc/companionRequest.do",
        "/wikiloc/login.do",
        "/wikiloc/signingup.do",
        "/cdn-cgi/",
    ),
}


def _normalised(path: str) -> str:
    """The path a server will act on, not the one the URL happens to spell.

    Compared raw, `/wikiloc/%6Dap.do` and `/x/../wikiloc/map.do` both walk
    past a prefix check and both arrive at a page robots.txt closes. So the
    escapes come off and the dot segments are resolved first, and only then
    is the result matched. Unquoting runs to a fixed point because a doubly
    encoded `%256D` decodes to `%6D`, which is still not a literal `m`.
    """
    for _ in range(3):
        unquoted = unquote(path)
        if unquoted == path:
            break
        path = unquoted

    path = path.replace("\\", "/")

    resolved: List[str] = []
    for segment in path.split("/"):
        if segment == "..":
            if resolved:
                resolved.pop()
        elif segment != "." and segment != "":
            resolved.append(segment)

    return "/" + "/".join(resolved)


def _closed(host: str, path: str) -> bool:
    for site, paths in CLOSED_PATHS.items():
        if host == site or host.endswith("." + site):
            lowered = _normalised(path).lower()
            return any(lowered.startswith(closed) for closed in paths)
    return False


def _refused(url: str, reason: str, told: str) -> BlockedHost:
    """Writes down why a call was refused, and never what was refused.

    The reason is one of a fixed handful, so a refusal is greppable and a
    burst of them is countable. The caller's own message keeps the hostname
    and the path, because that goes back to the person who typed the link and
    not into a file.
    """
    logger.warning("refused a call to %s: %s", _site(url), reason)
    return BlockedHost(told)


def _check(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme != "https":
        raise _refused(url, "the scheme is not https", "only https links are fetched")
    if not parsed.hostname or not ALLOWED_HOST.match(parsed.hostname):
        raise _refused(
            url,
            "the host is not on the allowlist",
            f"{parsed.hostname} is not a site this service reads",
        )
    if parsed.port is not None and parsed.port != ALLOWED_PORT:
        raise _refused(
            url,
            "the port is not 443",
            f"port {parsed.port} is not a port this service reads",
        )
    if _closed(parsed.hostname.lower(), parsed.path):
        raise _refused(
            url,
            "the path is closed by that site's robots.txt",
            f"{parsed.path} is closed by that site's robots.txt",
        )


def _site(url: str) -> str:
    host = (urlparse(url).hostname or "").lower()
    if host in SITE_BY_HOST:
        return SITE_BY_HOST[host]
    found = SITE.search(host)
    return found.group(1).lower() if found else "other"


def _buckets(site: str) -> limits.Buckets:
    """Which family of buckets a site spends from."""
    return _geocoder if site == GEOCODER_SITE else _sites


def _spend(url: str) -> None:
    """Charges this call, or refuses it. Called before the call, never after.

    A failed call costs a source site exactly what a successful one costs, so a
    spent token is never given back. Refunding on error is how an outage turns
    into a hammering loop, and it is the same reason nothing here retries.
    """
    site = _site(url)
    budget = _BUDGET.get()
    if budget is None:
        logger.error("nothing is paying for a call to %s, so it did not happen", site)
        raise OutsideRequest("no inbound request is paying for this call")
    if budget.remaining <= 0:
        logger.error("the fan-out ceiling stopped a call to %s", site)
        raise OutsideRequest("fan-out ceiling reached")

    buckets = _buckets(site)
    now = limits.now()
    with limits.LOCK:
        # Both buckets are asked before either is charged. A visitor refused
        # because the whole service is at its ceiling has done nothing wrong,
        # and must not lose a token of their own share for it.
        client_wait = _clients.wait(budget.client, now)
        if client_wait > 0:
            # Which visitor is not written down; that one visitor was refused
            # is, because a service where that is constant is misconfigured.
            logger.info("a visitor's own budget is empty before a call to %s", site)
            raise BudgetExhausted(
                "self", "client budget exhausted", max(1, min(6, math.ceil(client_wait)))
            )
        site_wait = buckets.wait(site, now)
        if site_wait > 0:
            # The shared bucket running dry is the number that decides whether
            # SITE_CAPACITY is still the right number, so it is loud.
            logger.warning(
                "the shared %s budget is empty, %.0fs from a refill", site, site_wait
            )
            # A floor under the wait, so a queue of callers does not come back
            # once a second and spend the refill the moment it lands.
            raise BudgetExhausted(
                "shared", f"{site} budget exhausted", max(5, math.ceil(site_wait))
            )
        _clients.spend(budget.client, now)
        buckets.spend(site, now)

    budget.remaining -= 1


def fetch_text(url: str, timeout: int = TIMEOUT_SECONDS) -> Tuple[int, str]:
    """Returns `(status, body)`. An unreachable host comes back as status 0.

    `timeout` is short for a list of results: a search that takes more than a
    few seconds has already failed the visitor, and a shorter wait bounds how
    long a spent token stays in flight.
    """
    _check(url)
    _spend(url)
    site = _site(url)
    try:
        response = _follow(url, timeout)
    except BlockedHost:
        # A source site sending us somewhere we do not read is not a network
        # failure, and must not be reported as one.
        raise
    except Exception as failure:
        # The class, not the message: curl puts the URL it was given into the
        # text of most of its errors, and that URL is the visitor's.
        logger.warning("%s did not answer: %s", site, type(failure).__name__)
        return 0, ""

    try:
        body = _read(response, site)
    except Exception as failure:
        # Reading the body is now part of the call rather than something that
        # already happened, so a connection that dies halfway lands here. A
        # half page is not a page, and the contract above says status 0.
        logger.warning("%s stopped answering partway: %s", site, type(failure).__name__)
        return 0, ""
    finally:
        _release(response)

    logger.log(
        logging.WARNING if response.status_code >= 400 else logging.INFO,
        "%s answered %s, %s bytes read",
        site,
        response.status_code,
        len(body),
    )
    return response.status_code, body.decode(response.encoding or "utf-8", "replace")


def _read(response, site: str) -> bytes:
    """Everything this service is willing to take from one answer.

    This was `response.content[:MAX_BYTES]`, and `content` is the whole body
    the server chose to send, already in this process. The slice capped what
    got PARSED and nothing else, so the promise at the top of this file -- a
    page that never ends must not become this service never answering -- was
    not kept by the code under it.

    Measured against a local server that sends chunked blocks and never stops.
    The old shape raised Timeout after the full wait and returned nothing
    usable, having accepted whatever arrived meanwhile: 1451.8 MB in a five
    second window over loopback. Reading with the cap inside the loop stopped
    at 8.00 MB in 0.02 s. Chunks came back around 13 KiB, so the overshoot is
    one chunk, not one page.

    A response that is not streaming has no chunks to hand over and is already
    whole, so it is trimmed the old way. Both paths end at MAX_BYTES.
    """
    chunks = getattr(response, "iter_content", None)
    if chunks is None:
        return response.content[:MAX_BYTES]

    read: List[bytes] = []
    total = 0
    for chunk in chunks():
        read.append(chunk)
        total += len(chunk)
        if total >= MAX_BYTES:
            logger.warning("%s sent more than %s bytes, so the rest was left", site, MAX_BYTES)
            break
    return b"".join(read)[:MAX_BYTES]


def _release(response) -> None:
    """Ends the transfer.

    A streamed answer holds its connection open until this runs, and a
    redirect hop whose body nobody reads is exactly that: an open connection
    for a page we were never interested in.
    """
    closing = getattr(response, "close", None)
    if closing is not None:
        closing()


MAX_REDIRECTS = 5
REDIRECT_CODES = (301, 302, 303, 307, 308)


def _follow(url: str, timeout: int):
    """Follows redirects by hand, checking the allowlist at every hop.

    curl follows them perfectly well on its own, but it never asks whether the
    new host is one this service reads. Only the first URL would be checked,
    and a source site redirecting off its own domain would carry this service
    with it: exactly the open proxy the allowlist exists to prevent.

    Hops are not charged. They are the tail of one call the budget already paid
    for, and charging them would make an ordinary canonical redirect look like
    a visitor spending twice.
    """
    target = url
    for _ in range(MAX_REDIRECTS + 1):
        response = requests.get(
            target,
            impersonate=IMPERSONATE,
            timeout=timeout,
            allow_redirects=False,
            stream=True,
        )
        if response.status_code not in REDIRECT_CODES:
            return response
        location = response.headers.get("location")
        if not location:
            return response
        _release(response)
        target = urljoin(target, location)
        _check(target)
    raise _refused(
        target, "it redirects around in a loop", "that link redirects around in a loop"
    )


def fetch_json(url: str, timeout: int = TIMEOUT_SECONDS) -> Tuple[int, Optional[Any]]:
    status, body = fetch_text(url, timeout=timeout)
    if not body:
        return status, None
    try:
        return status, json.loads(body)
    except json.JSONDecodeError:
        return status, None
