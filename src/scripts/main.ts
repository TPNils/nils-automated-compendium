import { registerHooks as registerGlobalApiHooks } from "./global-api";
import { registerHooks as registerHtmlHooks } from "./global-html-listener";
import { provider } from "./provider/provider";
import { UtilsChatMessage } from "./utils/utils-chat-message";

registerGlobalApiHooks();
registerHtmlHooks();
provider.registerHooks();
UtilsChatMessage.registerHooks();