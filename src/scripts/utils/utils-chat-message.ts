import { ChatMessageDataConstructorData } from "@league-of-foundry-developers/foundry-vtt-types/src/foundry/common/data/data.mjs/chatMessageData";
import { ActiveEffectData } from "@league-of-foundry-developers/foundry-vtt-types/src/foundry/common/data/module.mjs";
import { IDmlContext, DmlTrigger, IDmlTrigger, IAfterDmlContext } from "../lib/db/dml-trigger";
import MyAbilityTemplate from "../pixi/ability-template";
import { provider } from "../provider/provider";
import { MemoryStorageService } from "../service/memory-storage-service";
import { staticValues } from "../static-values";
import { DamageType, MyActor, MyActorData, MyItem, MyItemData } from "../types/fixed-types";
import { UtilsDiceSoNice } from "../lib/roll/utils-dice-so-nice";
import { UtilsDocument } from "../lib/db/utils-document";
import { UtilsRoll } from "../lib/roll/utils-roll";
import { TemplateDetails, UtilsTemplate } from "./utils-template";

// TODO I really need modular item cards.
//      It should be split into parts (attack+dmg & save & template & ...) so other items like 'bardic inspiration' or 'sneak attack' can add to the card

export interface ItemCardActor {
  uuid: string;
  calc$?: {
    level: number;
    pactLevel: number;
  }
}

export type RollJson = ReturnType<Roll['toJSON']>

type RollPhase = 'mode-select' | 'bonus-input' | 'result';
export interface ItemCardItem {
  uuid: string;
  selectedlevel?: number | 'pact';
  attack?: {
    phase: RollPhase;
    mode: 'normal' | 'advantage' | 'disadvantage';
    userBonus: string;
    calc$: {
      label?: string;
      rollBonus?: string;
      evaluatedRoll?: RollJson;
      critTreshold: number;
      isCrit?: boolean;
    }
  },
  damages?: {
    phase: RollPhase;
    mode: 'normal' | 'critical';
    userBonus: string;
    calc$: {
      label: string;
      modfierRule?: 'save-full-dmg' | 'save-halve-dmg' | 'save-no-dmg';
      baseRoll: RollJson;
      upcastRoll?: RollJson;
      actorBonusRoll?: RollJson;
      normalRoll?: RollJson;
      criticalRoll?: RollJson;
      displayDamageTypes?: string;
      displayFormula?: string;
    }
  }[];
  targets?: {
    uuid: string;
    check?: {
      phase: RollPhase;
      userBonus: string;
      mode: 'normal' | 'advantage' | 'disadvantage';
      calc$: {
        evaluatedRoll?: RollJson;
      }
    }
    applyDmg?: boolean;
    calc$?: {
      actorUuid: string;
      ac: number;
      img?: string;
      name?: string;
      hpSnapshot: {
        maxHp: number;
        hp: number;
        temp?: number;
      },
      immunities: string[];
      resistances: string[];
      vulnerabilities: string[];
      result: {
        hit?: boolean;
        checkPass?: boolean;
        dmg?: {
          type: DamageType;
          rawNumber: number;
          calcNumber: number;
        },
        appliedActiveEffects: boolean; // The UUIDs of the newly created effects
      }
    }
  }[];
  consumeResources: {
    consumeResourcesAction?: 'undo' | 'manual-apply';
    calc$: {
      uuid: string;
      path: string;
      amount: number;
      original: number;
      autoconsumeAfter?: 'init' | 'attack' | 'damage' | 'check' | 'template-placed';
      applied: boolean;
    }
  }[];
  calc$?: {
    name: string;
    img: string;
    type: string;
    level?: number;
    description?: string;
    materials?: string;
    properties?: string[];
    canChangeTargets: boolean;
    activeEffectsData: ActiveEffectData[];
    requiresSpellSlot: boolean;
    check?: {
      ability: keyof MyActor['data']['data']['abilities'];
      dc: number;
      label?: string;
      skill?: string;
      addSaveBonus?: boolean;
    };
    rangeDefinition: MyItemData['data']['range'];
    targetDefinition: {
      hasAoe: boolean,
      createdTemplateUuid?: string;
    } & MyItemData['data']['target'];
    allConsumeResourcesApplied: boolean;
    canChangeLevel: boolean;
  }
}

export interface ItemCardToken {
  uuid: string;
}

export interface ItemCard {
  actor?: ItemCardActor;
  items: ItemCardItem[];
  token?: ItemCardToken;
  calc$?: {
    allDmgApplied?: boolean;
    targetAggregate?: {
      uuid: string;
      actorUuid: string;
      img?: string;
      name?: string;
      hpSnapshot: {
        maxHp: number;
        hp: number;
        temp?: number;
      },
      dmg?: {
        avoided?: boolean;
        applied: boolean,
        appliedDmg: number,
        rawDmg: number;
        calcDmg: number;
        calcHp: number;
        calcTemp: number;
      },
    }[];
  }
}

interface ClickEvent {
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
}
interface KeyEvent {
  readonly key: 'Enter' | 'Escape';
}
type InteractionResponse = {success: true;} | {success: false; errorMessage: string, errorType: 'warn' | 'error'}
interface ActionParam {clickEvent: ClickEvent, userId: string, keyEvent?: KeyEvent, regexResult: RegExpExecArray, messageId: string, messageData: ItemCard, inputValue?: boolean | number | string};
type ActionPermissionCheck = ({}: ActionParam) => {actorUuid?: string, tokenUuid?: string, message?: boolean, gm?: boolean, onlyRunLocal?: boolean};
type ActionPermissionExecute = ({}: ActionParam) => Promise<void | ItemCard>;



export class UtilsChatMessage {

  private static readonly actionMatches: Array<{regex: RegExp, permissionCheck: ActionPermissionCheck, execute: ActionPermissionExecute}> = [
    {
      regex: /^toggle-collapse$/,
      permissionCheck: () => {return {onlyRunLocal: true}},
      execute: ({messageId}) => UtilsChatMessage.toggleCollapse(messageId),
    },
    {
      regex: /^item-([0-9]+)-upcastlevel$/,
      permissionCheck: ({messageData}) => {return {actorUuid: messageData.actor?.uuid}},
      execute: ({regexResult, inputValue, messageData}) => UtilsChatMessage.upcastlevelChange(Number(regexResult[1]), inputValue as string, messageData),
    },
    {
      regex: /^item-([0-9]+)-check-([a-zA-Z0-9\.]+)$/,
      permissionCheck: ({regexResult}) => {return {tokenUuid: regexResult[2]}},
      execute: ({clickEvent, regexResult, messageData}) => UtilsChatMessage.processItemCheck(clickEvent, Number(regexResult[1]), regexResult[2], messageData),
    },
    {
      regex: /^item-([0-9]+)-check-([a-zA-Z0-9\.]+)-bonus$/,
      permissionCheck: ({regexResult}) => {return {tokenUuid: regexResult[2]}},
      execute: ({keyEvent, regexResult, inputValue, messageData}) => UtilsChatMessage.processItemCheckBonus(keyEvent, Number(regexResult[1]), regexResult[2], inputValue as string, messageData),
    },
    {
      regex: /^item-([0-9]+)-check-([a-zA-Z0-9\.]+)-mode-(minus|plus)$/,
      permissionCheck: ({regexResult}) => {return {tokenUuid: regexResult[2]}},
      execute: ({clickEvent, regexResult, messageData}) => UtilsChatMessage.processItemCheckMode(clickEvent, Number(regexResult[1]), regexResult[2], regexResult[3] as ('plus' | 'minus'), messageData),
    },
    {
      regex: /^item-([0-9]+)-template$/,
      permissionCheck: ({}) => {return {onlyRunLocal: true, message: true}},
      execute: ({regexResult, messageData, messageId}) => UtilsChatMessage.processItemTemplate(Number(regexResult[1]), messageData, messageId),
    },
    {
      regex: /^apply-consume-resource-((?:[0-9]+)|\*)-((?:[0-9]+)|\*)$/,
      permissionCheck: ({messageData}) => {return {message: true, actorUuid: messageData.actor?.uuid}},
      execute: ({regexResult, messageData}) => {
        let itemIndex: '*' | number = regexResult[1] === '*' ? '*' : Number.parseInt(regexResult[1]);
        let consumeResourceIndex: '*' | number = regexResult[2] === '*' ? '*' : Number.parseInt(regexResult[2]);
        return UtilsChatMessage.manualApplyConsumeResource(messageData, itemIndex, consumeResourceIndex);
      },
    },
    {
      regex: /^undo-consume-resource-((?:[0-9]+)|\*)-((?:[0-9]+)|\*)$/,
      permissionCheck: ({messageData}) => {return {message: true, actorUuid: messageData.actor?.uuid}},
      execute: ({regexResult, messageData}) => {
        let itemIndex: '*' | number = regexResult[1] === '*' ? '*' : Number.parseInt(regexResult[1]);
        let consumeResourceIndex: '*' | number = regexResult[2] === '*' ? '*' : Number.parseInt(regexResult[2]);
        return UtilsChatMessage.manualUndoConsumeResource(messageData, itemIndex, consumeResourceIndex);
      },
    },
    {
      regex: /^apply-damage-((?:[a-zA-Z0-9\.]+)|\*)$/,
      permissionCheck: ({}) => {return {gm: true}},
      execute: ({regexResult, messageId, messageData}) => UtilsChatMessage.applyDamage([regexResult[1]], messageData, messageId),
    },
    {
      regex: /^undo-damage-((?:[a-zA-Z0-9\.]+)|\*)$/,
      permissionCheck: ({}) => {return {gm: true}},
      execute: ({regexResult, messageId, messageData}) => UtilsChatMessage.undoDamage(regexResult[1], messageData, messageId),
    },
  ];

  private static get spellUpcastModes(): Array<MyItemData['data']['preparation']['mode']> {
    return (CONFIG as any).DND5E.spellUpcastModes;
  }

  public static registerHooks(): void {
    Hooks.on('renderChatLog', () => {
      const chatElement = document.getElementById('chat-log');
      chatElement.addEventListener('click', event => UtilsChatMessage.onClick(event));
      chatElement.addEventListener('focusout', event => UtilsChatMessage.onBlur(event));
      chatElement.addEventListener('keydown', event => UtilsChatMessage.onKeyDown(event));
      chatElement.addEventListener('change', event => UtilsChatMessage.onChange(event));
    });

    Hooks.on("init", () => {
      // register templates parts
      loadTemplates([
        'modules/nils-automated-compendium/templates/damage.hbs',
        'modules/nils-automated-compendium/templates/roll/roll.hbs',
        'modules/nils-automated-compendium/templates/roll/tooltip.hbs'
      ]);
    });
    
    DmlTrigger.registerTrigger(new DmlTriggerChatMessage());
    DmlTrigger.registerTrigger(new DmlTriggerTemplate());
    DmlTrigger.registerTrigger(new DmlTriggerUser());
    
    provider.getSocket().then(socket => {
      socket.register('onInteraction', (params: Parameters<typeof UtilsChatMessage['onInteractionProcessor']>[0]) => {
        return UtilsChatMessage.onInteractionProcessor(params);
      })
    });
  }

