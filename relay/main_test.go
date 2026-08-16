package main

import (
	"context"
	"strings"
	"testing"

	"fiatjaf.com/nostr"
	"github.com/schlaus/earthly-relay/largecontent"
)

func TestEventContentLimitKeepsOneMiBPublicPolicy(t *testing.T) {
	event := nostr.Event{Kind: 37515, Content: strings.Repeat("x", largecontent.MaxContentBytes+1)}
	reject, _ := rejectOversizedEventContent(context.Background(), event)
	if !reject {
		t.Fatal("ordinary event content above one MiB must be rejected")
	}
}

func TestEventContentLimitAllowsLargeEphemeralNip46Envelopes(t *testing.T) {
	event := nostr.Event{Kind: nostr.KindNostrConnect, Content: strings.Repeat("x", 7*1024*1024)}
	reject, message := rejectOversizedEventContent(context.Background(), event)
	if reject {
		t.Fatalf("one-MiB dataset signing envelope was rejected: %s", message)
	}

	event.Content += "x"
	reject, _ = rejectOversizedEventContent(context.Background(), event)
	if !reject {
		t.Fatal("NIP-46 transport content above its dedicated allowance must be rejected")
	}
}
