#!/usr/bin/env bash
# validate-scene-script.sh
# Pre-oracle validation gate for scene simulation output
#
# Checks:
# 1. Dialogue ratio — voice entries with non-empty dialogue vs total
# 2. Consecutive silence — no 3+ consecutive beats with ALL characters silent
# 3. Frame presence — if author.yaml has interpretive_frames, frames must be non-null
# 4. Frame diversity — no more than 2 consecutive beats with same frame, 3+ unique required
#
# Usage: validate-scene-script.sh <workspace_path> <game_root_path>
# Exit: 0 = pass, 1 = fail (reasons on stdout)

set -euo pipefail

WORKSPACE="${1:?Usage: validate-scene-script.sh <workspace_path> <game_root_path>}"
GAME_ROOT="${2:?Usage: validate-scene-script.sh <workspace_path> <game_root_path>}"

BEAT_DIR="$WORKSPACE/beat_tables"
AUTHOR_YAML="$GAME_ROOT/author.yaml"

FAILURES=()
PASS_NOTES=()

# ── Preflight ──────────────────────────────────────────────────────

if [[ ! -d "$BEAT_DIR" ]]; then
    echo "FAIL — beat_tables/ directory not found at $BEAT_DIR"
    exit 1
fi

BEAT_FILES=("$BEAT_DIR"/beat_*.yaml)
if [[ ${#BEAT_FILES[@]} -eq 0 || ! -f "${BEAT_FILES[0]}" ]]; then
    echo "FAIL — no beat_*.yaml files found in $BEAT_DIR"
    exit 1
fi

if [[ ! -f "$AUTHOR_YAML" ]]; then
    echo "FAIL — author.yaml not found at $AUTHOR_YAML"
    exit 1
fi

BEAT_COUNT=${#BEAT_FILES[@]}

# ── Parse dialogue ratio target from author.yaml ──────────────────

# Extract dialogue_description ratio (e.g., "60/40" means 60% dialogue)
DIALOGUE_TARGET=50  # default fallback
RATIO_LINE=$(grep -A1 'dialogue_description:' "$AUTHOR_YAML" | grep 'ratio:' | head -1 || true)
if [[ -n "$RATIO_LINE" ]]; then
    # Extract first number from ratio like "60/40"
    RATIO_VAL=$(echo "$RATIO_LINE" | grep -oE '[0-9]+/[0-9]+' | head -1 || true)
    if [[ -n "$RATIO_VAL" ]]; then
        DIALOGUE_TARGET=$(echo "$RATIO_VAL" | cut -d'/' -f1)
    fi
fi

# ── Check 1: Dialogue ratio ──────────────────────────────────────

TOTAL_VOICE_ENTRIES=0
DIALOGUE_ENTRIES=0

for bf in "${BEAT_FILES[@]}"; do
    # Count voice entries: lines matching "character:" under voices/voice section
    CHAR_COUNT=$(grep -cE '^\s+-?\s*character:' "$bf" || true)
    TOTAL_VOICE_ENTRIES=$((TOTAL_VOICE_ENTRIES + CHAR_COUNT))

    # Count entries with non-empty dialogue
    # Pattern: dialogue: "something" or dialogue: 'something' (not dialogue: "" or dialogue: '')
    # Read character blocks and check dialogue field
    IN_VOICE=0
    CURRENT_HAS_DIALOGUE=0
    while IFS= read -r line; do
        if [[ "$line" =~ ^[[:space:]]*-?[[:space:]]*character: ]]; then
            if [[ $IN_VOICE -eq 1 && $CURRENT_HAS_DIALOGUE -eq 1 ]]; then
                DIALOGUE_ENTRIES=$((DIALOGUE_ENTRIES + 1))
            fi
            IN_VOICE=1
            CURRENT_HAS_DIALOGUE=0
        fi
        if [[ $IN_VOICE -eq 1 && "$line" =~ ^[[:space:]]+dialogue: ]]; then
            # Extract value after dialogue:
            DV=$(echo "$line" | sed 's/^[[:space:]]*dialogue:[[:space:]]*//')
            # Non-empty if not "", '', or empty
            if [[ -n "$DV" && "$DV" != '""' && "$DV" != "''" && "$DV" != "null" ]]; then
                CURRENT_HAS_DIALOGUE=1
            fi
        fi
    done < "$bf"
    # Handle last character in file
    if [[ $IN_VOICE -eq 1 && $CURRENT_HAS_DIALOGUE -eq 1 ]]; then
        DIALOGUE_ENTRIES=$((DIALOGUE_ENTRIES + 1))
    fi
done

if [[ $TOTAL_VOICE_ENTRIES -gt 0 ]]; then
    DIALOGUE_PCT=$((DIALOGUE_ENTRIES * 100 / TOTAL_VOICE_ENTRIES))
else
    DIALOGUE_PCT=0
fi

if [[ $DIALOGUE_PCT -lt $DIALOGUE_TARGET ]]; then
    # Find which beats have no dialogue
    SILENT_BEATS=()
    for bf in "${BEAT_FILES[@]}"; do
        BEAT_NUM=$(grep -oE 'beat:[[:space:]]*[0-9]+' "$bf" | head -1 | grep -oE '[0-9]+' || basename "$bf" .yaml | grep -oE '[0-9]+')
        HAS_ANY_DIALOGUE=0
        while IFS= read -r line; do
            if [[ "$line" =~ ^[[:space:]]+dialogue: ]]; then
                DV=$(echo "$line" | sed 's/^[[:space:]]*dialogue:[[:space:]]*//')
                if [[ -n "$DV" && "$DV" != '""' && "$DV" != "''" && "$DV" != "null" ]]; then
                    HAS_ANY_DIALOGUE=1
                fi
            fi
        done < "$bf"
        if [[ $HAS_ANY_DIALOGUE -eq 0 ]]; then
            SILENT_BEATS+=("$BEAT_NUM")
        fi
    done
    SILENT_LIST=$(IFS=,; echo "${SILENT_BEATS[*]}")
    FAILURES+=("FAIL — dialogue ${DIALOGUE_PCT}% (target ${DIALOGUE_TARGET}%) — beats ${SILENT_LIST} have no dialogue for any character")
else
    PASS_NOTES+=("dialogue ${DIALOGUE_PCT}% (target ${DIALOGUE_TARGET}%)")
fi

# ── Check 2: Consecutive silence ─────────────────────────────────

CONSEC_SILENT=0
MAX_CONSEC_SILENT=0

for bf in "${BEAT_FILES[@]}"; do
    HAS_ANY_DIALOGUE=0
    while IFS= read -r line; do
        if [[ "$line" =~ ^[[:space:]]+dialogue: ]]; then
            DV=$(echo "$line" | sed 's/^[[:space:]]*dialogue:[[:space:]]*//')
            if [[ -n "$DV" && "$DV" != '""' && "$DV" != "''" && "$DV" != "null" ]]; then
                HAS_ANY_DIALOGUE=1
            fi
        fi
    done < "$bf"
    if [[ $HAS_ANY_DIALOGUE -eq 0 ]]; then
        CONSEC_SILENT=$((CONSEC_SILENT + 1))
    else
        CONSEC_SILENT=0
    fi
    if [[ $CONSEC_SILENT -gt $MAX_CONSEC_SILENT ]]; then
        MAX_CONSEC_SILENT=$CONSEC_SILENT
    fi
done

if [[ $MAX_CONSEC_SILENT -ge 3 ]]; then
    FAILURES+=("FAIL — ${MAX_CONSEC_SILENT} consecutive beats with ALL characters silent")
fi

# ── Check 3 & 4: Frame presence and diversity ────────────────────

# Check if author.yaml has interpretive_frames
HAS_FRAMES=$(grep -c '^interpretive_frames:' "$AUTHOR_YAML" || true)

if [[ $HAS_FRAMES -gt 0 ]]; then
    FRAMES=()
    NULL_FRAMES=0

    for bf in "${BEAT_FILES[@]}"; do
        # Extract top-level frame field (not indented under other keys)
        FRAME_VAL=$(grep -E '^frame:' "$bf" | head -1 | sed 's/^frame:[[:space:]]*//' | tr -d '"' | tr -d "'" || true)
        if [[ -z "$FRAME_VAL" || "$FRAME_VAL" == "null" || "$FRAME_VAL" == "~" ]]; then
            NULL_FRAMES=$((NULL_FRAMES + 1))
            FRAMES+=("null")
        else
            FRAMES+=("$FRAME_VAL")
        fi
    done

    # Check: all null?
    if [[ $NULL_FRAMES -eq $BEAT_COUNT ]]; then
        FAILURES+=("FAIL — all ${BEAT_COUNT} beats have null frame — interpretive_frames defined but unused")
    else
        # Count unique non-null frames
        UNIQUE_FRAMES=$(printf '%s\n' "${FRAMES[@]}" | grep -v '^null$' | sort -u | wc -l | tr -d ' ')

        # Check >50% same frame
        MOST_COMMON_COUNT=$(printf '%s\n' "${FRAMES[@]}" | grep -v '^null$' | sort | uniq -c | sort -rn | head -1 | awk '{print $1}')
        MOST_COMMON_FRAME=$(printf '%s\n' "${FRAMES[@]}" | grep -v '^null$' | sort | uniq -c | sort -rn | head -1 | awk '{print $2}')
        NON_NULL_COUNT=$((BEAT_COUNT - NULL_FRAMES))

        if [[ $NON_NULL_COUNT -gt 0 ]]; then
            DOMINANT_PCT=$((MOST_COMMON_COUNT * 100 / NON_NULL_COUNT))
        else
            DOMINANT_PCT=0
        fi

        if [[ $DOMINANT_PCT -gt 50 && $UNIQUE_FRAMES -lt 3 ]]; then
            FAILURES+=("FAIL — frames all '${MOST_COMMON_FRAME}' — no diversity (need 3+ unique across ${BEAT_COUNT} beats)")
        fi

        # Check consecutive same frame (max 2 allowed)
        MAX_CONSEC_FRAME=0
        CONSEC_FRAME=0
        PREV_FRAME=""
        for f in "${FRAMES[@]}"; do
            if [[ "$f" == "null" ]]; then
                # null doesn't break or extend a run
                continue
            fi
            if [[ "$f" == "$PREV_FRAME" ]]; then
                CONSEC_FRAME=$((CONSEC_FRAME + 1))
            else
                CONSEC_FRAME=1
                PREV_FRAME="$f"
            fi
            if [[ $CONSEC_FRAME -gt $MAX_CONSEC_FRAME ]]; then
                MAX_CONSEC_FRAME=$CONSEC_FRAME
            fi
        done

        if [[ $MAX_CONSEC_FRAME -gt 2 ]]; then
            FAILURES+=("FAIL — ${MAX_CONSEC_FRAME} consecutive beats with frame '${PREV_FRAME}' (max 2 allowed)")
        fi

        if [[ $NULL_FRAMES -gt 0 ]]; then
            PASS_NOTES+=("frames ${UNIQUE_FRAMES} unique across ${BEAT_COUNT} beats (${NULL_FRAMES} null)")
        else
            PASS_NOTES+=("frames ${UNIQUE_FRAMES} unique across ${BEAT_COUNT} beats")
        fi
    fi
fi

# ── Result ────────────────────────────────────────────────────────

if [[ ${#FAILURES[@]} -gt 0 ]]; then
    for f in "${FAILURES[@]}"; do
        echo "$f"
    done
    exit 1
else
    SUMMARY=$(IFS=', '; echo "${PASS_NOTES[*]}")
    echo "PASS — ${SUMMARY}"
    exit 0
fi
