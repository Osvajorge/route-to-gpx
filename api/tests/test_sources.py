"""Tests that need no network.

The parts that talk to Komoot and Wikiloc are exercised by
`api/tests/test_live.py`, which is skipped unless you ask for it.
"""

import pytest

from api.core import gpx, twkb
from api.sources import SourceError, komoot, wikiloc


def test_komoot_reads_the_tour_id_from_every_domain():
    assert komoot.tour_id("https://www.komoot.com/tour/5000000") == "5000000"
    assert komoot.tour_id("https://www.komoot.es/tour/5000000?ref=x") == "5000000"
    assert komoot.tour_id("https://www.komoot.de/smarttour/42") == "42"
    assert komoot.tour_id("https://www.komoot.com/discover") is None


def test_komoot_reads_the_tour_id_from_every_link_shape():
    # The shape a visitor reported as rejected: locale segment, a smart tour id
    # with its "e" prefix, a slug and a query string, all in one link.
    assert (
        komoot.tour_id(
            "https://www.komoot.com/es-es/smarttour/e1389649060/montee-au-tossal"
            "-de-l-aliga-et-a-la-roca-salvatge-circuit-depuis-la-nouvelle-maison"
            "-del-obac?openSendToDialog=true"
        )
        == "1389649060"
    )
    assert komoot.tour_id("https://www.komoot.com/smarttour/e1389649060") == "1389649060"
    assert komoot.tour_id("https://www.komoot.com/smarttour/20807594") == "20807594"
    assert komoot.tour_id("https://www.komoot.com/de-de/tour/1389649060/") == "1389649060"
    assert komoot.tour_id("https://www.komoot.com/tour/1389649060#overview") == "1389649060"
    assert komoot.tour_id("www.komoot.com/tour/1389649060") == "1389649060"
    # The share link Komoot sends by mail, and the API address a curious visitor
    # may have found. Same id space, different words in the path.
    assert komoot.tour_id("https://www.komoot.com/invite-tour/1389649060") == "1389649060"
    assert komoot.tour_id("https://api.komoot.de/v007/tours/1389649060") == "1389649060"
    # Every Komoot page carries this in its markup. It is not a tour.
    assert komoot.tour_id("https://www.komoot.com/images/tour/placeholder.webp") is None


def test_komoot_keeps_the_two_id_spaces_apart():
    """The "e" picks the endpoint, so dropping it hands back another route.

    A bare /smarttour/ id is usually a valid /tour/ id as well, belonging to
    somebody else, and that answers 200. Getting this wrong is silent.
    """
    assert komoot._link("https://www.komoot.com/smarttour/e1389649060") == (
        "tour",
        "1389649060",
    )
    assert komoot._link("https://www.komoot.com/smarttour/20807594") == (
        "smart_tour",
        "20807594",
    )
    assert komoot._link("https://www.komoot.com/tour/1389649060") == ("tour", "1389649060")


def test_komoot_says_what_a_link_that_is_not_a_tour_actually_is(monkeypatch):
    """A highlight, a collection and a guide are all rejected before any request."""

    def never(url):
        raise AssertionError(f"asked Komoot for {url} instead of reading the link")

    monkeypatch.setattr(komoot, "fetch_json", never)

    for url, expected in [
        ("https://www.komoot.com/highlight/113497", "a single place"),
        ("https://www.komoot.com/es-es/collection/1869707", "a list of tours"),
        ("https://www.komoot.com/guide/12491", "a region guide"),
    ]:
        assert komoot.tour_id(url) is None
        with pytest.raises(SourceError) as raised:
            komoot.fetch(url)
        assert raised.value.code == "domain"
        assert expected in raised.value.detail

def test_wikiloc_reads_the_trail_id_from_the_slug():
    assert (
        wikiloc.trail_id(
            "https://es.wikiloc.com/rutas-alpinismo/aneto-desde-artiga-de-lin-8001213"
        )
        == "8001213"
    )
    assert wikiloc.trail_id("https://www.wikiloc.com/trail-8001213?a=1") == "8001213"
    assert wikiloc.trail_id("https://www.wikiloc.com/outdoor-navigation-app") is None


