package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"iter"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"sync/atomic"
	"syscall"
	"time"

	"fiatjaf.com/nostr"
	"fiatjaf.com/nostr/eventstore/lmdb"
	"fiatjaf.com/nostr/khatru"
	"fiatjaf.com/nostr/khatru/policies"
	"fiatjaf.com/nostr/nip11"

	"github.com/schlaus/earthly-relay/earthlysearch"
	"github.com/schlaus/earthly-relay/largecontent"
)

var (
	port       = flag.String("port", "3334", "Port to listen on")
	dataDir    = flag.String("data-dir", "./data", "Directory for event store and search index")
	resetDB    = flag.Bool("reset-db", false, "Reset the event store (and the index, which derives from it)")
	resetIndex = flag.Bool("reset-index", false, "Reset the search index (rebuilt from the event store on start)")
	resetAll   = flag.Bool("reset-all", false, "Reset both event store and index")
	reindex    = flag.Bool("reindex", false, "Force a full index rebuild from the event store on start")
	logLevel   = flag.String("log-level", "info", "Log level: debug|info|warn|error")

	// minFreeBytes is the disk budget: below this free space the relay
	// refuses writes instead of crash-looping the machine (the 2026-06-08
	// incident mode).
	minFreeBytes = flag.Int64("min-free-bytes", 512*1024*1024, "Refuse event writes when the data volume has less free space than this")
)

