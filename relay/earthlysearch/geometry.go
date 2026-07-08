package earthlysearch

import (
	"encoding/json"
	"fmt"
	"math"
	"strconv"
	"strings"
)

// GeoJSON parsing and normalization for bleve geoshape indexing.
//
// bleve's geoshape fields require closed polygon rings in counter-clockwise
// order for exteriors (holes clockwise), and valid WGS-84 coordinate ranges.
// Real-world GeoJSON is sloppy about all of these, so everything that goes
// into the index passes through normalizeGeometry. Features that fail
// normalization are dropped from geo indexing (text fields still index).

type geoJSONGeometry struct {
	Type        string            `json:"type"`
	Coordinates json.RawMessage   `json:"coordinates,omitempty"`
	Geometries  []geoJSONGeometry `json:"geometries,omitempty"`
}

type geoJSONFeature struct {
	Type       string           `json:"type"`
	ID         any              `json:"id,omitempty"`
	Geometry   *geoJSONGeometry `json:"geometry"`
	Properties map[string]any   `json:"properties"`
}

type geoJSONFeatureCollection struct {
	Type     string           `json:"type"`
	Name     string           `json:"name,omitempty"`
	Features []geoJSONFeature `json:"features"`
}

func validLonLat(lon, lat float64) bool {
	return lon >= -180 && lon <= 180 && lat >= -90 && lat <= 90 &&
		!math.IsNaN(lon) && !math.IsNaN(lat)
}

// bleve's geoshape field extraction type-asserts []interface{} at every
// nesting level (it is written for JSON-decoded documents) — typed float
// slices silently index NOTHING. All shape values we hand to the index
// therefore use []any nesting, with positions as position() values.

func position(lon, lat float64) []any {
	return []any{lon, lat}
}

func ringToAny(ring [][]float64) []any {
	out := make([]any, len(ring))
	for i, pt := range ring {
		out[i] = position(pt[0], pt[1])
	}
	return out
}

func ringsToAny(rings [][][]float64) []any {
	out := make([]any, len(rings))
	for i, ring := range rings {
		out[i] = ringToAny(ring)
	}
	return out
}

// signedRingArea computes the shoelace signed area of a ring in planar
// lon/lat space. Positive = counter-clockwise.
func signedRingArea(ring [][]float64) float64 {
	area := 0.0
	for i := 0; i < len(ring)-1; i++ {
		area += ring[i][0]*ring[i+1][1] - ring[i+1][0]*ring[i][1]
	}
	return area / 2
}

func reverseRing(ring [][]float64) {
	for i, j := 0, len(ring)-1; i < j; i, j = i+1, j-1 {
		ring[i], ring[j] = ring[j], ring[i]
	}
}

// normalizeRing closes an open ring, validates its points, and orients it.
// wantCCW is true for exterior rings, false for holes.
func normalizeRing(ring [][]float64, wantCCW bool) ([][]float64, error) {
	if len(ring) < 3 {
		return nil, fmt.Errorf("ring has %d points", len(ring))
	}
	for _, pt := range ring {
		if len(pt) < 2 || !validLonLat(pt[0], pt[1]) {
			return nil, fmt.Errorf("invalid ring coordinate")
		}
	}
	first, last := ring[0], ring[len(ring)-1]
	if first[0] != last[0] || first[1] != last[1] {
		ring = append(ring, []float64{first[0], first[1]})
	}
	if len(ring) < 4 {
		return nil, fmt.Errorf("ring too small after closing")
	}
	isCCW := signedRingArea(ring) > 0
	if isCCW != wantCCW {
		reverseRing(ring)
	}
	return ring, nil
}

func decodePosition(raw json.RawMessage) ([]float64, error) {
	var pt []float64
	if err := json.Unmarshal(raw, &pt); err != nil {
		return nil, err
	}
	if len(pt) < 2 || !validLonLat(pt[0], pt[1]) {
		return nil, fmt.Errorf("invalid position")
	}
	return pt[:2], nil
}

