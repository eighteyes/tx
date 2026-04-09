include "validate-common";
# Supports both individual violation entries (append mode) and full violation reports
validate(
  {};
  ["type", "classification", "scope", "count", "budget", "lines", "recommendation", "fix", "turn", "violations", "violation_count", "total_violations", "creative_count", "mechanical_count", "summary", "summary_table", "author", "workspace", "prose_draft", "clean_linters", "next_steps", "linter", "scene_analysis"];
  ["summary"]
)
