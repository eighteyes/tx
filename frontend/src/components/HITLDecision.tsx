/**
 * HITLDecision.tsx
 * Render HITL (Human-in-the-Loop) decision requests.
 * Responsibilities:
 * - Display decision prompt
 * - Show available choices as buttons
 * - Handle custom input option
 */

import { useState, useCallback } from 'react';
import './HITLDecision.css';

interface HITLDecisionProps {
  question: string;
  choices?: string[];
  onDecision: (response: string) => void;
  disabled?: boolean;
}

export function HITLDecision({
  question,
  choices = [],
  onDecision,
  disabled = false,
}: HITLDecisionProps) {
  const [customInput, setCustomInput] = useState('');
  const [showCustom, setShowCustom] = useState(false);

  const handleChoice = useCallback((choice: string) => {
    onDecision(choice);
  }, [onDecision]);

  const handleCustomSubmit = useCallback(() => {
    if (customInput.trim()) {
      onDecision(customInput.trim());
      setCustomInput('');
      setShowCustom(false);
    }
  }, [customInput, onDecision]);

  return (
    <div className="hitl-decision">
      <div className="hitl-decision__prompt">
        <span className="hitl-decision__icon">🎯</span>
        <p className="hitl-decision__question">{question}</p>
      </div>

      {choices.length > 0 && (
        <div className="hitl-decision__choices">
          {choices.map((choice, index) => (
            <button
              key={index}
              className="btn btn--choice"
              onClick={() => handleChoice(choice)}
              disabled={disabled}
            >
              {choice}
            </button>
          ))}
        </div>
      )}

      <div className="hitl-decision__custom">
        {!showCustom ? (
          <button
            className="btn btn--ghost btn--sm"
            onClick={() => setShowCustom(true)}
            disabled={disabled}
          >
            Custom response...
          </button>
        ) : (
          <div className="hitl-decision__custom-input">
            <input
              type="text"
              value={customInput}
              onChange={(e) => setCustomInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCustomSubmit()}
              placeholder="Type your response..."
              disabled={disabled}
              autoFocus
            />
            <button
              className="btn btn--primary btn--sm"
              onClick={handleCustomSubmit}
              disabled={!customInput.trim() || disabled}
            >
              Send
            </button>
            <button
              className="btn btn--ghost btn--sm"
              onClick={() => setShowCustom(false)}
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Parse ask-human message body into question and choices
 */
export function parseAskHuman(body: string): { question: string; choices: string[] } {
  const lines = body.split('\n').filter(l => l.trim());
  const question = lines[0] || 'What would you like to do?';

  // Look for numbered choices or bullet points
  const choices: string[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    // Match: "1. Choice" or "- Choice" or "* Choice"
    const match = line.match(/^(?:\d+\.|[-*])\s*(.+)$/);
    if (match) {
      choices.push(match[1]);
    }
  }

  return { question, choices };
}

export default HITLDecision;
