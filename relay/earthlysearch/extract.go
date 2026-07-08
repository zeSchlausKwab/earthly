package earthlysearch

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

	"fiatjaf.com/nostr"
)

// Per-kind extraction of nostr events into bleve index documents.
// The document schema is specified in docs/GEO_SEARCH_REWRITE.md §5.

// Earthly kinds (authoritative source: src/lib/nostr/kinds.ts / SPEC.md).
const (
	KindGeoDataset      nostr.Kind = 37515
	KindGeoComment      nostr.Kind = 37517
	KindGroup           nostr.Kind = 37518
	KindGeoEditProposal nostr.Kind = 37519
	KindStory           nostr.Kind = 37520
	KindLiveBeacon      nostr.Kind = 37521
	KindTemporalSight   nostr.Kind = 37522
)

// modelVersion discriminator (SPEC §8). Events of the new-model kinds
// without it are legacy — stored but never indexed.
const modelVersion = "earthly/2"

var newModelKinds = map[nostr.Kind]bool{
	KindGroup: true, KindStory: true, KindLiveBeacon: true, KindTemporalSight: true,
}

// indexableKinds is the full set of kinds this index knows how to document.
var indexableKinds = map[nostr.Kind]bool{
	KindGeoDataset: true, KindGeoComment: true, KindGroup: true,
	KindGeoEditProposal: true, KindStory: true, KindLiveBeacon: true,
	KindTemporalSight: true,
}

const (
	// maxIndexableFeatures caps per-feature geometry/name extraction so a
	// pathological dataset cannot balloon a single index document.
	maxIndexableFeatures = 2000
	// maxIndexableContent skips content JSON parsing entirely above this
	// size (tags still index). MaxMessageSize is 2 MB, so this is a
	// belt-and-braces cap.
	maxIndexableContent = 4 * 1024 * 1024
)

// DocID returns the index document ID for an event: the address coordinate
// for addressable kinds (so replaceable updates overwrite one document —
// beacons heartbeat in place), the event ID otherwise.
func DocID(evt nostr.Event) string {
	if evt.Kind.IsAddressable() {
		return fmt.Sprintf("%d:%s:%s", evt.Kind, evt.PubKey.Hex(), evt.Tags.GetD())
	}
	return evt.ID.Hex()
}

// BuildDocument converts an event into a bleve document. ok=false means the
// event is not indexable (unknown kind, legacy modelVersion, unparseable in
// a way that leaves nothing to index).
func BuildDocument(evt nostr.Event) (docID string, doc map[string]any, ok bool) {
	if !indexableKinds[evt.Kind] {
		return "", nil, false
	}

	var content map[string]any
	if len(evt.Content) > 0 && len(evt.Content) <= maxIndexableContent {
		// Best-effort: unparseable content just means no content-derived fields.
		_ = json.Unmarshal([]byte(evt.Content), &content)
	}

	if newModelKinds[evt.Kind] {
		if v, _ := content["modelVersion"].(string); v != modelVersion {
			return "", nil, false // legacy / foreign — never enters the index
		}
	}

	doc = map[string]any{
		"event_id":   evt.ID.Hex(),
		"kind":       strconv.Itoa(int(evt.Kind)),
		"author":     evt.PubKey.Hex(),
		"created_at": float64(evt.CreatedAt),
	}

	extractCommonTags(evt, doc)

	switch evt.Kind {
	case KindGeoDataset, KindGeoEditProposal:
		extractDataset(evt, content, doc)
	case KindGeoComment:
		extractComment(content, doc)
	case KindGroup:
		extractGroup(content, doc)
	case KindStory:
		extractStory(content, doc)
	case KindLiveBeacon:
		extractBeacon(content, doc)
	case KindTemporalSight:
		extractSighting(content, doc)
	}

	return DocID(evt), doc, true
}

// extractCommonTags pulls the shared tag vocabulary (SPEC §7): bbox/g
// spatial, t hashtags, l labels, a/c reference coordinates, NIP-40
// expiration, blob presence.
func extractCommonTags(evt nostr.Event, doc map[string]any) {
	var hashtags, labels, refs []string

	for _, tag := range evt.Tags {
		if len(tag) < 2 {
			continue
		}
		switch tag[0] {
		case "t":
			hashtags = append(hashtags, strings.ToLower(tag[1]))
		case "l":
			labels = append(labels, tag[1])
		case "a", "c":
			refs = append(refs, tag[1])
		case "blob":
			doc["blob"] = true
		case "expiration":
			if ts, err := strconv.ParseInt(tag[1], 10, 64); err == nil {
				doc["expiration"] = float64(ts)
			}
		case "description":
			if _, has := doc["summary"]; !has {
				doc["summary"] = tag[1]
			}
		}
	}

	if len(hashtags) > 0 {
		doc["t"] = hashtags
	}
	if len(labels) > 0 {
		doc["l"] = labels
	}
	if len(refs) > 0 {
		doc["refs"] = refs
	}

	if bboxTag := evt.Tags.Find("bbox"); bboxTag != nil {
		if box, err := parseBboxTag(bboxTag[1]); err == nil {
			applyBbox(doc, *box)
		}
	}
}

