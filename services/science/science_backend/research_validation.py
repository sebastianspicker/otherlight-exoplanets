"""Validate V7's closed schema vocabulary and cross-field scientific input semantics."""

from __future__ import annotations

import math
import re
from itertools import pairwise
from typing import Any
from urllib.parse import urljoin

from .errors import ContractError
from .research_contracts import SCHEMAS


def _fail(path: str, reason: str) -> None:
    raise ContractError(f"{path}: {reason}")


def _resolve(reference: str, base: str) -> tuple[dict[str, Any], str]:
    identifier, _, fragment = urljoin(base, reference).partition("#")
    document = next(value for value in SCHEMAS.values() if value["$id"] == identifier)
    current = document
    for key in filter(None, fragment.split("/")):
        current = current[key]
    return current, identifier


def _validate(schema: dict[str, Any], value: Any, base: str, path: str) -> None:
    if "$ref" in schema:
        target, target_base = _resolve(schema["$ref"], base)
        _validate(target, value, target_base, path)
        return
    if "const" in schema and (
        type(value) is not type(schema["const"]) or value != schema["const"]
    ):
        _fail(path, "does not match the required constant")
    if "enum" in schema and value not in schema["enum"]:
        _fail(path, "unsupported enum value")
    handlers = {
        "object": _object,
        "array": _array,
        "string": _string,
        "number": _number,
        "integer": _number,
        "boolean": _boolean,
    }
    kind = schema.get("type")
    if kind is not None:
        handlers[kind](schema, value, base, path)


def _object(schema: dict[str, Any], value: Any, base: str, path: str) -> None:
    if not isinstance(value, dict):
        _fail(path, "must be an object")
    fields = schema["properties"]
    if set(value) - set(fields) or set(schema["required"]) - set(value):
        _fail(path, "missing required fields or contains unknown fields")
    for key, nested in value.items():
        _validate(fields[key], nested, base, f"{path}.{key}")


def _array(schema: dict[str, Any], value: Any, base: str, path: str) -> None:
    if not isinstance(value, list):
        _fail(path, "must be an array")
    if not schema["minItems"] <= len(value) <= schema["maxItems"]:
        _fail(path, "array length is outside the allowed range")
    for index, nested in enumerate(value):
        _validate(schema["items"], nested, base, f"{path}[{index}]")


def _string(schema: dict[str, Any], value: Any, _base: str, path: str) -> None:
    if not isinstance(value, str):
        _fail(path, "must be a string")
    if not schema.get("minLength", 0) <= len(value) <= schema.get("maxLength", 64):
        _fail(path, "string length is outside the allowed range")
    if "pattern" in schema and re.fullmatch(schema["pattern"], value) is None:
        _fail(path, "invalid identifier")


def _number(schema: dict[str, Any], value: Any, _base: str, path: str) -> None:
    if type(value) not in (int, float):
        _fail(path, "must be a finite number")
    try:
        finite = math.isfinite(value)
    except OverflowError:
        finite = False
    if not finite or (schema["type"] == "integer" and value != int(value)):
        _fail(path, "must be a finite number of the specified type")
    comparisons = (
        ("minimum", lambda a, b: a >= b),
        ("maximum", lambda a, b: a <= b),
        ("exclusiveMinimum", lambda a, b: a > b),
        ("exclusiveMaximum", lambda a, b: a < b),
    )
    if any(
        key in schema and not compare(value, schema[key])
        for key, compare in comparisons
    ):
        _fail(path, "number is outside the allowed range")


def _boolean(_schema: dict[str, Any], value: Any, _base: str, path: str) -> None:
    if type(value) is not bool:
        _fail(path, "must be a boolean")


def validate_research(schema_path: str, payload: dict[str, Any]) -> None:
    """Check shape before performing semantic checks; no implicit unit conversion."""
    schema = SCHEMAS[schema_path]
    _validate(schema, payload, schema["$id"], "resource")
    semantics = {
        "science-v7/observations.schema.json": _observations,
        "science-v7/calibration.schema.json": _calibration,
        "science-v7/scenario.schema.json": _scenario,
        "science-v7/job-request.schema.json": _job,
        "science-v7/resource-descriptor.schema.json": _descriptor,
    }
    if schema_path in semantics:
        semantics[schema_path](payload)


