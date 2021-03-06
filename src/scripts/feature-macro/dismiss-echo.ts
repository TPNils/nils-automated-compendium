/* TODO convert to modular card
import { AllPermissions } from "../custom-permissions";
import { IMacro } from "../macro";
import { MacroContext } from "../macro-context";
import { UtilsDocument } from "../lib/db/utils-document";

export class DismissEcho implements IMacro {

  public async requirePermissions(): Promise<AllPermissions[]> {
    return ['TOKEN_DELETE'];
  }

  public async run(context: MacroContext): Promise<void> {
    if (game.paused && !game.user.isGM) {
      return;
    }

    const actor = await UtilsDocument.actorFromUuid(context.actorUuid);
    const isEchoOf = actor.getFlag('world', 'is-echo-of');
    const echoActorId = actor.getFlag('world', 'echo-actor-id');
  
    const actorIds = [];
    if (isEchoOf) {
      actorIds.push(actor.data._id);
    } else if (echoActorId) {
      actorIds.push(echoActorId);
    }
    if (actorIds.length === 0) {
      ui.notifications.error(`${actor.data.name} doesn't have an echo`);
      return;
    }
  
    const currentScene = game.scenes.get(game.user.viewedScene);
    const deleteTokenIds = [];
    for (const actorId of actorIds) {
      // It's possible the actor has 2 token instances
  
      const tokens = [];
      for (const token of currentScene.data.tokens) {
        if (token.data.actorId === actorId) {
          tokens.push(token.data);
        }
      }
  
      // If the actor as multiple tokens, throw an error
      // If needed, this can be updated later by filtering on player selected tokens
      if (tokens.length > 1) {
        ui.notifications.error(`Actor ${game.actors.get(actorId).name} needs to have 1 token in the current scene, found: ${tokens.length}`)
        return;
      }
  
      for (const token of tokens) {
        deleteTokenIds.push(token._id);
      }
    }
  
    currentScene.deleteEmbeddedDocuments('Token', deleteTokenIds);
  }

}
*/