import { ElementBuilder, ElementCallbackBuilder } from "../elements/element-builder";
import { RollD20Element } from "../elements/roll-d20-element";
import { UtilsElement } from "../elements/utils-element";
import { IAfterDmlContext, IDmlContext, ITrigger } from "../lib/db/dml-trigger";
import { UtilsDocument } from "../lib/db/utils-document";
import { RunOnce } from "../lib/decorator/run-once";
import { UtilsDiceSoNice } from "../lib/roll/utils-dice-so-nice";
import { RollData, UtilsRoll } from "../lib/roll/utils-roll";
import { MemoryStorageService } from "../service/memory-storage-service";
import { staticValues } from "../static-values";
import { MyActor, MyActorData } from "../types/fixed-types";
import { ChatPartEnriched, ChatPartIdData, ItemCardHelpers } from "./item-card-helpers";
import { ModularCard, ModularCardPartData, ModularCardTriggerData } from "./modular-card";
import { createPermissionCheck, CreatePermissionCheckArgs, ModularCardCreateArgs, ModularCardPart } from "./modular-card-part";
import { StateContext, TargetCardData, TargetCardPart, VisualState } from "./target-card-part";

interface TargetCache {
  selectionId: string;
  targetUuid: string;
  actorUuid?: string;
  
  mode: 'normal' | 'advantage' | 'disadvantage';
  phase: 'mode-select' | 'bonus-input' | 'result';
  actorBonus: string;
  userBonus: string;
  hasHalflingLucky: boolean;
  minRoll?: number;
  requestRollFormula?: string;
  roll?: RollData;
  visibleToUsers: string[];
}

export interface CheckCardData {
  ability: keyof MyActor['data']['data']['abilities'];
  dc: number;
  skill?: keyof MyActorData['data']['skills'];
  iSave?: boolean;
  calc$: {
    targetCaches: TargetCache[];
  }
}

function getTargetCache(cache: CheckCardData, selectionId: string): TargetCache | null {
  if (!cache.calc$.targetCaches) {
    return null;
  }
  for (const targetCache of cache.calc$.targetCaches) {
    if (targetCache.selectionId === selectionId) {
      return targetCache;
    }
  }
  return null;
}

export class CheckCardPart implements ModularCardPart<CheckCardData> {

  public static readonly instance = new CheckCardPart();
  private constructor(){}
  
  public create({item, actor}: ModularCardCreateArgs): CheckCardData {
    if (!actor || item.data.data.save?.dc == null || !item.data.data.save?.ability) {
      return null;
    }

    return {
      ability: item.data.data.save?.ability,
      dc: item.data.data.save.dc,
      iSave: true,
      calc$: {
        targetCaches: []
      }
    };
  }

  public refresh(oldData: CheckCardData, args: ModularCardCreateArgs): CheckCardData {
    const newData = this.create(args);

    if (!newData) {
      return null;
    }
    if (!oldData) {
      return newData;
    }

    const result = deepClone(oldData);
    result.calc$ = newData.calc$;
    return result;
  }

