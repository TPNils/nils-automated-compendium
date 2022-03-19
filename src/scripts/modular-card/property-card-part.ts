import { RunOnce } from "../lib/decorator/run-once";
import { staticValues } from "../static-values";
import { MyItem } from "../types/fixed-types";
import { createElement } from "./card-part-element";
import { ModularCard } from "./modular-card";
import { HtmlContext, ModularCardCreateArgs, ModularCardPart } from "./modular-card-part";

interface PropertyCardData {
  calc$: {
    properties: string[];
  }
}

export class PropertyCardPart implements ModularCardPart<PropertyCardData> {

  public static readonly instance = new PropertyCardPart();
  private constructor(){}
  
  public create({item}: {item: MyItem}): PropertyCardData[] {
    return [{
      calc$: {
        properties: item.getChatData().properties,
      }
    }];
  }

  public refresh(data: PropertyCardData[], args: ModularCardCreateArgs): PropertyCardData[] {
    return this.create(args);
  }

  @RunOnce()
  public registerHooks(): void {
    createElement({
      selector: this.getType(),
      getHtml: context => this.getElementHtml(context),
      getCallbackActions: () => [],
    });
    
    ModularCard.registerModularCardPart(staticValues.moduleName, this);
  }

  public getType(): string {
    return `${staticValues.code}-property-part`;
  }

  public getElementHtml(context: HtmlContext<PropertyCardData>): string | Promise<string> {
    return renderTemplate(
      `modules/${staticValues.moduleName}/templates/modular-card/property-part.hbs`, {
        data: context.data,
        messageId: context.messageId,
        moduleName: staticValues.moduleName
      }
    );
  }

}