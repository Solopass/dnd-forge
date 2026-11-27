import { useCallback, useMemo } from 'react';
import { RawCharacterState } from '../../types/character';
import { CompendiumEntity } from '../../types/compendium';
import {
  buildImportReport,
  resultFromCharacter,
  runImportPipeline,
  runImportPipelineOnEntities,
  summarizeReport,
  type ImportReport,
  type PipelineResult,
} from '../../engine/import-pipeline';
import { parseDndBeyondPdfBuffer } from '../../engine/ddb-pdf-importer';
import { BUILTIN_CONTENT_PACKS } from '../../engine/srd-packs';
import {
  applyDuplicateDecisions,
  dedupeCompendium,
  type DuplicateAction,
  type DuplicateDecision,
  type NearDuplicateGroup,
} from '../../engine/compendium-dedupe';
import { foldMagicVariants } from '../../engine/magic-variants';
import { planEntityImport } from '../../engine/import-preview';
import { getClassDefinition } from '../../engine/classes';
import { buildCampaignPackExport, fetchPackFromGitHub, getStoredGithubPat, probeRepoAccess, pushFileToGitHubRepo, resolveCommitSha, toInstalledPack, tryFetchExistingManifest } from '../../engine/campaign-repo-sync';
import {
  failureMessage,
  isCurrentAt,
  migrateCampaignPacks,
  packKey,
  syncSummary,
  type TablePack,
  type TablePackResult,
} from '../../engine/campaign-packs';
import { diffPackEntities, planLegacyAdoption } from '../../engine/pack-manifest';
import type { InstalledPack } from '../../types/pack';
import { ExternalRepoConfig } from '../../types/campaign';
import {
  adoptEntityIds,
  buildSearchTokens,
  db,
  deleteDuplicateDecision,
  importBackupBundle,
  markOrphans,
  normalizeSearchQuery,
  removePackFromDb,
  saveCharacter,
  saveDuplicateDecision,
  savePack,
  upsertCompendiumEntities,
} from '../../storage/db';
import type { StoreCore } from './core';
import type { useCombatActions } from './combat';

export type PackActionResult = { ok: true; pack?: InstalledPack } | { ok: false; error: string };
export type PackUpdateStatus = 'current' | 'available' | 'unknown';

export type ContentImportDeps = Pick<ReturnType<typeof useCombatActions>, 'addMonsterToEncounter'>;

