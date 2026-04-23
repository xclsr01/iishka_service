import { useState } from 'react';
import { ArrowLeft, ShieldAlert } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { Provider, Subscription } from '@/lib/api';
import { ChatComposer } from '@/components/chat/chat-composer';
import { ChatMessageList } from '@/components/chat/chat-message-list';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { useProviderChat } from '@/hooks/use-provider-chat';
import { useLocale } from '@/lib/i18n';

export function ChatPage({
  provider,
  subscription,
  onActivateDevSubscription,
  onUnsubscribeDevSubscription,
  isActivatingSubscription,
  isUnsubscribingSubscription,
  onSubscriptionChange,
}: {
  provider: Provider;
  subscription: Subscription;
  onActivateDevSubscription: () => Promise<void>;
  onUnsubscribeDevSubscription: () => Promise<void>;
  isActivatingSubscription: boolean;
  isUnsubscribingSubscription: boolean;
  onSubscriptionChange: (subscription: Subscription) => void;
}) {
  const { t } = useLocale();
  const { chat, messagesLoading, error, pendingFiles, uploadFiles, sendMessage, removePendingFile } =
    useProviderChat(provider, subscription, onSubscriptionChange);
  const [busy, setBusy] = useState(false);
  const [scrollToBottomSignal, setScrollToBottomSignal] = useState(0);
  const messages = chat?.messages ?? [];

  async function handleSend(content: string) {
    try {
      setBusy(true);
      setScrollToBottomSignal(Date.now());
      const updatedSubscription = await sendMessage(content);
      onSubscriptionChange(updatedSubscription);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="sticky top-0 z-20 -mx-1 rounded-b-[24px] bg-background/90 px-1 pb-2 pt-1 backdrop-blur-xl">
        <div className="flex items-center justify-between">
          <Button asChild variant="ghost" className="px-0 py-0.5 text-base text-white">
            <Link to="/">
              <ArrowLeft className="mr-1.5 h-4 w-4" />
              {t('back')}
            </Link>
          </Button>
          <Badge className="border-primary/30 bg-primary/10 text-primary">{provider.name}</Badge>
        </div>
        <Card className="mt-2 space-y-1 border-primary/15 bg-[linear-gradient(135deg,rgba(13,19,37,0.94),rgba(11,16,30,0.84))] px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="font-display text-lg font-bold text-white">{provider.name}</h1>
              <p className="text-sm text-muted-foreground">{provider.summary}</p>
              {!provider.isAvailable && provider.availabilityMessage && (
                <p className="mt-1.5 text-sm text-destructive">{provider.availabilityMessage}</p>
              )}
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

      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden border-border/70 bg-[linear-gradient(180deg,rgba(9,13,26,0.9),rgba(12,18,34,0.82))] px-3 py-3">
        {messagesLoading ? (
          <div className="flex flex-1 items-center justify-center">
            <Spinner />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-1 items-center justify-center text-center text-sm text-muted-foreground">
            {t('startFirstConversation', { providerName: provider.name })}
          </div>
        ) : (
          <ChatMessageList messages={messages} scrollToBottomSignal={scrollToBottomSignal} />
        )}
      </Card>

      {error && (
        <Card className="border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </Card>
      )}

      <div className="sticky bottom-0 z-20 -mx-1 bg-background/90 px-1 pb-[max(env(safe-area-inset-bottom),0.25rem)] pt-2 backdrop-blur-xl">
        <ChatComposer
          pendingFiles={pendingFiles}
          onUpload={uploadFiles}
          onRemoveFile={removePendingFile}
          onSend={handleSend}
          disabled={
            !provider.isAvailable ||
            !subscription.hasAccess ||
            isActivatingSubscription ||
            isUnsubscribingSubscription
          }
          busy={busy}
        />
      </div>
    </div>
  );
}
