import { useState } from 'react';
import { ResolvedCharacterSheet } from '../types/character';
import { AbilityKey, SkillKey } from '../types/core';
import { SKILL_ABILITY_MAP } from '../engine/rules-math';

interface SkillWheelProps {
  sheet: ResolvedCharacterSheet;
  exhaustionCheckPenalty?: number;
  onRollCheck: (label: string, modifier: number) => void;
}

const ABILITY_ORDER: AbilityKey[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

const SKILL_SHORT_LABELS: Record<SkillKey, string> = {
  athletics: 'Athl',
  acrobatics: 'Acro',
  sleight_of_hand: 'Slei',
  stealth: 'Stlth',
  arcana: 'Arc',
  history: 'Hist',
  investigation: 'Inv',
  nature: 'Nat',
  religion: 'Rel',
  animal_handling: 'Anim',
  insight: 'Ins',
  medicine: 'Med',
  perception: 'Perc',
  survival: 'Surv',
  deception: 'Dec',
  intimidation: 'Intim',
  performance: 'Perf',
  persuasion: 'Pers',
};

function formatSkillLabel(key: SkillKey): string {
  return key
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number): [number, number] {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
}

function describeRingSector(
  cx: number,
  cy: number,
  rInner: number,
  rOuter: number,
  startDeg: number,
  endDeg: number
): string {
  const [x1, y1] = polarToCartesian(cx, cy, rOuter, startDeg);
  const [x2, y2] = polarToCartesian(cx, cy, rOuter, endDeg);
  const [x3, y3] = polarToCartesian(cx, cy, rInner, endDeg);
  const [x4, y4] = polarToCartesian(cx, cy, rInner, startDeg);
  const largeArc = endDeg - startDeg > 180 ? 1 : 0;
  return [
    `M ${x1.toFixed(2)} ${y1.toFixed(2)}`,
    `A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`,
    `L ${x3.toFixed(2)} ${y3.toFixed(2)}`,
    `A ${rInner} ${rInner} 0 ${largeArc} 0 ${x4.toFixed(2)} ${y4.toFixed(2)}`,
    'Z',
  ].join(' ');
}

interface OuterWheelItem {
  id: string;
  ability: AbilityKey;
  shortLabel: string;
  fullLabel: string;
  bonus: number;
  profTier: 'none' | 'half' | 'prof' | 'exp';
}

export function SkillWheel({
  sheet,
  exhaustionCheckPenalty = 0,
  onRollCheck,
}: SkillWheelProps) {
  const [hovered, setHovered] = useState<{ title: string; subtitle: string; bonus: number } | null>(
    null
  );

  const allSkillKeys = Object.keys(SKILL_ABILITY_MAP) as SkillKey[];

  // Build grouped outer items per ability (CON gets its Save so every sector has >= 1 outer slice)
  const sectors: Array<{ ability: AbilityKey; items: OuterWheelItem[] }> = ABILITY_ORDER.map((ab) => {
    const abSkills = allSkillKeys.filter((sk) => SKILL_ABILITY_MAP[sk] === ab);
    if (abSkills.length === 0) {
      const saveMod = sheet.abilities[ab].save.final;
      const isProf = sheet.abilities[ab].save.modifiers.some((m) => m.id.startsWith('save-prof-'));
      return {
        ability: ab,
        items: [
          {
            id: `${ab}-save`,
            ability: ab,
            shortLabel: 'Save',
            fullLabel: `${ab.toUpperCase()} Save`,
            bonus: saveMod,
            profTier: isProf ? 'prof' : 'none',
          },
        ],
      };
    }
    return {
      ability: ab,
      items: abSkills.map((sk) => {
        const stat = sheet.skills[sk];
        const profMod = stat.modifiers.find((m) => m.id.startsWith('skill-prof-'));
        const profTier: OuterWheelItem['profTier'] =
          profMod?.source === 'Expertise'
            ? 'exp'
            : profMod?.source === 'Proficiency'
              ? 'prof'
              : profMod?.source === 'Half-Proficiency'
                ? 'half'
                : 'none';
        return {
          id: sk,
          ability: ab,
          shortLabel: SKILL_SHORT_LABELS[sk],
          fullLabel: formatSkillLabel(sk),
          bonus: stat.final,
          profTier,
        };
      }),
    };
  });

  const totalOuter = sectors.reduce((sum, s) => sum + s.items.length, 0);
  const stepDeg = 360 / totalOuter;
  const cx = 170;
  const cy = 170;

  let cursorDeg = 0;
  const abilityArcs: Array<{
    ability: AbilityKey;
    startDeg: number;
    endDeg: number;
    items: Array<OuterWheelItem & { startDeg: number; endDeg: number }>;
  }> = [];

  for (const sec of sectors) {
    const startDeg = cursorDeg;
    const itemsWithAngles = sec.items.map((item) => {
      const iStart = cursorDeg;
      const iEnd = cursorDeg + stepDeg;
      cursorDeg = iEnd;
      return { ...item, startDeg: iStart, endDeg: iEnd };
    });
    abilityArcs.push({
      ability: sec.ability,
      startDeg,
      endDeg: cursorDeg,
      items: itemsWithAngles,
    });
  }

  return (
    <div className="skill-wheel-wrap">
      <svg
        viewBox="0 0 340 340"
        className="skill-wheel-svg"
        role="img"
        aria-label="Ability and specialized skills wheel"
      >
        {/* Outer Ring: Specialized Skills */}
        {abilityArcs.flatMap((arc) =>
          arc.items.map((item) => {
            const midDeg = (item.startDeg + item.endDeg) / 2;
            const [lx, ly] = polarToCartesian(cx, cy, 134, midDeg);
            const [bx, by] = polarToCartesian(cx, cy, 110, midDeg);
            const sign = item.bonus >= 0 ? '+' : '';
            const isHighlighted = item.profTier === 'prof' || item.profTier === 'exp';
            const fill =
              item.profTier === 'exp'
                ? 'color-mix(in oklab, var(--accent-gold) 28%, var(--bg-elevated))'
                : item.profTier === 'prof'
                  ? 'color-mix(in oklab, var(--accent-brand) 24%, var(--bg-elevated))'
                  : 'var(--bg-base)';
            const stroke =
              item.profTier === 'exp'
                ? 'var(--accent-gold)'
                : item.profTier === 'prof'
                  ? 'var(--accent-brand)'
                  : 'var(--border-subtle)';

            return (
              <g
                key={item.id}
                className="wheel-slice"
                role="button"
                tabIndex={0}
                aria-label={`Roll ${item.fullLabel} (${item.ability.toUpperCase()}), ${
                  item.profTier === 'exp'
                    ? 'expertise, '
                    : item.profTier === 'prof'
                      ? 'proficient, '
                      : ''
                }${sign}${item.bonus}`}
                onClick={() => onRollCheck(`${item.fullLabel} Check`, item.bonus)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onRollCheck(`${item.fullLabel} Check`, item.bonus);
                  }
                }}
                onMouseEnter={() =>
                  setHovered({
                    title: item.fullLabel,
                    subtitle: `${item.ability.toUpperCase()}${
                      item.profTier === 'exp'
                        ? ' • Expertise ★★'
                        : item.profTier === 'prof'
                          ? ' • Proficient ★'
                          : ''
                    }`,
                    bonus: item.bonus,
                  })
                }
                onMouseLeave={() => setHovered(null)}
                onFocus={() =>
                  setHovered({
                    title: item.fullLabel,
                    subtitle: `${item.ability.toUpperCase()}`,
                    bonus: item.bonus,
                  })
                }
                onBlur={() => setHovered(null)}
              >
                <path
                  d={describeRingSector(cx, cy, 90, 162, item.startDeg + 0.6, item.endDeg - 0.6)}
                  fill={fill}
                  stroke={stroke}
                  strokeWidth={isHighlighted ? 1.4 : 0.9}
                />
                <text
                  x={lx}
                  y={ly}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize="8.5"
                  fontWeight={isHighlighted ? '700' : '600'}
                  fill="var(--text-primary)"
                  style={{ pointerEvents: 'none' }}
                >
                  {item.shortLabel}
                </text>
                <text
                  x={bx}
                  y={by}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize="8.5"
                  fontWeight="700"
                  fill={isHighlighted ? 'var(--accent-brand)' : 'var(--text-secondary)'}
                  style={{ pointerEvents: 'none', fontVariantNumeric: 'tabular-nums' }}
                >
                  {sign}{item.bonus}
                </text>
              </g>
            );
          })
        )}

        {/* Inner Ring: 6 Base Ability Stats */}
        {abilityArcs.map((arc) => {
          const ab = sheet.abilities[arc.ability];
          const checkMod = ab.modifier + exhaustionCheckPenalty;
          const sign = checkMod >= 0 ? '+' : '';
          const midDeg = (arc.startDeg + arc.endDeg) / 2;
          const [tx, ty] = polarToCartesian(cx, cy, 66, midDeg);
          const isSaveProf = ab.save.modifiers.some((m) => m.id.startsWith('save-prof-'));

          return (
            <g
              key={arc.ability}
              className="wheel-slice"
              role="button"
              tabIndex={0}
              aria-label={`Roll ${arc.ability.toUpperCase()} check, score ${ab.score.final}, ${sign}${checkMod}`}
              onClick={() => onRollCheck(`${arc.ability.toUpperCase()} Check`, checkMod)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onRollCheck(`${arc.ability.toUpperCase()} Check`, checkMod);
                }
              }}
              onMouseEnter={() =>
                setHovered({
                  title: `${arc.ability.toUpperCase()} (${ab.score.final})`,
                  subtitle: `Check ${sign}${checkMod} • Save ${ab.save.final >= 0 ? '+' : ''}${ab.save.final}`,
                  bonus: checkMod,
                })
              }
              onMouseLeave={() => setHovered(null)}
            >
              <path
                d={describeRingSector(cx, cy, 43, 86, arc.startDeg + 0.8, arc.endDeg - 0.8)}
                fill="var(--bg-elevated)"
                stroke={isSaveProf ? 'var(--accent-gold)' : 'var(--border-subtle)'}
                strokeWidth={isSaveProf ? 1.5 : 1}
              />
              <text
                x={tx}
                y={ty - 5}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize="9.5"
                fontWeight="800"
                fill="var(--text-primary)"
                style={{ pointerEvents: 'none' }}
              >
                {arc.ability.toUpperCase()}
              </text>
              <text
                x={tx}
                y={ty + 6}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize="9"
                fontWeight="700"
                fill="var(--accent-brand)"
                style={{ pointerEvents: 'none', fontVariantNumeric: 'tabular-nums' }}
              >
                {sign}{checkMod}
              </text>
            </g>
          );
        })}

        {/* Center Bullseye: Passives or Hovered Readout */}
        <circle
          cx={cx}
          cy={cy}
          r={40}
          fill="var(--bg-surface)"
          stroke="var(--border-subtle)"
          strokeWidth={1.2}
        />
        {hovered ? (
          <>
            <text
              x={cx}
              y={cy - 10}
              textAnchor="middle"
              fontSize="8.5"
              fontWeight="700"
              fill="var(--text-primary)"
            >
              {hovered.title.slice(0, 14)}
            </text>
            <text
              x={cx}
              y={cy + 4}
              textAnchor="middle"
              fontSize="13"
              fontWeight="800"
              fill="var(--accent-brand)"
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {hovered.bonus >= 0 ? `+${hovered.bonus}` : hovered.bonus}
            </text>
            <text
              x={cx}
              y={cy + 17}
              textAnchor="middle"
              fontSize="7"
              fill="var(--text-muted)"
            >
              Click to Roll
            </text>
          </>
        ) : (
          <>
            <text
              x={cx}
              y={cy - 13}
              textAnchor="middle"
              fontSize="7.5"
              fontWeight="700"
              letterSpacing="0.06em"
              fill="var(--text-muted)"
            >
              PASSIVES
            </text>
            <text
              x={cx}
              y={cy + 1}
              textAnchor="middle"
              fontSize="10"
              fontWeight="800"
              fill="var(--text-primary)"
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              PP {sheet.passivePerception}
            </text>
            <text
              x={cx}
              y={cy + 14}
              textAnchor="middle"
              fontSize="8"
              fill="var(--text-secondary)"
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              PI {sheet.passiveInvestigation} • PIn {sheet.passiveInsight}
            </text>
          </>
        )}
      </svg>

      <div className="skill-wheel-caption">
        {hovered ? (
          <span>
            <strong>{hovered.title}</strong> ({hovered.subtitle}) — Click to roll{' '}
            <span className="tabular">{hovered.bonus >= 0 ? `+${hovered.bonus}` : hovered.bonus}</span>
          </span>
        ) : (
          <span className="forge-muted">
            Center: Base Stats • Outer Ring: Specialized Skills (click any slice to roll)
          </span>
        )}
      </div>
    </div>
  );
}
