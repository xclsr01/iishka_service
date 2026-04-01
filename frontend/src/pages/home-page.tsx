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
  const tokenDisplay =
    typeof (subscription as Subscription & { tokensRemaining?: number }).tokensRemaining === 'number'
      ? (subscription as Subscription & { tokensRemaining: number }).tokensRemaining
      : null;

  return (
    <>
      <Card className="overflow-hidden border-primary/20 bg-[linear-gradient(135deg,rgba(12,18,35,0.96),rgba(15,25,48,0.88))] px-4 py-4 sm:px-5 sm:py-5">
        <div className="absolute inset-x-0 top-0 h-24 bg-[linear-gradient(90deg,rgba(87,225,255,0.18),transparent,rgba(255,191,71,0.14))]" />
        <div className="relative flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-2">
            <Badge className="border-primary/30 bg-primary/10 text-primary">Neural Access</Badge>
            <h1 className="font-display text-2xl font-bold leading-tight text-white sm:text-3xl">
              One subscription, three AI channels.
            </h1>
            <p className="max-w-[32rem] text-sm leading-5 text-muted-foreground">
              Welcome{user.firstName ? `, ${user.firstName}` : ''}. Pick your model, keep sessions
              synced, and move between assistants without losing context.
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
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2 font-semibold text-white">
              <LockKeyhole className="h-4 w-4 text-primary" />
              Subscription status
            </div>
            <p className="text-sm text-muted-foreground">
              {subscription.hasAccess
                ? `Active on ${subscription.planCode}.`
                : 'Inactive. Messaging is gated until the monthly plan is active.'}
            </p>
          </div>
          <div className="flex items-center gap-3 self-stretch sm:self-auto">
            <div className="min-w-[94px] rounded-[18px] border border-border/70 bg-muted/70 px-3 py-2">
              <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                Tokens
              </div>
              <div className="mt-1 font-display text-xl font-bold leading-none text-white">
                {tokenDisplay ?? '...'}
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
          <h2 className="font-display text-xl font-bold text-white">AI catalog</h2>
          <Badge className="hidden border-border/60 bg-muted/70 sm:inline-flex">Scroll</Badge>
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
