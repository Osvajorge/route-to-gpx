"""The only place this service talks to the outside world.

Four rules hold here, and nowhere else has to think about them:

1. We fetch a fixed list of hosts. The URL comes from a stranger on the
   internet, so an allowlist is the difference between a converter and an open
   proxy into whatever network this runs on.
2. We stop reading at a size limit. A page that never ends must not become this
   service never answering.
3. Nothing is fetched unless an inbound request is paying for it. Komoot's
   robots.txt disallows /api for crawlers, which forbids anything that walks
   the site on its own. A call with no request context is refused outright, so
   that promise is code rather than a comment.
4. Every call spends from two budgets, and they do different jobs.

   The per-site bucket is SAFETY. It is what protects the source sites, and
   with them this service's ability to keep reading them at all.

   The per-client bucket is FAIRNESS. It stops one visitor drinking the shared
   bucket. Everything else follows from that split: per-client state can be
   thrown away under memory pressure, and a misconfigured deployment can even
   let a client key be forged, and neither is a safety failure — forging or
   losing a client key can only empty the shared bucket faster, never spend
   past it.

WORKER COUNT IS LOAD-BEARING. These budgets live in the process. The Dockerfile
starts one worker, so the numbers below are the numbers. Run N workers and the
site budget is multiplied by N, and has to be divided here by hand.
"""

import contextvars
import json
import math
import re
from contextlib import contextmanager
from typing import Any, Iterator, Optional, Tuple
from urllib.parse import urljoin, urlparse

from curl_cffi import requests

from . import limits

# A browser handshake, not a browser. Wikiloc answers a default client with 403
# and a browser with 200, and the difference is the TLS fingerprint.
IMPERSONATE = "chrome"

TIMEOUT_SECONDS = 20
MAX_BYTES = 8 * 1024 * 1024

ALLOWED_HOST = re.compile(
    r"^(?:[a-z0-9-]+\.)*(?:komoot\.[a-z.]+|wikiloc\.[a-z.]+)$", re.I
)

# Which budget a host spends from. Keyed on the site, not the hostname: komoot
# answers on www.komoot.com, www.komoot.de and api.komoot.de, and giving each
# its own bucket would multiply the budget for free.
SITE = re.compile(r"(komoot|wikiloc)\.[a-z.]+$", re.I)

# 60 upstream calls a minute, bursting 30. One person using the web page
# deliberately spends well under ten a minute, since every one of them needs a
# typed query or a click, so this carries roughly six people at full tilt and
# still sits far below anything a source site notices beside its own traffic.
SITE_CAPACITY = 30
SITE_REFILL_PER_SECOND = 1.0

# 10 upstream calls a minute per visitor, bursting 8. Eight covers the worst
# honest sequence — a query, two refinements, a nearby, then converting two
# rows one of which is a smart tour — and ten a minute is more than a person
# can spend on purpose, so emptying the site bucket needs at least six of them.
CLIENT_CAPACITY = 8
CLIENT_REFILL_PER_SECOND = 1.0 / 6.0

# The designed fan-out is two: a smart-tour convert asks for the tour and then
# its coordinates. Every other path asks once. Code that needs a third call has
# to raise this deliberately, and that edit is the review this number exists to
# force. It is also what keeps a page size and a radius safe: they are
# parameters of one call, and they cannot quietly become a loop.
FAN_OUT_CEILING = 2

_sites = limits.Buckets(SITE_CAPACITY, SITE_REFILL_PER_SECOND)
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
    that reaches the network has to as well — which is the rule stated once
    more, every time somebody reads the tests.

    The object is mutated in place and never rebound, because FastAPI runs a
    synchronous endpoint in a worker thread holding a COPY of the context: a
    change to the object is visible through that copy, and a `set()` on the
    variable is not.
    """
    budget = RequestBudget(client, max(0, min(calls, FAN_OUT_CEILING)))
    token = _BUDGET.set(budget)
    try:
        yield budget
    finally:
        _BUDGET.reset(token)


def _check(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme != "https":
        raise BlockedHost("only https links are fetched")
    if not parsed.hostname or not ALLOWED_HOST.match(parsed.hostname):
        raise BlockedHost(f"{parsed.hostname} is not a site this service reads")


def _site(url: str) -> str:
    found = SITE.search(urlparse(url).hostname or "")
    return found.group(1).lower() if found else "other"


def _spend(url: str) -> None:
    """Charges this call, or refuses it. Called before the call, never after.

    A failed call costs a source site exactly what a successful one costs, so a
    spent token is never given back. Refunding on error is how an outage turns
    into a hammering loop, and it is the same reason nothing here retries.
    """
    budget = _BUDGET.get()
    if budget is None:
        raise OutsideRequest("no inbound request is paying for this call")
    if budget.remaining <= 0:
        raise OutsideRequest("fan-out ceiling reached")

    site = _site(url)
    now = limits.now()
    with limits.LOCK:
        # Both buckets are asked before either is charged. A visitor refused
        # because the whole service is at its ceiling has done nothing wrong,
        # and must not lose a token of their own share for it.
        client_wait = _clients.wait(budget.client, now)
        if client_wait > 0:
            raise BudgetExhausted(
                "self", "client budget exhausted", max(1, min(6, math.ceil(client_wait)))
            )
        site_wait = _sites.wait(site, now)
        if site_wait > 0:
            # A floor under the wait, so a queue of callers does not come back
            # once a second and spend the refill the moment it lands.
            raise BudgetExhausted(
                "shared", f"{site} budget exhausted", max(5, math.ceil(site_wait))
            )
        _clients.spend(budget.client, now)
        _sites.spend(site, now)

    budget.remaining -= 1


def fetch_text(url: str, timeout: int = TIMEOUT_SECONDS) -> Tuple[int, str]:
    """Returns `(status, body)`. An unreachable host comes back as status 0.

    `timeout` is short for a list of results: a search that takes more than a
    few seconds has already failed the visitor, and a shorter wait bounds how
    long a spent token stays in flight.
    """
    _check(url)
    _spend(url)
    try:
        response = _follow(url, timeout)
    except BlockedHost:
        # A source site sending us somewhere we do not read is not a network
        # failure, and must not be reported as one.
        raise
    except Exception:
        return 0, ""

    body = response.content[:MAX_BYTES]
    return response.status_code, body.decode(response.encoding or "utf-8", "replace")


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
            target, impersonate=IMPERSONATE, timeout=timeout, allow_redirects=False
        )
        if response.status_code not in REDIRECT_CODES:
            return response
        location = response.headers.get("location")
        if not location:
            return response
        target = urljoin(target, location)
        _check(target)
    raise BlockedHost("that link redirects around in a loop")


def fetch_json(url: str, timeout: int = TIMEOUT_SECONDS) -> Tuple[int, Optional[Any]]:
    status, body = fetch_text(url, timeout=timeout)
    if not body:
        return status, None
    try:
        return status, json.loads(body)
    except json.JSONDecodeError:
        return status, None
