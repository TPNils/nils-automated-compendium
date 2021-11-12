export interface DmlTrigger<T extends foundry.abstract.Document<any, any>> {
  readonly type: {new(...args: any[]): T, documentName: string};
  
  // TODO async before triggers, Hooks does not support async hooks

  /**
   * A hook event that fires for every Document type before execution of a creation workflow.
   * This hook only fires for the client who is initiating the creation request.
   * 
   * The hook provides the pending document instance which will be used for the Document creation.
   * 
   * @returns Explicitly return false to prevent creation of this Document
   */
  beforeCreate?(context: DmlContext<T>): boolean | void;
  /**
   * A hook event that fires for every Document type before execution of an update workflow.
   * This hook only fires for the client who is initiating the update request.
   * 
   * Hooked functions may modify that data
   * 
   * @returns Explicitly return false to prevent update of this Document
   */
  beforeUpdate?(context: DmlContext<T>): boolean | void;
  beforeUpsert?(context: DmlContext<T>): boolean | void;
  /**
   * A hook event that fires for every Document type before execution of a deletion workflow.
   * This hook only fires for the client who is initiating the delete request.
   * 
   * @returns Explicitly return false to prevent deletion of this Document
   */
  beforeDelete?(context: DmlContext<T>): boolean | void;


  /**
   * A hook event that fires for every embedded Document type after conclusion of a creation workflow.
   * This hook fires for all connected clients after the creation has been processed.
   */
  afterCreate?(context: DmlContext<T>): void;
  /**
   * A hook event that fires for every Document type after conclusion of an update workflow.
   * This hook fires for all connected clients after the update has been processed.
   */
  afterUpdate?(context: DmlContext<T>): void;
  afterUpsert?(context: DmlContext<T>): void;
  /**
   * A hook event that fires for every Document type after conclusion of an deletion workflow.
   * This hook fires for all connected clients after the deletion has been processed.
   */
  afterDelete?(context: DmlContext<T>): void;
}

export interface DmlContext<T extends foundry.abstract.Document<any, any>> {
  readonly rows: ReadonlyArray<T>;
  readonly options: {[key: string]: any};
  readonly userId: string;
}

export interface IUnregisterTrigger {
  unregister(): void;
}

class UnregisterTrigger implements IUnregisterTrigger {
  constructor(private readonly hooks: ReadonlyArray<{hook: string, id: number}>){}

  public unregister(): void {
    for (const hook of this.hooks) {
      Hooks.off(hook.hook, hook.id);
    }
  }
}

export function registerTrigger<T extends foundry.abstract.Document<any, any>>(trigger: DmlTrigger<T>): IUnregisterTrigger {
  const hooks: Array<{hook: string, id: number}> = [];

  // before
  if (typeof trigger.beforeCreate === 'function') {
    hooks.push({
      hook: `preCreate${trigger.type.documentName}`,
      id: Hooks.on(`preCreate${trigger.type.documentName}`, wrapBeforeCreate(trigger.beforeCreate)),
    });
  }
  if (typeof trigger.beforeUpdate === 'function') {
    hooks.push({
      hook: `preUpdate${trigger.type.documentName}`,
      id: Hooks.on(`preUpdate${trigger.type.documentName}`, wrapBeforeUpdate(trigger.beforeUpdate)),
    });
  }
  if (typeof trigger.beforeUpsert === 'function') {
    hooks.push({
      hook: `preCreate${trigger.type.documentName}`,
      id: Hooks.on(`preCreate${trigger.type.documentName}`, wrapBeforeCreate(trigger.beforeUpsert)),
    });
    hooks.push({
      hook: `preUpdate${trigger.type.documentName}`,
      id: Hooks.on(`preUpdate${trigger.type.documentName}`, wrapBeforeUpdate(trigger.beforeUpsert)),
    });
  }
  if (typeof trigger.beforeDelete === 'function') {
    hooks.push({
      hook: `preDelete${trigger.type.documentName}`,
      id: Hooks.on(`preDelete${trigger.type.documentName}`, wrapBeforeDelete(trigger.beforeCreate)),
    });
  }

  // after
  if (typeof trigger.afterCreate === 'function') {
    hooks.push({
      hook: `create${trigger.type.documentName}`,
      id: Hooks.on(`create${trigger.type.documentName}`, wrapAfterCreate(trigger.afterCreate)),
    });
  }
  if (typeof trigger.afterUpdate === 'function') {
    hooks.push({
      hook: `update${trigger.type.documentName}`,
      id: Hooks.on(`update${trigger.type.documentName}`, wrapAfterUpdate(trigger.afterUpdate)),
    });
  }
  if (typeof trigger.afterUpsert === 'function') {
    hooks.push({
      hook: `create${trigger.type.documentName}`,
      id: Hooks.on(`create${trigger.type.documentName}`, wrapAfterCreate(trigger.afterUpsert)),
    });
    hooks.push({
      hook: `update${trigger.type.documentName}`,
      id: Hooks.on(`update${trigger.type.documentName}`, wrapAfterUpdate(trigger.afterUpsert)),
    });
  }
  if (typeof trigger.afterDelete === 'function') {
    hooks.push({
      hook: `delete${trigger.type.documentName}`,
      id: Hooks.on(`delete${trigger.type.documentName}`, wrapAfterDelete(trigger.afterCreate)),
    });
  }

  return new UnregisterTrigger(hooks);
}

function wrapBeforeCreate<T extends foundry.abstract.Document<any, any>>(callback: (context: DmlContext<T>) => boolean | void): (document: T, options: DmlContext<T>['options'], userId: string) => void {
  return (document: T, options: DmlContext<T>['options'], userId: string) => {
    return callback({
      rows: [document],
      options: options,
      userId: userId
    });
  }
}
function wrapBeforeUpdate<T extends foundry.abstract.Document<any, any>>(callback: (context: DmlContext<T>) => boolean | void): (document: T, change: any, options: DmlContext<T>['options'], userId: string) => void {
  return (document: T, change: any, options: DmlContext<T>['options'], userId: string) => {
    return callback({
      rows: [document],
      options: options,
      userId: userId
    });
  }
}
const wrapBeforeDelete = wrapBeforeCreate;


function wrapAfterCreate<T extends foundry.abstract.Document<any, any>>(callback: (context: DmlContext<T>) => boolean | void): (document: T, data: any, options: DmlContext<T>['options'], userId: string) => void {
  return (document: T, data: any, options: DmlContext<T>['options'], userId: string) => {
    return callback({
      rows: [document],
      options: options,
      userId: userId
    });
  }
}
const wrapAfterUpdate = wrapBeforeUpdate;
const wrapAfterDelete = wrapBeforeCreate; // same contract as BEFORE create, not after