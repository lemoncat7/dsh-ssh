import { Client, type FileInfo } from 'basic-ftp'

/** Some servers accept MLSD but return names without any requested facts. */
export class FtpListingClient extends Client {
  private useLegacyListing = false

  override async list(path = ''): Promise<FileInfo[]> {
    if (!this.useLegacyListing) {
      const entries = await super.list(path)
      if (entries.length > 0 && entries.some(entry => entry.isFile || entry.isDirectory || entry.isSymbolicLink || entry.rawModifiedAt || entry.size > 0)) return entries
      // An empty MLSD may also omit regular files on a broken server. Verify
      // with LIST, once per connection, not SIZE/MDTM/CWD for each entry.
    }
    const previous = await this.pwd()
    try {
      if (path) await this.cd(path)
      await this.prepareTransfer(this.ftp)
      const entries = await this._requestListWithCommand('LIST')
      this.useLegacyListing = true
      return entries
    } finally {
      if (path && !this.closed) await this.cd(previous)
    }
  }
}