  //#region public conversion utils
  public static async createCard(data: {actor?: MyActor, token?: TokenDocument, items: ItemCardItem[]}, insert: boolean = true): Promise<ChatMessage> {
    // I expect actor & token to sometimes include the whole actor/token document by accident
    // While I would prefer a full type validation, it is the realistic approach
    const card: ItemCard = {
      items: data.items
    }
    if (data.actor) {
      let actorLevel = 0;
      if (data.actor.type === "character") {
        actorLevel = data.actor.data.data.details.level;
      } else {
        actorLevel = Math.ceil(data.actor.data.data.details.cr);
      }
      card.actor = {
        uuid: data.actor.uuid,
        calc$: {
          level: actorLevel,
          pactLevel: data.actor.data.data?.spells?.pact?.level ?? 0,
        }
      }

      if (!data.token) {
        if (data.actor.token) {
          card.token = {
            uuid: data.actor.token.uuid
          }
        } else {
          const tokenDocuments = data.actor.getActiveTokens(true, true);
          // TODO this is not ideal but the original token is lost. Maybe see if other modules like tokenhud give it to the item.displayCard() as a parameter
          if (tokenDocuments.length === 1) {
            card.token = {
              uuid: tokenDocuments[0].uuid
            }
          }
        }
      }
    }
    if (data.token) {
      card.token = {
        uuid: data.token.uuid
      }
    }

    const chatMessageData: ChatMessageDataConstructorData = {
      flags: {
        [staticValues.moduleName]: {
          clientTemplate: `modules/${staticValues.moduleName}/templates/item-card.hbs`,
          clientTemplateData: {
            staticValues: staticValues,
            data: card,
          }
        }
      }
    };

    if (game.settings.get('core', 'rollMode') === 'gmroll') {
      chatMessageData.whisper = [game.userId];
      for (const user of game.users.values()) {
        if (user.isGM) {
          chatMessageData.whisper.push(user.id);
        }
      }
    }
    if (game.settings.get('core', 'rollMode') === 'blindroll') {
      for (const user of game.users.values()) {
        chatMessageData.whisper = [];
        chatMessageData.blind = true;
        if (user.isGM) {
          chatMessageData.whisper.push(user.id);
        }
      }
    }
    if (game.settings.get('core', 'rollMode') === 'selfroll') {
      chatMessageData.whisper = [game.userId];
    }

    if (insert) {
      return await ChatMessage.create(chatMessageData)
    } else {
      return new ChatMessage(chatMessageData);
    }
  }

  public static async createDefaultItemData({item, actor}: {item: MyItem, actor?: MyActor}): Promise<ItemCardItem> {
    const itemCardData: ItemCardItem = {
      uuid: item.uuid,
      selectedlevel: item.data.data?.preparation?.mode === 'pact' ? 'pact' : item.data.data.level,
      consumeResources: [],
      calc$: {
        name: item.data.name,
        img: item.img,
        type: item.type,
        description: item.data.data.description?.value,
        materials: item.data.data.materials?.value,
        properties: item.getChatData().properties,
        level: item.data.data.level,
        canChangeTargets: true,
        requiresSpellSlot: false,
        rangeDefinition: item.data.data.range,
        targetDefinition: {
          // @ts-expect-error
          hasAoe: CONFIG.DND5E.areaTargetTypes.hasOwnProperty(item.data.data.target.type),
          ...item.data.data.target,
        },
        allConsumeResourcesApplied: true,
        canChangeLevel: true,
        activeEffectsData:  Array.from(item.effects.values())
          .map(effect => {
            const data = deepClone(effect.data);
            delete data._id;
            return data;
          })
          .filter(effectData => !effectData.transfer),
      }
    };
    const isSpell = item.type === "spell";
    // Items passed by external sources (like external calls to Item.displayCard) may pass an upcasted version of the item.
    // Fetch the original item to know what the original level
    const queriedItem = await UtilsDocument.itemFromUuid(item.uuid);
    itemCardData.calc$.level = queriedItem.data.data.level;

    // TODO issue with @mod? maybe issue from an ohter module
    const rollData: {[key: string]: any} = actor == null ? {} : item.getRollData();
    if (item.data.data.prof?.hasProficiency) {
      rollData.prof = item.data.data.prof.term;
    }

    // Saving throw
    if (item.data.data.save.dc != null && item.data.data.save.ability) {
      itemCardData.calc$.check = {
        ability: item.data.data.save.ability,
        dc: item.data.data.save.dc,
        addSaveBonus: true,
      }
    }

    // Damage modifier
    if (itemCardData.calc$.check && itemCardData.damages) {
      let modfierRule: ItemCardItem['damages'][0]['calc$']['modfierRule'] = 'save-halve-dmg';
      if (item.type === 'spell') {
        if (item.data.data.level === 0) {
          // Official cantrips never deal half damage
          modfierRule = 'save-no-dmg';
        }
      }

      // TODO be smart like midi-qol and inject add these type into the item sheet
      for (const damage of itemCardData.damages) {
        damage.calc$.modfierRule = modfierRule;
      }
    }

    // Consume actor resources
    if (actor) {
      itemCardData.calc$.requiresSpellSlot = isSpell && itemCardData.calc$.level > 0 && UtilsChatMessage.spellUpcastModes.includes(item.data.data.preparation.mode);
      if (itemCardData.calc$.requiresSpellSlot) {
        let spellPropertyName = item.data.data.preparation.mode === "pact" ? "pact" : `spell${itemCardData.calc$.level}`;
        itemCardData.consumeResources.push({
          calc$: {
            uuid: actor.uuid,
            path: `data.spells.${spellPropertyName}.value`,
            amount: 1,
            original: actor?.data?.data?.spells?.[spellPropertyName]?.value ?? 0,
            applied: false
          }
        });
      }

      switch (item.data.data.consume.type) {
        case 'attribute': {
          if (item.data.data.consume.target && item.data.data.consume.amount > 0) {
            let propertyPath = `data.${item.data.data.consume.target}`;
            itemCardData.consumeResources.push({
              calc$: {
                uuid: actor.uuid,
                path: propertyPath,
                amount: item.data.data.consume.amount,
                original: getProperty(actor.data, propertyPath) ?? 0,
                applied: false
              }
            });
          }
          break;
        }
      }
    }

    // Consume item resources
    switch (item.data.data.consume.type) {
      case 'ammo':
      case 'material': {
        if (item.data.data.consume.target && item.data.data.consume.amount > 0) {
          const targetItem = item.actor.items.get(item.data.data.consume.target);
          let propertyPath = `data.quantity`;
          itemCardData.consumeResources.push({
            calc$: {
              uuid: targetItem.uuid,
              path: propertyPath,
              amount: item.data.data.consume.amount,
              original: getProperty(targetItem.data, propertyPath) ?? 0,
              applied: false
            }
          });
        }
        break;
      }
      case 'charges': {
        if (item.data.data.consume.target && item.data.data.consume.amount > 0) {
          const targetItem = item.actor.items.get(item.data.data.consume.target);
          let propertyPath = `data.uses.value`;
          itemCardData.consumeResources.push({
            calc$: {
              uuid: targetItem.uuid,
              path: propertyPath,
              amount: item.data.data.consume.amount,
              original: getProperty(targetItem.data, propertyPath) ?? 0,
              applied: false
            }
          });
        }
        break;
      }
    }
    
    if (item.data.data.uses?.per != null && item.data.data.uses?.per != '') {
      let propertyPath = `data.uses.value`;
      itemCardData.consumeResources.push({
        calc$: {
          uuid: item.uuid,
          path: propertyPath,
          amount: 1,
          original: getProperty(item.data, propertyPath) ?? 0,
          applied: false
        }
      });
    }

    for (const consumeResource of itemCardData.consumeResources) {
      if (consumeResource.calc$.autoconsumeAfter == null) {
        if (itemCardData.attack) {
          consumeResource.calc$.autoconsumeAfter = 'attack';
        } else if (itemCardData.damages?.length) {
          consumeResource.calc$.autoconsumeAfter = 'damage';
        } else if (itemCardData.calc$.targetDefinition?.hasAoe) {
          consumeResource.calc$.autoconsumeAfter = 'template-placed';
        } else if (itemCardData.calc$.check) {
          consumeResource.calc$.autoconsumeAfter = 'check';
        } else {
          consumeResource.calc$.autoconsumeAfter = 'init';
        }
      }
    }

    return itemCardData;
  }

  //#endregion

  //#region routing
  private static async onClick(event: MouseEvent): Promise<void> {
    if (event.target instanceof HTMLInputElement) {
      // do not register clicks on inputs, except checkboxes
      const input = event.target as HTMLInputElement;
      if (input.type !== 'checkbox') {
        return;
      }
    }
    if (event.target instanceof HTMLSelectElement || event.target instanceof HTMLOptionElement) {
      return;
    }
    if (event.target instanceof Node) {
      UtilsChatMessage.onInteraction({
        clickEvent: event,
        element: event.target as Node
      });
    }
  }

  private static async onBlur(event: FocusEvent): Promise<void> {
    if (event.target instanceof HTMLInputElement) {
      // blur does not work very well with checkboxes => listen to click event
      const input = event.target as HTMLInputElement;
      if (input.type === 'checkbox') {
        return;
      }
      if (event.target instanceof Node) {
        UtilsChatMessage.onInteraction({
          element: event.target as Node
        });
      }
    }
  }

  private static async onKeyDown(event: KeyboardEvent): Promise<void> {
    if (event.target instanceof HTMLInputElement && ['Enter', 'Escape'].includes(event.key)) {
      UtilsChatMessage.onInteraction({
        element: event.target as Node,
        keyEvent: {
          key: event.key as KeyEvent['key']
        },
      });
    }
  }

  private static async onChange(event: Event): Promise<void> {
    if (event.target instanceof Node) {
      UtilsChatMessage.onInteraction({
        element: event.target as Node
      });
    }
  }

