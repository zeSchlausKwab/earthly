package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"os"
	"strconv"
	"strings"

	"github.com/fiatjaf/eventstore/badger"
	"github.com/fiatjaf/eventstore/bluge"
	"github.com/fiatjaf/eventstore/sqlite3"
	"github.com/fiatjaf/khatru"
	"github.com/fiatjaf/khatru/blossom"
	"github.com/nbd-wtf/go-nostr"
)

var (
	port       = flag.String("port", "3334", "Port to listen on")
	dbPath     = flag.String("db-path", "./data/events.db", "Path to SQLite database file")
	searchPath = flag.String("search-path", "./data/search", "Path to bluge search index")
	resetDB    = flag.Bool("reset-db", false, "Reset the SQLite database")
	resetIndex = flag.Bool("reset-index", false, "Reset the search index")
	resetAll   = flag.Bool("reset-all", false, "Reset both database and index")
)

func main() {
	flag.Parse()

	if *resetAll {
		*resetDB = true
		*resetIndex = true
	}

	if *resetDB {
		log.Println("⚠️  Resetting SQLite database...")
		if err := resetDatabase(); err != nil {
			log.Fatalf("Failed to reset database: %v", err)
		}
		log.Println("✅ Database reset complete")
	}

	if *resetIndex {
		log.Println("⚠️  Resetting search index...")
		if err := resetSearchIndex(); err != nil {
			log.Fatalf("Failed to reset search index: %v", err)
		}
		log.Println("✅ Search index reset complete")
	}

	// Initialize relay
	relay := khatru.NewRelay()
	relay.Info.Name = "Earthly City Relay"
	relay.Info.Description = "A Nostr relay for internet radio stations with full-text search"
	relay.Info.PubKey = "96c727f4d1ea18a80d03621520ebfe3c9be1387033009a4f5b65959d09222eec"
	relay.Info.Icon = "https://earthly.city/icons/logo.png"
	relay.Info.Contact = "https://github.com/schlaus/earthly-rewrite"
	relay.Info.SupportedNIPs = []any{1, 9, 11, 12, 15, 16, 20, 22, 33, 40, 50}

	// Initialize SQLite backend
	os.MkdirAll("./data", 0755)
	db := &sqlite3.SQLite3Backend{DatabaseURL: *dbPath}
	if err := db.Init(); err != nil {
		log.Fatalf("Failed to initialize SQLite: %v", err)
	}
	defer db.Close()

	// Initialize Bluge search backend
	os.MkdirAll(*searchPath, 0755)
	search := &bluge.BlugeBackend{
		Path:          *searchPath,
		RawEventStore: db,
	}
	if err := search.Init(); err != nil {
		log.Fatalf("Failed to initialize Bluge: %v", err)
	}
	defer search.Close()

	// Set up event storage with enrichment for search indexing
	relay.StoreEvent = append(relay.StoreEvent,
		logIncomingEvent,
		db.SaveEvent,
		enrichAndIndexEvent(search),
	)

	// Set up event querying with search support
	relay.QueryEvents = append(relay.QueryEvents, func(ctx context.Context, filter nostr.Filter) (chan *nostr.Event, error) {
		logQuery(ctx, filter)

		// If the filter has a search term, use Bluge
		if len(filter.Search) > 0 {
			ch, err := search.QueryEvents(ctx, filter)
			if err != nil {
				log.Printf("❌ [QUERY] Search error: %v", err)
			}
			return ch, err
		}
		// Otherwise use SQLite
		ch, err := db.QueryEvents(ctx, filter)
		if err != nil {
			log.Printf("❌ [QUERY] Database error: %v", err)
		}
		return ch, err
	})

	// Set up event deletion
	relay.DeleteEvent = append(relay.DeleteEvent,
		db.DeleteEvent,
		search.DeleteEvent,
	)

	// Set up filter acceptance (REQUIRED for subscriptions to work)
	relay.RejectFilter = append(relay.RejectFilter, func(ctx context.Context, filter nostr.Filter) (bool, string) {
		// Log subscription request - safely get subscription ID
		subID := "unknown"
		defer func() {
			if r := recover(); r != nil {
				subID = "unknown"
			}
		}()

		if ctx != nil {
			if id := khatru.GetSubscriptionID(ctx); id != "" {
				subID = id
			}
		}
		log.Printf("📥 [SUB %s] New subscription", subID)

		// Accept all filters by default
		return false, ""
	})

	// Set up event acceptance (for publishing events)
	relay.RejectEvent = append(relay.RejectEvent, func(ctx context.Context, event *nostr.Event) (bool, string) {
		// Accept all events by default
		return false, ""
	})

	bdb := &badger.BadgerBackend{Path: "/tmp/khatru-badger-blossom-tmp"}
	if err := bdb.Init(); err != nil {
		panic(err)
	}
	bl := blossom.New(relay, "http://localhost:3334")
	bl.Store = blossom.EventStoreBlobIndexWrapper{Store: bdb, ServiceURL: bl.ServiceURL}
	bl.StoreBlob = append(bl.StoreBlob, func(ctx context.Context, sha256 string, ext string, body []byte) error {
		fmt.Println("storing", sha256, ext, len(body))
		return nil
	})
	bl.LoadBlob = append(bl.LoadBlob, func(ctx context.Context, sha256 string, ext string) (io.ReadSeeker, error) {
		fmt.Println("loading", sha256)
		blob := strings.NewReader("aaaaa")
		return blob, nil
	})

	// Log startup
	log.Printf("🚀 Earthly Relay starting on port %s", *port)
	log.Printf("📊 SQLite: %s", *dbPath)
	log.Printf("🔍 Search index: %s", *searchPath)

	// Convert port string to int
	portInt, err := strconv.Atoi(*port)
	if err != nil {
		log.Fatalf("Invalid port number: %v", err)
	}

	// Start the relay
	if err := relay.Start("0.0.0.0", portInt); err != nil {
		log.Fatalf("Failed to start relay: %v", err)
	}
}

