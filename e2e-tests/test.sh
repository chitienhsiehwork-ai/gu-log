#!/bin/bash

# Configuration
URL="https://gu-log.vercel.app/"
DEVICE="iPhone 15 Pro"
SCREENSHOT_DIR="./e2e-tests/screenshots"
SNAPSHOTS_DIR="./e2e-tests/snapshots"

FAILURES=0

mkdir -p "$SCREENSHOT_DIR"
mkdir -p "$SNAPSHOTS_DIR"

echo "=============================================="
echo " Starting agent-browser E2E Suite for gu-log"
echo "=============================================="

# Step 1: Open Homepage and Title Validation
echo "[1/6] Testing Homepage Load & Meta Data..."
agent-browser --device "$DEVICE" open "$URL"
sleep 3

TITLE=$(agent-browser eval "document.title")
echo "      Page Title: $TITLE"
if [[ "$TITLE" == *"ShroomDog"* ]] || [[ "$TITLE" == *"Gu Log"* ]]; then
    echo "      ✅ PASS: Title validation"
else
    echo "      ❌ FAIL: Unexpected title: $TITLE"
    FAILURES=$((FAILURES+1))
fi

echo "      Measuring Homepage Load Time..."
TIMING=$(agent-browser eval "JSON.stringify(performance.timing)")
echo "      Timing info collected."

# Take homepage screenshot (annotated)
agent-browser screenshot --annotate "$SCREENSHOT_DIR/homepage_annotated.png"
agent-browser snapshot -i > "$SNAPSHOTS_DIR/homepage_a11y.txt"
echo "      ✅ Annotated screenshot & a11y tree saved."

# Step 2: Theme Toggle Test
echo "[2/6] Testing Theme Toggle..."
THEME_BEFORE=$(agent-browser eval "document.documentElement.getAttribute('data-theme')")
echo "      Initial theme: $THEME_BEFORE"

agent-browser find role button click --name "Toggle theme"
sleep 1

THEME_AFTER=$(agent-browser eval "document.documentElement.getAttribute('data-theme')")
echo "      Theme after click: $THEME_AFTER"

if [ "$THEME_BEFORE" != "$THEME_AFTER" ] && [ -n "$THEME_AFTER" ]; then
    echo "      ✅ PASS: Theme changed ($THEME_BEFORE -> $THEME_AFTER)"
else
    echo "      ❌ FAIL: Theme toggle failed"
    FAILURES=$((FAILURES+1))
fi
agent-browser screenshot "$SCREENSHOT_DIR/theme_toggled.png"

# Step 3: Search Toggle Test
echo "[3/6] Testing Search Toggle..."
agent-browser find role button click --name "Toggle search"
sleep 1

SEARCH_INPUT_EXISTS=$(agent-browser eval 'document.querySelector("input[class*=\"search\"], input[data-search-input]") !== null')

if [ "$SEARCH_INPUT_EXISTS" = "true" ]; then
    echo "      ✅ PASS: Search input appeared"
    agent-browser screenshot "$SCREENSHOT_DIR/search_open.png"
else
    echo "      ❌ FAIL: Search input did not appear"
    FAILURES=$((FAILURES+1))
fi

# Close search by pressing Escape
agent-browser eval 'document.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", code: "Escape", bubbles: true}))'
sleep 1

# Step 4: Blog Post Navigation
echo "[4/6] Testing Article Navigation..."
agent-browser eval 'document.querySelector("main a[href*=\"/posts/\"]").click()'
sleep 3

ARTICLE_EXISTS=$(agent-browser eval 'document.querySelector("article") !== null')
if [ "$ARTICLE_EXISTS" = "true" ]; then
    echo "      ✅ PASS: Article loaded successfully"
else
    echo "      ❌ FAIL: Article <article> tag not found"
    FAILURES=$((FAILURES+1))
fi

echo "      Measuring Article Load Time..."
TIMING2=$(agent-browser eval "JSON.stringify(performance.timing)")
echo "      Timing info collected."

agent-browser screenshot --annotate "$SCREENSHOT_DIR/article_annotated.png"
agent-browser snapshot -i > "$SNAPSHOTS_DIR/article_a11y.txt"
echo "      ✅ Annotated screenshot & a11y tree saved."

# Step 5: Scroll & Back to top (Bonus Feature Test)
echo "[5/6] Testing Scroll Behavior..."
agent-browser scroll down 2000
sleep 1
agent-browser scroll down 2000
sleep 1
agent-browser screenshot "$SCREENSHOT_DIR/scrolled_down.png"
echo "      ✅ Scrolled down the article page"

# Step 6: Localization / Menu check (Bonus)
echo "[6/6] Checking for Localization Link..."
HAS_EN=$(agent-browser eval 'document.querySelector("a[href*=\"/en\"]") !== null || Array.from(document.querySelectorAll("a")).some(a => a.textContent.trim() === "En")')
if [ "$HAS_EN" = "true" ]; then
    echo "      ✅ PASS: Found En language toggle link"
else
    echo "      ⚠️ INFO: En link not found, skipping..."
fi

echo "=============================================="
if [ $FAILURES -eq 0 ]; then
    echo "🎉 ALL E2E TESTS PASSED SUCCESSFULLY!"
    exit 0
else
    echo "🚨 $FAILURES TEST(S) FAILED!"
    exit $FAILURES
fi