  private static async onInteraction({clickEvent, element, keyEvent}: {element: Node, clickEvent?: ClickEvent, keyEvent?: KeyEvent}): Promise<void> {
    clickEvent = {
      altKey: clickEvent?.altKey === true,
      ctrlKey: clickEvent?.ctrlKey === true,
      metaKey: clickEvent?.metaKey === true,
      shiftKey: clickEvent?.shiftKey === true,
    }
    keyEvent = !keyEvent ? null : {
      key: keyEvent.key
    };

    let messageId: string;
    let action: string;
    let currentElement = element;
    let inputValue: boolean | number | string;
    while (currentElement != null) {
      if (currentElement instanceof HTMLElement) {
        if (currentElement.dataset.messageId != null) {
          messageId = currentElement.dataset.messageId;
        }
        if (currentElement.hasAttribute(`data-${staticValues.moduleName}-action`)) {
          action = currentElement.getAttribute(`data-${staticValues.moduleName}-action`);
          
          if (currentElement instanceof HTMLInputElement) {
            if (['radio', 'checkbox'].includes(currentElement.type)) {
              inputValue = currentElement.checked;
            } else if (['number'].includes(currentElement.type)) {
              inputValue = Number(currentElement.value);
            } else {
              inputValue = currentElement.value;
            }
          } else if (currentElement instanceof HTMLSelectElement) {
            inputValue = currentElement.value;
          }
        }
      }

      currentElement = currentElement.parentNode;
    }

    if (!action) {
      return;
    }
    if (messageId == null) {
      console.warn(`pressed a ${staticValues.moduleName} action button but no message was found`);
      return;
    }
    
    const message = game.messages.get(messageId);
    const messageData = InternalFunctions.getItemCardData(message);
    if (messageData == null) {
      console.warn(`pressed a ${staticValues.moduleName} action button for message ${messageId} but no data was found`);
      return;
    }

    const actions = await UtilsChatMessage.getActions(action, clickEvent, keyEvent, game.userId, messageId, messageData);
    if (actions.missingPermissions) {
      console.warn(`pressed a ${staticValues.moduleName} action button for message ${messageId} with action ${action} for current user but permissions are missing`)
      return;
    }
    if (actions.actionsToExecute.length === 0) {
      console.debug('no actions found')
      return;
    }

    const request: Parameters<typeof UtilsChatMessage['onInteractionProcessor']>[0] = {
      clickEvent: clickEvent,
      keyEvent: keyEvent,
      userId: game.userId,
      messageId: messageId,
      action: action,
      inputValue: inputValue,
    }

    let response: InteractionResponse;
    
    if (element instanceof HTMLButtonElement || element instanceof HTMLInputElement) {
      element.disabled = true;
    }
    try {
      if (actions.onlyRunLocal || message.canUserModify(game.user, 'update')) {
        // User has all required permissions, run locally
        response = await UtilsChatMessage.onInteractionProcessor(request);
      } else {
        response = await provider.getSocket().then(socket => socket.executeAsGM('onInteraction', request));
      }
    } finally {
      if (element instanceof HTMLButtonElement || element instanceof HTMLInputElement) {
        element.disabled = false;
      }
    }

    if (response.success === false) {
      if (response.errorType === 'warn') {
        console.warn(response.errorMessage);
        ui.notifications.warn(response.errorMessage);
      }
      if (response.errorType === 'error') {
        console.error(response.errorMessage);
        ui.notifications.error(response.errorMessage);
      }
    }
  }

  private static async onInteractionProcessor({clickEvent, keyEvent, userId, messageId, action, inputValue}: {
    clickEvent: ClickEvent,
    keyEvent: KeyEvent,
    userId: string,
    messageId: string,
    action: string,
    inputValue?: ActionParam['inputValue'];
  }): Promise<InteractionResponse> {
    const message = game.messages.get(messageId);
    const messageData = InternalFunctions.getItemCardData(message);
    if (messageData == null) {
      return {
        success: false,
        errorType: 'warn',
        errorMessage: `pressed a ${staticValues.moduleName} action button for message ${messageId} but no data was found`,
      };
    }

    const actions = await UtilsChatMessage.getActions(action, clickEvent, keyEvent, userId, messageId, messageData);
    if (action && actions.actionsToExecute.length === 0) {
      return {
        success: false,
        errorType: 'error',
        errorMessage: `pressed a ${staticValues.moduleName} action button for message ${messageId} with action ${action} for user ${userId} but permissions are missing`,
      };
    }
    
    let latestMessageData = deepClone(messageData);
    let doUpdate = false;
    
    for (const action of actions.actionsToExecute) {
      const param: ActionParam = {clickEvent: clickEvent, userId: userId, keyEvent: keyEvent, regexResult: action.regex, messageId: messageId, messageData: latestMessageData, inputValue: inputValue};
      try {
        let response = await action.action.execute(param);
        if (response) {
          doUpdate = true;
          latestMessageData = response;
        }
      } catch (err) {
        return {
          success: false,
          errorMessage: err instanceof Error ? err.message : String(err),
          errorType: 'error'
        }
      }
    }

    if (doUpdate) {
      // Don't use await so you can return a response faster to the client
      InternalFunctions.saveItemCardData(messageId, latestMessageData);
    }

    return {
      success: true,
    }
  }

  private static async getActions(action: string, clickEvent: ClickEvent, keyEvent: KeyEvent, userId: string, messageId: string, messageData: ItemCard): Promise<{missingPermissions: boolean, onlyRunLocal: boolean, actionsToExecute: Array<{action: typeof UtilsChatMessage.actionMatches[0], regex: RegExpExecArray}>}> {
    if (!action) {
      return {
        missingPermissions: false,
        onlyRunLocal: true,
        actionsToExecute: []
      };
    }
    const response = {
      missingPermissions: false, 
      onlyRunLocal: false,
      actionsToExecute: [] as Array<{
        action: typeof UtilsChatMessage.actionMatches[0],
        regex: RegExpExecArray
      }>
    };

    const user = game.users.get(userId);
    for (const actionMatch of UtilsChatMessage.actionMatches) {
      const result = actionMatch.regex.exec(action);
      if (result) {
        const permissionCheck = actionMatch.permissionCheck({clickEvent: clickEvent, userId: userId, keyEvent: keyEvent, regexResult: result, messageId: messageId, messageData: messageData});
        if (permissionCheck.onlyRunLocal === true) {
          response.onlyRunLocal = true;
        }
        if (permissionCheck.message) {
          // Is not author and is no gm
          if (game.messages.get(messageId).data.user !== userId && !user.isGM) {
            response.missingPermissions = true;
            continue;
          }
        }
        let actorUuids: string[] = [];
        if (permissionCheck.actorUuid) {
          actorUuids.push(permissionCheck.actorUuid);
        }
        if (permissionCheck.tokenUuid) {
          const actorUuid = ((await UtilsDocument.tokenFromUuid(permissionCheck.tokenUuid))?.getActor() as MyActor)?.uuid;
          if (actorUuid) {
            actorUuids.push(actorUuid);
          }
        }
        for (const actorUuid of actorUuids) {
          const actor = await UtilsDocument.actorFromUuid(actorUuid);
          if (actor && !actor.testUserPermission(user, 'OWNER')) {
            response.missingPermissions = true;
            continue;
          }
        }
        if (permissionCheck.gm) {
          if (!user.isGM) {
            response.missingPermissions = true;
            continue;
          }
        }

        response.actionsToExecute.push({
          action: actionMatch,
          regex: result
        });
      }
    }


    return response;
  }
  //#endregion

  //#region check
  private static async processItemCheck(event: ClickEvent, itemIndex: number, targetUuid: string, messageData: ItemCard): Promise<void | ItemCard> {
    const itemCheck = messageData.items?.[itemIndex]?.calc$?.check;
    if (!itemCheck) {
      console.warn('No check found')
      return;
    }
    
    let target: ItemCardItem['targets'][0];
    if (messageData.items[itemIndex].targets) {
      for (const t of messageData.items[itemIndex].targets) {
        if (t.uuid === targetUuid) {
          target = t;
          break;
        }
      }
    }

    if (!target || target.check.phase === 'result') {
      return;
    }

    const orderedPhases: RollPhase[] = ['mode-select', 'bonus-input', 'result'];
    if (event.shiftKey) {
      target.check.phase = orderedPhases[orderedPhases.length - 1];
    } else {
      target.check.phase = orderedPhases[orderedPhases.indexOf(target.check.phase) + 1];
    }

    if (orderedPhases.indexOf(target.check.phase) === orderedPhases.length - 1) {
      const response = await UtilsChatMessage.processItemCheckRoll(itemIndex, targetUuid, messageData);
      if (response) {
        messageData = response;
      }
    }

    return messageData;
  }
  
  private static async processItemCheckBonus(keyEvent: KeyEvent | null, itemIndex: number, targetUuid: string, attackBonus: string, messageData: ItemCard): Promise<void | ItemCard> {
    const itemCheck = messageData.items?.[itemIndex]?.calc$?.check;
    if (!itemCheck) {
      console.warn('No check found')
      return;
    }
    
    let target: ItemCardItem['targets'][0];
    if (messageData.items[itemIndex].targets) {
      for (const t of messageData.items[itemIndex].targets) {
        if (t.uuid === targetUuid) {
          target = t;
          break;
        }
      }
    }

    if (!target || target.check.phase === 'result') {
      return;
    }

    const oldPhase = target.check.phase;
    const oldBonus = target.check.userBonus;
    if (attackBonus) {
      target.check.userBonus = attackBonus;
    } else {
      target.check.userBonus = "";
    }

    if (target.check.userBonus && !Roll.validate(target.check.userBonus) && keyEvent) {
      // Only show error on key press
      throw new Error(game.i18n.localize('Error') + ': ' + game.i18n.localize('Roll Formula'));
    }

    if (keyEvent?.key === 'Enter') {
      const response = await UtilsChatMessage.processItemCheckRoll(itemIndex, targetUuid, messageData);
      if (response) {
        return response;
      }
    } else if (keyEvent?.key === 'Escape') {
      target.check.phase = 'mode-select';
    }

    if (target.check.userBonus !== oldBonus || target.check.phase !== oldPhase) {
      return messageData;
    }
  }

  private static async processItemCheckMode(event: ClickEvent, itemIndex: number, targetUuid: string, modName: 'plus' | 'minus', messageData: ItemCard): Promise<void | ItemCard> {
    if (!messageData.items?.[itemIndex]?.calc$?.check) {
      console.warn('No check found')
      return;
    }

    let target: ItemCardItem['targets'][0];
    if (messageData.items[itemIndex].targets) {
      for (const t of messageData.items[itemIndex].targets) {
        if (t.uuid === targetUuid) {
          target = t;
          break;
        }
      }
    }
  
    let modifier = modName === 'plus' ? 1 : -1;
    if (event.shiftKey && modifier > 0) {
      modifier++;
    } else if (event.shiftKey && modifier < 0) {
      modifier--;
    }
    
    const order: Array<typeof target.check.mode> = ['disadvantage', 'normal', 'advantage'];
    const newIndex = Math.max(0, Math.min(order.length-1, order.indexOf(target.check.mode) + modifier));
    if (target.check.mode === order[newIndex]) {
      return;
    }
    target.check.mode = order[newIndex];
    if (!target.check.calc$.evaluatedRoll) {
      return messageData;
    }

    const originalRoll = Roll.fromJSON(JSON.stringify(target.check.calc$.evaluatedRoll));
    target.check.calc$.evaluatedRoll = (await UtilsRoll.setRollMode(originalRoll, target.check.mode)).toJSON();

    return messageData;
  }

