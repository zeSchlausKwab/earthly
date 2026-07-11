# World basic-data layers

Static reference layers for AI geo-awareness (land/water validation, anchor
context, `world` sandbox global). See `docs/AI_GEO_AWARENESS.md`.

| File | Source | License |
|---|---|---|
| `land_110m.json`, `land_50m.json`, `coastline_110m.json`, `countries_110m.json`, `borders_110m.json`, `rivers_110m.json`, `rivers_50m.json`, `lakes_110m.json`, `cities_110m.json` | [Natural Earth](https://www.naturalearthdata.com/) (via [martynafford/natural-earth-geojson](https://github.com/martynafford/natural-earth-geojson)) | Public domain |
| `maritime_network.json` | [Eurostat searoute](https://github.com/eurostat/searoute) marnet (via [genthalili/searoute-py](https://github.com/genthalili/searoute-py)) | EUPL-1.2 / Apache-2.0 |

Properties are slimmed and coordinates rounded to 4 decimals (~11 m) —
regenerate from the sources above if new themes or higher precision are needed.