def test_wikiloc_reads_numbers_written_either_way():
    # Spanish page: dot groups thousands, comma marks the decimal.
    assert wikiloc._number("24,37 km") == 24370.0
    assert wikiloc._number("2.215 m") == 2215.0
    assert wikiloc._number("1.456 m") == 1456.0
    # English page: the separators swap round, and the units go imperial.
    assert wikiloc._number("24.37 km") == 24370.0
    assert wikiloc._number("2,215 m") == 2215.0
    assert round(wikiloc._number("15.14 mi")) == 24365
    assert round(wikiloc._number("7,267 ft")) == 2215
    # Anything without a unit is not a measurement.
    assert wikiloc._number("Difícil") is None
    assert wikiloc._number("53") is None


def test_wikiloc_reads_the_statistics_block_whatever_the_language():
    spanish = """
      <section id="trail-data">
        <dl><div><dt>Distancia</dt><dd>24,37 km</dd></div>
        <div><dt>Tipo de ruta</dt><dd>Ida y vuelta</dd></div>
        <div><dt>Desnivel positivo</dt><dd>2.215 m</dd></div>
        <div><dt>Altitud máxima</dt><dd>3.407 m</dd></div>
        <div><dt>Altitud mínima</dt><dd>1.456 m</dd></div>
        <div><dt>Fecha de subida</dt><dd>12 de octubre de 2014</dd></div>
        <div><dt>Coordenadas</dt><dd>3586</dd></div></dl>
      </section>"""
    stats = wikiloc._statistics(spanish)
    assert stats["distance"] == 24370.0
    assert stats["ascent"] == 2215.0
    assert stats["elevation_max"] == 3407.0
    assert stats["elevation_min"] == 1456.0
    assert stats["points"] == 3586

    # The English page uses different labels and imperial units for the same
    # route, and has to come out at the same figures.
    english = """
      <section id="trail-data">
        <dl><div><dt>Distance</dt><dd>15.14 mi</dd></div>
        <div><dt>Trail type</dt><dd>Out and back</dd></div>
        <div><dt>Elevation gain</dt><dd>7,267 ft</dd></div>
        <div><dt>Elevation loss</dt><dd>7,267 ft</dd></div>
        <div><dt>Max elevation</dt><dd>11,177 ft</dd></div>
        <div><dt>Min elevation</dt><dd>4,777 ft</dd></div>
        <div><dt>Uploaded</dt><dd>October 12, 2014</dd></div>
        <div><dt>Coordinates</dt><dd>3586</dd></div></dl>
      </section>"""
    stats = wikiloc._statistics(english)
    assert stats["points"] == 3586
    assert abs(stats["distance"] - 24370) < 20
    assert abs(stats["ascent"] - 2215) < 5
    assert abs(stats["elevation_max"] - 3407) < 5
    assert abs(stats["elevation_min"] - 1456) < 5
    assert stats["route_type_text"] == "out and back"


def test_a_date_never_gets_read_as_a_climb():
    """`Fecha de subida` carries the word for `climb`, and a date is not one."""
    page = """<section id="trail-data"><dl>
        <div><dt>Fecha de subida</dt><dd>12 de octubre de 2014</dd></div>
      </dl></section>"""
    assert "ascent" not in wikiloc._statistics(page)


def _encode_twkb(points, precision_xy=5, precision_z=1):
    """Writes the TWKB the decoder is meant to read, straight from the spec.

    Having the encoder here means the test proves the decoder against the
    format, not against itself.
    """

    def unsigned(value):
        out = bytearray()
        while True:
            byte = value & 0x7F
            value >>= 7
            out.append(byte | (0x80 if value else 0))
            if not value:
                return bytes(out)

    def signed(value):
        return unsigned((value << 1) if value >= 0 else ((-value << 1) - 1))

    def zigzag(value):
        return (value << 1) if value >= 0 else ((-value << 1) - 1)

    blob = bytearray()
    blob.append((zigzag(precision_xy) << 4) | 0x02)  # LineString
    blob.append(0x08)  # extended dimensions follow
    blob.append(0x01 | (precision_z << 2))  # has Z, at this precision
    blob += unsigned(len(points))

    scale_xy = 10**precision_xy
    scale_z = 10**precision_z
    running = [0, 0, 0]
    for longitude, latitude, elevation in points:
        target = [
            round(longitude * scale_xy),
            round(latitude * scale_xy),
            round(elevation * scale_z),
        ]
        for axis in range(3):
            blob += signed(target[axis] - running[axis])
            running[axis] = target[axis]
    return bytes(blob)