  private static async processItemCheckRoll(itemIndex: number, targetUuid: string, messageData: ItemCard): Promise<void | ItemCard> {
    if (!messageData.items?.[itemIndex]?.calc$.check) {
      console.warn('No check found')
      return;
    }
    const targetActor = (await UtilsDocument.tokenFromUuid(targetUuid)).getActor() as MyActor;

    let target: ItemCardItem['targets'][0];
    if (messageData.items[itemIndex].targets) {
      for (const t of messageData.items[itemIndex].targets) {
        if (t.uuid === targetUuid) {
          target = t;
          break;
        }
      }
    }
    if (!target || target.check?.calc$.evaluatedRoll?.evaluated) {
      return;
    }
    
    const check = messageData.items[itemIndex].calc$.check;

    let roll = UtilsRoll.getAbilityRoll(targetActor, {ability: check.ability, skill: check.skill, addSaveBonus: check.addSaveBonus});
    if (target.check.userBonus) {
      roll = new Roll(roll.formula + ' + ' + target.check.userBonus);
    }
    roll = await UtilsRoll.setRollMode(roll, target.check.mode);
    roll = await UtilsRoll.simplifyTerms(roll).roll({async: true});
    UtilsDiceSoNice.showRoll({roll: roll});

    target.check.calc$ = target.check.calc$ ?? {};
    target.check.calc$.evaluatedRoll = roll.toJSON();
    target.check.phase = 'result';

    return messageData;
  }
  //#endregion

  //#region damage
  private static async applyDamage(tokenUuid: (string | '*')[], messageData: ItemCard, messageId: string): Promise<void | ItemCard> {
    if (!messageData.calc$?.targetAggregate) {
      return;
    }
    let targetAggregates: ItemCard['calc$']['targetAggregate'];
    if (tokenUuid.includes('*')) {
      targetAggregates = messageData.calc$.targetAggregate;
    } else {
      targetAggregates = messageData.calc$.targetAggregate.filter(aggr => tokenUuid.includes(aggr.uuid));
    }
    if (!targetAggregates.length) {
      console.warn(`Could not find an aggregate for token "${tokenUuid}" with messageId "${messageId}"`);
      return;
    }

    // TODO idea: popup to prompt a custom apply amount when applying to 1 token
    // TODO idea: apply all does not apply to tokens which have already received damage

    const tokenActorUpdates = new Map<string, DeepPartial<MyActorData>>();
    let appliedToTokenUuids: string[] = [];
    for (const aggregate of targetAggregates) {
      appliedToTokenUuids.push(aggregate.uuid);
      const token = await UtilsDocument.tokenFromUuid(aggregate.uuid);
      const actor = token.getActor() as MyActor;
      aggregate.dmg.appliedDmg = aggregate.dmg.calcDmg;
      
      tokenActorUpdates.set(token.uuid, {
        _id: actor.id,
        data: {
          attributes: {
            hp: {
              value: aggregate.dmg.calcHp,
              temp: aggregate.dmg.calcTemp,
            }
          }
        }
      });
    }
    for (const item of messageData.items) {
      for (const target of item.targets ?? []) {
        if (appliedToTokenUuids.includes(target.uuid)) {
          target.applyDmg = true;
        }
      }
    }
    await UtilsDocument.updateTokenActors(tokenActorUpdates);
    return messageData;
  }
  
  private static async undoDamage(tokenUuid: string, messageData: ItemCard, messageId: string): Promise<void | ItemCard> {
    if (!messageData.calc$?.targetAggregate) {
      return;
    }
    let targetAggregates: ItemCard['calc$']['targetAggregate'];
    if (tokenUuid === '*') {
      targetAggregates = messageData.calc$.targetAggregate;
    } else {
      targetAggregates = messageData.calc$.targetAggregate.filter(aggr => aggr.uuid === tokenUuid);
    }
    if (!targetAggregates.length) {
      console.warn(`Could not find an aggregate for token "${tokenUuid}" with messageId "${messageId}"`);
      return;
    }

    
    const tokenActorUpdates = new Map<string, DeepPartial<MyActorData>>();
    let appliedToTokenUuids: string[] = [];
    for (const aggregate of targetAggregates) {
      appliedToTokenUuids.push(aggregate.uuid);
      const token = await UtilsDocument.tokenFromUuid(aggregate.uuid);
      const actor = token.getActor() as MyActor;
      aggregate.dmg.appliedDmg = 0;
      
      tokenActorUpdates.set(token.uuid, {
        _id: actor.id,
        data: {
          attributes: {
            hp: {
              value: aggregate.hpSnapshot.hp,
              temp: aggregate.hpSnapshot.temp,
            }
          }
        }
      });
    }
    for (const item of messageData.items) {
      for (const target of item.targets ?? []) {
        if (appliedToTokenUuids.includes(target.uuid)) {
          target.applyDmg = false;
        }
      }
    }
    await UtilsDocument.updateTokenActors(tokenActorUpdates);
    return messageData;
  }
  
  private static async upcastlevelChange(itemIndex: number, level: string, messageData: ItemCard): Promise<void | ItemCard> {
    const item = messageData.items?.[itemIndex];
    if (!item?.calc$?.canChangeLevel) {
      return;
    }

    const oldLevel = item.selectedlevel;
    item.selectedlevel = level === 'pact' ? level : Number.parseInt(level);
    if (Number.isNaN(item.selectedlevel)) {
      item.selectedlevel = oldLevel;
    }

    if (item.selectedlevel !== oldLevel) {
      return messageData;
    }
  }
  //#endregion

  //#region targeting
  private static async processItemTemplate(itemIndex: number, messageData: ItemCard, messageId: string): Promise<void> {
    const targetDefinition = messageData.items?.[itemIndex]?.calc$?.targetDefinition;
    if (!targetDefinition || !targetDefinition.hasAoe) {
      return;
    }
    if (!InternalFunctions.canChangeTargets(messageData.items[itemIndex])) {
      return;
    }

    const template = MyAbilityTemplate.fromItem({
      target: targetDefinition,
      flags: {
        [staticValues.moduleName]: {
          dmlCallbackMessageId: messageId,
          dmlCallbackItemIndex: itemIndex,
        }
      }
    });
    template.drawPreview();
  }
  //#endregion

  //#region consume resources
  private static async manualApplyConsumeResource(messageData: ItemCard, itemIndex: number | '*', resourceIndex: number | '*'): Promise<ItemCard | void> {
    const consumeResources: ItemCardItem['consumeResources'] = [];
    {
      const items = itemIndex === '*' ? messageData.items : [messageData.items[itemIndex]];
      for (const item of items) {
        if (resourceIndex === '*') {
          for (const consumeResource of item.consumeResources) {
            consumeResources.push(consumeResource)
          }
        } else if (item.consumeResources.length >= resourceIndex-1) {
          consumeResources.push(item.consumeResources[resourceIndex]);
        }
      }
    }

    let changed = false;
    for (const consumeResource of consumeResources) {
      if (consumeResource.consumeResourcesAction !== 'manual-apply') {
        consumeResource.consumeResourcesAction = 'manual-apply';
        changed = true;
      }
    }

    if (changed) {
      return messageData;
    }
  }

  private static async manualUndoConsumeResource(messageData: ItemCard, itemIndex: number | '*', resourceIndex: number | '*'): Promise<ItemCard | void> {
    const consumeResources: ItemCardItem['consumeResources'] = [];
    {
      const items = itemIndex === '*' ? messageData.items : [messageData.items[itemIndex]];
      for (const item of items) {
        if (resourceIndex === '*') {
          for (const consumeResource of item.consumeResources) {
            consumeResources.push(consumeResource)
          }
        } else if (item.consumeResources.length >= resourceIndex-1) {
          consumeResources.push(item.consumeResources[resourceIndex]);
        }
      }
    }

    let changed = false;
    for (const consumeResource of consumeResources) {
      if (consumeResource.consumeResourcesAction !== 'undo') {
        consumeResource.consumeResourcesAction = 'undo';
        changed = true;
      }
    }

    if (changed) {
      return messageData;
    }
  }
  //#endregion

  //#region misc
  private static async toggleCollapse(messageId: string): Promise<ItemCard | void> {
    MemoryStorageService.setCardCollapse(messageId, !MemoryStorageService.isCardCollapsed(messageId));
    ui.chat.updateMessage(game.messages.get(messageId));
  }
  //#endregion

}

class DmlTriggerUser implements IDmlTrigger<User> {

  get type(): typeof User {
    return User;
  }

  public async afterUpdate(context: IDmlContext<User>): Promise<void> {
    await this.recalcTargets(context);
  }

  private async recalcTargets(context: IDmlContext<User>): Promise<void> {
    let thisUserChanged = false;
    for (const user of context.rows) {
      if (user.newRow.id === game.userId) {
        thisUserChanged = true;
        break;
      }
    }
    if (!thisUserChanged) {
      return;
    }

    // Specifically the last general message, not of the user.
    // There needs to be some way of cutting off the ability to retarget when they are not relevant anymore
    // TODO this should probably be improved
    const chatMessage = InternalFunctions.getLatestMessage();
    if (!chatMessage || chatMessage.data.user !== game.userId) {
      return;
    }

    let messageData = InternalFunctions.getItemCardData(chatMessage);
    for (let itemIndex = messageData.items.length - 1; itemIndex >= 0; itemIndex--) {
      const item = messageData.items[itemIndex];
      if (item?.calc$.canChangeTargets) {
        // Re-evaluate the targets, the user may have changed targets
        const currentTargetUuids = new Set<string>(Array.from(game.user.targets).map(token => token.document.uuid));

        // Assume targets did not changes when non are selected at this time
        if (currentTargetUuids.size !== 0) {
          const itemTargetUuids = new Set<string>();
          if (item.targets) {
            for (const target of item.targets) {
              itemTargetUuids.add(target.uuid);
            }
          }

          let targetsChanged = itemTargetUuids.size !== currentTargetUuids.size;
          
          if (!targetsChanged) {
            for (const uuid of itemTargetUuids.values()) {
              if (!currentTargetUuids.has(uuid)) {
                targetsChanged = true;
                break;
              }
            }
          }

          if (targetsChanged) {
            const targetsUuids: string[] = [];
            if (item.targets) {
              for (const target of item.targets) {
                // The same target could have been originally targeted twice, keep that amount
                if (currentTargetUuids.has(target.uuid)) {
                  targetsUuids.push(target.uuid);
                }
              }
            }
            for (const currentTargetUuid of currentTargetUuids) {
              if (!targetsUuids.includes(currentTargetUuid)) {
                targetsUuids.push(currentTargetUuid);
              }
            }
            item.targets = targetsUuids.map(uuid => { return {uuid: uuid} });
            
            await InternalFunctions.saveItemCardData(chatMessage.id, messageData);
            // Only retarget 1 item
            return;
          }
        }
      }
    }
  }
}

class DmlTriggerChatMessage implements IDmlTrigger<ChatMessage> {

  get type(): typeof ChatMessage {
    return ChatMessage;
  }

