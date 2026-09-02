"""The only place this service talks to the outside world.

Two rules hold here, and nowhere else has to think about them:

1. We fetch a fixed list of hosts. The URL comes from a stranger on the
   internet, so an allowlist is the difference between a converter and an open
   proxy into whatever network this runs on.
2. We stop reading at a size limit. A page that never ends must not become this
   service never answering.
"""

import json
import re
from typing import Any, Optional, Tuple

from curl_cffi import requests

# A browser handshake, not a browser. Wikiloc answers a default client with 403
# and a browser with 200, and the difference is the TLS fingerprint.
IMPERSONATE = "chrome"

TIMEOUT_SECONDS = 20
MAX_BYTES = 8 * 1024 * 1024

ALLOWED_HOST = re.compile(
    r"^(?:[a-z0-9-]+\.)*(?:komoot\.[a-z.]+|wikiloc\.[a-z.]+)$", re.I
)


class BlockedHost(Exception):
    pass


def _check(url: str) -> None:
    from urllib.parse import urlparse

    parsed = urlparse(url)
    if parsed.scheme != "https":
        raise BlockedHost("only https links are fetched")
    if not parsed.hostname or not ALLOWED_HOST.match(parsed.hostname):
        raise BlockedHost(f"{parsed.hostname} is not a site this service reads")


def fetch_text(url: str) -> Tuple[int, str]:
    """Returns `(status, body)`. An unreachable host comes back as status 0."""
    _check(url)
    try:
        response = requests.get(
            url,
            impersonate=IMPERSONATE,
            timeout=TIMEOUT_SECONDS,
            allow_redirects=True,
            max_redirects=5,
        )
    except Exception:
        return 0, ""

    body = response.content[:MAX_BYTES]
    return response.status_code, body.decode(response.encoding or "utf-8", "replace")


def fetch_json(url: str) -> Tuple[int, Optional[Any]]:
    status, body = fetch_text(url)
    if not body:
        return status, None
    try:
        return status, json.loads(body)
    except json.JSONDecodeError:
        return status, None
