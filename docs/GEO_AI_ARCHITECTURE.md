# Geo-AI Copilot Architecture

A Nostr-native AI assistant for geographic tasks. Users bring their own AI provider; tools are served via ContextVM over Nostr.

## Vision

Users interact with an AI copilot that understands geography and can draw, query, and analyze spatial data through natural language.

```
┌─────────────────────────────────────────────────────────────────┐
│  User: "Draw the Blue Banana megalopolis across Europe"        │
├─────────────────────────────────────────────────────────────────┤
│  AI: I'll create that polygon for you.                         │
│  [Calling search_location("Blue Banana Europe")...]            │
│  [Calling query_osm_bbox(cities: industrial centers)...]       │
│  [Generated polygon with 847 vertices]                         │
│                                                                 │
│  ┌──────────────────────────────────────────────────────┐      │
│  │  🗺️ [Interactive Map with Blue Banana polygon]       │      │
│  │      [Edit] [Save to Dataset] [Share]                │      │
│  └──────────────────────────────────────────────────────┘      │
└─────────────────────────────────────────────────────────────────┘
```

---

## Core Principles

1. **No REST APIs** - All backend services are ContextVM servers over Nostr
2. **Bring Your Own AI** - User chooses and pays for their AI provider directly
3. **ContextVM for Tools** - Domain-specific tools (geo, web, etc.) via MCP over Nostr
4. **Client-Side Orchestration** - Frontend handles AI ↔ Tool coordination

---

## System Architecture

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                              FRONTEND (React + NDK)                           │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                               │
│  ┌─────────────┐    ┌─────────────┐    ┌──────────────────────────────────┐ │
│  │  GeoEditor  │◄──►│ Chat Panel  │◄──►│  AI Orchestrator                 │ │
│  │  (MapLibre) │    │ (Messages)  │    │  - Sends prompts to AI provider  │ │
│  └─────────────┘    └─────────────┘    │  - Receives tool_calls           │ │
│        ▲                               │  - Executes via ContextVM        │ │
│        │                               │  - Returns results to AI         │ │
│        │                               └───────────┬──────────────────────┘ │
│        │                                           │                         │
│        │              ┌────────────────────────────┼────────────────────┐   │
│        │              │                            │                    │   │
└────────┼──────────────┼────────────────────────────┼────────────────────┼───┘
         │              │                            │                    │
         │              ▼                            ▼                    ▼
         │    ┌──────────────────┐        ┌─────────────────┐   ┌─────────────────┐
         │    │  AI Provider     │        │   ContextVM     │   │   ContextVM     │
         │    │  (User's Choice) │        │   Geo Server    │   │   Web Server    │
         │    │                  │        │                 │   │                 │
         │    │  • Routstr       │        │  • Nominatim    │   │  • Web search   │
         │    │  • OpenRouter    │        │  • Overpass     │   │  • URL fetch    │
         │    │  • OpenAI direct │        │  • Routing      │   │  • Wikipedia    │
         │    │  • Anthropic     │        │  • PMTiles      │   │  • Wikidata     │
         │    │  • Self-hosted   │        │  • Geometry ops │   │                 │
         │    │                  │        │                 │   │                 │
         │    │  [OpenAI SDK]    │        │  [Nostr/MCP]    │   │  [Nostr/MCP]    │
         │    └──────────────────┘        └─────────────────┘   └─────────────────┘
         │              │                          │                    │
         ▼              │                          │                    │
┌──────────────────┐    │                          │                    │
│   Nostr Relay    │◄───┴──────────────────────────┴────────────────────┘
│   (Khatru)       │
│                  │
│  • GeoJSON data  │
│  • Comments      │
│  • Chat history  │
└──────────────────┘
```

**Key separation:**
- **AI Provider** (HTTP/OpenAI SDK) - User's choice, user pays directly
- **ContextVM Tools** (Nostr/MCP) - Decentralized, no accounts needed

---

## Why User Brings Their Own AI Provider

| Benefit | Description |
|---------|-------------|
| **User choice** | Routstr, OpenRouter, OpenAI, Anthropic, self-hosted LLM |
| **Direct payment** | User pays with their own wallet/API key |
| **No middleman** | We don't see queries or handle payments |
| **Model selection** | User picks GPT-4, Claude, Llama, etc. |
| **Trust minimization** | No need to trust us with AI access |
| **Existing accounts** | Users can use API keys they already have |

### Supported Providers

Any OpenAI-compatible API works:

```typescript
// Routstr (Bitcoin/Cashu payments)
const client = new OpenAI({
  baseURL: "https://api.routstr.com/v1",
  apiKey: cashuToken,
});

// OpenRouter (many models, credit card)
const client = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
});

