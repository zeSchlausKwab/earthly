# Earthly Relay

A Nostr relay built with [khatru](https://khatru.nostr.technology/) that provides full-text search support for internet radio stations using [Bluge](https://github.com/blugelabs/bluge) and stores events in SQLite.

## Features

- **Full-Text Search**: Search radio stations by name and description using NIP-50
- **SQLite Storage**: Persistent event storage with SQLite (just a file!)
- **Bluge Indexing**: Fast full-text search with Bluge
- **Reset Options**: CLI flags to reset database, index, or both
- **No Dependencies**: No containers or external databases needed

## Requirements

- Go 1.23 or higher
- That's it! Everything else is just files.

## Quick Start

```bash
# Run the setup script
./setup.sh

# Start the relay
make dev
```

That's it! No Docker, no containers, just Go and some files.

## Installation

### Automated Setup

```bash
./setup.sh
```

This will:

- Check for Go installation
- Create the data directory
- Install Go dependencies

### Manual Setup

1. **Install Go 1.23 or higher**

2. **Create data directory**:

   ```bash
   mkdir -p data
   ```

3. **Install Go dependencies**:
   ```bash
   make install
   # Or manually
   go mod download
   go mod tidy
   ```

## Configuration

All configuration is done via command-line flags (no environment files needed):

- `PORT`: Port to listen on (default: 3334)
- `DB_PATH`: SQLite database file path (default: ./data/events.db)
- `SEARCH_PATH`: Path to store the search index (default: ./data/search)

## Usage

### Running the Relay

```bash
# Development mode (auto-reload)
make dev

# Production mode
make build
make run

# Or directly
go run .
```

### Command Line Flags

```bash
# Reset database only
go run . --reset-db

# Reset search index only
go run . --reset-index

# Reset everything
go run . --reset-all

# Custom port
go run . --port 8080

# Custom database path
go run . --db-path /path/to/events.db

# Custom search path
go run . --search-path /path/to/search/index
```

### Make Commands

```bash
make setup        # Run the setup script
make build        # Build the relay binary
make run          # Build and run the relay
make dev          # Run in development mode
make clean        # Clean build artifacts and data
make reset-db     # Reset the database
make reset-index  # Reset the search index
make reset-all    # Reset both database and index
make install      # Install Go dependencies
```

## NIP-50 Search

The relay implements NIP-50 full-text search for radio stations (kind 31237). It indexes:

- Station `name` tag
- Station `description` from the content JSON

Example search filter:

```json
{
  "kinds": [31237],
  "search": "jazz radio"
}
```

## Architecture

- **Primary Storage**: SQLite - stores all events in `./data/events.db`
- **Search Index**: Bluge - indexes station names and descriptions in `./data/search/`
- **Query Routing**:
  - Filters with `search` field → Bluge
  - All other filters → SQLite

Everything is just files! No external databases or containers needed.

## Event Kinds Supported

- **31237**: Radio Station Events (with search indexing)
- **30078**: Favorites Lists & Featured Station Lists
- **31990**: NIP-89 Handler Events
- **31989**: NIP-89 Recommendation Events
- **1311**: Live Chat Messages
- **1111**: Station Comments

## Development

### Project Structure

```
relay/
├── main.go           # Main relay implementation
├── go.mod           # Go module definition
├── Makefile         # Build and development commands
├── README.md        # This file
└── .env.example     # Example environment configuration
```

### Adding Custom Event Handlers

The relay uses khatru's middleware system. You can add custom event handlers in `main.go`:

```go
relay.RejectEvent = append(relay.RejectEvent, func(ctx context.Context, event *nostr.Event) (bool, string) {
    // Custom validation logic
    return false, ""
})
```

## License

See the main project LICENSE file.
