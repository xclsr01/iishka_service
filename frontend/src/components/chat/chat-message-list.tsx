import { useEffect, useRef } from 'react';
import type { ChatMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { AssistantMessageContent } from './assistant-message-content';
import { VideoMessageCard } from './video-message-card';

function shouldRenderVideoCard(message: ChatMessage) {
  if (message.role !== 'ASSISTANT') {
    return false;
  }

  if (message.attachments?.some((attachment) => attachment.file.mimeType.startsWith('video/'))) {
    return true;
  }

  const providerMeta = message.providerMeta;
  return Boolean(
    providerMeta &&
    typeof providerMeta === 'object' &&
    !Array.isArray(providerMeta) &&
    ('mediaKind' in providerMeta ? providerMeta.mediaKind === 'video' : false),
  );
}

export function ChatMessageList({
  messages,
  scrollToBottomSignal,
  onRetryAsyncMessage,
  onDeleteAsyncMessage,
}: {
  messages: ChatMessage[];
  scrollToBottomSignal?: number;
  onRetryAsyncMessage?: (messageId: string) => Promise<void>;
  onDeleteAsyncMessage?: (messageId: string) => Promise<void>;
}) {
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!scrollToBottomSignal) {
      return;
    }

    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [scrollToBottomSignal]);

  return (
    <div className="flex flex-1 flex-col gap-3 overflow-y-auto pb-2 pt-1">
      {messages.map((message) => {
        const isAssistant = message.role === 'ASSISTANT';
        const attachments = message.attachments ?? [];

        return (
          <div
            key={message.id}
            className={cn('flex', isAssistant ? 'justify-start' : 'justify-end')}
          >
            <div
              className={cn(
                'ui-safe-text max-w-[86%] rounded-[22px] border px-4 py-3 text-sm leading-6 shadow-soft',
                isAssistant
                  ? 'border-border/70 bg-muted/70 text-foreground'
                  : 'border-primary/35 bg-primary text-primary-foreground',
              )}
            >
              {isAssistant ? (
                shouldRenderVideoCard(message) ? (
                  <VideoMessageCard
                    message={message}
                    onRetry={onRetryAsyncMessage}
                    onDelete={onDeleteAsyncMessage}
                  />
                ) : (
                  <AssistantMessageContent content={message.content} />
                )
              ) : (
                <div className="whitespace-pre-wrap">{message.content}</div>
              )}
              {attachments.length > 0 && !shouldRenderVideoCard(message) && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {attachments.map((attachment) => (
                    <div
                      key={attachment.file.id}
                      className={cn(
                        'rounded-full border px-3 py-1 text-xs',
                        isAssistant
                          ? 'border-border/70 bg-background/60 text-muted-foreground'
                          : 'border-white/20 bg-white/10',
                      )}
                    >
                      {attachment.file.originalName}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
}