// applyBbox derives the spatial fields every geo kind shares from a bbox:
// centroid geopoint, multi-precision geohashes, and area for scale ranking.
func applyBbox(doc map[string]any, box [4]float64) {
	lon, lat := bboxCentroid(box)
	doc["centroid"] = map[string]any{"lon": lon, "lat": lat}
	doc["geohash"] = geohashPrecisions(lon, lat)
	doc["bbox_area"] = bboxArea(box)
	if _, has := doc["geometry"]; !has {
		// Fallback so geo-relation queries still see kinds that carry only
		// a bbox (or datasets whose geometry failed to parse). Beacons and
		// sightings publish degenerate single-point bboxes — index those as
		// points, not zero-area envelopes.
		if box[0] == box[2] && box[1] == box[3] {
			doc["geometry"] = map[string]any{"type": "point", "coordinates": position(box[0], box[1])}
		} else {
			doc["geometry"] = map[string]any{
				"type": "envelope",
				"coordinates": []any{
					position(box[0], box[3]), // top-left: w,n
					position(box[2], box[1]), // bottom-right: e,s
				},
			}
		}
	}
}

// extractDataset handles 37515 (and 37519 proposals, which carry the same
// FeatureCollection content): per-feature geometry as a geometrycollection,
// feature names for text search, and FC-level stats.
func extractDataset(evt nostr.Event, content map[string]any, doc map[string]any) {
	if name, _ := content["name"].(string); name != "" {
		doc["title"] = name
	}
	if descTag := evt.Tags.Find("description"); descTag != nil {
		if _, has := doc["title"]; !has {
			doc["title"] = descTag[1]
		}
	}

	rawFeatures, _ := content["features"].([]any)
	if len(rawFeatures) == 0 {
		return
	}

	features := rawFeatures
	if len(features) > maxIndexableFeatures {
		features = features[:maxIndexableFeatures]
	}

	var names []string
	var shapes []any
	geomTypes := map[string]bool{}

	for _, rawFeature := range features {
		feature, isMap := rawFeature.(map[string]any)
		if !isMap {
			continue
		}
		if props, isMap := feature["properties"].(map[string]any); isMap {
			if name, _ := props["name"].(string); name != "" {
				names = append(names, name)
			}
			if desc, _ := props["description"].(string); desc != "" {
				names = append(names, desc)
			}
		}
		if geomMap, isMap := feature["geometry"].(map[string]any); isMap {
			// Round-trip through JSON to reuse the typed normalizer.
			raw, err := json.Marshal(geomMap)
			if err != nil {
				continue
			}
			var g geoJSONGeometry
			if err := json.Unmarshal(raw, &g); err != nil {
				continue
			}
			if shape := normalizeGeometry(&g); shape != nil {
				shapes = append(shapes, shape)
				geomTypes[strings.ToLower(g.Type)] = true
			}
		}
	}

	if len(names) > 0 {
		doc["feature_names"] = names
	}
	doc["feature_count"] = float64(len(rawFeatures))
	if len(geomTypes) > 0 {
		types := make([]string, 0, len(geomTypes))
		for t := range geomTypes {
			types = append(types, t)
		}
		doc["geom_types"] = types
	}

	if len(shapes) > 0 {
		geometry := map[string]any{"type": "geometrycollection", "geometries": shapes}
		doc["geometry"] = geometry
		// Prefer real geometry bounds over the publisher's bbox tag.
		if w, s, e, n, ok := geometryBounds(geometry); ok {
			applyBboxOverride(doc, [4]float64{w, s, e, n})
		}
	}
}

// applyBboxOverride recomputes the derived spatial fields from actual
// geometry bounds (keeps the geometry field as-is).
func applyBboxOverride(doc map[string]any, box [4]float64) {
	lon, lat := bboxCentroid(box)
	doc["centroid"] = map[string]any{"lon": lon, "lat": lat}
	doc["geohash"] = geohashPrecisions(lon, lat)
	doc["bbox_area"] = bboxArea(box)
}

func extractComment(content map[string]any, doc map[string]any) {
	if text, _ := content["text"].(string); text != "" {
		doc["body"] = text
	}
}

func extractGroup(content map[string]any, doc map[string]any) {
	if name, _ := content["name"].(string); name != "" {
		doc["title"] = name
	}
	if desc, _ := content["description"].(string); desc != "" {
		doc["body"] = desc
	}
}

func extractStory(content map[string]any, doc map[string]any) {
	if title, _ := content["title"].(string); title != "" {
		doc["title"] = title
	}
	if summary, _ := content["summary"].(string); summary != "" {
		doc["summary"] = summary
	}
	if body, _ := content["content"].(string); body != "" {
		doc["body"] = body
	}
}

func extractBeacon(content map[string]any, doc map[string]any) {
	if label, _ := content["label"].(string); label != "" {
		doc["title"] = label
	}
	// Only live beacons are findable; 'ended' tombstones stay stored but
	// searchable-by-address only.
	if status, _ := content["status"].(string); status != "" && status != "live" {
		doc["ended"] = true
	}
}

func extractSighting(content map[string]any, doc map[string]any) {
	if title, _ := content["title"].(string); title != "" {
		doc["title"] = title
	}
	if desc, _ := content["description"].(string); desc != "" {
		doc["body"] = desc
	}
	if start, isNum := content["start"].(float64); isNum {
		doc["start"] = start
	}
	if end, isNum := content["end"].(float64); isNum {
		doc["end"] = end
	}
}
