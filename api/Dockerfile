FROM python:3.12-slim

WORKDIR /srv
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY . /srv/api/
ENV PYTHONPATH=/srv

EXPOSE 8000

# One worker, and that is load-bearing. The outbound budgets in api/http.py
# live in the process, so N workers multiply the budget the source sites see by
# N. Adding --workers means dividing those numbers there by hand.
#
# --proxy-headers is uvicorn's own default, written out so the intent survives a
# version whose default changes. With it, uvicorn rewrites the client address
# from the forwarded header ONLY when the immediate peer is listed in
# --forwarded-allow-ips, which uvicorn reads from FORWARDED_ALLOW_IPS. So the
# application code never reads that header itself, and is correct either way.
#
# Set FORWARDED_ALLOW_IPS only when a proxy sits on another host or container,
# to that proxy's exact address. Leave it unset for a direct run or a proxy on
# this host: uvicorn already trusts 127.0.0.1. Never set it to "*" — that
# believes every sender, and a visitor can then forge the header and take a
# fresh share of the budget on every request by rotating it.
CMD ["uvicorn", "api.app:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]
