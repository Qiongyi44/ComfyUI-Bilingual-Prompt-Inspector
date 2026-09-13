export function createPanelSyncHub() {
  const listeners = new Set();
  const machineTranslations = new Map();

  return {
    machineTranslations,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    notify(kind, source) {
      for (const listener of listeners) {
        try {
          Promise.resolve(listener(kind, source)).catch((error) => {
            console.warn("[BilingualPromptInspector] 节点同步失败", error);
          });
        } catch (error) {
          console.warn("[BilingualPromptInspector] 节点同步失败", error);
        }
      }
    },
  };
}

export const panelSyncHub = createPanelSyncHub();
