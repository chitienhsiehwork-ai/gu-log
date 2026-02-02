#!/bin/bash
set -e

MAX_ITER="$1"
PROMISE="$2"
shift 2
PROMPT="$*"

# Add promise instruction if set
if [ -n "$PROMISE" ]; then
    FULL_PROMPT="$PROMPT

To signal completion, you MUST output exactly: [[PROMISE: $PROMISE]]
ONLY output this when the statement is completely TRUE. Do NOT lie to exit."
else
    FULL_PROMPT="$PROMPT"
fi

echo "🔄 Ralph loop starting (max: $MAX_ITER iterations)" >&2
echo "" >&2

for i in $(seq 1 $MAX_ITER); do
    echo "════════════════════════════════════════" >&2
    echo "🔄 Ralph iteration $i/$MAX_ITER" >&2
    echo "════════════════════════════════════════" >&2

    # Create temp file to capture output while still displaying it
    TEMP_OUTPUT="/tmp/ralph-output-$$"

    if [ $i -eq 1 ]; then
        # First iteration: use -p flag
        claude -p "$FULL_PROMPT" --dangerously-skip-permissions --output-format text 2>&1 | tee "$TEMP_OUTPUT"
    else
        # Subsequent iterations: use --continue with stdin
        echo "$FULL_PROMPT" | claude --continue --dangerously-skip-permissions --output-format text 2>&1 | tee "$TEMP_OUTPUT"
    fi

    # Check for completion promise
    if [ -n "$PROMISE" ]; then
        if grep -qF "[[PROMISE: $PROMISE]]" "$TEMP_OUTPUT" 2>/dev/null; then
            echo "" >&2
            echo "════════════════════════════════════════" >&2
            echo "✅ Completion promise detected!" >&2
            echo "   [[PROMISE: $PROMISE]]" >&2
            echo "════════════════════════════════════════" >&2
            rm -f "$TEMP_OUTPUT"
            exit 0
        fi
    fi

    rm -f "$TEMP_OUTPUT"

    if [ $i -lt $MAX_ITER ]; then
        echo "" >&2
        echo "⏳ No promise detected, continuing..." >&2
        echo "" >&2
    fi
done

echo "" >&2
echo "════════════════════════════════════════" >&2
echo "🛑 Max iterations ($MAX_ITER) reached" >&2
echo "════════════════════════════════════════" >&2
