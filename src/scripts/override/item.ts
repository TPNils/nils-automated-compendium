import { ModularCard } from "../modular-card/modular-card";
import { staticValues } from "../static-values";
import { MyActor, MyItem } from "../types/fixed-types";

// Source: https://gitlab.com/foundrynet/dnd5e/-/blob/e0e7ac62469046b0bf51a2fa933b7be34a476b2e/module/item/entity.js#L415
async function roll(this: MyItem, {rollMode, createMessage=true}: {configureDialog?: boolean, rollMode?: ClientSettings.Values[`core.rollMode`], createMessage?: boolean} = {}) {
  return this.displayCard({rollMode, createMessage});;
}

async function displayCard(this: Item, {rollMode, createMessage=true}: {rollMode?: ClientSettings.Values[`core.rollMode`], createMessage?: boolean} = {}): Promise<ChatMessage> {
  let token: TokenDocument = ((this.actor as any).token);
  if (!token) {
    // In 0.8.9, actor.token seems very broken, might be fixed in later versions?
    const speaker = ChatMessage.getSpeaker();
    if (speaker.actor === (this.actor as MyActor)?.id) {
      if (speaker.scene && speaker.token) {
        token = game.scenes.get(speaker.scene).getEmbeddedDocument(TokenDocument.documentName, speaker.token) as TokenDocument;
      }
    }
  }
  const parts = await ModularCard.getDefaultItemParts({
    item: this as any,
    actor: this.actor as MyActor,
    token: token,
  });

  return ModularCard.createCard(parts, true);
}

export function registerHooks(): void {
  Hooks.on('setup', () => {
    libWrapper.register(staticValues.moduleName, 'CONFIG.Item.documentClass.prototype.roll', roll, 'OVERRIDE');
    libWrapper.register(staticValues.moduleName, 'CONFIG.Item.documentClass.prototype.displayCard', displayCard, 'OVERRIDE');
  });
}