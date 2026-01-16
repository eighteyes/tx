#!/bin/bash

# Test script for mesh API endpoints
# Run with: ./test-mesh-api.sh

BASE_URL="http://localhost:3000"

echo "=== Testing Mesh API ==="
echo ""

# Test 1: List meshes
echo "Test 1: GET /v1/meshes - List all meshes"
curl -s "$BASE_URL/v1/meshes" | head -c 500
echo ""
echo ""

# Test 2: Get specific mesh
echo "Test 2: GET /v1/meshes/dev - Get mesh config"
curl -s "$BASE_URL/v1/meshes/dev" | head -c 500
echo ""
echo ""

# Test 3: Get non-existent mesh (should 404)
echo "Test 3: GET /v1/meshes/nonexistent - Should return 404"
curl -s -w "\nStatus: %{http_code}\n" "$BASE_URL/v1/meshes/nonexistent"
echo ""

# Test 4: Validate mesh config
echo "Test 4: POST /v1/meshes/dev/validate - Validate config"
curl -s -X POST "$BASE_URL/v1/meshes/dev/validate" \
  -H "Content-Type: application/json" \
  -d '{"config": {"mesh": "dev", "agents": [{"name": "worker", "model": "opus", "prompt": "prompt.md"}], "entry_point": "worker"}}'
echo ""
echo ""

# Test 5: Validate invalid mesh config
echo "Test 5: POST /v1/meshes/test/validate - Validate invalid config (missing agents)"
curl -s -X POST "$BASE_URL/v1/meshes/test/validate" \
  -H "Content-Type: application/json" \
  -d '{"config": {"mesh": "test"}}'
echo ""
echo ""

# Test 6: Update mesh config (dry run - restore original after)
echo "Test 6: PUT /v1/meshes/dev - Update mesh config (with validation)"
curl -s -X PUT "$BASE_URL/v1/meshes/dev" \
  -H "Content-Type: application/json" \
  -d '{"config": {"mesh": "dev", "description": "Updated dev mesh", "agents": [{"name": "worker", "model": "opus", "prompt": "prompt.md"}], "entry_point": "worker"}, "format": "yaml"}'
echo ""
echo ""

echo "=== Tests Complete ==="
