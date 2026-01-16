import type { ReactNode } from 'react';

interface ArrayFieldProps<T> {
  label: string;
  items: T[];
  onAdd: () => void;
  onRemove: (index: number) => void;
  renderItem: (item: T, index: number) => ReactNode;
  addButtonLabel?: string;
}

export function ArrayField<T>({
  label,
  items,
  onAdd,
  onRemove,
  renderItem,
  addButtonLabel = 'Add Item',
}: ArrayFieldProps<T>) {
  return (
    <div className="array-field">
      <div className="array-field-header">
        <label className="field-label">{label}</label>
        <button type="button" onClick={onAdd} className="add-button">
          + {addButtonLabel}
        </button>
      </div>

      <div className="array-field-items">
        {items.length === 0 ? (
          <p className="empty-state">No items. Click "+" to add.</p>
        ) : (
          items.map((item, idx) => (
            <div key={idx} className="array-field-item">
              <div className="array-item-content">{renderItem(item, idx)}</div>
              <button
                type="button"
                onClick={() => onRemove(idx)}
                className="remove-button"
                title="Remove"
              >
                ✕
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
