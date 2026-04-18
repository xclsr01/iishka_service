import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Download, ExternalLink, ImageIcon, Loader2, ShieldAlert, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import { apiClient, type GeneratedImage, type ImageJobResultPayload, type Provider, type Subscription } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useImageJob } from '@/hooks/use-image-job';
import { useLocale } from '@/lib/i18n';
import { cn } from '@/lib/cn';

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
  const { job, isSubmitting, isPolling, error, createImageJob, resetJob } = useImageJob(provider.id);
  const syncedJobIdRef = useRef<string | null>(null);
  const isBusy = isSubmitting || isPolling;
  const result = useMemo(() => {
    return isImageJobResult(job?.resultPayload) ? job.resultPayload : null;
  }, [job?.resultPayload]);
  const images = result?.images ?? [];

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

  async function submit() {
    const normalizedPrompt = prompt.trim();
    if (!normalizedPrompt || isBusy || !subscription.hasAccess) {
      return;
    }

    await createImageJob(normalizedPrompt);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
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
            <Button type="button" variant="ghost" className="min-h-11" disabled={isBusy} onClick={resetJob}>
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

      {images.length > 0 && (
        <section className="space-y-3 pb-4">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-xl font-bold text-white">{t('generatedImages')}</h2>
            <Badge className="border-border/60 bg-muted/70">{images.length}</Badge>
          </div>
          {result?.text && (
            <Card className="border-border/70 bg-muted/50 px-4 py-3 text-sm leading-6 text-muted-foreground">
              {result.text}
            </Card>
          )}
          <div className="grid gap-3 md:grid-cols-2">
            {images.map((image) => {
              const dataUrl = imageToDataUrl(image);
              return (
                <Card key={`${image.filename}-${image.index}`} className="overflow-hidden border-primary/20 bg-background/70 p-0">
                  <img
                    src={dataUrl}
                    alt={prompt || provider.name}
                    className="aspect-square w-full object-cover"
                  />
                  <div className="flex flex-col gap-2 p-3 sm:flex-row">
                    <Button asChild className="flex-1">
                      <a href={dataUrl} download={image.filename}>
                        <Download className="mr-2 h-4 w-4" />
                        {t('downloadImage')}
                      </a>
                    </Button>
                    <Button asChild variant="ghost" className="flex-1">
                      <a href={dataUrl} target="_blank" rel="noreferrer">
                        <ExternalLink className="mr-2 h-4 w-4" />
                        {t('openImage')}
                      </a>
                    </Button>
                  </div>
                </Card>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
