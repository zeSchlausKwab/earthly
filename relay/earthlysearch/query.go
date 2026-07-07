package earthlysearch

import (
	"fmt"
	"iter"
	"strings"
	"time"

	"fiatjaf.com/nostr"
	bleve "github.com/blevesearch/bleve/v2"
	"github.com/blevesearch/bleve/v2/search"
	bleveQuery "github.com/blevesearch/bleve/v2/search/query"
)

// Query execution: NIP-50 extended search and #g geohash viewport queries.
// Both run against the bleve index and hydrate full events from the raw
// store, preserving index ranking.

// tag filters answered by index fields; everything else is applied as a
// residual filter after hydration.
var indexedTagFilters = map[string]string{
	"t": "t",
	"l": "l",
	"g": "geohash",
}

func termDisjunction(field string, values []string) bleveQuery.Query {
	dis := bleve.NewDisjunctionQuery()
	for _, v := range values {
		tq := bleve.NewTermQuery(v)
		tq.SetField(field)
		dis.AddQuery(tq)
	}
	return dis
}

func matchClause(field, text string, boost float64) bleveQuery.Query {
	m := bleve.NewMatchQuery(text)
	m.SetField(field)
	m.SetBoost(boost)
	return m
}

// textClause builds search-as-you-type semantics for one field: full-token
// match OR a prefix match on the last token (so "steph" finds
// "Stephansplatz" while the user is still typing). Prefix queries are not
// analyzed — lowercase to align with the standard analyzer's tokens.
func textClause(field, text string, boost float64) bleveQuery.Query {
	clause := bleve.NewDisjunctionQuery(matchClause(field, text, boost))

	words := strings.Fields(strings.ToLower(text))
	if len(words) > 0 {
		last := words[len(words)-1]
		prefix := bleve.NewPrefixQuery(last)
		prefix.SetField(field)
		prefix.SetBoost(boost * 0.8)
		if len(words) > 1 {
			// Preceding words must still match the field normally.
			rest := matchClause(field, strings.Join(words[:len(words)-1], " "), boost)
			clause.AddQuery(bleveQuery.NewConjunctionQuery([]bleveQuery.Query{rest, prefix}))
		} else {
			clause.AddQuery(prefix)
		}
	}

	return clause
}

func numericRange(field string, min, max *float64) bleveQuery.Query {
	r := bleve.NewNumericRangeQuery(min, max)
	r.SetField(field)
	return r
}

// notExpiredClauses returns MustNot clauses that drop NIP-40-expired events
// and ended beacons from every query path. The GC sweep also deletes them,
// but query time is the correctness boundary (SPEC §10).
func notExpiredClauses() []bleveQuery.Query {
	now := float64(time.Now().Unix())
	zero := 0.0
	expired := numericRange("expiration", &zero, &now)

	ended := bleve.NewBoolFieldQuery(true)
	ended.SetField("ended")

	return []bleveQuery.Query{expired, ended}
}

// geoShapeClause builds the spatial constraint from parsed params.
func geoShapeClause(params SearchParams) (bleveQuery.Query, error) {
	if params.BBox != nil {
		box := *params.BBox
		q, err := bleve.NewGeoShapeQuery(
			[][][][]float64{{{{box[0], box[3]}, {box[2], box[1]}}}}, // {w,n},{e,s}
			"envelope", params.Rel,
		)
		if err != nil {
			return nil, fmt.Errorf("bbox query: %w", err)
		}
		q.SetField("geometry")
		return q, nil
	}

	if params.Point != nil {
		pt := *params.Point
		q, err := bleve.NewGeoShapeQuery(
			[][][][]float64{{{{pt[0], pt[1]}}}},
			"point", params.Rel,
		)
		if err != nil {
			return nil, fmt.Errorf("point query: %w", err)
		}
		q.SetField("geometry")
		return q, nil
	}

	return nil, nil
}

// distanceOrigin resolves the lon/lat used for radius filters and distance
// sorting: explicit point first, near geohash second.
func distanceOrigin(params SearchParams) (lon, lat float64, ok bool) {
	if params.Point != nil {
		return params.Point[0], params.Point[1], true
	}
	if params.Near != "" {
		lon, lat, err := decodeGeohashCenter(params.Near)
		if err != nil {
			return 0, 0, false
		}
		return lon, lat, true
	}
	return 0, 0, false
}