// OpenAI direct
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Self-hosted (Ollama, vLLM, etc.)
const client = new OpenAI({
  baseURL: "http://localhost:11434/v1",
  apiKey: "ollama",
});
```

---

## Message Flow

```
┌─────────┐         ┌─────────────┐         ┌─────────────┐         ┌─────────────┐
│  User   │         │  Frontend   │         │ AI Provider │         │  ContextVM  │
└────┬────┘         └──────┬──────┘         └──────┬──────┘         └──────┬──────┘
     │                     │                       │                       │
     │ "Find cafes near    │                       │                       │
     │  Central Park"      │                       │                       │
     │────────────────────►│                       │                       │
     │                     │                       │                       │
     │                     │  POST /chat/completions                       │
     │                     │  + tool definitions   │                       │
     │                     │──────────────────────►│                       │
     │                     │                       │                       │
     │                     │  tool_calls:          │                       │
     │                     │  [search_location,    │                       │
     │                     │   query_osm_nearby]   │                       │
     │                     │◄──────────────────────│                       │
     │                     │                       │                       │
     │                     │  MCP tool call (Nostr)                        │
     │                     │───────────────────────────────────────────────►
     │                     │                       │                       │
     │                     │  GeoJSON results      │                       │
     │                     │◄───────────────────────────────────────────────
     │                     │                       │                       │
     │                     │  POST /chat/completions                       │
     │                     │  + tool results       │                       │
     │                     │──────────────────────►│                       │
     │                     │                       │                       │
     │                     │  "Found 12 cafes..."  │                       │
     │                     │  + GeoJSON            │                       │
     │                     │◄──────────────────────│                       │
     │                     │                       │                       │
     │  Renders map with   │                       │                       │
     │  cafe markers       │                       │                       │
     │◄────────────────────│                       │                       │
     │                     │                       │                       │
