const MAX_AGENT_IMAGE_DATA_URL_LENGTH = 3_000_000;

export interface AgentScreenshotTab {
  id?: number;
  windowId?: number;
}

export interface AgentScreenshotApi {
  getTab(tabId: number): Promise<AgentScreenshotTab | undefined>;
  getActiveTab(windowId: number): Promise<AgentScreenshotTab | undefined>;
  captureVisibleTab(
    windowId: number,
    options: { format: 'jpeg'; quality: number }
  ): Promise<string>;
}

/**
 * Captures only the currently active, policy-approved viewport. Returning
 * undefined is intentional: visual context is optional and must never make a
 * bookmark capture fail.
 */
export async function captureAgentScreenshot(
  api: AgentScreenshotApi,
  input: { tabId: number; screenshotAllowed: boolean }
): Promise<string | undefined> {
  if (!input.screenshotAllowed) return undefined;
  try {
    const tab = await api.getTab(input.tabId);
    if (tab?.id !== input.tabId || tab.windowId === undefined) return undefined;
    const activeTab = await api.getActiveTab(tab.windowId);
    if (activeTab?.id !== input.tabId) return undefined;
    const dataUrl = await api.captureVisibleTab(tab.windowId, {
      format: 'jpeg',
      quality: 60
    });
    if (
      dataUrl.length > MAX_AGENT_IMAGE_DATA_URL_LENGTH ||
      !/^data:image\/jpeg;base64,[a-z0-9+/=]+$/i.test(dataUrl)
    )
      return undefined;
    return dataUrl;
  } catch {
    return undefined;
  }
}
