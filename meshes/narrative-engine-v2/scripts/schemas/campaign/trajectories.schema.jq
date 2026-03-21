include "validate-common";
# transitions: planted -> [approaching, active], active -> [fired, expired], approaching -> [active, expired]
validate(
  {"id": "string"};
  ["id", "desc", "description", "status", "deadline", "source", "turn_planted", "turn_developed", "turn", "outcome", "trigger", "note", "negotiable", "intellectual_content"];
  ["intellectual_content"]
)
