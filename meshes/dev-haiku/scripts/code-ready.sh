#!/bin/bash
# scripts/code-ready.sh
# Gate: Validate that worker created implementation files

# Check that at least one solution file was created
if ! ls "$TX_WORKSPACE"/solution.* "$TX_WORKSPACE"/implementation.* "$TX_WORKSPACE"/code.* 2>/dev/null | grep -q .; then
  echo "ERROR: Worker did not create any implementation files (solution.*, implementation.*, or code.*)" >&2
  exit 1
fi

# Count files created
FILE_COUNT=$(ls "$TX_WORKSPACE"/solution.* "$TX_WORKSPACE"/implementation.* "$TX_WORKSPACE"/code.* 2>/dev/null | wc -l)

echo "IMPLEMENTATION_VALIDATED=true"
echo "FILES_CREATED=$FILE_COUNT"
exit 0