func resetDatabase() error {
	// Remove the database file
	if err := os.Remove(*dbPath); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("failed to remove database: %w", err)
	}

	log.Println("Database removed. It will be recreated on next start.")
	return nil
}

func resetSearchIndex() error {
	// Remove the search index directory
	if err := os.RemoveAll(*searchPath); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("failed to remove search index: %w", err)
	}

	// Recreate the directory
	if err := os.MkdirAll(*searchPath, 0755); err != nil {
		return fmt.Errorf("failed to create search index directory: %w", err)
	}

	return nil
}

// StationContent represents the JSON structure in station event content
type StationContent struct {
	Description string `json:"description"`
}

// logIncomingEvent logs incoming events being stored
func logIncomingEvent(ctx context.Context, evt *nostr.Event) error {
	kindName := getKindName(evt.Kind)

	// Get event name/identifier for more useful logs
	identifier := ""
	if evt.Kind == 31237 {
		// Station event - get name tag
		for _, tag := range evt.Tags {
			if len(tag) >= 2 && tag[0] == "name" {
				identifier = fmt.Sprintf(" (%s)", tag[1])
				break
			}
		}
	} else if evt.Kind == 30078 || evt.Kind == 31990 || evt.Kind == 31989 {
		// Parameterized replaceable - get d tag
		for _, tag := range evt.Tags {
			if len(tag) >= 2 && tag[0] == "d" {
				identifier = fmt.Sprintf(" (d:%s)", tag[1])
				break
			}
		}
	}

	log.Printf("📝 [EVENT] Kind %d (%s)%s - ID: %s (%.8s...)",
		evt.Kind, kindName, identifier, evt.ID, evt.PubKey)

	return nil
}

