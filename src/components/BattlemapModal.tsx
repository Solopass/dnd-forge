import { useRef, useState } from 'react';
import { getQualitativeHealthLabel, sizeToGridCells } from '../engine/dm-tools';
import { CombatantNode, CombatEncounterState } from '../types/combat';
import { ModalDialog } from './ModalDialog';

interface BattlemapModalProps {
  isOpen: boolean;
  encounter: CombatEncounterState;
  playerView: boolean;
  onTogglePlayerView: () => void;
  onClose: () => void;
  onMoveToken: (combatantId: string, x: number, y: number) => void;
  onSetMapImage: (dataUrl: string | undefined) => void;
  onAddTemplate: (kind: 'sphere' | 'cone' | 'line' | 'cube', x: number, y: number, radiusFeet: number) => void;
  onClearTemplates: () => void;
  onToggleFogCells: (cellKeys: string[], mode: 'paint' | 'reveal') => void;
  onFillAllFog: () => void;
  onClearAllFog: () => void;
  onSetTerrainCell: (x: number, y: number, kind: 'wall' | 'difficult' | 'water' | null) => void;
  onClearTerrain: () => void;
  onUpdateMapSettings: (patch: Partial<NonNullable<CombatEncounterState['map']>>) => void;
  onNextTurn: () => void;
}

type MapMode =
  | 'move'
  | 'measure'
  | 'sphere'
  | 'cone'
  | 'line'
  | 'cube'
  | 'fog_paint'
  | 'fog_reveal'
  | 'wall'
  | 'difficult'
  | 'erase_terrain';

