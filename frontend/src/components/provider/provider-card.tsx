import { Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { Provider } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useLocale } from '@/lib/i18n';

const toneByKey: Record<Provider['key'], string> = {
  OPENAI: 'from-[#52f3ff] via-[#228bff] to-[#6f7dff]',
  ANTHROPIC: 'from-[#9b7dff] via-[#7e4fff] to-[#5ae0c8]',
  GEMINI: 'from-[#ffd15c] via-[#ff8f40] to-[#ff4fd8]',
  NANO_BANANA: 'from-[#f7ff5c] via-[#17f1a7] to-[#52f3ff]',
  VEO: 'from-[#9ef7ff] via-[#1dc9ff] to-[#7cf27b]',
};

export function ProviderCard({ provider }: { provider: Provider }) {
  const { t } = useLocale();
  const isAsyncImageProvider =
    provider.capabilities?.supportsImage &&
    provider.executionMode === 'async-job';
  const isAsyncVideoProvider =
    provider.executionMode === 'async-job' &&
    provider.capabilities?.supportsAsyncJobs &&
    !provider.capabilities?.supportsImage;

  return (
    <Card className="h-full min-w-[82vw] max-w-[82vw] snap-start overflow-hidden border-border/70 bg-[linear-gradient(180deg,rgba(15,20,38,0.92),rgba(9,13,27,0.86))] p-0 sm:min-w-[280px] sm:max-w-[280px] lg:min-w-0 lg:max-w-none">
      <div className={`h-1.5 bg-gradient-to-r ${toneByKey[provider.key]}`} />
      <div className="flex h-[calc(100%-0.375rem)] min-h-0 flex-col gap-2 p-3 sm:p-4">
        <div className="flex min-h-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-display text-lg font-bold leading-tight sm:text-xl">
              {provider.name}
            </h3>
            <p className="mt-1 line-clamp-2 text-sm leading-5 text-muted-foreground">
              {provider.summary}
            </p>
          </div>
          <div className="min-w-0 space-y-2 text-right">
            <Badge className="max-w-28 rounded-[14px] border-primary/30 bg-primary/10 px-2 py-1.5 text-primary sm:max-w-36">
              <span className="block overflow-hidden text-ellipsis whitespace-nowrap">
                {provider.defaultModel}
              </span>
            </Badge>
            {!provider.isAvailable && (
              <Badge className="border-destructive/30 bg-destructive/10 text-destructive">
                {t('unavailable')}
              </Badge>
            )}
          </div>
        </div>

        <div className="min-h-0 rounded-[18px] border border-border/60 bg-muted/55 p-3 text-sm leading-5 text-muted-foreground">
          <p className="line-clamp-3 lg:line-clamp-2 xl:line-clamp-3">
            {provider.description}
          </p>
          {!provider.isAvailable && provider.availabilityMessage && (
            <p className="mt-2 line-clamp-2 text-destructive">
              {provider.availabilityMessage}
            </p>
          )}
        </div>

        <div className="mt-auto flex shrink-0 items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
            <Sparkles className="h-4 w-4" />
            <span className="truncate">
              {isAsyncImageProvider
                ? t('imageJobsEnabled')
                : isAsyncVideoProvider
                  ? t('videoJobsEnabled')
                  : t('fileUploadsEnabled')}
            </span>
          </div>
          {provider.isAvailable && !isAsyncImageProvider ? (
            <Button asChild>
              <Link to={`/providers/${provider.id}`}>{t('enterChat')}</Link>
            </Button>
          ) : provider.isAvailable ? (
            <Button asChild>
              <Link to={`/providers/${provider.id}`}>{t('openStudio')}</Link>
            </Button>
          ) : (
            <Button type="button" disabled>
              {t('unavailable')}
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}
