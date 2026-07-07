package earthlysearch

import (
	"encoding/json"
	"math"
	"testing"
)

func TestGeohashEncodeKnownVectors(t *testing.T) {
	// Classic geohash.org test vector.
	if got := encodeGeohash(-5.6, 42.6, 5); got != "ezs42" {
		t.Errorf("encodeGeohash(-5.6, 42.6, 5) = %q, want ezs42", got)
	}
	// Vienna city center is in the u2ed cell.
	if got := encodeGeohash(16.3738, 48.2082, 4); got != "u2ed" {
		t.Errorf("encodeGeohash(Vienna, 4) = %q, want u2ed", got)
	}
}

func TestGeohashRoundTrip(t *testing.T) {
	lon, lat := 16.3738, 48.2082
	hash := encodeGeohash(lon, lat, 9)
	gotLon, gotLat, err := decodeGeohashCenter(hash)
	if err != nil {
		t.Fatal(err)
	}
	if math.Abs(gotLon-lon) > 0.001 || math.Abs(gotLat-lat) > 0.001 {
		t.Errorf("round trip drifted: got %f,%f want %f,%f", gotLon, gotLat, lon, lat)
	}
}

func TestGeohashPrecisions(t *testing.T) {
	hashes := geohashPrecisions(16.3738, 48.2082)
	if len(hashes) != 7 {
		t.Fatalf("want 7 precisions, got %d", len(hashes))
	}
	if hashes[0] != "u" || hashes[3] != "u2ed" {
		t.Errorf("unexpected prefixes: %v", hashes)
	}
}

// anyRing converts a normalized []any ring back to typed positions.
func anyRing(t *testing.T, shape map[string]any, ringIdx int) [][]float64 {
	t.Helper()
	rings, isSlice := shape["coordinates"].([]any)
	if !isSlice || len(rings) <= ringIdx {
		t.Fatalf("unexpected coordinates shape: %#v", shape["coordinates"])
	}
	ring := rings[ringIdx].([]any)
	out := make([][]float64, len(ring))
	for i, p := range ring {
		pos := p.([]any)
		out[i] = []float64{pos[0].(float64), pos[1].(float64)}
	}
	return out
}

func TestNormalizePolygonOrientsCW(t *testing.T) {
	// Clockwise square — must come out counter-clockwise and closed.
	cw := `{"type":"Polygon","coordinates":[[[0,0],[0,1],[1,1],[1,0],[0,0]]]}`
	var g geoJSONGeometry
	if err := json.Unmarshal([]byte(cw), &g); err != nil {
		t.Fatal(err)
	}
	shape := normalizeGeometry(&g)
	if shape == nil {
		t.Fatal("normalization rejected a valid polygon")
	}
	if area := signedRingArea(anyRing(t, shape, 0)); area <= 0 {
		t.Errorf("exterior ring not CCW after normalization, area=%f", area)
	}
}

func TestNormalizeOpenRingGetsClosed(t *testing.T) {
	open := `{"type":"Polygon","coordinates":[[[0,0],[1,0],[1,1],[0,1]]]}`
	var g geoJSONGeometry
	if err := json.Unmarshal([]byte(open), &g); err != nil {
		t.Fatal(err)
	}
	shape := normalizeGeometry(&g)
	if shape == nil {
		t.Fatal("normalization rejected an open ring")
	}
	ring := anyRing(t, shape, 0)
	first, last := ring[0], ring[len(ring)-1]
	if first[0] != last[0] || first[1] != last[1] {
		t.Error("ring not closed after normalization")
	}
}

func TestNormalizeRejectsInvalidCoordinates(t *testing.T) {
	bad := `{"type":"Point","coordinates":[200,95]}`
	var g geoJSONGeometry
	if err := json.Unmarshal([]byte(bad), &g); err != nil {
		t.Fatal(err)
	}
	if shape := normalizeGeometry(&g); shape != nil {
		t.Error("out-of-range point should be rejected")
	}
}

func TestParseBboxTag(t *testing.T) {
	box, err := parseBboxTag("16.1,48.1,16.7,48.4")
	if err != nil {
		t.Fatal(err)
	}
	if box[0] != 16.1 || box[3] != 48.4 {
		t.Errorf("unexpected bbox: %v", box)
	}
	if _, err := parseBboxTag("16.7,48.4,16.1,48.1"); err == nil {
		t.Error("inverted bbox should fail")
	}
	if _, err := parseBboxTag("1,2,3"); err == nil {
		t.Error("3-element bbox should fail")
	}
}

func TestGeometryBounds(t *testing.T) {
	shape := map[string]any{
		"type": "geometrycollection",
		"geometries": []any{
			map[string]any{"type": "point", "coordinates": []float64{16.3, 48.2}},
			map[string]any{"type": "point", "coordinates": []float64{16.5, 48.4}},
		},
	}
	w, s, e, n, ok := geometryBounds(shape)
	if !ok {
		t.Fatal("no bounds found")
	}
	if w != 16.3 || s != 48.2 || e != 16.5 || n != 48.4 {
		t.Errorf("bounds = %f,%f,%f,%f", w, s, e, n)
	}
}