const CELL_PX = 50;

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
  playerView,
  onTogglePlayerView,
  onClose,
  onMoveToken,
  onSetMapImage,
  onAddTemplate,
  onClearTemplates,
  onToggleFogCells,
  onFillAllFog,
  onClearAllFog,
  onSetTerrainCell,
  onClearTerrain,
  onUpdateMapSettings,
  onNextTurn,
}: BattlemapModalProps) {
  const [mode, setMode] = useState<MapMode>('move');
  const [zoom, setZoom] = useState(1);
  const [showCalibrate, setShowCalibrate] = useState(false);
  const [dragPreview, setDragPreview] = useState<{ id: string; x: number; y: number } | null>(null);
  const [measureStart, setMeasureStart] = useState<{ x: number; y: number } | null>(null);
  const [measureEnd, setMeasureEnd] = useState<{ x: number; y: number } | null>(null);
  const [isPainting, setIsPainting] = useState(false);
  const lastPaintedCellRef = useRef<string>('');
  const svgRef = useRef<SVGSVGElement | null>(null);

  const cols = Math.max(8, Math.min(40, encounter.map?.cols ?? 20));
  const rows = Math.max(6, Math.min(30, encounter.map?.rows ?? 12));
  const gridOpacity = encounter.map?.gridOpacity ?? 0.25;
  const imageScale = encounter.map?.imageScale ?? 1;
  const imageOffsetX = encounter.map?.imageOffsetX ?? 0;
  const imageOffsetY = encounter.map?.imageOffsetY ?? 0;
  const fogCells = encounter.map?.fogCells ?? [];
  const fogSet = new Set(fogCells);
  const terrainCells = encounter.map?.terrainCells ?? [];
  const templates = encounter.map?.templates ?? [];

  const toGridCoords = (clientX: number, clientY: number): { gx: number; gy: number } => {
    const svg = svgRef.current;
    if (!svg) return { gx: 0, gy: 0 };
    const rect = svg.getBoundingClientRect();
    const relX = ((clientX - rect.left) / rect.width) * (cols * CELL_PX);
    const relY = ((clientY - rect.top) / rect.height) * (rows * CELL_PX);
    const gx = Math.max(0, Math.min(cols - 1, Math.floor(relX / CELL_PX)));
    const gy = Math.max(0, Math.min(rows - 1, Math.floor(relY / CELL_PX)));
    return { gx, gy };
  };

  const applyPaintAt = (gx: number, gy: number) => {
    const key = `${gx},${gy}`;
    if (lastPaintedCellRef.current === key) return;
    lastPaintedCellRef.current = key;
    if (mode === 'fog_paint') onToggleFogCells([key], 'paint');
    else if (mode === 'fog_reveal') onToggleFogCells([key], 'reveal');
    else if (mode === 'wall') onSetTerrainCell(gx, gy, 'wall');
    else if (mode === 'difficult') onSetTerrainCell(gx, gy, 'difficult');
    else if (mode === 'erase_terrain') onSetTerrainCell(gx, gy, null);
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
      return;
    }
    if (
      mode === 'fog_paint' ||
      mode === 'fog_reveal' ||
      mode === 'wall' ||
      mode === 'difficult' ||
      mode === 'erase_terrain'
    ) {
      setIsPainting(true);
      lastPaintedCellRef.current = '';
      applyPaintAt(gx, gy);
    }
  };

  const handleSvgPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const { gx, gy } = toGridCoords(e.clientX, e.clientY);
    if (dragPreview) {
      const node = encounter.combatants.find((c) => c.id === dragPreview.id);
      const span = sizeToGridCells(node?.size);
      setDragPreview({
        id: dragPreview.id,
        x: Math.max(0, Math.min(cols - span, gx)),
        y: Math.max(0, Math.min(rows - span, gy)),
      });
    } else if (mode === 'measure' && measureStart) {
      setMeasureEnd({ x: gx, y: gy });
    } else if (isPainting) {
      applyPaintAt(gx, gy);
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
    setIsPainting(false);
    lastPaintedCellRef.current = '';
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

  const measureFeet =
    measureStart && measureEnd
      ? Math.max(Math.abs(measureEnd.x - measureStart.x), Math.abs(measureEnd.y - measureStart.y)) * 5
      : 0;

  const visibleCombatants = playerView
    ? encounter.combatants.filter((c) => !c.hidden || c.kind === 'pc')
    : encounter.combatants;

  return (
    <ModalDialog
      isOpen={isOpen}
      wide
      onClose={onClose}
      title={`${encounter.name} — Tactical VTT Battlemap (${playerView ? 'Player View' : 'DM View'})`}
    >
      <div className="forge-stack">
        <div className="forge-row-between" style={{ flexWrap: 'wrap', gap: 6 }}>
          <div className="pill-row">
            {(
              [
                ['move', 'Move'],
                ['measure', 'Measure'],
                ['sphere', 'Sphere 20ft'],
                ['cone', 'Cone 15ft'],
                ['line', 'Line 30ft'],
                ['cube', 'Cube 20ft'],
                ['fog_paint', 'Fog Paint'],
                ['fog_reveal', 'Fog Reveal'],
                ['wall', 'Wall'],
                ['difficult', 'Difficult'],
                ['erase_terrain', 'Erase Terrain'],
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
            <button
              type="button"
              className={`pill ${playerView ? 'active' : ''}`}
              aria-pressed={playerView}
              onClick={onTogglePlayerView}
            >
              {playerView ? 'Player View ON' : 'Player View OFF'}
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => setZoom((z) => Math.max(0.75, Number((z - 0.25).toFixed(2))))}
            >
              Zoom -
            </button>
            <button
              type="button"
              className="btn tabular"
              onClick={() => setZoom(1)}
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => setZoom((z) => Math.min(2, Number((z + 0.25).toFixed(2))))}
            >
              Zoom +
            </button>
            <button
              type="button"
              className={`btn ${showCalibrate ? 'btn-primary' : ''}`}
              onClick={() => setShowCalibrate((v) => !v)}
            >
              Calibrate Grid
            </button>
          </div>
        </div>

        <div className="forge-row-between" style={{ flexWrap: 'wrap', gap: 6 }}>
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
            <button type="button" className="btn" onClick={onFillAllFog}>
              Fog All
            </button>
            {fogCells.length > 0 && (
              <button type="button" className="btn" onClick={onClearAllFog}>
                Clear Fog ({fogCells.length})
              </button>
            )}
            {terrainCells.length > 0 && (
              <button type="button" className="btn" onClick={onClearTerrain}>
                Clear Terrain ({terrainCells.length})
              </button>
            )}
            {templates.length > 0 && (
              <button type="button" className="btn" onClick={onClearTemplates}>
                Clear AoE ({templates.length})
              </button>
            )}
          </div>
          <button type="button" className="btn btn-primary" onClick={onNextTurn}>
            Next Turn (Rnd {encounter.round})
          </button>
        </div>

        {showCalibrate && (
          <div className="card forge-row" style={{ flexWrap: 'wrap', gap: 10 }}>
            <label className="forge-row">
              <span className="forge-label">COLS</span>
              <input
                aria-label="Map columns"
                type="number"
                min={8}
                max={40}
                className="forge-input tabular"
                style={{ width: 56 }}
                value={cols}
                onChange={(e) =>
                  onUpdateMapSettings({ cols: Math.max(8, Math.min(40, Number.parseInt(e.target.value, 10) || 20)) })
                }
              />
            </label>
            <label className="forge-row">
              <span className="forge-label">ROWS</span>
              <input
                aria-label="Map rows"
                type="number"
                min={6}
                max={30}
                className="forge-input tabular"
                style={{ width: 56 }}
                value={rows}
                onChange={(e) =>
                  onUpdateMapSettings({ rows: Math.max(6, Math.min(30, Number.parseInt(e.target.value, 10) || 12)) })
                }
              />
            </label>
            <label className="forge-row">
              <span className="forge-label">GRID OPACITY</span>
              <input
                aria-label="Grid opacity"
                type="range"
                min={0.05}
                max={0.8}
                step={0.05}
                value={gridOpacity}
                onChange={(e) => onUpdateMapSettings({ gridOpacity: Number.parseFloat(e.target.value) })}
              />
            </label>
            <label className="forge-row">
              <span className="forge-label">BG SCALE</span>
              <input
                aria-label="Background map scale"
                type="range"
                min={0.5}
                max={2}
                step={0.05}
                value={imageScale}
                onChange={(e) => onUpdateMapSettings({ imageScale: Number.parseFloat(e.target.value) })}
              />
            </label>
            <label className="forge-row">
              <span className="forge-label">OFFSET X</span>
              <input
                aria-label="Background offset X"
                type="number"
                step={10}
                className="forge-input tabular"
                style={{ width: 64 }}
                value={imageOffsetX}
                onChange={(e) => onUpdateMapSettings({ imageOffsetX: Number.parseInt(e.target.value, 10) || 0 })}
              />
            </label>
            <label className="forge-row">
              <span className="forge-label">OFFSET Y</span>
              <input
                aria-label="Background offset Y"
                type="number"
                step={10}
                className="forge-input tabular"
                style={{ width: 64 }}
                value={imageOffsetY}
                onChange={(e) => onUpdateMapSettings({ imageOffsetY: Number.parseInt(e.target.value, 10) || 0 })}
              />
            </label>
          </div>
        )}

        <div className="battlemap-scroll">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${cols * CELL_PX} ${rows * CELL_PX}`}
            className="battlemap-svg"
            style={{ width: `${zoom * 100}%`, minWidth: `${zoom * 100}%` }}
            role="img"
            aria-label="Tactical 5-foot square battlemap grid"
            onPointerDown={handleSvgPointerDown}
            onPointerMove={handleSvgPointerMove}
            onPointerUp={handleSvgPointerUp}
          >
            {encounter.map?.imageDataUrl && (
              <image
                href={encounter.map.imageDataUrl}
                x={imageOffsetX}
                y={imageOffsetY}
                width={cols * CELL_PX * imageScale}
                height={rows * CELL_PX * imageScale}
                preserveAspectRatio="xMidYMid slice"
              />
            )}

            {/* Terrain Overlay */}
            {terrainCells.map((tc) => (
              <rect
                key={`tr-${tc.x}-${tc.y}`}
                x={tc.x * CELL_PX + 1}
                y={tc.y * CELL_PX + 1}
                width={CELL_PX - 2}
                height={CELL_PX - 2}
                rx={3}
                fill={
                  tc.kind === 'wall'
                    ? 'rgba(110, 118, 129, 0.72)'
                    : tc.kind === 'difficult'
                    ? 'rgba(210, 153, 34, 0.34)'
                    : 'rgba(88, 166, 255, 0.32)'
                }
                stroke={tc.kind === 'wall' ? '#8b949e' : tc.kind === 'difficult' ? '#d29922' : '#58a6ff'}
                strokeWidth={1.5}
              />
            ))}

            {/* 5ft square grid */}
            {Array.from({ length: cols + 1 }, (_, i) => (
              <line
                key={`v-${i}`}
                x1={i * CELL_PX}
                y1={0}
                x2={i * CELL_PX}
                y2={rows * CELL_PX}
                stroke={`rgba(139, 148, 158, ${gridOpacity})`}
                strokeWidth={1}
              />
            ))}
            {Array.from({ length: rows + 1 }, (_, j) => (
              <line
                key={`h-${j}`}
                x1={0}
                y1={j * CELL_PX}
                x2={cols * CELL_PX}
                y2={j * CELL_PX}
                stroke={`rgba(139, 148, 158, ${gridOpacity})`}
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

            {/* Combatant Tokens (scaled 1x1 through 4x4 by creature size) */}
            {visibleCombatants.map((node, idx) => {
              const span = sizeToGridCells(node.size);
              const baseGx = Math.max(0, Math.min(cols - span, node.x ?? (node.kind === 'pc' ? 2 : 12 + (idx % 5))));
              const baseGy = Math.max(0, Math.min(rows - span, node.y ?? 2 + (idx % 6)));
              const gx = dragPreview?.id === node.id ? dragPreview.x : baseGx;
              const gy = dragPreview?.id === node.id ? dragPreview.y : baseGy;
              const cx = (gx + span / 2) * CELL_PX;
              const cy = (gy + span / 2) * CELL_PX;
              const r = span * CELL_PX * 0.38;
              const isActive = encounter.combatants[encounter.activeTurnIndex]?.id === node.id;
              const fill = getTokenColor(node);
              const hpPct = node.hp.max > 0 ? Math.max(0, Math.min(1, node.hp.current / node.hp.max)) : 0;
              const hideNumeric = playerView && node.kind !== 'pc';

              return (
                <g
                  key={node.id}
                  opacity={node.hidden ? 0.5 : 1}
                  style={{ cursor: mode === 'move' ? 'grab' : 'pointer' }}
                  onPointerDown={(e) => {
                    if (mode !== 'move') return;
                    e.stopPropagation();
                    setDragPreview({ id: node.id, x: baseGx, y: baseGy });
                  }}
                >
                  <title>
                    {hideNumeric
                      ? `${node.name} • ${getQualitativeHealthLabel(node.hp.current, node.hp.max)}`
                      : `${node.name} (${(node.size ?? 'medium').toUpperCase()}) • HP ${node.hp.current}/${node.hp.max} • AC ${node.ac}`}
                  </title>
                  {isActive && (
                    <circle
                      cx={cx}
                      cy={cy}
                      r={r + 4}
                      fill="none"
                      stroke="#f0f6fc"
                      strokeWidth={2.5}
                      strokeDasharray="4 2"
                    />
                  )}
                  <circle cx={cx} cy={cy} r={r} fill={fill} opacity={0.9} stroke="#0d1117" strokeWidth={2} />
                  <text
                    x={cx}
                    y={cy + 4}
                    textAnchor="middle"
                    fill="#0d1117"
                    fontSize={span > 1 ? 15 : 12}
                    fontWeight={800}
                  >
                    {getInitials(node.name)}
                    {span > 1 ? ` (${span}x)` : ''}
                  </text>
                  {!hideNumeric && (
                    <>
                      <rect x={cx - r * 0.8} y={cy + r - 4} width={r * 1.6} height={4} rx={2} fill="#0d1117" />
                      <rect
                        x={cx - r * 0.8}
                        y={cy + r - 4}
                        width={r * 1.6 * hpPct}
                        height={4}
                        rx={2}
                        fill={hpPct > 0.5 ? '#3fb950' : hpPct > 0.25 ? '#d29922' : '#f85149'}
                      />
                    </>
                  )}
                </g>
              );
            })}

            {/* Fog of War overlay */}
            {Array.from(fogSet).map((key) => {
              const [fxRaw, fyRaw] = key.split(',');
              const fx = Number.parseInt(fxRaw ?? '', 10);
              const fy = Number.parseInt(fyRaw ?? '', 10);
              if (Number.isNaN(fx) || Number.isNaN(fy)) return null;
              return (
                <rect
                  key={`fog-${key}`}
                  x={fx * CELL_PX}
                  y={fy * CELL_PX}
                  width={CELL_PX}
                  height={CELL_PX}
                  fill={playerView ? '#05070b' : 'rgba(13, 17, 23, 0.56)'}
                  stroke={playerView ? 'none' : 'rgba(139, 148, 158, 0.2)'}
                  style={{ pointerEvents: 'none' }}
                />
              );
            })}

            {/* Measurement Ruler */}
            {measureStart && measureEnd && (
              <g style={{ pointerEvents: 'none' }}>
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
          </svg>
        </div>
      </div>
    </ModalDialog>
  );
}
