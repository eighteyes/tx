#!/bin/bash
# Frontmatter validation and auto-fix script for opus-soul knowledge graph
# Automatically fixes tags, then validates other frontmatter fields

VAULT_DIR=".ai/know/opus-soul"
CONCEPTS_DIR="$VAULT_DIR/concepts"
THREADS_DIR="$VAULT_DIR/threads"
VALIDATION_REPORT="$VAULT_DIR/frontmatter-validation.md"

echo "=== Frontmatter Auto-Fix & Validation ==="
echo ""

# ========================================
# STEP 1: AUTO-FIX TAGS (quote wrapping)
# ========================================
echo "Step 1: Auto-fixing tags..."

fix_count=0
find "$VAULT_DIR" -name "*.md" -type f | while read -r file; do
  # Use perl for in-place tag fixing
  if grep -q "^tags:" "$file" 2>/dev/null; then
    perl -i -pe '
      if (/^tags:\s*\[/) {
        s/tags:\s*\[(.*?)\]/process_tags($1)/e;
      }

      sub process_tags {
        my $content = shift;
        my @tags = map {
          s/^\s+|\s+$//g;  # trim
          /".*?"/ ? $_ : "\"$_\"";  # quote if not quoted
        } split /,/, $content;
        return "tags: [" . join(", ", @tags) . "]";
      }
    ' "$file" 2>/dev/null

    fix_count=$((fix_count + 1))
  fi
done

echo "✓ Tags auto-fixed in $fix_count files"
echo ""

# ========================================
# STEP 2: VALIDATE FRONTMATTER
# ========================================
echo "Step 2: Validating frontmatter..."

# Initialize report
{
  echo "# Frontmatter Validation Report"
  echo ""
  echo "Auto-generated validation of concept and thread frontmatter."
  echo ""
  echo "**Note**: Tags are automatically fixed (quoted). Other issues listed below."
  echo ""
  echo "---"
  echo ""
} > "$VALIDATION_REPORT"

error_count=0
warning_count=0

# Function to validate a single file
validate_file() {
  local file="$1"
  local filename
  filename=$(basename "$file" .md)
  local errors=()
  local warnings=()

  # Extract frontmatter (between first two --- lines)
  frontmatter=$(awk '/^---$/{flag=!flag; next} flag' "$file")

  if [ -z "$frontmatter" ]; then
    errors+=("Missing frontmatter block")
  else
    # Check required fields
    if ! echo "$frontmatter" | grep -q "^description:"; then
      errors+=("Missing 'description' field")
    fi

    if ! echo "$frontmatter" | grep -q "^tags:"; then
      errors+=("Missing 'tags' field")
    fi

    if ! echo "$frontmatter" | grep -q "^maturity:"; then
      errors+=("Missing 'maturity' field")
    fi

    # Check maturity is valid
    maturity_line=$(echo "$frontmatter" | grep "^maturity:" | sed 's/maturity:[[:space:]]*//')
    if [ -n "$maturity_line" ]; then
      if ! echo "$maturity_line" | grep -qE "^(seed|sprout|sapling|tree|grove)$"; then
        errors+=("Invalid maturity value: '$maturity_line' (must be: seed, sprout, sapling, tree, grove)")
      fi
    fi

    # Check resonance is valid (if present)
    resonance_line=$(echo "$frontmatter" | grep "^resonance:" | sed 's/resonance:[[:space:]]*//' | tr -d '"')
    if [ -n "$resonance_line" ]; then
      if ! echo "$resonance_line" | grep -q "[○◐●]"; then
        warnings+=("Invalid resonance value: '$resonance_line' (must use: ○, ◐, ●, ●●)")
      fi
    fi

    # Check related/orthogonal/parent/children use [[markdown links]]
    for field in related orthogonal parent children; do
      field_line=$(echo "$frontmatter" | grep "^$field:")
      if [ -n "$field_line" ]; then
        # Check if field has values but missing [[brackets]]
        if echo "$field_line" | grep -qE ": \[.*[a-zA-Z]" && ! echo "$field_line" | grep -q "\[\["; then
          warnings+=("Field '$field' should use [[markdown links]]")
        fi
      fi
    done

    # Check parent is single value or null (not array)
    parent_line=$(echo "$frontmatter" | grep "^parent:")
    if [ -n "$parent_line" ]; then
      if echo "$parent_line" | grep -qE "parent: \["; then
        errors+=("Field 'parent' should be single value or null, not array")
      fi
    fi
  fi

  # Write to report if issues found
  if [ ${#errors[@]} -gt 0 ] || [ ${#warnings[@]} -gt 0 ]; then
    {
      echo "## \`$filename\`"
      echo ""
      echo "**File**: \`$file\`"
      echo ""
    } >> "$VALIDATION_REPORT"

    if [ ${#errors[@]} -gt 0 ]; then
      {
        echo "### Errors"
        for error in "${errors[@]}"; do
          echo "- $error"
          ((error_count++))
        done
        echo ""
      } >> "$VALIDATION_REPORT"
    fi

    if [ ${#warnings[@]} -gt 0 ]; then
      {
        echo "### Warnings"
        for warning in "${warnings[@]}"; do
          echo "- $warning"
          ((warning_count++))
        done
        echo ""
      } >> "$VALIDATION_REPORT"
    fi

    {
      echo "---"
      echo ""
    } >> "$VALIDATION_REPORT"
  fi
}

# Validate all concept files
if [ -d "$CONCEPTS_DIR" ]; then
  for file in "$CONCEPTS_DIR"/*.md; do
    [ -f "$file" ] && validate_file "$file"
  done
fi

# Validate all thread files
if [ -d "$THREADS_DIR" ]; then
  for file in "$THREADS_DIR"/*.md; do
    [ -f "$file" ] && validate_file "$file"
  done
fi

# Write summary
{
  echo ""
  echo "---"
  echo ""
  echo "## Summary"
  echo ""
  echo "- **Errors**: $error_count"
  echo "- **Warnings**: $warning_count"
  echo ""
  if [ $error_count -eq 0 ] && [ $warning_count -eq 0 ]; then
    echo "✅ All frontmatter validates correctly!"
  else
    echo "⚠️  Frontmatter needs attention. Review errors/warnings above."
  fi
  echo ""
  echo "---"
  echo "*Generated: $(date -u +"%Y-%m-%d %H:%M:%S UTC")*"
} >> "$VALIDATION_REPORT"

echo "✓ Validation complete: $error_count errors, $warning_count warnings"
echo "  Report: $VALIDATION_REPORT"
echo ""

if [ $error_count -eq 0 ] && [ $warning_count -eq 0 ]; then
  echo "✅ All frontmatter valid!"
else
  echo "⚠️  Issues found - check validation report"
fi
