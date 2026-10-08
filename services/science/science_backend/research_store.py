"""Persist immutable V7 inputs and exact original bytes in a quota-bound local store."""

from __future__ import annotations

import json
import re
import sqlite3
from contextlib import contextmanager
from hashlib import sha256
from pathlib import Path
from typing import Any

from .api_v2_dataset_validation import MAX_DATASET_BYTES, parse_dataset_bytes
from .canonical_json import canonical_json
from .errors import ContractError, DatasetCapacityError, DatasetTooLargeError
from .research_contracts import RESOURCE_SCHEMAS
from .research_validation import validate_research

MAX_RESEARCH_BYTES = 128 * 1024 * 1024
MAX_RESEARCH_OBJECTS = 4096


class ResearchStore:
    """Content-addressed immutable inputs; no automatic refresh or deletion of inputs."""

    def __init__(
        self,
        root: Path,
        *,
        max_bytes: int = MAX_RESEARCH_BYTES,
        max_objects: int = MAX_RESEARCH_OBJECTS,
    ):
        self.path = root / "research-v7.local.sqlite"
        self.max_bytes = max_bytes
        self.max_objects = max_objects
        root.mkdir(parents=True, exist_ok=True)
        with self._connection() as database:
            database.execute(
                "CREATE TABLE IF NOT EXISTS objects ("
                "kind TEXT NOT NULL, hash TEXT NOT NULL, bytes BLOB NOT NULL, "
                "PRIMARY KEY (kind, hash))"
            )

    @contextmanager
    def _connection(self):
        database = sqlite3.connect(self.path, timeout=5)
        try:
            database.execute("PRAGMA busy_timeout=5000")
            yield database
            database.commit()
        except BaseException:
            database.rollback()
            raise
        finally:
            database.close()

    def put_source(self, source: bytes) -> tuple[dict[str, Any], bool]:
        """Retain arbitrary source-file bytes without inferring scientific semantics."""
        self._check_size(source)
        with self._connection() as database:
            database.execute("BEGIN IMMEDIATE")
            return self._insert(database, "sources", source)

    def put(self, kind: str, source: bytes) -> tuple[dict[str, Any], bool]:
        """Validate a resource and all pinned dependencies in the same transaction."""
        if kind not in RESOURCE_SCHEMAS:
            raise ContractError("unsupported V7 resource kind")
        payload = parse_dataset_bytes(source)
        validate_research(RESOURCE_SCHEMAS[kind], payload)
        normalized = canonical_json(payload).encode("utf-8")
        self._check_size(normalized)
        with self._connection() as database:
            database.execute("BEGIN IMMEDIATE")
            self._validate_references(database, payload)
            return self._insert(database, kind, normalized)

    @staticmethod
    def _check_size(source: bytes) -> None:
        if not source or len(source) > MAX_DATASET_BYTES:
            raise DatasetTooLargeError(
                "research objects must contain 1 to 8388608 bytes"
            )

    def _insert(self, database: Any, kind: str, source: bytes):
        digest = sha256(source).hexdigest()
        existing = database.execute(
            "SELECT bytes FROM objects WHERE kind=? AND hash=?", (kind, digest)
        ).fetchone()
        descriptor = self._descriptor(kind, digest, len(source))
        if existing is not None:
            if existing[0] != source:
                raise ContractError(
                    "stored research object failed integrity verification"
                )
            return descriptor, False
        count, used = database.execute(
            "SELECT COUNT(*), COALESCE(SUM(LENGTH(bytes)), 0) FROM objects"
        ).fetchone()
        if count >= self.max_objects or used + len(source) > self.max_bytes:
            raise DatasetCapacityError("persistent research input quota exhausted")
        database.execute(
            "INSERT INTO objects(kind, hash, bytes) VALUES (?, ?, ?)",
            (kind, digest, source),
        )
        return descriptor, True

    def get_bytes(self, kind: str, digest: str) -> bytes:
        """Return verified original/canonical bytes; no unverified data reaches clients."""
        if not re.fullmatch("[0-9a-f]{64}", digest):
            raise KeyError(digest)
        with self._connection() as database:
            row = database.execute(
                "SELECT bytes FROM objects WHERE kind=? AND hash=?", (kind, digest)
            ).fetchone()
        if row is None:
            raise KeyError(digest)
        source = bytes(row[0])
        if sha256(source).hexdigest() != digest:
            raise ContractError("stored research object failed integrity verification")
        return source

    def list(self, kind: str) -> list[dict[str, Any]]:
        """Return a bounded descriptor list in stable content-hash order."""
        with self._connection() as database:
            rows = database.execute(
                "SELECT hash, LENGTH(bytes) FROM objects WHERE kind=? ORDER BY hash LIMIT ?",
                (kind, self.max_objects),
            ).fetchall()
        return [self._descriptor(kind, digest, size) for digest, size in rows]

    @staticmethod
    def _descriptor(kind: str, digest: str, size: int) -> dict[str, Any]:
        version = {"sources": "opaque-bytes", "workspaces": "workspace-v2"}.get(
            kind, "science-v7"
        )
        return {
            "schemaVersion": "science-resource-v7",
            "resourceSchemaVersion": version,
            "kind": kind,
            "hash": digest,
            "byteLength": size,
        }

    @staticmethod
    def _require(database: Any, digest: str, kind: str | None = None) -> None:
        rows = database.execute(
            "SELECT kind, bytes FROM objects WHERE hash=?", (digest,)
        ).fetchall()
        found = [source for actual, source in rows if kind is None or actual == kind]
        if not found or any(sha256(source).hexdigest() != digest for source in found):
            raise ContractError(
                f"missing or corrupt pinned {kind or 'input'} object {digest}"
            )

    def _validate_references(self, database: Any, payload: dict[str, Any]) -> None:
        singular = {
            "sourceHash": "sources",
            "educationArchiveHash": "sources",
            "provenanceHash": "provenance",
            "scenarioHash": "scenarios",
        }
        plural = {
            "sourceHashes": "sources",
            "inputHashes": None,
            "scenarioHashes": "scenarios",
            "observationHashes": "observations",
            "calibrationHashes": "calibrations",
            "resultHashes": "results",
        }
        for key, kind in singular.items():
            if key in payload:
                self._require(database, payload[key], kind)
        for key, kind in plural.items():
            for digest in payload.get(key, []):
                self._require(database, digest, kind)
        for correction in payload.get("correctionHistory", []):
            self._require(database, correction["provenanceHash"], "provenance")
        for digest in payload.get("timeConvention", {}).get("referenceDataHashes", []):
            self._require(database, digest, "sources")
        self._validate_lineage(database, payload)

    @staticmethod
    def _validate_lineage(database: Any, payload: dict[str, Any]) -> None:
        if "provenanceHash" not in payload:
            return
        raw = database.execute(
            "SELECT bytes FROM objects WHERE kind='provenance' AND hash=?",
            (payload["provenanceHash"],),
        ).fetchone()[0]
        inputs = set(json.loads(raw)["inputHashes"])
        declared_sources = set(payload.get("sourceHashes", []))
        for key in ("sourceHash", "educationArchiveHash"):
            if key in payload:
                declared_sources.add(payload[key])
        if not declared_sources <= inputs:
            raise ContractError(
                "provenance must directly name all declared original source hashes"
            )

    def validate_job_inputs(self, payload: dict[str, Any]) -> None:
        """Check immutable bindings even when qualified execution is unavailable."""
        validate_research("science-v7/job-request.schema.json", payload)
        with self._connection() as database:
            self._validate_references(database, payload)
            pinned = set(payload["calibrationHashes"])
            for digest in payload["observationHashes"]:
                row = database.execute(
                    "SELECT bytes FROM objects WHERE kind='observations' AND hash=?",
                    (digest,),
                ).fetchone()
                observation = json.loads(row[0])
                if not set(observation["calibrationHashes"]) <= pinned:
                    raise ContractError("job must pin every observation calibration")