// buildSearchQuery assembles the bleve query for an extended NIP-50 filter.
// Returns nil when the query has no selective clause at all.
func buildSearchQuery(filter nostr.Filter, params SearchParams) (bleveQuery.Query, error) {
	boolQ := bleve.NewBooleanQuery()
	hasClause := false

	if len(params.Text) >= 2 {
		text := bleve.NewDisjunctionQuery(
			textClause("title", params.Text, 3),
			textClause("feature_names", params.Text, 2),
			textClause("summary", params.Text, 1.5),
			textClause("body", params.Text, 1),
		)
		boolQ.AddMust(text)
		hasClause = true
	}

	if shape, err := geoShapeClause(params); err != nil {
		return nil, err
	} else if shape != nil {
		boolQ.AddMust(shape)
		hasClause = true
	}

	if params.RadiusKm > 0 {
		if lon, lat, ok := distanceOrigin(params); ok {
			dist := bleve.NewGeoDistanceQuery(lon, lat, fmt.Sprintf("%fkm", params.RadiusKm))
			dist.SetField("centroid")
			boolQ.AddMust(dist)
			hasClause = true
		}
	}

	for _, label := range params.Labels {
		tq := bleve.NewTermQuery(label)
		tq.SetField("l")
		boolQ.AddMust(tq)
		hasClause = true
	}
	for _, hashtag := range params.Hashtags {
		tq := bleve.NewTermQuery(hashtag)
		tq.SetField("t")
		boolQ.AddMust(tq)
		hasClause = true
	}
	for _, ref := range params.Refs {
		tq := bleve.NewTermQuery(ref)
		tq.SetField("refs")
		boolQ.AddMust(tq)
		hasClause = true
	}

	if params.StartAfter != 0 || params.StartBefore != 0 {
		var min, max *float64
		if params.StartAfter != 0 {
			v := float64(params.StartAfter)
			min = &v
		}
		if params.StartBefore != 0 {
			v := float64(params.StartBefore)
			max = &v
		}
		boolQ.AddMust(numericRange("start", min, max))
		hasClause = true
	}

	if !hasClause {
		return nil, nil
	}

	// Standard filter constraints ride along as musts.
	if len(filter.Kinds) > 0 {
		kinds := make([]string, len(filter.Kinds))
		for i, k := range filter.Kinds {
			kinds[i] = fmt.Sprintf("%d", int(k))
		}
		boolQ.AddMust(termDisjunction("kind", kinds))
	}
	if len(filter.Authors) > 0 {
		authors := make([]string, len(filter.Authors))
		for i, pk := range filter.Authors {
			authors[i] = pk.Hex()
		}
		boolQ.AddMust(termDisjunction("author", authors))
	}
	if filter.Since != 0 || filter.Until != 0 {
		var min, max *float64
		if filter.Since != 0 {
			v := float64(filter.Since)
			min = &v
		}
		if filter.Until != 0 {
			v := float64(filter.Until)
			max = &v
		}
		boolQ.AddMust(numericRange("created_at", min, max))
	}
	for tagName, values := range filter.Tags {
		if field, known := indexedTagFilters[tagName]; known && len(values) > 0 {
			boolQ.AddMust(termDisjunction(field, values))
		}
	}

	for _, mustNot := range notExpiredClauses() {
		boolQ.AddMustNot(mustNot)
	}

	return boolQ, nil
}

func applySort(req *bleve.SearchRequest, params SearchParams) {
	switch params.Sort {
	case SortRecent:
		req.SortBy([]string{"-created_at", "-_score"})
	case SortScale:
		req.SortBy([]string{"-bbox_area", "-_score"})
	case SortDistance:
		if lon, lat, ok := distanceOrigin(params); ok {
			if geoSort, err := search.NewSortGeoDistance("centroid", "km", lon, lat, false); err == nil {
				req.SortByCustom(search.SortOrder{geoSort})
			}
		}
	}
}

