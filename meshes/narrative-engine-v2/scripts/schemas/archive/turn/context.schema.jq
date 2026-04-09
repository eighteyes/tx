include "validate-common";
validate(
  {"turn": "number"};
  ["turn", "campaign", "game", "scene", "characters", "world_state", "active_threads", "prior_events", "constraints", "actor", "context_type", "entropy_pool", "momentum", "player_action", "previous_turn"];
  ["world_state", "scene", "previous_turn"]
)
