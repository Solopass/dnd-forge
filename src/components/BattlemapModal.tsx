import { useEffect, useMemo, useRef, useState } from 'react';
import { getQualitativeHealthLabel, sizeToGridCells } from '../engine/dm-tools';
import { BUILTIN_MAP_PRESETS } from '../engine/map-presets';
import { computeVisibleCells } from '../engine/vtt-vision';
import { EyeIcon } from './Icons';
import {
  BattlemapScene,
  CombatantNode,
  CombatEncounterState,
  MapPingEvent,
  MapSketchStroke,
} from '../types/combat';
import { ModalDialog } from './ModalDialog';

interface BattlemapModalProps {
  isOpen: boolean;
  embedded?: boolean;
  embeddedFull?: boolean;
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
  scenes?: BattlemapScene[];
  onSaveScene?: (name: string) => void;
  onLoadScene?: (sceneId: string) => void;
  onDeleteScene?: (sceneId: string) => void;
  onAddSketchStroke?: (stroke: MapSketchStroke) => void;
  onClearSketches?: () => void;
  activePings?: MapPingEvent[];
  onPing?: (x: number, y: number) => void;
  selectedTargetIds?: string[];
  onToggleTarget?: (combatantId: string) => void;
  onSetTokenPortrait?: (combatantId: string, url: string | undefined) => void;
  onSetTokenVision?: (combatantId: string, feet: number) => void;
  onAdjustTokenHp?: (combatantId: string, delta: number) => void;
  onToggleTokenCondition?: (combatantId: string, condition: string) => void;
  onInspectToken?: (combatantId: string) => void;
  onOpenPopOutPlayer?: () => void;
  ownedCharacterId?: string;
}

