package earthlysearch

import (
	"fmt"
	"strconv"
	"strings"
	"time"
)

// The Earthly NIP-50 extension grammar (docs/GEO_SEARCH_REWRITE.md §4).
//
// A search string is free text plus space-separated `key:value` tokens.
// Only tokens with a KNOWN key are consumed as extensions; anything else
// (including URLs and unknown keys) stays in the free text, so foreign
// search strings pass through untouched. The same grammar is serialized by
// the client facade in src/lib/search/ — both sides are pinned by the golden
// vectors in spec/search-grammar-vectors.json.

const GrammarVersion = 1

// GrammarExtensions is advertised via the /earthly-search capability
// endpoint (referenced from NIP-11) for client feature detection.
var GrammarExtensions = []string{
	"bbox", "point", "rel", "near", "radius",
	"label", "tag", "ref", "start-after", "start-before", "sort",
}

const (
	RelIntersects = "intersects"
	RelContains   = "contains"
	RelWithin     = "within"

	SortRelevance = "relevance"
	SortDistance  = "distance"
	SortRecent    = "recent"
	SortScale     = "scale"
)

// SearchParams is the parsed form of an extended NIP-50 search string.
type SearchParams struct {
	Text string `json:"text"`

	BBox     *[4]float64 `json:"bbox"`  // w,s,e,n
	Point    *[2]float64 `json:"point"` // lon,lat
	Rel      string      `json:"rel"`   // geo relation of indexed geometry to query shape
	Near     string      `json:"near"`  // geohash proximity origin
	RadiusKm float64     `json:"radiusKm"`

	Labels   []string `json:"labels"`
	Hashtags []string `json:"hashtags"`
	Refs     []string `json:"refs"`

	StartAfter  int64 `json:"startAfter"`  // NIP-52 start >= (epoch seconds)
	StartBefore int64 `json:"startBefore"` // NIP-52 start <= (epoch seconds)

	Sort string `json:"sort"`
}

// HasGeo reports whether any spatial constraint is present.
func (p SearchParams) HasGeo() bool {
	return p.BBox != nil || p.Point != nil || p.Near != ""
}

func parseTimeValue(v string) (int64, error) {
	if ts, err := strconv.ParseInt(v, 10, 64); err == nil {
		return ts, nil
	}
	t, err := time.Parse("2006-01-02", v)
	if err != nil {
		return 0, fmt.Errorf("expected epoch seconds or YYYY-MM-DD, got %q", v)
	}
	return t.Unix(), nil
}

func parseRadius(v string) (float64, error) {
	var factor float64
	var num string
	switch {
	case strings.HasSuffix(v, "km"):
		factor, num = 1, strings.TrimSuffix(v, "km")
	case strings.HasSuffix(v, "m"):
		factor, num = 0.001, strings.TrimSuffix(v, "m")
	default:
		return 0, fmt.Errorf("radius needs a km or m suffix, got %q", v)
	}
	f, err := strconv.ParseFloat(num, 64)
	if err != nil || f <= 0 {
		return 0, fmt.Errorf("invalid radius %q", v)
	}
	return f * factor, nil
}

func isValidGeohash(v string) bool {
	if len(v) < 1 || len(v) > 9 {
		return false
	}
	for _, c := range v {
		if !strings.ContainsRune(geohashBase32, c) {
			return false
		}
	}
	return true
}

// ParseSearch splits an extended search string into free text and typed
// parameters. A recognized key with a malformed value is a hard error (the
// relay rejects the filter with a useful message) — silently dropping a geo
// constraint would return wrong results.
func ParseSearch(s string) (SearchParams, error) {
	params := SearchParams{Rel: RelIntersects, Sort: SortRelevance}
	var text []string

	for _, token := range strings.Fields(s) {
		key, value, found := strings.Cut(token, ":")
		if !found || value == "" {
			text = append(text, token)
			continue
		}

		switch key {
		case "bbox":
			box, err := parseBboxTag(value)
			if err != nil {
				return params, fmt.Errorf("bbox: %w", err)
			}
			params.BBox = box

		case "point":
			parts := strings.Split(value, ",")
			if len(parts) != 2 {
				return params, fmt.Errorf("point needs lon,lat, got %q", value)
			}
			lon, err1 := strconv.ParseFloat(parts[0], 64)
			lat, err2 := strconv.ParseFloat(parts[1], 64)
			if err1 != nil || err2 != nil || !validLonLat(lon, lat) {
				return params, fmt.Errorf("invalid point %q", value)
			}
			params.Point = &[2]float64{lon, lat}

		case "rel":
			switch value {
			case RelIntersects, RelContains, RelWithin:
				params.Rel = value
			default:
				return params, fmt.Errorf("rel must be intersects|contains|within, got %q", value)
			}

		case "near":
			if !isValidGeohash(value) {
				return params, fmt.Errorf("near expects a geohash, got %q", value)
			}
			params.Near = strings.ToLower(value)

		case "radius":
			km, err := parseRadius(value)
			if err != nil {
				return params, err
			}
			params.RadiusKm = km

		case "label":
			params.Labels = append(params.Labels, value)

		case "tag":
			params.Hashtags = append(params.Hashtags, value)

		case "ref":
			params.Refs = append(params.Refs, value)

		case "start-after":
			ts, err := parseTimeValue(value)
			if err != nil {
				return params, fmt.Errorf("start-after: %w", err)
			}
			params.StartAfter = ts

		case "start-before":
			ts, err := parseTimeValue(value)
			if err != nil {
				return params, fmt.Errorf("start-before: %w", err)
			}
			params.StartBefore = ts

		case "sort":
			switch value {
			case SortRelevance, SortDistance, SortRecent, SortScale:
				params.Sort = value
			default:
				return params, fmt.Errorf("sort must be relevance|distance|recent|scale, got %q", value)
			}

		default:
			// Unknown key — leave it in the free text (URLs, "re:", foreign
			// relay extensions). Only known keys are grammar.
			text = append(text, token)
		}
	}

	if params.Sort == SortDistance && params.Point == nil && params.Near == "" {
		return params, fmt.Errorf("sort:distance requires point: or near:")
	}
	if params.RadiusKm > 0 && params.Near == "" && params.Point == nil {
		return params, fmt.Errorf("radius: requires near: or point:")
	}

	params.Text = strings.Join(text, " ")
	return params, nil
}