```

---

## ContextVM Servers

All backend services are ContextVM MCP servers communicating over Nostr. No REST APIs.

### 1. Geo Server (existing: `contextvm/server.ts`)

Current tools:
| Tool | Description |
|------|-------------|
| `search_location` | Nominatim geocoding |
| `reverse_lookup` | Reverse geocoding |
| `query_osm_by_id` | Single OSM element by type/ID |
| `query_osm_nearby` | POIs near a point |
| `query_osm_bbox` | POIs in bounding box |
| `create_map_extract` | PMTiles extraction |
| `create_map_upload` | Blossom upload |

New tools needed:
| Tool | Description |
|------|-------------|
| `calculate_route` | A→B routing via OSRM/Valhalla |
| `route_with_waypoints` | Route via specified POIs |
| `generate_isochrone` | Travel time zones from point |
| `buffer_geometry` | Create buffer around geometry |
| `simplify_geometry` | Douglas-Peucker simplification |
| `union_geometries` | Merge multiple polygons |
| `clip_to_boundary` | Clip features to area |

### Practical Retrieval Lessons

The current chat + geo stack works best when geo retrieval follows a few rules:

- Prefer semantic expansion over prompt-specific presets.
  - Example: `military installation` should expand into multiple OSM tagging patterns instead of relying on one guessed tag.

- Treat borders and drawn polygons as hard constraints.
  - If the user asks for features inside Saudi Arabia or inside an attached polygon, fallback behavior must not silently widen to an unconstrained bbox import.

- Tile large bbox queries before hitting Overpass.
  - Country-scale scans are more reliable when split into smaller tiles and merged client-side/server-side.

- Make transient attachments directly callable by tools.
  - Attached scratch geometry should be available to tool execution for the current request, not only embedded in prompt prose.

- Keep canonical geometry and presentation separate.
  - Retrieval may preserve polygons/lines, while the map or import step can render representative points when the user explicitly asks for points.

- Compact tool feedback for the LLM, not for the UI protocol.
  - Models need counts, subtype summaries, and a few samples more than giant raw GeoJSON dumps.

- Map user phrasing to concrete spatial predicates.
  - "Inside" should resolve to a strict containment mode like `point_within`, not a looser `intersects` fallback.

### 2. Web Server (new: `contextvm/web-server.ts`)

Tools for internet research:
| Tool | Description |
|------|-------------|
| `web_search` | DuckDuckGo/Brave search |
| `fetch_url` | Fetch and parse webpage |
| `wikipedia_lookup` | Wikipedia by coords/topic |
| `wikidata_query` | SPARQL geo queries |
| `news_search` | Recent news for location |

### 3. Future Servers

| Server | Tools |
|--------|-------|
| **Analysis Server** | Walkability scores, demographics, land use stats |
| **Imagery Server** | Satellite tile analysis, land classification |
| **Historical Server** | Historical boundaries, timeline data |

---

## Use Cases

### Drawing & Generation
| Prompt | Tools Used |
|--------|------------|
| "Draw the Blue Banana megalopolis" | `search_location`, `query_osm_bbox` |
| "Create a polygon around downtown" | `search_location`, `buffer_geometry` |
| "Connect these waypoints with a scenic route" | `route_with_waypoints` |

### Discovery & Search
| Prompt | Tools Used |
|--------|------------|
| "Find all UNESCO sites within 50km" | `query_osm_nearby` |
| "What restaurants here have outdoor seating?" | `query_osm_bbox` |
| "Show me Art Deco buildings in Miami" | `query_osm_bbox`, `web_search` |

### Routing & Navigation
| Prompt | Tools Used |
|--------|------------|
| "Plan a bike route avoiding steep hills" | `calculate_route` |
| "Walk from A to B, passing a pharmacy" | `route_with_waypoints` |
| "Show 15-minute walk zones from this station" | `generate_isochrone` |

### Research & Analysis
| Prompt | Tools Used |
|--------|------------|
| "What's the history of this building?" | `reverse_lookup`, `wikipedia_lookup` |
| "Summarize recent news about this area" | `reverse_lookup`, `news_search` |
| "What's the zoning for this parcel?" | `query_osm_by_id`, `web_search` |

---

## Frontend Components

```
src/features/geo-chat/
├── components/
│   ├── ChatPanel.tsx           # Main chat UI
│   ├── ChatMessage.tsx         # Message rendering (text + maps)
│   ├── ToolCallIndicator.tsx   # "Searching locations..."
│   ├── MapPreview.tsx          # Inline map in chat
│   ├── ProviderSettings.tsx    # AI provider configuration
│   └── FeatureActions.tsx      # [Edit] [Save] [Share] buttons
│
├── hooks/
│   ├── useAIProvider.ts        # OpenAI SDK wrapper (any provider)
│   ├── useToolExecution.ts     # Route tools to ContextVM
│   ├── useChatHistory.ts       # Persist to Nostr events
│   └── useProviderConfig.ts    # Store provider settings
│
├── lib/
│   ├── toolDefinitions.ts      # OpenAI tool schemas
│   ├── contextVMClient.ts      # ContextVM Nostr transport
│   └── featureRenderer.ts      # GeoJSON → Editor features
│
└── store.ts                    # Chat state (Zustand)
```

---

## Provider Configuration UI

Users configure their AI provider in settings:

```
┌─────────────────────────────────────────────────────────────┐
│  AI Provider Settings                                       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Provider: [Routstr ▼]                                      │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ • Routstr (Bitcoin payments)                        │   │
│  │ • OpenRouter (100+ models)                          │   │
│  │ • OpenAI                                            │   │
│  │ • Anthropic                                         │   │
│  │ • Custom endpoint...                                │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  Model: [gpt-4o ▼]                                          │
│                                                             │
│  API Key: [••••••••••••••••]                                │
│                                                             │
│  [Test Connection]                     [Save]               │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

