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
};

export function ProviderCard({ provider }: { provider: Provider }) {
  const { t } = useLocale();
  const isAsyncImageProvider = provider.capabilities?.supportsImage && provider.executionMode === 'async-job';

  return (
    <Card className="min-w-[82vw] max-w-[82vw] snap-start overflow-hidden border-border/70 bg-[linear-gradient(180deg,rgba(15,20,38,0.92),rgba(9,13,27,0.86))] p-0 sm:min-w-[280px] sm:max-w-[280px] lg:min-w-0 lg:max-w-none lg:h-full">
      <div className={`h-1.5 bg-gradient-to-r ${toneByKey[provider.key]}`} />
      <div className="flex h-full flex-col gap-3 p-4 sm:gap-3 sm:p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-display text-xl font-bold sm:text-[1.55rem]">{provider.name}</h3>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">{provider.summary}</p>
          </div>
          <div className="space-y-2 text-right">
            <Badge className="rounded-[14px] border-primary/30 bg-primary/10 px-3 py-2 text-primary">
              {provider.defaultModel}
            </Badge>
            {!provider.isAvailable && (
              <Badge className="border-destructive/30 bg-destructive/10 text-destructive">{t('unavailable')}</Badge>
            )}
          </div>
        </div>

        <div className="rounded-[18px] border border-border/60 bg-muted/55 p-3 text-sm leading-6 text-muted-foreground">
          <p>{provider.description}</p>
          {!provider.isAvailable && provider.availabilityMessage && (
            <p className="mt-3 text-destructive">{provider.availabilityMessage}</p>
          )}
        </div>

        <div className="mt-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
            <Sparkles className="h-4 w-4" />
            {isAsyncImageProvider ? t('imageJobsEnabled') : t('fileUploadsEnabled')}
          </div>
          {provider.isAvailable && !isAsyncImageProvider ? (
            <Button asChild>
              <Link to={`/providers/${provider.id}`}>{t('enterChat')}</Link>
            </Button>
          ) : provider.isAvailable ? (
            <Button type="button" disabled>
              {t('imageJobSoon')}
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
