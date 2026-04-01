import { useState } from 'react';
import { SendHorizontal } from 'lucide-react';
import type { FileAsset } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { useLocale } from '@/lib/i18n';
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
  const { t } = useLocale();
  const [value, setValue] = useState('');

  async function submit() {
    if (!value.trim() || disabled || busy) {
      return;
    }

    const current = value;
    setValue('');
    await onSend(current);
  }

  return (
    <div className="rounded-[22px] border border-border/80 bg-[linear-gradient(180deg,rgba(13,19,37,0.96),rgba(9,13,27,0.9))] p-2.5 shadow-soft">
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
        <input
          type="text"
          value={value}
          disabled={disabled || busy}
          placeholder={t('askAnythingAcrossProvider')}
          className="h-11 min-w-0 flex-1 rounded-full border border-border/80 bg-background/80 px-4 text-base text-foreground outline-none transition placeholder:text-muted-foreground focus-visible:border-ring focus-visible:bg-background disabled:cursor-not-allowed disabled:opacity-50"
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void submit();
            }
          }}
        />
        <Button
          type="button"
          className="h-11 w-11 shrink-0 rounded-full px-0"
          disabled={disabled || busy || !value.trim()}
          onClick={submit}
        >
          <SendHorizontal className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
