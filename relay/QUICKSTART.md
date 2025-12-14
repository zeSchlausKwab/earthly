# Quick Start Guide

Welcome to the Earthly Radio Relay! This is a dead-simple Nostr relay with full-text search.

## 🎯 What You Get

- **SQLite database** - All your events in `./data/events.db`
- **Bluge search index** - Fast full-text search in `./data/search/`
- **No containers** - Just files on disk
- **NIP-50 support** - Full-text search for radio stations

## 🚀 Get Started (2 commands)

```bash
./setup.sh    # Install dependencies
make dev      # Start the relay
```

That's it! Your relay is now running on `ws://localhost:3334`

## 📊 What's Happening

The relay stores events in two places:

1. **SQLite** (`data/events.db`) - All events, permanent storage
2. **Bluge** (`data/search/`) - Search index for fast queries

When you query:

- Regular filters → SQLite
- Filters with `search` field → Bluge (which fetches from SQLite)

## 🔍 Testing Search

Connect a Nostr client and try:

```json
{
  "kinds": [31237],
  "search": "jazz"
}
```

This will search through station names and descriptions.

## 🗑️ Reset Data

```bash
make reset-all     # Delete everything, start fresh
make reset-db      # Just delete the database
make reset-index   # Just delete the search index
```

## 📁 File Structure

```
relay/
├── data/
│   ├── events.db         # SQLite database
│   └── search/          # Bluge search index
│       └── (index files)
├── main.go              # Relay code
└── Makefile            # Commands
```

## 🎛️ Configuration

All flags and their defaults:

```bash
go run . \
  --port 3334 \                      # Port to listen on
  --db-path ./data/events.db \       # SQLite database
  --search-path ./data/search        # Search index
```

## 🐛 Troubleshooting

### Port already in use?

```bash
go run . --port 8080
```

### Want to start fresh?

```bash
make reset-all
go run .
```

### Check what's stored?

```bash
# View events in SQLite
sqlite3 data/events.db "SELECT * FROM events LIMIT 10;"

# Check file sizes
du -sh data/
```

## 🔥 Production Tips

1. **Build it**: `make build` creates `bin/relay`
2. **Run it**: `./bin/relay --port 3334`
3. **Backup**: Just copy the `data/` directory!
4. **Monitor**: Check file sizes with `du -sh data/`

## 📚 Learn More

- Full docs: [README.md](README.md)
- Main project: [../README.md](../README.md)
- Event spec: [../SPEC.md](../SPEC.md)
