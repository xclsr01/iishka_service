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
}: {
  user: User;
  providers: Provider[];
  subscription: Subscription;
  onActivateDevSubscription: () => Promise<void>;
}) {
  return (
    <>
      <Card className="overflow-hidden bg-[linear-gradient(135deg,rgba(255,255,255,0.96),rgba(244,226,194,0.8))]">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <Badge className="bg-accent/15 text-foreground">Telegram Mini App MVP</Badge>
            <h1 className="font-display text-3xl font-bold leading-tight">
              One subscription, three AI providers.
            </h1>
            <p className="text-sm text-muted-foreground">
              Welcome{user.firstName ? `, ${user.firstName}` : ''}. Choose a provider and keep your
              history synced across sessions.
            </p>
          </div>
          <div className="rounded-full bg-white/75 p-3">
            <MessageSquareText className="h-6 w-6 text-primary" />
          </div>
        </div>
      </Card>

      <Card
        className={
          subscription.hasAccess
            ? 'border-secondary/20 bg-[linear-gradient(135deg,rgba(223,239,230,0.84),rgba(255,255,255,0.86))]'
            : 'border-destructive/20 bg-[linear-gradient(135deg,rgba(255,234,233,0.84),rgba(255,255,255,0.86))]'
        }
      >
        <div className="flex items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2 font-semibold">
              <LockKeyhole className="h-4 w-4" />
              Subscription status
            </div>
            <p className="text-sm text-muted-foreground">
              {subscription.hasAccess
                ? `Active on ${subscription.planCode}.`
                : 'Inactive. Messaging is gated until the monthly plan is active.'}
            </p>
          </div>
          {!subscription.hasAccess && (
            <Button type="button" variant="secondary" onClick={onActivateDevSubscription}>
              Activate demo
            </Button>
          )}
        </div>
      </Card>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-xl font-bold">AI catalog</h2>
          <Badge>Scroll horizontally</Badge>
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
