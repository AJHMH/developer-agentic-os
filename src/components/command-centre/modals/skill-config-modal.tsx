import type { SkillCommand } from "@/types/skill";

export function SkillConfigModal({
  configuredSkill,
  onClose,
  onSaveConfig,
}: {
  configuredSkill: SkillCommand;
  onClose: () => void;
  onSaveConfig: (skill: SkillCommand) => void;
}) {
  return (
    <div className="layout-popover" role="presentation" onClick={onClose}>
      <section
        className="layout-panel skill-config-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="skill-config-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="layout-panel-header">
          <h3 id="skill-config-title">
            {configuredSkill.command} <span>matrix</span>
          </h3>
          <button
            className="icon-button"
            type="button"
            aria-label="Close skill configuration"
            onClick={onClose}
          >
            x
          </button>
        </div>
        <div className="model-effort-matrix" aria-label="Model by effort matrix">
          <span />
          {(["low", "medium", "high", "xhigh", "max"] as const).map((effort) => (
            <strong key={effort}>{effort}</strong>
          ))}
          {(["sonnet", "opus", "fable"] as const).map((model) => (
            <div className="matrix-row" key={model}>
              <b>{model}</b>
              {(["low", "medium", "high", "xhigh", "max"] as const).map((effort) => (
                <button
                  className={
                    configuredSkill.model === model && configuredSkill.effort === effort
                      ? "selected"
                      : ""
                  }
                  key={effort}
                  type="button"
                  aria-label={`${model} ${effort}`}
                  onClick={() => onSaveConfig({ ...configuredSkill, model, effort })}
                >
                  +
                </button>
              ))}
            </div>
          ))}
        </div>
        <p className="caption">
          Default: {configuredSkill.model} / {configuredSkill.effort}
        </p>
      </section>
    </div>
  );
}
