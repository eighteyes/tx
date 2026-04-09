def validate($required; $allowed; $freeform):
  . as $input |

  ($input | keys) as $actual_keys |
  ([$actual_keys[] | select(. as $k | $allowed | index($k) | not)]) as $rogue |
  ([$required | to_entries[] | select(.key as $k | $input | has($k) | not)]) as $missing |
  ([$required | to_entries[] |
    select(.key as $k | $input | has($k)) |
    select(
      (.value == "array" and ($input[.key] | type) != "array") or
      (.value == "object" and ($input[.key] | type) != "object") or
      (.value == "string" and ($input[.key] | type) != "string") or
      (.value == "number" and ($input[.key] | type) != "number")
    )
  ]) as $type_errors |
  ([$freeform[] |
    select(. as $k | $input | has($k)) |
    select(. as $k | ($input[$k] | type) != "object")
  ]) as $freeform_errors |

  (
    [$rogue[] | {type: "unknown_key", key: ., allowed: $allowed}] +
    [$missing[] | {type: "missing_key", key: .key, expected_type: .value}] +
    [$type_errors[] | {type: "type_mismatch", key: .key, expected: .value, got: ($input[.key] | type)}] +
    [$freeform_errors[] | {type: "freeform_type_error", key: ., expected: "object", got: ($input[.] | type)}]
  ) as $errors |

  if ($errors | length) > 0 then
    {ok: false, errors: $errors}
  else
    true
  end;
