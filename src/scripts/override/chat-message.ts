import { staticValues } from '../static-values';

async function getHTML(this: ChatMessage, wrapped: (...args: any) => any, ...args: any[]): Promise<JQuery> {
  const clientTemplate = this.getFlag(staticValues.moduleName, 'clientTemplate') as string;
  const clientTemplateData = this.getFlag(staticValues.moduleName, 'clientTemplateData') as any;
  if (clientTemplate && clientTemplateData) {
    this.data.update({content: await renderTemplate(clientTemplate, clientTemplateData)})
  }

  return wrapped(args);
}

export function registerHooks(): void {
  Hooks.on('setup', () => {
    libWrapper.register(staticValues.moduleName, 'ChatMessage.prototype.getHTML', getHTML, 'WRAPPER');
  });
}