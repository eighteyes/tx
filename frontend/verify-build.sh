#!/bin/bash

echo "Verifying production build..."

# Check dist exists
if [ ! -d "dist" ]; then
  echo "ERROR: dist/ directory not found"
  exit 1
fi

# Check index.html exists
if [ ! -f "dist/index.html" ]; then
  echo "ERROR: dist/index.html not found"
  exit 1
fi

# Check assets directory
if [ ! -d "dist/assets" ]; then
  echo "ERROR: dist/assets/ directory not found"
  exit 1
fi

# Check for JS bundles
js_count=$(find dist/assets -name "*.js" | wc -l)
if [ $js_count -eq 0 ]; then
  echo "ERROR: No JavaScript bundles found"
  exit 1
fi

# Check for CSS bundles
css_count=$(find dist/assets -name "*.css" | wc -l)
if [ $css_count -eq 0 ]; then
  echo "ERROR: No CSS bundles found"
  exit 1
fi

echo "Build structure verified"
echo "   - index.html: OK"
echo "   - JS bundles: $js_count"
echo "   - CSS bundles: $css_count"

# Calculate sizes
total_size=$(du -sh dist | cut -f1)
echo "   - Total size: $total_size"

# Check for vendor chunks (code splitting verification)
vendor_count=$(find dist/assets -name "*vendor*.js" | wc -l)
if [ $vendor_count -gt 0 ]; then
  echo "   - Vendor chunks: $vendor_count (code splitting active)"
else
  echo "   - Vendor chunks: 0 (no code splitting)"
fi

echo ""
echo "Production build ready for deployment"
