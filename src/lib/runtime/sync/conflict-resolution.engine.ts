export class ConflictResolutionEngine {
  /**
   * Evaluates a server payload against a local payload to determine the winner.
   * Using Last-Write-Wins (LWW) based on updated_at and sync_version.
   */
  public static resolve(localData: any | null, serverData: any): 'server_wins' | 'local_wins' {
    if (!localData) return 'server_wins';

    // If server version is strictly higher, server wins
    if (serverData.sync_version > localData.sync_version) {
      return 'server_wins';
    }

    // If versions are same, compare timestamps (LWW)
    if (serverData.sync_version === localData.sync_version) {
      const serverTime = new Date(serverData.updated_at).getTime();
      const localTime = new Date(localData.updated_at).getTime();
      
      return serverTime > localTime ? 'server_wins' : 'local_wins';
    }

    // Local version is higher (pending local changes exist)
    return 'local_wins';
  }
}
