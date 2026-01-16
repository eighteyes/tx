/**
 * NarrativeControls.tsx
 * Special controls for narrative-engine mesh sessions.
 * Responsibilities:
 * - Provide quick-action buttons for game commands
 * - Handle "new game", "resume", "fork" commands
 */

import { useCallback } from 'react';
import './NarrativeControls.css';

interface NarrativeControlsProps {
  onCommand: (command: string) => void;
  disabled?: boolean;
  hasMessages?: boolean;
}

export function NarrativeControls({
  onCommand,
  disabled = false,
  hasMessages = false,
}: NarrativeControlsProps) {
  const handleNewGame = useCallback(() => {
    onCommand('new game');
  }, [onCommand]);

  const handleResume = useCallback(() => {
    onCommand('resume');
  }, [onCommand]);

  const handleFork = useCallback(() => {
    onCommand('fork');
  }, [onCommand]);

  return (
    <div className="narrative-controls">
      <h4 className="narrative-controls__title">Game Controls</h4>

      <div className="narrative-controls__buttons">
        {!hasMessages && (
          <button
            className="btn btn--narrative btn--new-game"
            onClick={handleNewGame}
            disabled={disabled}
          >
            🎮 New Game
          </button>
        )}

        {hasMessages && (
          <>
            <button
              className="btn btn--narrative btn--resume"
              onClick={handleResume}
              disabled={disabled}
            >
              ▶️ Resume
            </button>

            <button
              className="btn btn--narrative btn--fork"
              onClick={handleFork}
              disabled={disabled}
            >
              🔀 Fork Story
            </button>
          </>
        )}
      </div>

      <div className="narrative-controls__help">
        <p><strong>new game</strong> - Start a fresh adventure</p>
        <p><strong>resume</strong> - Continue from last point</p>
        <p><strong>fork</strong> - Branch the story</p>
      </div>
    </div>
  );
}

export default NarrativeControls;
