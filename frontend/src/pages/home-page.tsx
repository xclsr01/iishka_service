import { LockKeyhole, MessageSquareText } from 'lucide-react';
import { type Provider, type Subscription, type User } from '@/lib/api';
import { ProviderCard } from '@/components/provider/provider-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useLocale } from '@/lib/i18n';

export function HomePage({
  user,
  providers,
  subscription,
  onActivateDevSubscription,
  onUnsubscribeDevSubscription,
  isActivatingSubscription,
  isUnsubscribingSubscription,
}: {
  user: User;
  providers: Provider[];
  subscription: Subscription;
  onActivateDevSubscription: () => Promise<void>;
  onUnsubscribeDevSubscription: () => Promise<void>;
  isActivatingSubscription: boolean;
  isUnsubscribingSubscription: boolean;
}) {
  const { locale, setLocale, t } = useLocale();
  const tokenDisplay = subscription.tokensRemaining;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
      <div className="grid shrink-0 gap-2 xl:grid-cols-[minmax(0,1.45fr)_minmax(340px,0.95fr)] xl:items-stretch">
        <Card className="overflow-hidden border-primary/20 bg-[linear-gradient(135deg,rgba(12,18,35,0.96),rgba(15,25,48,0.88))] px-3 py-3 sm:px-4 sm:py-3">
          <div className="absolute inset-x-0 top-0 h-16 bg-[linear-gradient(90deg,rgba(87,225,255,0.18),transparent,rgba(255,191,71,0.14))]" />
          <div className="relative flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-2">
              <Badge className="border-primary/30 bg-primary/10 text-primary">
                {t('neuralAccess')}
              </Badge>
              <h1 className="font-display text-2xl font-bold leading-tight text-white sm:text-[1.7rem]">
                {t('heroTitle')}
              </h1>
              <p className="line-clamp-2 max-w-[32rem] text-sm leading-5 text-muted-foreground">
                {t('heroWelcome', { firstName: user.firstName })}
              </p>
            </div>
            <div className="flex flex-col items-end gap-2">
              <label className="sr-only" htmlFor="locale-select">
                Language
              </label>
              <select
                id="locale-select"
                value={locale}
                onChange={(event) =>
                  setLocale(event.target.value as 'ru' | 'en')
                }
                className="h-9 rounded-[14px] border border-primary/30 bg-[rgba(8,17,33,0.9)] px-3 text-xs font-semibold uppercase tracking-[0.12em] text-primary outline-none transition hover:border-primary/50"
              >
                <option value="ru">{t('languageRu')}</option>
                <option value="en">{t('languageEn')}</option>
              </select>
              <div className="hidden rounded-[18px] border border-primary/25 bg-primary/10 p-3 shadow-soft sm:block">
                <MessageSquareText className="h-5 w-5 text-primary" />
              </div>
            </div>
          </div>
        </Card>

        <Card
          className={
            subscription.hasAccess
              ? 'border-primary/25 bg-[linear-gradient(135deg,rgba(10,23,39,0.92),rgba(12,18,34,0.82))] px-4 py-3'
              : 'border-accent/20 bg-[linear-gradient(135deg,rgba(32,20,16,0.92),rgba(17,14,28,0.86))] px-4 py-3'
          }
        >
          <div className="grid gap-3">
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2">
              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-2 font-semibold text-white">
                  <LockKeyhole className="h-4 w-4 text-primary" />
                  {t('subscriptionStatus')}
                </div>
                <p className="line-clamp-2 text-sm leading-5 text-muted-foreground">
                  {subscription.hasAccess
                    ? t('subscriptionActive', {
                        planCode: subscription.planCode,
                      })
                    : subscription.tokensRemaining === 0
                      ? t('subscriptionOutOfTokens')
                      : t('subscriptionInactive')}
                </p>
              </div>
              <div className="justify-self-end">
                <div className="min-w-[76px] rounded-[14px] border border-primary/35 bg-primary px-3 py-2 text-left text-primary-foreground shadow-soft">
                  <div className="text-[9px] font-semibold uppercase tracking-[0.14em] text-primary-foreground/70">
                    {t('tokensLeft')}
                  </div>
                  <div className="mt-1 font-display text-lg font-bold leading-none">
                    {tokenDisplay}
                  </div>
                </div>
              </div>
            </div>
            <div className="flex flex-row flex-nowrap gap-2">
              {!subscription.hasAccess && (
                <Button
                  type="button"
                  variant="secondary"
                  className="h-10 min-w-0 flex-1 px-4"
                  disabled={
                    isActivatingSubscription || isUnsubscribingSubscription
                  }
                  onClick={onActivateDevSubscription}
                >
                  {isActivatingSubscription
                    ? t('activating')
                    : t('getSubscription')}
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                className="h-10 min-w-0 flex-1 border-destructive/25 bg-destructive/10 px-4 text-destructive hover:bg-destructive/15"
                disabled={
                  isActivatingSubscription || isUnsubscribingSubscription
                }
                onClick={onUnsubscribeDevSubscription}
              >
                {isUnsubscribingSubscription
                  ? t('unsubscribing')
                  : t('unsubscribe')}
              </Button>
            </div>
          </div>
        </Card>
      </div>

      <section className="flex min-h-0 flex-1 flex-col gap-2">
        <div className="flex shrink-0 items-center justify-between">
          <h2 className="font-display text-xl font-bold text-white">
            {t('aiCatalog')}
          </h2>
          <Badge className="hidden border-border/60 bg-muted/70 sm:inline-flex lg:hidden">
            {t('scroll')}
          </Badge>
        </div>
        <div className="-mx-4 min-h-0 flex-1 overflow-x-auto overflow-y-hidden px-4 lg:mx-0 lg:overflow-visible lg:px-0">
          <div className="flex h-full snap-x gap-3 lg:grid lg:grid-cols-2 lg:grid-rows-2 lg:gap-3 xl:grid-cols-3">
            {providers.map((provider) => (
              <ProviderCard key={provider.id} provider={provider} />
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