export function useContentImportActions(core: StoreCore, deps: ContentImportDeps) {
  const {
    persistCharacter,
    appendLog,
    setCompendium,
    setCharacterList,
    setRawChar,
    setEncounterList,
    setEncounter,
    setCampaignList,
    setCampaign,
    setScenes,
    compendium,
    effectiveCompendium,
    characterList,
    setPendingConcDc,
    pushToast,
    campaign,
    persistCampaign,
    setFree5eSyncing,
    sourcePriority,
    dupDecisions,
    setDupDecisions,
    setPendingImport,
    pendingImport,
    packs,
    setPacks,
    setContentFixes,
    setTablePackSync,
    tablePackRequestRef,
    tablePackChainRef,
  } = core;
  const { addMonsterToEncounter } = deps;

  /** Shows the "N new, M exact duplicates, K possible duplicates" preview; `commit` only runs on Import. */
  const stageImport = useCallback(
    (
      label: string,
      entities: CompendiumEntity[],
      characters: number,
      commit: () => Promise<void>,
      opts: { replacePackId?: string; report?: ImportReport; excludeIds?: ReadonlySet<string>; silent?: boolean } = {}
    ): Promise<void> | void => {
      // updating a pack: its current copies are about to be replaced, so they are not "duplicates" of the new ones
      const existing = compendium.filter(
        (e) => !(opts.replacePackId && e.packId === opts.replacePackId) && !opts.excludeIds?.has(e.id)
      );
      const plan = planEntityImport(entities, existing, sourcePriority, characters);
      // a DM-linked pack synced at the Live Table is written straight away (no dialog)
      if (opts.silent) return commit();
      setPendingImport({ label, plan, ...(opts.report ? { report: opts.report } : {}), commit });
      appendLog(`Import preview for ${label}: ${plan.summary}${opts.report ? ` (${summarizeReport(opts.report)})` : ''}.`, 'info');
    },
    [compendium, sourcePriority, appendLog]
  );

  /** One line per rejected entry and per warning, so nothing the pipeline dropped is silent. */
  const logPipelineIssues = useCallback(
    (result: PipelineResult) => {
      result.rejected.slice(0, 25).forEach((r) => appendLog(`  Not imported: "${r.source}": ${r.reason}.`, 'warn'));
      if (result.rejected.length > 25) appendLog(`  ... and ${result.rejected.length - 25} more not imported.`, 'warn');
      result.warnings.forEach((w) => appendLog(`  ${w}`, 'warn'));
    },
    [appendLog]
  );

  /** Adds already-cleaned entities (and characters) to the compendium and the open character list. */
  const commitPipelineResult = useCallback(
    async (piped: PipelineResult) => {
      if (piped.accepted.length > 0) {
        await upsertCompendiumEntities(piped.accepted);
        const ids = new Set(piped.accepted.map((e) => e.id));
        setCompendium((prev) => [...piped.accepted, ...prev.filter((e) => !ids.has(e.id))]);
      }
      for (const ch of piped.characters) {
        await saveCharacter(ch);
        setCharacterList((prev) => (prev.some((p) => p.id === ch.id) ? prev : [...prev, ch]));
        setRawChar(ch);
      }
    },
    []
  );

  const confirmPendingImport = useCallback(async () => {
    const pending = pendingImport;
    if (!pending) return;
    setPendingImport(null);
    await pending.commit();
  }, [pendingImport]);

  const cancelPendingImport = useCallback(() => {
    if (pendingImport) appendLog(`Import of ${pendingImport.label} cancelled; nothing was written.`, 'info');
    setPendingImport(null);
  }, [pendingImport, appendLog]);

  const addCompendiumItemToSheet = useCallback(
    (entity: CompendiumEntity) => {
      if (entity.category === 'monster' && entity.monsterMeta) {
        addMonsterToEncounter(
          entity.name,
          entity.monsterMeta.ac,
          entity.monsterMeta.hp,
          entity.monsterMeta.dexModifier,
          entity.activities,
          entity.monsterMeta.cr,
          entity.monsterMeta,
          entity.entries.join(' '),
          entity.imageUrl
        );
        return;
      }

      persistCharacter((prev) => {
        const { alsoIn: _alsoIn, fixedBy: _fixedBy, ...plain } = entity;
        const clone: CompendiumEntity = {
          ...structuredClone(plain),
          id: `${entity.id}-${Date.now().toString(36)}`,
          equipped: true,
          prepared: true,
        };
        return { ...prev, items: [clone, ...prev.items] };
      });
      appendLog(`Added "${entity.name}" (${entity.category}) to character sheet.`, 'info');
    },
    [persistCharacter, addMonsterToEncounter, appendLog]
  );

  /** Built-in packs: no preview, but the same cleaning as every other import. */
  const installContentPack = useCallback(
    async (packId: string) => {
      const pack = BUILTIN_CONTENT_PACKS.find((p) => p.id === packId);
      if (!pack) return;
      const piped = runImportPipelineOnEntities(pack.entities, { name: pack.name, explicitIds: true });
      await upsertCompendiumEntities(piped.accepted);
      const refreshed = await db.compendium.toArray();
      setCompendium(refreshed);
      logPipelineIssues(piped);
      appendLog(`Installed "${pack.name}" (${piped.accepted.length} entries added to local Compendium; ${summarizeReport(buildImportReport(piped))}).`, 'info');
    },
    [appendLog, logPipelineIssues]
  );

  const importDdbPdfFile = useCallback(
    async (file: File) => {
      try {
        const buffer = await file.arrayBuffer();
        const result = await parseDndBeyondPdfBuffer(buffer, file.name);
        const piped = resultFromCharacter(result.character, result.warnings);
        const character = piped.characters[0] ?? result.character;
        logPipelineIssues({ ...piped, warnings: [] });
        stageImport(`D&D Beyond PDF "${character.name}"`, character.items, 1, async () => {
          await saveCharacter(character);
          if (character.items.length > 0) {
            await upsertCompendiumEntities(character.items);
            const refreshed = await db.compendium.toArray();
            setCompendium(refreshed);
          }
          setCharacterList((prev) => [...prev, character]);
          setRawChar(character);
          appendLog(
            `Imported D&D Beyond PDF "${character.name}" (${result.extractedFieldsCount} PDF form fields read, ${character.items.length} weapons/spells).`,
            result.warnings.length > 0 ? 'warn' : 'info'
          );
          result.warnings.forEach((w) => appendLog(`  PDF Warning: ${w}`, 'warn'));
        }, { report: buildImportReport(piped) });
      } catch (err) {
        appendLog(`PDF import failed: ${String(err)}`, 'warn');
      }
    },
    [appendLog, stageImport, logPipelineIssues]
  );

  /** Pasted text of any kind (Markdown statblock, Free5e page, JSON, CSV): the pipeline works out what it is. */
  const importMarkdownHomebrew = useCallback(
    async (rawMarkdown: string) => {
      const byId = new Map(compendium.map((e) => [e.id, e]));
      const piped = runImportPipeline(rawMarkdown, { name: 'pasted text', resolveEntity: (id) => byId.get(id), classLookup: getClassDefinition });
      logPipelineIssues(piped);
      if (piped.accepted.length === 0 && piped.characters.length === 0) {
        appendLog(`Nothing was imported from the pasted text (${piped.rejected[0]?.reason ?? 'no entries found'}).`, 'warn');
        return;
      }
      const single = piped.accepted.length === 1 && piped.characters.length === 0 ? piped.accepted[0]! : null;
      const label = single ? `"${single.name}" (${piped.format === 'free5e-markdown' ? 'Free5e Markdown' : 'pasted text'})` : `${piped.accepted.length} entries (pasted text)`;
      stageImport(label, piped.accepted, piped.characters.length, async () => {
        await commitPipelineResult(piped);
        if (single && single.category === 'monster' && single.monsterMeta) {
          addMonsterToEncounter(
            single.name,
            single.monsterMeta.ac,
            single.monsterMeta.hp,
            single.monsterMeta.dexModifier,
            single.activities,
            single.monsterMeta.cr,
            single.monsterMeta,
            single.entries.join(' '),
            single.imageUrl
          );
        } else if (single) {
          persistCharacter((prev) => ({ ...prev, items: [single, ...prev.items] }));
        }
        appendLog(
          single
            ? `Imported "${single.name}" (${single.category}${piped.repaired.length > 0 ? `, repaired: ${piped.repaired[0]!.notes.join('; ')}` : ''}).`
            : `Imported ${piped.accepted.length} entities and ${piped.characters.length} character(s) from pasted text (${summarizeReport(buildImportReport(piped))}).`,
          piped.repaired.length > 0 ? 'warn' : 'info'
        );
      }, { report: buildImportReport(piped) });
    },
    [compendium, persistCharacter, addMonsterToEncounter, appendLog, stageImport, logPipelineIssues, commitPipelineResult]
  );

  /** A file's text (JSON, 5e.tools, backup bundle, Markdown, CSV). Pass the file name when there is one: it hints the category. */
  const importJsonFilePayload = useCallback(
    async (rawText: string, fileName?: string) => {
      try {
        const byId = new Map(compendium.map((e) => [e.id, e]));
        const piped = runImportPipeline(rawText, { ...(fileName ? { name: fileName } : {}), resolveEntity: (id) => byId.get(id), classLookup: getClassDefinition });
        logPipelineIssues(piped);
        const report = buildImportReport(piped);

        if (piped.format === 'app-bundle' && piped.bundle !== undefined) {
          stageImport('backup bundle', piped.accepted, piped.characters.length, async () => {
            const summary = await importBackupBundle(piped.bundle, 'merge');
            const [refreshedChars, refreshedCompendium, refreshedEncounters, refreshedCampaigns, refreshedScenes] = await Promise.all([
              db.characters.toArray(),
              db.compendium.toArray(),
              db.encounters.toArray(),
              db.campaigns.toArray(),
              db.scenes.toArray(),
            ]);
            if (refreshedChars.length > 0) {
              setCharacterList(refreshedChars);
              setRawChar(refreshedChars[0]!);
            }
            setCompendium(refreshedCompendium);
            if (refreshedEncounters.length > 0) {
              setEncounterList(refreshedEncounters);
              setEncounter(refreshedEncounters[0]!);
            }
            if (refreshedCampaigns.length > 0) {
              // an old backup has `externalRepo` and no `packs`
              const migrated = refreshedCampaigns.map(migrateCampaignPacks);
              setCampaignList(migrated);
              setCampaign(migrated[0]!);
            }
            setScenes(refreshedScenes);
            appendLog(
              `Merged backup bundle: ${summary.importedCharacters} character(s), ${summary.importedEntities} compendium item(s), ${summary.importedEncounters} encounter(s).`,
              'info'
            );
            const refreshedDecisions = await db.dupDecisions.toArray();
            setDupDecisions(refreshedDecisions);
            setPacks(await db.packs.toArray());
          }, { report });
          return;
        }

        if (piped.accepted.length > 0 || piped.characters.length > 0) {
          const label = piped.format === 'five-tools' ? '5e.tools JSON' : piped.format === 'csv' ? 'CSV table' : piped.format === 'entity-json' ? 'custom content JSON' : 'file';
          stageImport(label, piped.accepted, piped.characters.length, async () => {
            await commitPipelineResult(piped);
            appendLog(
              `Imported ${piped.accepted.length} ${piped.format === 'five-tools' ? '5e.tools ' : 'custom '}entity(s) and ${piped.characters.length} character(s) (${summarizeReport(report)}).`,
              'info'
            );
          }, { report });
        } else {
          appendLog(
            piped.rejected.length === 1
              ? `Nothing imported: ${piped.rejected[0]!.reason}.`
              : piped.rejected.length > 1
              ? `Recognized as ${piped.format}, but all ${piped.rejected.length} entries were rejected (see above).`
              : `Nothing to import: ${piped.rejected[0]?.reason ?? 'no entries found'}.`,
            'warn'
          );
        }
      } catch (err) {
        appendLog(`Import failed: ${String(err)}`, 'warn');
      }
    },
    [appendLog, stageImport, setDupDecisions, setPacks, compendium, logPipelineIssues, commitPipelineResult]
  );

  const createHomebrewEntity = useCallback(
    async (rawEntity: CompendiumEntity, addToSheet: boolean) => {
      const piped = runImportPipelineOnEntities([rawEntity], { name: rawEntity.name, explicitIds: true });
      const entity = piped.accepted[0];
      if (!entity) {
        const reason = piped.rejected[0]?.reason ?? 'it could not be read';
        appendLog(`Homebrew "${rawEntity.name}" was not created: ${reason}.`, 'warn');
        pushToast(`Not created: ${reason}`, 'warn');
        return;
      }
      await upsertCompendiumEntities([entity]);
      setCompendium((prev) => [entity, ...prev.filter((i) => i.id !== entity.id)]);
      if (addToSheet && entity.category !== 'monster') {
        persistCharacter((prev) => ({
          ...prev,
          items: [
            { ...structuredClone(entity), equipped: true, prepared: true },
            ...prev.items,
          ],
        }));
      }
      appendLog(`Created homebrew "${entity.name}" (${entity.category}${piped.repaired.length > 0 ? `; repaired: ${piped.repaired[0]!.notes.join('; ')}` : ''}).`, 'info');
    },
    [persistCharacter, appendLog, pushToast]
  );

  // Search shows one entry per name (SRD copy wins over Free5e/duplicate pack copies); nothing is deleted.
  const searchableCompendium = useMemo(
    () => applyDuplicateDecisions(
        foldMagicVariants(dedupeCompendium(effectiveCompendium, sourcePriority)),
        dupDecisions.filter((d) => !d.orphaned)
      ),
    [effectiveCompendium, sourcePriority, dupDecisions]
  );

  const resolveDuplicateGroup = useCallback(
    async (group: NearDuplicateGroup, action: DuplicateAction, keepId?: string) => {
      const decision: DuplicateDecision = {
        id: group.id,
        memberIds: group.members.map((m) => m.id),
        action,
        ...(action === 'keep-both' ? {} : { keepId: keepId ?? group.members[0]!.id }),
        decidedAt: new Date().toISOString(),
      };
      await saveDuplicateDecision(decision);
      setDupDecisions((prev) => [...prev.filter((d) => d.id !== decision.id), decision]);
      appendLog(`Duplicates: ${action} for ${group.members.map((m) => m.name).join(' / ')}.`, 'info');
    },
    [appendLog]
  );

  const undoDuplicateDecision = useCallback(
    async (groupId: string) => {
      await deleteDuplicateDecision(groupId);
      setDupDecisions((prev) => prev.filter((d) => d.id !== groupId));
    },
    []
  );
  const searchCompendium = useCallback(
    (query: string): CompendiumEntity[] => {
      const rawQ = query.trim().toLowerCase();
      if (!rawQ) return searchableCompendium;
      const normQ = normalizeSearchQuery(query);
      return searchableCompendium.filter((item) => {
        if (item.name.toLowerCase().includes(rawQ)) return true;
        return normQ ? buildSearchTokens(item).includes(normQ) : false;
      });
    },
    [searchableCompendium]
  );

  const importSingleCharacter = useCallback(
    async (incoming: RawCharacterState) => {
      const idCollision = characterList.some((c) => c.id === incoming.id);
      const targetChar: RawCharacterState = idCollision
        ? {
            ...structuredClone(incoming),
            id: `char-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
            name: `${incoming.name} (Imported)`,
          }
        : structuredClone(incoming);
      await saveCharacter(targetChar);
      setCharacterList((prev) => [...prev, targetChar]);
      setRawChar(targetChar);
      setPendingConcDc(null);
      appendLog(`Imported character "${targetChar.name}".`, 'info');
      pushToast(`Imported character: ${targetChar.name}`, 'info');
    },
    [characterList, appendLog, pushToast]
  );

  /**
   * Reads a GitHub repo as a pack and stages it behind the import preview. Used by installPack, updatePack
   * and the campaign repo sync. Nothing is written until the preview is confirmed.
   */
  const stagePackFromRepo = useCallback(
    async (
      cfg: ExternalRepoConfig,
      kind: 'install' | 'update' | 'sync',
      persistAsCampaignRepo = false,
      mode: { silent?: boolean; managed?: boolean } = {}
    ): Promise<PackActionResult> => {
      const token = getStoredGithubPat();
      let installed: InstalledPack | undefined;
      try {
        const compendiumById = new Map(compendium.map((e) => [e.id, e]));
        const fetched = await fetchPackFromGitHub(cfg, token || undefined, {
          fresh: true,
          resolveEntity: (id) => compendiumById.get(id),
          installedPackIds: new Set(packs.map((p) => p.id)),
        });
        const packId = fetched.manifest.id;
        const repoName = `${cfg.owner}/${cfg.repo}`;
        const existing = packs.find((p) => p.id === packId);
        if (existing && existing.repo.toLowerCase() !== repoName.toLowerCase()) {
          throw new Error(`A pack with the id "${packId}" is already installed from ${existing.repo}. Uninstall it first.`);
        }
        const missing = fetched.manifest.requires.filter((r) => !packs.some((p) => p.id === r));
        if (missing.length > 0) {
          appendLog(`Pack "${fetched.manifest.name}" builds on ${missing.join(', ')}, which ${missing.length === 1 ? 'is' : 'are'} not installed.`, 'warn');
        }
        fetched.warnings.forEach((w) => appendLog(`  ${repoName}: ${w}`, 'warn'));

        const previous = compendium.filter((e) => e.packId === packId);
        const incomingIds = new Set(fetched.entities.map((e) => e.id));
        // a file that could not be read this time says nothing about its entries: they stay, marked "unreadable - kept"
        const unreadableFiles = new Set(fetched.unreadable);
        const keptUnreadable =
          unreadableFiles.size > 0
            ? previous.filter((e) => !incomingIds.has(e.id) && (e.packFile === undefined || unreadableFiles.has(e.packFile)))
            : [];
        const keptIds = new Set(keptUnreadable.map((e) => e.id));
        const diff = diffPackEntities(previous, fetched.entities);
        const removedIds = diff.removed.filter((id) => !keptIds.has(id));
        // entries an older repo sync left behind (custom-* ids, no provenance) that this pack carries again
        const adoption = planLegacyAdoption(compendium, fetched.entities, [fetched.manifest.name, repoName]);
        const adoptedOldIds = new Set(adoption.keys());
        const report: ImportReport = {
          ...fetched.report,
          ...(keptUnreadable.length > 0 ? { keptEntries: keptUnreadable.length } : {}),
          ...(adoption.size > 0 ? { adopted: adoption.size } : {}),
        };
        const shortRef = fetched.sha ? fetched.sha.slice(0, 7) : cfg.branch?.trim() || 'main';
        const extras = `${keptUnreadable.length > 0 ? `, ${keptUnreadable.length} unreadable — kept` : ''}${adoption.size > 0 ? `, ${adoption.size} existing adopted` : ''}`;
        const label =
          kind === 'sync'
            ? repoName
            : existing
              ? `${fetched.manifest.name} update to ${fetched.manifest.version} @ ${shortRef} (${diff.added.length} new, ${diff.changed.length} changed, ${removedIds.length} removed${extras})`
              : `${fetched.manifest.name} ${fetched.manifest.version} (${repoName} @ ${shortRef}${extras})`;

        await stageImport(
          label,
          fetched.entities,
          fetched.characters.length,
          async () => {
            const keep = new Set(fetched.entities.map((e) => e.id));
            const stale = previous.filter((e) => !keep.has(e.id) && !keptIds.has(e.id)).map((e) => e.id);
            if (adoption.size > 0) {
              // references first (they point at the old ids), then the old copies go
              const moved = await adoptEntityIds(adoption);
              appendLog(`Adopted ${adoption.size} existing entries into ${fetched.manifest.name} (${moved.fixes} fix(es), ${moved.decisions} duplicate decision(s), ${moved.characterItems} sheet item(s) re-pointed).`, 'info');
            }
            const toDelete = [...stale, ...adoptedOldIds];
            if (toDelete.length > 0) {
              await db.compendium.bulkDelete(toDelete);
              if (stale.length > 0) await markOrphans(new Set(stale), true);
            }
            if (fetched.entities.length > 0) {
              await upsertCompendiumEntities(fetched.entities);
              await markOrphans(new Set([...keep, ...keptIds]), false);
            }
            for (const ch of fetched.characters) await saveCharacter(ch);
            const record: InstalledPack = {
              ...toInstalledPack(fetched, cfg),
              ...(existing ? { installedAt: existing.installedAt } : {}),
              // a personal pack the table later pins stays personal; one the table installed stays managed
              ...((existing ? existing.managedByCampaign : mode.managed) ? { managedByCampaign: true } : {}),
            };
            installed = record;
            await savePack(record);

            const staleSet = new Set(toDelete);
            setCompendium((prev) => {
              const map = new Map(prev.filter((e) => !staleSet.has(e.id)).map((e) => [e.id, e]));
              for (const e of fetched.entities) map.set(e.id, e);
              return Array.from(map.values());
            });
            if (fetched.characters.length > 0) {
              setCharacterList((prev) => {
                const map = new Map(prev.map((c) => [c.id, c]));
                for (const ch of fetched.characters) map.set(ch.id, ch);
                return Array.from(map.values());
              });
            }
            setPacks((prev) => [...prev.filter((p) => p.id !== record.id), record]);
            setContentFixes(await db.contentFixes.toArray());
            setDupDecisions(await db.dupDecisions.toArray());
            if (adoption.size > 0) {
              const allChars = await db.characters.toArray();
              setCharacterList(allChars);
              setRawChar((prev) => allChars.find((ch) => ch.id === prev.id) ?? prev);
            }
            if (persistAsCampaignRepo) {
              persistCampaign((prev) => {
                const existingEntryIds = new Set(prev.entries.map((e) => e.id));
                const newEntries = fetched.entries.filter((e) => !existingEntryIds.has(e.id));
                return {
                  ...prev,
                  externalRepo: { ...cfg, lastSyncedAt: fetched.syncedAt },
                  entries: newEntries.length > 0 ? [...newEntries, ...prev.entries] : prev.entries,
                };
              });
            }
            if (kind === 'sync') {
              appendLog(
                `Synced ${repoName}: ${fetched.entities.length} entities, ${fetched.characters.length} characters, ${fetched.entries.length} binder entries.`,
                'info'
              );
              pushToast(`Synced ${repoName} (${fetched.entities.length} items, ${fetched.characters.length} PCs)`, 'info');
            } else {
              const verb = existing ? 'Updated' : 'Installed';
              appendLog(
                `${verb} pack "${record.name}" ${record.version} from ${repoName}: ${fetched.entities.length} entities${stale.length > 0 ? `, ${stale.length} removed` : ''}${keptUnreadable.length > 0 ? `, ${keptUnreadable.length} unreadable — kept` : ''} (${summarizeReport(fetched.report)}).`,
                'info'
              );
              if (!mode.silent) pushToast(`${verb} pack ${record.name}`, 'info');
            }
          },
          { replacePackId: packId, report, excludeIds: adoptedOldIds, ...(mode.silent ? { silent: true } : {}) }
        );
        return { ok: true, ...(installed ? { pack: installed } : {}) };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        appendLog(kind === 'sync' ? `Campaign repo sync failed: ${msg}` : `Pack ${kind} failed: ${msg}`, 'warn');
        pushToast(kind === 'sync' ? `Sync failed: ${msg}` : `Pack ${kind} failed: ${msg.split('\n')[0]}`, 'warn');
        return { ok: false, error: msg };
      }
    },
    [packs, compendium, stageImport, appendLog, pushToast, persistCampaign, setCompendium, setCharacterList, setPacks, setContentFixes, setDupDecisions]
  );

  const installPack = useCallback(
    async (spec: { owner: string; repo: string; ref?: string }): Promise<PackActionResult> => {
      const owner = spec.owner.trim();
      const repo = spec.repo.trim();
      if (!owner || !repo) return { ok: false, error: 'Enter a repo as owner/repo (optionally owner/repo@ref).' };
      return stagePackFromRepo({ owner, repo, ...(spec.ref?.trim() ? { branch: spec.ref.trim() } : {}) }, 'install');
    },
    [stagePackFromRepo]
  );

  const updatePack = useCallback(
    async (packId: string): Promise<PackActionResult> => {
      const pack = packs.find((p) => p.id === packId);
      if (!pack) return { ok: false, error: 'That pack is not installed.' };
      const [owner, repo] = pack.repo.split('/');
      if (!owner || !repo) return { ok: false, error: `Bad repo name "${pack.repo}".` };
      return stagePackFromRepo({ owner, repo, ...(pack.ref ? { branch: pack.ref } : {}) }, 'update');
    },
    [packs, stagePackFromRepo]
  );

  /** Compares the installed commit with the repo's current one. Writes nothing. */
  const checkPackUpdate = useCallback(
    async (packId: string): Promise<PackUpdateStatus> => {
      const pack = packs.find((p) => p.id === packId);
      if (!pack) return 'unknown';
      const [owner, repo] = pack.repo.split('/');
      if (!owner || !repo) return 'unknown';
      const sha = await resolveCommitSha({ owner, repo, ...(pack.ref ? { branch: pack.ref } : {}) }, getStoredGithubPat() || undefined);
      if (!sha) return 'unknown';
      return pack.sha === sha ? 'current' : 'available';
    },
    [packs]
  );

  /** Removes exactly this pack's entries. Fixes and duplicate decisions pointing at them stay, marked orphaned. */
  const uninstallPack = useCallback(
    async (packId: string): Promise<PackActionResult> => {
      const pack = packs.find((p) => p.id === packId);
      if (!pack) return { ok: false, error: 'That pack is not installed.' };
      try {
        const removed = await removePackFromDb(packId);
        setCompendium((prev) => prev.filter((e) => e.packId !== packId));
        setPacks((prev) => prev.filter((p) => p.id !== packId));
        setContentFixes(await db.contentFixes.toArray());
        setDupDecisions(await db.dupDecisions.toArray());
        appendLog(`Uninstalled pack "${pack.name}" (${removed.length} entries removed).`, 'info');
        pushToast(`Uninstalled ${pack.name}`, 'info');
        return { ok: true };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        appendLog(`Uninstall failed: ${msg}`, 'warn');
        return { ok: false, error: msg };
      }
    },
    [packs, appendLog, pushToast, setCompendium, setPacks, setContentFixes, setDupDecisions]
  );

  /**
   * Live Table: installs the host's campaign packs at exactly the pinned commits, with no preview dialog, and
   * reports every pack (installed, already current, needs access, network, error). Personal packs are never touched.
   */
  const syncTablePacks = useCallback(
    (wanted: TablePack[], campaignId: string): Promise<TablePackResult[]> => {
      tablePackRequestRef.current = { wanted, campaignId };
      const run = async (): Promise<TablePackResult[]> => {
        const token = getStoredGithubPat() || undefined;
        const results: TablePackResult[] = [];
        for (const w of wanted) {
          const existing = packs.find((p) => p.repo.toLowerCase() === packKey(w));
          const base = { owner: w.owner, repo: w.repo, sha: w.sha };
          if (isCurrentAt(existing, w.sha)) {
            results.push({ ...base, status: 'current', ...(existing ? { name: existing.name, version: existing.version } : {}) });
            continue;
          }
          const cfg = { owner: w.owner, repo: w.repo, branch: w.sha };
          const access = await probeRepoAccess(cfg, token);
          if (access !== 'ok') {
            results.push({ ...base, status: access === 'network' ? 'network' : 'needs-access' });
            continue;
          }
          const res = await stagePackFromRepo(cfg, existing ? 'update' : 'install', false, { silent: true, managed: true });
          if (res.ok) {
            results.push({ ...base, status: 'synced', ...(res.pack ? { name: res.pack.name, version: res.pack.version } : {}) });
          } else {
            const first = res.error.split(String.fromCharCode(10))[0] ?? res.error;
            results.push({ ...base, status: /network|failed to fetch|fetch failed/i.test(first) ? 'network' : 'error', message: first });
          }
        }
        setTablePackSync({ campaignId, at: new Date().toISOString(), results });
        for (const r of results) {
          if (r.status === 'needs-access' || r.status === 'network' || r.status === 'error') {
            appendLog(`[LIVE] ${failureMessage(r)}`, 'warn');
            pushToast(failureMessage(r), 'warn');
          }
        }
        const summary = syncSummary(results);
        if (summary) {
          appendLog(`[LIVE] ${summary}`, 'info');
          pushToast(summary, 'info');
        }
        return results;
      };
      const next = tablePackChainRef.current.then(run, run);
      tablePackChainRef.current = next.catch(() => undefined);
      return next;
    },
    [packs, stagePackFromRepo, appendLog, pushToast]
  );

  /** Runs the last table pack list again (the Retry button after a network error or a new token). */
  const retryTablePackSync = useCallback(async (): Promise<void> => {
    const last = tablePackRequestRef.current;
    if (last) await syncTablePacks(last.wanted, last.campaignId);
  }, [syncTablePacks]);

  const syncCampaignExternalRepo = useCallback(
    async (repoConfig?: ExternalRepoConfig, persistAsCampaignRepo = true) => {
      const cfg = repoConfig ?? campaign.externalRepo;
      if (!cfg?.owner || !cfg?.repo) {
        appendLog('Set an owner/repo (e.g. Solopass/my-campaign) before syncing.', 'warn');
        return;
      }
      await stagePackFromRepo(cfg, 'sync', persistAsCampaignRepo);
    },
    [campaign.externalRepo, appendLog, stagePackFromRepo]
  );

  const syncFree5ePack = useCallback(async () => {
    setFree5eSyncing(true);
    try {
      await syncCampaignExternalRepo(
        { owner: 'Solopass', repo: 'free5e', branch: 'main' },
        false
      );
      try {
        localStorage.setItem('sidereroll-free5e-autosynced', '1');
      } catch {
        // ignore
      }
    } finally {
      setFree5eSyncing(false);
    }
  }, [syncCampaignExternalRepo]);

  const pushCharacterToCampaignRepo = useCallback(
    async (character: RawCharacterState) => {
      const cfg = campaign.externalRepo;
      if (!cfg?.owner || !cfg?.repo) {
        appendLog('Link a Campaign Repo in DM Hub first before pushing.', 'warn');
        pushToast('Link a Campaign Repo in DM Hub first.', 'warn');
        return;
      }
      const token = getStoredGithubPat();
      if (!token) {
        appendLog('Add a GitHub Sync Token in Settings first to push from the browser.', 'warn');
        pushToast('Add a GitHub Sync Token in Settings first.', 'warn');
        return;
      }
      const slug = character.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || character.id;
      const filePath = `characters/${slug}.json`;
      try {
        await pushFileToGitHubRepo(
          cfg,
          filePath,
          `${JSON.stringify(character, null, 2)}\n`,
          `feat: save character ${character.name} from Sidereroll`,
          token
        );
        appendLog(`Pushed "${character.name}" -> ${cfg.owner}/${cfg.repo}/${filePath}.`, 'info');
        pushToast(`Pushed ${character.name} to ${cfg.owner}/${cfg.repo}`, 'info');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        appendLog(`Push failed: ${msg}`, 'warn');
        pushToast(`Push failed: ${msg}`, 'warn');
      }
    },
    [campaign.externalRepo, appendLog, pushToast]
  );

  const pushCampaignToRepo = useCallback(
    async (repoConfig?: ExternalRepoConfig) => {
      const cfg = repoConfig ?? campaign.externalRepo;
      if (!cfg?.owner || !cfg?.repo) {
        appendLog('Set an owner/repo in DM Hub before pushing.', 'warn');
        pushToast('Set an owner/repo in DM Hub first.', 'warn');
        return;
      }
      const token = getStoredGithubPat();
      if (!token) {
        appendLog('Add a GitHub Sync Token in Settings first to push from the browser.', 'warn');
        pushToast('Add a GitHub Sync Token in Settings first.', 'warn');
        return;
      }
      const builtinIds = new Set(BUILTIN_CONTENT_PACKS.flatMap((p) => p.entities).map((e) => e.id));
      const customOnly = compendium.filter((e) => !builtinIds.has(e.id));
      const packPath = cfg.packPath?.trim() || 'campaign-pack.json';
      try {
        const existingManifest = await tryFetchExistingManifest(cfg, token);
        const contentText = buildCampaignPackExport(campaign, customOnly, existingManifest);
        await pushFileToGitHubRepo(
          cfg,
          packPath,
          contentText,
          `feat: sync campaign pack "${campaign.name}" from Sidereroll`,
          token
        );
        const now = new Date().toISOString();
        persistCampaign((prev) => ({
          ...prev,
          externalRepo: { ...cfg, packPath, lastSyncedAt: now },
        }));
        appendLog(
          `Pushed campaign pack "${campaign.name}" (${customOnly.length} custom entities, ${campaign.entries.length} binder entries) -> ${cfg.owner}/${cfg.repo}/${packPath}.`,
          'info'
        );
        pushToast(`Pushed ${campaign.name} to ${cfg.owner}/${cfg.repo}`, 'info');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        appendLog(`Push campaign pack failed: ${msg}`, 'warn');
        pushToast(`Push failed: ${msg}`, 'warn');
      }
    },
    [campaign, compendium, persistCampaign, appendLog, pushToast]
  );

  return {
    addCompendiumItemToSheet,
    installContentPack,
    importDdbPdfFile,
    importMarkdownHomebrew,
    importJsonFilePayload,
    confirmPendingImport,
    cancelPendingImport,
    resolveDuplicateGroup,
    undoDuplicateDecision,
    createHomebrewEntity,
    searchCompendium,
    importSingleCharacter,
    syncCampaignExternalRepo,
    installPack,
    updatePack,
    uninstallPack,
    checkPackUpdate,
    syncTablePacks,
    retryTablePackSync,
    syncFree5ePack,
    pushCharacterToCampaignRepo,
    pushCampaignToRepo,
  };
}
