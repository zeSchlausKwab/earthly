# Live Mapper fixture

`liveuamap-yemen.sample.json` is an explicit copy of the user-supplied `all.json`.
The original file is unchanged. The source is attributed to Liveuamap.

The capture timestamp was not supplied. This is a captured sample, not live data.
The configured source URL contains a fixed `time` query whose meaning has not been
verified, so successful fetching alone does not establish dataset freshness.

The adapter interprets alternating source values as latitude/longitude, swaps them
to GeoJSON longitude/latitude, closes and orients exterior rings, and preserves
source identifiers and style properties. Two-point paths are explicitly diagnosed
and optionally retained as lines. Multiple polygon paths are interpreted as
separate exterior polygons; the source does not identify holes.

The exact same mapping function is embedded in `LIVE_MAPPER_HTML` and runs inside
the sandbox. The Earthly resource broker only acquires the original JSON bytes.
