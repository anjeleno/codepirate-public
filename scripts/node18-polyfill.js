// Polyfill File global for Node 18 — used only when running vsce
// File was added to globalThis in Node 20; Node 18 has it in 'buffer' but not globally.
if (!globalThis.File) {
  const { Blob } = require('buffer')
  class File extends Blob {
    constructor(fileBits, fileName, options = {}) {
      super(fileBits, options)
      this.name = fileName
      this.lastModified = options.lastModified ?? Date.now()
    }
  }
  globalThis.File = File
}
