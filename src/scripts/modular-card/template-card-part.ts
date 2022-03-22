import { DmlTrigger, IAfterDmlContext, IDmlContext, IDmlTrigger, ITrigger } from "../lib/db/dml-trigger";
import { UtilsDocument } from "../lib/db/utils-document";
import { RunOnce } from "../lib/decorator/run-once";
import { UtilsCompare } from "../lib/utils/utils-compare";
import MyAbilityTemplate from "../pixi/ability-template";
import { staticValues } from "../static-values";
import { MyActor, MyItem, MyItemData } from "../types/fixed-types";
import { UtilsTemplate } from "../utils/utils-template";
import { createElement, ICallbackAction } from "./card-part-element";
import { ModularCard, ModularCardPartData, ModularCardTriggerData } from "./modular-card";
import { createPermissionCheck, CreatePermissionCheckArgs, HtmlContext, ModularCardCreateArgs, ModularCardPart } from "./modular-card-part";
import { TargetCardData, TargetCardPart } from "./target-card-part";

interface TemplateCardData {
  calc$: {
    actorUuid: string;
    createdTemplateUuid?: string;
    target: MyItemData['data']['target'];
  }
}

export class TemplateCardPart implements ModularCardPart<TemplateCardData> {

  public static readonly instance = new TemplateCardPart();
  private constructor(){}
  
  public create({item, actor}: ModularCardCreateArgs): TemplateCardData {
    // @ts-expect-error
    const hasAoe = CONFIG.DND5E.areaTargetTypes.hasOwnProperty(item.data.data.target.type);
    if (!hasAoe) {
      return null;
    }
    return {
      calc$: {
        actorUuid: actor?.uuid,
        target: item.data.data.target,
      }
    };
  }

  public refresh(oldData: TemplateCardData, args: ModularCardCreateArgs): TemplateCardData {
    const newData = this.create(args);

    if (!newData) {
      return null;
    }
    if (!oldData) {
      return newData;
    }

    // Retain template link
    newData.calc$.createdTemplateUuid = oldData.calc$.createdTemplateUuid;

    return newData;
  }

  @RunOnce()
  public registerHooks(): void {
    createElement({
      selector: this.getSelector(),
      getHtml: context => this.getElementHtml(context),
      getCallbackActions: () => this.getCallbackActions(),
    });
    
    ModularCard.registerModularCardPart(staticValues.moduleName, this);
    ModularCard.registerModularCardTrigger(new TemplateCardTrigger());
    DmlTrigger.registerTrigger(new DmlTriggerTemplate());
  }

  public getType(): string {
    return this.constructor.name;
  }

  //#region Front end
  public getSelector(): string {
    return `${staticValues.code}-template-part`;
  }

  public getHtml(data: HtmlContext): string {
    return `<${this.getSelector()} data-part-id="${data.partId}" data-message-id="${data.messageId}"></${this.getSelector()}>`
  }

  public getElementHtml(context: HtmlContext<TemplateCardData>): string | Promise<string> {
    return renderTemplate(
      `modules/${staticValues.moduleName}/templates/modular-card/template-part.hbs`, {
        data: context.data,
        moduleName: staticValues.moduleName
      }
    );
  }

  public getCallbackActions(): ICallbackAction<TemplateCardData>[] {
    const permissionCheck = createPermissionCheck<TemplateCardData>(({data}) => {
      const documents: CreatePermissionCheckArgs['documents'] = [];
      if (data.calc$.actorUuid) {
        documents.push({uuid: data.calc$.actorUuid, permission: 'OWNER', security: true});
      }
      return {documents: documents, updatesMessage: false};
    })

    return [
      {
        regex: /^item-template$/,
        permissionCheck: permissionCheck,
        execute: ({data, messageId, partId}) => this.processItemTemplate(data, messageId, partId),
      }
    ]
  }
  
  private async processItemTemplate(data: TemplateCardData, messageId: string, partId: string): Promise<void> {
    const template = MyAbilityTemplate.fromItem({
      target: data.calc$.target,
      flags: {
        [staticValues.moduleName]: {
          dmlCallbackMessageId: messageId,
          dmlCallbackPartId: partId,
        }
      }
    });
    template.drawPreview();
  }
  //#endregion

}

class TemplateCardTrigger implements ITrigger<ModularCardTriggerData> {

  //#region afterCreate
  public afterCreate(context: IAfterDmlContext<ModularCardTriggerData>): void | Promise<void> {
    this.createTemplatePreview(context);
  }

