(() => {
  'use strict';

  // Offline-first build: keep compatibility surface without hard dependency on Firebase CDN.
  const disabledApi = {
    readSyncMeta: async () => null,
    writeSyncMeta: async () => false,
    writeSnapshot: async () => false,
    readSnapshot: async () => null,
    listenSyncMeta: () => () => {},
    listenJoinRequests: () => () => {},
    listenClientApprovals: () => () => {},
    listenOperations: () => () => {},
    pushOperation: async () => false,
    requestJoin: async () => false,
    approveClient: async () => false,
    rejectClient: async () => false,
    removeClient: async () => false
  };

  window.FakduFirebase = {
    ready: false,
    reason: 'offline-first build: Firebase disabled by default'
  };

  window.FakduSync = {
    ready: false,
    resolveApi() {
      return disabledApi;
    }
  };

  console.info('[FAKDU][SYNC] Firebase runtime is disabled (offline-first mode).');
})();
