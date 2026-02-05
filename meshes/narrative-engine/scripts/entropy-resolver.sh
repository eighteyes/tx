#!/usr/bin/env bash
# entropy-resolver.sh
# Mechanical entropy selection - no interpretation, no reconsideration
#
# Responsibilities:
# - Read entropy pool and outcome tables
# - Select outcomes based on range matching
# - Follow branch tables when world event triggers one
# - Output selected outcomes (full text)
#
# Modes:
# - primary (default): Roll player outcome + world event, write to entropy-selection.yaml
# - subtable <table_id> <parent>: Roll on specific subtable, APPEND to entropy-selection.yaml
# - followon <table_id>: Roll on follow-on subtable, APPEND to entropy-selection.yaml

set -euo pipefail

WORKSPACE="${1:?Usage: entropy-resolver.sh <workspace_path> [mode] [args...]}"
MODE="${2:-primary}"
SUBTABLE_ID="${3:-}"
PARENT_RESULT="${4:-}"

ENTROPY_TABLES="$WORKSPACE/entropy-tables.yaml"
OUTPUT="$WORKSPACE/entropy-selection.yaml"

if [[ ! -f "$ENTROPY_TABLES" ]]; then
    echo "ERROR: entropy-tables.yaml not found" >&2
    exit 1
fi

# context.yaml no longer needed - entropy generated fresh

# Generate fresh entropy (20 values, 1-100)
ENTROPY_POOL=()
for i in {1..20}; do
    ENTROPY_POOL+=($((RANDOM % 100 + 1)))
done

# Pool allocation: [0]=player, [1]=world, [2-19]=branches
PLAYER_ENTROPY=${ENTROPY_POOL[0]}
WORLD_ENTROPY=${ENTROPY_POOL[1]}

# Branch entropy values ([2] onward)
BRANCH_INDEX=2