For Routstr, the "API Key" field accepts Cashu tokens directly.

---

## Tool Definition Schema

Tools defined in OpenAI function calling format, shared with AI provider:

```typescript
// toolDefinitions.ts
export const geoTools: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "search_location",
      description: "Search for locations using OpenStreetMap Nominatim. Returns coordinates, bounding boxes, and geojson outlines.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Place name or address to search for"
          },
          limit: {
            type: "number",
            description: "Maximum results (default: 5)"
          }
        },
        required: ["query"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "query_osm_nearby",
      description: "Find OpenStreetMap features near a point. Supports filtering by tags like amenity=cafe, shop=supermarket.",
      parameters: {
        type: "object",
        properties: {
          lat: { type: "number", description: "Latitude" },
          lon: { type: "number", description: "Longitude" },
          radius: { type: "number", description: "Search radius in meters" },
          filters: {
            type: "array",
            items: {
              type: "object",
              properties: {
                key: { type: "string" },
                value: { type: "string" }
              }
            },
            description: "OSM tag filters"
          }
        },
        required: ["lat", "lon", "radius"]
      }
    }
  }
  // ... more tools
];
```

---

## Implementation Phases

### Phase 1: Core Chat + Existing Tools
- [ ] Chat panel UI with streaming responses
- [ ] Provider configuration (Routstr, OpenRouter, OpenAI, custom)
- [ ] Tool execution bridge to existing Geo Server via ContextVM
- [ ] Render returned GeoJSON in GeoEditor
- [ ] Tool call indicators in UI

### Phase 2: Enhanced Geo Tools
- [ ] OSRM routing integration
- [ ] Isochrone generation (Valhalla)
- [ ] Geometric operations via Turf.js
- [ ] Multi-step tool chains

### Phase 3: Web Research ContextVM
- [ ] Web search tool (DuckDuckGo API)
- [ ] Wikipedia/Wikidata integration
- [ ] URL fetching and summarization
- [ ] News search for locations

### Phase 4: NIP-60 Wallet (for Routstr)
- [ ] Cashu wallet integration
- [ ] Token generation for Routstr sessions
- [ ] Balance display in UI

### Phase 5: Advanced Features
- [ ] Chat history persistence (Nostr events)
- [ ] Shareable chat sessions
- [ ] Multi-provider fallback

---

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **AI Provider** | User's choice | Freedom, direct payment, no middleman |
| **Tool Transport** | Nostr (ContextVM) | Decentralized, no REST APIs |
| **Tool Execution** | Client-side | Client orchestrates AI ↔ Tools |
| **Provider Config** | Local storage | User controls their keys |
| **Chat Persistence** | Nostr events | User owns data |

---

## Related Files

- [contextvm/server.ts](../contextvm/server.ts) - Existing ContextVM Geo Server
- [contextvm/geo-schemas.ts](../contextvm/geo-schemas.ts) - Zod schemas for tool I/O
- [contextvm/tools/](../contextvm/tools/) - Tool implementations

## References

- [ContextVM SDK](https://github.com/ArcadeLabsInc/contextvm)
- [OpenAI Function Calling](https://platform.openai.com/docs/guides/function-calling)
- [Routstr Docs](https://docs.routstr.com) - Bitcoin-paid AI inference
- [OpenRouter](https://openrouter.ai) - Multi-model API
- [NIP-60 Cashu Wallet](https://github.com/nostr-protocol/nips/blob/master/60.md)