type MapMode =
  | 'move'
  | 'target'
  | 'measure'
  | 'ping'
  | 'sketch'
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
const SKETCH_COLORS = ['#f85149', '#58a6ff', '#3fb950', '#f59e0b', '#f0f6fc'] as const;

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
  embedded = false,
  embeddedFull = false,
  encounter,
  playerView,
  ownedCharacterId,
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
  scenes = [],
  onSaveScene,
  onLoadScene,
  onDeleteScene,
  onAddSketchStroke,
  onClearSketches,
  activePings = [],
  onPing,
  selectedTargetIds = [],
  onToggleTarget,
  onSetTokenPortrait,
  onSetTokenVision,
  onAdjustTokenHp,
  onToggleTokenCondition,
  onInspectToken,
  onOpenPopOutPlayer,
}: BattlemapModalProps) {
  const [mode, setMode] = useState<MapMode>('move');
  const [zoom, setZoom] = useState(1);
  const [showCalibrate, setShowCalibrate] = useState(false);
  const [selectedTokenId, setSelectedTokenId] = useState<string | null>(null);
  const [sceneNameInput, setSceneNameInput] = useState('');
  const [selectedSceneId, setSelectedSceneId] = useState('');
  const [sketchColor, setSketchColor] = useState<string>(SKETCH_COLORS[0]);
  const [activeStroke, setActiveStroke] = useState<MapSketchStroke | null>(null);
  const [dragPreview, setDragPreview] = useState<{ id: string; x: number; y: number; origX: number; origY: number } | null>(null);
  const [measureStart, setMeasureStart] = useState<{ x: number; y: number } | null>(null);
  const [measureEnd, setMeasureEnd] = useState<{ x: number; y: number } | null>(null);
  const [isPainting, setIsPainting] = useState(false);
  const [hoverCell, setHoverCell] = useState<{ x: number; y: number } | null>(null);
  const lastPaintedCellRef = useRef<string>('');
  const svgRef = useRef<SVGSVGElement | null>(null);

  const cols = Math.max(8, Math.min(40, encounter.map?.cols ?? 20));
  const rows = Math.max(6, Math.min(30, encounter.map?.rows ?? 12));
  const gridFeet = encounter.map?.gridFeet ?? 5;

  useEffect(() => {
    if (!isOpen || embedded || !selectedTokenId || mode !== 'move') return;
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      let dx = 0;
      let dy = 0;
      if (e.key === 'ArrowLeft') dx = -1;
      else if (e.key === 'ArrowRight') dx = 1;
      else if (e.key === 'ArrowUp') dy = -1;
      else if (e.key === 'ArrowDown') dy = 1;
      if (dx === 0 && dy === 0) return;

      const idx = encounter.combatants.findIndex((c) => c.id === selectedTokenId);
      const node = idx >= 0 ? encounter.combatants[idx] : undefined;
      if (!node) return;
      e.preventDefault();
      const span = sizeToGridCells(node.size);
      const curX = node.x ?? (node.kind === 'pc' ? 2 : 12 + (idx % 5));
      const curY = node.y ?? 2 + (idx % 6);
      const nx = Math.max(0, Math.min(cols - span, curX + dx));
      const ny = Math.max(0, Math.min(rows - span, curY + dy));
      if (nx !== curX || ny !== curY) onMoveToken(node.id, nx, ny);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, embedded, selectedTokenId, mode, encounter.combatants, cols, rows, onMoveToken]);
  const gridOpacity = encounter.map?.gridOpacity ?? 0.25;
  const imageScale = encounter.map?.imageScale ?? 1;
  const imageOffsetX = encounter.map?.imageOffsetX ?? 0;
  const imageOffsetY = encounter.map?.imageOffsetY ?? 0;
  const dynamicVision = Boolean(encounter.map?.dynamicVision);
  const autoRevealFog = Boolean(encounter.map?.autoRevealFog);
  const fogCells = encounter.map?.fogCells ?? [];
  const fogSet = new Set(fogCells);
  const terrainCells = encounter.map?.terrainCells ?? [];
  const templates = encounter.map?.templates ?? [];
  const sketches = encounter.map?.sketches ?? [];
  const targetSet = new Set(selectedTargetIds);

  const visibleCells = useMemo(() => {
    if (!dynamicVision) return null;
    const hasViewer = encounter.combatants.some(
      (c) => (c.kind === 'pc' || c.kind === 'summon') && !c.hidden && c.hp.current > 0
    );
    if (!hasViewer) return null;
    return computeVisibleCells(encounter.combatants, cols, rows, gridFeet, terrainCells);
  }, [dynamicVision, encounter.combatants, cols, rows, gridFeet, terrainCells]);

  const toSvgCoords = (clientX: number, clientY: number): { sx: number; sy: number } => {
    const svg = svgRef.current;
    if (!svg) return { sx: 0, sy: 0 };
    const rect = svg.getBoundingClientRect();
    const sx = Math.max(0, Math.min(cols * CELL_PX, ((clientX - rect.left) / rect.width) * (cols * CELL_PX)));
    const sy = Math.max(0, Math.min(rows * CELL_PX, ((clientY - rect.top) / rect.height) * (rows * CELL_PX)));
    return { sx, sy };
  };

  const toGridCoords = (clientX: number, clientY: number): { gx: number; gy: number } => {
    const { sx, sy } = toSvgCoords(clientX, clientY);
    const gx = Math.max(0, Math.min(cols - 1, Math.floor(sx / CELL_PX)));
    const gy = Math.max(0, Math.min(rows - 1, Math.floor(sy / CELL_PX)));
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
    if (embedded) return;
    const { sx, sy } = toSvgCoords(e.clientX, e.clientY);
    const { gx, gy } = toGridCoords(e.clientX, e.clientY);

    if (mode === 'ping') {
      onPing?.(gx, gy);
      return;
    }
    if (mode === 'sketch') {
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // ignore synthetic event capture errors
      }
      setActiveStroke({
        id: `sk-${Date.now().toString(36)}`,
        color: sketchColor,
        width: 3,
        points: [{ x: Math.round(sx), y: Math.round(sy) }],
      });
      return;
    }
    if (mode === 'measure') {
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // ignore synthetic event capture errors
      }
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
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // ignore synthetic event capture errors
      }
      setIsPainting(true);
      lastPaintedCellRef.current = '';
      applyPaintAt(gx, gy);
    }
  };

  const handleSvgPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (embedded) return;
    const { sx, sy } = toSvgCoords(e.clientX, e.clientY);
    const { gx, gy } = toGridCoords(e.clientX, e.clientY);

    if (mode === 'sphere' || mode === 'cone' || mode === 'line' || mode === 'cube') {
      setHoverCell({ x: gx, y: gy });
    } else if (hoverCell) {
      setHoverCell(null);
    }

    if (dragPreview) {
      const node = encounter.combatants.find((c) => c.id === dragPreview.id);
      const span = sizeToGridCells(node?.size);
      setDragPreview({
        ...dragPreview,
        x: Math.max(0, Math.min(cols - span, gx)),
        y: Math.max(0, Math.min(rows - span, gy)),
      });
    } else if (activeStroke) {
      setActiveStroke((prev) =>
        prev
          ? { ...prev, points: [...prev.points, { x: Math.round(sx), y: Math.round(sy) }] }
          : null
      );
    } else if (mode === 'measure' && measureStart) {
      setMeasureEnd({ x: gx, y: gy });
    } else if (isPainting) {
      applyPaintAt(gx, gy);
    }
  };

  const handleSvgPointerUp = () => {
    if (embedded) return;
    if (dragPreview) {
      if (dragPreview.x !== dragPreview.origX || dragPreview.y !== dragPreview.origY) {
        onMoveToken(dragPreview.id, dragPreview.x, dragPreview.y);
      }
      setDragPreview(null);
    }
    if (activeStroke) {
      if (activeStroke.points.length >= 2) {
        onAddSketchStroke?.(activeStroke);
      }
      setActiveStroke(null);
    }
    if (mode === 'measure') {
      setMeasureStart(null);
      setMeasureEnd(null);
    }
    setIsPainting(false);
    lastPaintedCellRef.current = '';
  };

  const handleFileDataUrl = (file: File | undefined, cb: (url: string) => void) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') cb(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const measureFeet =
    measureStart && measureEnd
      ? Math.max(Math.abs(measureEnd.x - measureStart.x), Math.abs(measureEnd.y - measureStart.y)) * gridFeet
      : 0;

  const visibleCombatants = encounter.combatants.filter((c, idx) => {
    if (!playerView) return true;
    if (c.hidden && c.kind !== 'pc') return false;
    if (visibleCells && c.kind !== 'pc' && c.kind !== 'summon') {
      const span = sizeToGridCells(c.size);
      const bx = Math.max(0, Math.min(cols - span, c.x ?? (12 + (idx % 5))));
      const by = Math.max(0, Math.min(rows - span, c.y ?? (2 + (idx % 6))));
      let anyVisible = false;
      for (let dy = 0; dy < span; dy++) {
        for (let dx = 0; dx < span; dx++) {
          if (visibleCells.has(`${bx + dx},${by + dy}`)) anyVisible = true;
        }
      }
      return anyVisible;
    }
    return true;
  });

  const selectedToken = selectedTokenId
    ? encounter.combatants.find((c) => c.id === selectedTokenId) ?? null
    : null;

  const svgGrid = (
    <div className="battlemap-scroll" style={{ maxHeight: embedded ? 'calc(100vh - 110px)' : '62vh' }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${cols * CELL_PX} ${rows * CELL_PX}`}
        style={{
          width: `${Math.round(zoom * 100)}%`,
          minWidth: `${Math.round(cols * 32 * zoom)}px`,
          display: 'block',
          background: '#0b0e14',
          userSelect: 'none',
          touchAction: 'none',
        }}
        onPointerDown={handleSvgPointerDown}
        onPointerMove={handleSvgPointerMove}
        onPointerUp={handleSvgPointerUp}
        onPointerLeave={() => {
          setHoverCell(null);
          handleSvgPointerUp();
        }}
      >
        <defs>
          {visibleCombatants.map((node, idx) => {
            const span = sizeToGridCells(node.size);
            const baseGx = Math.max(0, Math.min(cols - span, node.x ?? (node.kind === 'pc' ? 2 : 12 + (idx % 5))));
            const baseGy = Math.max(0, Math.min(rows - span, node.y ?? 2 + (idx % 6)));
            const gx = dragPreview?.id === node.id ? dragPreview.x : baseGx;
            const gy = dragPreview?.id === node.id ? dragPreview.y : baseGy;
            const cx = (gx + span / 2) * CELL_PX;
            const cy = (gy + span / 2) * CELL_PX;
            const r = span * CELL_PX * 0.38;
            return (
              <clipPath key={`clip-${node.id}`} id={`token-clip-${node.id}`}>
                <circle cx={cx} cy={cy} r={r} />
              </clipPath>
            );
          })}
        </defs>

        {encounter.map?.imageDataUrl && (
          <image
            href={encounter.map.imageDataUrl}
            x={imageOffsetX}
            y={imageOffsetY}
            width={cols * CELL_PX * imageScale}
            height={rows * CELL_PX * imageScale}
            preserveAspectRatio="none"
          />
        )}

        {/* Terrain markers */}
        {terrainCells.map((cell) => {
          const fill =
            cell.kind === 'wall'
              ? 'rgba(139, 148, 158, 0.72)'
              : cell.kind === 'difficult'
                ? 'rgba(210, 153, 34, 0.35)'
                : 'rgba(88, 166, 255, 0.35)';
          return (
            <g key={`ter-${cell.x}-${cell.y}`} style={{ pointerEvents: 'none' }}>
              <rect
                x={cell.x * CELL_PX + 1}
                y={cell.y * CELL_PX + 1}
                width={CELL_PX - 2}
                height={CELL_PX - 2}
                rx={3}
                fill={fill}
                stroke={cell.kind === 'wall' ? '#8b949e' : '#d29922'}
                strokeWidth={cell.kind === 'wall' ? 1.5 : 1}
                strokeDasharray={cell.kind === 'difficult' ? '4 2' : undefined}
              />
            </g>
          );
        })}

        {/* Grid lines */}
        {Array.from({ length: cols + 1 }).map((_, i) => (
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
        {Array.from({ length: rows + 1 }).map((_, j) => (
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
          const pxSize = (tpl.radiusFeet / gridFeet) * CELL_PX;
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

        {/* AoE Ghost Hover Preview */}
        {hoverCell && (mode === 'sphere' || mode === 'cone' || mode === 'line' || mode === 'cube') && (() => {
          const radiusFeet = mode === 'cone' ? 15 : mode === 'line' ? 30 : 20;
          const cx = hoverCell.x * CELL_PX + CELL_PX / 2;
          const cy = hoverCell.y * CELL_PX + CELL_PX / 2;
          const pxSize = (radiusFeet / gridFeet) * CELL_PX;
          if (mode === 'sphere') {
            return <circle cx={cx} cy={cy} r={pxSize} fill="rgba(248, 81, 73, 0.14)" stroke="#f85149" strokeWidth={1.5} strokeDasharray="5 4" style={{ pointerEvents: 'none' }} />;
          }
          if (mode === 'cone') {
            return <polygon points={`${cx},${cy} ${cx + pxSize},${cy - pxSize * 0.55} ${cx + pxSize},${cy + pxSize * 0.55}`} fill="rgba(210, 153, 34, 0.14)" stroke="#d29922" strokeWidth={1.5} strokeDasharray="5 4" style={{ pointerEvents: 'none' }} />;
          }
          if (mode === 'line') {
            return <rect x={cx} y={cy - CELL_PX * 0.4} width={pxSize} height={CELL_PX * 0.8} fill="rgba(88, 166, 255, 0.14)" stroke="#58a6ff" strokeWidth={1.5} strokeDasharray="5 4" style={{ pointerEvents: 'none' }} />;
          }
          return <rect x={hoverCell.x * CELL_PX} y={hoverCell.y * CELL_PX} width={pxSize} height={pxSize} fill="rgba(188, 140, 255, 0.14)" stroke="#bc8cff" strokeWidth={1.5} strokeDasharray="5 4" style={{ pointerEvents: 'none' }} />;
        })()}

        {/* Freehand Sketches */}
        {[...sketches, ...(activeStroke ? [activeStroke] : [])].map((stroke) => (
          <polyline
            key={stroke.id}
            fill="none"
            stroke={stroke.color}
            strokeWidth={stroke.width}
            strokeLinecap="round"
            strokeLinejoin="round"
            points={stroke.points.map((p) => `${p.x},${p.y}`).join(' ')}
            style={{ pointerEvents: 'none' }}
          />
        ))}

        {/* Combatant Tokens */}
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
          const isTargeted = targetSet.has(node.id);
          const isSelected = selectedTokenId === node.id;
          const fill = getTokenColor(node);
          const hpPct = node.hp.max > 0 ? Math.max(0, Math.min(1, node.hp.current / node.hp.max)) : 0;
          const hideNumeric = playerView && node.kind !== 'pc';

          return (
            <g
              key={node.id}
              opacity={node.hidden ? 0.5 : 1}
              style={{
                cursor:
                  embedded || mode !== 'move'
                    ? embedded
                      ? 'default'
                      : 'pointer'
                    : !playerView || node.id === ownedCharacterId
                      ? 'grab'
                      : 'not-allowed',
              }}
              onPointerDown={(e) => {
                if (embedded) return;
                if (mode === 'target') {
                  e.stopPropagation();
                  onToggleTarget?.(node.id);
                  setSelectedTokenId(node.id);
                  return;
                }
                if (mode === 'move') {
                  if (playerView && node.id !== ownedCharacterId) return;
                  e.stopPropagation();
                  setSelectedTokenId(node.id);
                  setDragPreview({ id: node.id, x: baseGx, y: baseGy, origX: baseGx, origY: baseGy });
                }
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
              {isTargeted && (
                <circle
                  cx={cx}
                  cy={cy}
                  r={r + 7}
                  fill="none"
                  stroke="#f85149"
                  strokeWidth={2}
                />
              )}
              {isSelected && !isTargeted && !embedded && (
                <circle
                  cx={cx}
                  cy={cy}
                  r={r + 6}
                  fill="none"
                  stroke="#58a6ff"
                  strokeWidth={1.5}
                />
              )}
              <circle cx={cx} cy={cy} r={r} fill={fill} opacity={0.92} stroke="#0d1117" strokeWidth={2} />
              {node.portraitUrl ? (
                <image
                  href={node.portraitUrl}
                  x={cx - r}
                  y={cy - r}
                  width={r * 2}
                  height={r * 2}
                  preserveAspectRatio="xMidYMid slice"
                  clipPath={`url(#token-clip-${node.id})`}
                />
              ) : (
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
              )}
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

        {/* Dynamic Vision Line-of-Sight Darkness */}
        {visibleCells &&
          Array.from({ length: rows }).map((_, y) =>
            Array.from({ length: cols }).map((__, x) => {
              const key = `${x},${y}`;
              if (visibleCells.has(key) || fogSet.has(key)) return null;
              return (
                <rect
                  key={`los-${key}`}
                  x={x * CELL_PX}
                  y={y * CELL_PX}
                  width={CELL_PX}
                  height={CELL_PX}
                  fill={playerView ? 'rgba(4, 7, 12, 0.9)' : 'rgba(4, 7, 12, 0.36)'}
                  style={{ pointerEvents: 'none' }}
                />
              );
            })
          )}

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

        {/* Live Map Pings */}
        {activePings.map((ping) => (
          <g key={ping.id} style={{ pointerEvents: 'none' }}>
            <circle
              cx={ping.x * CELL_PX + CELL_PX / 2}
              cy={ping.y * CELL_PX + CELL_PX / 2}
              r={CELL_PX * 0.55}
              fill="none"
              stroke={ping.color}
              strokeWidth={3}
            />
            <circle
              cx={ping.x * CELL_PX + CELL_PX / 2}
              cy={ping.y * CELL_PX + CELL_PX / 2}
              r={CELL_PX * 0.9}
              fill="none"
              stroke={ping.color}
              strokeWidth={1.5}
              strokeDasharray="4 3"
              opacity={0.75}
            />
          </g>
        ))}

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
  );

  if (embedded) {
    return svgGrid;
  }

  const fullVttContent = (
    <div className="forge-stack">
      <div className="forge-row-between" style={{ flexWrap: 'wrap', gap: 6 }}>
        <div className="toolbar-group">
          {(
            [
              ['move', 'Move'],
              ['target', 'Target'],
              ['measure', 'Measure'],
              ['ping', 'Ping'],
              ['sketch', 'Sketch'],
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

        <div className="toolbar-group">
          <select
            aria-label="AoE template tool"
            className="forge-input"
            value={mode === 'sphere' || mode === 'cone' || mode === 'line' || mode === 'cube' ? mode : ''}
            onChange={(e) => {
              const v = e.target.value as MapMode | '';
              if (v) setMode(v);
            }}
            style={{ padding: '3px 6px', fontSize: 11 }}
          >
            <option value="">AoE Template...</option>
            <option value="sphere">Sphere 20ft</option>
            <option value="cone">Cone 15ft</option>
            <option value="line">Line 30ft</option>
            <option value="cube">Cube 20ft</option>
          </select>
          <select
            aria-label="Fog and terrain brush"
            className="forge-input"
            value={
              mode === 'fog_paint' || mode === 'fog_reveal' || mode === 'wall' || mode === 'difficult' || mode === 'erase_terrain'
                ? mode
                : ''
            }
            onChange={(e) => {
              const v = e.target.value as MapMode | '';
              if (v) setMode(v);
            }}
            style={{ padding: '3px 6px', fontSize: 11 }}
          >
            <option value="">Fog / Terrain...</option>
            <option value="fog_paint">Fog Paint</option>
            <option value="fog_reveal">Fog Reveal</option>
            <option value="wall">Wall</option>
            <option value="difficult">Difficult Terrain</option>
            <option value="erase_terrain">Erase Terrain</option>
          </select>
          <button type="button" className="btn" onClick={onFillAllFog}>Fog All</button>
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
          {sketches.length > 0 && (
            <button type="button" className="btn" onClick={onClearSketches}>
              Clear Sketch ({sketches.length})
            </button>
          )}
        </div>

        <button type="button" className="btn btn-primary" onClick={onNextTurn}>
          Next Turn (Rnd {encounter.round})
        </button>
      </div>

      <div className="forge-row-between" style={{ flexWrap: 'wrap', gap: 6 }}>
        <div className="toolbar-group">
          <button
            type="button"
            className={`pill ${playerView ? 'active' : ''}`}
            aria-pressed={playerView}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
            onClick={onTogglePlayerView}
          >
            <EyeIcon size={13} />
            {playerView ? 'Player View ON' : 'Player View OFF'}
          </button>
          {onOpenPopOutPlayer && (
            <button type="button" className="btn" onClick={onOpenPopOutPlayer}>
              Pop-Out Screen
            </button>
          )}
          <button
            type="button"
            className={`pill ${dynamicVision ? 'active' : ''}`}
            aria-pressed={dynamicVision}
            onClick={() => onUpdateMapSettings({ dynamicVision: !dynamicVision })}
          >
            Vision {dynamicVision ? 'ON' : 'OFF'}
          </button>
          {dynamicVision && (
            <button
              type="button"
              className={`pill ${autoRevealFog ? 'active' : ''}`}
              aria-pressed={autoRevealFog}
              onClick={() => onUpdateMapSettings({ autoRevealFog: !autoRevealFog })}
            >
              Auto-Reveal {autoRevealFog ? 'ON' : 'OFF'}
            </button>
          )}
        </div>

        <div className="toolbar-group">
          <button
            type="button"
            className="btn"
            onClick={() => setZoom((z) => Math.max(0.75, Number((z - 0.25).toFixed(2))))}
          >
            Zoom -
          </button>
          <span className="badge tabular">{Math.round(zoom * 100)}%</span>
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
            onClick={() => setShowCalibrate((s) => !s)}
          >
            Map, Scenes &amp; Grid
          </button>
        </div>

        {mode === 'sketch' && (
          <div className="forge-row">
            <span className="muted-label">Ink</span>
            {SKETCH_COLORS.map((col) => (
              <button
                key={col}
                type="button"
                aria-label={`Sketch color ${col}`}
                className="btn"
                style={{
                  minWidth: 26,
                  padding: '2px 6px',
                  background: col,
                  border: sketchColor === col ? '2px solid #f0f6fc' : '1px solid #30363d',
                }}
                onClick={() => setSketchColor(col)}
              />
            ))}
          </div>
        )}
      </div>

      {showCalibrate && (
        <div className="subpanel forge-stack" style={{ padding: 10 }}>
          <div className="forge-row-between" style={{ flexWrap: 'wrap', gap: 6 }}>
            <div className="forge-row" style={{ flexWrap: 'wrap' }}>
              <select
                aria-label="Load preset battlemap"
                className="forge-input"
                value=""
                onChange={(e) => {
                  const preset = BUILTIN_MAP_PRESETS.find((p) => p.id === e.target.value);
                  if (preset) onSetMapImage(preset.dataUrl);
                }}
                style={{ padding: '3px 6px', fontSize: 11 }}
              >
                <option value="">Preset Maps...</option>
                {BUILTIN_MAP_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <label className="btn" style={{ cursor: 'pointer' }}>
                Upload Map
                <input
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    handleFileDataUrl(e.target.files?.[0], (url) => onSetMapImage(url));
                    e.target.value = '';
                  }}
                />
              </label>
              {encounter.map?.imageDataUrl && (
                <button type="button" className="btn" onClick={() => onSetMapImage(undefined)}>
                  Clear Map
                </button>
              )}
            </div>
            {onSaveScene && (
              <div className="forge-row" style={{ flexWrap: 'wrap' }}>
                <input
                  type="text"
                  className="input"
                  style={{ width: 140 }}
                  placeholder="Scene name..."
                  value={sceneNameInput}
                  onChange={(e) => setSceneNameInput(e.target.value)}
                />
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    onSaveScene(sceneNameInput || encounter.name || 'Saved Scene');
                    setSceneNameInput('');
                  }}
                >
                  Save Scene
                </button>
                {scenes.length > 0 && (
                  <>
                    <select
                      className="select"
                      aria-label="Select battlemap scene"
                      value={selectedSceneId}
                      onChange={(e) => setSelectedSceneId(e.target.value)}
                    >
                      <option value="">Scenes ({scenes.length})...</option>
                      {scenes.map((sc) => (
                        <option key={sc.id} value={sc.id}>
                          {sc.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="btn"
                      disabled={!selectedSceneId}
                      onClick={() => selectedSceneId && onLoadScene?.(selectedSceneId)}
                    >
                      Load Scene
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger"
                      disabled={!selectedSceneId}
                      onClick={() => {
                        if (selectedSceneId) {
                          onDeleteScene?.(selectedSceneId);
                          setSelectedSceneId('');
                        }
                      }}
                    >
                      Del Scene
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}

        {/* Selected Token Quick Actions, Portrait & Vision Editor */}
        {selectedToken && !playerView && (
          <div className="subpanel forge-row-between" style={{ padding: '6px 10px', flexWrap: 'wrap', gap: 6 }}>
            <div className="forge-row" style={{ flexWrap: 'wrap', gap: 6 }}>
              <span className="badge tabular">
                Token: <strong>{selectedToken.name}</strong> • HP {selectedToken.hp.current}/{selectedToken.hp.max} • AC {selectedToken.ac}
              </span>
              {onAdjustTokenHp && (
                <div className="forge-row" style={{ gap: 3 }}>
                  {[-5, -1, 1, 5].map((delta) => (
                    <button
                      key={delta}
                      type="button"
                      className="btn"
                      style={{ padding: '1px 6px', fontSize: 11 }}
                      onClick={() => onAdjustTokenHp(selectedToken.id, delta)}
                    >
                      {delta > 0 ? `+${delta}` : delta}
                    </button>
                  ))}
                </div>
              )}
              {onToggleTokenCondition && (
                <div className="forge-row" style={{ gap: 3 }}>
                  {['Prone', 'Poisoned', 'Stunned'].map((cond) => {
                    const active = selectedToken.conditions.includes(cond);
                    return (
                      <button
                        key={cond}
                        type="button"
                        className={`pill ${active ? 'active' : ''}`}
                        onClick={() => onToggleTokenCondition(selectedToken.id, cond)}
                      >
                        {cond}
                      </button>
                    );
                  })}
                </div>
              )}
              {onInspectToken && (
                <button
                  type="button"
                  className="btn"
                  style={{ fontSize: 11 }}
                  onClick={() => onInspectToken(selectedToken.id)}
                >
                  Inspect
                </button>
              )}
            </div>
            <div className="forge-row" style={{ flexWrap: 'wrap' }}>
              <label className="btn" style={{ cursor: 'pointer' }}>
                Upload Portrait
                <input
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    handleFileDataUrl(e.target.files?.[0], (url) =>
                      onSetTokenPortrait?.(selectedToken.id, url)
                    );
                    e.target.value = '';
                  }}
                />
              </label>
              {selectedToken.portraitUrl && (
                <button
                  type="button"
                  className="btn"
                  onClick={() => onSetTokenPortrait?.(selectedToken.id, undefined)}
                >
                  Clear Portrait
                </button>
              )}
              <label className="forge-row">
                <span className="muted-label">Vision (ft)</span>
                <input
                  type="number"
                  className="input input-compact"
                  style={{ width: 64 }}
                  min={5}
                  max={300}
                  step={5}
                  value={selectedToken.visionFeet ?? 60}
                  onChange={(e) =>
                    onSetTokenVision?.(selectedToken.id, Number.parseInt(e.target.value, 10) || 60)
                  }
                />
              </label>
            </div>
          </div>
        )}

        {showCalibrate && (
          <div className="subpanel forge-row" style={{ padding: 10, flexWrap: 'wrap', gap: 10 }}>
            <label className="forge-row">
              <span className="muted-label">Cols</span>
              <input
                type="number"
                className="input input-compact"
                style={{ width: 64 }}
                min={8}
                max={40}
                value={cols}
                onChange={(e) =>
                  onUpdateMapSettings({ cols: Math.max(8, Math.min(40, Number.parseInt(e.target.value, 10) || 20)) })
                }
              />
            </label>
            <label className="forge-row">
              <span className="muted-label">Rows</span>
              <input
                type="number"
                className="input input-compact"
                style={{ width: 64 }}
                min={6}
                max={30}
                value={rows}
                onChange={(e) =>
                  onUpdateMapSettings({ rows: Math.max(6, Math.min(30, Number.parseInt(e.target.value, 10) || 12)) })
                }
              />
            </label>
            <label className="forge-row">
              <span className="muted-label">Grid Opacity</span>
              <input
                type="range"
                min={0}
                max={0.8}
                step={0.05}
                value={gridOpacity}
                onChange={(e) => onUpdateMapSettings({ gridOpacity: Number.parseFloat(e.target.value) })}
              />
            </label>
            <label className="forge-row">
              <span className="muted-label">BG Scale</span>
              <input
                type="range"
                min={0.5}
                max={2}
                step={0.05}
                value={imageScale}
                onChange={(e) => onUpdateMapSettings({ imageScale: Number.parseFloat(e.target.value) })}
              />
            </label>
            <label className="forge-row">
              <span className="muted-label">Offset X</span>
              <input
                type="number"
                className="input input-compact"
                style={{ width: 64 }}
                value={imageOffsetX}
                onChange={(e) => onUpdateMapSettings({ imageOffsetX: Number.parseInt(e.target.value, 10) || 0 })}
              />
            </label>
            <label className="forge-row">
              <span className="muted-label">Offset Y</span>
              <input
                type="number"
                className="input input-compact"
                style={{ width: 64 }}
                value={imageOffsetY}
                onChange={(e) => onUpdateMapSettings({ imageOffsetY: Number.parseInt(e.target.value, 10) || 0 })}
              />
            </label>
          </div>
        )}

        {svgGrid}
      </div>
  );

  if (embeddedFull) {
    return fullVttContent;
  }

  return (
    <ModalDialog
      isOpen={isOpen}
      wide
      onClose={onClose}
      title={`${encounter.name} — Tactical VTT Battlemap (${playerView ? 'Player View' : 'DM View'})`}
    >
      {fullVttContent}
    </ModalDialog>
  );
}
