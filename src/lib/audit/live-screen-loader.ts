let liveScreen: Promise<typeof import('../../components/audit/LiveAuditProgress')> | undefined;

export function loadLiveAuditScreen() {
  liveScreen ||= import('../../components/audit/LiveAuditProgress').catch(error => {
    liveScreen = undefined;
    throw error;
  });
  return liveScreen;
}
