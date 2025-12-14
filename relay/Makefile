.PHONY: build run dev clean reset-db reset-index reset-all install setup

# Setup everything
setup:
	@./setup.sh

# Build the relay binary
build:
	@echo "Building relay..."
	go build -o bin/relay .

# Run the relay
run: build
	@echo "Starting relay..."
	./bin/relay

# Run in development mode with auto-reload
dev:
	@echo "Starting relay in development mode..."
	go run . --port 3334

# Clean build artifacts
clean:
	@echo "Cleaning..."
	rm -rf bin/
	rm -rf data/

# Reset database only
reset-db:
	@echo "Resetting database..."
	go run . --reset-db

# Reset search index only
reset-index:
	@echo "Resetting search index..."
	go run . --reset-index

# Reset everything
reset-all:
	@echo "Resetting all data..."
	go run . --reset-all

# Install Go dependencies
install:
	@echo "Installing dependencies..."
	go mod download
	go mod tidy