get_next_branch_entropy() {
    if [[ $BRANCH_INDEX -lt ${#ENTROPY_POOL[@]} ]]; then
        echo "${ENTROPY_POOL[$BRANCH_INDEX]}"
        BRANCH_INDEX=$((BRANCH_INDEX + 1))
    else
        # Fallback if we exhaust pool
        echo $((RANDOM % 100 + 1))
    fi
}

# Extract outcome text only (no event_id)
extract_outcome() {
    local table_name="$1"
    local entropy="$2"
    local in_table=0
    local in_outcome=0
    local outcome_text=""
    local matched=0

    while IFS= read -r line; do
        if [[ "$line" =~ ^${table_name}: ]]; then
            in_table=1
            continue
        fi

        if [[ $in_table -eq 1 && "$line" =~ ^[a-z_]+: && ! "$line" =~ ^[[:space:]] ]]; then
            break
        fi

        if [[ $in_table -eq 1 && "$line" =~ "- range:" ]]; then
            if [[ $matched -eq 1 ]]; then
                echo "$outcome_text"
                return 0
            fi
            current_range=$(echo "$line" | sed 's/.*range:[[:space:]]*//' | tr -d '"')
            local low=$(echo "$current_range" | cut -d'-' -f1)
            local high=$(echo "$current_range" | cut -d'-' -f2)
            if [[ $entropy -ge $low && $entropy -le $high ]]; then
                matched=1
            else
                matched=0
            fi
            outcome_text=""
            in_outcome=0
            continue
        fi

        if [[ $in_table -eq 1 && $matched -eq 1 && "$line" =~ "outcome:" ]]; then
            in_outcome=1
            if [[ "$line" =~ outcome:[[:space:]]*\| ]]; then
                continue
            fi
            continue
        fi

        if [[ $in_outcome -eq 1 && $matched -eq 1 ]]; then
            if [[ "$line" =~ ^[[:space:]]+[a-z_]+: ]]; then
                in_outcome=0
            else
                outcome_text+="$(echo "$line" | sed 's/^[[:space:]]*//')"$'\n'
            fi
        fi
    done < "$ENTROPY_TABLES"

    if [[ $matched -eq 1 ]]; then
        echo "$outcome_text"
        return 0
    fi

    echo "NO_MATCH"
    return 1
}

# Extract mechanical_note for a given table and entropy
extract_mechanical_note() {
    local table_name="$1"
    local entropy="$2"
    local in_table=0
    local current_note=""
    local matched=0

    while IFS= read -r line; do
        if [[ "$line" =~ ^${table_name}: ]]; then
            in_table=1
            continue
        fi

        if [[ $in_table -eq 1 && "$line" =~ ^[a-z_]+: && ! "$line" =~ ^[[:space:]] ]]; then
            break
        fi

        if [[ $in_table -eq 1 && "$line" =~ "- range:" ]]; then
            if [[ $matched -eq 1 ]]; then
                echo "$current_note"
                return 0
            fi
            current_range=$(echo "$line" | sed 's/.*range:[[:space:]]*//' | tr -d '"')
            local low=$(echo "$current_range" | cut -d'-' -f1)
            local high=$(echo "$current_range" | cut -d'-' -f2)
            if [[ $entropy -ge $low && $entropy -le $high ]]; then
                matched=1
            else
                matched=0
            fi
            current_note=""
            continue
        fi

        if [[ $in_table -eq 1 && $matched -eq 1 && "$line" =~ "mechanical_note:" ]]; then
            current_note=$(echo "$line" | sed 's/.*mechanical_note:[[:space:]]*//' | tr -d '"')
        fi
    done < "$ENTROPY_TABLES"

    if [[ $matched -eq 1 ]]; then
        echo "$current_note"
        return 0
    fi

    echo ""
    return 0
}

# Extract event_id from world_event_table for a given entropy value
extract_event_id() {
    local entropy="$1"
    local in_table=0
    local current_event_id=""
    local matched=0

    while IFS= read -r line; do
        if [[ "$line" =~ ^world_event_table: ]]; then
            in_table=1
            continue
        fi

        if [[ $in_table -eq 1 && "$line" =~ ^[a-z_]+: && ! "$line" =~ ^[[:space:]] ]]; then
            break
        fi

        if [[ $in_table -eq 1 && "$line" =~ "- range:" ]]; then
            if [[ $matched -eq 1 ]]; then
                echo "$current_event_id"
                return 0
            fi
            current_range=$(echo "$line" | sed 's/.*range:[[:space:]]*//' | tr -d '"')
            local low=$(echo "$current_range" | cut -d'-' -f1)
            local high=$(echo "$current_range" | cut -d'-' -f2)
            if [[ $entropy -ge $low && $entropy -le $high ]]; then
                matched=1
            else
                matched=0
            fi
            current_event_id=""
            continue
        fi

        if [[ $in_table -eq 1 && $matched -eq 1 && "$line" =~ "event_id:" ]]; then
            current_event_id=$(echo "$line" | sed 's/.*event_id:[[:space:]]*//' | tr -d '"')
        fi
    done < "$ENTROPY_TABLES"

    if [[ $matched -eq 1 ]]; then
        echo "$current_event_id"
        return 0
    fi

    echo ""
    return 1
}

# Check if a branch table exists for given event_id
branch_table_exists() {
    local event_id="$1"
    grep -q "^  ${event_id}:" "$ENTROPY_TABLES" 2>/dev/null
}

# Resolve branch table outcome
resolve_branch_outcome() {
    local event_id="$1"
    local entropy="$2"
    local in_branch=0
    local in_outcomes=0
    local in_outcome=0
    local outcome_text=""
    local matched=0

    while IFS= read -r line; do
        if [[ "$line" =~ ^[[:space:]]{2}${event_id}: ]]; then
            in_branch=1
            continue
        fi

        if [[ $in_branch -eq 1 && "$line" =~ ^[[:space:]]{2}[a-z_]+: && ! "$line" =~ ^[[:space:]]{4} ]]; then
            break
        fi

        if [[ $in_branch -eq 1 && "$line" =~ "outcomes:" ]]; then
            in_outcomes=1
            continue
        fi

        if [[ $in_branch -eq 1 && $in_outcomes -eq 1 && "$line" =~ "- range:" ]]; then
            if [[ $matched -eq 1 ]]; then
                echo "$outcome_text"
                return 0
            fi
            current_range=$(echo "$line" | sed 's/.*range:[[:space:]]*//' | tr -d '"')
            local low=$(echo "$current_range" | cut -d'-' -f1)
            local high=$(echo "$current_range" | cut -d'-' -f2)
            if [[ $entropy -ge $low && $entropy -le $high ]]; then
                matched=1
            else
                matched=0
            fi
            outcome_text=""
            in_outcome=0
            continue
        fi

        if [[ $in_branch -eq 1 && $matched -eq 1 && "$line" =~ "outcome:" ]]; then
            in_outcome=1
            if [[ "$line" =~ outcome:[[:space:]]*\| ]]; then
                continue
            fi
            continue
        fi

        if [[ $in_outcome -eq 1 && $matched -eq 1 ]]; then
            if [[ "$line" =~ ^[[:space:]]+[a-z_]+: ]]; then
                in_outcome=0
            else
                outcome_text+="$(echo "$line" | sed 's/^[[:space:]]*//')"$'\n'
            fi
        fi
    done < "$ENTROPY_TABLES"

    if [[ $matched -eq 1 ]]; then
        echo "$outcome_text"
        return 0
    fi

    echo "NO_BRANCH_MATCH"
    return 1
}

# Resolve branch_result id
resolve_branch_id() {
    local event_id="$1"
    local entropy="$2"
    local in_branch=0
    local in_outcomes=0
    local current_result=""
    local matched=0

    while IFS= read -r line; do
        if [[ "$line" =~ ^[[:space:]]{2}${event_id}: ]]; then
            in_branch=1
            continue
        fi

        if [[ $in_branch -eq 1 && "$line" =~ ^[[:space:]]{2}[a-z_]+: && ! "$line" =~ ^[[:space:]]{4} ]]; then
            break
        fi

        if [[ $in_branch -eq 1 && "$line" =~ "outcomes:" ]]; then
            in_outcomes=1
            continue
        fi

        if [[ $in_branch -eq 1 && $in_outcomes -eq 1 && "$line" =~ "- range:" ]]; then
            if [[ $matched -eq 1 ]]; then
                echo "$current_result"
                return 0
            fi
            current_range=$(echo "$line" | sed 's/.*range:[[:space:]]*//' | tr -d '"')
            local low=$(echo "$current_range" | cut -d'-' -f1)
            local high=$(echo "$current_range" | cut -d'-' -f2)
            if [[ $entropy -ge $low && $entropy -le $high ]]; then
                matched=1
            else
                matched=0
            fi
            current_result=""
            continue
        fi

        if [[ $in_branch -eq 1 && $matched -eq 1 && "$line" =~ "branch_result:" ]]; then
            current_result=$(echo "$line" | sed 's/.*branch_result:[[:space:]]*//' | tr -d '"')
        fi
    done < "$ENTROPY_TABLES"

    if [[ $matched -eq 1 ]]; then
        echo "$current_result"
        return 0
    fi

    echo ""
    return 1
}

# Extract branch mechanical_note
extract_branch_mechanical_note() {
    local event_id="$1"
    local entropy="$2"
    local in_branch=0
    local in_outcomes=0
    local current_note=""
    local matched=0

    while IFS= read -r line; do
        if [[ "$line" =~ ^[[:space:]]{2}${event_id}: ]]; then
            in_branch=1
            continue
        fi

        if [[ $in_branch -eq 1 && "$line" =~ ^[[:space:]]{2}[a-z_]+: && ! "$line" =~ ^[[:space:]]{4} ]]; then
            break
        fi

        if [[ $in_branch -eq 1 && "$line" =~ "outcomes:" ]]; then
            in_outcomes=1
            continue
        fi

        if [[ $in_branch -eq 1 && $in_outcomes -eq 1 && "$line" =~ "- range:" ]]; then
            if [[ $matched -eq 1 ]]; then
                echo "$current_note"
                return 0
            fi
            current_range=$(echo "$line" | sed 's/.*range:[[:space:]]*//' | tr -d '"')
            local low=$(echo "$current_range" | cut -d'-' -f1)
            local high=$(echo "$current_range" | cut -d'-' -f2)
            if [[ $entropy -ge $low && $entropy -le $high ]]; then
                matched=1
            else
                matched=0
            fi
            current_note=""
            continue
        fi

        if [[ $in_branch -eq 1 && $matched -eq 1 && "$line" =~ "mechanical_note:" ]]; then
            current_note=$(echo "$line" | sed 's/.*mechanical_note:[[:space:]]*//' | tr -d '"')
        fi
    done < "$ENTROPY_TABLES"

    if [[ $matched -eq 1 ]]; then
        echo "$current_note"
        return 0
    fi

    echo ""
    return 0
}

# === MAIN RESOLUTION ===

case "$MODE" in
    primary)
        # 1. Resolve player outcome
        PLAYER_OUTCOME=$(extract_outcome "player_outcome_table" "$PLAYER_ENTROPY")
        PLAYER_MECHANICAL=$(extract_mechanical_note "player_outcome_table" "$PLAYER_ENTROPY")

        # 2. Resolve world event
        WORLD_OUTCOME=$(extract_outcome "world_event_table" "$WORLD_ENTROPY")
        WORLD_EVENT_ID=$(extract_event_id "$WORLD_ENTROPY") || WORLD_EVENT_ID=""
        WORLD_MECHANICAL=$(extract_mechanical_note "world_event_table" "$WORLD_ENTROPY")

        # 3. Check for branch table and resolve if exists
        BRANCH_CHAIN=""
        BRANCH_ENTROPY=""
        BRANCH_ID=""
        BRANCH_MECHANICAL=""
        if [[ -n "$WORLD_EVENT_ID" && "$WORLD_EVENT_ID" != "none" ]]; then
            if branch_table_exists "$WORLD_EVENT_ID"; then
                BRANCH_ENTROPY=$(get_next_branch_entropy)
                BRANCH_OUTCOME=$(resolve_branch_outcome "$WORLD_EVENT_ID" "$BRANCH_ENTROPY") || BRANCH_OUTCOME=""
                BRANCH_ID=$(resolve_branch_id "$WORLD_EVENT_ID" "$BRANCH_ENTROPY") || BRANCH_ID=""
                BRANCH_MECHANICAL=$(extract_branch_mechanical_note "$WORLD_EVENT_ID" "$BRANCH_ENTROPY")

                if [[ -n "$BRANCH_OUTCOME" && "$BRANCH_OUTCOME" != "NO_BRANCH_MATCH" ]]; then
                    BRANCH_CHAIN="branch_entropy: $BRANCH_ENTROPY
branch_id: $WORLD_EVENT_ID.$BRANCH_ID
branch_outcome: |
$(echo "$BRANCH_OUTCOME" | sed 's/^/  /')
branch_mechanical: \"$BRANCH_MECHANICAL\""
                fi
            fi
        fi

        # === WRITE PRIMARY OUTPUT ===
        cat > "$OUTPUT" << 'HEADER'
# Entropy Selection (mechanical)
HEADER

        POOL_STR=$(IFS=,; echo "${ENTROPY_POOL[*]}")

        cat >> "$OUTPUT" << EOF
entropy_pool: [$POOL_STR]
player_entropy: $PLAYER_ENTROPY
player_outcome: |
$(echo "$PLAYER_OUTCOME" | sed 's/^/  /')
player_mechanical: "$PLAYER_MECHANICAL"

world_entropy: $WORLD_ENTROPY
world_event_id: $WORLD_EVENT_ID
world_outcome: |
$(echo "$WORLD_OUTCOME" | sed 's/^/  /')
world_mechanical: "$WORLD_MECHANICAL"
EOF

        if [[ -n "$BRANCH_CHAIN" ]]; then
            echo "" >> "$OUTPUT"
            echo "$BRANCH_CHAIN" >> "$OUTPUT"
        fi

        echo "Player: $PLAYER_ENTROPY → $(echo "$PLAYER_OUTCOME" | head -1 | cut -c1-60)..."
        echo "World: $WORLD_ENTROPY → $WORLD_EVENT_ID"
        if [[ -n "$BRANCH_CHAIN" ]]; then
            echo "Branch: $BRANCH_ENTROPY → $WORLD_EVENT_ID.$BRANCH_ID"
        fi
        ;;

    subtable|followon)
        # Roll on specific subtable, APPEND to existing selection
        if [[ -z "$SUBTABLE_ID" ]]; then
            echo "ERROR: subtable mode requires table_id" >&2
            exit 1
        fi

        # Generate single entropy value for this roll
        ROLL_ENTROPY=$((RANDOM % 100 + 1))

        # Resolve the subtable
        if branch_table_exists "$SUBTABLE_ID"; then
            RESULT_ID=$(resolve_branch_id "$SUBTABLE_ID" "$ROLL_ENTROPY") || RESULT_ID=""
            RESULT_MECHANICAL=$(extract_branch_mechanical_note "$SUBTABLE_ID" "$ROLL_ENTROPY")
        else
            echo "ERROR: subtable $SUBTABLE_ID not found" >&2
            exit 1
        fi

        # APPEND to existing entropy-selection.yaml
        cat >> "$OUTPUT" << EOF

# --- Subtable roll: $SUBTABLE_ID ---
roll_type: $MODE
table_id: $SUBTABLE_ID
parent: $PARENT_RESULT
entropy: $ROLL_ENTROPY
result_id: $RESULT_ID
mechanical: "$RESULT_MECHANICAL"
EOF

        echo "Subtable: $ROLL_ENTROPY → $SUBTABLE_ID.$RESULT_ID"
        ;;

    *)
        echo "ERROR: Unknown mode '$MODE'. Use: primary, subtable, followon" >&2
        exit 1
        ;;
esac

echo "Written to: $OUTPUT"
