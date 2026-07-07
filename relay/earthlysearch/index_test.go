package earthlysearch

import (
	"fmt"
	"testing"
	"time"

	"fiatjaf.com/nostr"
	"fiatjaf.com/nostr/eventstore/slicestore"
)

var testSecretKey = nostr.Generate()

func makeEvent(t *testing.T, kind nostr.Kind, content string, tags nostr.Tags) nostr.Event {
	t.Helper()
	evt := nostr.Event{
		Kind:      kind,
		CreatedAt: nostr.Now(),
		Content:   content,
		Tags:      tags,
		PubKey:    testSecretKey.Public(),
	}
	evt.SetID()
	return evt
}

func newTestBackend(t *testing.T) (*Backend, *slicestore.SliceStore) {
	t.Helper()
	raw := &slicestore.SliceStore{}
	if err := raw.Init(); err != nil {
		t.Fatal(err)
	}
	b := &Backend{Path: t.TempDir() + "/index", Raw: raw}
	if err := b.Init(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(b.Close)
	return b, raw
}

func saveBoth(t *testing.T, b *Backend, raw *slicestore.SliceStore, evt nostr.Event) {
	t.Helper()
	if err := raw.SaveEvent(evt); err != nil {
		t.Fatal(err)
	}
	if err := b.SaveEvent(evt); err != nil {
		t.Fatal(err)
	}
}

func collect(seq func(func(nostr.Event) bool)) []nostr.Event {
	var out []nostr.Event
	seq(func(evt nostr.Event) bool {
		out = append(out, evt)
		return true
	})
	return out
}

// viennaDataset is a 37515 with a polygon around Vienna's first district and
// a named point feature.
func viennaDataset(t *testing.T) nostr.Event {
	content := `{
		"type": "FeatureCollection",
		"name": "Vienna Districts",
		"features": [
			{
				"type": "Feature",
				"id": "district-1",
				"properties": {"name": "Innere Stadt"},
				"geometry": {"type": "Polygon", "coordinates": [[[16.35,48.2],[16.39,48.2],[16.39,48.22],[16.35,48.22],[16.35,48.2]]]}
			},
			{
				"type": "Feature",
				"id": "stephansdom",
				"properties": {"name": "Stephansdom"},
				"geometry": {"type": "Point", "coordinates": [16.3725, 48.2085]}
			}
		]
	}`
	return makeEvent(t, KindGeoDataset, content, nostr.Tags{
		{"d", "vienna1"},
		{"bbox", "16.35,48.2,16.39,48.22"},
		{"t", "districts"},
	})
}

func TestSearchByFeatureName(t *testing.T) {
	b, raw := newTestBackend(t)
	saveBoth(t, b, raw, viennaDataset(t))

	results := collect(b.QueryEvents(nostr.Filter{Search: "stephansdom"}, 10))
	if len(results) != 1 {
		t.Fatalf("feature-name search returned %d results, want 1", len(results))
	}
}

func TestSearchBboxIntersects(t *testing.T) {
	b, raw := newTestBackend(t)
	saveBoth(t, b, raw, viennaDataset(t))

	// Viewport over central Vienna.
	hits := collect(b.QueryEvents(nostr.Filter{Search: "bbox:16.3,48.15,16.45,48.25"}, 10))
	if len(hits) != 1 {
		t.Fatalf("bbox intersects returned %d, want 1", len(hits))
	}

	// Viewport over Linz — no hits.
	misses := collect(b.QueryEvents(nostr.Filter{Search: "bbox:14.2,48.25,14.35,48.35"}, 10))
	if len(misses) != 0 {
		t.Fatalf("far-away bbox returned %d, want 0", len(misses))
	}
}

func TestSearchPointContains(t *testing.T) {
	b, raw := newTestBackend(t)
	saveBoth(t, b, raw, viennaDataset(t))

	// A point inside the district polygon: the dataset's geometry contains it.
	hits := collect(b.QueryEvents(nostr.Filter{Search: "point:16.37,48.21 rel:contains"}, 10))
	if len(hits) != 1 {
		t.Fatalf("point-contains returned %d, want 1", len(hits))
	}

	// A point in the Atlantic: nothing contains it.
	misses := collect(b.QueryEvents(nostr.Filter{Search: "point:-30.0,48.21 rel:contains"}, 10))
	if len(misses) != 0 {
		t.Fatalf("atlantic point-contains returned %d, want 0", len(misses))
	}
}

func TestGeohashViewportQuery(t *testing.T) {
	b, raw := newTestBackend(t)
	saveBoth(t, b, raw, viennaDataset(t))

	// Vienna centroid is in u2ed at precision 4; a client covering the
	// viewport at zoom sends the cell as a plain #g filter.
	hits := collect(b.QueryGeohash(nostr.Filter{
		Kinds: []nostr.Kind{KindGeoDataset},
		Tags:  nostr.TagMap{"g": []string{"u2ed"}},
	}, 10))
	if len(hits) != 1 {
		t.Fatalf("#g viewport query returned %d, want 1", len(hits))
	}

	// Coarser zoom, precision 2.
	hits = collect(b.QueryGeohash(nostr.Filter{
		Tags: nostr.TagMap{"g": []string{"u2"}},
	}, 10))
	if len(hits) != 1 {
		t.Fatalf("precision-2 #g query returned %d, want 1", len(hits))
	}

	// Wrong cell.
	hits = collect(b.QueryGeohash(nostr.Filter{
		Tags: nostr.TagMap{"g": []string{"u2fq"}},
	}, 10))
	if len(hits) != 0 {
		t.Fatalf("wrong-cell #g query returned %d, want 0", len(hits))
	}
}

func TestModelVersionGate(t *testing.T) {
	b, raw := newTestBackend(t)

	legacy := makeEvent(t, KindGroup,
		`{"name":"Legacy Context","description":"pre-split 37518"}`,
		nostr.Tags{{"d", "legacy1"}, {"bbox", "16.35,48.2,16.39,48.22"}})
	saveBoth(t, b, raw, legacy)

	current := makeEvent(t, KindGroup,
		`{"modelVersion":"earthly/2","name":"Hiking Trails","description":"curated trails"}`,
		nostr.Tags{{"d", "trails1"}, {"bbox", "16.35,48.2,16.39,48.22"}})
	saveBoth(t, b, raw, current)

	hits := collect(b.QueryEvents(nostr.Filter{Search: "hiking"}, 10))
	if len(hits) != 1 {
		t.Fatalf("want only the new-model group, got %d hits", len(hits))
	}
	legacyHits := collect(b.QueryEvents(nostr.Filter{Search: "legacy context"}, 10))
	if len(legacyHits) != 0 {
		t.Fatalf("legacy group leaked into the index: %d hits", len(legacyHits))
	}
}

func TestExpiredEventsExcluded(t *testing.T) {
	b, raw := newTestBackend(t)

	expired := makeEvent(t, KindTemporalSight,
		`{"modelVersion":"earthly/2","title":"Heron sighting","start":1750000000}`,
		nostr.Tags{
			{"d", "s1"},
			{"bbox", "16.37,48.21,16.37,48.21"},
			{"expiration", fmt.Sprintf("%d", time.Now().Add(-time.Hour).Unix())},
		})
	saveBoth(t, b, raw, expired)

	live := makeEvent(t, KindTemporalSight,
		`{"modelVersion":"earthly/2","title":"Heron sighting fresh","start":1750000000}`,
		nostr.Tags{
			{"d", "s2"},
			{"bbox", "16.37,48.21,16.37,48.21"},
			{"expiration", fmt.Sprintf("%d", time.Now().Add(time.Hour).Unix())},
		})
	saveBoth(t, b, raw, live)

	hits := collect(b.QueryEvents(nostr.Filter{Search: "heron"}, 10))
	if len(hits) != 1 {
		t.Fatalf("want 1 live sighting, got %d", len(hits))
	}
	if hits[0].Tags.GetD() != "s2" {
		t.Errorf("expired sighting surfaced instead of the live one")
	}

	geoHits := collect(b.QueryGeohash(nostr.Filter{Tags: nostr.TagMap{"g": []string{"u2ed"}}}, 10))
	if len(geoHits) != 1 {
		t.Fatalf("#g route: want 1 live sighting, got %d", len(geoHits))
	}
}

func TestBeaconReplaceOverwritesDocument(t *testing.T) {
	b, raw := newTestBackend(t)

	heartbeat := func(label string) nostr.Event {
		return makeEvent(t, KindLiveBeacon,
			fmt.Sprintf(`{"modelVersion":"earthly/2","label":%q,"status":"live"}`, label),
			nostr.Tags{
				{"d", "beacon1"},
				{"bbox", "16.37,48.21,16.37,48.21"},
				{"expiration", fmt.Sprintf("%d", time.Now().Add(time.Hour).Unix())},
			})
	}

	first := heartbeat("walking in the park")
	if err := raw.SaveEvent(first); err != nil {
		t.Fatal(err)
	}
	if err := b.SaveEvent(first); err != nil {
		t.Fatal(err)
	}

	// 30s-heartbeat scenario: many replacements of the same d tag.
	for i := 0; i < 5; i++ {
		next := heartbeat(fmt.Sprintf("walking in the park %d", i))
		if _, err := raw.ReplaceEvent(next); err != nil {
			t.Fatal(err)
		}
		if err := b.SaveEvent(next); err != nil {
			t.Fatal(err)
		}
	}

	count, err := b.DocCount()
	if err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("beacon heartbeats accumulated %d docs, want exactly 1 (the Bluge disease)", count)
	}
}

