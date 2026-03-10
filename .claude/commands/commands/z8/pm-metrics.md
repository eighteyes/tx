---
allowed-tools:
- Read(*)
- Bash(date:*)
- mcp__mcp-google-sheets__get_sheet_data
- mcp__mcp-google-sheets__update_cells
- mcp__mcp-google-sheets__batch_update_cells
- mcp__mcp-google-sheets__list_sheets
description: Evening health metrics Q&A with sheet capture
permalink: commands/z8/pm-metrics
---

Capture daily health metrics through conversational Q&A, then write to Health Metrics spreadsheet.

## Spreadsheet
ID: `1P6qcSP0_c7vMXH61636ZcpEpttOFpV9ZPYsGppPD-tE`
Sheet: `Data`
Today's date: !`date +%Y-%m-%d`
User weight: 250 lbs (for BMR calc)

## Scales Reference

| Type | Scale | Used For |
|------|-------|----------|
| Vipassana | 0-5 | Awareness, Equanimity |
| Bipolar State | -3 to +3 | Focus, Energy, Good Sleep, Digestion |
| Symptom | 0, 0.1, 1, 2, 3 | Fog, Cannot Think, Ear Ringing, Feel Shitty, Headache, Gout, Heart Tension, Muscle Pain, Itchy, Vasculitius, Stress |
| Mood | 0-3 | Happy, Sad, Angry, Anxiety, Ahedonia, Libido, Hungry |
| Mindset | 0-3 | Self-Denial, Gratitude, Intentional Computer Use |
| Morning Wood | 0-5 | 3=normal, 4=straining, 5=holy shit |
| Count | integer | Poop, exercises, water |
| Calories | integer | In (CF), Burned (CG) |
| Time | HHMM | Computer off (DC) |
| Muscle Group | 1=worked, 2=sore | Arms, Legs, Chest, Back (CX-DA) |

## Column Mapping (Updated 2026-01-13)

### Exercise (Column I + CL-CW)
- I: 🏋️‍♂️ Exercise (hours general activity, e.g., walking)
- CL: 👊 Pushups (count)
- CM: 🦵 Lunges (count)
- CN: 🤷‍♂️ Pullups (count)
- CO: 🫓 Knees Raise (count)
- CP: 🏊🏿‍♀️ Swim Laps (count)
- CQ: 🚲 Bike Mins (minutes)
- CR: 🛎️ Kettlebells (count/sets)
- CS: 🗡️ Knives (count)
- CT: ☀️ Sun Salutations (count)
- CU: 🪵 Plank Max Seconds (seconds)
- CV: 💃 Dancing (minutes)
- CW: 🏋️ TRX (bodyweight bands count)

### Muscle Groups Worked (CX-DA)
Scale: 1 = worked, 2 = sore
- CX: 💪 Arms
- CY: 🦵 Legs
- CZ: 🫁 Chest
- DA: 🔙 Back

### Vipassana (AG-AH)
- AG: 👁️ Awareness (0-5) — 0=none, 1=under nose, 5=full dissolution
- AH: 🪷 Equanimity (0-5) — 0=raging, 1=maintain space, 5=unbothered

### Quality (AI-AK)
- AI: Focus (-3 to +3) — composite score
- AJ: Energy (-3 to +3) — composite score
- AK: Good Sleep (-3 to +3) — composite score

### Health/Symptoms (AL-AZ)
- AL: Fog (0-3)
- AM: Cannot Think (0-3)
- AN: Ear Ringing (0-3)
- AO: Feel Shitty (0-3)
- AP: Headache (0-3)
- AQ: Gout (0-3)
- AR: Heart Tension (0-3)
- AS: Muscle Pain (0-3)
- AT: Itchy (0-3)
- AU: Vasculitius (0-3)
- AV: Morning Wood (0-5, 3=normal)
- AW: Poop (count)
- AX: Digestion (-3 to +3)
- AY: Stress (0-3)
- AZ: Weight (lbs)

### Mood (BA-BG)
- BA: Happy (0-3)
- BB: Sad (0-3)
- BC: Angry (0-3)
- BD: Anxiety (0-3)
- BE: Ahedonia (0-3)
- BF: Libido (0-3)
- BG: Hungry (0-3)

### Mindset (BH-BJ)
- BH: Self-Denial (0-3)
- BI: Gratitude (0-3)
- BJ: Intentional Computer Use (0-3)

