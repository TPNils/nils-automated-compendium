export class MemoryValue<T = any> {
  private nextListenerId = 0;
  private listeners = new Map<number, (value?: T) => void>();
  private hasSetValue: boolean;
  private value?: T;

  public set(value?: T): void {
    this.value = value;
    this.hasSetValue = true;
    for (const listener of this.listeners.values()) {
      listener(this.value);
    }
  }

  public get(): T | undefined {
    return this.value;
  }

  public listen(callback: (value?: T) => void): {unregister(): void;} {
    const id = this.nextListenerId++;
    this.listeners.set(id, callback);
    if (this.hasSetValue) {
      callback(this.value);
    }
    return {
      unregister: () => {
        this.listeners.delete(id);
      }
    }
  }
}

export class MemoryStorageService {

  private static properties = new Map<string, MemoryValue>();

  // Store this locally so you do not need to save it on the message => less DMLs and it isn't all that important anyway
  // Dont make it persistant since messages can be deleted and I don't want to write cleanup code (:
  public static isCardCollapsed(messageId: string): boolean {
    const messagePerference = MemoryStorageService.getValue<boolean>(`cardCollapse${messageId}`).get();
    if (messagePerference != null) {
      return messagePerference;
    }

    return !!game.settings.get('dnd5e', 'autoCollapseItemCards');
  }
  
  public static setCardCollapse(messageId: string, value: boolean): void {
    MemoryStorageService.getValue(`cardCollapse.${messageId}`).set(value);
  }

  public static getFocusedElementSelector(): string | null {
    return MemoryStorageService.getValue<string>(`focusedElementSelector`).get();
  }

  public static setFocusedElementSelector(selector: string): void {
    MemoryStorageService.getValue(`focusedElementSelector`).set(selector);
  }

  public static getValue<T>(key: string): MemoryValue<T> {
    if (!MemoryStorageService.properties.has(key)) {
      MemoryStorageService.properties.set(key, new MemoryValue())
    }
    return MemoryStorageService.properties.get(key);
  }

}