import {
  detectRulesetPreset,
  HouseRulesConfig,
  RULE_DEFINITIONS,
  RULESET_2014_DEFAULTS,
  RULESET_2024_DEFAULTS,
} from '../engine/ruleset-config';
import { ModalDialog } from './ModalDialog';

interface RulesetModalProps {
  isOpen: boolean;
  onClose: () => void;
  houseRules: HouseRulesConfig;
  onUpdateHouseRules: (next: HouseRulesConfig) => void;
}

export function RulesetModal({
  isOpen,
  onClose,
  houseRules,
  onUpdateHouseRules,
}: RulesetModalProps) {
  const preset = detectRulesetPreset(houseRules);

  return (
    <ModalDialog isOpen={isOpen} onClose={onClose} title="Ruleset Differences & Custom House Rules" wide>
      <div className="forge-stack">
        <div className="subpanel forge-row-between" style={{ padding: '10px 12px', flexWrap: 'wrap', gap: 8 }}>
          <div>
            <div className="forge-row gap-3">
              <span className="forge-section-label">ACTIVE RULESET PROFILE</span>
              <span
                className="badge"
                style={{
                  color: preset === 'custom' ? 'var(--accent-amber)' : 'var(--accent-blue)',
                  borderColor: preset === 'custom' ? 'rgba(245,158,11,0.5)' : 'rgba(59,130,246,0.5)',
                }}
              >
                {preset === '2014' ? '5e (2014 Classic)' : preset === '2024' ? '5e (2024 Revised)' : 'Custom Mix'}
              </span>
            </div>
            <div className="forge-muted" style={{ fontSize: 12, marginTop: 4 }}>
              All custom items, monsters, spells, and characters work seamlessly regardless of which rules you toggle below.
            </div>
          </div>

          <div className="pill-row">
            <button
              type="button"
              className={`pill ${preset === '2014' ? 'active' : ''}`}
              onClick={() => onUpdateHouseRules({ ...RULESET_2014_DEFAULTS })}
            >
              Use 2014 Classic
            </button>
            <button
              type="button"
              className={`pill ${preset === '2024' ? 'active' : ''}`}
              onClick={() => onUpdateHouseRules({ ...RULESET_2024_DEFAULTS })}
            >
              Use 2024 Revised
            </button>
          </div>
        </div>

        <div className="forge-stack">
          {RULE_DEFINITIONS.map((rule) => {
            const currentVal = houseRules[rule.key];
            return (
              <div key={rule.key} className="card forge-stack">
                <div className="forge-row-between wrap gap-2">
                  <strong>{rule.title}</strong>
                  <div className="pill-row">
                    {rule.options.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        className={`pill ${currentVal === opt.value ? 'active' : ''}`}
                        onClick={() =>
                          onUpdateHouseRules({
                            ...houseRules,
                            [rule.key]: opt.value,
                          })
                        }
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="forge-muted text-md">
                  {rule.summary2014vs2024}
                </div>
                <div className="forge-muted" style={{ fontSize: 11, color: 'var(--text-primary)' }}>
                  Active: {rule.options.find((o) => o.value === currentVal)?.detail}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </ModalDialog>
  );
}
