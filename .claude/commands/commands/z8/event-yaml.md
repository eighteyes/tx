---
allowed-tools:
- Read(*)
- Write(*)
description: Convert plain language descriptions into Event-Based YAML with rules or workflow sequences
permalink: commands/z8/event-yaml
---

## Your task

Convert the following plain language description into properly formatted Event-Based YAML. Choose the most appropriate format based on the input:

1. **Rules format**: For independent event-driven behaviors
2. **Workflow/Sequence format**: For linear flows with actors and steps

Input description:
$ARGUMENTS

## Output Formats

### Option 1: Rules Format
For independent event-driven behaviors. Assumes `condition: true` and `fallback: null` as defaults (omit when applicable).

```yaml
rules:
  - name: descriptive-name
    trigger: event_or_action
    response: action_taken

  - name: conditional-rule
    trigger: event
    condition: specific_criteria  # Only include if not always true
    response: action_when_met
    fallback: alternate_action     # Only include if specified
```

**Arrow notation for flows:**
```yaml
rules:
  - name: complex-flow
    trigger: start_event
    response: step1 -> step2 -> step3
```

### Option 2: Workflow/Sequence Format
For linear flows showing actor interactions:

```yaml
workflow:
  flow_name:
    actor1: action1
    system: automatic_behavior
    actor2: action2 -> action3
    actor1: response_action

  alternate_flow:
    actor1: different_action
```

Or with detailed sequences:
```yaml
sequence:
  startup:
    - core: initialize -> wait_for_input

  main_flow:
    - user: provides_input
    - core: process -> validate -> execute
    - system: queues_result
    - core: return_output
```

## Guidelines

1. **Choose format based on input:**
   - Rules: Independent triggers and responses
   - Workflow: Sequential actor interactions

2. **For Rules format:**
   - Omit `condition: true` (it's the default)
   - Omit `fallback: null` (it's the default)
   - Use `->` arrows for multi-step responses
   - Use kebab-case for names

3. **For Workflow format:**
   - Show actor/system distinctions
   - Use `->` for sequential actions by same actor
   - Group related flows together

4. **Keep it concise:**
   - Use arrows instead of verbose descriptions
   - Only include non-default values
   - Focus on action flow, not implementation

## Examples

### Rules Example
Input: "When a user logs in, if it's their first time, show tutorial, otherwise dashboard"

```yaml
rules:
  - name: first-login
    trigger: user_login
    condition: first_time_user
    response: show_tutorial
    fallback: show_dashboard
```

### Workflow Example
Input: "User submits form, system validates it, if valid sends to API and shows success, if invalid shows errors"

```yaml
workflow:
  form_submission:
    user: submit_form
    system: validate_form
    system: [if_valid] send_to_api -> return_success
    ui: [if_valid] show_success_message
    system: [if_invalid] return_errors
    ui: [if_invalid] show_error_messages
```

### Compact Sequence Example
```yaml
sequence:
  task_processing:
    - user: provides task
    - core: analyze -> plan -> execute
    - system: monitor_progress
    - core: complete -> notify_user
```

Now parse the provided input and generate the most appropriate Event-Based YAML format.