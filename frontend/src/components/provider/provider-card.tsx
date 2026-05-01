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
    <Card className="flex h-auto min-h-[300px] min-w-full max-w-full snap-start flex-col overflow-hidden border-border/70 bg-[linear-gradient(180deg,rgba(15,20,38,0.92),rgba(9,13,27,0.86))] p-0 md:min-h-[320px] lg:min-h-[360px] lg:min-w-0 lg:max-w-none xl:min-h-[380px]">
      <div className={`h-1.5 bg-gradient-to-r ${toneByKey[provider.key]}`} />
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-4 pb-5">
        <div className="grid min-h-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
          <div className="min-w-0">
            <h3 className="font-display text-lg font-bold leading-tight sm:text-xl">
              {provider.name}
            </h3>
          </div>
          <div className="flex min-w-0 flex-col items-end gap-2 pb-1">
            <Badge className="max-w-[10rem] rounded-[14px] border-primary/30 bg-primary/10 px-2 py-1.5 text-[11px] leading-4 text-primary sm:max-w-[12rem]">
              <span className="block truncate">{provider.defaultModel}</span>
            </Badge>
            {!provider.isAvailable && (
              <Badge className="border-destructive/30 bg-destructive/10 text-destructive">
                {t('unavailable')}
              </Badge>
            )}
          </div>
        </div>

        <div className="min-h-[78px] overflow-hidden rounded-[16px] border border-border/60 bg-muted/55 p-3 text-sm leading-5 text-muted-foreground">
          <p className="line-clamp-3 md:line-clamp-4">
            {provider.description}
          </p>
          {!provider.isAvailable && provider.availabilityMessage && (
            <p className="mt-2 line-clamp-2 text-destructive">
              {provider.availabilityMessage}
            </p>
          )}
        </div>

        <div className="mt-auto grid shrink-0 gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
          <div className="flex min-w-0 items-start gap-2 text-[11px] uppercase leading-5 tracking-[0.12em] text-muted-foreground">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="min-w-0 break-words line-clamp-2">
              {isAsyncImageProvider
                ? t('imageJobsEnabled')
                : isAsyncVideoProvider
                  ? t('videoJobsEnabled')
                  : t('fileUploadsEnabled')}
            </span>
          </div>
          {provider.isAvailable && !isAsyncImageProvider ? (
            <Button asChild className="min-h-11 px-6 sm:min-w-[136px]">
              <Link to={`/providers/${provider.id}`}>{t('enterChat')}</Link>
            </Button>
          ) : provider.isAvailable ? (
            <Button asChild className="min-h-11 px-6 sm:min-w-[136px]">
              <Link to={`/providers/${provider.id}`}>{t('openStudio')}</Link>
            </Button>
          ) : (
            <Button
              type="button"
              className="min-h-11 px-6 sm:min-w-[136px]"
              disabled
            >
              {t('unavailable')}
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}
