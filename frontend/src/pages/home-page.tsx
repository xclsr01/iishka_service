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
  isActivatingSubscription,
}: {
  user: User;
  providers: Provider[];
  subscription: Subscription;
  onActivateDevSubscription: () => Promise<void>;
  isActivatingSubscription: boolean;
}) {
  return (
    <>
      <Card className="overflow-hidden bg-[linear-gradient(135deg,rgba(255,255,255,0.96),rgba(244,226,194,0.8))] px-4 py-4 sm:px-5 sm:py-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-2">
            <Badge className="bg-accent/15 text-foreground">Telegram Mini App MVP</Badge>
            <h1 className="font-display text-2xl font-bold leading-tight sm:text-3xl">
              One subscription, three AI providers.
            </h1>
            <p className="max-w-[32rem] text-sm leading-5 text-muted-foreground">
              Welcome{user.firstName ? `, ${user.firstName}` : ''}. Choose a provider and keep your
              history synced across sessions.
            </p>
          </div>
          <div className="rounded-full bg-white/75 p-2.5">
            <MessageSquareText className="h-5 w-5 text-primary sm:h-6 sm:w-6" />
          </div>
        </div>
      </Card>

      <Card
        className={
          subscription.hasAccess
            ? 'border-secondary/20 bg-[linear-gradient(135deg,rgba(223,239,230,0.84),rgba(255,255,255,0.86))] px-4 py-3'
            : 'border-destructive/20 bg-[linear-gradient(135deg,rgba(255,234,233,0.84),rgba(255,255,255,0.86))] px-4 py-3'
        }
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2 font-semibold">
              <LockKeyhole className="h-4 w-4" />
              Subscription status
            </div>
            <p className="text-sm text-muted-foreground">
              {subscription.hasAccess
                ? `Active on ${subscription.planCode}.`
                : subscription.tokensRemaining === 0
                  ? 'Out of tokens. Update your subscription to continue messaging.'
                  : 'Inactive. Messaging is gated until the monthly plan is active.'}
            </p>
          </div>
          <div className="flex flex-col items-start gap-3 sm:items-end">
            <div className="rounded-2xl bg-white/80 px-3 py-2 text-left shadow-soft sm:text-right">
              <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                Tokens
              </div>
              <div className="font-display text-xl font-bold leading-none">
                {subscription.tokensRemaining}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {subscription.tokensUsed}/{subscription.tokensAllowed} used
              </div>
            </div>
            {!subscription.hasAccess && (
              <Button
                type="button"
                variant="secondary"
                className="w-full sm:w-auto"
                disabled={isActivatingSubscription}
                onClick={onActivateDevSubscription}
              >
                {isActivatingSubscription ? 'Activating...' : 'Get subscription'}
              </Button>
            )}
          </div>
        </div>
      </Card>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-xl font-bold">AI catalog</h2>
          <Badge className="hidden sm:inline-flex">Scroll horizontally</Badge>
        </div>
        <div className="-mx-4 overflow-x-auto px-4 pb-2">
          <div className="flex snap-x gap-4">
            {providers.map((provider) => (
              <ProviderCard key={provider.id} provider={provider} />
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
