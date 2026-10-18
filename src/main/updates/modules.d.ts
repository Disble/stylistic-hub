// Declarations for imports that ship no types.

/** Vite's `?raw` import: the file's text, inlined at build time. */
declare module '*?raw' {
  /** The file's contents. */
  const text: string
  export default text
}

/** The part of yazl the update engine's test fixtures use (the release scripts write zips with it). */
declare module 'yazl' {
  /** A zip being written. */
  export class ZipFile {
    addBuffer(buffer: Buffer, metadataPath: string, options?: { mode?: number }): void
    addEmptyDirectory(metadataPath: string): void
    end(): void
    outputStream: NodeJS.ReadableStream
  }
}
