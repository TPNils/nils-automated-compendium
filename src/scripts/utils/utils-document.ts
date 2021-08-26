import { MyActor, MyActorData, MyItem } from "../types/fixed-types";

export class UtilsDocument {

  public static async actorFromUuid(uuid: string): Promise<MyActor> {
    try {
      let document = await fromUuid(uuid);
      // The UUID of a token actor is the token
      if (document.documentName === (TokenDocument as any).documentName) {
        document = (document as TokenDocument).getActor();
      }
      if (document.documentName !== (Actor as any).documentName) {
        throw new Error(`UUID '${uuid}' is not an ${(Actor as any).documentName}. In stead found: ${document.documentName}`)
      }
      return document as any as MyActor;
    } catch {
      return null;
    }
  }

  public static actorsFromUuid(uuids: string[], options: {deduplciate?: boolean} = {}): Promise<MyActor[]> {
    if (options.deduplciate) {
      uuids = Array.from(new Set<string>(uuids));
    }
    return Promise.all(uuids.map(tokenUuid => {
      return UtilsDocument.actorFromUuid(tokenUuid);
    }));
  }

  public static async tokenFromUuid(uuid: string): Promise<TokenDocument> {
    try {
      let document = await fromUuid(uuid);
      if (document.documentName !== (TokenDocument as any).documentName) {
        throw new Error(`UUID '${uuid}' is not a ${(TokenDocument as any).documentName}. In stead found: ${document.documentName}`)
      }
      return document as TokenDocument;
    } catch {
      return null;
    }
  }

  public static tokensFromUuid(uuids: string[], options: {deduplciate?: boolean} = {}): Promise<TokenDocument[]> {
    if (options.deduplciate) {
      uuids = Array.from(new Set<string>(uuids));
    }
    return Promise.all(uuids.map(tokenUuid => {
      return UtilsDocument.tokenFromUuid(tokenUuid);
    }));
  }

  public static async itemFromUuid(uuid: string): Promise<MyItem> {
    try {
      let document = await fromUuid(uuid);
      if (document.documentName !== (Item as any).documentName) {
        throw new Error(`UUID '${uuid}' is not an ${(Item as any).documentName}. In stead found: ${document.documentName}`)
      }
      return document as any as MyItem;
    } catch {
      return null;
    }
  }

  public static itemsFromUuid(uuids: string[], options: {deduplciate?: boolean} = {}): Promise<MyItem[]> {
    if (options.deduplciate) {
      uuids = Array.from(new Set<string>(uuids));
    }
    return Promise.all(uuids.map(tokenUuid => {
      return UtilsDocument.itemFromUuid(tokenUuid);
    }));
  }

  public static async sceneFromUuid(uuid: string): Promise<Scene> {
    try {
      let document = await fromUuid(uuid);
      if (document.documentName !== (Scene as any).documentName) {
        throw new Error(`UUID '${uuid}' is not an ${(Scene as any).documentName}. In stead found: ${document.documentName}`)
      }
      return document as Scene;
    } catch {
      return null;
    }
  }

  public static scenesFromUuid(uuids: string[], options: {deduplciate?: boolean} = {}): Promise<Scene[]> {
    if (options.deduplciate) {
      uuids = Array.from(new Set<string>(uuids));
    }
    return Promise.all(uuids.map(tokenUuid => {
      return UtilsDocument.sceneFromUuid(tokenUuid);
    }));
  }

  public static async updateTokenActors(actorDataByTokenUuid: Map<string, DeepPartial<MyActorData>>): Promise<void> {
    const linkedActorUpdates = [];
    const unlinkedActorUpdatesByParentUuid = new Map<string, Array<Partial<TokenDocument['data']>>>();

    const tokensByUuid = new Map<string, TokenDocument>();
    for (const token of (await UtilsDocument.tokensFromUuid(Array.from(actorDataByTokenUuid.keys())))) {
      tokensByUuid.set(token.uuid, token);
    }

    for (const [tokenUuid, actorData] of actorDataByTokenUuid.entries()) {
      const token = tokensByUuid.get(tokenUuid);
      // token got deleted I guess?
      if (!token) {
        continue;
      }

      if (token.isLinked) {
        linkedActorUpdates.push({
          ...actorData,
          _id: (token.getActor() as MyActor).id,
        });
      } else {
        if (!unlinkedActorUpdatesByParentUuid.has(token.parent.uuid)) {
          unlinkedActorUpdatesByParentUuid.set(token.parent.uuid, []);
        }
        unlinkedActorUpdatesByParentUuid.get(token.parent.uuid).push({
          _id: token.id,
          actorData: actorData
        });
      }
    }

    const promises: Promise<any>[] = [];
    if (linkedActorUpdates.length > 0) {
      promises.push(CONFIG.Actor.documentClass.updateDocuments(linkedActorUpdates));
    }
    for (const [parentUuid, actorUpdates] of unlinkedActorUpdatesByParentUuid.entries()) {
      promises.push(fromUuid(parentUuid).then(parent => parent.updateEmbeddedDocuments('Token', actorUpdates)));
    }

    return Promise.all(promises).then();
  }

}