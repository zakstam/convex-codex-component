import { useMemo, useState } from "react";

type Props = {
  availableTools: string[];
  disabledTools: string[];
  running: boolean;
  onSetDisabledTools: (tools: string[]) => Promise<void>;
};

export function ToolDisablePanel({
  availableTools,
  disabledTools,
  running,
  onSetDisabledTools,
}: Props) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const disabledSet = useMemo(() => new Set(disabledTools), [disabledTools]);

  const toggleTool = async (tool: string, nextDisabled: boolean) => {
    const currentlyDisabled = disabledSet.has(tool);
    if (currentlyDisabled === nextDisabled) {
      return;
    }

    if (isSubmitting) {
      return;
    }
    const nextTools = nextDisabled
      ? [...disabledSet, tool]
      : [...disabledSet].filter((name) => name !== tool);
    const uniqueNextTools = [...new Set(nextTools)].sort();

    const currentTools = [...new Set(disabledTools)].sort();
    if (
      uniqueNextTools.length === currentTools.length &&
      uniqueNextTools.every((toolName, index) => toolName === currentTools[index])
    ) {
      return;
    }

    setIsSubmitting(true);
    try {
      await onSetDisabledTools(uniqueNextTools);
    } finally {
      setIsSubmitting(false);
    }
  };

  const enableAllTools = async () => {
    if (isSubmitting || disabledTools.length === 0) {
      return;
    }
    setIsSubmitting(true);
    try {
      await onSetDisabledTools([]);
    } finally {
      setIsSubmitting(false);
    }
  };

  const controlsDisabled = !running || isSubmitting;
  const disabledNames = [...disabledSet].sort();

  return (
    <section className="panel card" aria-label="Tool policy controls">
      <h2>Tool Policy</h2>
      <p className="meta">
        Toggle which dynamic tools are blocked by the runtime.
      </p>
      <div className="tool-policy-list">
        {availableTools.map((tool) => {
          const isDisabled = disabledSet.has(tool);
          return (
            <label className="tool-policy-row" key={tool}>
              <input
                type="checkbox"
                checked={isDisabled}
                onChange={(event) => void toggleTool(tool, event.target.checked)}
                disabled={controlsDisabled}
              />
              <span>
                {isDisabled ? "Blocked" : "Allowed"}:
                <span className="tool-policy-name">{tool}</span>
              </span>
            </label>
          );
        })}
      </div>
      <div className="auth-row">
        <button
          className="secondary"
          onClick={() => void enableAllTools()}
          disabled={controlsDisabled || disabledTools.length === 0}
        >
          Enable all tools
        </button>
      </div>
      <p className="meta">
        {disabledNames.length > 0
          ? `Blocked tools: ${disabledNames.join(", ")}`
          : "No blocked tools"}
      </p>
    </section>
  );
}
