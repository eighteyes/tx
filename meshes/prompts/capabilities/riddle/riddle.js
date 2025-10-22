/**
 * Riddle Game Capability
 *
 * Manages competitive riddle games between agents
 * - Tracks scores
 * - Validates answers
 * - Manages game rounds
 * - Determines winners
 */

const fs = require('fs');
const path = require('path');

class RiddleGame {
  constructor(gameId) {
    this.gameId = gameId;
    this.gameDir = path.join(process.cwd(), '.ai/tx/riddle-games', gameId);
    this.stateFile = path.join(this.gameDir, 'state.json');
    this.riddlesFile = path.join(this.gameDir, 'riddles.json');
    this.ensureDirectory();
    this.loadState();
  }

  /**
   * Ensure game directory exists
   */
  ensureDirectory() {
    if (!fs.existsSync(this.gameDir)) {
      fs.mkdirSync(this.gameDir, { recursive: true });
    }
  }

  /**
   * Initialize new game
   */
  initializeGame(players = [], maxRounds = 5) {
    this.state = {
      gameId: this.gameId,
      status: 'in-progress',
      maxRounds: maxRounds,
      currentRound: 0,
      players: players,
      scores: {},
      history: []
    };

    // Initialize scores
    players.forEach(player => {
      this.state.scores[player] = 0;
    });

    this.saveState();
    return this.state;
  }

  /**
   * Built-in riddle database
   */
  static getRiddleDatabase() {
    return [
      {
        riddle: "I speak without a mouth and hear without ears. I have no body, but I come alive with wind. What am I?",
        answer: "echo",
        difficulty: "easy"
      },
      {
        riddle: "What has hands but cannot clap?",
        answer: "clock",
        difficulty: "easy"
      },
      {
        riddle: "I have cities, but no houses. I have mountains, but no trees. I have water, but no fish. What am I?",
        answer: "map",
        difficulty: "easy"
      },
      {
        riddle: "What gets wetter the more it dries?",
        answer: "towel",
        difficulty: "easy"
      },
      {
        riddle: "I am taken from a mine and shut up in a wooden case, from which I am never released, yet I am used by almost everyone. What am I?",
        answer: "pencil lead",
        difficulty: "medium"
      },
      {
        riddle: "What can travel around the world while staying in a corner?",
        answer: "stamp",
        difficulty: "medium"
      },
      {
        riddle: "The more you take, the more you leave behind. What am I?",
        answer: "footsteps",
        difficulty: "medium"
      },
      {
        riddle: "What has a face and two hands, but no arms or legs?",
        answer: "clock",
        difficulty: "easy"
      },
      {
        riddle: "What can you catch but not throw?",
        answer: "cold",
        difficulty: "easy"
      },
      {
        riddle: "I am not alive, but I grow. I don't have lungs, but I need air. I don't have a mouth, but water kills me. What am I?",
        answer: "fire",
        difficulty: "medium"
      },
      {
        riddle: "What question can you never answer 'yes' to?",
        answer: "are you asleep",
        difficulty: "hard"
      },
      {
        riddle: "What is seen in the middle of March and April that can't be seen at the beginning or end of either month?",
        answer: "r",
        difficulty: "hard"
      }
    ];
  }

  /**
   * Get a random riddle
   */
  getRandomRiddle() {
    const riddles = RiddleGame.getRiddleDatabase();
    return riddles[Math.floor(Math.random() * riddles.length)];
  }

  /**
   * Normalize answer for comparison (lowercase, trim punctuation)
   */
  normalizeAnswer(answer) {
    return answer.toLowerCase()
      .trim()
      .replace(/[.,!?;:]/g, '')
      .split(/\s+/).join('');
  }

  /**
   * Check if answer is correct
   */
  checkAnswer(givenAnswer, correctAnswer) {
    const normalized = this.normalizeAnswer(givenAnswer);
    const correct = this.normalizeAnswer(correctAnswer);

    // Exact match or very close match (for tolerance)
    return normalized === correct ||
           this.levenshteinDistance(normalized, correct) <= 1;
  }

  /**
   * Simple Levenshtein distance for fuzzy matching
   */
  levenshteinDistance(a, b) {
    const matrix = [];

    for (let i = 0; i <= b.length; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= a.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        if (b.charAt(i - 1) === a.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }

    return matrix[b.length][a.length];
  }

  /**
   * Record a riddle answer attempt
   */
  recordAttempt(asker, answerer, riddle, givenAnswer, isCorrect) {
    const round = {
      round: this.state.currentRound,
      asker: asker,
      answerer: answerer,
      riddle: riddle.riddle,
      correctAnswer: riddle.answer,
      givenAnswer: givenAnswer,
      isCorrect: isCorrect,
      timestamp: new Date().toISOString()
    };

    this.state.history.push(round);

    if (isCorrect) {
      this.state.scores[answerer] = (this.state.scores[answerer] || 0) + 1;
    } else {
      // Asker gets a point if answerer fails
      this.state.scores[asker] = (this.state.scores[asker] || 0) + 0.5;
    }

    this.saveState();
    return round;
  }

  /**
   * Advance to next round
   */
  nextRound() {
    this.state.currentRound += 1;

    if (this.state.currentRound >= this.state.maxRounds) {
      this.endGame();
    }

    this.saveState();
    return this.state;
  }

  /**
   * End game and determine winner
   */
  endGame() {
    this.state.status = 'completed';

    // Find winner
    const scores = this.state.scores;
    let winner = null;
    let maxScore = -1;

    for (const player in scores) {
      if (scores[player] > maxScore) {
        maxScore = scores[player];
        winner = player;
      }
    }

    this.state.winner = winner;
    this.state.finalScores = scores;
    this.state.endTime = new Date().toISOString();

    this.saveState();
    return this.state;
  }

  /**
   * Get current game state
   */
  getState() {
    return this.state;
  }

  /**
   * Get game results
   */
  getResults() {
    if (this.state.status !== 'completed') {
      return {
        status: 'game-in-progress',
        round: this.state.currentRound,
        maxRounds: this.state.maxRounds,
        scores: this.state.scores
      };
    }

    return {
      status: 'game-complete',
      winner: this.state.winner,
      finalScores: this.state.finalScores,
      totalRounds: this.state.currentRound,
      history: this.state.history
    };
  }

  /**
   * Load state from disk
   */
  loadState() {
    try {
      if (fs.existsSync(this.stateFile)) {
        const data = fs.readFileSync(this.stateFile, 'utf8');
        this.state = JSON.parse(data);
      } else {
        this.state = null;
      }
    } catch (e) {
      console.error('Error loading state:', e);
      this.state = null;
    }
  }

  /**
   * Save state to disk
   */
  saveState() {
    try {
      fs.writeFileSync(this.stateFile, JSON.stringify(this.state, null, 2));
    } catch (e) {
      console.error('Error saving state:', e);
    }
  }

  /**
   * Get game summary
   */
  getSummary() {
    return {
      gameId: this.gameId,
      status: this.state.status,
      currentRound: this.state.currentRound,
      maxRounds: this.state.maxRounds,
      scores: this.state.scores,
      winner: this.state.winner || 'Game in progress',
      history: this.state.history.length
    };
  }
}

module.exports = { RiddleGame };