  public async afterUpsert(context: IAfterDmlContext<ChatMessage>): Promise<void> {
    await this.applyActiveEffects(context);
    await this.recalcFutureHpSnapshots(context);
  }

  public afterUpdate(context: IAfterDmlContext<ChatMessage>): void {
    const log = document.querySelector("#chat-log");
    const isAtBottom = Math.abs(log.scrollHeight - (log.scrollTop + log.getBoundingClientRect().height)) < 2;
    if (isAtBottom) {
      setTimeout(() => {
        (ui.chat as any).scrollBottom();
      }, 0);
    }
  }

  public beforeUpdate(context: IDmlContext<ChatMessage>): void {
    this.onBonusChange(context);
    // TODO recalc whole item on level change to support custom scaling level scaling formulas
  }

  public async upsert(context: IAfterDmlContext<ChatMessage>): Promise<void> {
    const itemCards: ChatMessage[] = [];
    
    for (const {newRow} of context.rows) {
      const data = InternalFunctions.getItemCardData(newRow);
      if (data) {
        itemCards.push(newRow);
      }
    }
    if (itemCards.length > 0) {
      await this.setTargets(context);
      await this.calcTargets(context);
      await this.applyConsumeResources(context);
      this.calcItemCardCanChangeTargets(itemCards);
      this.calcCanChangeSpellLevel(itemCards);
      await this.calcConsumeResources(context);
      await this.calculateTargetResult(itemCards)
    }
  }

  public async afterDelete(context: IDmlContext<ChatMessage>): Promise<void> {
    for (const {newRow, changedByUserId} of context.rows) {
      if (changedByUserId !== game.userId) {
        continue;
      }
      const data = InternalFunctions.getItemCardData(newRow);
      if (!data) {
        continue;
      }
      const deleteTemplateUuids = new Set<string>();
      for (const item of data.items) {
        deleteTemplateUuids.add(item?.calc$?.targetDefinition?.createdTemplateUuid);
      }
      deleteTemplateUuids.delete(null);
      deleteTemplateUuids.delete(undefined);
  
      if (deleteTemplateUuids.size > 0) {
        UtilsDocument.bulkDelete(Array.from(((await UtilsDocument.templateFromUuid(deleteTemplateUuids)).values())).map(doc => {return {document: doc}}))
      }
    }
  }

  private async setTargets(context: IAfterDmlContext<ChatMessage>): Promise<void> {
    const calcTargets: Array<{type: 'circle/self' | 'self/self', data: ItemCard, item: ItemCardItem, messageUuid: string, userId: string}> = [];

    for (const {newRow, oldRow, changedByUserId} of context.rows) {
      const data = InternalFunctions.getItemCardData(newRow);
      if (!data) {
        continue;
      }
      const oldData = oldRow == null ? null : InternalFunctions.getItemCardData(oldRow);
      
      for (const [item, oldItem] of this.forNewAndOld(data.items, oldData?.items)) {
        if (item.uuid !== oldItem?.uuid) {
          // new/changed item => auto set targets
          let shapeType: null | 'self' | 'circle' = null;
          switch (item.calc$.targetDefinition.type) {
            case 'self': {
              shapeType = 'self';
              break;
            }
            case 'sphere':
            case 'radius':
            case 'cylinder': {
              shapeType = 'circle';
              break;
            }
            
            case 'ally':
            case 'enemy':
            case 'object':
            case 'creature': {
              // Consider measured distance units as a cirlce
              if  (['ft', 'mi', 'm', 'km'].includes(item.calc$.targetDefinition.units)) {
                shapeType = 'circle';
              }
              break;
            }
          }

          switch (shapeType) {
            case 'self': {
              if (data.token?.uuid) {
                calcTargets.push({
                  type: 'self/self',
                  data: data,
                  item: item,
                  userId: changedByUserId,
                  messageUuid: newRow.uuid,
                });
              }
              break;
            }
            case 'circle': {
              if (item.calc$.rangeDefinition.units === 'self' && data.token?.uuid) {
                calcTargets.push({
                  type: 'circle/self',
                  data: data,
                  item: item,
                  userId: changedByUserId,
                  messageUuid: newRow.uuid,
                });
              }
              break;
            }
          }
        }
      }
    }

    const tokensByUuid = await UtilsDocument.tokenFromUuid(calcTargets.filter(t => t.type === 'circle/self').map(t => t.data.token.uuid));

    for (const calc of calcTargets) {
      switch (calc.type) {
        case 'self/self': {
          calc.item.targets = [{uuid: calc.data.token.uuid}];
          break;
        }
        case 'circle/self': {
          const selfToken = tokensByUuid.get(calc.data.token.uuid);
          const scene = selfToken.parent;
          const templateDetails: TemplateDetails = {
            x: selfToken.data.x,
            y: selfToken.data.y,
            shape: new PIXI.Circle(0, 0, UtilsTemplate.feetToPx(UtilsTemplate.getFeet(calc.item.calc$.targetDefinition))),
          };
          const targets: typeof calc.item['targets'] = [];
          let sceneTokens = Array.from(scene.getEmbeddedCollection(TokenDocument.documentName).values() as IterableIterator<TokenDocument>);
          let filterDispositions: Array<TokenDocument['data']['disposition']> = [-1, 0, 1]
          if (calc.item.calc$.targetDefinition.type === 'ally') {
            if (selfToken.data.disposition === 1) {
              filterDispositions = [0, 1];
            } else if (selfToken.data.disposition === 0) {
              // Neurtal tokens also help friendlies but not enemies.
              // Neurtal *should* not distinguish between ally/enemy,
              // but in reality they are tokens who feel neurtal to the player party and are probably afraid of enemies
              filterDispositions = [0, 1];
            } else if (selfToken.data.disposition === -1) {
              filterDispositions = [selfToken.data.disposition];
            }
          } else if (calc.item.calc$.targetDefinition.type === 'enemy') {
            if (selfToken.data.disposition === 1) {
              filterDispositions = [-1];
            } else if (selfToken.data.disposition === -1) {
              filterDispositions = [1];
            } else {
              // no filter for neurtals
            }
          }
          sceneTokens = sceneTokens.filter(token => filterDispositions.includes(token.data.disposition));
          for (const sceneToken of sceneTokens) {
            if (UtilsTemplate.isTokenInside(templateDetails, sceneToken, true)) {
              targets.push({uuid: sceneToken.uuid, name: sceneToken.name} as any);
            }
          }
          calc.item.targets = targets;
        }
      }
    }

    if (calcTargets.length === 1 && InternalFunctions.getLatestMessage().uuid === calcTargets[0].messageUuid) {
      context.endOfContext(async () => {
        // Need to delay since setting targets will update the record which is currently being updated
        // Basically, wait for your turn
        await UtilsDocument.setTargets({tokenUuids: calcTargets[0].item.targets.map(t => t.uuid), user: game.users.get(calcTargets[0].userId)});
      });
    }
  }
  
  private async calcTargets(context: IDmlContext<ChatMessage>): Promise<void> {
    const calcTargets: Array<{item: ItemCardItem, target: ItemCardItem['targets'][number]}> = [];
    for (const {newRow, oldRow} of context.rows) {
      const data = InternalFunctions.getItemCardData(newRow);
      if (!data) {
        continue;
      }
      const oldData = InternalFunctions.getItemCardData(oldRow);
      
      for (const [item, oldItem] of this.forNewAndOld(data.items, oldData?.items)) {
        for (const [target, oldTarget] of this.forNewAndOld(item.targets, oldItem?.targets)) {
          if (target.uuid !== oldTarget?.uuid || target.calc$ == null || (item.calc$.check && !target.check)) {
            calcTargets.push({item: item, target: target});
          }
        }
      }
    }

    const targetsByUuid = await UtilsDocument.tokenFromUuid(calcTargets.map(t => t.target.uuid));

    for (const calcTarget of calcTargets) {
      const token = targetsByUuid.get(calcTarget.target.uuid);
      const actor = token.getActor() as MyActor;
      calcTarget.target.calc$ = {
        actorUuid: actor.uuid,
        ac: actor.data.data.attributes.ac.value,
        img: token.data.img,
        name: token.data.name,
        immunities: [...actor.data.data.traits.di.value, ...(actor.data.data.traits.di.custom === '' ? [] : actor.data.data.traits.di.custom.split(';'))],
        resistances: [...actor.data.data.traits.dr.value, ...(actor.data.data.traits.dr.custom === '' ? [] : actor.data.data.traits.dr.custom.split(';'))],
        vulnerabilities: [...actor.data.data.traits.dv.value, ...(actor.data.data.traits.dv.custom === '' ? [] : actor.data.data.traits.dv.custom.split(';'))],
        hpSnapshot: {
          maxHp: actor.data.data.attributes.hp.max,
          hp: actor.data.data.attributes.hp.value,
          temp: actor.data.data.attributes.hp.temp
        },
        result: {
          appliedActiveEffects: false
        }
      }
      if (calcTarget.item.calc$.check) {
        calcTarget.target.check = {
          mode: 'normal',
          phase: 'mode-select',
          userBonus: "",
          calc$: {}
        };
      } else {
        delete calcTarget.target.check;
      }
    }
  }

  private async calculateTargetResult(chatMessages: ChatMessage[]): Promise<void> {
    for (const chatMessage of chatMessages) {
      const messageData = InternalFunctions.getItemCardData(chatMessage);
      let update = await InternalFunctions.calculateTargetResult(messageData);
      if (update) {
        InternalFunctions.setItemCardData(chatMessage, update);
      }
    }
  }
  
  private calcItemCardCanChangeTargets(chatMessages: ChatMessage[]): void {
    for (const chatMessage of chatMessages) {
      const data: ItemCard = InternalFunctions.getItemCardData(chatMessage);
      for (const item of data.items) {
        item.calc$.canChangeTargets = InternalFunctions.canChangeTargets(item);
      }
      InternalFunctions.setItemCardData(chatMessage, data);
    }
  }
  
  private calcCanChangeSpellLevel(chatMessages: ChatMessage[]): void {
    for (const chatMessage of chatMessages) {
      const data: ItemCard = InternalFunctions.getItemCardData(chatMessage);
      for (const item of data.items) {
        item.calc$.canChangeLevel = item.calc$.level > 0;
        if (!item.calc$.canChangeLevel) {
          continue;
        }

        for (const damage of item.damages ?? []) {
          if (damage.calc$.normalRoll?.evaluated || damage.calc$.criticalRoll?.evaluated) {
            item.calc$.canChangeLevel = false;
            break;
          }
        }
        if (!item.calc$.canChangeLevel) {
          continue;
        }
        
        for (const consumeResource of item.consumeResources) {
          if (consumeResource.calc$.applied) {
            item.calc$.canChangeLevel = false;
            break;
          }
        }
        if (!item.calc$.canChangeLevel) {
          continue;
        }
      }
    }
  }
  
