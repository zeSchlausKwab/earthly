// Package largecontent extends the relay's indexed LMDB event store with a
// durable content sidecar. The upstream betterbinary codec uses a uint16 for
// content length; Earthly keeps its indexes there and stores only larger event
// bodies in bbolt, rehydrating the original signed event before it leaves the
// store boundary.
package largecontent

import (
	"fmt"
	"iter"
	"os"
	"path/filepath"
	"strings"
	"time"

	"fiatjaf.com/nostr"
	"fiatjaf.com/nostr/eventstore"
	bolt "go.etcd.io/bbolt"
)

const (
	// MaxContentBytes is Earthly's advertised and enforced public relay policy.
	MaxContentBytes = 1024 * 1024

	codecContentBytes = 65_535
	markerPrefix      = "earthly-large-content:v1:"
)

var contentBucket = []byte("event-content-v1")

// Store preserves the existing eventstore indexes while moving event content
// that does not fit betterbinary into a separate transactional key/value file.
type Store struct {
	raw         eventstore.Store
	contentPath string
	contentDB   *bolt.DB
}

func New(raw eventstore.Store, contentPath string) *Store {
	return &Store{raw: raw, contentPath: contentPath}
}

func (s *Store) Init() error {
	if s.raw == nil {
		return fmt.Errorf("largecontent: missing raw event store")
	}
	if s.contentPath == "" {
		return fmt.Errorf("largecontent: missing content sidecar path")
	}
	if err := s.raw.Init(); err != nil {
		return fmt.Errorf("largecontent: initialize raw store: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(s.contentPath), 0o755); err != nil {
		s.raw.Close()
		return fmt.Errorf("largecontent: create sidecar directory: %w", err)
	}
	db, err := bolt.Open(s.contentPath, 0o600, &bolt.Options{Timeout: 5 * time.Second})
	if err != nil {
		s.raw.Close()
		return fmt.Errorf("largecontent: open sidecar: %w", err)
	}
	if err := db.Update(func(tx *bolt.Tx) error {
		_, err := tx.CreateBucketIfNotExists(contentBucket)
		return err
	}); err != nil {
		_ = db.Close()
		s.raw.Close()
		return fmt.Errorf("largecontent: initialize sidecar: %w", err)
	}
	s.contentDB = db
	return nil
}

func (s *Store) Close() {
	if s.contentDB != nil {
		_ = s.contentDB.Close()
		s.contentDB = nil
	}
	if s.raw != nil {
		s.raw.Close()
	}
}

func (s *Store) QueryEvents(filter nostr.Filter, maxLimit int) iter.Seq[nostr.Event] {
	return func(yield func(nostr.Event) bool) {
		for event := range s.raw.QueryEvents(filter, maxLimit) {
			hydrated, ok := s.hydrate(event)
			if !ok {
				continue
			}
			if !yield(hydrated) {
				return
			}
		}
	}
}

func (s *Store) DeleteEvent(id nostr.ID) error {
	if err := s.raw.DeleteEvent(id); err != nil {
		return err
	}
	return s.deleteContent(id)
}

func (s *Store) SaveEvent(event nostr.Event) error {
	stored, err := s.prepare(event)
	if err != nil {
		return err
	}
	return s.raw.SaveEvent(stored)
}

func (s *Store) ReplaceEvent(event nostr.Event) ([]nostr.Event, error) {
	stored, err := s.prepare(event)
	if err != nil {
		return nil, err
	}
	deleted, err := s.raw.ReplaceEvent(stored)
	if err != nil {
		return nil, err
	}

	hydrated := make([]nostr.Event, 0, len(deleted))
	for _, previous := range deleted {
		if full, ok := s.hydrate(previous); ok {
			hydrated = append(hydrated, full)
		}
		// A duplicate replacement can report the same event as deleted. Its
		// content remains canonical for the newly stored marker.
		if previous.ID == event.ID {
			continue
		}
		if err := s.deleteContent(previous.ID); err != nil {
			return hydrated, err
		}
	}
	return hydrated, nil
}

func (s *Store) CountEvents(filter nostr.Filter) (uint32, error) {
	return s.raw.CountEvents(filter)
}

func (s *Store) prepare(event nostr.Event) (nostr.Event, error) {
	contentBytes := len(event.Content)
	if contentBytes > MaxContentBytes {
		return nostr.Event{}, fmt.Errorf(
			"event content is %d bytes; Earthly relay limit is %d bytes",
			contentBytes,
			MaxContentBytes,
		)
	}
	if contentBytes <= codecContentBytes {
		return event, nil
	}
	if err := s.putContent(event.ID, event.Content); err != nil {
		return nostr.Event{}, err
	}
	stored := event
	stored.Content = markerPrefix + event.ID.Hex()
	return stored, nil
}

func (s *Store) hydrate(event nostr.Event) (nostr.Event, bool) {
	if !strings.HasPrefix(event.Content, markerPrefix) {
		return event, true
	}
	content, found, err := s.getContent(event.ID)
	if err != nil {
		return nostr.Event{}, false
	}
	if found {
		event.Content = content
		return event, true
	}
	// Never emit a marker as if it were the signed content. This can only
	// happen after sidecar corruption or manual file removal.
	return nostr.Event{}, false
}

func (s *Store) putContent(id nostr.ID, content string) error {
	if s.contentDB == nil {
		return fmt.Errorf("largecontent: sidecar is not initialized")
	}
	return s.contentDB.Update(func(tx *bolt.Tx) error {
		return tx.Bucket(contentBucket).Put(id[:], []byte(content))
	})
}

func (s *Store) getContent(id nostr.ID) (string, bool, error) {
	if s.contentDB == nil {
		return "", false, fmt.Errorf("largecontent: sidecar is not initialized")
	}
	var content []byte
	err := s.contentDB.View(func(tx *bolt.Tx) error {
		value := tx.Bucket(contentBucket).Get(id[:])
		if value != nil {
			content = append(content, value...)
		}
		return nil
	})
	return string(content), content != nil, err
}

func (s *Store) deleteContent(id nostr.ID) error {
	if s.contentDB == nil {
		return fmt.Errorf("largecontent: sidecar is not initialized")
	}
	return s.contentDB.Update(func(tx *bolt.Tx) error {
		return tx.Bucket(contentBucket).Delete(id[:])
	})
}
