include "validate-common";
validate(
  {"turn": "number"};
  ["turn", "campaign", "game", "scene", "characters", "world_state", "active_threads", "prior_events", "constraints"];
  ["world_state"]
)