func normalizePolygon(rings [][][]float64) ([][][]float64, error) {
	if len(rings) == 0 {
		return nil, fmt.Errorf("polygon has no rings")
	}
	out := make([][][]float64, 0, len(rings))
	for i, ring := range rings {
		normalized, err := normalizeRing(ring, i == 0)
		if err != nil {
			return nil, err
		}
		out = append(out, normalized)
	}
	return out, nil
}

// normalizeGeometry converts a parsed GeoJSON geometry into the
// map[string]any shape bleve's geoshape field parser expects, applying ring
// orientation and coordinate validation. Returns nil when the geometry
// cannot be indexed safely.
func normalizeGeometry(g *geoJSONGeometry) map[string]any {
	if g == nil {
		return nil
	}
	switch strings.ToLower(g.Type) {
	case "point":
		pt, err := decodePosition(g.Coordinates)
		if err != nil {
			return nil
		}
		return map[string]any{"type": "point", "coordinates": position(pt[0], pt[1])}

	case "multipoint", "linestring":
		var pts [][]float64
		if err := json.Unmarshal(g.Coordinates, &pts); err != nil || len(pts) == 0 {
			return nil
		}
		for _, pt := range pts {
			if len(pt) < 2 || !validLonLat(pt[0], pt[1]) {
				return nil
			}
		}
		if strings.ToLower(g.Type) == "linestring" && len(pts) < 2 {
			return nil
		}
		return map[string]any{"type": strings.ToLower(g.Type), "coordinates": ringToAny(pts)}

	case "multilinestring":
		var lines [][][]float64
		if err := json.Unmarshal(g.Coordinates, &lines); err != nil || len(lines) == 0 {
			return nil
		}
		for _, line := range lines {
			if len(line) < 2 {
				return nil
			}
			for _, pt := range line {
				if len(pt) < 2 || !validLonLat(pt[0], pt[1]) {
					return nil
				}
			}
		}
		return map[string]any{"type": "multilinestring", "coordinates": ringsToAny(lines)}

	case "polygon":
		var rings [][][]float64
		if err := json.Unmarshal(g.Coordinates, &rings); err != nil {
			return nil
		}
		normalized, err := normalizePolygon(rings)
		if err != nil {
			return nil
		}
		return map[string]any{"type": "polygon", "coordinates": ringsToAny(normalized)}

	case "multipolygon":
		var polys [][][][]float64
		if err := json.Unmarshal(g.Coordinates, &polys); err != nil || len(polys) == 0 {
			return nil
		}
		out := make([]any, 0, len(polys))
		for _, rings := range polys {
			normalized, err := normalizePolygon(rings)
			if err != nil {
				return nil
			}
			out = append(out, ringsToAny(normalized))
		}
		return map[string]any{"type": "multipolygon", "coordinates": out}

	case "geometrycollection":
		shapes := make([]any, 0, len(g.Geometries))
		for i := range g.Geometries {
			if s := normalizeGeometry(&g.Geometries[i]); s != nil {
				shapes = append(shapes, s)
			}
		}
		if len(shapes) == 0 {
			return nil
		}
		return map[string]any{"type": "geometrycollection", "geometries": shapes}
	}
	return nil
}

// geometryBounds walks a normalized geometry value and expands the bbox.
// Returns w, s, e, n and ok=false when no coordinates were found.
func geometryBounds(value map[string]any) (w, s, e, n float64, ok bool) {
	w, s, e, n = 180, 90, -180, -90
	var walk func(v any)
	walk = func(v any) {
		switch t := v.(type) {
		case []float64:
			if len(t) >= 2 {
				w, e = math.Min(w, t[0]), math.Max(e, t[0])
				s, n = math.Min(s, t[1]), math.Max(n, t[1])
				ok = true
			}
		case [][]float64:
			for _, c := range t {
				walk(c)
			}
		case [][][]float64:
			for _, c := range t {
				walk(c)
			}
		case [][][][]float64:
			for _, c := range t {
				walk(c)
			}
		case []any:
			// A position is []any{lon, lat} after normalization.
			if len(t) >= 2 {
				if lon, isF := t[0].(float64); isF {
					if lat, isF := t[1].(float64); isF {
						w, e = math.Min(w, lon), math.Max(e, lon)
						s, n = math.Min(s, lat), math.Max(n, lat)
						ok = true
						return
					}
				}
			}
			for _, c := range t {
				walk(c)
			}
		case map[string]any:
			if coords, found := t["coordinates"]; found {
				walk(coords)
			}
			if geoms, found := t["geometries"]; found {
				walk(geoms)
			}
		}
	}
	walk(value)
	return w, s, e, n, ok
}

