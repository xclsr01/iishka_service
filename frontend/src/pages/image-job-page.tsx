import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Download, ExternalLink, ImageIcon, Loader2, RefreshCw, ShieldAlert, Sparkles, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  apiClient,
  type GeneratedImage,
  type GenerationJob,
  type ImageJobResultPayload,
  type Provider,
  type Subscription,
} from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useImageJob } from '@/hooks/use-image-job';
import { useLocale } from '@/lib/i18n';
import { cn } from '@/lib/cn';
import { getTelegramWebApp } from '@/lib/telegram';

function isImageJobResult(value: unknown): value is ImageJobResultPayload {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as { kind?: unknown; images?: unknown };
  return candidate.kind === 'IMAGE' && Array.isArray(candidate.images);
}

function imageToDataUrl(image: GeneratedImage) {
  return `data:${image.mimeType};base64,${image.dataBase64}`;
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

async function downloadViaBlob(url: string, filename: string) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Download failed with status ${response.status}`);
  }

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);

  try {
    triggerDownload(objectUrl, filename);
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
  }
}

function isLikelyMobileBrowser() {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

function openInNewWindow(url: string, openedWindow: Window | null) {
  if (openedWindow) {
    openedWindow.location.href = url;
  } else {
    window.open(url, '_blank', 'noopener,noreferrer') ?? window.location.assign(url);
  }
}

function openImageUrl(url: string, openedWindow: Window | null = null) {
  const webApp = getTelegramWebApp();
  if (webApp?.openLink) {
    openedWindow?.close();
    webApp.openLink(url);
    return;
  }

  openInNewWindow(url, openedWindow);
}

function shouldPreferImageViewer() {
  return Boolean(getTelegramWebApp()) || isLikelyMobileBrowser();
}

function actionKey(jobId: string, imageIndex: number, kind: AssetActionKind) {
  return `${jobId}:${imageIndex}:${kind}`;
}

function imageActionPrefix(jobId: string, imageIndex: number) {
  return `${jobId}:${imageIndex}:`;
}

type AssetActionKind = 'download' | 'open';
type AssetActionStatus = 'loading' | 'success' | 'error';

type AssetActionState = {
  key: string;
  status: AssetActionStatus;
  message: string;
};

type ImageHistoryItem = {
  job: GenerationJob;
  images: GeneratedImage[];
  text: string | null;
};

type DeleteDialogState = {
  jobId: string;
  prompt: string;
};

function canRefreshImageJob(job: GenerationJob, images: GeneratedImage[]) {
  return images.length === 0 && ['FAILED', 'CANCELED', 'QUEUED'].includes(job.status);
}

function toDeleteErrorMessage(error: unknown, fallback: string) {
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

export function ImageJobPage({
  provider,
  subscription,
  onActivateDevSubscription,
  isActivatingSubscription,
  isUnsubscribingSubscription,
  onSubscriptionChange,
}: {
  provider: Provider;
  subscription: Subscription;
  onActivateDevSubscription: () => Promise<void>;
  isActivatingSubscription: boolean;
  isUnsubscribingSubscription: boolean;
  onSubscriptionChange: (subscription: Subscription) => void;
}) {
  const { t } = useLocale();
  const [prompt, setPrompt] = useState('');
  const [assetAction, setAssetAction] = useState<AssetActionState | null>(null);
  const [refreshingJobId, setRefreshingJobId] = useState<string | null>(null);
  const [deleteDialog, setDeleteDialog] = useState<DeleteDialogState | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deletingJobId, setDeletingJobId] = useState<string | null>(null);
  const { job, jobs, isLoadingHistory, isSubmitting, error, createImageJob, removeImageJob, resetJob } = useImageJob(provider.id);
  const syncedJobIdRef = useRef<string | null>(null);
  const actionResetTimerRef = useRef<number | null>(null);
  const isBusy = isSubmitting;
  const imageHistory = useMemo<ImageHistoryItem[]>(() => {
    return jobs.map((historyJob) => {
      const payload = isImageJobResult(historyJob.resultPayload) ? historyJob.resultPayload : null;
      return {
        job: historyJob,
        images: payload?.images ?? [],
        text: payload?.text ?? null,
      };
    });
  }, [jobs]);

  useEffect(() => {
    if (job?.status !== 'COMPLETED' || syncedJobIdRef.current === job.id) {
      return;
    }

    syncedJobIdRef.current = job.id;
    apiClient.getSubscription()
      .then((response) => onSubscriptionChange(response.subscription))
      .catch(() => {
        // Token refresh is non-critical for the generated image result.
      });
  }, [job?.id, job?.status, onSubscriptionChange]);

  useEffect(() => {
    return () => {
      if (actionResetTimerRef.current) {
        window.clearTimeout(actionResetTimerRef.current);
      }
    };
  }, []);

  function updateAssetAction(nextAction: AssetActionState | null) {
    if (actionResetTimerRef.current) {
      window.clearTimeout(actionResetTimerRef.current);
      actionResetTimerRef.current = null;
    }

    setAssetAction(nextAction);

    if (nextAction?.status === 'success') {
      actionResetTimerRef.current = window.setTimeout(() => {
        setAssetAction(null);
        actionResetTimerRef.current = null;
      }, 5000);
    }
  }

  async function submit() {
    const normalizedPrompt = prompt.trim();
    if (!normalizedPrompt || isBusy || !subscription.hasAccess) {
      return;
    }

    await createImageJob(normalizedPrompt);
    setPrompt('');
  }

  async function refreshImageJob(jobToRefresh: GenerationJob) {
    if (isBusy || !subscription.hasAccess || refreshingJobId) {
      return;
    }

    setRefreshingJobId(jobToRefresh.id);

    try {
      await createImageJob(jobToRefresh.prompt);
    } finally {
      setRefreshingJobId(null);
    }
  }

  async function confirmDeleteImageJob() {
    if (!deleteDialog || deletingJobId) {
      return;
    }

    setDeleteError(null);
    setDeletingJobId(deleteDialog.jobId);

    try {
      await apiClient.deleteGenerationJob(deleteDialog.jobId);
      removeImageJob(deleteDialog.jobId);
      setDeleteDialog(null);
    } catch (caughtError) {
      setDeleteError(toDeleteErrorMessage(caughtError, t('deleteImageFailed')));
    } finally {
      setDeletingJobId(null);
    }
  }

  async function downloadGeneratedImage(jobId: string, image: GeneratedImage) {
    const currentActionKey = actionKey(jobId, image.index, 'download');
    if (assetAction?.status === 'loading') {
      return;
    }

    updateAssetAction({
      key: currentActionKey,
      status: 'loading',
      message: t('preparingDownload'),
    });

    try {
      const links = await apiClient.getGenerationJobImageLinks(jobId, image.index);
      const filename = links.download?.filename || links.filename || image.filename || `iishka-image-${image.index}.png`;
      const downloadUrl = links.download?.url || links.downloadUrl;
      const openUrl = links.open?.url || links.openUrl;

      if (shouldPreferImageViewer()) {
        openImageUrl(openUrl);
        updateAssetAction({
          key: currentActionKey,
          status: 'success',
          message: t('imageOpenedForSaving'),
        });
        return;
      }

      try {
        await downloadViaBlob(downloadUrl, filename);
        updateAssetAction({
          key: currentActionKey,
          status: 'success',
          message: t('imageDownloadStarted'),
        });
      } catch {
        openImageUrl(openUrl);
        updateAssetAction({
          key: currentActionKey,
          status: 'success',
          message: t('imageOpenedForSaving'),
        });
      }
    } catch (caughtError) {
      updateAssetAction({
        key: currentActionKey,
        status: 'error',
        message: caughtError instanceof Error ? caughtError.message : t('imageDownloadFailed'),
      });
    }
  }

  async function openGeneratedImage(jobId: string, image: GeneratedImage) {
    const currentActionKey = actionKey(jobId, image.index, 'open');
    if (assetAction?.status === 'loading') {
      return;
    }

    updateAssetAction({
      key: currentActionKey,
      status: 'loading',
      message: t('openingImage'),
    });

    const openedWindow = getTelegramWebApp()?.openLink ? null : window.open('', '_blank', 'noopener,noreferrer');

    try {
      const links = await apiClient.getGenerationJobImageLinks(jobId, image.index);
      openImageUrl(links.open?.url || links.openUrl, openedWindow);
      updateAssetAction({
        key: currentActionKey,
        status: 'success',
        message: t('imageOpened'),
      });
    } catch (caughtError) {
      openedWindow?.close();
      updateAssetAction({
        key: currentActionKey,
        status: 'error',
        message: caughtError instanceof Error ? caughtError.message : t('imageOpenFailed'),
      });
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
      {deleteDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
          <Card className="w-full max-w-sm border-border/70 bg-[linear-gradient(180deg,rgba(12,18,34,0.96),rgba(8,13,26,0.94))] px-4 py-4">
            <h3 className="font-display text-xl font-bold text-white">{t('confirmDeleteImageTitle')}</h3>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{t('confirmDeleteImageBody')}</p>
            <p className="mt-3 line-clamp-3 text-sm font-semibold text-white">{deleteDialog.prompt}</p>
            {deleteError && (
              <p className="mt-3 text-sm text-destructive">{deleteError}</p>
            )}
            <div className="mt-4 flex gap-2">
              <Button
                type="button"
                variant="ghost"
                className="flex-1"
                disabled={Boolean(deletingJobId)}
                onClick={() => {
                  setDeleteDialog(null);
                  setDeleteError(null);
                }}
              >
                {t('cancel')}
              </Button>
              <Button
                type="button"
                className="flex-1"
                disabled={Boolean(deletingJobId)}
                onClick={() => void confirmDeleteImageJob()}
              >
                {deletingJobId ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t('deletingImage')}
                  </>
                ) : (
                  <>
                    <Trash2 className="mr-2 h-4 w-4" />
                    {t('confirm')}
                  </>
                )}
              </Button>
            </div>
          </Card>
        </div>
      )}

      <div className="sticky top-0 z-20 -mx-1 rounded-b-[24px] bg-background/90 px-1 pb-2 pt-1 backdrop-blur-xl">
        <div className="flex items-center justify-between">
          <Button asChild variant="ghost" className="px-0 py-0.5 text-base text-white">
            <Link to="/">
              <ArrowLeft className="mr-1.5 h-4 w-4" />
              {t('back')}
            </Link>
          </Button>
          <Badge className="border-primary/30 bg-primary/10 text-primary">{t('imageStudio')}</Badge>
        </div>
        <Card className="mt-2 overflow-hidden border-primary/20 bg-[linear-gradient(135deg,rgba(16,24,42,0.96),rgba(9,15,30,0.9))] px-4 py-3">
          <div className="absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r from-[#f7ff5c] via-[#17f1a7] to-[#52f3ff]" />
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <ImageIcon className="h-4 w-4 text-primary" />
                <h1 className="font-display text-lg font-bold text-white">{provider.name}</h1>
              </div>
              <p className="mt-1 text-sm leading-5 text-muted-foreground">{provider.summary}</p>
            </div>
            <Badge className="shrink-0 rounded-[14px] border-primary/30 bg-primary/10 px-3 py-2 text-primary">
              {provider.defaultModel}
            </Badge>
          </div>
        </Card>
      </div>

      {!subscription.hasAccess && (
        <Card className="border-accent/20 bg-[linear-gradient(135deg,rgba(32,20,16,0.92),rgba(17,14,28,0.86))] px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2 font-semibold text-white">
                <ShieldAlert className="h-4 w-4 text-accent" />
                {t('subscriptionRequired')}
              </div>
              <p className="text-sm text-muted-foreground">
                {subscription.tokensRemaining === 0
                  ? t('subscriptionRequiredOutOfTokens')
                  : t('subscriptionRequiredInactive')}
              </p>
            </div>
            <Button
              type="button"
              variant="secondary"
              disabled={isActivatingSubscription || isUnsubscribingSubscription}
              onClick={onActivateDevSubscription}
            >
              {isActivatingSubscription ? t('activating') : t('getSubscription')}
            </Button>
          </div>
        </Card>
      )}

      <Card className="border-border/70 bg-[linear-gradient(180deg,rgba(12,18,34,0.92),rgba(8,13,26,0.88))] px-4 py-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-xl font-bold text-white">{t('createImage')}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t('imageStudioHint')}</p>
          </div>
          <Badge className="border-primary/30 bg-primary/10 text-primary">{t('imageCost')}</Badge>
        </div>

        <textarea
          value={prompt}
          disabled={isBusy}
          rows={4}
          placeholder={t('imagePromptPlaceholder')}
          className="mt-4 min-h-[112px] w-full resize-none rounded-[20px] border border-border/80 bg-background/80 px-4 py-3 text-base leading-6 text-foreground outline-none transition placeholder:text-muted-foreground focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-50"
          onChange={(event) => setPrompt(event.target.value)}
        />

        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <Button
            type="button"
            className="min-h-11 flex-1"
            disabled={!prompt.trim() || isBusy || !subscription.hasAccess}
            onClick={() => void submit()}
          >
            {isBusy ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t('generatingImage')}
              </>
            ) : (
              <>
                <Sparkles className="mr-2 h-4 w-4" />
                {t('generateImage')}
              </>
            )}
          </Button>
          {job && (
            <Button type="button" variant="ghost" className="min-h-11" disabled={isSubmitting} onClick={resetJob}>
              {t('newImage')}
            </Button>
          )}
        </div>
      </Card>

      {job && (
        <Card className="border-primary/20 bg-[linear-gradient(180deg,rgba(7,19,31,0.9),rgba(10,14,26,0.86))] px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{t('jobStatus')}</div>
              <div className="mt-1 font-display text-xl font-bold text-white">{t(`jobStatus${job.status}`)}</div>
            </div>
            <Badge
              className={cn(
                'border-primary/30 bg-primary/10 text-primary',
                job.status === 'FAILED' && 'border-destructive/30 bg-destructive/10 text-destructive',
              )}
            >
              {job.status}
            </Badge>
          </div>
          {job.failureMessage && (
            <p className="mt-3 text-sm text-destructive">{job.failureMessage}</p>
          )}
        </Card>
      )}

      {error && (
        <Card className="border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </Card>
      )}

      {isLoadingHistory && (
        <Card className="flex items-center gap-2 border-border/70 bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t('loading')}
        </Card>
      )}

      {imageHistory.length > 0 && (
        <section className="space-y-3 pb-4">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-xl font-bold text-white">{t('generatedImages')}</h2>
            <Badge className="border-border/60 bg-muted/70">{imageHistory.length}</Badge>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {imageHistory.map((item) => {
              return (
                <Card
                  key={item.job.id}
                  className="overflow-hidden border-primary/20 bg-background/70 p-0"
                >
                  {item.images.length > 0 ? (
                    <div className="grid gap-px bg-border/40">
                      {item.images.map((image) => {
                        const dataUrl = imageToDataUrl(image);
                        return (
                          <img
                            key={`${image.filename}-${image.index}`}
                            src={dataUrl}
                            alt={item.job.prompt || provider.name}
                            className="aspect-square w-full object-cover"
                          />
                        );
                      })}
                    </div>
                  ) : (
                    <div className="flex aspect-square flex-col items-center justify-center gap-4 bg-muted/35 px-4 text-center text-sm text-muted-foreground">
                      <div>
                        {item.job.status === 'FAILED'
                          ? item.job.failureMessage || t('imageGenerationFailed')
                          : t(`jobStatus${item.job.status}`)}
                      </div>
                      {canRefreshImageJob(item.job, item.images) && (
                        <div className="flex flex-col gap-2 sm:flex-row">
                          <Button
                            type="button"
                            variant="secondary"
                            className="min-h-11 min-w-[160px]"
                            disabled={isBusy || !subscription.hasAccess || Boolean(refreshingJobId) || Boolean(deletingJobId)}
                            onClick={() => void refreshImageJob(item.job)}
                          >
                            {refreshingJobId === item.job.id ? (
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                              <RefreshCw className="mr-2 h-4 w-4" />
                            )}
                            {refreshingJobId === item.job.id ? t('refreshingImage') : t('refreshImage')}
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            className="min-h-11 min-w-[160px]"
                            disabled={Boolean(refreshingJobId) || Boolean(deletingJobId)}
                            onClick={() => {
                              setDeleteError(null);
                              setDeleteDialog({ jobId: item.job.id, prompt: item.job.prompt });
                            }}
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            {t('deleteImage')}
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                  <div className="space-y-1 border-b border-border/60 px-3 py-2">
                    <div className="flex items-start justify-between gap-2">
                      <p className="line-clamp-3 text-sm font-semibold text-white">{item.job.prompt}</p>
                      <Badge
                        className={cn(
                          'shrink-0 border-primary/30 bg-primary/10 text-primary',
                          item.job.status === 'FAILED' && 'border-destructive/30 bg-destructive/10 text-destructive',
                        )}
                      >
                        {item.job.status}
                      </Badge>
                    </div>
                    {item.text && (
                      <p className="line-clamp-2 text-xs leading-5 text-muted-foreground">{item.text}</p>
                    )}
                  </div>
                  {item.images.map((image) => {
                    const actionPrefix = imageActionPrefix(item.job.id, image.index);
                    const activeAction = assetAction?.key.startsWith(actionPrefix) ? assetAction : null;
                    const isActionLoading = activeAction?.status === 'loading';
                    const isDownloadLoading = assetAction?.key === actionKey(item.job.id, image.index, 'download') && isActionLoading;
                    const isOpenLoading = assetAction?.key === actionKey(item.job.id, image.index, 'open') && isActionLoading;
                    return (
                      <div key={`${image.filename}-${image.index}-actions`} className="space-y-2 p-3">
                        <div className="flex flex-col gap-2 sm:flex-row">
                          <Button
                            type="button"
                            className="flex-1"
                            disabled={isActionLoading}
                            onClick={() => void downloadGeneratedImage(item.job.id, image)}
                          >
                            {isDownloadLoading ? (
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                              <Download className="mr-2 h-4 w-4" />
                            )}
                            {isDownloadLoading ? t('preparingDownload') : t('downloadImage')}
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            className="flex-1"
                            disabled={isActionLoading || Boolean(deletingJobId)}
                            onClick={() => void openGeneratedImage(item.job.id, image)}
                          >
                            {isOpenLoading ? (
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                              <ExternalLink className="mr-2 h-4 w-4" />
                            )}
                            {isOpenLoading ? t('openingImage') : t('openImage')}
                          </Button>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          className="w-full"
                          disabled={isActionLoading || Boolean(deletingJobId)}
                          onClick={() => {
                            setDeleteError(null);
                            setDeleteDialog({ jobId: item.job.id, prompt: item.job.prompt });
                          }}
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          {t('deleteImage')}
                        </Button>
                        {activeAction && (
                          <p
                            className={cn(
                              'text-xs leading-5',
                              activeAction.status === 'error' ? 'text-destructive' : 'text-muted-foreground',
                              activeAction.status === 'success' && 'text-primary',
                            )}
                          >
                            {activeAction.message}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </Card>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