  @RunOnce()
  public registerHooks(): void {
    const permissionCheck = createPermissionCheck<{part: {data: CheckCardData}}>(({part, subType}) => {
      const cache = getTargetCache(part.data, subType);
      if (!cache?.actorUuid) {
        return {mustBeGm: true};
      }
      const documents: CreatePermissionCheckArgs['documents'] = [];
      documents.push({uuid: cache.actorUuid, permission: 'OWNER', security: true});
      return {documents: documents};
    })
    
    new ElementBuilder()
      .listenForAttribute('data-part-id', 'string')
      .listenForAttribute('data-message-id', 'string')
      .listenForAttribute('data-sub-type', 'string')
      .addListener(new ElementCallbackBuilder()
        .setEvent('click')
        .addSelectorFilter('[data-action="roll"]')
        .addSerializer(ItemCardHelpers.getChatPartIdSerializer())
        .addSerializer(ItemCardHelpers.getUserIdSerializer())
        .addSerializer(ItemCardHelpers.getMouseEventSerializer())
        .addEnricher(ItemCardHelpers.getChatPartEnricher<CheckCardData>())
        .addEnricher(this.getTargetCacheEnricher)
        .setPermissionCheck(permissionCheck)
        .setExecute(({messageId, targetCache, click, allCardParts}) => {
          if (targetCache.phase === 'result') {
            return;
          }
      
          const orderedPhases: TargetCache['phase'][] = ['mode-select', 'bonus-input', 'result'];
          if (click?.shiftKey) {
            targetCache.phase = orderedPhases[orderedPhases.length - 1];
          } else {
            targetCache.phase = orderedPhases[orderedPhases.indexOf(targetCache.phase) + 1];
          }
          return ModularCard.setCardPartDatas(game.messages.get(messageId), allCardParts);
        })
      )
      .addListener(new ElementCallbackBuilder()
        .setEvent('focusout')
        .addSelectorFilter('input[data-action="user-bonus"]')
        .addSerializer(ItemCardHelpers.getChatPartIdSerializer())
        .addSerializer(ItemCardHelpers.getUserIdSerializer())
        .addSerializer(context => ({inputValue: (context.event.target as HTMLInputElement).value}))
        .addEnricher(ItemCardHelpers.getChatPartEnricher<CheckCardData>())
        .addEnricher(this.getTargetCacheEnricher)
        .setPermissionCheck(permissionCheck)
        .setExecute(({messageId, allCardParts, targetCache, inputValue}) => {
          if (inputValue && !Roll.validate(inputValue)) {
            // Only show error on key press
            throw new Error(game.i18n.localize('Error') + ': ' + game.i18n.localize('Roll Formula'));
          }
          targetCache.phase = 'mode-select';
          targetCache.userBonus = inputValue ?? '';
          return ModularCard.setCardPartDatas(game.messages.get(messageId), allCardParts);
        })
      )
      .addListener(new ElementCallbackBuilder()
        .setEvent('keypress')
        .addSelectorFilter('input[data-action="user-bonus"]')
        .addSerializer(ItemCardHelpers.getChatPartIdSerializer())
        .addSerializer(ItemCardHelpers.getUserIdSerializer())
        .addSerializer(ItemCardHelpers.getKeyEventSerializer())
        .addSerializer(ItemCardHelpers.getInputSerializer())
        .addEnricher(ItemCardHelpers.getChatPartEnricher<CheckCardData>())
        .addEnricher(this.getTargetCacheEnricher)
        .setPermissionCheck(permissionCheck)
        .setExecute(({messageId, allCardParts, targetCache, keyEvent, inputValue}) => {
          if (keyEvent.key === 'Enter') {
            const userBonus = inputValue == null ? '' : inputValue;
            if (userBonus && !Roll.validate(userBonus)) {
              // Only show error on key press
              throw new Error(game.i18n.localize('Error') + ': ' + game.i18n.localize('Roll Formula'));
            }
            targetCache.phase = 'result';
            targetCache.userBonus = userBonus;
            return ModularCard.setCardPartDatas(game.messages.get(messageId), allCardParts);
          } else if (keyEvent.key === 'Escape' && targetCache.phase === 'bonus-input') {
            targetCache.phase = 'mode-select';
            return ModularCard.setCardPartDatas(game.messages.get(messageId), allCardParts);
          }
        })
      )
      .addListener(new ElementCallbackBuilder()
        .setEvent('click')
        .addSelectorFilter('[data-action="mode-minus"], [data-action="mode-plus"]')
        .addSerializer(ItemCardHelpers.getChatPartIdSerializer())
        .addSerializer(ItemCardHelpers.getUserIdSerializer())
        .addSerializer(ItemCardHelpers.getMouseEventSerializer())
        .addSerializer(ItemCardHelpers.getActionSrializer())
        .addEnricher(ItemCardHelpers.getChatPartEnricher<CheckCardData>())
        .addEnricher(this.getTargetCacheEnricher)
        .setPermissionCheck(permissionCheck)
        .setExecute(({messageId, allCardParts, targetCache, click, action}) => {
          console.log(action)
          let modifier = action === 'mode-plus' ? 1 : -1;
          if (click.shiftKey && modifier > 0) {
            modifier++;
          } else if (click.shiftKey && modifier < 0) {
            modifier--;
          }
          
          const order: Array<TargetCache['mode']> = ['disadvantage', 'normal', 'advantage'];
          const newIndex = Math.max(0, Math.min(order.length-1, order.indexOf(targetCache.mode) + modifier));
          if (targetCache.mode === order[newIndex]) {
            return;
          }
          targetCache.mode = order[newIndex];

          if (click.shiftKey) {
            targetCache.phase = 'result';
          }
          return ModularCard.setCardPartDatas(game.messages.get(messageId), allCardParts);
        })
      )
      .addOnAttributeChange(async ({element, attributes}) => {
        return ItemCardHelpers.ifAttrData({attr: attributes, element, type: this, callback: async ({part}) => {
          const cache = getTargetCache(part.data, attributes['data-sub-type']);
          if (!cache) {
            return '';
          }
          const d20attributes = {
            ['data-roll']: cache.roll,
            ['data-bonus-formula']: cache.userBonus,
            ['data-show-bonus']: cache.phase === 'bonus-input',
          };
          if (cache.actorUuid) {
            d20attributes['data-interaction-permission'] = `OwnerUuid:${cache.actorUuid}`
          }
          const attributeArray: string[] = [];
          for (let [attr, value] of Object.entries(d20attributes)) {
            attributeArray.push(`${attr}="${UtilsElement.serializeAttr(value)}"`);
          }
          element.innerHTML = `<${RollD20Element.selector()} class="hide-flavor snug" ${attributeArray.join(' ')}></${RollD20Element.selector()}>`;
        }});
        
      })
      .build(this.getSelector())

    TargetCardPart.instance.registerIntegration({
      getVisualState: context => this.getTargetState(context),
    });
    ModularCard.registerModularCardPart(staticValues.moduleName, this);
    ModularCard.registerModularCardTrigger(new CheckCardTrigger());
  }

