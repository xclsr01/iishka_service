import { LockKeyhole, MessageSquareText } from 'lucide-react';
import { type Provider, type Subscription, type User } from '@/lib/api';
import { ProviderCard } from '@/components/provider/provider-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

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
  const tokenDisplay = subscription.tokensRemaining;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-x-hidden overflow-y-auto pr-1">
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.45fr)_minmax(340px,0.95fr)] xl:items-start">
        <Card className="overflow-hidden border-primary/20 bg-[linear-gradient(135deg,rgba(12,18,35,0.96),rgba(15,25,48,0.88))] px-4 py-4 sm:px-5 sm:py-4">
          <div className="absolute inset-x-0 top-0 h-24 bg-[linear-gradient(90deg,rgba(87,225,255,0.18),transparent,rgba(255,191,71,0.14))]" />
          <div className="relative flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-2">
              <Badge className="border-primary/30 bg-primary/10 text-primary">Neural Access</Badge>
              <h1 className="font-display text-[1.85rem] font-bold leading-tight text-white sm:text-3xl">
                One subscription, three AI channels.
              </h1>
              <p className="max-w-[32rem] text-sm leading-5 text-muted-foreground">
                Welcome{user.firstName ? `, ${user.firstName}` : ''}. Pick your model, keep
                sessions synced, and move between assistants without losing context.
              </p>
            </div>
            <div className="rounded-[18px] border border-primary/25 bg-primary/10 p-3 shadow-soft">
              <MessageSquareText className="h-5 w-5 text-primary sm:h-6 sm:w-6" />
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
                Subscription status
                </div>
                <p className="text-sm leading-5 text-muted-foreground">
                  {subscription.hasAccess
                    ? `Active on ${subscription.planCode}.`
                    : subscription.tokensRemaining === 0
                      ? 'Out of tokens. Update your subscription to continue messaging.'
                      : 'Inactive. Messaging is gated until the monthly plan is active.'}
                </p>
              </div>
              <div className="justify-self-end">
                <div className="min-w-[76px] rounded-[14px] border border-primary/35 bg-primary px-3 py-2 text-left text-primary-foreground shadow-soft">
                  <div className="text-[9px] font-semibold uppercase tracking-[0.14em] text-primary-foreground/70">
                    Left
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
                  disabled={isActivatingSubscription || isUnsubscribingSubscription}
                  onClick={onActivateDevSubscription}
                >
                  {isActivatingSubscription ? 'Activating...' : 'Get subscription'}
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                className="h-10 min-w-0 flex-1 border-destructive/25 bg-destructive/10 px-4 text-destructive hover:bg-destructive/15"
                disabled={isActivatingSubscription || isUnsubscribingSubscription}
                onClick={onUnsubscribeDevSubscription}
              >
                {isUnsubscribingSubscription ? 'Unsubscribing...' : 'Unsubscribe'}
              </Button>
            </div>
          </div>
        </Card>
      </div>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-xl font-bold text-white">AI catalog</h2>
          <Badge className="hidden border-border/60 bg-muted/70 sm:inline-flex lg:hidden">Scroll</Badge>
        </div>
        <div className="-mx-4 overflow-x-auto px-4 pb-4 lg:mx-0 lg:overflow-visible lg:px-0">
          <div className="flex snap-x gap-4 lg:grid lg:grid-cols-2 lg:gap-4 xl:grid-cols-3">
            {providers.map((provider) => (
              <ProviderCard key={provider.id} provider={provider} />
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
