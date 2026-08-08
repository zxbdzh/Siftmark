export const SAVE_CURRENT_PAGE_COMMAND = 'save-current-page';
export function registerBrowserCommands(api: typeof browser.commands, onSave: () => void): () => void { const listener = (command: string) => { if (command === SAVE_CURRENT_PAGE_COMMAND) onSave(); }; api.onCommand.addListener(listener); return () => api.onCommand.removeListener(listener); }