  public getType(): string {
    return this.constructor.name;
  }

  //#region Front end
  public getSelector(): string {
    return `${staticValues.code}-check-part`;
  }

  private getTargetCacheEnricher(data: ChatPartIdData & ChatPartEnriched<CheckCardData>): {targetCache: TargetCache} {
    const cache = getTargetCache(data.part.data, data.subType);
    if (!cache) {
      throw {
        success: false,
        errorType: 'warn',
        errorMessage: `Pressed an action button for message part ${data.messageId}.${data.partId} but no data was found for subtype: ${data.subType}`,
      };
    }
    return {targetCache: cache};
  }
  //#endregion
  
  //#region Targeting
  private getTargetState(context: StateContext): VisualState[] {
    const visualStatesBySelectionId = new Map<string, VisualState>();

    let partNr = 0;
    for (const part of context.allMessageParts) {
      if (this.isThisPartType(part)) {
        for (const selected of context.selected) {
          if (!visualStatesBySelectionId.get(selected.selectionId)) {
            visualStatesBySelectionId.set(selected.selectionId, {
              selectionId: selected.selectionId,
              tokenUuid: selected.tokenUuid,
              columns: [],
            })
          }
          const visualState = visualStatesBySelectionId.get(selected.selectionId);
          visualState.columns.push({
            key: `${this.getType()}-check-${partNr}`,
            label: `Save`, // TODO label
            rowValue: `<${this.getSelector()} data-part-id="${part.id}" data-message-id="${context.messageId}" data-sub-type="${selected.selectionId}"></${this.getSelector()}>`
          });
        }

        partNr++;
      }
    }

    return Array.from(visualStatesBySelectionId.values());
  }

  private isThisPartType(row: ModularCardPartData): row is ModularCardPartData<CheckCardData> {
    return row.type === this.getType() && ModularCard.getTypeHandler(row.type) instanceof CheckCardPart;
  }
  //#endregion

}


class CheckCardTrigger implements ITrigger<ModularCardTriggerData> {

  //#region beforeUpsert
  public beforeUpsert(context: IDmlContext<ModularCardTriggerData<any>>): boolean | void {
    this.calcResultCache(context);
  }

  private calcResultCache(context: IDmlContext<ModularCardTriggerData>): void {
    /*for (const {newRow} of context.rows) {
      if (!this.isThisType(newRow) || !this.assumeThisType(newRow)) {
        continue;
      }

      for (const targetCache of newRow.data.calc$.targetCaches) {
        if (newRow.data.calc$.roll?.evaluated) {
          const firstRoll = newRow.data.calc$.roll.terms[0].results.find(r => r.active);
          if (firstRoll.result === 20 || targetCache.ac <= newRow.data.calc$.roll.total) {
            // 20 always hits, lower crit treshold does not
            if (firstRoll.result >= newRow.data.calc$.critTreshold) {
              targetCache.resultType = 'critical-hit';
            } else {
              targetCache.resultType = 'hit';
            }
          } else if (firstRoll.result === 1) {
            targetCache.resultType = 'critical-mis';
          } else {
            targetCache.resultType = 'mis';
          }
        } else if (targetCache.resultType) {
          delete targetCache.resultType;
        }
      }
    }*/
  }
  //#endregion

  //#region upsert
  public async upsert(context: IAfterDmlContext<ModularCardTriggerData>): Promise<void> {
    await this.addTargetCache(context);
    await this.calcTargetRoll(context);
    await this.rollTargetRoll(context);
  }
  