def _time_difference(left: dict[str, Any], right: dict[str, Any]) -> float:
    return (left["jd1"] - right["jd1"]) + (left["jd2"] - right["jd2"])


def _observations(payload: dict[str, Any]) -> None:
    components, units = {
        "relative-flux": (["flux"], ["1"]),
        "radial-velocity": (["rv"], ["m/s"]),
        "event-time": (["oc"], ["s"]),
        "astrometry": (["xi", "eta"], ["rad", "rad"]),
    }[payload["observable"]]
    if payload["components"] != components or payload["units"] != units:
        _fail("observations", "components/units do not match the declared observable")
    rows = payload["rows"]
    for row in rows:
        if len(row["value"]) != len(components) or len(row["sigma"]) != len(components):
            _fail("observations.rows", "value/sigma dimensions do not match components")
    if any(_time_difference(b["time"], a["time"]) < 0 for a, b in pairwise(rows)):
        _fail(
            "observations.rows",
            "timestamps must be nondecreasing; preserve source order explicitly",
        )
    _observation_time_domain(payload)
    if (payload["observable"] == "event-time") != ("ephemeris" in payload):
        _fail(
            "observations",
            "only event-time requires an explicit O-C reference ephemeris",
        )
    if payload["observable"] == "relative-flux" and not payload["calibrationHashes"]:
        _fail("observations", "relative flux requires an explicit passband calibration")
    if (payload["observable"] == "astrometry") != ("astrometricReference" in payload):
        _fail("observations", "only astrometry requires an explicit ICRS tangent point")


def _observation_time_domain(payload: dict[str, Any]) -> None:
    convention = payload["timeConvention"]
    if convention["scale"] == "UTC" and not convention["referenceDataHashes"]:
        _fail(
            "observations.timeConvention",
            "UTC requires pinned leap-second reference data",
        )
    fraction = {"start": 0, "midpoint": -0.5, "end": -1}[
        convention["exposureTimestamp"]
    ]
    rows = payload["rows"]
    windows = []
    for row in rows:
        offset = _time_difference(row["time"], rows[0]["time"])
        duration = row["exposureSeconds"] / 86400
        start = offset + fraction * duration
        windows.append((start, start + duration))
    if (
        max(end for _, end in windows) - min(start for start, _ in windows)
        > 30 * 365.25
    ):
        _fail("observations.rows", "exposure baseline exceeds 30 Julian years")


def _calibration(payload: dict[str, Any]) -> None:
    axis, response = payload["wavelengthM"], payload["response"]
    if len(axis) != len(response) or any(b <= a for a, b in pairwise(axis)):
        _fail(
            "calibration", "response must match a strictly increasing wavelength grid"
        )
    if not any(value > 0 for value in response):
        _fail("calibration.response", "passband must have positive support")


def _scenario(payload: dict[str, Any]) -> None:
    bodies = payload["bodies"]
    if len({body["id"] for body in bodies}) != len(bodies):
        _fail("scenario.bodies", "body identifiers must be unique")
    for index, body in enumerate(bodies):
        for other in bodies[:index]:
            distance = math.dist(body["positionM"], other["positionM"])
            if distance <= body["radiusM"] + other["radiusM"]:
                _fail("scenario.bodies", "initial bodies are in surface contact")


def _job(payload: dict[str, Any]) -> None:
    allocation = payload["tolerances"]["allocation"]
    # Match Node's ordered binary64 additions, independent of JSON member order.
    total = 0.0
    for key in ("trajectory", "propagation", "spatial", "spectral", "exposure"):
        total += allocation[key]
    if not 0 < total <= 1 + 1e-12:
        _fail(
            "job.tolerances.allocation",
            "positive fractional budgets must sum to at most one (roundoff allowance 1e-12)",
        )


def _descriptor(payload: dict[str, Any]) -> None:
    expected = {"sources": "opaque-bytes", "workspaces": "workspace-v2"}.get(
        payload["kind"], "science-v7"
    )
    if payload["resourceSchemaVersion"] != expected:
        _fail("resourceDescriptor", "resource version does not match resource kind")