  private createTemplatePreview(context: IAfterDmlContext<ModularCardTriggerData>): void {
    for (const {newRow, changedByUserId} of context.rows) {
      if (!this.isThisTriggerType(newRow)) {
        continue;
      }
      if (changedByUserId !== game.userId) {
        continue;
      }
      // Initiate measured template creation
      const template = MyAbilityTemplate.fromItem({
        target: newRow.data.calc$.target,
        flags: {
          [staticValues.moduleName]: {
            dmlCallbackMessageId: newRow.messageId,
            dmlCallbackPartId: newRow.id,
          }
        }
      });
      if (template) {
        template.drawPreview();
        return;
      }
    }
  }
  //#endregion
  
  //#region helpers
  private isThisTriggerType(row: ModularCardTriggerData): row is ModularCardTriggerData<TemplateCardData> {
    return row.typeHandler instanceof TemplateCardPart;
  }
  //#endregion

}

class DmlTriggerTemplate implements IDmlTrigger<MeasuredTemplateDocument> {

  get type(): typeof MeasuredTemplateDocument {
    return MeasuredTemplateDocument;
  }
  
  public async afterUpsert(context: IDmlContext<MeasuredTemplateDocument>): Promise<void> {
    const updateChatMessageMap = new Map<string, ModularCardPartData[]>();
    const deleteTemplateUuids = new Set<string>();
    for (const {newRow: newTemplate, oldRow: oldTemplate, changedByUserId} of context.rows) {
      const messageId = newTemplate.getFlag(staticValues.moduleName, 'dmlCallbackMessageId') as string;
      if (!messageId || !game.messages.has(messageId)) {
        continue;
      }
      const chatMessage = game.messages.get(messageId);
      const parts = updateChatMessageMap.has(messageId) ? updateChatMessageMap.get(messageId) : deepClone(ModularCard.getCardPartDatas(chatMessage));
      if (parts == null) {
        continue;
      }
      
      const executingUserCanModify = chatMessage.canUserModify(game.users.get(changedByUserId), 'update');
      if (executingUserCanModify) {
        if (game.userId !== changedByUserId) {
          // User can edit message => user should edit message
          continue;
        }
      } else {
        // User can't edit message => find someone who can.
        // Order doesn't really matter, what is important is that every client selects the same one
        const firstUserWithEditPermissions = Array.from(game.users.values()).sort((a, b) => a.id.localeCompare(b.id)).find(user => user.active && chatMessage.canUserModify(user, 'update'));
        if (!firstUserWithEditPermissions) {
          // To bad I guess.
          continue;
        }
        if (game.userId !== firstUserWithEditPermissions.id) {
          continue;
        }
      }

      const partId = newTemplate.getFlag(staticValues.moduleName, 'dmlCallbackPartId') as string;
      let templatePart: ModularCardPartData<TemplateCardData> = parts.find(part => part.id === partId && ModularCard.getTypeHandler(part.type) instanceof TemplateCardPart);
      let targetPart: ModularCardPartData<TargetCardData> = parts.find(part => ModularCard.getTypeHandler(part.type) instanceof TargetCardPart);
      if (!templatePart || !targetPart) {
        continue;
      }

      if (templatePart.data.calc$.createdTemplateUuid !== newTemplate.uuid) {
        deleteTemplateUuids.add(templatePart.data.calc$.createdTemplateUuid);
        
        templatePart.data.calc$.createdTemplateUuid = newTemplate.uuid;
        updateChatMessageMap.set(chatMessage.id, parts);
      }

      if (newTemplate.data.x !== oldTemplate?.data?.x || newTemplate.data.y !== oldTemplate?.data?.y) {
        const templateDetails = UtilsTemplate.getTemplateDetails(newTemplate);
        const scene = newTemplate.parent;
        const newTargets = new Set<string>();
        for (const token of scene.getEmbeddedCollection('Token').values() as Iterable<TokenDocument>) {
          if (UtilsTemplate.isTokenInside(templateDetails, token, true)) {
            newTargets.add(token.uuid);
          }
        }
        const targets = Array.from(newTargets);
        if (!UtilsCompare.deepEquals(targetPart.data.selectedTokenUuids, targets)) {
          targetPart.data.selectedTokenUuids = targets;
          updateChatMessageMap.set(chatMessage.id, parts);
        }
      }
    }

    for (const [chatMessageId, parts] of updateChatMessageMap.entries()) {
      await ModularCard.setCardPartDatas(game.messages.get(chatMessageId), parts);
    }

    deleteTemplateUuids.delete(null);
    deleteTemplateUuids.delete(undefined);
    if (deleteTemplateUuids.size > 0) {
      await UtilsDocument.fromUuid(deleteTemplateUuids).then(docs => {
        for (const doc of docs.values()) {
          doc.delete();
        }
      });
    }
  }

}