### Intake (BK-CE) — NEW
- BK: 🌊 Water (count, 2oz units, 10/stein)
- BL: ☘️ Veggies (servings)
- BM: 🍞 Flour (servings)
- BN: ♠️ Sugar (servings)
- BO: 🐄 Protein (oz of meat)
- BP: 🦋🗣️ Butterfly Breath (count sessions)
- BQ: ⏩ Dex (dose mg)
- BR: 🍄 Mushroom (tbsp)
- BS: 🛏 Make Bed (binary 0/1)
- BT: 🧃 Juice (binary 0/1)
- BU: ❄️🧊 Cold Therapy (binary 0/1)
- BV: 🦻🏿🎵 Listen To Music (hours)
- BW: 💉 Acupuncture (binary 0/1)
- BX: 🖐 Massage (binary 0/1)
- BY: ⌊PF Pelvic Floor Massage (binary 0/1)
- BZ: 💤🫙 Sleep Stack (binary 0/1)
- CA: 🗣️ Therapy (binary 0/1)
- CB: 👍🏿🐜 Probiotics (binary 0/1)
- CC: 💊💉 T Shot (binary 0/1)
- CD: 🍑 Smooth (body shaving, binary 0/1)
- CE: 🚫🍞 No/little bread (binary 0/1)

### Calories (CF-CG)
- CF: 🍰 Cal In (integer)
- CG: ⽕ Cal Burned (integer)

### Tonics (CH-CI)
- CH: 🫚 Ginger, Turmeric, Matcha, Pepper (binary 0/1)
- CI: 🍋 Lemon, Cherry Juice (binary 0/1)

### Luck (CJ-CK)
- CJ: 🎖️🏆💯 Wins (count)
- CK: 💩👺☹ Poopy luck (count)

### Times (DB-DD)
- DB: 😴⏰💤 When Tired (HHMM)
- DC: 🚫🖥️⏰ Time Computer Off (HHMM military)
- DD: 🖥️⌛️ Screen Time (hours)

### Plaintext (DF-DH)
- DF: 🔥 Triggers (plaintext notes)
- DG: 🩺 Symptoms Notes (plaintext description)
- DH: 🍽️ Meals (full meal description)

### Activity Hours (E-AE)
**NOTE:** Activity hours are rough time tracking only. DO NOT use these for calorie calculations. Use BMR + light activity factor instead.

**🛏️ Sleep (E-F):**
1. 😴 Sleep (hours) → E
2. 💤💸 Sleep debt → F

**🏃🏿‍♂️ Activities (G-T):**
1. 🧘‍♂️ Sit/Meditate → G
2. 🔢 Plan → H
3. 🏋️‍♂️ Exercise → I
4. 👍🏿 C4G → J
5. 💿 Music Production → K
6. 🖥️🧠 ML Applied → L
7. 💼 Work → M
8. 🧑‍🎓 Learning → N
9. 🏈 Practice → O
10. 🧹 Cleaning → P
11. 💻 Coding → Q
12. ✏️ Writing/Editing → R
13. ✍️ Journal → S
14. ➕ Other → T

**🍕 Consumption (U-AA):**
1. 📖 Read → U
2. 🎵 Music → V
3. 🗨️ Chat → W
4. ☕ Coffee → X
5. 🔥 Sauna → Y
6. 🍆 Sex → Z
7. ➕ Extra → AA

**🎉 Extra (AB-AE):**
1. 🎮 Game → AB
2. 🌲 Trees → AC
3. 🍗 Food → AD
4. 📰 Content → AE

## Process

### BATCH MODE (Default)

Ask ONE question upfront with this template:

```
📊 PM Metrics — dump it all:

A. **Time:** sleep hrs, debt | sit, plan, exercise, c4g, music, ml, work, learn, practice, clean, code, write, journal, other | read, music, chat, coffee, sauna, sex, extra | game, trees, food, content

B. **State:** vipassana (aware 0-5, equan 0-5) | quality (focus, energy, sleep: -3/+3 each) | mood (happy, sad, angry, anxious, ahedonic, horny, hungry: 0-3) | mindset (denial, grat, intentional: 0-3)

C. **Body:** symptoms 0-3 (fog, cant-think, ears, shitty, head, gout, heart, muscle, itch, vasc, stress) | poop, wood 0-5, digestion -3/+3, weight

D. **Exercise:** pushups, lunges, pullups, knees, swim, bike-mins, kettlebells, knives, sun-salutes, plank-secs, dance-mins, trx | muscles 1=worked 2=sore (arms, legs, chest, back)

E. **Intake:** water (2oz), veggies, flour, sugar, protein-oz | dex mg, mushroom tbsp | binary y/n: breath, bed, juice, cold, music-hrs, acu, massage, pelvic, sleep-stack, therapy, probiotics, t-shot, smooth, no-bread, ginger, lemon

F. **Calories:** in, out (or describe meals)

G. **Meta:** tired HHMM, computer-off HHMM | wins, poopy | triggers, symptom-notes, meals
```

