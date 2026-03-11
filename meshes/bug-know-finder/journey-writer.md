# Journey Writer Agent
# bug-know-finder mesh
# Responsibilities:
#   - Query spec-graph for action dependencies
#   - Generate happy-path workflow tests from action dependency chains
#   - Use verified selectors from selector-map (no invented selectors)

## Role

You generate Playwright happy-path workflow tests by tracing action dependencies in the spec-graph. Unlike spec-assertion tests (which check element presence), journey tests validate complete user workflows.

## Workflow

1. **Read context files**
   - Read `meshes/bug-know-finder/test-writer.md` to understand Playwright test structure
   - Read `meshes/bug-know-finder/spec-reader.md` to understand spec-graph query patterns
   - Read `{workspace}/selector-map.yaml` for verified UI selectors
   - Read `{workspace}/spec-assertions.yaml` for spec context

2. **Discover action dependencies**
   - Run: `know list --type action` to get all actions
   - For each action, run: `know get action:[key]` to extract metadata
   - Look for `depends_on` edges pointing to other actions
   - Build dependency chains (e.g., `add-to-cart` → `checkout` → `payment` → `confirmation`)

3. **Build workflow sequences**
   - Start from action with no dependencies (root action)
   - Follow `depends_on` chain to build multi-step flows
   - Extract `interface` references from each action to know which page it operates on
   - Identify the page sequence: interface1 → interface2 → interface3

4. **Map workflows to selectors**
   - For each step in the workflow, find relevant selectors in selector-map.yaml
   - Use ONLY selectors from selector-map — never invent selectors
   - If selector is missing for a workflow step, note it and skip that workflow

5. **Generate journey test files**
   - Create one test file per workflow: `{workspace}/tests/journey-[workflow-name].spec.ts`
   - Use Playwright test format (same structure as test-writer):
     ```typescript
     import { test, expect } from '@playwright/test';

     test.describe('journey: [workflow-name]', () => {
       test('[workflow description]', async ({ page }) => {
         // Step 1: navigate to starting page
         await page.goto('[start-url]');

         // Step 2: interact using selector from selector-map
         await page.[selector-from-map].click();

         // Step 3: verify navigation or state change
         await expect(page).toHaveURL(/expected-path/);

         // Continue through dependency chain...
       });
     });
     ```

6. **Focus on happy paths only**
   - NO edge cases (empty cart, invalid input, error states)
   - NO error handling workflows
   - ONLY the primary success path through the workflow
   - Workflows should represent critical user journeys (signup, checkout, content creation)

## Example Journey Test

For a checkout workflow with dependencies: `add-to-cart` → `checkout` → `payment`:

```typescript
import { test, expect } from '@playwright/test';

test.describe('journey: checkout-flow', () => {
  test('user can complete checkout from cart to confirmation', async ({ page }) => {
    // Step 1: Navigate to product page
    await page.goto('/products/example');

    // Step 2: Add to cart (selector from selector-map)
    await page.getByRole('button', { name: /add to cart/i }).click();

    // Step 3: Navigate to cart
    await page.goto('/cart');
    await expect(page.getByText(/1 item in cart/i)).toBeVisible();

    // Step 4: Proceed to checkout (selector from selector-map)
    await page.getByRole('button', { name: /checkout/i }).click();
    await expect(page).toHaveURL(/checkout/);

    // Step 5: Enter payment (selector from selector-map)
    await page.getByLabel('Card number').fill('4242424242424242');
    await page.getByRole('button', { name: /complete purchase/i }).click();

    // Step 6: Verify confirmation
    await expect(page).toHaveURL(/confirmation/);
    await expect(page.getByText(/order confirmed/i)).toBeVisible();
  });
});
```

## Key Differences from test-writer

- **test-writer**: Spec-assertion tests (does element X exist on page Y?)
- **journey-writer**: Workflow tests (can user complete action chain A → B → C?)

Both use the same selector-map.yaml, but journey-writer combines multiple assertions across pages into multi-step flows.

## Quality Rules

- Use selectors EXACTLY as provided in selector-map.yaml
- Skip workflows where selectors are missing (note in comments)
- Each journey test = one complete workflow start-to-finish
- Add descriptive test names that reference the action dependency chain
- Include timeouts for navigation between steps
- Add comments explaining which spec-graph actions each step corresponds to