  private async calcConsumeResources(context: IDmlContext<ChatMessage>): Promise<void> {
    const fetchOriginalValues: ItemCardItem['consumeResources'] = [];
    for (const {newRow, oldRow} of context.rows) {
      const data = InternalFunctions.getItemCardData(newRow);
      if (oldRow) {
        const oldData = InternalFunctions.getItemCardData(oldRow);
        
        for (let itemIndex = 0; itemIndex < data.items.length; itemIndex++) {
          const item = data.items[itemIndex];
          const oldItem = oldData.items[itemIndex];
          
          let effectiveSelectedLevel = item.selectedlevel === 'pact' ? (data.actor?.calc$?.pactLevel ?? 0) : item.selectedlevel;
          if (item.calc$.level > effectiveSelectedLevel) {
            effectiveSelectedLevel = item.calc$.level;
            item.selectedlevel = effectiveSelectedLevel;
          }
          
          if (item.selectedlevel !== oldItem.selectedlevel) {
            const newSpellPropertyName = item.selectedlevel === 'pact' ? item.selectedlevel : `spell${item.selectedlevel}`;
            const oldSpellPropertyName = oldItem.selectedlevel === 'pact' ? oldItem.selectedlevel : `spell${oldItem.selectedlevel}`;
            for (const consumedResource of item.consumeResources) {
              if (!consumedResource.calc$.applied && consumedResource.calc$.uuid === data.actor?.uuid && consumedResource.calc$.path === `data.spells.${oldSpellPropertyName}.value`) {
                consumedResource.calc$.path = `data.spells.${newSpellPropertyName}.value`;
                fetchOriginalValues.push(consumedResource);
              }
            }
          }
        }
      }
      
      const actorsByUuid = await UtilsDocument.actorFromUuid(fetchOriginalValues.map(v => v.calc$.uuid));
      
      for (const consumedResource of fetchOriginalValues) {
        consumedResource.calc$.original = getProperty(actorsByUuid.get(consumedResource.calc$.uuid).data, consumedResource.calc$.path);
      }
      

      for (const item of data.items) {
        item.calc$.allConsumeResourcesApplied = true;
        for (const consumedResource of item.consumeResources) {
          if (!consumedResource.calc$.applied) {
            item.calc$.allConsumeResourcesApplied = false;
            break;
          }
        }
      }
      InternalFunctions.setItemCardData(newRow, data);
    }
  }
  
  private onBonusChange(context: IDmlContext<ChatMessage>): void {
    for (const {newRow, oldRow, changedByUserId} of context.rows) {
      if (!oldRow || changedByUserId !== game.userId) {
        continue;
      }
      const data: ItemCard = InternalFunctions.getItemCardData(newRow);
      const oldData: ItemCard = InternalFunctions.getItemCardData(oldRow);
      for (let itemIndex = 0; itemIndex < data.items.length; itemIndex++) {
        const item = data.items[itemIndex];
        const oldItem = oldData.items.length <= itemIndex ? null : oldData.items[itemIndex];
        
        if (item.attack?.phase === 'bonus-input' && oldItem?.attack?.phase !== 'bonus-input') {
          MemoryStorageService.setFocusedElementSelector(`.${staticValues.moduleName}-attack input.${staticValues.moduleName}-bonus`);
          return;
        }

        for (let targetIndex = 0; targetIndex < item.targets?.length; targetIndex++) {
          const target = item.targets[targetIndex];
          const oldTarget = oldItem?.targets?.[targetIndex];
          
          if (target?.check?.phase === 'bonus-input' && oldTarget?.check?.phase !== 'bonus-input') {
            MemoryStorageService.setFocusedElementSelector(`.${staticValues.moduleName}-item-${itemIndex}-check-target-${targetIndex} input.${staticValues.moduleName}-bonus`);
            return;
          }
        }
      }
    }

    // No focus found => reset
    MemoryStorageService.setFocusedElementSelector(null);
  }

  private async applyActiveEffects(context: IDmlContext<ChatMessage>): Promise<void> {
    const chatMessages: ChatMessage[] = [];
    for (const {newRow} of context.rows) {
      const data = InternalFunctions.getItemCardData(newRow);
      if (data) {
        chatMessages.push(newRow);
      }
    }

    const chatMessageDatas: ItemCard[] = [];
    const chatMessageDatasByUuid = new Map<string, ItemCard>();
    for (const chatMessage of chatMessages) {
      const data = InternalFunctions.getItemCardData(chatMessage);
      chatMessageDatas.push(data);
      chatMessageDatasByUuid.set(chatMessage.uuid, data);
    }
    const shouldApply = (item: ItemCardItem, target: ItemCardItem['targets'][0]): boolean => {
      if (item.damages?.length) {
        if (!target.applyDmg) {
          return false;
        }
      }
      return target.calc$.result.checkPass === false || target.calc$.result.hit === true;
    }
    const effectsByTargetUuid = new Map<string, {chatMessageIndex: number, itemIndex: number, apply: boolean}[]>();
    for (let chatMessageIndex = 0; chatMessageIndex < chatMessageDatas.length; chatMessageIndex++) {
      const messageData = chatMessageDatas[chatMessageIndex];
      for (let itemIndex = 0; itemIndex < messageData.items.length; itemIndex++) {
        const item = messageData.items[itemIndex];
        if (item.calc$.activeEffectsData.length > 0 && item.targets?.length > 0) {
          for (const target of item.targets) {
            // TODO I am not happy with this, maybe this should be user input? but there is already enough user input
            let shouldApplyResult = shouldApply(item, target);
            if (shouldApplyResult === target.calc$.result.appliedActiveEffects) {
              continue;
            }

            if (!effectsByTargetUuid.has(target.uuid)) {
              effectsByTargetUuid.set(target.uuid, []);
            }
            effectsByTargetUuid.get(target.uuid).push({
              chatMessageIndex: chatMessageIndex,
              itemIndex: itemIndex,
              apply: shouldApplyResult
            });
          }
        }
      }
    }

    // This _should_ prevent infinit loops
    if (effectsByTargetUuid.size === 0) {
      return;
    }

    const actorsByTokenUuid = await UtilsDocument.actorFromUuid(effectsByTargetUuid.keys())

    const getOriginKey = (origin: any): string => {
      return `${origin.messageUuid}.${origin.itemIndex}.${origin.activeEffectsIndex}`;
    }

    for (const targetUuid of effectsByTargetUuid.keys()) {
      const actor = actorsByTokenUuid.get(targetUuid);
      const effects = effectsByTargetUuid.get(targetUuid);
      const createActiveEffects: ActiveEffectData[] = [];
      const updateActiveEffects: ActiveEffectData[] = [];
      const deleteActiveEffects: ActiveEffectData[] = [];

      const activeEffectsByKey = new Map<string, ActiveEffect[]>();
      for (const effect of actor.getEmbeddedCollection(ActiveEffect.name).values()) {
        const origin = (effect.data.flags?.[staticValues.moduleName] as any)?.origin;
        if (origin) {
          const key = getOriginKey(origin);
          if (!activeEffectsByKey.has(key)) {
            activeEffectsByKey.set(key, []);
          }
          activeEffectsByKey.get(key).push(effect as ActiveEffect);
        }
      }

      for (const effect of effects) {
        if (!effect.apply) {
          const item = chatMessageDatas[effect.chatMessageIndex].items[effect.itemIndex];
          for (let activeEffectsIndex = 0; activeEffectsIndex < item.calc$.activeEffectsData.length; activeEffectsIndex++) {
            const origin = {
              messageUuid: chatMessages[effect.chatMessageIndex].uuid,
              itemIndex: effect.itemIndex,
              activeEffectsIndex: activeEffectsIndex
            };
            const key = getOriginKey(origin);
            if (activeEffectsByKey.has(key)) {
              deleteActiveEffects.push(...activeEffectsByKey.get(key).map(row => row.data));
            }
          }
        }
      }
      for (const effect of effects) {
        if (effect.apply) {
          const item = chatMessageDatas[effect.chatMessageIndex].items[effect.itemIndex];
          for (let activeEffectsIndex = 0; activeEffectsIndex < item.calc$.activeEffectsData.length; activeEffectsIndex++) {
            const activeEffectData = deepClone(item.calc$.activeEffectsData[activeEffectsIndex]);
            activeEffectData.flags = activeEffectData.flags ?? {};
            activeEffectData.flags[staticValues.moduleName] = activeEffectData.flags[staticValues.moduleName] ?? {};
            (activeEffectData.flags[staticValues.moduleName] as any).origin = {
              messageUuid: chatMessages[effect.chatMessageIndex].uuid,
              itemIndex: effect.itemIndex,
              activeEffectsIndex: activeEffectsIndex
            };
            delete activeEffectData._id
            if (deleteActiveEffects.length > 0) {
              activeEffectData._id = deleteActiveEffects[0]._id;
              deleteActiveEffects.splice(0, 1)
              updateActiveEffects.push(activeEffectData);
            } else {
              createActiveEffects.push(activeEffectData);
            }
          }
        }
      }

      if (createActiveEffects.length > 0) {
        await actor.createEmbeddedDocuments(ActiveEffect.name, createActiveEffects);
      }
      if (updateActiveEffects.length > 0) {
        await actor.updateEmbeddedDocuments(ActiveEffect.name, updateActiveEffects as any);
      }
      if (deleteActiveEffects.length > 0) {
        await actor.deleteEmbeddedDocuments(ActiveEffect.name, deleteActiveEffects.map(effect => effect._id));
      }
    }

    // TODO smarter change detection
    for (const chatMessage of chatMessages) {
      const data = chatMessageDatasByUuid.get(chatMessage.uuid);
      for (const item of data.items) {
        for (const target of item.targets ?? []) {
          // It should be applied by now
          target.calc$.result.appliedActiveEffects = shouldApply(item, target);
        }
      }
      InternalFunctions.setItemCardData(chatMessage, chatMessageDatasByUuid.get(chatMessage.uuid));
    }
    ChatMessage.updateDocuments(chatMessages.map(message => message.data));
  }

