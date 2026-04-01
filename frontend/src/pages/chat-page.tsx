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

export function ChatPage({
  provider,
  subscription,
  onActivateDevSubscription,
  isActivatingSubscription,
}: {
  provider: Provider;
  subscription: Subscription;
  onActivateDevSubscription: () => Promise<void>;
  isActivatingSubscription: boolean;
}) {
  const { chat, messagesLoading, error, pendingFiles, uploadFiles, sendMessage, removePendingFile } =
    useProviderChat(provider, subscription);
  const [busy, setBusy] = useState(false);
  const messages = chat?.messages ?? [];

  async function handleSend(content: string) {
    try {
      setBusy(true);
      await sendMessage(content);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="flex items-center justify-between">
        <Button asChild variant="ghost" className="px-0 py-1">
          <Link to="/">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Link>
        </Button>
        <Badge>{provider.name}</Badge>
      </div>

      <Card className="space-y-1.5 px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-xl font-bold">{provider.name}</h1>
            <p className="text-sm text-muted-foreground">{provider.summary}</p>
            {!provider.isAvailable && provider.availabilityMessage && (
              <p className="mt-2 text-sm text-destructive">{provider.availabilityMessage}</p>
            )}
          </div>
          <Badge className="bg-white/70 text-foreground">{provider.defaultModel}</Badge>
        </div>
      </Card>

      {!subscription.hasAccess && (
        <Card className="border-destructive/20 bg-[linear-gradient(135deg,rgba(255,234,233,0.84),rgba(255,255,255,0.86))]">
          <div className="flex items-center justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2 font-semibold">
                <ShieldAlert className="h-4 w-4" />
                Subscription required
              </div>
              <p className="text-sm text-muted-foreground">
                Uploads can still be prepared, but message sending is blocked until the plan is active.
              </p>
            </div>
            <Button
              type="button"
              variant="secondary"
              disabled={isActivatingSubscription}
              onClick={onActivateDevSubscription}
            >
              {isActivatingSubscription ? 'Activating...' : 'Activate demo'}
            </Button>
          </div>
        </Card>
      )}

      <Card className="flex min-h-[68vh] flex-[0_0_68vh] flex-col overflow-hidden px-4 py-4">
        {messagesLoading ? (
          <div className="flex flex-1 items-center justify-center">
            <Spinner />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-1 items-center justify-center text-center text-sm text-muted-foreground">
            Start the first conversation with {provider.name}.
          </div>
        ) : (
          <ChatMessageList messages={messages} />
        )}
      </Card>

      {error && (
        <Card className="border-destructive/20 bg-destructive/5 py-3 text-sm text-destructive">
          {error}
        </Card>
      )}

      <ChatComposer
        pendingFiles={pendingFiles}
        onUpload={uploadFiles}
        onRemoveFile={removePendingFile}
        onSend={handleSend}
        disabled={!provider.isAvailable || !subscription.hasAccess || isActivatingSubscription}
        busy={busy}
      />
    </>
  );
}