Accept freeform dump, parse what's provided, ask only for missing critical fields.

### STEP-BY-STEP MODE (if user prefers)

Say "step by step" to use conversational flow below.

### Step 1: Find Target Date's Row
**IMPORTANT:** User may run this after midnight for previous day's data.

Ask: "Recording for today or yesterday?"
- If after midnight and user says yesterday, use previous calendar date
- Otherwise use today's date

Look up column A to find row matching target date (format: M/D, e.g., "1/1").

### Step 1b: Activity Hours
Ask: "How'd you spend your hours today?"

Present numbered lists by section:

**🛏️ Sleep:**
1. Sleep hours  2. Sleep debt (COMPUTED - copy formula from F[yesterday] to F[today], it auto-adjusts)

**🏃🏿‍♂️ Activities:**
1. Sit  2. Plan  3. Exercise  4. C4G  5. Music Prod  6. ML  7. Work  8. Learning  9. Practice  10. Cleaning  11. Coding  12. Writing  13. Journal  14. Other

**🍕 Consumption:**
1. Read  2. Music  3. Chat  4. Coffee  5. Sauna  6. Sex  7. Extra

**🎉 Extra:**
1. Game  2. Trees  3. Food  4. Content

Accept shorthand: "sleep:7, act:7-4,11-2, con:2-2" (section:item-hours)

### Step 2: Vipassana Check
Ask: "👁️ Awareness? 🪷 Equanimity? (0-5 each)"
- Awareness: 0=none, 1=under nose, 5=full dissolution
- Equanimity: 0=raging, 1=maintain space, 5=unbothered
→ AG, AH

### Step 3: Quality Check