// runAndHydrate executes a search request and yields full events from the
// raw store in index-ranking order, applying residual tag filters.
func (b *Backend) runAndHydrate(req *bleve.SearchRequest, filter nostr.Filter) iter.Seq[nostr.Event] {
	return func(yield func(nostr.Event) bool) {
		req.Fields = []string{"event_id"}

		result, err := b.index.Search(req)
		if err != nil {
			b.Log.Error("search failed", "err", err, "filter", filter.String())
			return
		}

		ids := make([]nostr.ID, 0, len(result.Hits))
		for _, hit := range result.Hits {
			idHex, _ := hit.Fields["event_id"].(string)
			if id, err := nostr.IDFromHex(idHex); err == nil {
				ids = append(ids, id)
			}
		}
		if len(ids) == 0 {
			return
		}

		byID := make(map[nostr.ID]nostr.Event, len(ids))
		for evt := range b.Raw.QueryEvents(nostr.Filter{IDs: ids}, len(ids)) {
			byID[evt.ID] = evt
		}

	hits:
		for _, id := range ids {
			evt, found := byID[id]
			if !found {
				continue
			}
			// Residual filter: tag constraints the index doesn't model.
			for tagName, values := range filter.Tags {
				if _, indexed := indexedTagFilters[tagName]; indexed {
					continue
				}
				if !evt.Tags.ContainsAny(tagName, values) {
					continue hits
				}
			}
			if !yield(evt) {
				return
			}
		}
	}
}

func effectiveLimit(filter nostr.Filter, maxLimit int) int {
	limit := filter.Limit
	if limit <= 0 || limit > maxLimit {
		limit = maxLimit
	}
	return limit
}

// QueryEvents answers NIP-50 filters (filter.Search non-empty) with the
// extended grammar. Grammar errors and clause-less queries yield nothing —
// filters are pre-validated in the relay's OnRequest hook so clients get a
// useful rejection message instead.
func (b *Backend) QueryEvents(filter nostr.Filter, maxLimit int) iter.Seq[nostr.Event] {
	return func(yield func(nostr.Event) bool) {
		params, err := ParseSearch(filter.Search)
		if err != nil {
			b.Log.Warn("unparseable search", "search", filter.Search, "err", err)
			return
		}

		q, err := buildSearchQuery(filter, params)
		if err != nil {
			b.Log.Warn("unbuildable search", "search", filter.Search, "err", err)
			return
		}
		if q == nil {
			return
		}

		req := bleve.NewSearchRequest(q)
		req.Size = effectiveLimit(filter, maxLimit)
		applySort(req, params)

		for evt := range b.runAndHydrate(req, filter) {
			if !yield(evt) {
				return
			}
		}
	}
}

// QueryGeohash answers plain NIP-01 filters carrying a #g tag filter — the
// Lane-1 automated viewport queries. Multi-precision geohashes in the index
// make any zoom level an exact term match.
func (b *Backend) QueryGeohash(filter nostr.Filter, maxLimit int) iter.Seq[nostr.Event] {
	return func(yield func(nostr.Event) bool) {
		cells := filter.Tags["g"]
		if len(cells) == 0 {
			return
		}

		boolQ := bleve.NewBooleanQuery()
		boolQ.AddMust(termDisjunction("geohash", cells))

		if len(filter.Kinds) > 0 {
			kinds := make([]string, len(filter.Kinds))
			for i, k := range filter.Kinds {
				kinds[i] = fmt.Sprintf("%d", int(k))
			}
			boolQ.AddMust(termDisjunction("kind", kinds))
		}
		if len(filter.Authors) > 0 {
			authors := make([]string, len(filter.Authors))
			for i, pk := range filter.Authors {
				authors[i] = pk.Hex()
			}
			boolQ.AddMust(termDisjunction("author", authors))
		}
		if filter.Since != 0 || filter.Until != 0 {
			var min, max *float64
			if filter.Since != 0 {
				v := float64(filter.Since)
				min = &v
			}
			if filter.Until != 0 {
				v := float64(filter.Until)
				max = &v
			}
			boolQ.AddMust(numericRange("created_at", min, max))
		}
		for tagName, values := range filter.Tags {
			if tagName == "g" {
				continue
			}
			if field, known := indexedTagFilters[tagName]; known && len(values) > 0 {
				boolQ.AddMust(termDisjunction(field, values))
			}
		}
		for _, mustNot := range notExpiredClauses() {
			boolQ.AddMustNot(mustNot)
		}

		req := bleve.NewSearchRequest(boolQ)
		req.Size = effectiveLimit(filter, maxLimit)
		req.SortBy([]string{"-created_at"})

		for evt := range b.runAndHydrate(req, filter) {
			if !yield(evt) {
				return
			}
		}
	}
}
