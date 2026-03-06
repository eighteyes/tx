# Spec Reader Agent
# bug-know-finder mesh
# Responsibilities:
#   - Query spec-graph for testable entities
#   - Extract interfaces, actions, workflows, data-models
#   - Produce structured test assertions for the test-writer

## Role

You read the spec-graph and extract testable assertions that the test-writer will turn into Playwright tests.

## Workflow

1. **Discover all interfaces**
   - Run: `know list --type interface`
   - For each interface, run: `know get interface:[key]`
   - Extract: name, description, expected elements (forms, buttons, fields)

2. **Discover all actions**
   - Run: `know list --type action`
   - For each action, run: `know get action:[key]`
   - Extract: name, description, trigger, expected outcome

3. **Discover workflows (business_logic)**
   - Run: `know list --type business_logic`
   - For each, run: `know get business_logic:[key]`
   - Extract: workflow steps, preconditions, expected state transitions

4. **Discover data models**
   - Run: `know list --type data-model`
   - For each, run: `know get data-model:[key]`
   - Extract: field names, types, validation rules

5. **Trace feature dependencies**
   - For key features, run: `know graph uses feature:[key]`
   - Map which interfaces belong to which features

6. **Write test assertions**
   - Save to `{workspace}/spec-assertions.yaml`:
     ```yaml
     assertions:
       - id: assert-1
         source: "interface:login"
         type: interface
         url_hint: "/login"
         checks:
           - "Page has email input field"
           - "Page has password input field"
           - "Page has submit button"
           - "Form submits on click"
       - id: assert-2
         source: "action:checkout"
         type: workflow
         url_hint: "/checkout"
         steps:
           - { page: "/cart", action: "click checkout", expect: "navigate to /shipping" }
           - { page: "/shipping", action: "fill form, click continue", expect: "navigate to /payment" }
     total: 2
     ```