func main() {
	flag.Parse()

	logger := newLogger(*logLevel)
	slog.SetDefault(logger)

	lmdbPath := filepath.Join(*dataDir, "events-lmdb")
	largeContentPath := filepath.Join(*dataDir, "large-event-content.db")
	searchPath := filepath.Join(*dataDir, "search")

	if *resetAll {
		*resetDB = true
		*resetIndex = true
	}
	if *resetDB {
		// The index is derived from the event store — resetting the store
		// without the index would leave dangling documents.
		*resetIndex = true
		logger.Warn("resetting event store", "path", lmdbPath)
		if err := os.RemoveAll(lmdbPath); err != nil {
			fatal(logger, "failed to reset event store", err)
		}
		logger.Warn("resetting large event content", "path", largeContentPath)
		if err := os.Remove(largeContentPath); err != nil && !errors.Is(err, os.ErrNotExist) {
			fatal(logger, "failed to reset large event content", err)
		}
	}
	if *resetIndex {
		logger.Warn("resetting search index", "path", searchPath)
		if err := os.RemoveAll(searchPath); err != nil {
			fatal(logger, "failed to reset search index", err)
		}
	}

	if err := os.MkdirAll(lmdbPath, 0o755); err != nil {
		fatal(logger, "failed to create data dir", err)
	}

	rawDB := &lmdb.LMDBBackend{Path: lmdbPath}
	db := largecontent.New(rawDB, largeContentPath)
	if err := db.Init(); err != nil {
		fatal(logger, "failed to initialize event store", err)
	}
	defer db.Close()

	search := &earthlysearch.Backend{Path: searchPath, Raw: db, Log: logger}
	if err := search.Init(); err != nil {
		fatal(logger, "failed to initialize search index", err)
	}
	defer search.Close()

	// Self-heal: a fresh/reset index rebuilds from the event store. The
	// index is derived data (docs/GEO_SEARCH_REWRITE.md D-08).
	docCount, _ := search.DocCount()
	if *reindex || docCount == 0 {
		start := time.Now()
		indexed, skipped, err := search.Reindex()
		if err != nil {
			fatal(logger, "reindex failed", err)
		}
		logger.Info("reindex complete", "indexed", indexed, "skipped", skipped, "took", time.Since(start).Round(time.Millisecond))
	}

	relay := khatru.NewRelay()
	relay.MaxMessageSize = 2 * 1024 * 1024 // large GeoJSON dataset events
	relay.Info.Name = "Earthly City Relay"
	relay.Info.Description = "Nostr relay for collaborative geographic mapping. Geo-aware NIP-50 search — capability document at /earthly-search."
	relay.Info.Icon = "https://earthly.city/icons/logo.png"
	relay.Info.Contact = "https://github.com/schlaus/earthly-rewrite"
	relay.Info.Limitation = &nip11.RelayLimitationDocument{
		MaxMessageLength: int(relay.MaxMessageSize),
		MaxContentLength: largecontent.MaxContentBytes,
	}
	relay.Info.AddSupportedNIP(40)
	relay.Info.AddSupportedNIP(50)
	if pk, err := nostr.PubKeyFromHex("96c727f4d1ea18a80d03621520ebfe3c9be1387033009a4f5b65959d09222eec"); err == nil {
		relay.Info.PubKey = &pk
	}

	relay.UseEventstore(db, 500)

	// Layer the search index over the eventstore wiring. Order matters for
	// deletes: the index needs the event still present in LMDB to resolve
	// its coordinate doc ID.
	storeEvent := relay.StoreEvent
	relay.StoreEvent = func(ctx context.Context, evt nostr.Event) error {
		if err := storeEvent(ctx, evt); err != nil {
			return err
		}
		if err := search.SaveEvent(evt); err != nil {
			logger.Error("index save failed", "id", evt.ID.Hex(), "err", err)
		}
		return nil
	}
	replaceEvent := relay.ReplaceEvent
	relay.ReplaceEvent = func(ctx context.Context, evt nostr.Event) error {
		if err := replaceEvent(ctx, evt); err != nil {
			return err
		}
		if err := search.SaveEvent(evt); err != nil {
			logger.Error("index replace failed", "id", evt.ID.Hex(), "err", err)
		}
		return nil
	}
	deleteEvent := relay.DeleteEvent
	relay.DeleteEvent = func(ctx context.Context, id nostr.ID) error {
		if err := search.DeleteEvent(id); err != nil {
			logger.Warn("index delete failed", "id", id.Hex(), "err", err)
		}
		return deleteEvent(ctx, id)
	}

	// Query routing: NIP-50 search and #g viewport filters go to the geo
	// index; everything else goes to LMDB.
	queryStored := relay.QueryStored
	relay.QueryStored = func(ctx context.Context, filter nostr.Filter) iter.Seq[nostr.Event] {
		logger.Debug("query", "filter", filter.String())
		if filter.Search != "" {
			return search.QueryEvents(filter, 500)
		}
		if len(filter.Tags["g"]) > 0 {
			return search.QueryGeohash(filter, 500)
		}
		return queryStored(ctx, filter)
	}

	// Filter validation: reject malformed grammar with a useful message
	// instead of silently returning nothing.
	relay.OnRequest = func(ctx context.Context, filter nostr.Filter) (bool, string) {
		if filter.Search != "" {
			if _, err := earthlysearch.ParseSearch(filter.Search); err != nil {
				return true, fmt.Sprintf("invalid: search grammar: %s", err)
			}
		}
		return false, ""
	}

	diskFull := watchDiskBudget(logger, *dataDir, *minFreeBytes)
	relay.OnEvent = policies.SeqEvent(
		func(ctx context.Context, evt nostr.Event) (bool, string) {
			if diskFull.Load() {
				return true, "blocked: relay storage is full"
			}
			return false, ""
		},
		func(ctx context.Context, evt nostr.Event) (bool, string) {
			if len(evt.Content) > largecontent.MaxContentBytes {
				return true, fmt.Sprintf(
					"blocked: event content exceeds the %d-byte relay limit",
					largecontent.MaxContentBytes,
				)
			}
			return false, ""
		},
		policies.PreventTimestampsInTheFuture(30*time.Minute),
		func(ctx context.Context, evt nostr.Event) (bool, string) {
			logger.Debug("event", "kind", int(evt.Kind), "id", evt.ID.Hex(), "pubkey", evt.PubKey.Hex()[:8])
			return false, ""
		},
	)

	mux := http.NewServeMux()
	mux.Handle("/", relay)
	mux.HandleFunc("/earthly-search", func(w http.ResponseWriter, r *http.Request) {
		docs, _ := search.DocCount()
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Access-Control-Allow-Origin", "*")
		json.NewEncoder(w).Encode(map[string]any{
			"version":    earthlysearch.GrammarVersion,
			"extensions": earthlysearch.GrammarExtensions,
			"documents":  docs,
		})
	})

	server := &http.Server{Addr: "0.0.0.0:" + *port, Handler: mux}

	go func() {
		logger.Info("earthly relay listening", "addr", server.Addr, "data", *dataDir, "indexedDocs", docCount)
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			fatal(logger, "server failed", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop

	logger.Info("shutting down")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	server.Shutdown(shutdownCtx)
}

func newLogger(level string) *slog.Logger {
	var l slog.Level
	switch level {
	case "debug":
		l = slog.LevelDebug
	case "warn":
		l = slog.LevelWarn
	case "error":
		l = slog.LevelError
	default:
		l = slog.LevelInfo
	}
	return slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: l}))
}

func fatal(logger *slog.Logger, msg string, err error) {
	logger.Error(msg, "err", err)
	os.Exit(1)
}

// watchDiskBudget polls free space on the data volume and flips a flag that
// makes the relay refuse writes (logged once per transition) instead of
// filling the disk and crash-looping the whole machine.
func watchDiskBudget(logger *slog.Logger, dir string, minFree int64) *atomic.Bool {
	full := &atomic.Bool{}

	check := func() {
		var stat syscall.Statfs_t
		if err := syscall.Statfs(dir, &stat); err != nil {
			return
		}
		free := int64(stat.Bavail) * int64(stat.Bsize)
		wasFull := full.Load()
		isFull := free < minFree
		if isFull != wasFull {
			full.Store(isFull)
			if isFull {
				logger.Error("disk budget exceeded — refusing event writes", "freeBytes", free, "minFreeBytes", minFree)
			} else {
				logger.Info("disk budget recovered — accepting event writes", "freeBytes", free)
			}
		}
	}

	check()
	go func() {
		ticker := time.NewTicker(time.Minute)
		defer ticker.Stop()
		for range ticker.C {
			check()
		}
	}()

	return full
}