// logQuery logs incoming subscription queries
func logQuery(ctx context.Context, filter nostr.Filter) {
	// Safely get subscription ID - it may not exist for internal queries
	subID := "internal"
	defer func() {
		if r := recover(); r != nil {
			// Silently handle panic from GetSubscriptionID
			subID = "internal"
		}
	}()

	if ctx != nil {
		if id := khatru.GetSubscriptionID(ctx); id != "" {
			subID = id
		}
	}

	// Build filter description
	var parts []string

	if len(filter.IDs) > 0 {
		parts = append(parts, fmt.Sprintf("IDs:%d", len(filter.IDs)))
	}
	if len(filter.Authors) > 0 {
		parts = append(parts, fmt.Sprintf("Authors:%d", len(filter.Authors)))
	}
	if len(filter.Kinds) > 0 {
		kindNames := make([]string, len(filter.Kinds))
		for i, k := range filter.Kinds {
			kindNames[i] = fmt.Sprintf("%d", k)
		}
		parts = append(parts, fmt.Sprintf("Kinds:[%s]", strings.Join(kindNames, ",")))
	}
	if filter.Since != nil {
		parts = append(parts, fmt.Sprintf("Since:%d", *filter.Since))
	}
	if filter.Until != nil {
		parts = append(parts, fmt.Sprintf("Until:%d", *filter.Until))
	}
	if filter.Limit > 0 {
		parts = append(parts, fmt.Sprintf("Limit:%d", filter.Limit))
	}
	if len(filter.Search) > 0 {
		parts = append(parts, fmt.Sprintf("Search:'%s'", filter.Search))
	}

	// Check for tag filters
	if len(filter.Tags) > 0 {
		for tagName, values := range filter.Tags {
			parts = append(parts, fmt.Sprintf("#%s:%d", tagName, len(values)))
		}
	}

	filterDesc := strings.Join(parts, ", ")
	if filterDesc == "" {
		filterDesc = "empty filter"
	}

	log.Printf("🔍 [QUERY %s] %s", subID, filterDesc)
}

// getKindName returns a human-readable name for event kinds
func getKindName(kind int) string {
	switch kind {
	case 0:
		return "Metadata"
	case 1:
		return "Note"
	case 3:
		return "Contacts"
	case 7:
		return "Reaction"
	case 1111:
		return "Comment"
	case 1311:
		return "Live Chat"
	case 9735:
		return "Zap"
	case 10002:
		return "Relay List"
	case 30078:
		return "App Data"
	case 31237:
		return "Radio Station"
	case 31989:
		return "Handler Recommendation"
	case 31990:
		return "Handler Info"
	default:
		if kind >= 30000 && kind < 40000 {
			return "Parameterized Replaceable"
		} else if kind >= 10000 && kind < 20000 {
			return "Replaceable"
		} else if kind >= 20000 && kind < 30000 {
			return "Ephemeral"
		}
		return "Unknown"
	}
}

// enrichAndIndexEvent adds description from content JSON as a tag so Bluge can index it
// Bluge automatically indexes all tag values, so we just need to make description a tag
func enrichAndIndexEvent(search *bluge.BlugeBackend) func(context.Context, *nostr.Event) error {
	return func(ctx context.Context, evt *nostr.Event) error {
		// Only enrich station events (kind 31237)
		if evt.Kind == 31237 {
			// Parse the content JSON to extract description
			var content StationContent
			if err := json.Unmarshal([]byte(evt.Content), &content); err == nil {
				// Add description as a searchable tag if it exists
				if content.Description != "" {
					// Check if description tag already exists
					hasDescTag := false
					for _, tag := range evt.Tags {
						if len(tag) >= 2 && tag[0] == "description" {
							hasDescTag = true
							break
						}
					}

					// Add description tag - Bluge will index all tag values including name and description
					if !hasDescTag {
						evt.Tags = append(evt.Tags, nostr.Tag{"description", content.Description})
					}
				}
			}
		}

		// Save to Bluge - it will index all tag values: name, description, genre, location, etc.
		return search.SaveEvent(ctx, evt)
	}
}