func TestTemporalRangeQuery(t *testing.T) {
	b, raw := newTestBackend(t)

	june := makeEvent(t, KindTemporalSight,
		`{"modelVersion":"earthly/2","title":"June market","start":1780358400}`,
		nostr.Tags{{"d", "june"}, {"bbox", "16.37,48.21,16.37,48.21"}})
	saveBoth(t, b, raw, june)

	may := makeEvent(t, KindTemporalSight,
		`{"modelVersion":"earthly/2","title":"May market","start":1777680000}`,
		nostr.Tags{{"d", "may"}, {"bbox", "16.37,48.21,16.37,48.21"}})
	saveBoth(t, b, raw, may)

	hits := collect(b.QueryEvents(nostr.Filter{
		Search: "bbox:16.3,48.15,16.45,48.25 start-after:2026-06-01",
	}, 10))
	if len(hits) != 1 {
		t.Fatalf("temporal range returned %d, want 1", len(hits))
	}
	if hits[0].Tags.GetD() != "june" {
		t.Errorf("wrong sighting matched the temporal range")
	}
}

func TestReindexRebuildsFromStore(t *testing.T) {
	b, raw := newTestBackend(t)
	saveBoth(t, b, raw, viennaDataset(t))

	// Simulate index loss: fresh backend over the same raw store.
	b2 := &Backend{Path: t.TempDir() + "/index2", Raw: raw}
	if err := b2.Init(); err != nil {
		t.Fatal(err)
	}
	defer b2.Close()

	indexed, _, err := b2.Reindex()
	if err != nil {
		t.Fatal(err)
	}
	if indexed != 1 {
		t.Fatalf("reindex indexed %d, want 1", indexed)
	}

	hits := collect(b2.QueryEvents(nostr.Filter{Search: "stephansdom"}, 10))
	if len(hits) != 1 {
		t.Fatalf("post-reindex search returned %d, want 1", len(hits))
	}
}

