# GEMINI.md

## Project Overview

This is a web application for editing and sharing geographic data, built on the Nostr protocol. The frontend is a React/TypeScript application using MapLibre GL for map rendering and a sophisticated GeoJSON editor. The backend consists of two main parts: a Nostr relay written in Go and a context-aware geocoding server running on Bun.

**Key Technologies:**

*   **Frontend:** React, TypeScript, Bun, MapLibre GL, Tailwind CSS, shadcn/ui
*   **Backend:**
    *   **Geocoding Server:** Bun, TypeScript, `@contextvm/sdk`, `@modelcontextprotocol/sdk` (for Nostr-based RPC)
    *   **Nostr Relay:** Go, `khatru`, SQLite, Bluge (for search)
*   **Protocol:** Nostr

**Architecture:**

1.  **Frontend Application (`src/`):** A single-page application that provides a rich user interface for creating, editing, and viewing geographic data. It communicates with the Nostr relay for real-time data and with the geocoding server for location search.
2.  **Geocoding Server (`contextvm/`):** A Bun server that exposes geocoding and reverse-geocoding tools over the Nostr protocol using the Model Context Protocol. It uses the Nominatim (OpenStreetMap) API to perform the actual geocoding.
3.  **Nostr Relay (`relay/`):** A central piece of the backend that facilitates communication between clients. It's a Go application that stores and serves Nostr events, with a search functionality provided by Bluge.
4.  **Deployment:** The application is served using Caddy, which acts as a reverse proxy to the frontend development server.

## Building and Running

### Development

To start the development server, run:

```bash
bun dev
```

This will start the frontend application, the geocoding server, and the Nostr relay.

### Production

To build the project for production, use:

```bash
bun build
```

And to run the production server:

```bash
bun start
```

### Individual Components

*   **Run the relay:**
    ```bash
    bun relay
    ```

*   **Run the geocoding server:**
    The geocoding server is started as part of the `bun dev` command. To run it independently, you can use:
    ```bash
    bun contextvm/server.ts
    ```

## Development Conventions

*   The project uses `bun` as the package manager and runtime.
*   The frontend code is located in the `src/` directory and follows standard React practices.
*   The backend Go relay is in `relay/` and uses a Makefile for simple tasks.
*   Environment variables are managed using a schema defined in `src/config/env.schema.ts`.
*   The custom build script `build.ts` handles the production build process, including environment variable injection.
*   The project uses a custom Nostr relay, which suggests that specific NIPs (Nostr Implementation Possibilities) and event kinds might be in use. The relay code in `relay/main.go` would be the place to look for details.
