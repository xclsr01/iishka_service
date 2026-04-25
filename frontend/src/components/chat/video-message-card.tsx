import { useEffect, useState } from 'react';
import { AlertCircle, Download, ExternalLink, Loader2, RefreshCw, Trash2, Video } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { AsyncMessageProviderMeta, ChatMessage, FileAsset, FileAssetLinks } from '@/lib/api';
import { apiClient } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useLocale } from '@/lib/i18n';
import { getTelegramWebApp } from '@/lib/telegram';

type VideoMessageCardState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; url: string }
  | { kind: 'error'; message: string };

type DownloadSheetState = {
  file: FileAsset;
  links: FileAssetLinks;
};

function isAsyncVideoMeta(value: ChatMessage['providerMeta']): value is AsyncMessageProviderMeta {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  return value.mediaKind === 'video' || value.jobKind === 'VIDEO';
}

function getVideoAttachment(message: ChatMessage) {
  return message.attachments?.find((attachment) => attachment.file.mimeType.startsWith('video/'))?.file ?? null;
}

function formatBytes(sizeBytes: number) {
  if (sizeBytes >= 1024 * 1024) {
    return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  if (sizeBytes >= 1024) {
    return `${Math.round(sizeBytes / 1024)} KB`;
  }

  return `${sizeBytes} B`;
}

function triggerDownload(url: string, filename: string) {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener noreferrer';
  anchor.style.display = 'none';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

function openObjectUrl(url: string) {
  window.open(url, '_blank', 'noopener,noreferrer') ?? window.location.assign(url);
}

function isLikelyMobileBrowser() {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

function openExternalUrl(url: string) {
  const webApp = getTelegramWebApp();
  if (webApp?.openLink) {
    webApp.openLink(url);
    return;
  }

  openObjectUrl(url);
}

function downloadWithTelegram(url: string, filename: string) {
  const webApp = getTelegramWebApp();
  if (!webApp?.downloadFile) {
    return false;
  }

  webApp.downloadFile({
    url,
    file_name: filename,
  });
  return true;
}

function toVideoCardErrorMessage(error: unknown, fallback: string) {
  if (!(error instanceof Error)) {
    return fallback;
  }

  const normalized = error.message.trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }

  if (
    normalized.includes('load failed') ||
    normalized.includes('failed to fetch') ||
    normalized.includes('networkerror')
  ) {
    return fallback;
  }

  return error.message;
}

export function VideoMessageCard({
  message,
  onRetry,
  onDelete,
}: {
  message: ChatMessage;
  onRetry?: (messageId: string) => Promise<void>;
  onDelete?: (messageId: string) => Promise<void>;
}) {
  const { t } = useLocale();
  const providerMeta = isAsyncVideoMeta(message.providerMeta) ? message.providerMeta : null;
  const prompt = providerMeta?.prompt?.trim() || null;
  const videoFile = getVideoAttachment(message);
  const [videoState, setVideoState] = useState<VideoMessageCardState>({ kind: 'idle' });
  const [actionError, setActionError] = useState<string | null>(null);
  const [downloadSheet, setDownloadSheet] = useState<DownloadSheetState | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isPreparingDownload, setIsPreparingDownload] = useState(false);
  const [isOpeningVideo, setIsOpeningVideo] = useState(false);

  useEffect(() => {
    const file = videoFile;
    if (!file) {
      setVideoState({ kind: 'idle' });
      return;
    }

    let revokedUrl: string | null = null;
    let cancelled = false;

    setVideoState({ kind: 'loading' });

    apiClient.getFileBlob(file.id)
      .then((blob) => {
        if (cancelled) {
          return;
        }

        revokedUrl = URL.createObjectURL(blob);
        setVideoState({ kind: 'ready', url: revokedUrl });
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        setVideoState({
          kind: 'error',
          message: toVideoCardErrorMessage(error, t('videoLoadFailed')),
        });
      });

    return () => {
      cancelled = true;
      if (revokedUrl) {
        URL.revokeObjectURL(revokedUrl);
      }
    };
  }, [t, videoFile?.id]);

  const normalizedStatus =
    message.status === 'FAILED'
      ? 'FAILED'
      : message.status === 'STREAMING'
        ? (providerMeta?.status || 'RUNNING')
        : (providerMeta?.status || message.status || null);
  const isPending = normalizedStatus === 'QUEUED' || normalizedStatus === 'RUNNING' || message.status === 'STREAMING';
  const isFailed = normalizedStatus === 'FAILED' || message.status === 'FAILED';
  const canShowPlayer = Boolean(videoFile) && videoState.kind === 'ready';
  const isBusy = isRetrying || isDeleting || isPreparingDownload || isOpeningVideo;

  async function handleDownload(file: FileAsset) {
    setActionError(null);
    setIsPreparingDownload(true);

    try {
      const links = await apiClient.getFileLinks(file.id);

      if (isLikelyMobileBrowser()) {
        setDownloadSheet({ file, links });
        return;
      }

      triggerDownload(links.download.url, links.download.filename || file.originalName);
    } catch (error) {
      setActionError(toVideoCardErrorMessage(error, t('imageDownloadFailed')));
    } finally {
      setIsPreparingDownload(false);
    }
  }

  async function handleOpen(file: FileAsset) {
    setActionError(null);
    setIsOpeningVideo(true);

    try {
      const links = await apiClient.getFileLinks(file.id);
      openExternalUrl(links.open.url);
    } catch (error) {
      setActionError(toVideoCardErrorMessage(error, t('imageOpenFailed')));
    } finally {
      setIsOpeningVideo(false);
    }
  }

  function saveVideoToGallery() {
    if (!downloadSheet) {
      return;
    }

    openExternalUrl(downloadSheet.links.open.url);
    setDownloadSheet(null);
  }

  function saveVideoToFiles() {
    if (!downloadSheet) {
      return;
    }

    const filename = downloadSheet.links.download.filename || downloadSheet.file.originalName;
    const handledByTelegram = downloadWithTelegram(downloadSheet.links.download.url, filename);
    if (!handledByTelegram) {
      triggerDownload(downloadSheet.links.download.url, filename);
    }

    setDownloadSheet(null);
  }

  async function handleRetry() {
    if (!onRetry || isBusy) {
      return;
    }

    setActionError(null);
    setIsRetrying(true);

    try {
      await onRetry(message.id);
    } catch (error) {
      setActionError(toVideoCardErrorMessage(error, t('retryVideoFailed')));
    } finally {
      setIsRetrying(false);
    }
  }

  async function handleDelete() {
    if (!onDelete || isBusy) {
      return;
    }

    const confirmed = window.confirm(t('confirmDeleteVideoBody'));
    if (!confirmed) {
      return;
    }

    setActionError(null);
    setIsDeleting(true);

    try {
      await onDelete(message.id);
    } catch (error) {
      setActionError(toVideoCardErrorMessage(error, t('deleteVideoFailed')));
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <div className="space-y-3 rounded-[18px] border border-cyan-400/20 bg-[linear-gradient(180deg,rgba(7,16,32,0.96),rgba(8,20,38,0.88))] p-3 shadow-soft">
      {downloadSheet && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/70 px-3 pb-4 pt-10 sm:items-center sm:justify-center">
          <div className="w-full max-w-sm rounded-[18px] border border-white/10 bg-[linear-gradient(180deg,rgba(10,18,34,0.98),rgba(8,13,26,0.98))] p-3 shadow-soft">
            <div className="px-1 pb-3">
              <div className="font-display text-lg font-bold text-white">{t('downloadVideoTitle')}</div>
              <p className="mt-1 text-sm leading-5 text-muted-foreground">{t('downloadVideoHint')}</p>
            </div>
            <div className="space-y-2">
              <Button type="button" className="w-full justify-start gap-2" onClick={saveVideoToGallery}>
                <ExternalLink className="h-4 w-4" />
                {t('saveVideoToGallery')}
              </Button>
              <Button type="button" variant="secondary" className="w-full justify-start gap-2" onClick={saveVideoToFiles}>
                <Download className="h-4 w-4" />
                {t('saveVideoToFiles')}
              </Button>
              <Button type="button" variant="ghost" className="w-full" onClick={() => setDownloadSheet(null)}>
                {t('cancel')}
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-cyan-200/80">
            <Video className="h-4 w-4" />
            {t('videoGeneration')}
          </div>
          {prompt && (
            <p className="mt-2 whitespace-pre-wrap text-sm font-semibold leading-6 text-white">{prompt}</p>
          )}
        </div>
        <div
          className={cn(
            'shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.14em]',
            isFailed
              ? 'border-destructive/40 bg-destructive/10 text-destructive'
              : isPending || videoState.kind === 'loading'
                ? 'border-primary/30 bg-primary/10 text-primary'
                : 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200'
          )}
        >
          {isFailed ? t('jobStatusFAILED') : isPending || videoState.kind === 'loading' ? t('jobStatusRUNNING') : t('jobStatusCOMPLETED')}
        </div>
      </div>

      {actionError && (
        <div className="rounded-[14px] border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {actionError}
        </div>
      )}

      {canShowPlayer && videoFile ? (
        <div className="space-y-3">
          <video
            className="w-full rounded-[16px] border border-white/10 bg-black/50"
            controls
            playsInline
            preload="metadata"
            src={videoState.url}
          />
          <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
            <span className="truncate">{videoFile.originalName}</span>
            <span>{formatBytes(videoFile.sizeBytes)}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              className="gap-2 px-3 py-2 text-xs"
              disabled={isBusy}
              onClick={() => void handleOpen(videoFile)}
            >
              {isOpeningVideo ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
              {isOpeningVideo ? t('openingImage') : t('openVideo')}
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="gap-2 px-3 py-2 text-xs"
              disabled={isBusy}
              onClick={() => void handleDownload(videoFile)}
            >
              {isPreparingDownload ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              {isPreparingDownload ? t('preparingDownload') : t('downloadVideo')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="gap-2 px-3 py-2 text-xs text-destructive"
              disabled={isBusy || !onDelete}
              onClick={() => void handleDelete()}
            >
              {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              {isDeleting ? t('deletingVideo') : t('deleteVideo')}
            </Button>
          </div>
        </div>
      ) : isFailed ? (
        <div className="space-y-3">
          <div className="rounded-[16px] border border-destructive/30 bg-destructive/10 px-3 py-3 text-sm text-destructive">
            <div className="flex items-start gap-2">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p>{message.failureReason || providerMeta?.failureMessage || t('videoGenerationFailed')}</p>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              className="gap-2 px-3 py-2 text-xs"
              disabled={isBusy || !onRetry}
              onClick={() => void handleRetry()}
            >
              {isRetrying ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              {isRetrying ? t('retryingVideo') : t('retryVideo')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="gap-2 px-3 py-2 text-xs text-destructive"
              disabled={isBusy || !onDelete}
              onClick={() => void handleDelete()}
            >
              {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              {isDeleting ? t('deletingVideo') : t('deleteVideo')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3 rounded-[16px] border border-primary/20 bg-primary/5 px-3 py-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          <span>{videoState.kind === 'error' ? videoState.message : t('videoGenerationInProgress')}</span>
        </div>
      )}
    </div>
  );
}
