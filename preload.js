const { contextBridge, ipcRenderer } = require('electron');

const api = {
  loadJsonPath: (pathText) => ipcRenderer.invoke('latchr:load-json-path', { path: pathText }),
  listTagTemplates: () => ipcRenderer.invoke('latchr:list-event-templates'),
  provisionProject: (payload) => ipcRenderer.invoke('latchr:provision-project', payload || {}),
  probeVideoMetadata: (payload) => ipcRenderer.invoke('latchr:probe-video', payload || {}),
  extractFrame: (payload) => ipcRenderer.invoke('latchr:extract-frame', payload || {}),
  exportClips: (payload) => ipcRenderer.invoke('latchr:export-clips', payload || {}),
  exportMerged: (payload) => ipcRenderer.invoke('latchr:export-merged', payload || {}),
  convertVideoToMp4: (payload) => ipcRenderer.invoke('latchr:convert-video-mp4', payload || {}),
  pickVideoFile: () => ipcRenderer.invoke('latchr:pick-video'),
  pickJsonFile: (titleText, startDir) => ipcRenderer.invoke('latchr:pick-json', { title: titleText, start_dir: startDir || '' }),
  pickImageFile: (titleText, startDir) => ipcRenderer.invoke('latchr:pick-image', { title: titleText, start_dir: startDir || '' }),
  openProject: () => ipcRenderer.invoke('latchr:open-project'),
  saveProject: (payload) => ipcRenderer.invoke('latchr:save-project', payload || {}),
  saveTagTemplate: (payload) => ipcRenderer.invoke('latchr:save-event-template', payload || {}),
  listProjectTimelines: (projectPath) => ipcRenderer.invoke('latchr:list-project-timelines', { project_path: projectPath || '' }),
  saveProjectTimeline: (payload) => ipcRenderer.invoke('latchr:save-project-timeline', payload || {}),
  renameProjectTimeline: (payload) => ipcRenderer.invoke('latchr:rename-project-timeline', payload || {}),
  deleteProjectTimeline: (payload) => ipcRenderer.invoke('latchr:delete-project-timeline', payload || {}),
  onVideoConvertProgress: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const channel = 'latchr:video-convert-progress';
    const handler = (_event, payload) => {
      try { callback(payload || {}); } catch (_) {}
    };
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
};

contextBridge.exposeInMainWorld('latchrAPI', api);
// Legacy renderer alias retained for compatibility with older saved builds.
contextBridge.exposeInMainWorld('sportTaggerAPI', api);
