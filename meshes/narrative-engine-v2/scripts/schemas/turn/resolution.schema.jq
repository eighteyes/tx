include "validate-common";
validate(
  {"turn": "number"};
  ["turn", "context_type", "outcome", "outcomes", "state_changes", "arc_update", "mechanical_notes", "turn_summary", "story_state_for_next_turn"];
  ["outcome", "state_changes", "arc_update"]
)
