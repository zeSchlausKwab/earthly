package earthlysearch

import (
	"encoding/json"
	"os"
	"reflect"
	"testing"
)

// The golden vectors in spec/search-grammar-vectors.json pin the grammar for
// both this parser and the TypeScript serializer in src/lib/search/.

type vectorFile struct {
	Version int `json:"version"`
	Vectors []struct {
		Name   string          `json:"name"`
		Search string          `json:"search"`
		Parsed json.RawMessage `json:"parsed"`
	} `json:"vectors"`
	Invalid []struct {
		Name   string `json:"name"`
		Search string `json:"search"`
	} `json:"invalid"`
}

func loadVectors(t *testing.T) vectorFile {
	t.Helper()
	raw, err := os.ReadFile("../../spec/search-grammar-vectors.json")
	if err != nil {
		t.Fatalf("reading golden vectors: %v", err)
	}
	var vf vectorFile
	if err := json.Unmarshal(raw, &vf); err != nil {
		t.Fatalf("parsing golden vectors: %v", err)
	}
	if vf.Version != GrammarVersion {
		t.Fatalf("vector file version %d != grammar version %d", vf.Version, GrammarVersion)
	}
	return vf
}

func TestGoldenVectors(t *testing.T) {
	vf := loadVectors(t)

	for _, vec := range vf.Vectors {
		t.Run(vec.Name, func(t *testing.T) {
			params, err := ParseSearch(vec.Search)
			if err != nil {
				t.Fatalf("ParseSearch(%q) failed: %v", vec.Search, err)
			}

			// Compare through JSON so nil-vs-missing and float encoding are
			// normalized on both sides.
			actualJSON, err := json.Marshal(params)
			if err != nil {
				t.Fatal(err)
			}
			var actual, expected map[string]any
			if err := json.Unmarshal(actualJSON, &actual); err != nil {
				t.Fatal(err)
			}
			if err := json.Unmarshal(vec.Parsed, &expected); err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(actual, expected) {
				t.Errorf("parse mismatch for %q\n  got:  %s\n  want: %s", vec.Search, actualJSON, vec.Parsed)
			}
		})
	}
}

func TestGoldenVectorsInvalid(t *testing.T) {
	vf := loadVectors(t)

	for _, vec := range vf.Invalid {
		t.Run(vec.Name, func(t *testing.T) {
			if _, err := ParseSearch(vec.Search); err == nil {
				t.Errorf("ParseSearch(%q) should have failed", vec.Search)
			}
		})
	}
}

func TestParseSearchDefaults(t *testing.T) {
	params, err := ParseSearch("just some text")
	if err != nil {
		t.Fatal(err)
	}
	if params.Rel != RelIntersects || params.Sort != SortRelevance {
		t.Errorf("defaults not applied: rel=%q sort=%q", params.Rel, params.Sort)
	}
}
