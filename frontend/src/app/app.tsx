import { useEffect, useState } from 'react';
import { Navigate, Route, Routes, useParams } from 'react-router-dom';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { apiClient, type Provider, type Subscription } from '@/lib/api';
import { bootstrapErrors, useBootstrap } from '@/hooks/use-bootstrap';
import { ChatPage } from '@/pages/chat-page';
import { HomePage } from '@/pages/home-page';

function ProviderRoute({
  providers,
  subscription,
  onActivateDevSubscription,
  isActivatingSubscription,
}: {
  providers: Provider[];
  subscription: Subscription;
  onActivateDevSubscription: () => Promise<void>;
  isActivatingSubscription: boolean;
}) {
  const params = useParams();
  const provider = providers.find((candidate) => candidate.id === params.providerId);

  if (!provider) {
    return <Navigate to="/" replace />;
  }

  return (
    <ChatPage
      provider={provider}
      subscription={subscription}
      onActivateDevSubscription={onActivateDevSubscription}
      isActivatingSubscription={isActivatingSubscription}
    />
  );
}

export function App() {
  const { data, isLoading, error } = useBootstrap();
  const [subscriptionOverride, setSubscriptionOverride] = useState(data?.subscription ?? null);
  const [isActivatingSubscription, setIsActivatingSubscription] = useState(false);

  useEffect(() => {
    if (data?.subscription) {
      setSubscriptionOverride((current) => current ?? data.subscription);
    }
  }, [data?.subscription]);

  async function activateDevSubscription() {
    try {
      setIsActivatingSubscription(true);
      const response = await apiClient.activateDevSubscription();
      setSubscriptionOverride(response.subscription);
    } finally {
      setIsActivatingSubscription(false);
    }
  }

  if (isLoading) {
    return (
      <AppShell className="items-center justify-center">
        <Spinner />
      </AppShell>
    );
  }

  if (!data) {
    const isStandaloneBrowser = error === bootstrapErrors.standaloneBrowser;

    return (
      <AppShell className="items-center justify-center">
        <Card className="max-w-sm space-y-4 text-center">
          <h1 className="font-display text-2xl font-bold">
            {isStandaloneBrowser ? 'Open In Telegram' : 'Bootstrap failed'}
          </h1>
          <p className="text-sm text-muted-foreground">
            {isStandaloneBrowser
              ? 'The deployment is up, but authentication for this Mini App comes from Telegram. Open the bot, send /start, and launch the app from the button there.'
              : error}
          </p>
          {isStandaloneBrowser && (
            <div className="space-y-2">
              <Button
                type="button"
                className="w-full"
                onClick={() => window.location.reload()}
              >
                Retry In Telegram
              </Button>
              <p className="text-xs text-muted-foreground">
                Opening the raw `pages.dev` URL in a normal browser is fine for a smoke check, but
                a signed Telegram session is required to enter the app.
              </p>
            </div>
          )}
        </Card>
      </AppShell>
    );
  }

  const subscription = subscriptionOverride ?? data.subscription;

  return (
    <AppShell>
      <Routes>
        <Route
          path="/"
          element={
            <HomePage
              user={data.user}
              providers={data.providers}
              subscription={subscription}
              onActivateDevSubscription={activateDevSubscription}
              isActivatingSubscription={isActivatingSubscription}
            />
          }
        />
        <Route
          path="/providers/:providerId"
          element={
            <ProviderRoute
              providers={data.providers}
              subscription={subscription}
              onActivateDevSubscription={activateDevSubscription}
              isActivatingSubscription={isActivatingSubscription}
            />
          }
        />
      </Routes>
    </AppShell>
  );
}