  private async addTargetCache(context: IDmlContext<ModularCardTriggerData>): Promise<void> {
    const partsByMessageId = new Map<string, ModularCardTriggerData[]>();
    for (const {newRow} of context.rows) {
      if (!partsByMessageId.has(newRow.messageId)) {
        partsByMessageId.set(newRow.messageId, []);
      }
      partsByMessageId.get(newRow.messageId).push(newRow);
    }

    const missingTargetUuids = new Set<string>();
    for (const rows of partsByMessageId.values()) {
      const allTargetIds = new Set<string>();
      const cachedSelectionIds = new Set<string>();
      for (const row of rows) {
        if (this.isAnyTargetType(row)) {
          for (const selected of row.data.selected) {
            allTargetIds.add(selected.selectionId);
          }
        }

        if (this.isThisType(row) && this.assumeThisType(row)) {
          for (const target of row.data.calc$.targetCaches) {
            cachedSelectionIds.add(target.selectionId);
          }
        }
      }

      for (const row of rows) {
        if (this.isAnyTargetType(row)) {
          for (const selected of row.data.selected) {
            if (!cachedSelectionIds.has(selected.selectionId)) {
              missingTargetUuids.add(selected.tokenUuid);
            }
          }
        }
      }
    }

    if (missingTargetUuids.size === 0) {
      return;
    }

    // Cache the values of the tokens
    const tokens = await UtilsDocument.tokenFromUuid(missingTargetUuids);
    for (const rows of partsByMessageId.values()) {
      const allSelected: TargetCardData['selected'] = [];
      for (const row of rows) {
        if (this.isAnyTargetType(row)) {
          allSelected.push(...row.data.selected);
        }
      }

      for (const row of rows) {
        if (this.isThisType(row) && this.assumeThisType(row)) {
          const cachedBySelectionId = new Set<string>();
          for (const target of row.data.calc$.targetCaches) {
            cachedBySelectionId.add(target.selectionId);
          }

          for (const selected of allSelected) {
            if (!cachedBySelectionId.has(selected.selectionId)) {
              const actor = (tokens.get(selected.tokenUuid).getActor() as MyActor);
              const targetCache: TargetCache = {
                targetUuid: selected.tokenUuid,
                selectionId: selected.selectionId,
                mode: 'normal',
                phase: 'mode-select',
                actorBonus: '',
                userBonus: '',
                hasHalflingLucky: false,
                visibleToUsers: Array.from(game.users.values()).filter(user => actor.testUserPermission(user, 'OWNER')).map(user => user.id),
              };
              if (actor) {
                const actorAbility = actor.data.data.abilities[row.data.ability];
                const actorSkill = actor.data.data.skills[row.data.skill];
                targetCache.actorUuid = actor.uuid;
                targetCache.hasHalflingLucky = actor?.getFlag("dnd5e", "halflingLucky") === true;
                // Reliable Talent applies to any skill check we have full or better proficiency in
                if (actor?.getFlag("dnd5e", "reliableTalent") === true && actorSkill?.value >= 1) {
                  targetCache.minRoll = 10;
                }

                const bonuses = getProperty(actor.data.data, 'bonuses.abilities') || {};
                const parts: string[] = [];
            
                // Compose roll parts and data
                const data: {[key: string]: any} = {};
            
                parts.push('@abilityMod');
                data.abilityMod = actorAbility.mod;
            
                if (row.data.iSave && actorAbility.prof !== 0) {
                  parts.push('@abilitySaveProf');
                  data.abilitySaveProf = actorAbility.prof;
                  
                  if (bonuses.save) {
                    parts.push("@abilitySaveBonus");
                    data.abilitySaveBonus = bonuses.save;
                  }
                }
                
                // Ability test bonus
                if (bonuses.check) {
                  data.abilityBonus = bonuses.check;
                  parts.push("@abilityBonus");
                }
            
                if (actorSkill) {
                  parts.push('@skillProf');
                  data.skillProf = actorSkill.prof;
                  
                  // Skill check bonus
                  if (bonuses.skill) {
                    data["skillBonus"] = bonuses.skill;
                    parts.push("@skillBonus");
                  }
                }

                targetCache.actorBonus = Roll.replaceFormulaData(parts.join('+'), data);
              }

              row.data.calc$.targetCaches.push(targetCache);
              cachedBySelectionId.add(selected.selectionId);
            }
          }
        }
      }
    }
  }

