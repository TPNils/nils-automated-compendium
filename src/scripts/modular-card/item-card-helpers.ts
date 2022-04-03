import { DamageType } from "../types/fixed-types";
import { ModularCard, ModularCardPartData } from "./modular-card";

export interface ChatPartIdData {
  readonly partId: string;
  readonly messageId: string;
  readonly subType: string | null;
}

export interface ChatPartEnriched<T> {
  readonly allCardParts: ModularCardPartData<any>[];
  readonly part: ModularCardPartData<T>;
}

export interface UserIdData {
  readonly userId: string;
}

export interface ClickData {
  readonly click: {
    readonly altKey: boolean;
    readonly ctrlKey: boolean;
    readonly metaKey: boolean;
    readonly shiftKey: boolean;
  };
}

export interface KeyData {
  readonly keyEvent: {
    readonly key: string;
  }
}

export interface ActionData {
  readonly action: string;
}

export class ItemCardHelpers {
  
  public static get tmpHealingDamageTypes(): DamageType[] {
    return ['temphp'];
  }
  
  public static get healingDamageTypes(): DamageType[] {
    return Object.keys((CONFIG as any).DND5E.healingTypes) as any;
  }

  public static getUserIdSerializer(): () => UserIdData {
    return () => {
      return {
        userId: game.userId,
      }
    }
  }

  public static getChatPartIdSerializer(): ({element}: {element: HTMLElement}) => ChatPartIdData {
    return ({element}) => {
      // TODO validate when values are missing
      return {
        messageId: element.closest('[data-message-id]')?.getAttribute('data-message-id'),
        partId: element.closest('[data-part-id]')?.getAttribute('data-part-id'),
        subType: element.getAttribute('data-sub-type'),
      }
    }
  }

  public static getMouseEventSerializer(): ({event}: {event: MouseEvent}) => ClickData {
    return ({event}) => {
      return {
        click: {
          altKey: event.altKey === true,
          ctrlKey: event.ctrlKey === true,
          metaKey: event.metaKey === true,
          shiftKey: event.shiftKey === true,
        }
      }
    }
  }

  public static getActionSrializer(): ({event}: {event: Event}) => ActionData {
    return ({event}) => {
      return {action: (event.target as HTMLElement).closest('[data-action]').getAttribute('data-action')}
    }
  }

  public static getKeyEventSerializer(): ({event}: {event: KeyboardEvent}) => KeyData {
    return ({event}) => {
      return {
        keyEvent: {
          key: event.key
        }
      }
    }
  }

  public static getChatPartEnricher<T>(): (data: ChatPartIdData) => ChatPartEnriched<T> {
    return data => {
      const message = game.messages.get(data.messageId);
      const originalAllCardParts = ModularCard.getCardPartDatas(message);

      let allCardParts = deepClone(originalAllCardParts);
      const messagePartData = allCardParts.find(part => part.id === data.partId);
      if (messagePartData == null) {
        throw {
          success: false,
          errorType: 'warn',
          errorMessage: `Pressed an action button for message part ${data.messageId}.${data.partId} but no data was found`,
        };
      }
      return {
        allCardParts,
        part: messagePartData,
      }
    }
  }
  
}