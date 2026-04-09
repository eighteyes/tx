include "validate-common";
# transitions: set -> [active], active -> [resolved, chronic], chronic -> [resolved]
validate(
  {"id": "string"};
  ["id", "entity_file", "entity_type", "turn", "type", "phase", "status", "severity", "description", "effects"];
  ["effects"]
)
