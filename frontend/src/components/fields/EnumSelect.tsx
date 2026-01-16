import { FieldHelp } from '../FieldHelp';

interface EnumSelectProps {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
  required?: boolean;
  helpText?: string;
}

export function EnumSelect({
  label,
  value,
  options,
  onChange,
  required = false,
  helpText,
}: EnumSelectProps) {
  return (
    <div className="field">
      <label className="field-label">
        {label}
        {required && <span className="required">*</span>}
        {helpText && <FieldHelp text={helpText} position="right" />}
      </label>
      <select
        className="field-select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    </div>
  );
}
