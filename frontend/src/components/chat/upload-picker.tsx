import { Paperclip, X } from 'lucide-react';
import type { FileAsset } from '@/lib/api';
import { Button } from '@/components/ui/button';

export function UploadPicker({
  pendingFiles,
  onFilesSelected,
  onRemove,
  disabled,
  compact,
}: {
  pendingFiles: FileAsset[];
  onFilesSelected: (files: FileList | null) => void;
  onRemove: (fileId: string) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  return (
    <div className={compact ? 'min-w-0' : 'space-y-3'}>
      <label
        className={
          compact
            ? 'inline-flex h-11 w-11 cursor-pointer items-center justify-center rounded-full border border-border bg-white/85 text-muted-foreground'
            : 'inline-flex cursor-pointer items-center gap-2 text-sm text-muted-foreground'
        }
      >
        <Paperclip className="h-4 w-4" />
        {!compact && <span>Upload a file</span>}
        <input
          className="hidden"
          type="file"
          disabled={disabled}
          onChange={(event) => {
            onFilesSelected(event.target.files);
            event.currentTarget.value = '';
          }}
        />
      </label>

      {pendingFiles.length > 0 && (
        <div className={compact ? 'mt-2 flex flex-wrap gap-2' : 'flex flex-wrap gap-2'}>
          {pendingFiles.map((file) => (
            <div
              key={file.id}
              className="inline-flex items-center gap-2 rounded-full bg-white/85 px-3 py-1 text-xs text-foreground"
            >
              <span>{file.originalName}</span>
              <Button
                type="button"
                variant="ghost"
                className="h-5 w-5 rounded-full p-0"
                onClick={() => onRemove(file.id)}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
