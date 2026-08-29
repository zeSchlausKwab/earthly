#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "duckdb==1.4.3",
# ]
# ///

"""Export a reviewed Overture planet-lite slice for Earthly GeoCatalog builds.

The exporter queries one pinned Overture release directly from its official
public S3 GeoParquet paths. It writes six local gzip-compressed GeoJSONSeq files
that can be passed to scripts/build-geocatalog.ts. The runtime GeoCatalog never
calls S3.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import io
import json
import os
import re
import secrets
import signal
import shutil
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

import duckdb


POLICY_ID = "earthly-overture-planet-lite-v1"
RELEASE_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}\.\d+$")
DEFAULT_RESERVE_GIB = 4.0
CHECK_DISK_EVERY_ROWS = 2_000
FETCH_ROWS = 512


def sql_string(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def sql_identifier(value: str) -> str:
    return '"' + value.replace('"', '""') + '"'


def sql_values(values: Iterable[str]) -> str:
    return ", ".join(sql_string(value) for value in values)


ADMIN_LOCALITY_SUBTYPES = (
    "borough",
    "locality",
    "macrohood",
    "microhood",
    "neighborhood",
)

PLACE_EXACT_CATEGORIES = (
    "airport",
    "ambulance_station",
    "archaeological_site",
    "art_gallery",
    "beach",
    "border_crossing",
    "bus_station",
    "cave",
    "clinic",
    "college",
    "courthouse",
    "embassy",
    "emergency_room",
    "ferry_terminal",
    "fire_station",
    "government_office",
    "hospital",
    "library",
    "marina",
    "memorial",
    "monument",
    "mountain",
    "museum",
    "national_park",
    "nature_reserve",
    "park",
    "pharmacy",
    "place_of_worship",
    "police_station",
    "port",
    "post_office",
    "protected_area",
    "rescue_station",
    "school",
    "theatre",
    "town_hall",
    "train_station",
    "university",
    "volcano",
    "waterfall",
)

WATER_SUBTYPES = (
    "canal",
    "lake",
    "ocean",
    "pond",
    "reservoir",
    "river",
    "spring",
    "stream",
    "water",
)

PHYSICAL_WATER_CLASSES = ("bay", "ocean", "sea", "strait")

# This is intentionally narrower than the runtime importer's defensive
# allowlist. Planet exports omit high-volume line/pole/stop/platform classes;
# regional snapshots may still export those with their own reviewed policy.
INFRASTRUCTURE_NAMED_CLASSES = (
    "airport",
    "airstrip",
    "border_control",
    "bus_station",
    "dam",
    "ferry_terminal",
    "helipad",
    "heliport",
    "international_airport",
    "military_airport",
    "municipal_airport",
    "private_airport",
    "railway_halt",
    "railway_station",
    "regional_airport",
    "runway",
    "seaplane_airport",
    "siren",
    "subway_station",
    "terminal",
    "water_tower",
    "weir",
)

# Names alone are not a useful significance signal for these high-volume
# classes. Bridge features commonly inherit the road name, for example, while
# small off-grid hotels may carry power=plant. Canonical identities retain the
# notable members without flooding ordinary place searches. Power plants with
# explicit plant metadata and transmission substations are handled separately
# below so useful local infrastructure does not require Wikidata coverage.
INFRASTRUCTURE_CANONICAL_CLASSES = (
    "bridge",
    "communication_tower",
    "generator",
    "mobile_phone_tower",
    "plant",
    "substation",
    "transformer",
)

COMMON_PROPERTY_COLUMNS = (
    "bbox",
    "version",
    "sources",
    "names",
    "name",
    "country",
)


@dataclass(frozen=True)
class SourceSpec:
    feature_type: str
    theme: str
    overture_type: str
    where: str
    selection: str
    property_columns: tuple[str, ...]

    @property
    def output_name(self) -> str:
        return f"{self.feature_type}.geojsonseq.gz"

    def uri(self, release: str) -> str:
        return (
            "s3://overturemaps-us-west-2/release/"
            f"{release}/theme={self.theme}/type={self.overture_type}/*.parquet"
        )


SOURCE_SPECS = (
    SourceSpec(
        feature_type="division_area",
        theme="divisions",
        overture_type="division_area",
        where="admin_level BETWEEN 0 AND 2 AND names.primary IS NOT NULL",
        selection="named administrative areas at hierarchy levels 0 through 2",
        property_columns=COMMON_PROPERTY_COLUMNS
        + (
            "subtype",
            "class",
            "division_id",
            "region",
            "admin_level",
            "is_land",
            "is_territorial",
        ),
    ),
    SourceSpec(
        feature_type="division",
        theme="divisions",
        overture_type="division",
        where=(
            "names.primary IS NOT NULL AND ("
            f"subtype NOT IN ({sql_values(ADMIN_LOCALITY_SUBTYPES)}) "
            "OR class IN ('city', 'town', 'village', 'hamlet') "
            "OR (subtype = 'locality' AND class IS NULL "
            "AND COALESCE(cartography.prominence, 0) >= 25))"
        ),
        selection=(
            "named administrative labels; all cities, towns, villages, and hamlets; "
            "unclassified localities with prominence >= 25"
        ),
        property_columns=COMMON_PROPERTY_COLUMNS
        + (
            "subtype",
            "class",
            "local_type",
            "region",
            "hierarchies",
            "parent_division_id",
            "capital_of_divisions",
            "cartography",
            "wikidata",
        ),
    ),
    SourceSpec(
        feature_type="place",
        theme="places",
        overture_type="place",
        where=(
            "names.primary IS NOT NULL "
            "AND confidence >= 0.8 "
            "AND COALESCE(operating_status, 'open') <> 'permanently_closed' "
            "AND ("
            f"basic_category IN ({sql_values(PLACE_EXACT_CATEGORIES)}) "
            f"OR taxonomy.primary IN ({sql_values(PLACE_EXACT_CATEGORIES)}) "
            f"OR categories.primary IN ({sql_values(PLACE_EXACT_CATEGORIES)}))"
        ),
        selection=(
            "named, open, confidence >= 0.8 public-interest, emergency, transport, "
            "education, cultural, and natural destinations"
        ),
        property_columns=COMMON_PROPERTY_COLUMNS
        + (
            "operating_status",
            "basic_category",
            "taxonomy",
            "categories",
            "confidence",
            "addresses",
            "websites",
            "phones",
            "brand",
        ),
    ),
    SourceSpec(
        feature_type="segment",
        theme="transportation",
        overture_type="segment",
        where=(
            "subtype IN ('road', 'rail', 'water') "
            "AND (subtype <> 'road' OR "
            "class IN ('motorway', 'trunk', 'primary', 'secondary')) "
            "AND COALESCE(len(routes), 0) > 0"
        ),
        selection=(
            "motorway/trunk/primary/secondary roads and rail/water transport with at least "
            "one explicit Overture route membership"
        ),
        property_columns=COMMON_PROPERTY_COLUMNS
        + (
            "subtype",
            "class",
            "subclass",
            "routes",
            "connectors",
            "road_flags",
            "rail_flags",
            "road_surface",
            "access_restrictions",
            "speed_limits",
        ),
    ),
    SourceSpec(
        feature_type="water",
        theme="base",
        overture_type="water",
        where=(
            "names.primary IS NOT NULL AND ("
            f"subtype IN ({sql_values(WATER_SUBTYPES)}) "
            f"OR class IN ({sql_values(WATER_SUBTYPES)}) "
            f"OR (subtype = 'physical' AND class IN ({sql_values(PHYSICAL_WATER_CLASSES)}))) "
            "AND (wikidata IS NOT NULL OR "
            "COALESCE(list_count(list_filter(sources, lambda source: "
            "starts_with(source.record_id, 'r'))), 0) > 0)"
        ),
        selection=(
            "named reviewed inland-water and marine feature classes with Wikidata or an "
            "OpenStreetMap relation source identity"
        ),
        property_columns=COMMON_PROPERTY_COLUMNS
        + (
            "subtype",
            "class",
            "is_intermittent",
            "is_salt",
            "level",
            "wikidata",
            "source_tags",
        ),
    ),
    SourceSpec(
        feature_type="infrastructure",
        theme="base",
        overture_type="infrastructure",
        where=(
            "("
            f"(class IN ({sql_values(INFRASTRUCTURE_NAMED_CLASSES)}) "
            "AND names.primary IS NOT NULL) "
            f"OR (class IN ({sql_values(INFRASTRUCTURE_CANONICAL_CLASSES)}) "
            "AND wikidata IS NOT NULL) "
            "OR (class = 'plant' AND names.primary IS NOT NULL AND "
            "(source_tags['plant:source'] IS NOT NULL OR "
            "source_tags['plant:output:electricity'] IS NOT NULL)) "
            "OR (class = 'substation' AND names.primary IS NOT NULL AND "
            "regexp_matches(COALESCE(source_tags['voltage'], ''), "
            "'(^|;)(1[0-9]{5}|[2-9][0-9]{5,})(;|$)')))"
        ),
        selection=(
            "named reviewed transport, emergency, dam, and water infrastructure; canonical "
            "bridge/power/tower features; explicit power plants; and named transmission "
            "substations, excluding ubiquitous component-scale infrastructure"
        ),
        property_columns=COMMON_PROPERTY_COLUMNS
        + (
            "subtype",
            "class",
            "height",
            "surface",
            "level",
            "wikidata",
            "source_tags",
        ),
    ),
)


def parse_bbox(value: str) -> tuple[float, float, float, float]:
    try:
        west, south, east, north = (float(part.strip()) for part in value.split(","))
    except (TypeError, ValueError) as error:
        raise argparse.ArgumentTypeError("bbox must be west,south,east,north") from error
    if not (-180 <= west <= east <= 180 and -90 <= south <= north <= 90):
        raise argparse.ArgumentTypeError("bbox contains invalid or wrapped WGS84 bounds")
    return west, south, east, north


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Export Earthly's reviewed Overture planet-lite selection to six compressed "
            "GeoJSONSeq files."
        )
    )
    parser.add_argument("--release", required=True, help="Pinned Overture YYYY-MM-DD.N release")
    parser.add_argument("--output-dir", required=True, type=Path, help="New output directory")
    parser.add_argument(
        "--bbox",
        type=parse_bbox,
        help="Optional smoke/regional coverage as west,south,east,north (default: global)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Query selected counts and print a JSON report without creating output files",
    )
    parser.add_argument(
        "--reserve-free-gib",
        type=float,
        default=DEFAULT_RESERVE_GIB,
        help=(
            "Abort before exhausting the output filesystem, preserving this many GiB "
            f"(default: {DEFAULT_RESERVE_GIB:g})"
        ),
    )
    args = parser.parse_args(argv)
    if not RELEASE_PATTERN.fullmatch(args.release):
        parser.error("--release must use the dated YYYY-MM-DD.N format")
    if args.reserve_free_gib < 0:
        parser.error("--reserve-free-gib must be zero or greater")
    return args


def terminate_export(_signum: int, _frame: Any) -> None:
    raise KeyboardInterrupt("export interrupted")


def connect(temp_directory: Path | None) -> duckdb.DuckDBPyConnection:
    connection = duckdb.connect(database=":memory:")
    for extension in ("httpfs", "spatial"):
        try:
            connection.execute(f"LOAD {extension}")
        except duckdb.Error:
            connection.execute(f"INSTALL {extension}")
            connection.execute(f"LOAD {extension}")
    connection.execute("SET s3_region='us-west-2'")
    connection.execute("SET preserve_insertion_order=false")
    if temp_directory is not None:
        connection.execute(f"SET temp_directory={sql_string(str(temp_directory))}")
    return connection


def read_parquet_sql(spec: SourceSpec, release: str) -> str:
    return (
        "read_parquet("
        f"{sql_string(spec.uri(release))}, hive_partitioning=true, union_by_name=true)"
    )


def spatial_filter(bbox: tuple[float, float, float, float] | None) -> str:
    if bbox is None:
        return ""
    west, south, east, north = bbox
    return (
        " AND bbox.xmin <= "
        f"{east!r} AND bbox.xmax >= {west!r} "
        f"AND bbox.ymin <= {north!r} AND bbox.ymax >= {south!r}"
    )


def selected_query(
    spec: SourceSpec,
    release: str,
    bbox: tuple[float, float, float, float] | None,
) -> str:
    return (
        f"SELECT * FROM {read_parquet_sql(spec, release)} "
        f"WHERE ({spec.where}){spatial_filter(bbox)}"
    )


def selected_columns(
    connection: duckdb.DuckDBPyConnection,
    spec: SourceSpec,
    release: str,
) -> list[str]:
    rows = connection.execute(
        f"DESCRIBE SELECT * FROM {read_parquet_sql(spec, release)}"
    ).fetchall()
    columns = [str(row[0]) for row in rows]
    missing = {"id", "geometry"}.difference(columns)
    if missing:
        raise RuntimeError(
            f"{spec.theme}/{spec.overture_type} is missing required columns: "
            + ", ".join(sorted(missing))
        )
    return columns


def projected_property_columns(columns: list[str], spec: SourceSpec) -> list[str]:
    available = set(columns)
    return [column for column in spec.property_columns if column in available]


def properties_json_sql(columns: list[str], spec: SourceSpec) -> str:
    property_columns = projected_property_columns(columns, spec)
    if not property_columns:
        return "'{}'"
    arguments: list[str] = []
    for column in property_columns:
        arguments.extend((sql_string(column), sql_identifier(column)))
    # Applying an RFC 7396 patch to an empty object removes null-valued keys,
    # including null fields inside projected structs. This keeps planet-scale
    # GeoJSONSeq inputs compact without changing any non-null source value.
    return "json_merge_patch('{}', json_object(" + ", ".join(arguments) + "))"


def export_query(
    connection: duckdb.DuckDBPyConnection,
    spec: SourceSpec,
    release: str,
    bbox: tuple[float, float, float, float] | None,
) -> tuple[str, list[str]]:
    columns = selected_columns(connection, spec, release)
    property_columns = projected_property_columns(columns, spec)
    return (
        (
            "SELECT CAST(id AS VARCHAR) AS feature_id, "
            "ST_AsGeoJSON(geometry) AS geometry_json, "
            f"{properties_json_sql(columns, spec)} AS properties_json "
            f"FROM ({selected_query(spec, release, bbox)}) selected"
        ),
        property_columns,
    )


def disk_free_bytes(path: Path) -> int:
    return shutil.disk_usage(path).free


def assert_disk_reserve(path: Path, reserve_bytes: int, context: str) -> int:
    free_bytes = disk_free_bytes(path)
    if free_bytes < reserve_bytes:
        raise RuntimeError(
            f"Insufficient free space {context}: {free_bytes / 2**30:.2f} GiB remains, "
            f"below the {reserve_bytes / 2**30:.2f} GiB reserve"
        )
    return free_bytes


def base_report(args: argparse.Namespace, free_before: int) -> dict[str, Any]:
    exporter_path = Path(__file__).resolve()
    exporter_digest = hashlib.sha256(exporter_path.read_bytes()).hexdigest()
    return {
        "schemaVersion": 1,
        "policyId": POLICY_ID,
        "release": args.release,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "dryRun": bool(args.dry_run),
        "coverage": (
            {"scope": "global"}
            if args.bbox is None
            else {"scope": "bbox", "bbox": list(args.bbox)}
        ),
        "outputDirectory": str(args.output_dir.resolve()),
        "reserveFreeBytes": int(args.reserve_free_gib * 2**30),
        "freeBytesBefore": free_before,
        "duckdbVersion": duckdb.__version__,
        "outputFormat": "GeoJSONSeq+gzip",
        "exporter": {
            "path": "scripts/export-overture-planet-lite.py",
            "sha256": exporter_digest,
        },
        "sources": [],
    }


def dry_run(args: argparse.Namespace, connection: duckdb.DuckDBPyConnection) -> dict[str, Any]:
    parent = args.output_dir.resolve().parent
    if not parent.exists():
        parent = Path.cwd()
    report = base_report(args, disk_free_bytes(parent))
    started = time.monotonic()
    for spec in SOURCE_SPECS:
        source_started = time.monotonic()
        print(
            f"Estimating {spec.theme}/{spec.overture_type}...",
            file=sys.stderr,
            flush=True,
        )
        count = int(
            connection.execute(
                f"SELECT count(*) FROM ({selected_query(spec, args.release, args.bbox)}) selected"
            ).fetchone()[0]
        )
        elapsed_seconds = round(time.monotonic() - source_started, 3)
        print(
            f"Selected {count:,} {spec.feature_type} records in {elapsed_seconds:.3f}s",
            file=sys.stderr,
            flush=True,
        )
        report["sources"].append(
            {
                "featureType": spec.feature_type,
                "theme": spec.theme,
                "type": spec.overture_type,
                "uri": spec.uri(args.release),
                "selection": spec.selection,
                "propertyColumns": projected_property_columns(
                    selected_columns(connection, spec, args.release), spec
                ),
                "selectedRecords": count,
                "elapsedSeconds": elapsed_seconds,
            }
        )
    report["elapsedSeconds"] = round(time.monotonic() - started, 3)
    return report


def write_feature_sequence(
    connection: duckdb.DuckDBPyConnection,
    query: str,
    output: Path,
    reserve_bytes: int,
    disk_path: Path,
) -> tuple[int, int, str]:
    cursor = connection.execute(query)
    records = 0
    with (
        output.open("xb") as raw_target,
        gzip.GzipFile(
            filename="",
            mode="wb",
            fileobj=raw_target,
            compresslevel=6,
            mtime=0,
        ) as compressed_target,
        io.TextIOWrapper(compressed_target, encoding="utf-8", newline="\n") as target,
    ):
        while rows := cursor.fetchmany(FETCH_ROWS):
            for feature_id, geometry_json, properties_json in rows:
                if geometry_json is None:
                    raise RuntimeError(f"Overture feature {feature_id} has no geometry")
                target.write(
                    '{"type":"Feature","id":'
                    + json.dumps(feature_id, ensure_ascii=False, separators=(",", ":"))
                    + ',"geometry":'
                    + str(geometry_json)
                    + ',"properties":'
                    + str(properties_json)
                    + "}\n"
                )
                records += 1
            if records % CHECK_DISK_EVERY_ROWS < FETCH_ROWS:
                assert_disk_reserve(disk_path, reserve_bytes, "while exporting")
    digest = hashlib.sha256()
    with output.open("rb") as exported:
        while chunk := exported.read(1024 * 1024):
            digest.update(chunk)
    return records, output.stat().st_size, digest.hexdigest()


def export(args: argparse.Namespace) -> dict[str, Any]:
    output_dir = args.output_dir.resolve()
    if os.path.lexists(output_dir):
        raise RuntimeError(f"Output directory already exists; refusing to replace it: {output_dir}")
    output_dir.parent.mkdir(parents=True, exist_ok=True)
    reserve_bytes = int(args.reserve_free_gib * 2**30)
    free_before = assert_disk_reserve(output_dir.parent, reserve_bytes, "before exporting")
    staging = output_dir.parent / (
        f".{output_dir.name}.partial-{os.getpid()}-{secrets.token_hex(4)}"
    )
    if os.path.lexists(staging):
        raise RuntimeError(f"Unexpected staging path already exists: {staging}")
    staging.mkdir()
    duckdb_temp = staging / ".duckdb-tmp"
    duckdb_temp.mkdir()
    connection: duckdb.DuckDBPyConnection | None = None
    try:
        connection = connect(duckdb_temp)
        report = base_report(args, free_before)
        started = time.monotonic()
        for spec in SOURCE_SPECS:
            source_started = time.monotonic()
            output = staging / spec.output_name
            print(
                f"Exporting {spec.theme}/{spec.overture_type} to {output.name}...",
                file=sys.stderr,
                flush=True,
            )
            query, property_columns = export_query(
                connection, spec, args.release, args.bbox
            )
            records, output_bytes, output_sha256 = write_feature_sequence(
                connection,
                query,
                output,
                reserve_bytes,
                output_dir.parent,
            )
            elapsed_seconds = round(time.monotonic() - source_started, 3)
            print(
                f"Exported {records:,} {spec.feature_type} records "
                f"({output_bytes / 2**20:.2f} MiB) in {elapsed_seconds:.3f}s",
                file=sys.stderr,
                flush=True,
            )
            report["sources"].append(
                {
                    "featureType": spec.feature_type,
                    "theme": spec.theme,
                    "type": spec.overture_type,
                    "uri": spec.uri(args.release),
                    "selection": spec.selection,
                    "propertyColumns": property_columns,
                    "selectedRecords": records,
                    "outputFile": spec.output_name,
                    "outputBytes": output_bytes,
                    "sha256": output_sha256,
                    "elapsedSeconds": elapsed_seconds,
                }
            )
        report["elapsedSeconds"] = round(time.monotonic() - started, 3)
        report["outputBytes"] = sum(source["outputBytes"] for source in report["sources"])
        report["freeBytesAfter"] = disk_free_bytes(output_dir.parent)
        connection.close()
        connection = None
        shutil.rmtree(duckdb_temp)
        report_path = staging / "export-report.json"
        report_path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n")
        if os.path.lexists(output_dir):
            raise RuntimeError(
                f"Output directory appeared during export; refusing to replace it: {output_dir}"
            )
        os.replace(staging, output_dir)
        return report
    except BaseException:
        if connection is not None:
            connection.close()
            connection = None
        if staging.exists():
            shutil.rmtree(staging)
        raise
    finally:
        if connection is not None:
            connection.close()


def main(argv: list[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    signal.signal(signal.SIGTERM, terminate_export)
    if not args.dry_run and os.path.lexists(args.output_dir.resolve()):
        print(
            f"Error: output directory already exists; refusing to replace it: "
            f"{args.output_dir.resolve()}",
            file=sys.stderr,
        )
        return 2
    try:
        if args.dry_run:
            connection = connect(None)
            try:
                report = dry_run(args, connection)
            finally:
                connection.close()
        else:
            report = export(args)
    except KeyboardInterrupt:
        print("Error: export interrupted; staging files were removed", file=sys.stderr)
        return 130
    except (duckdb.Error, OSError, RuntimeError) as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1
    print(json.dumps(report, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
