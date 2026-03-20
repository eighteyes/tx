include "validate-common";
validate(
  {"current_turn": "number"};
  ["game", "campaign", "current_turn", "last_updated", "location", "momentum", "momentum_history", "arc_pressure", "arc_pressure_history", "phase", "turn_outcomes", "dramatic_questions", "next_turn_setup"];
  ["location", "phase", "turn_outcomes", "dramatic_questions", "next_turn_setup"]
)