func TestDeleteEventRemovesCoordinateDoc(t *testing.T) {
	b, raw := newTestBackend(t)
	evt := viennaDataset(t)
	saveBoth(t, b, raw, evt)

	// Index deletion must resolve the coordinate doc ID while the event is
	// still in the raw store (main.go composes in this order).
	if err := b.DeleteEvent(evt.ID); err != nil {
		t.Fatal(err)
	}
	if err := raw.DeleteEvent(evt.ID); err != nil {
		t.Fatal(err)
	}

	hits := collect(b.QueryEvents(nostr.Filter{Search: "stephansdom"}, 10))
	if len(hits) != 0 {
		t.Fatalf("deleted event still searchable: %d hits", len(hits))
	}
}

func TestSearchAsYouTypePrefix(t *testing.T) {
	b, raw := newTestBackend(t)
	saveBoth(t, b, raw, viennaDataset(t))

	// Partial last token must prefix-match (typeahead semantics).
	for _, q := range []string{"steph", "stephansdom", "inne"} {
		hits := collect(b.QueryEvents(nostr.Filter{Search: q}, 10))
		if len(hits) != 1 {
			t.Errorf("prefix search %q returned %d, want 1", q, len(hits))
		}
	}

	// Multi-word: full words + partial last token.
	hits := collect(b.QueryEvents(nostr.Filter{Search: "vienna dist"}, 10))
	if len(hits) != 1 {
		t.Errorf("multi-word prefix search returned %d, want 1", len(hits))
	}

	// Nonsense prefix stays empty.
	if hits := collect(b.QueryEvents(nostr.Filter{Search: "xyzzy"}, 10)); len(hits) != 0 {
		t.Errorf("nonsense prefix matched %d docs", len(hits))
	}
}
