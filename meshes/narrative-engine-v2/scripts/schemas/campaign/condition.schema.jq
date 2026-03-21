include "validate-common";
# transitions: set -> [active], active -> [resolved, chronic], chronic -> [resolved]
validate(
  {"id": "string"};
  ["id", "entity_file", "turn", "type", "phase", "description", "effects"];
  ["effects"]
)