  private async calcTargetRoll(context: IDmlContext<ModularCardTriggerData>): Promise<void> {
    for (const {newRow} of context.rows) {
      if (!this.isThisType(newRow)) {
        continue;
      }

      for (const target of newRow.data.calc$.targetCaches) {
        let baseRoll = new Die({faces: 20, number: 1});
        if (target.minRoll != null) {
          // reroll a base roll 1 once
          // first 1 = maximum reroll 1 die not both at (dis)advantage (see PHB p173)
          // second 2 = reroll when the roll result is equal to 1 (=1)
          baseRoll.modifiers.push(`min${target.minRoll}`);
        }
        if (target.hasHalflingLucky) {
          // reroll a base roll 1 once
          // first 1 = maximum reroll 1 die not both at (dis)advantage (see PHB p173)
          // second 2 = reroll when the roll result is equal to 1 (=1)
          baseRoll.modifiers.push('r1=1');
        }
        switch (target.mode) {
          case 'advantage': {
            baseRoll.number = 2;
            baseRoll.modifiers.push('kh');
            break;
          }
          case 'disadvantage': {
            baseRoll.number = 2;
            baseRoll.modifiers.push('kl');
            break;
          }
        }
        const parts: string[] = [baseRoll.formula];
        if (target.actorBonus) {
          parts.push(target.actorBonus);
        }
        
        if (target.userBonus && Roll.validate(target.userBonus)) {
          parts.push(target.userBonus);
        }

        target.requestRollFormula = UtilsRoll.simplifyTerms(new Roll(parts.join(' + '))).formula;
      }
    }
  }

  private async rollTargetRoll(context: IDmlContext<ModularCardTriggerData>): Promise<void> {
    for (const {newRow, oldRow} of context.rows) {
      if (!this.isThisType(newRow) || !this.assumeThisType(oldRow)) {
        continue;
      }

      const oldTargets = new Map<string, TargetCache>();
      if (oldRow) {
        for (const target of oldRow.data.calc$.targetCaches) {
          oldTargets.set(target.selectionId, target);
        }
      }

      for (const target of newRow.data.calc$.targetCaches) {
        const oldTarget = oldTargets.get(target.selectionId);
        if (target.requestRollFormula !== oldTarget?.requestRollFormula) {
          if (!target.roll) {
            target.roll = UtilsRoll.toRollData(new Roll(target.requestRollFormula));
          } else {
            const oldRoll = UtilsRoll.fromRollData(target.roll);
            const result = await UtilsRoll.setRoll(oldRoll, target.requestRollFormula);
            target.roll = UtilsRoll.toRollData(result.result);
            if (result.rollToDisplay) {
              // Auto rolls if original roll was already evaluated
              UtilsDiceSoNice.showRoll({roll: result.rollToDisplay});
            }
          }
        }

        // Execute initial roll
        if ((target.phase === 'result') !== target.roll?.evaluated) {
          const roll = UtilsRoll.fromRollData(target.roll);
          target.roll = UtilsRoll.toRollData(await roll.roll({async: true}));
          UtilsDiceSoNice.showRoll({roll: roll});
        }
      }
    }
  }
  //#endregion

  //#region afterUpdate
  public afterUpdate(context: IAfterDmlContext<ModularCardTriggerData<any>>): void | Promise<void> {
    this.onBonusChange(context);
  }
  
  private onBonusChange(context: IDmlContext<ModularCardTriggerData>): void {
    for (const {newRow, oldRow, changedByUserId} of context.rows) {
      if (changedByUserId !== game.userId || !this.isThisType(newRow) || !this.assumeThisType(oldRow)) {
        continue;
      }
      for (let i = 0; i < newRow.data.calc$.targetCaches.length; i++) {
        const newCache = newRow.data.calc$.targetCaches[i];
        const oldCache = oldRow?.data?.calc$?.targetCaches?.[i];
        if (newCache.phase === 'bonus-input' && oldCache.phase !== 'bonus-input') {
          MemoryStorageService.setFocusedElementSelector(`${CheckCardPart.instance.getSelector()}[data-message-id="${newRow.messageId}"][data-part-id="${newRow.id}"] input.user-bonus`);
          return;
        }
      }
    }
  }
  //#endregion 
  
  //#region helpers
  private isThisType(row: ModularCardTriggerData): row is ModularCardTriggerData<CheckCardData> {
    if (row.type !== CheckCardPart.instance.getType()) {
      return false;
    }
    if (row.typeHandler) {
      return row.typeHandler instanceof CheckCardPart;
    }
    return ModularCard.getTypeHandler(row.type) instanceof CheckCardPart;
  }

  private isAnyTargetType(row: ModularCardTriggerData): row is ModularCardTriggerData<TargetCardData> {
    return row.typeHandler instanceof TargetCardPart;
  }

  private assumeThisType(row: ModularCardTriggerData): row is ModularCardTriggerData<CheckCardData> {
    return true;
  }
  //#endregion

}