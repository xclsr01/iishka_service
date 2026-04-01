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
    <div className="rounded-[28px] border border-border bg-card p-3.5 shadow-soft">
      <UploadPicker
        pendingFiles={pendingFiles}
        onFilesSelected={onUpload}
        onRemove={onRemoveFile}
        disabled={disabled || busy}
      />
      <div className="mt-3 flex items-end gap-3">
        <Textarea
          value={value}
          disabled={disabled || busy}
          placeholder="Ask anything across your selected provider..."
          className="min-h-20 resize-none"
          onChange={(event) => setValue(event.target.value)}
        />
        <Button type="button" disabled={disabled || busy || !value.trim()} onClick={submit}>
          <SendHorizontal className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
