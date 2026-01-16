/**
 * KeyboardShortcutsHelp.tsx
 * Modal showing available keyboard shortcuts.
 */

import './KeyboardShortcutsHelp.css';

interface KeyboardShortcutsHelpProps {
  isOpen: boolean;
  onClose: () => void;
}

const shortcuts = [
  { keys: ['Ctrl', 'Enter'], description: 'Send message' },
  { keys: ['Escape'], description: 'Close modal / Cancel' },
  { keys: ['?'], description: 'Show keyboard shortcuts' },
  { keys: ['Ctrl', 'N'], description: 'New session' },
  { keys: ['Ctrl', 'S'], description: 'Save mesh config' },
];

export function KeyboardShortcutsHelp({ isOpen, onClose }: KeyboardShortcutsHelpProps) {
  if (!isOpen) return null;

  return (
    <div
      className="shortcuts-modal-overlay"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="shortcuts-title"
    >
      <div className="shortcuts-modal" onClick={e => e.stopPropagation()}>
        <div className="shortcuts-modal__header">
          <h2 id="shortcuts-title">Keyboard Shortcuts</h2>
          <button
            className="shortcuts-modal__close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="shortcuts-modal__content">
          {shortcuts.map((shortcut, index) => (
            <div key={index} className="shortcut-item">
              <div className="shortcut-keys">
                {shortcut.keys.map((key, i) => (
                  <span key={i}>
                    <kbd className="shortcut-key">{key}</kbd>
                    {i < shortcut.keys.length - 1 && ' + '}
                  </span>
                ))}
              </div>
              <div className="shortcut-description">{shortcut.description}</div>
            </div>
          ))}
        </div>
        <div className="shortcuts-modal__footer">
          Press <kbd>Escape</kbd> or <kbd>?</kbd> to close
        </div>
      </div>
    </div>
  );
}

export default KeyboardShortcutsHelp;
