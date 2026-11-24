import { useRef, useState } from 'react';
import { CombatantNode, CombatEncounterState } from '../types/combat';
import { ModalDialog } from './ModalDialog';

interface BattlemapModalProps {
  isOpen: boolean;
  encounter: CombatEncounterState;
  onClose: () => void;
  onMoveToken: (combatantId: string, x: number, y: number) => void;
  onSetMapImage: (dataUrl: string | undefined) => void;
  onAddTemplate: (kind: 'sphere' | 'cone' | 'line' | 'cube', x: number, y: number, radiusFeet: number) => void;
  onClearTemplates: () => void;
  onNextTurn: () => void;
}

type MapMode = 'move' | 'measure' | 'sphere' | 'cone' | 'line' | 'cube';

const CELL_PX = 50;
const COLS = 20;
const ROWS = 12;

function getTokenColor(node: CombatantNode): string {
  if (node.tokenColor) return node.tokenColor;
  if (node.kind === 'pc') return '#58a6ff';
  if (node.kind === 'summon') return '#bc8cff';
  if (node.kind === 'npc') return '#d29922';
  return '#f85149';
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return `${parts[0]?.[0] ?? ''}${parts[1]?.[0] ?? ''}`.toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

export function BattlemapModal({
  isOpen,
  encounter,
  onClose,
  onMoveToken,
  onSetMapImage,
  onAddTemplate,
  onClearTemplates,
  onNextTurn,
}: BattlemapModalProps) {
  const [mode, setMode] = useState<MapMode>('move');
  const [dragPreview, setDragPreview] = useState<{ id: string; x: number; y: number } | null>(null);
  const [measureStart, setMeasureStart] = useState<{ x: number; y: number } | null>(null);
  const [measureEnd, setMeasureEnd] = useState<{ x: number; y: number } | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const toGridCoords = (clientX: number, clientY: number): { gx: number; gy: number } => {
    const svg = svgRef.current;
    if (!svg) return { gx: 0, gy: 0 };
    const rect = svg.getBoundingClientRect();
    const relX = ((clientX - rect.left) / rect.width) * (COLS * CELL_PX);
    const relY = ((clientY - rect.top) / rect.height) * (ROWS * CELL_PX);
    const gx = Math.max(0, Math.min(COLS - 1, Math.floor(relX / CELL_PX)));
    const gy = Math.max(0, Math.min(ROWS - 1, Math.floor(relY / CELL_PX)));
    return { gx, gy };
  };

  const handleSvgPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    const { gx, gy } = toGridCoords(e.clientX, e.clientY);
    if (mode === 'measure') {
      setMeasureStart({ x: gx, y: gy });
      setMeasureEnd({ x: gx, y: gy });
      return;
    }
    if (mode === 'sphere' || mode === 'cone' || mode === 'line' || mode === 'cube') {
      const radius = mode === 'cone' ? 15 : mode === 'line' ? 30 : 20;
      onAddTemplate(mode, gx, gy, radius);
    }
  };

  const handleSvgPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const { gx, gy } = toGridCoords(e.clientX, e.clientY);
    if (dragPreview) {
      setDragPreview({ id: dragPreview.id, x: gx, y: gy });
    } else if (mode === 'measure' && measureStart) {
      setMeasureEnd({ x: gx, y: gy });
    }
  };

  const handleSvgPointerUp = () => {
    if (dragPreview) {
      onMoveToken(dragPreview.id, dragPreview.x, dragPreview.y);
      setDragPreview(null);
    }
    if (mode === 'measure') {
      setMeasureStart(null);
      setMeasureEnd(null);
    }
  };

  const handleMapUpload = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        onSetMapImage(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const templates = encounter.map?.templates ?? [];
  const measureFeet =
    measureStart && measureEnd
      ? Math.max(Math.abs(measureEnd.x - measureStart.x), Math.abs(measureEnd.y - measureStart.y)) * 5
      : 0;

  return (
    <ModalDialog
      isOpen={isOpen}
      wide
      onClose={onClose}
      title={`${encounter.name} — 2D Tactical Battlemap (5ft Grid)`}
    >
      <div className="forge-stack">
        <div className="forge-row-between" style={{ flexWrap: 'wrap' }}>
          <div className="pill-row">
            {(
              [
                ['move', 'Move Tokens'],
                ['measure', 'Measure (5ft)'],
                ['sphere', 'Sphere 20ft'],
                ['cone', 'Cone 15ft'],
                ['line', 'Line 30ft'],
                ['cube', 'Cube 20ft'],
              ] as const
            ).map(([m, label]) => (
              <button
                key={m}
                type="button"
                className={`pill ${mode === m ? 'active' : ''}`}
                onClick={() => setMode(m)}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="forge-row" style={{ flexWrap: 'wrap' }}>
            <label className="btn" style={{ cursor: 'pointer' }}>
              Upload Map
              <input
                type="file"
                accept="image/*"
                className="visually-hidden"
                onChange={(e) => handleMapUpload(e.target.files?.[0])}
              />
            </label>
            {encounter.map?.imageDataUrl && (
              <button type="button" className="btn" onClick={() => onSetMapImage(undefined)}>
                Clear Map
              </button>
            )}
            {templates.length > 0 && (
              <button type="button" className="btn" onClick={onClearTemplates}>
                Clear AoE ({templates.length})
              </button>
            )}
            <button type="button" className="btn btn-primary" onClick={onNextTurn}>
              Next Turn (Rnd {encounter.round})
            </button>
          </div>
        </div>

        <svg
          ref={svgRef}
          viewBox={`0 0 ${COLS * CELL_PX} ${ROWS * CELL_PX}`}
          className="battlemap-svg"
          role="img"
          aria-label="Tactical 5-foot square battlemap grid"
          onPointerDown={handleSvgPointerDown}
          onPointerMove={handleSvgPointerMove}
          onPointerUp={handleSvgPointerUp}
        >
          {encounter.map?.imageDataUrl && (
            <image
              href={encounter.map.imageDataUrl}
              x={0}
              y={0}
              width={COLS * CELL_PX}
              height={ROWS * CELL_PX}
              preserveAspectRatio="xMidYMid slice"
            />
          )}

          {/* 5ft square grid */}
          {Array.from({ length: COLS + 1 }, (_, i) => (
            <line
              key={`v-${i}`}
              x1={i * CELL_PX}
              y1={0}
              x2={i * CELL_PX}
              y2={ROWS * CELL_PX}
              stroke="rgba(139, 148, 158, 0.25)"
              strokeWidth={1}
            />
          ))}
          {Array.from({ length: ROWS + 1 }, (_, j) => (
            <line
              key={`h-${j}`}
              x1={0}
              y1={j * CELL_PX}
              x2={COLS * CELL_PX}
              y2={j * CELL_PX}
              stroke="rgba(139, 148, 158, 0.25)"
              strokeWidth={1}
            />
          ))}

          {/* AoE Templates */}
          {templates.map((tpl) => {
            const cx = tpl.x * CELL_PX + CELL_PX / 2;
            const cy = tpl.y * CELL_PX + CELL_PX / 2;
            const pxSize = (tpl.radiusFeet / 5) * CELL_PX;
            if (tpl.kind === 'sphere') {
              return (
                <circle
                  key={tpl.id}
                  cx={cx}
                  cy={cy}
                  r={pxSize}
                  fill={tpl.color}
                  stroke="#f85149"
                  strokeWidth={2}
                />
              );
            }
            if (tpl.kind === 'cone') {
              return (
                <polygon
                  key={tpl.id}
                  points={`${cx},${cy} ${cx + pxSize},${cy - pxSize * 0.55} ${cx + pxSize},${cy + pxSize * 0.55}`}
                  fill={tpl.color}
                  stroke="#d29922"
                  strokeWidth={2}
                />
              );
            }
            if (tpl.kind === 'line') {
              return (
                <rect
                  key={tpl.id}
                  x={cx}
                  y={cy - CELL_PX * 0.4}
                  width={pxSize}
                  height={CELL_PX * 0.8}
                  fill={tpl.color}
                  stroke="#58a6ff"
                  strokeWidth={2}
                />
              );
            }
            return (
              <rect
                key={tpl.id}
                x={tpl.x * CELL_PX}
                y={tpl.y * CELL_PX}
                width={pxSize}
                height={pxSize}
                fill={tpl.color}
                stroke="#bc8cff"
                strokeWidth={2}
              />
            );
          })}

          {/* Measurement Ruler */}
          {measureStart && measureEnd && (
            <g>
              <line
                x1={measureStart.x * CELL_PX + CELL_PX / 2}
                y1={measureStart.y * CELL_PX + CELL_PX / 2}
                x2={measureEnd.x * CELL_PX + CELL_PX / 2}
                y2={measureEnd.y * CELL_PX + CELL_PX / 2}
                stroke="#58a6ff"
                strokeWidth={3}
                strokeDasharray="6 4"
              />
              <rect
                x={measureEnd.x * CELL_PX + 6}
                y={Math.max(4, measureEnd.y * CELL_PX - 14)}
                width={48}
                height={20}
                rx={4}
                fill="#0d1117"
                stroke="#58a6ff"
              />
              <text
                x={measureEnd.x * CELL_PX + 30}
                y={Math.max(18, measureEnd.y * CELL_PX)}
                textAnchor="middle"
                fill="#f0f6fc"
                fontSize={11}
                fontWeight={700}
              >
                {measureFeet} ft
              </text>
            </g>
          )}

          {/* Combatant Tokens */}
          {encounter.combatants.map((node, idx) => {
            const baseGx = node.x ?? (node.kind === 'pc' ? 2 : 12 + (idx % 5));
            const baseGy = node.y ?? 2 + (idx % 6);
            const gx = dragPreview?.id === node.id ? dragPreview.x : baseGx;
            const gy = dragPreview?.id === node.id ? dragPreview.y : baseGy;
            const cx = gx * CELL_PX + CELL_PX / 2;
            const cy = gy * CELL_PX + CELL_PX / 2;
            const isActive = idx === encounter.activeTurnIndex;
            const fill = getTokenColor(node);
            const hpPct = node.hp.max > 0 ? Math.max(0, Math.min(1, node.hp.current / node.hp.max)) : 0;

            return (
              <g
                key={node.id}
                style={{ cursor: mode === 'move' ? 'grab' : 'pointer' }}
                onPointerDown={(e) => {
                  if (mode !== 'move') return;
                  e.stopPropagation();
                  setDragPreview({ id: node.id, x: baseGx, y: baseGy });
                }}
              >
                <title>
                  {`${node.name} • HP ${node.hp.current}/${node.hp.max} • AC ${node.ac}${node.conditions.length ? ` • ${node.conditions.join(', ')}` : ''}`}
                </title>
                {isActive && (
                  <circle
                    cx={cx}
                    cy={cy}
                    r={22}
                    fill="none"
                    stroke="#f0f6fc"
                    strokeWidth={2.5}
                    strokeDasharray="4 2"
                  />
                )}
                <circle cx={cx} cy={cy} r={18} fill={fill} opacity={0.9} stroke="#0d1117" strokeWidth={2} />
                <text
                  x={cx}
                  y={cy + 4}
                  textAnchor="middle"
                  fill="#0d1117"
                  fontSize={12}
                  fontWeight={800}
                >
                  {getInitials(node.name)}
                </text>
                {/* HP progress bar below token */}
                <rect x={cx - 16} y={cy + 15} width={32} height={4} rx={2} fill="#0d1117" />
                <rect
                  x={cx - 16}
                  y={cy + 15}
                  width={32 * hpPct}
                  height={4}
                  rx={2}
                  fill={hpPct > 0.5 ? '#3fb950' : hpPct > 0.25 ? '#d29922' : '#f85149'}
                />
              </g>
            );
          })}
        </svg>
      </div>
    </ModalDialog>
  );
}
