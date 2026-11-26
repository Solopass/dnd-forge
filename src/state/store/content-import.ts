import { useCallback, useMemo } from 'react';
import { RawCharacterState } from '../../types/character';
import { CompendiumEntity } from '../../types/compendium';
import { parseHomebrewMarkdownBlock } from '../../engine/statblock-parser';
import { parseFree5eMarkdownAuto } from '../../engine/free5e-parser';
import { adapt5eToolsPayload } from '../../engine/five-tools-adapter';
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
import { parseCustomContentJson } from '../../engine/custom-content-loader';
import { getClassDefinition } from '../../engine/classes';
import { buildCampaignPackExport, fetchCampaignPackFromGitHub, getStoredGithubPat, pushFileToGitHubRepo, tryFetchExistingManifest } from '../../engine/campaign-repo-sync';
import { ExternalRepoConfig } from '../../types/campaign';
import {
  buildSearchTokens,
  db,
  deleteDuplicateDecision,
  importBackupBundle,
  normalizeSearchQuery,
  saveCharacter,
  saveDuplicateDecision,
  upsertCompendiumEntities,
} from '../../storage/db';
import type { StoreCore } from './core';
import type { useCombatActions } from './combat';

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
  } = core;
  const { addMonsterToEncounter } = deps;

  /** Shows the "N new, M exact duplicates, K possible duplicates" preview; `commit` only runs on Import. */
  const stageImport = useCallback(
    (label: string, entities: CompendiumEntity[], characters: number, commit: () => Promise<void>) => {
      const plan = planEntityImport(entities, compendium, sourcePriority, characters);
      setPendingImport({ label, plan, commit });
      appendLog(`Import preview for ${label}: ${plan.summary}.`, 'info');
    },
    [compendium, sourcePriority, appendLog]
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

  const installContentPack = useCallback(
    async (packId: string) => {
      const pack = BUILTIN_CONTENT_PACKS.find((p) => p.id === packId);
      if (!pack) return;
      await upsertCompendiumEntities(pack.entities);
      const refreshed = await db.compendium.toArray();
      setCompendium(refreshed);
      appendLog(`Installed "${pack.name}" (${pack.entities.length} entries added to local Compendium).`, 'info');
    },
    [appendLog]
  );

  const importDdbPdfFile = useCallback(
    async (file: File) => {
      try {
        const buffer = await file.arrayBuffer();
        const result = await parseDndBeyondPdfBuffer(buffer, file.name);
        stageImport(`D&D Beyond PDF "${result.character.name}"`, result.character.items, 1, async () => {
          await saveCharacter(result.character);
          if (result.character.items.length > 0) {
            await upsertCompendiumEntities(result.character.items);
            const refreshed = await db.compendium.toArray();
            setCompendium(refreshed);
          }
          setCharacterList((prev) => [...prev, result.character]);
          setRawChar(result.character);
          appendLog(
            `Imported D&D Beyond PDF "${result.character.name}" (${result.extractedFieldsCount} PDF form fields read, ${result.character.items.length} weapons/spells).`,
            result.warnings.length > 0 ? 'warn' : 'info'
          );
          result.warnings.forEach((w) => appendLog(`  PDF Warning: ${w}`, 'warn'));
        });
      } catch (err) {
        appendLog(`PDF import failed: ${String(err)}`, 'warn');
      }
    },
    [appendLog, stageImport]
  );

  const importMarkdownHomebrew = useCallback(
    async (rawMarkdown: string) => {
      const free5e = /\[_metadata_:spell_name\]:-/i.test(rawMarkdown)
        ? parseFree5eMarkdownAuto(rawMarkdown, 'spell')
        : null;
      if (free5e) {
        stageImport(`Free5e "${free5e.name}" (Markdown)`, [free5e], 0, async () => {
          await upsertCompendiumEntities([free5e]);
          setCompendium((prev) => [free5e, ...prev]);
          persistCharacter((prev) => ({
            ...prev,
            items: [free5e, ...prev.items],
          }));
          appendLog(`Imported Free5e "${free5e.name}" (${free5e.category}) from Markdown.`, 'info');
        });
        return;
      }

      const result = parseHomebrewMarkdownBlock(rawMarkdown);
      stageImport(`"${result.data.name}" (Markdown)`, [result.data], 0, async () => {
      await upsertCompendiumEntities([result.data]);
      setCompendium((prev) => [result.data, ...prev]);

      if (result.data.category === 'monster' && result.data.monsterMeta) {
        addMonsterToEncounter(
          result.data.name,
          result.data.monsterMeta.ac,
          result.data.monsterMeta.hp,
          result.data.monsterMeta.dexModifier,
          result.data.activities,
          result.data.monsterMeta.cr,
          result.data.monsterMeta,
          result.data.entries.join(' '),
          result.data.imageUrl
        );
      } else {
        persistCharacter((prev) => ({
          ...prev,
          items: [result.data, ...prev.items],
        }));
      }

      appendLog(
        `Imported "${result.data.name}" (${result.data.category}, ${result.confidence} confidence, ${result.warnings.length} warning(s)).`,
        result.warnings.length > 0 ? 'warn' : 'info'
      );
      result.warnings.forEach((w) =>
        appendLog(`  Line ${w.line}: ${w.reason} ("${w.raw}")`, 'warn')
      );
      });
    },
    [persistCharacter, addMonsterToEncounter, appendLog, stageImport]
  );

  const importJsonFilePayload = useCallback(
    async (rawText: string) => {
      try {
        const parsed: unknown = JSON.parse(rawText);
        if (typeof parsed === 'object' && parsed !== null && (parsed as { app?: string }).app === 'dnd-forge') {
          const bundle = parsed as { compendium?: unknown; characters?: unknown };
          const bundleEntities = Array.isArray(bundle.compendium)
            ? (bundle.compendium as CompendiumEntity[]).filter((e) => e && typeof e.id === 'string' && typeof e.name === 'string')
            : [];
          const bundleChars = Array.isArray(bundle.characters) ? bundle.characters.length : 0;
          stageImport('backup bundle', bundleEntities, bundleChars, async () => {
          const summary = await importBackupBundle(parsed, 'merge');
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
            setCampaignList(refreshedCampaigns);
            setCampaign(refreshedCampaigns[0]!);
          }
          setScenes(refreshedScenes);
          appendLog(
            `Merged backup bundle: ${summary.importedCharacters} character(s), ${summary.importedEntities} compendium item(s), ${summary.importedEncounters} encounter(s).`,
            'info'
          );
          const refreshedDecisions = await db.dupDecisions.toArray();
          setDupDecisions(refreshedDecisions);
          });
          return;
        }

        const adapted = adapt5eToolsPayload(parsed);
        if (adapted.entities.length > 0) {
          stageImport(`5e.tools JSON (${adapted.skipped} skipped)`, adapted.entities, 0, async () => {
            await upsertCompendiumEntities(adapted.entities);
            setCompendium((prev) => [...adapted.entities, ...prev]);
            appendLog(
              `Imported ${adapted.entities.length} 5e.tools entities (${adapted.skipped} skipped).`,
              'info'
            );
          });
          return;
        }

        const byId = new Map(compendium.map((e) => [e.id, e]));
        const customParsed = parseCustomContentJson(rawText, (id) => byId.get(id), getClassDefinition);
        customParsed.rejected.forEach((r) => appendLog(`  Not imported: "${r.name}": ${r.reason}.`, 'warn'));
        customParsed.warnings.forEach((w) => appendLog(`  ${w}`, 'warn'));
        if (customParsed.entities.length > 0 || customParsed.characters.length > 0) {
          stageImport('custom content JSON', customParsed.entities, customParsed.characters.length, async () => {
            if (customParsed.entities.length > 0) {
              await upsertCompendiumEntities(customParsed.entities);
              setCompendium((prev) => [...customParsed.entities, ...prev]);
            }
            for (const ch of customParsed.characters) {
              await saveCharacter(ch);
              setCharacterList((prev) => (prev.some((p) => p.id === ch.id) ? prev : [...prev, ch]));
              setRawChar(ch);
            }
            appendLog(
              `Imported ${customParsed.entities.length} custom entity(s) and ${customParsed.characters.length} character(s)${customParsed.rejected.length > 0 ? `; ${customParsed.rejected.length} rejected` : ''}.`,
              'info'
            );
          });
        } else {
          appendLog(
            customParsed.rejected.length > 0
              ? `JSON recognized, but all ${customParsed.rejected.length} entries were rejected (see above).`
              : 'JSON recognized, but no Sidereroll entities, characters, or 5e.tools arrays were found.',
            'warn'
          );
        }
      } catch (err) {
        appendLog(`JSON import failed: ${String(err)}`, 'warn');
      }
    },
    [appendLog, stageImport, setDupDecisions, compendium]
  );

  const createHomebrewEntity = useCallback(
    async (entity: CompendiumEntity, addToSheet: boolean) => {
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
      appendLog(`Created homebrew "${entity.name}" (${entity.category}).`, 'info');
    },
    [persistCharacter, appendLog]
  );

  // Search shows one entry per name (SRD copy wins over Free5e/duplicate pack copies); nothing is deleted.
  const searchableCompendium = useMemo(
    () => applyDuplicateDecisions(foldMagicVariants(dedupeCompendium(effectiveCompendium, sourcePriority)), dupDecisions),
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

  const syncCampaignExternalRepo = useCallback(
    async (repoConfig?: ExternalRepoConfig, persistAsCampaignRepo = true) => {
      const cfg = repoConfig ?? campaign.externalRepo;
      if (!cfg?.owner || !cfg?.repo) {
        appendLog('Set an owner/repo (e.g. Solopass/my-campaign) before syncing.', 'warn');
        return;
      }
      const token = getStoredGithubPat();
      try {
        const result = await fetchCampaignPackFromGitHub(cfg, token || undefined);
        stageImport(`${cfg.owner}/${cfg.repo}`, result.entities, result.characters.length, async () => {
        if (result.entities.length > 0) {
          await upsertCompendiumEntities(result.entities);
          setCompendium((prev) => {
            const map = new Map(prev.map((e) => [e.id, e]));
            for (const e of result.entities) map.set(e.id, e);
            return Array.from(map.values());
          });
        }
        if (result.characters.length > 0) {
          for (const ch of result.characters) {
            await saveCharacter(ch);
          }
          setCharacterList((prev) => {
            const map = new Map(prev.map((c) => [c.id, c]));
            for (const ch of result.characters) map.set(ch.id, ch);
            return Array.from(map.values());
          });
        }
        if (persistAsCampaignRepo) {
          persistCampaign((prev) => {
            const existingEntryIds = new Set(prev.entries.map((e) => e.id));
            const newEntries = result.entries.filter((e) => !existingEntryIds.has(e.id));
            return {
              ...prev,
              externalRepo: { ...cfg, lastSyncedAt: result.syncedAt },
              entries: newEntries.length > 0 ? [...newEntries, ...prev.entries] : prev.entries,
            };
          });
        }
        appendLog(
          `Synced ${cfg.owner}/${cfg.repo}: ${result.entities.length} entities, ${result.characters.length} characters, ${result.entries.length} binder entries.`,
          'info'
        );
        pushToast(`Synced ${cfg.owner}/${cfg.repo} (${result.entities.length} items, ${result.characters.length} PCs)`, 'info');
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        appendLog(`Campaign repo sync failed: ${msg}`, 'warn');
        pushToast(`Sync failed: ${msg}`, 'warn');
      }
    },
    [campaign.externalRepo, persistCampaign, appendLog, pushToast, stageImport]
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
    syncFree5ePack,
    pushCharacterToCampaignRepo,
    pushCampaignToRepo,
  };
}
