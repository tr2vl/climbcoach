// The only bridge between the window and the rest of the app. The page gets exactly these calls.
const { contextBridge, ipcRenderer } = require('electron');

const call = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);
const listen = (channel) => (callback) => {
  const handler = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('climb', {
  isDemo: false,
  info: call('app:info'),
  settings: { get: call('settings:get'), update: call('settings:update') },
  keys: { status: call('keys:status'), save: call('keys:save'), test: call('keys:test') },
  open: call('shell:open'),
  showInFolder: call('shell:show'),
  updates: { status: call('updates:status'), check: call('updates:check'), install: call('updates:install'), onChange: listen('updates:changed') },
  usage: call('gemini:usage'),
  data: { snapshot: call('data:snapshot'), onChange: listen('data:changed') },
  matches: { pickVideo: call('matches:pickVideo'), add: call('matches:add'), update: call('matches:update'), delete: call('matches:delete') },
  reports: { dispute: call('reports:dispute'), killer: call('reports:killer') },
  exports: { save: call('exports:save') },
  analysis: { status: call('analysis:status'), start: call('analysis:start'), cancel: call('analysis:cancel'), dequeue: call('analysis:dequeue'), onChange: listen('analysis:changed') },
  training: { refresh: call('training:refresh'), start: call('training:start'), onUpdate: listen('training:update') },
  learn: { view: call('learn:view'), search: call('learn:search'), study: call('learn:study'), autoStudy: call('learn:autoStudy'), findFix: call('learn:findFix'), onChange: listen('learn:changed') },
  meta: { view: call('meta:view'), refresh: call('meta:refresh'), onChange: listen('meta:changed') },
  maps: { note: call('maps:note') },
  drills: { save: call('drills:save'), delete: call('drills:delete'), practiced: call('drills:practiced') },
  openVideos: call('shell:videos'),
  recording: {
    status: call('recording:status'), pick: call('recording:pick'), cancel: call('recording:cancel'), dismiss: call('recording:dismiss'),
    choose: call('recording:choose'), begin: call('recording:begin'), chunk: call('recording:chunk'), frame: call('recording:frame'),
    finish: call('recording:finish'), onChange: listen('recording:changed'),
  },
  clips: { save: call('clips:save'), done: call('clips:done'), onJobs: listen('clips:jobs') },
  scan: { frame: call('scan:frame'), done: call('scan:done'), onJob: listen('scan:job') },
});
