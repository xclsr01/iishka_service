import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Download,
  ExternalLink,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Trash2,
} from 'lucide-react';
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
import { ChatComposer } from '@/components/chat/chat-composer';
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

type ImageHistoryImage = Partial<GeneratedImage> & {
  index: number;
};

function hasInlineImageData(image: ImageHistoryImage) {
  return (
    typeof image.dataBase64 === 'string' &&
    image.dataBase64.length > 0 &&
    typeof image.mimeType === 'string' &&
    image.mimeType.length > 0
  );
}

function isHistoryImage(value: unknown): value is ImageHistoryImage {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    typeof (value as { index?: unknown }).index === 'number'
  );
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
    window.open(url, '_blank', 'noopener,noreferrer') ??
      window.location.assign(url);
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
  images: ImageHistoryImage[];
  text: string | null;
};

type DeleteDialogState = {
  jobId: string;
  prompt: string;
};

function canRefreshImageJob(job: GenerationJob, images: ImageHistoryImage[]) {
  return (
    images.length === 0 &&
    ['FAILED', 'CANCELED', 'QUEUED'].includes(job.status)
  );
}

function GeneratedImagePreview({
  jobId,
  image,
  alt,
}: {
  jobId: string;
  image: ImageHistoryImage;
  alt: string;
}) {
  const { t } = useLocale();
  const [src, setSrc] = useState<string | null>(() =>
    hasInlineImageData(image) ? imageToDataUrl(image as GeneratedImage) : null,
  );
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    if (hasInlineImageData(image)) {
      setSrc(imageToDataUrl(image as GeneratedImage));
      setFailed(false);
      return;
    }

    setSrc(null);
    setFailed(false);
    apiClient
      .getGenerationJobImageLinks(jobId, image.index)
      .then((links) => {
        if (!cancelled) {
          setSrc(links.open?.url || links.openUrl);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFailed(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [image, jobId]);

  return (
    <div className="aspect-square w-full overflow-hidden rounded-[18px] border border-border/60 bg-background/60">
      {src ? (
        <img
          src={src}
          alt={alt}
          className="h-full w-full object-cover"
          onError={() => {
            setSrc(null);
            setFailed(true);
          }}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-center text-sm text-muted-foreground">
          {failed ? (
            t('imageUnavailable')
          ) : (
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          )}
        </div>
      )}
    </div>
  );
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
  const [assetAction, setAssetAction] = useState<AssetActionState | null>(null);
  const [refreshingJobId, setRefreshingJobId] = useState<string | null>(null);
  const [deleteDialog, setDeleteDialog] = useState<DeleteDialogState | null>(
    null,
  );
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deletingJobId, setDeletingJobId] = useState<string | null>(null);
  const {
    job,
    jobs,
    isLoadingHistory,
    isLoadingMore,
    isSubmitting,
    nextCursor,
    error,
    createImageJob,
    loadMoreHistory,
    removeImageJob,
  } = useImageJob(provider);
  const syncedJobIdRef = useRef<string | null>(null);
  const actionResetTimerRef = useRef<number | null>(null);
  const imageScrollRef = useRef<HTMLDivElement | null>(null);
  const previousImageScrollHeightRef = useRef<number | null>(null);
  const lastNewestImageJobIdRef = useRef<string | null>(null);
  const isBusy = isSubmitting;
  const imageHistory = useMemo<ImageHistoryItem[]>(() => {
    return jobs.map((historyJob) => {
      const payload = isImageJobResult(historyJob.resultPayload)
        ? historyJob.resultPayload
        : null;
      return {
        job: historyJob,
        images: (payload?.images ?? []).filter(isHistoryImage),
        text: payload?.text ?? null,
      };
    });
  }, [jobs]);
  const renderedImageHistory = useMemo(() => {
    return [...imageHistory].reverse();
  }, [imageHistory]);

  useEffect(() => {
    if (job?.status !== 'COMPLETED' || syncedJobIdRef.current === job.id) {
      return;
    }

    syncedJobIdRef.current = job.id;
    apiClient
      .getSubscription()
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

  useEffect(() => {
    const list = imageScrollRef.current;
    if (!list || !nextCursor || isLoadingHistory || isLoadingMore) {
      return;
    }

    if (list.scrollHeight <= list.clientHeight + 24) {
      previousImageScrollHeightRef.current = list.scrollHeight;
      void loadMoreHistory();
    }
  }, [imageHistory.length, isLoadingHistory, isLoadingMore, nextCursor]);

  useLayoutEffect(() => {
    const list = imageScrollRef.current;
    if (!list) {
      return;
    }

    const previousScrollHeight = previousImageScrollHeightRef.current;
    if (previousScrollHeight !== null) {
      list.scrollTop =
        list.scrollHeight - previousScrollHeight + list.scrollTop;
      previousImageScrollHeightRef.current = null;
      return;
    }

    const newestJobId = imageHistory[0]?.job.id ?? null;
    if (newestJobId && newestJobId !== lastNewestImageJobIdRef.current) {
      list.scrollTop = list.scrollHeight;
      lastNewestImageJobIdRef.current = newestJobId;
    }
  }, [imageHistory]);

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

  async function downloadGeneratedImage(jobId: string, image: ImageHistoryImage) {
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
      const links = await apiClient.getGenerationJobImageLinks(
        jobId,
        image.index,
      );
      const filename =
        links.download?.filename ||
        links.filename ||
        image.filename ||
        `iishka-image-${image.index}.png`;
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
        message:
          caughtError instanceof Error
            ? caughtError.message
            : t('imageDownloadFailed'),
      });
    }
  }

  async function openGeneratedImage(jobId: string, image: ImageHistoryImage) {
    const currentActionKey = actionKey(jobId, image.index, 'open');
    if (assetAction?.status === 'loading') {
      return;
    }

    updateAssetAction({
      key: currentActionKey,
      status: 'loading',
      message: t('openingImage'),
    });

    const openedWindow = getTelegramWebApp()?.openLink
      ? null
      : window.open('', '_blank', 'noopener,noreferrer');

    try {
      const links = await apiClient.getGenerationJobImageLinks(
        jobId,
        image.index,
      );
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
        message:
          caughtError instanceof Error
            ? caughtError.message
            : t('imageOpenFailed'),
      });
    }
  }

  function handleImageHistoryScroll() {
    const list = imageScrollRef.current;
    if (!list || !nextCursor || isLoadingMore) {
      return;
    }

    if (list.scrollTop < 80) {
      previousImageScrollHeightRef.current = list.scrollHeight;
      void loadMoreHistory();
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {deleteDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
          <Card className="w-full max-w-sm border-border/70 bg-[linear-gradient(180deg,rgba(12,18,34,0.96),rgba(8,13,26,0.94))] px-4 py-4">
            <h3 className="font-display text-xl font-bold text-white">
              {t('confirmDeleteImageTitle')}
            </h3>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {t('confirmDeleteImageBody')}
            </p>
            <p className="mt-3 line-clamp-3 text-sm font-semibold text-white">
              {deleteDialog.prompt}
            </p>
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
          <Button
            asChild
            variant="ghost"
            className="px-0 py-0.5 text-base text-white"
          >
            <Link to="/">
              <ArrowLeft className="mr-1.5 h-4 w-4" />
              {t('back')}
            </Link>
          </Button>
          <Badge className="border-primary/30 bg-primary/10 text-primary">
            {provider.name}
          </Badge>
        </div>
      </div>

      {!provider.isAvailable && provider.availabilityMessage && (
        <Card className="border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {provider.availabilityMessage}
        </Card>
      )}

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
              {isActivatingSubscription
                ? t('activating')
                : t('getSubscription')}
            </Button>
          </div>
        </Card>
      )}

      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden border-border/70 bg-[linear-gradient(180deg,rgba(9,13,26,0.9),rgba(12,18,34,0.82))] px-3 py-3">
        <div
          ref={imageScrollRef}
          className="flex flex-1 flex-col gap-3 overflow-y-auto pb-2 pt-1"
          onScroll={handleImageHistoryScroll}
        >
          {isLoadingHistory && (
            <div className="flex flex-1 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            </div>
          )}

          {!isLoadingHistory && imageHistory.length === 0 && !job && !error && (
            <div className="flex flex-1 items-center justify-center text-center text-sm text-muted-foreground">
              {t('startFirstConversation', { providerName: provider.name })}
            </div>
          )}

          {error && (
            <div className="flex justify-start">
              <div className="max-w-[86%] rounded-[22px] border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm leading-6 text-destructive shadow-soft">
                {error}
              </div>
            </div>
          )}

          {isLoadingMore && (
            <div className="flex justify-center py-2">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            </div>
          )}

          {renderedImageHistory.length > 0 &&
            renderedImageHistory.map((item) => {
              return (
                <div key={item.job.id} className="space-y-3">
                  <div className="flex justify-end">
                    <div className="max-w-[86%] rounded-[22px] border border-primary/35 bg-primary px-4 py-3 text-sm leading-6 text-primary-foreground shadow-soft">
                      <div className="whitespace-pre-wrap">
                        {item.job.prompt}
                      </div>
                    </div>
                  </div>

                  <div className="flex justify-start">
                    <div className="w-[86%] max-w-sm overflow-hidden rounded-[22px] border border-border/70 bg-muted/70 text-sm leading-6 text-foreground shadow-soft">
                      {item.images.length > 0 ? (
                        <div className="grid gap-2 p-3">
                          {item.images.map((image) => {
                            return (
                              <GeneratedImagePreview
                                key={`${image.filename ?? 'image'}-${image.index}`}
                                jobId={item.job.id}
                                image={image}
                                alt={item.job.prompt || provider.name}
                              />
                            );
                          })}
                        </div>
                      ) : (
                        <div className="flex aspect-square flex-col items-center justify-center gap-4 bg-muted/35 px-4 text-center text-sm text-muted-foreground">
                          <div>
                            {item.job.status === 'FAILED'
                              ? item.job.failureMessage ||
                                t('imageGenerationFailed')
                              : t(`jobStatus${item.job.status}`)}
                          </div>
                          {canRefreshImageJob(item.job, item.images) && (
                            <div className="flex flex-col gap-2 sm:flex-row">
                              <Button
                                type="button"
                                variant="secondary"
                                className="min-h-11 min-w-[160px]"
                                disabled={
                                  isBusy ||
                                  !subscription.hasAccess ||
                                  Boolean(refreshingJobId) ||
                                  Boolean(deletingJobId)
                                }
                                onClick={() => void refreshImageJob(item.job)}
                              >
                                {refreshingJobId === item.job.id ? (
                                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                ) : (
                                  <RefreshCw className="mr-2 h-4 w-4" />
                                )}
                                {refreshingJobId === item.job.id
                                  ? t('refreshingImage')
                                  : t('refreshImage')}
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                className="min-h-11 min-w-[160px]"
                                disabled={
                                  Boolean(refreshingJobId) ||
                                  Boolean(deletingJobId)
                                }
                                onClick={() => {
                                  setDeleteError(null);
                                  setDeleteDialog({
                                    jobId: item.job.id,
                                    prompt: item.job.prompt,
                                  });
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
                          <p className="line-clamp-3 text-sm font-semibold text-white">
                            {item.job.prompt}
                          </p>
                          <Badge
                            className={cn(
                              'shrink-0 border-primary/30 bg-primary/10 text-primary',
                              item.job.status === 'FAILED' &&
                                'border-destructive/30 bg-destructive/10 text-destructive',
                            )}
                          >
                            {item.job.status}
                          </Badge>
                        </div>
                        {item.text && (
                          <p className="line-clamp-2 text-xs leading-5 text-muted-foreground">
                            {item.text}
                          </p>
                        )}
                      </div>
                      {item.images.map((image) => {
                        const actionPrefix = imageActionPrefix(
                          item.job.id,
                          image.index,
                        );
                        const activeAction = assetAction?.key.startsWith(
                          actionPrefix,
                        )
                          ? assetAction
                          : null;
                        const isActionLoading =
                          activeAction?.status === 'loading';
                        const isDownloadLoading =
                          assetAction?.key ===
                            actionKey(item.job.id, image.index, 'download') &&
                          isActionLoading;
                        const isOpenLoading =
                          assetAction?.key ===
                            actionKey(item.job.id, image.index, 'open') &&
                          isActionLoading;
                        return (
                          <div
                            key={`${image.filename}-${image.index}-actions`}
                            className="space-y-2 p-3"
                          >
                            <div className="flex flex-col gap-2 sm:flex-row">
                              <Button
                                type="button"
                                className="flex-1"
                                disabled={isActionLoading}
                                onClick={() =>
                                  void downloadGeneratedImage(
                                    item.job.id,
                                    image,
                                  )
                                }
                              >
                                {isDownloadLoading ? (
                                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                ) : (
                                  <Download className="mr-2 h-4 w-4" />
                                )}
                                {isDownloadLoading
                                  ? t('preparingDownload')
                                  : t('downloadImage')}
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                className="flex-1"
                                disabled={
                                  isActionLoading || Boolean(deletingJobId)
                                }
                                onClick={() =>
                                  void openGeneratedImage(item.job.id, image)
                                }
                              >
                                {isOpenLoading ? (
                                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                ) : (
                                  <ExternalLink className="mr-2 h-4 w-4" />
                                )}
                                {isOpenLoading
                                  ? t('openingImage')
                                  : t('openImage')}
                              </Button>
                            </div>
                            <Button
                              type="button"
                              variant="ghost"
                              className="w-full"
                              disabled={
                                isActionLoading || Boolean(deletingJobId)
                              }
                              onClick={() => {
                                setDeleteError(null);
                                setDeleteDialog({
                                  jobId: item.job.id,
                                  prompt: item.job.prompt,
                                });
                              }}
                            >
                              <Trash2 className="mr-2 h-4 w-4" />
                              {t('deleteImage')}
                            </Button>
                            {activeAction && (
                              <p
                                className={cn(
                                  'text-xs leading-5',
                                  activeAction.status === 'error'
                                    ? 'text-destructive'
                                    : 'text-muted-foreground',
                                  activeAction.status === 'success' &&
                                    'text-primary',
                                )}
                              >
                                {activeAction.message}
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })}
        </div>
      </Card>

      <div className="sticky bottom-0 z-20 -mx-1 bg-background/90 px-1 pb-[max(env(safe-area-inset-bottom),0.25rem)] pt-2 backdrop-blur-xl">
        <ChatComposer
          pendingFiles={[]}
          onUpload={() => undefined}
          onRemoveFile={() => undefined}
          onSend={async (content) => {
            const normalizedPrompt = content.trim();
            if (!normalizedPrompt || isBusy || !subscription.hasAccess) {
              return;
            }

            await createImageJob(normalizedPrompt);
          }}
          disabled={
            !provider.isAvailable ||
            !subscription.hasAccess ||
            isActivatingSubscription ||
            isUnsubscribingSubscription
          }
          busy={isBusy}
        />
      </div>
    </div>
  );
}
