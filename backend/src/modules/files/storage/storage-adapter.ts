export type UploadResult = {
  storageKey: string;
};

export type StoredObject = {
  content: Uint8Array;
  mimeType?: string | null;
};

export interface StorageAdapter {
  putObject(input: {
    storageKey: string;
    content: Uint8Array;
    mimeType: string;
  }): Promise<UploadResult>;
  getObject(input: {
    storageKey: string;
  }): Promise<StoredObject>;
  deleteObject(input: {
    storageKey: string;
  }): Promise<void>;
}
