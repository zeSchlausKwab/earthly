package largecontent

import (
	"strings"
	"testing"

	"fiatjaf.com/nostr"
	"fiatjaf.com/nostr/eventstore/lmdb"
)

func signedDataset(t *testing.T, secret nostr.SecretKey, createdAt nostr.Timestamp, content string) nostr.Event {
	t.Helper()
	event := nostr.Event{
		Kind:      37515,
		CreatedAt: createdAt,
		Tags:      nostr.Tags{{"d", "large-dataset"}},
		Content:   content,
	}
	if err := event.Sign(secret); err != nil {
		t.Fatal(err)
	}
	return event
}

func collectEvents(sequence func(func(nostr.Event) bool)) []nostr.Event {
	var events []nostr.Event
	sequence(func(event nostr.Event) bool {
		events = append(events, event)
		return true
	})
	return events
}

func openTestStore(t *testing.T, root string) *Store {
	t.Helper()
	store := New(
		&lmdb.LMDBBackend{Path: root + "/events-lmdb"},
		root+"/large-content.db",
	)
	if err := store.Init(); err != nil {
		t.Fatal(err)
	}
	return store
}

func TestLargeContentSurvivesRestartWithValidSignature(t *testing.T) {
	root := t.TempDir()
	secret := nostr.Generate()
	content := strings.Repeat("earthly-geometry-", 50_000)
	event := signedDataset(t, secret, nostr.Now(), content)

	store := openTestStore(t, root)
	if err := store.SaveEvent(event); err != nil {
		t.Fatal(err)
	}
	store.Close()

	store = openTestStore(t, root)
	t.Cleanup(store.Close)
	events := collectEvents(store.QueryEvents(nostr.Filter{IDs: []nostr.ID{event.ID}}, 1))
	if len(events) != 1 {
		t.Fatalf("query returned %d events, want 1", len(events))
	}
	if events[0].Content != content {
		t.Fatalf("rehydrated content length = %d, want %d", len(events[0].Content), len(content))
	}
	if !events[0].VerifySignature() {
		t.Fatal("rehydrated event no longer has a valid signature")
	}
}

func TestLargeContentReplaceAndDelete(t *testing.T) {
	store := openTestStore(t, t.TempDir())
	t.Cleanup(store.Close)
	secret := nostr.Generate()
	first := signedDataset(t, secret, nostr.Now(), strings.Repeat("a", 200_000))
	second := signedDataset(t, secret, first.CreatedAt+1, strings.Repeat("b", 300_000))

	if _, err := store.ReplaceEvent(first); err != nil {
		t.Fatal(err)
	}
	deleted, err := store.ReplaceEvent(second)
	if err != nil {
		t.Fatal(err)
	}
	if len(deleted) != 1 || deleted[0].Content != first.Content {
		t.Fatalf("deleted events were not rehydrated: %#v", deleted)
	}

	events := collectEvents(store.QueryEvents(nostr.Filter{
		Kinds:   []nostr.Kind{second.Kind},
		Authors: []nostr.PubKey{second.PubKey},
		Tags:    nostr.TagMap{"d": []string{"large-dataset"}},
	}, 10))
	if len(events) != 1 || events[0].ID != second.ID || events[0].Content != second.Content {
		t.Fatalf("replacement query returned %#v", events)
	}

	if err := store.DeleteEvent(second.ID); err != nil {
		t.Fatal(err)
	}
	if events := collectEvents(store.QueryEvents(nostr.Filter{IDs: []nostr.ID{second.ID}}, 1)); len(events) != 0 {
		t.Fatalf("deleted event is still queryable: %#v", events)
	}
}

func TestDuplicateLargeReplacementKeepsContent(t *testing.T) {
	store := openTestStore(t, t.TempDir())
	t.Cleanup(store.Close)
	event := signedDataset(t, nostr.Generate(), nostr.Now(), strings.Repeat("same", 100_000))

	if _, err := store.ReplaceEvent(event); err != nil {
		t.Fatal(err)
	}
	if _, err := store.ReplaceEvent(event); err != nil {
		t.Fatal(err)
	}
	events := collectEvents(store.QueryEvents(nostr.Filter{IDs: []nostr.ID{event.ID}}, 1))
	if len(events) != 1 || events[0].Content != event.Content {
		t.Fatalf("duplicate replacement lost its sidecar content: %#v", events)
	}
}

func TestContentAboveOneMiBIsRejected(t *testing.T) {
	store := openTestStore(t, t.TempDir())
	t.Cleanup(store.Close)
	event := signedDataset(t, nostr.Generate(), nostr.Now(), strings.Repeat("x", MaxContentBytes+1))

	if err := store.SaveEvent(event); err == nil {
		t.Fatal("expected content above the 1 MiB relay policy to be rejected")
	}
}
