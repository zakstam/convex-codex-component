import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronCodex", {
  invoke: (channel: string, ...args: unknown[]): Promise<unknown> =>
    ipcRenderer.invoke(channel, ...args),

  on: (channel: string, callback: (...args: unknown[]) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => {
      callback(...args);
    };
    ipcRenderer.on(channel, listener);
    return () => {
      ipcRenderer.removeListener(channel, listener);
    };
  },
});
