import { useEffect, useRef } from 'react';
import Editor from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import './YAMLEditor.css';

interface YAMLEditorProps {
  value: string;
  onChange: (value: string) => void;
  onValidationError?: (errors: string[]) => void;
  readOnly?: boolean;
}

export function YAMLEditor({
  value,
  onChange,
  onValidationError,
  readOnly = false,
}: YAMLEditorProps) {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);

  function handleEditorMount(editor: editor.IStandaloneCodeEditor) {
    editorRef.current = editor;

    // Configure editor
    editor.updateOptions({
      minimap: { enabled: false },
      fontSize: 14,
      lineNumbers: 'on',
      scrollBeyondLastLine: false,
      wordWrap: 'on',
      readOnly,
      tabSize: 2,
    });
  }

  function handleEditorChange(newValue: string | undefined) {
    if (newValue !== undefined) {
      onChange(newValue);
    }
  }

  // Parse YAML for validation on blur
  useEffect(() => {
    if (!editorRef.current || !onValidationError) return;

    const editor = editorRef.current;

    // Add blur event listener for validation
    const disposable = editor.onDidBlurEditorText(() => {
      try {
        // Import js-yaml dynamically to avoid SSR issues
        import('js-yaml').then((yaml) => {
          try {
            yaml.load(value);
            onValidationError([]);
          } catch (err) {
            const errorMsg = err instanceof Error ? err.message : 'Invalid YAML';
            onValidationError([errorMsg]);
          }
        });
      } catch (err) {
        console.error('Failed to validate YAML:', err);
      }
    });

    return () => {
      disposable.dispose();
    };
  }, [value, onValidationError]);

  return (
    <div className="yaml-editor-wrapper">
      <Editor
        height="600px"
        defaultLanguage="yaml"
        value={value}
        onChange={handleEditorChange}
        onMount={handleEditorMount}
        theme="vs-light"
        options={{
          minimap: { enabled: false },
          fontSize: 14,
          lineNumbers: 'on',
          scrollBeyondLastLine: false,
          wordWrap: 'on',
          readOnly,
          tabSize: 2,
        }}
      />
    </div>
  );
}
