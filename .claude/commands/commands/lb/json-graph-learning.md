# JSON Graph Learning Log

## Two-Axis Architecture Discovery (2025-09-12)

### Problem Identified
Circular dependencies in knowledge graph caused by fundamental architectural flaw: mixing WHAT (capabilities) with HOW (implementation) in single hierarchy.

**Specific Issue**: Screens depending on users creates inherent cycles:
- `screen:teleoperation-interface → user:operator`
- `user:operator` accesses functionality through screens
- Result: User → Screen → User cycles

### Key Insight
User said: *"maybe our dependency map is wrong, maybe user needs to map to requirements, not interface? what do you think?"*

This revealed the core issue: **Users should depend on FUNCTIONALITY, not implementation details.**

### Solution: Two-Axis Architecture

#### WHAT Track (Capability-Driven)
```
User → Functionality → Implementation
  A        B              C
```

#### HOW Track (Implementation-Driven)  
```
Project → Platform → Requirements → Interface → Feature → Action → Component → UI → Data Models
   1         2           3            4          5        6.5        7          8        9
```

#### Integration Layers (Crossover Points)
1. **Business Integration**: Requirements ↔ User needs
2. **Logic Integration**: Features ↔ Functionality implementation  
3. **Execution Integration**: Actions/Components ↔ Implementation delivery

### Technical Learning

#### Cycle Detection Differences
- **jq traversal**: Found 0 structural cycles (good graph structure)
- **Recursive traversal**: Found 15 logical cycles (business relationships)
- **Conclusion**: Logical cycles != architectural violations

#### Hierarchy Placement Evolution
- Initially: `user_action` at level 8 (too deep)
- Final: `user_action` at level 6.5 (integration layer between features and components)
- **Reasoning**: Actions are behavioral bridges, not pure implementation

### Implementation Strategy

#### Dependency Model Change
```
OLD: screen → user (creates cycles)
NEW: user → functionality ← feature (breaks cycles)
```

#### Entity Model Enhancement
- Add `functionality` entities as abstract capability contracts
- Features implement functionalities (concrete → abstract)
- Users depend on functionalities they need (capability-driven)

### Expected Benefits
1. **Zero Circular Dependencies**: Eliminates user-screen cycles
2. **Better Separation of Concerns**: WHAT vs HOW clearly separated
3. **Improved Maintainability**: Implementation changes don't affect user model
4. **Enhanced Traceability**: Clear path from user needs to implementation

### Files Modified
- `/Users/god/work/lb-www/know/lib/query-graph.sh`: Updated hierarchy levels
- `/Users/god/work/lb-www/know/lib/mod-graph.sh`: Matching hierarchy updates
- Implementation plan saved to: `/Users/god/work/lb-www/.ai/ctx/hierarchy-fix.md`

### Key Quote
*"oh, so users should depend on FUNCTIONALITY so we have another nice split between what and how"*

This breakthrough moment showed how architectural thinking can solve what initially appeared to be a data structure problem.