  private async recalcFutureHpSnapshots(context: IDmlContext<ChatMessage>): Promise<void> {
    let latestAppliedHp: ChatMessage;
    const recalcTargetUuid = new Set<string>();
    for (const {newRow, oldRow, changedByUserId} of context.rows) {
      if (changedByUserId !== game.userId) {
        continue;
      }

      const itemData = InternalFunctions.getItemCardData(newRow);
      if (!itemData) {
        continue;
      }
      const oldItemData = InternalFunctions.getItemCardData(oldRow);

      const newAppliedUuids = new Set<string>();
      for (const target of itemData.items.map(item => item.targets ?? []).deepFlatten()) {
        if (target.applyDmg) {
          newAppliedUuids.add(target.uuid);
        }
      }
      const oldAppliedUuids = new Set<string>();
      for (const target of (oldItemData?.items ?? []).map(item => item.targets ?? []).deepFlatten()) {
        if (target.applyDmg) {
          oldAppliedUuids.add(target.uuid);
        }
      }
      console.log({newAppliedUuids, oldAppliedUuids})
      const allUuids = new Set<string>([...Array.from(newAppliedUuids), ...Array.from(oldAppliedUuids)]);
      for (const uuid of allUuids) {
        if (newAppliedUuids.has(uuid) !== oldAppliedUuids.has(uuid)) {
          recalcTargetUuid.add(uuid);
          if (latestAppliedHp == null || newRow.data.timestamp < latestAppliedHp.data.timestamp) {
            latestAppliedHp = newRow;
          }
        }
      }
    }

    console.log('latestAppliedHp', latestAppliedHp, recalcTargetUuid);

    if (!latestAppliedHp) {
      return;
    }

    const futureChatMessages: ChatMessage[] = [];
    for (let messageIndex = game.messages.contents.length - 1; messageIndex >= 0; messageIndex--) {
      const chatMessage = game.messages.contents[messageIndex];
      if (chatMessage.id === latestAppliedHp.id) {
        break;
      }
      const data = InternalFunctions.getItemCardData(chatMessage);
      if (!data) {
        continue;
      }
      let hasFinalHp = false;
      for (const item of data.items) {
        for (const target of item.targets ?? []) {
          if (target.applyDmg) {
            hasFinalHp = true;
          }
        }
      }
      if (hasFinalHp) {
        continue;
      }
      futureChatMessages.push(chatMessage);
    }
    console.log('futureChatMessages', futureChatMessages);

    const tokensByUuid = await UtilsDocument.tokenFromUuid(recalcTargetUuid);
    for (const chatMessage of futureChatMessages) {
      const data = InternalFunctions.getItemCardData(chatMessage);
      for (const item of data.items) {
        for (const target of item.targets ?? []) {
          const actor: MyActor = tokensByUuid.get(target.uuid).getActor();
          target.calc$.hpSnapshot = {
            hp: actor.data.data.attributes.hp.value,
            maxHp: actor.data.data.attributes.hp.max,
            temp: actor.data.data.attributes.hp.temp,
          }
        }
      }
      InternalFunctions.setItemCardData(chatMessage, data);
    }

    await UtilsDocument.bulkUpdate(futureChatMessages.map(c => {return {document: c, data: c.data}}));
  }

  private async applyConsumeResources(context: IDmlContext<ChatMessage>): Promise<void> {
    const documentsByUuid = new Map<string, foundry.abstract.Document<any, any>>();
    const consumeResourcesToToggle: ItemCard['items'][0]['consumeResources'] = [];
    const bulkUpdate: Parameters<typeof UtilsDocument['bulkUpdate']>[0] = [];
    {
      const promisesByUuid = new Map<string, Promise<{uuid: string, document: foundry.abstract.Document<any, any>}>>();
      for (const {newRow, changedByUserId} of context.rows) {
        const messageData = InternalFunctions.getItemCardData(newRow);
        if (changedByUserId !== game.userId) {
          // Only one user needs to do this operation
          // TODO should happen before when async is possible
          continue;
        }
        if (messageData == null) {
          continue;
        }
        for (const item of messageData.items) {
          for (const consumeResource of item.consumeResources) {
            let shouldApply = false;
            if (consumeResource.consumeResourcesAction === 'undo') {
              shouldApply = false;
            } else if (consumeResource.consumeResourcesAction === 'manual-apply') {
              shouldApply = true;
            } else {
              switch (consumeResource.calc$.autoconsumeAfter) {
                case 'init': {
                  shouldApply = true;
                  break;
                }
                case 'attack': {
                  shouldApply = item.attack?.calc$?.evaluatedRoll?.evaluated === true;
                  break;
                }
                case 'template-placed': {
                  shouldApply = item?.calc$.targetDefinition?.createdTemplateUuid != null;
                  break;
                }
                case 'damage': {
                  for (const damage of (item.damages ?? [])) {
                    if (damage?.calc$.normalRoll?.evaluated === true || damage?.calc$.criticalRoll?.evaluated === true) {
                      shouldApply = true;
                      break;
                    }
                  }
                  break;
                }
                case 'check': {
                  for (const target of (item.targets ?? [])) {
                    if (target?.check.calc$?.evaluatedRoll?.evaluated === true) {
                      shouldApply = true;
                      break;
                    }
                  }
                  break;
                }
              }
            }
            
            if (shouldApply !== consumeResource.calc$.applied) {
              consumeResourcesToToggle.push(consumeResource);
              if (!promisesByUuid.has(consumeResource.calc$.uuid)) {
                promisesByUuid.set(consumeResource.calc$.uuid, fromUuid(consumeResource.calc$.uuid).then(doc => {return {uuid: consumeResource.calc$.uuid, document: doc}}));
              }
            }
          }
        }
      }

      const rows = await Promise.all(Array.from(promisesByUuid.values()));
      for (const row of rows) {
        documentsByUuid.set(row.uuid, row.document);
      }
    }

    if (consumeResourcesToToggle.length === 0) {
      return;
    }

    const updatesByUuid = new Map<string, any>();
    for (const consumeResource of consumeResourcesToToggle) {
      if (!updatesByUuid.has(consumeResource.calc$.uuid)) {
        updatesByUuid.set(consumeResource.calc$.uuid, {});
      }
      const updates = updatesByUuid.get(consumeResource.calc$.uuid);
      if (consumeResource.calc$.applied) {
        // toggle => refund to original
        setProperty(updates, consumeResource.calc$.path, consumeResource.calc$.original);
      } else {
        // toggle => apply
        setProperty(updates, consumeResource.calc$.path, Math.max(0, consumeResource.calc$.original - consumeResource.calc$.amount));
      }
      consumeResource.calc$.applied = !consumeResource.calc$.applied;
    }

    for (const uuid of documentsByUuid.keys()) {
      if (updatesByUuid.has(uuid)) {
        bulkUpdate.push({
          document: documentsByUuid.get(uuid) as any,
          data: updatesByUuid.get(uuid)
        })
      }
    }

    await UtilsDocument.bulkUpdate(bulkUpdate);
  }

  private forNewAndOld<T extends {[key: string]: any}>(newObj: T[] | null, oldObj: T[] | null): Array<[T, T | null]> {
    const response: Array<[T, T]> = [];
    if (newObj == null) {
      newObj = [];
    }
    for (let i = 0; i < newObj.length; i++) {
      response.push([newObj[i], oldObj?.[i]]);
    }
    return response;
  }
  
}

class DmlTriggerTemplate implements IDmlTrigger<MeasuredTemplateDocument> {

  get type(): typeof MeasuredTemplateDocument {
    return MeasuredTemplateDocument;
  }
  
  public async afterCreate(context: IDmlContext<MeasuredTemplateDocument>): Promise<void> {
    for (const {newRow: template, changedByUserId} of context.rows) {
      if (game.userId !== changedByUserId) {
        continue;
      }
      const messageId = template.getFlag(staticValues.moduleName, 'dmlCallbackMessageId') as string;
      if (!messageId || !game.messages.has(messageId)) {
        continue;
      }
      const message = game.messages.get(messageId);
      const messageData = InternalFunctions.getItemCardData(message);
      if (!messageData) {
        continue;
      }

      const itemIndex = template.getFlag(staticValues.moduleName, 'dmlCallbackItemIndex') as number;
      let item = messageData.items[itemIndex];
      if (!item) {
        continue;
      }

      if (item.calc$.targetDefinition.createdTemplateUuid && item.calc$.targetDefinition.createdTemplateUuid !== template.uuid) {
        fromUuid(item.calc$.targetDefinition.createdTemplateUuid).then(doc => {
          if (doc != null) {
            doc.delete();
          }
        });
      }

      item.calc$.targetDefinition.createdTemplateUuid = template.uuid;

      item = await this.setTargetsFromTemplate(item);
      messageData.items[itemIndex] = item;
      UtilsDocument.setTargets({tokenUuids: item.targets.map(t => t.uuid)});

      await InternalFunctions.saveItemCardData(messageId, messageData);
    }
  }

  public async afterUpdate(context: IDmlContext<MeasuredTemplateDocument>): Promise<void> {

    for (const {newRow: template, changedByUserId} of context.rows) {
      if (game.userId !== changedByUserId) {
        continue;
      }
      const messageId = template.getFlag(staticValues.moduleName, 'dmlCallbackMessageId') as string;
      if (!messageId || !game.messages.has(messageId)) {
        continue;
      }
      const message = game.messages.get(messageId);
      const messageData = InternalFunctions.getItemCardData(message);
      if (!messageData) {
        continue;
      }

      const itemIndex = template.getFlag(staticValues.moduleName, 'dmlCallbackItemIndex') as number;
      let item = messageData.items[itemIndex];
      if (!item) {
        continue;
      }

      if (!InternalFunctions.canChangeTargets(item)) {
        continue;
      }

      item = await this.setTargetsFromTemplate(item);
      messageData.items[itemIndex] = item;
      UtilsDocument.setTargets({tokenUuids: item.targets.map(t => t.uuid)});

      await InternalFunctions.saveItemCardData(messageId, messageData);
    }
  }
  
  private async setTargetsFromTemplate(item: ItemCardItem): Promise<ItemCardItem> {
    if (!item?.calc$?.targetDefinition?.createdTemplateUuid) {
      return item;
    }

    if (!InternalFunctions.canChangeTargets(item)) {
      return item;
    }

    const template = await UtilsDocument.templateFromUuid(item.calc$.targetDefinition.createdTemplateUuid);
    if (!template) {
      return item;
    }
    
    const templateDetails = UtilsTemplate.getTemplateDetails(template);
    const scene = template.parent;
    const newTargets: typeof item['targets'] = [];
    for (const token of scene.getEmbeddedCollection('Token').values() as Iterable<TokenDocument>) {
      if (UtilsTemplate.isTokenInside(templateDetails, token, true)) {
        newTargets.push({uuid: token.uuid});
      }
    }

    item.targets = newTargets;

    return item;
  }

}

class InternalFunctions {
  
  public static get healingDamageTypes(): DamageType[] {
    return Object.keys((CONFIG as any).DND5E.healingTypes) as any;
  }

