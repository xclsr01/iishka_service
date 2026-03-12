export type UploadResult = {
  storageKey: string;
};

export interface StorageAdapter {
  putObject(input: {
    storageKey: string;
    content: Uint8Array;
    mimeType: string;
  }): Promise<UploadResult>;
}