def test_twkb_reads_back_what_the_specification_wrote():
    # Five decimals, because precision 5 is what Wikiloc sends and what the
    # format then holds. A sixth digit is not a decoder bug, it is not there.
    original = [(0.70626, 42.67820, 1456.5), (0.70630, 42.67840, 1457.2)]
    points, header = twkb.decode(_encode_twkb(original))

    assert header["has_z"] is True
    assert header["bytes_read"] == header["bytes_total"]
    assert len(points) == 2
    for read, wrote in zip(points, original):
        assert round(read[0], 6) == wrote[0]
        assert round(read[1], 6) == wrote[1]
        assert round(read[2], 1) == wrote[2]


def test_twkb_reports_a_truncated_blob_instead_of_a_short_track():
    """A half-read blob has to be visible: it looks like a valid short track."""
    blob = _encode_twkb([(0.1, 42.1, 100.0)] * 4)
    points, header = twkb.decode(blob + b"\x00\x00")
    assert header["bytes_read"] < header["bytes_total"]
    assert len(points) == 4


def test_gpx_carries_its_own_provenance():
    document = gpx.build(
        [(42.5, 0.7, 1456.5), (42.6, 0.71, 1500.0)],
        name="A & B",
        source_url="https://example.org/trail-1",
        source_label="Example",
    )
    assert "A &amp; B" in document
    assert '<link href="https://example.org/trail-1">' in document
    assert 'lat="42.500000" lon="0.700000"' in document
    assert "<ele>1456.5</ele>" in document
    assert document.count("<trkpt") == 2


def test_gpx_leaves_out_elevation_it_does_not_have():
    document = gpx.build([(1.0, 2.0, None), (1.1, 2.1, None)], name="No elevation")
    assert "<ele>" not in document


def test_wikiloc_still_reads_the_old_link_shapes():
    """The legacy links still work on Wikiloc, so they still work here.

    The adapter never needs the id to fetch anything: it asks for the URL it was
    given and reads the track out of the page. Refusing these was the gate
    turning away links the rest of the adapter handles fine.
    """
    assert wikiloc.trail_id("https://www.wikiloc.com/wikiloc/view.do?id=8001213") == "8001213"
    assert (
        wikiloc.trail_id(
            "https://www.wikiloc.com/wikiloc/spatialArtifacts.do?event=view&id=8001213"
        )
        == "8001213"
    )


def test_wikiloc_does_not_mistake_a_number_in_the_path_for_a_trail():
    assert wikiloc.trail_id("https://www.wikiloc.com/user-12345/trails") is None
    assert wikiloc.trail_id("https://www.wikiloc.com/outdoor-navigation-app") is None
    assert wikiloc.trail_id("https://www.wikiloc.com/") is None


def test_komoot_keeps_the_two_id_spaces_apart():
    """A smart tour id is usually a valid tour id as well, belonging to somebody
    else's route. Sending it to the wrong endpoint answers 200 with the wrong
    mountain, so the prefix has to pick the endpoint."""
    assert komoot._link("https://www.komoot.com/es-es/smarttour/e1389649060/slug") == (
        "tour",
        "1389649060",
    )
    assert komoot._link("https://www.komoot.com/smarttour/20807594") == (
        "smart_tour",
        "20807594",
    )
    assert komoot._link("https://www.komoot.com/tour/5000000") == ("tour", "5000000")
    assert komoot._link("https://www.komoot.de/de-de/tour/5000000/embed") == (
        "tour",
        "5000000",
    )
    # Every Komoot page carries this in its markup. An unanchored match on
    # "/tour/" would read it as a route.
    assert komoot._link("https://www.komoot.com/images/tour/placeholder.webp") is None


def test_komoot_names_the_link_the_visitor_actually_pasted():
    for kind, url in [
        ("highlight", "https://www.komoot.com/highlight/113497"),
        ("collection", "https://www.komoot.com/es-es/collection/1869707"),
        ("guide", "https://www.komoot.com/guide/12491"),
    ]:
        with pytest.raises(SourceError) as raised:
            komoot.fetch(url)
        assert raised.value.code == "domain"
        # The hint is what the page translates; the detail is for the log.
        assert raised.value.hint == kind
        assert kind in raised.value.detail


def test_komoot_reads_the_climb_under_either_name():
    """A tour publishes `elevation_up`, a smart tour publishes `uphill`."""
    assert komoot._first({"elevation_up": 429.7}, "elevation_up", "uphill") == 429.7
    assert komoot._first({"uphill": 1126.1}, "elevation_up", "uphill") == 1126.1
    # A flat route publishes 0.0, which is an answer and not a missing field.
    assert komoot._first({"uphill": 0.0}, "elevation_up", "uphill") == 0.0
    assert komoot._first({}, "elevation_up", "uphill") is None
