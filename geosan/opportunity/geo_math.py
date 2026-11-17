"""Local GRS80 UTM-K conversion and straight-line distances; no external requests."""

from math import asin, cos, degrees, isfinite, radians, sin, sqrt, tan

# GRS80 ellipsoid and Korea Unified Belt definition (EPSG:5179).
SEMI_MAJOR_AXIS = 6378137.0
INVERSE_FLATTENING = 298.257222101
LATITUDE_ORIGIN = radians(38.0)
LONGITUDE_ORIGIN = radians(127.5)
SCALE = 0.9996
FALSE_EASTING = 1000000.0
FALSE_NORTHING = 2000000.0
# Mean Earth radius (IUGG), used for great-circle distance on the stored coordinates.
MEAN_EARTH_RADIUS_KM = 6371.0088


def _ellipsoid():
    flattening = 1.0 / INVERSE_FLATTENING
    e2 = flattening * (2.0 - flattening)
    return e2, e2 / (1.0 - e2)


def _meridional_arc(phi):
    e2, _ = _ellipsoid()
    return SEMI_MAJOR_AXIS * (
        (1 - e2 / 4 - 3 * e2**2 / 64 - 5 * e2**3 / 256) * phi
        - (3 * e2 / 8 + 3 * e2**2 / 32 + 45 * e2**3 / 1024) * sin(2 * phi)
        + (15 * e2**2 / 256 + 45 * e2**3 / 1024) * sin(4 * phi)
        - 35 * e2**3 / 3072 * sin(6 * phi)
    )


def utmk_to_lat_lng(easting, northing):
    """Input uses the source file's conventional X=easting, Y=northing ordering."""
    if not all(isfinite(v) for v in (easting, northing)):
        raise ValueError("Coordinates must be finite")
    e2, ep2 = _ellipsoid()
    m = _meridional_arc(LATITUDE_ORIGIN) + (northing - FALSE_NORTHING) / SCALE
    mu = m / (SEMI_MAJOR_AXIS * (1 - e2 / 4 - 3 * e2**2 / 64 - 5 * e2**3 / 256))
    e1 = (1 - sqrt(1 - e2)) / (1 + sqrt(1 - e2))
    phi = (
        mu
        + (3 * e1 / 2 - 27 * e1**3 / 32) * sin(2 * mu)
        + (21 * e1**2 / 16 - 55 * e1**4 / 32) * sin(4 * mu)
        + 151 * e1**3 / 96 * sin(6 * mu)
        + 1097 * e1**4 / 512 * sin(8 * mu)
    )
    n = SEMI_MAJOR_AXIS / sqrt(1 - e2 * sin(phi) ** 2)
    r = SEMI_MAJOR_AXIS * (1 - e2) / (1 - e2 * sin(phi) ** 2) ** 1.5
    t = tan(phi) ** 2
    c = ep2 * cos(phi) ** 2
    d = (easting - FALSE_EASTING) / (n * SCALE)
    latitude = phi - n * tan(phi) / r * (
        d * d / 2
        - (5 + 3 * t + 10 * c - 4 * c * c - 9 * ep2) * d**4 / 24
        + (61 + 90 * t + 298 * c + 45 * t * t - 252 * ep2 - 3 * c * c) * d**6 / 720
    )
    longitude = LONGITUDE_ORIGIN + (
        d
        - (1 + 2 * t + c) * d**3 / 6
        + (5 - 2 * c + 28 * t - 3 * c * c + 8 * ep2 + 24 * t * t) * d**5 / 120
    ) / cos(phi)
    result = degrees(latitude), degrees(longitude)
    if not -90 <= result[0] <= 90 or not -180 <= result[1] <= 180:
        raise ValueError("Converted coordinates are outside geographic bounds")
    return result


def straight_distance_km(lat1, lng1, lat2, lng2):
    if not all(isfinite(v) for v in (lat1, lng1, lat2, lng2)):
        raise ValueError("Coordinates must be finite")
    if not (
        -90 <= lat1 <= 90 and -90 <= lat2 <= 90 and -180 <= lng1 <= 180 and -180 <= lng2 <= 180
    ):
        raise ValueError("Coordinates are outside geographic bounds")
    phi1, phi2 = radians(lat1), radians(lat2)
    dphi, dlambda = phi2 - phi1, radians(lng2 - lng1)
    half_chord = sin(dphi / 2) ** 2 + cos(phi1) * cos(phi2) * sin(dlambda / 2) ** 2
    return 2 * MEAN_EARTH_RADIUS_KM * asin(sqrt(min(1.0, max(0.0, half_chord))))
