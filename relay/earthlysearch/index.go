package earthlysearch

import (
	"fmt"
	"log/slog"
	"sync/atomic"

	"fiatjaf.com/nostr"
	"fiatjaf.com/nostr/eventstore"
	bleve "github.com/blevesearch/bleve/v2"
	bleveMapping "github.com/blevesearch/bleve/v2/mapping"
)

// Backend is the Earthly geo search index. It is NOT an eventstore — it is
// derived data over one (Raw), rebuildable at any time via Reindex.
type Backend struct {
	Path string
	Raw  eventstore.Store
	Log  *slog.Logger

	index    bleve.Index
	indexed  atomic.Int64
	skipped  atomic.Int64
	readOnly bool
}

func textField(analyzer string) *bleveMapping.FieldMapping {
	f := bleveMapping.NewTextFieldMapping()
	f.Analyzer = analyzer
	f.Store = false
	f.IncludeTermVectors = false
	f.IncludeInAll = false
	f.DocValues = false
	return f
}

func keywordField() *bleveMapping.FieldMapping {
	f := bleveMapping.NewKeywordFieldMapping()
	f.Store = false
	f.IncludeTermVectors = false
	f.IncludeInAll = false
	f.DocValues = false
	return f
}

func numericField(sortable bool) *bleveMapping.FieldMapping {
	f := bleveMapping.NewNumericFieldMapping()
	f.Store = false
	f.IncludeInAll = false
	f.DocValues = sortable
	return f
}

// buildIndexMapping defines the document schema from
// docs/GEO_SEARCH_REWRITE.md §5. Static — nothing is indexed implicitly.
func buildIndexMapping() bleveMapping.IndexMapping {
	m := bleveMapping.NewIndexMapping()
	m.DefaultMapping.Dynamic = false
	doc := bleveMapping.NewDocumentStaticMapping()

	// Stored-only: hydration pointer back to the event store.
	eventID := bleveMapping.NewKeywordFieldMapping()
	eventID.Store = true
	eventID.Index = false
	eventID.IncludeInAll = false
	eventID.DocValues = false
	doc.AddFieldMappingsAt("event_id", eventID)

	doc.AddFieldMappingsAt("kind", keywordField())
	doc.AddFieldMappingsAt("author", keywordField())
	doc.AddFieldMappingsAt("created_at", numericField(true))

	doc.AddFieldMappingsAt("title", textField("standard"))
	doc.AddFieldMappingsAt("summary", textField("standard"))
	doc.AddFieldMappingsAt("body", textField("standard"))
	doc.AddFieldMappingsAt("feature_names", textField("standard"))

	doc.AddFieldMappingsAt("t", keywordField())
	doc.AddFieldMappingsAt("l", keywordField())
	doc.AddFieldMappingsAt("refs", keywordField())
	doc.AddFieldMappingsAt("geohash", keywordField())
	doc.AddFieldMappingsAt("geom_types", keywordField())

	geometry := bleveMapping.NewGeoShapeFieldMapping()
	geometry.Store = false
	geometry.IncludeInAll = false
	doc.AddFieldMappingsAt("geometry", geometry)

	centroid := bleveMapping.NewGeoPointFieldMapping()
	centroid.Store = false
	centroid.IncludeInAll = false
	centroid.DocValues = true // distance sort
	doc.AddFieldMappingsAt("centroid", centroid)

	doc.AddFieldMappingsAt("bbox_area", numericField(true))
	doc.AddFieldMappingsAt("start", numericField(true))
	doc.AddFieldMappingsAt("end", numericField(false))
	doc.AddFieldMappingsAt("expiration", numericField(false))
	doc.AddFieldMappingsAt("feature_count", numericField(false))

	boolField := bleveMapping.NewBooleanFieldMapping()
	boolField.Store = false
	boolField.IncludeInAll = false
	doc.AddFieldMappingsAt("blob", boolField)

	ended := bleveMapping.NewBooleanFieldMapping()
	ended.Store = false
	ended.IncludeInAll = false
	doc.AddFieldMappingsAt("ended", ended)

	m.AddDocumentMapping("_default", doc)
	return m
}

func (b *Backend) Init() error {
	if b.Path == "" {
		return fmt.Errorf("earthlysearch: missing Path")
	}
	if b.Raw == nil {
		return fmt.Errorf("earthlysearch: missing Raw event store")
	}
	if b.Log == nil {
		b.Log = slog.Default()
	}

	index, err := bleve.Open(b.Path)
	if err == bleve.ErrorIndexPathDoesNotExist {
		index, err = bleve.New(b.Path, buildIndexMapping())
		if err != nil {
			return fmt.Errorf("earthlysearch: creating index: %w", err)
		}
	} else if err != nil {
		return fmt.Errorf("earthlysearch: opening index: %w", err)
	}

	b.index = index
	return nil
}

func (b *Backend) Close() {
	if b != nil && b.index != nil {
		b.index.Close()
	}
}

// SaveEvent indexes one event. Replaceable kinds overwrite their coordinate
// document — a beacon heartbeat updates in place instead of accumulating.
func (b *Backend) SaveEvent(evt nostr.Event) error {
	docID, doc, ok := BuildDocument(evt)
	if !ok {
		b.skipped.Add(1)
		return nil
	}
	if err := b.index.Index(docID, doc); err != nil {
		return fmt.Errorf("earthlysearch: indexing %s: %w", docID, err)
	}
	b.indexed.Add(1)
	return nil
}

// DeleteEvent removes the document for an event ID. The event must still be
// readable from the raw store when this is called (compose index deletion
// BEFORE store deletion) — for addressable kinds the doc ID is the
// coordinate, which requires the event's tags. Falls back to the ID-keyed
// doc when the event is already gone.
func (b *Backend) DeleteEvent(id nostr.ID) error {
	for evt := range b.Raw.QueryEvents(nostr.Filter{IDs: []nostr.ID{id}}, 1) {
		return b.index.Delete(DocID(evt))
	}
	return b.index.Delete(id.Hex())
}

// Reindex rebuilds the whole index from the raw event store. The index is
// derived data — this is the recovery path for corruption or schema changes.
func (b *Backend) Reindex() (indexed int, skipped int, err error) {
	batch := b.index.NewBatch()
	const batchSize = 500
	inBatch := 0

	flush := func() error {
		if inBatch == 0 {
			return nil
		}
		if err := b.index.Batch(batch); err != nil {
			return err
		}
		batch = b.index.NewBatch()
		inBatch = 0
		return nil
	}

	for kind := range indexableKinds {
		for evt := range b.Raw.QueryEvents(nostr.Filter{Kinds: []nostr.Kind{kind}}, maxReindexPerKind) {
			docID, doc, ok := BuildDocument(evt)
			if !ok {
				skipped++
				continue
			}
			if err := batch.Index(docID, doc); err != nil {
				return indexed, skipped, err
			}
			indexed++
			inBatch++
			if inBatch >= batchSize {
				if err := flush(); err != nil {
					return indexed, skipped, err
				}
			}
		}
	}

	if err := flush(); err != nil {
		return indexed, skipped, err
	}
	return indexed, skipped, nil
}

// maxReindexPerKind bounds a reindex query; far above any realistic event
// count for a single kind on this relay.
const maxReindexPerKind = 1_000_000

// DocCount exposes the index size for the capability/health endpoint.
func (b *Backend) DocCount() (uint64, error) {
	return b.index.DocCount()
}