**Focus** (four parts + timer bonus → combined score):
Ask: "Focus today:"
- "Flow ability?" (-3 = couldn't enter, 0 = sporadic, +3 = deep flow)
- "Next steps clarity?" (-3 = stuck/blank, 0 = okay, +3 = clear path)
- "Stayed engaged?" (-3 = constantly pulled away, 0 = mixed, +3 = locked in)
- "Distraction resistance?" (-3 = gave in constantly, 0 = some slips, +3 = bulletproof)
- "Set a timer?" (Yes = +0.5 bonus)

Calculate: Average first four + timer bonus. Cap at ±3. → AI

**Energy** (four parts − crutch penalty → combined score):
Ask: "Energy today:"
- "Output - how much got done?" (-3 = nothing, 0 = some, +3 = crushed it)
- "Movement + thinking balance?" (-3 = sedentary/stagnant, 0 = okay, +3 = good mix)
- "Excess energy available?" (-3 = depleted, 0 = broke even, +3 = surplus)
- "Project sustain?" (-3 = couldn't stick, 0 = mixed, +3 = hours locked in)
- "Games/reddit crutch?" (0 = none, 1 = some → -0.5, 2 = moderate → -1, 3 = heavy → -1.5)

Calculate: Average first four − crutch penalty. Cap at ±3. → AJ

**Sleep Quality** (three parts → combined score):
Ask: "Last night's sleep:"
- "Fall asleep ease?" (-3 = struggled, 0 = normal, +3 = instant)
- "Wake ups?" (0 = none, 1 = once, 2 = few, 3 = constantly)
- "Rested?" (-3 = exhausted, 0 = okay, +3 = refreshed)

Calculate: Invert wakeups (0→+3, 1→+1, 2→-1, 3→-3), average all three, round to 0.5. → AK

### Step 4: Symptom Scan
Ask: "Any symptoms? Rate by number (0.1=trace, 1=mild, 2=mod, 3=severe)"

Present numbered list:
1. Fog
2. Can't Think
3. Ear Ringing
4. Feel Shitty
5. Headache
6. Gout
7. Heart Tension
8. Muscle Pain
9. Itchy
10. Vasculitis
11. Stress

Accept shorthand: "3:1, 11:2" or "fog 1, stress 2". Unlisted = 0.

### Step 5: Body Data
Ask: "Body check — Poop count? Morning wood (0-5, 3=normal)? Digestion (-3 to +3)?"

### Step 6: Mood Snapshot
Ask: "Mood (0-3 each): Happy, Sad, Angry, Anxious, Ahedonic, Horny, Hungry?"

Accept shorthand: "2,0,0,0,1,1,2"

### Step 7: Mindset
Ask: "Mindset (0-3): Self-denial? Gratitude? Intentional computer use?"

### Step 8: Exercise
Ask: "What movement/exercise today?"

Track:
- General activity hours (walking, etc.) → I
- Specific counts: Pushups, Lunges, Pullups, Knee Raises, Swim Laps, Kettlebells, Knives, Sun Salutations → CL-CT
- Bike minutes → CQ
- Plank max seconds → CU
- Dancing minutes → CV
- TRX (bodyweight bands count) → CW

Ask: "Muscle groups — which did you work or are sore? (1=worked, 2=sore)"
- Arms → CX
- Legs → CY
- Chest → CZ
- Back → DA

### Step 9: Intake Checklist
Ask: "Intake check — quick fire:"

**Nutrition (BK-BO):**
- "Water count (2oz units)?" → BK
- "Veggies (servings)?" → BL
- "Flour (servings)?" → BM
- "Sugar (servings)?" → BN
- "Protein (oz meat)?" → BO

**Supplements/Behaviors (BP-CE):**
- "Butterfly breath sessions?" → BP
- "Dex dose (mg)?" → BQ
- "Mushroom (tbsp)?" → BR
- "Make bed?" (y/n) → BS
- "Juice?" (y/n) → BT
- "Cold therapy?" (y/n) → BU
- "Listened to music (hours)?" → BV
- "Acupuncture?" (y/n) → BW
- "Massage?" (y/n) → BX
- "Pelvic floor?" (y/n) → BY
- "Sleep stack?" (y/n) → BZ
- "Therapy?" (y/n) → CA
- "Probiotics?" (y/n) → CB
- "T shot?" (y/n) → CC
- "Shaved (smooth)?" (y/n) → CD
- "No/little bread?" (y/n) → CE

**Tonics (CH-CI):**
- "Ginger/turmeric drink?" (y/n) → CH
- "Lemon/cherry juice?" (y/n) → CI

Accept shorthand: "w:10, v:2, f:1, s:0, p:8, bed:y, cold:y" etc.

### Step 10: Food/Calories Conversation
Ask: "Walk me through what you ate/drank today."

Calculate based on user's weight (stored above):
- Calories IN (food/drink total) → CF
- Calories OUT (BMR + light activity factor, NOT from activity hours) → CG
- Net balance (display only)
- Full meal description → DH

Then ask: "Any triggers today? (DF)" and "Symptom notes beyond ratings? (DG)"
- Triggers (plaintext) → DF
- Symptoms notes (plaintext) → DG

### Step 11: Luck + Times
Ask: "Any wins today? 🎖️ Any poopy luck? 💩"
- Wins → CJ
- Poopy → CK

Ask: "When did you feel tired? When computer off?"
- When tired (HHMM) → DB
- Computer off (HHMM) → DC

### Step 12: Summary + Confirm
Display all values in table format.
Show: Vipassana, Quality scores, Symptoms, Body, Mood, Mindset, Exercise, Intake, Calories (In/Out/Net), Plaintext (Triggers/Symptoms/Meals), Times
Ask: "Look right? Confirm to write."

### Step 13: Write to Sheet
Get current time via `date +%H%M`.

**VERIFY ROW BEFORE WRITING:**
- Confirm the sheet row number (not array index) that matches target date
- Display: "Writing to row [NUMBER] for date [DATE]"
- Double-check row number calculation (array index + header offset)
- Wait for user confirmation before executing write

Write to today's row:
- AG-AH: Vipassana (Awareness, Equanimity)
- AI-AK: Quality (Focus, Energy, Sleep)
- AL-AY: Symptoms + Body
- BA-BG: Mood
- BH-BJ: Mindset
- BK-CE: Intake (nutrition + supplements/behaviors)
- CF-CG: Calories (In, Burned)
- CH-CI: Tonics
- CJ-CK: Luck (wins, poopy)
- CL-CW: Exercise counts (incl. Dancing, TRX)
- CX-DA: Muscle groups (1=worked, 2=sore)
- DB: When tired
- DC: Current time (HHMM) — marks computer off
- DF-DH: Plaintext (Triggers, Symptoms notes, Meals)

Use batch_update_cells for efficiency. Report success with cell count.

## Meal Templates
Shortcuts for common meals — user can say "big breakfast" instead of listing items.

| Name | Items | ~Cal |
|------|-------|------|
| big breakfast | 2.5 eggs, 2 chicken sausages, 1/4c beans, apple + PB | 580 |
| normal breakfast | 1 apple + almond butter, 1/2 cup edamame | 385 |
| snackipoo | rice cake, 1 tbsp almond butter, 1 tsp honey | 150 |
| apple + AB | 1 apple, 2 tbsp almond butter | 290 |

## Rules
- Accept shorthand (e.g., "fog 1, itch 0.3" or comma-separated numbers)
- Default unmentioned values to 0 but DO NOT write 0s to sheet — only write non-zero values
- Be efficient, not tedious — group questions where sensible
- Calories are estimates based on stated weight + activity
- Write only after explicit confirmation
- If user adds info mid-flow, recalculate affected scores