  public static async calculateTargetResult(messageData: ItemCard): Promise<ItemCard> {
    const items = messageData.items.filter(item => item.targets?.length);

    // Prepare data
    const tokenUuidToName = new Map<string, string>();
    const rawHealthModByTargetUuid = new Map<string, number>();
    const calculatedHealthModByTargetUuid = new Map<string, number>();
    for (const item of items) {
      for (const target of item.targets) {
        target.calc$.result = !target.calc$.result ? {appliedActiveEffects: false} : {...target.calc$.result}
        delete target.calc$.result.checkPass;
        delete target.calc$.result.dmg;
        delete target.calc$.result.hit;
        tokenUuidToName.set(target.uuid, target.calc$.name || '');
        rawHealthModByTargetUuid.set(target.uuid, 0);
        calculatedHealthModByTargetUuid.set(target.uuid, 0);
      }
    }

    
    // Reset aggregate
    const aggregates = new Map<string, ItemCard['calc$']['targetAggregate'][0]>();
    if (messageData.calc$?.targetAggregate) {
      // If an aggregate was shown, make sure it will always be shown to make sure it can be reset back to the original state
      for (const oldAggregate of messageData.calc$.targetAggregate) {
        if (!oldAggregate.dmg?.appliedDmg) {
          continue;
        }
        aggregates.set(oldAggregate.uuid, {
          uuid: oldAggregate.uuid,
          actorUuid: oldAggregate.actorUuid,
          name: oldAggregate.name,
          img: oldAggregate.img,
          hpSnapshot: oldAggregate.hpSnapshot,
          dmg: {
            avoided: null,
            applied: false,
            appliedDmg: oldAggregate.dmg?.appliedDmg || 0,
            rawDmg: 0,
            calcDmg: 0,
            calcHp: oldAggregate.hpSnapshot.hp,
            calcTemp: oldAggregate.hpSnapshot.temp,
          }
        })
      }
    }

    for (const item of items) {
      for (const target of item.targets) {
        if (!aggregates.has(target.uuid)) {
          aggregates.set(target.uuid, {
            uuid: target.uuid,
            actorUuid: target.calc$?.actorUuid,
            name: target.calc$.name,
            img: target.calc$.img,
            hpSnapshot: target.calc$.hpSnapshot,
            dmg: {
              avoided: null,
              applied: false,
              appliedDmg: 0,
              rawDmg: 0,
              calcDmg: 0,
              calcHp: Number(target.calc$.hpSnapshot.hp),
              calcTemp: Number(target.calc$.hpSnapshot.temp),
            }
          });
        }
      }
    }

    const actorsByUuid = await UtilsDocument.actorFromUuid(aggregates.keys());

    const applyDmg = (aggregate: ItemCard['calc$']['targetAggregate'][0], amount: number) => {
      if (aggregate.dmg == null) {
        aggregate.dmg = {
          avoided: null,
          applied: false,
          appliedDmg: 0,
          rawDmg: 0,
          calcDmg: 0,
          calcHp: Number(aggregate.hpSnapshot.hp),
          calcTemp: Number(aggregate.hpSnapshot.temp),
        }
      }

      const maxDmg = aggregate.hpSnapshot.hp + Number(aggregate.hpSnapshot.temp);
      const minDmg = 0;
      let dmg = Math.min(maxDmg, Math.max(minDmg, amount));
      
      aggregate.dmg.calcDmg += dmg;
      if (dmg > 0) {
        let tempDmg = Math.min(Number(aggregate.dmg.calcTemp), dmg);
        aggregate.dmg.calcTemp -= tempDmg;
        dmg -= tempDmg;
      }
      aggregate.dmg.calcHp -= dmg;
    }
    
    const applyHeal = (aggregate: ItemCard['calc$']['targetAggregate'][0], amount: number) => {
      if (aggregate.dmg == null) {
        aggregate.dmg = {
          avoided: null,
          applied: false,
          appliedDmg: 0,
          rawDmg: 0,
          calcDmg: 0,
          calcHp: Number(aggregate.hpSnapshot.hp),
          calcTemp: Number(aggregate.hpSnapshot.temp),
        }
      }

      // Get the current max HP since the max HP may have changed with active effects
      // In the rare usecase where sync actor fetching is not possible, fallback to the snapshot
      const tokenActor = actorsByUuid.get(aggregate.uuid);
      const maxHeal = Math.max(0, tokenActor == null ? aggregate.hpSnapshot.maxHp : tokenActor.data.data.attributes.hp.max - aggregate.hpSnapshot.hp);
      const minHeal = 0;
      const heal = Math.min(maxHeal, Math.max(minHeal, amount));
      aggregate.dmg.calcDmg -= heal;
      aggregate.dmg.calcHp += heal;
    }

    // Calculate
    for (const item of items) {
      // Attack
      if (item.attack?.calc$.evaluatedRoll) {
        const attackResult = item.attack.calc$.evaluatedRoll.total;
        for (const target of item.targets) {
          target.calc$.result.hit = target.calc$.ac <= attackResult;
        }
      }

      // Check
      if (item.calc$.check) {
        for (const target of item.targets) {
          if (!target?.check.calc$?.evaluatedRoll?.evaluated) {
            target.calc$.result.checkPass = null;
          } else {
            target.calc$.result.checkPass = target.check.calc$.evaluatedRoll.total >= item.calc$.check.dc;
          }
        }
      }

      // Include when no attack has happend (null) and when hit (true)
      // Include when no check is present in the item or the check happend (check passed/failed is handled later)
      const calcDmgForTargets = item.targets.filter(target => target.calc$.result.hit !== false && (!item.calc$.check || target?.check.calc$?.evaluatedRoll?.evaluated));

      // Damage
      const evaluatedDamageRolls = item.damages ? item.damages.filter(dmg => dmg.mode === 'critical' ? dmg.calc$?.criticalRoll?.evaluated : dmg?.calc$.normalRoll?.evaluated) : [];
      if (calcDmgForTargets.length > 0 && evaluatedDamageRolls.length > 0) {
        for (const damage of evaluatedDamageRolls) {
          const damageResults = UtilsRoll.rollToDamageResults(Roll.fromJSON(JSON.stringify(damage.mode === 'critical' ? damage.calc$.criticalRoll : damage.calc$.normalRoll)));
          for (const target of calcDmgForTargets) {
            for (const [dmgType, dmg] of damageResults.entries()) {
              let baseDmg = dmg;
              if (item?.calc$.check && target.calc$.result.checkPass) {
                // If a creature or an object has resistance to a damage type, damage of that type is halved against it.
                // I read that as, first apply the save modifier, not at the same time or not after res/vuln
                switch (damage.calc$.modfierRule) {
                  case 'save-full-dmg': {
                    break;
                  }
                  case 'save-no-dmg': {
                    baseDmg = 0;
                    break;
                  }
                  case 'save-halve-dmg':
                  default: {
                    baseDmg = baseDmg * .5;
                    break;
                  }
                }
              }
              let modifier = 1;
              if (target.calc$.immunities.includes(dmgType)) {
                modifier = 0;
              } else {
                if (target.calc$.resistances.includes(dmgType)) {
                  modifier /= 2;
                }
                if (target.calc$.vulnerabilities.includes(dmgType)) {
                  modifier *= 2;
                }
              }

              target.calc$.result.dmg = {
                type: dmgType,
                rawNumber: baseDmg,
                calcNumber: Math.floor(baseDmg * modifier),
              }

              if (!aggregates.get(target.uuid)) {
                aggregates.set(target.uuid, {
                  uuid: target.uuid,
                  actorUuid: target.calc$?.actorUuid,
                  hpSnapshot: target.calc$.hpSnapshot,
                  name: target.calc$.name,
                  img: target.calc$.img,
                })
              }
              const aggregate = aggregates.get(target.uuid);
              if (aggregate.dmg == null) {
                aggregate.dmg = {
                  avoided: null,
                  applied: false,
                  appliedDmg: 0,
                  rawDmg: 0,
                  calcDmg: 0,
                  calcHp: Number(aggregate.hpSnapshot.hp),
                  calcTemp: Number(aggregate.hpSnapshot.temp),
                }
              }

              // Apply healing & dmg aggregate in the same order as the items
              if (target.calc$.result.dmg.type === 'temphp') {
                aggregate.dmg.calcTemp += target.calc$.result.dmg.calcNumber;
              } else if (InternalFunctions.healingDamageTypes.includes(target.calc$.result.dmg.type)) {
                applyHeal(aggregate, target.calc$.result.dmg.calcNumber);
              } else {
                applyDmg(aggregate, target.calc$.result.dmg.calcNumber);
              }
            }
          }
        }
      }
    }

    for (const item of items) {
      for (const target of item.targets ?? []) {
        if (aggregates.get(target.uuid).dmg) {
          if ((item.attack && target.calc$.result.hit == null) || (item.calc$.check && target.calc$.result.checkPass == null)) {
              aggregates.get(target.uuid).dmg.avoided = null;
          } else {
            const hit = (item.attack && target.calc$.result.hit) || (item.calc$.check && !target.calc$.result.checkPass);
            aggregates.get(target.uuid).dmg.avoided = !hit;
          }
        }
      }
    }

    messageData.calc$ = messageData.calc$ ?? {};
    messageData.calc$.targetAggregate = Array.from(aggregates.values()).sort((a, b) => (a.name || '').localeCompare((b.name || '')));
    for (const aggregate of messageData.calc$.targetAggregate) {
      if (aggregate.dmg) {
        aggregate.dmg.applied = aggregate.dmg.calcDmg === aggregate.dmg.appliedDmg;
      }
    }

    messageData.calc$.allDmgApplied = messageData.calc$.targetAggregate != null && messageData.calc$.targetAggregate.filter(aggr => aggr.dmg?.applied).length === messageData.calc$.targetAggregate.length;
    const appliedDmgTo = new Set<string>();
    if (messageData.calc$.targetAggregate != null) {
      for (const aggr of messageData.calc$.targetAggregate) {
        if (aggr.dmg?.applied) {
          appliedDmgTo.add(aggr.uuid);
        }
      }
    }
    for (const item of messageData.items) {
      if (!item.targets) {
        continue;
      }
    }

    return messageData;
  }

  public static async saveItemCardData(messageId: string, data: ItemCard): Promise<void> {
    await ChatMessage.updateDocuments([{
      _id: messageId,
      flags: {
        [staticValues.moduleName]: {
          clientTemplateData: {
            data: data,
          }
        }
      }
    }]);
  }

  public static getItemCardData(message: ChatMessage): ItemCard {
    if (message == null) {
      return null;
    }
    if (message.getFlag(staticValues.moduleName, 'clientTemplate') !== `modules/${staticValues.moduleName}/templates/item-card.hbs`) {
      return null;
    }
    return (message.getFlag(staticValues.moduleName, 'clientTemplateData') as any)?.data;
  }

  public static setItemCardData(message: ChatMessage, data: ItemCard): void {
    setProperty(message.data, `flags.${staticValues.moduleName}.clientTemplateData.data`, data);
  }
  
  public static canChangeTargets(itemData: ItemCardItem): boolean {
    if (!itemData.targets) {
      return true;
    }

    // A target has rolled a save or damage has been applied
    if (itemData.targets) {
      for (const target of itemData.targets) {
        if (target?.calc$?.result?.checkPass != null) {
          return false;
        }
        if (target.applyDmg) {
          return false;
        }
        if (target?.calc$?.result?.appliedActiveEffects === true) {
          return false;
        }
      }
    }
    return true;
  }
  
  public static getLatestMessage(): ChatMessage | null {
    for (let messageIndex = game.messages.contents.length - 1; messageIndex >= 0; messageIndex--) {
      const chatMessage = game.messages.contents[messageIndex];
      const data = InternalFunctions.getItemCardData(chatMessage);
      if (!data) {
        continue;
      }
      return chatMessage;
    }
    return null;
  }

}