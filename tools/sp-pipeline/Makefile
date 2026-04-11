BIN         := bin/sp-pipeline
GO          ?= go
PKG         := ./cmd/sp-pipeline
BUILD_FLAGS := -trimpath -ldflags="-s -w"

.PHONY: all build test vet fmt clean run doctor fetch

all: build

build: $(BIN)

$(BIN): $(shell find . -name '*.go' -not -path './bin/*') go.mod go.sum
	@mkdir -p bin
	$(GO) build $(BUILD_FLAGS) -o $(BIN) $(PKG)

test:
	$(GO) test ./...

vet:
	$(GO) vet ./...

fmt:
	$(GO) fmt ./...

clean:
	rm -rf bin/

run: build
	./$(BIN) $(ARGS)

doctor: build
	./$(BIN) doctor

fetch: build
	@test -n "$(URL)" || (echo "URL=<tweet_url> required"; exit 1)
	./$(BIN) fetch $(URL)
