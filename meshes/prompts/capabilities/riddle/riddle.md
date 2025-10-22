# Riddle Capability - Competitive Game Management

The **Riddle** capability lets you manage competitive riddle games between agents.

## Overview

You can:
- ✅ Ask other agents riddles
- ✅ Answer riddles from other agents
- ✅ Track scores automatically
- ✅ Validate answers
- ✅ Determine winners

## The Game Pattern

1. **Initialization** (Mediator): `game.initializeGame(['player1', 'player2'], maxRounds=5)`
2. **Round 1**: Player 1 asks Player 2 a riddle → Mediator validates answer → scores update
3. **Round 2**: Player 2 asks Player 1 a riddle → Mediator validates answer → scores update
4. **Repeat** for N rounds
5. **Results**: Winner determined and announced

## Using the Riddle Tool

### Initialize a Game (Mediator Agent)

```javascript
const { RiddleGame } = require('../capabilities/riddle/riddle.js');

const game = new RiddleGame('game-session-1');
game.initializeGame(['player1', 'player2'], maxRounds=5);
```

### Get a Riddle to Ask

```javascript
const riddle = game.getRandomRiddle();
console.log(riddle.riddle);  // The riddle question
// Answer stored in riddle.answer for mediator validation
```

### Check an Answer

```javascript
const result = game.checkAnswer(playerAnswer, riddle.answer);
// Returns: true or false
```

### Record the Attempt

```javascript
const record = game.recordAttempt(asker, answerer, riddle, playerAnswer, isCorrect);
// Automatically updates scores
```

### Move to Next Round

```javascript
game.nextRound();  // Advances round counter
// When maxRounds reached, game automatically ends
```

### Get Current State

```javascript
const state = game.getState();
console.log(state.scores);      // Current scores
console.log(state.currentRound); // What round we're on
```

### Get Game Results

```javascript
const results = game.getResults();
console.log(results.winner);       // Who won
console.log(results.finalScores);  // Final scores
console.log(results.history);      // All riddles asked/answered
```

## Message Flow Example

### Player 1 Asks a Riddle

```markdown
---
from: game/player1
to: game/player2
type: task
status: start
---

Here's a riddle for you:

**Riddle**: What gets wetter the more it dries?

Please answer in your next message!
```

### Player 2 Answers

```markdown
---
from: game/player2
to: game/mediator
type: ask
msg-id: riddle-answer-r1
---

The answer to the riddle is: **towel**
```

### Mediator Validates and Scores

```javascript
// In mediator agent
const game = new RiddleGame('game-session-1');
const isCorrect = game.checkAnswer('towel', 'towel');  // true

game.recordAttempt('player1', 'player2', riddle, 'towel', true);
// player2's score increases

game.nextRound();
```

## Scoring Rules

- ✅ **Correct Answer**: Answerer gets 1 point
- ❌ **Wrong Answer**: Asker gets 0.5 points (partial credit for good riddle)
- **Winner**: Player with most points after all rounds

## Built-in Riddles

12 riddles included in the database (easy, medium, hard difficulty)

Get one at random:
```javascript
const riddle = game.getRandomRiddle();
```

## Key Methods

| Method | Purpose |
|--------|---------|
| `initializeGame(players, maxRounds)` | Start new game |
| `getRandomRiddle()` | Get a riddle to ask |
| `checkAnswer(given, correct)` | Validate an answer |
| `recordAttempt(asker, answerer, riddle, answer, isCorrect)` | Record round result |
| `nextRound()` | Move to next round |
| `endGame()` | Finish game and declare winner |
| `getState()` | Get current game state |
| `getResults()` | Get game results |
| `getSummary()` | Get quick game summary |

## Agent Roles

### Player Agents
- Receive riddles to answer
- Send answers to mediator
- Ask riddles to opponent
- Respond to questions

### Mediator Agent
- Initializes the game
- Coordinates all rounds
- Validates answers
- Tracks scores
- Announces winner
- Saves game state

## File Structure

Game data stored in: `.ai/tx/riddle-games/{gameId}/`
- `state.json` - Game state and scores
- All messages in normal `.ai/tx/mesh/` queue system

## Tips

1. **Ensure unique game IDs** to avoid conflicts between multiple games
2. **Mediator manages state** - central source of truth
3. **Use ask/ask-response** for score updates and queries
4. **Game auto-completes** when `currentRound >= maxRounds`
5. **Save results** before shutting down mediator agent
