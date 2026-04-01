import { useState } from 'react';
import { SendHorizontal } from 'lucide-react';
import type { FileAsset } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { UploadPicker } from './upload-picker';

export function ChatComposer({
  pendingFiles,
  onUpload,
  onRemoveFile,
  onSend,
  disabled,
  busy,
}: {
  pendingFiles: FileAsset[];
  onUpload: (files: FileList | null) => void;
  onRemoveFile: (fileId: string) => void;
  onSend: (content: string) => Promise<void>;
  disabled?: boolean;
  busy?: boolean;
}) {
  const [value, setValue] = useState('');

  async function submit() {
    if (!value.trim() || disabled || busy) {
      return;
    }

    const current = value;
    await onSend(current);
    setValue('');
  }

  return (
    <div className="rounded-[24px] border border-border bg-card p-3 shadow-soft">
      {pendingFiles.length > 0 && (
        <div className="mb-2">
          <UploadPicker
            pendingFiles={pendingFiles}
            onFilesSelected={onUpload}
            onRemove={onRemoveFile}
            disabled={disabled || busy}
          />
        </div>
      )}
      <div className="flex items-center gap-2">
        <UploadPicker
          pendingFiles={[]}
          onFilesSelected={onUpload}
          onRemove={onRemoveFile}
          disabled={disabled || busy}
          compact
        />
        <Textarea
          value={value}
          disabled={disabled || busy}
          placeholder="Ask anything across your selected provider..."
          rows={1}
          className="h-12 min-h-12 resize-none rounded-full px-4 py-3"
          onChange={(event) => setValue(event.target.value)}
        />
        <Button
          type="button"
          className="h-12 w-12 shrink-0 px-0"
          disabled={disabled || busy || !value.trim()}
          onClick={submit}
        >
          <SendHorizontal className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