// parseBboxTag parses the SPEC §1.1 "w,s,e,n" bbox tag value.
func parseBboxTag(v string) (*[4]float64, error) {
	parts := strings.Split(v, ",")
	if len(parts) != 4 {
		return nil, fmt.Errorf("bbox needs 4 values, got %d", len(parts))
	}
	var box [4]float64
	for i, p := range parts {
		f, err := strconv.ParseFloat(strings.TrimSpace(p), 64)
		if err != nil {
			return nil, fmt.Errorf("bbox value %q: %w", p, err)
		}
		box[i] = f
	}
	if !validLonLat(box[0], box[1]) || !validLonLat(box[2], box[3]) || box[0] > box[2] || box[1] > box[3] {
		return nil, fmt.Errorf("bbox out of range or inverted")
	}
	return &box, nil
}

func bboxArea(box [4]float64) float64 {
	return (box[2] - box[0]) * (box[3] - box[1])
}

func bboxCentroid(box [4]float64) (lon, lat float64) {
	return (box[0] + box[2]) / 2, (box[1] + box[3]) / 2
}

// --- geohash ---

const geohashBase32 = "0123456789bcdefghjkmnpqrstuvwxyz"

// encodeGeohash encodes lon/lat to a geohash of the given precision.
func encodeGeohash(lon, lat float64, precision int) string {
	var sb strings.Builder
	sb.Grow(precision)
	latMin, latMax := -90.0, 90.0
	lonMin, lonMax := -180.0, 180.0
	even := true
	bit, idx := 0, 0
	for sb.Len() < precision {
		if even {
			mid := (lonMin + lonMax) / 2
			if lon >= mid {
				idx = idx*2 + 1
				lonMin = mid
			} else {
				idx = idx * 2
				lonMax = mid
			}
		} else {
			mid := (latMin + latMax) / 2
			if lat >= mid {
				idx = idx*2 + 1
				latMin = mid
			} else {
				idx = idx * 2
				latMax = mid
			}
		}
		even = !even
		bit++
		if bit == 5 {
			sb.WriteByte(geohashBase32[idx])
			bit, idx = 0, 0
		}
	}
	return sb.String()
}

// decodeGeohashCenter decodes a geohash to its cell center lon/lat.
func decodeGeohashCenter(hash string) (lon, lat float64, err error) {
	latMin, latMax := -90.0, 90.0
	lonMin, lonMax := -180.0, 180.0
	even := true
	for _, c := range strings.ToLower(hash) {
		idx := strings.IndexRune(geohashBase32, c)
		if idx < 0 {
			return 0, 0, fmt.Errorf("invalid geohash character %q", c)
		}
		for mask := 16; mask > 0; mask >>= 1 {
			if even {
				mid := (lonMin + lonMax) / 2
				if idx&mask != 0 {
					lonMin = mid
				} else {
					lonMax = mid
				}
			} else {
				mid := (latMin + latMax) / 2
				if idx&mask != 0 {
					latMin = mid
				} else {
					latMax = mid
				}
			}
			even = !even
		}
	}
	return (lonMin + lonMax) / 2, (latMin + latMax) / 2, nil
}

// geohashPrecisions returns the centroid geohash at every precision 1..7,
// which is what lets clients query any zoom level with exact #g matches.
func geohashPrecisions(lon, lat float64) []string {
	full := encodeGeohash(lon, lat, 7)
	out := make([]string, 7)
	for i := 1; i <= 7; i++ {
		out[i-1] = full[:i]
	}
	return out
}
