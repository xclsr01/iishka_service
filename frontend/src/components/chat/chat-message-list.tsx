import { useEffect, useLayoutEffect, useRef } from 'react';
import type { ChatMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { Spinner } from '@/components/ui/spinner';
import { AssistantMessageContent } from './assistant-message-content';
import { VideoMessageCard } from './video-message-card';

function shouldRenderVideoCard(message: ChatMessage) {
  if (message.role !== 'ASSISTANT') {
    return false;
  }

  if (
    message.attachments?.some((attachment) =>
      attachment.file.mimeType.startsWith('video/'),
    )
  ) {
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
  chatId,
  messages,
  hasMoreMessages,
  isLoadingOlderMessages,
  scrollToBottomSignal,
  onLoadOlderMessages,
  onRetryAsyncMessage,
  onDeleteAsyncMessage,
}: {
  chatId?: string;
  messages: ChatMessage[];
  hasMoreMessages?: boolean;
  isLoadingOlderMessages?: boolean;
  scrollToBottomSignal?: number;
  onLoadOlderMessages?: () => Promise<void>;
  onRetryAsyncMessage?: (messageId: string) => Promise<void>;
  onDeleteAsyncMessage?: (messageId: string) => Promise<void>;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const lastInitialScrollChatIdRef = useRef<string | undefined>(undefined);
  const previousScrollHeightRef = useRef<number | null>(null);
  const shouldPinToBottomRef = useRef(true);

  function scrollToBottom(behavior: ScrollBehavior = 'auto') {
    const list = listRef.current;
    if (!list) {
      return;
    }

    list.scrollTop = list.scrollHeight;
    window.requestAnimationFrame(() => {
      list.scrollTop = list.scrollHeight;
      bottomRef.current?.scrollIntoView({ behavior, block: 'end' });
    });
    window.setTimeout(() => {
      if (
        shouldPinToBottomRef.current &&
        previousScrollHeightRef.current === null
      ) {
        list.scrollTop = list.scrollHeight;
      }
    }, 250);
  }

  useLayoutEffect(() => {
    if (
      messages.length === 0 ||
      lastInitialScrollChatIdRef.current === chatId
    ) {
      return;
    }

    lastInitialScrollChatIdRef.current = chatId;
    shouldPinToBottomRef.current = true;
    scrollToBottom('auto');
  }, [chatId, messages.length]);

  useEffect(() => {
    if (!scrollToBottomSignal) {
      return;
    }

    shouldPinToBottomRef.current = true;
    scrollToBottom('smooth');
  }, [scrollToBottomSignal]);

  useLayoutEffect(() => {
    const previousScrollHeight = previousScrollHeightRef.current;
    const list = listRef.current;

    if (previousScrollHeight === null || !list) {
      return;
    }

    list.scrollTop = list.scrollHeight - previousScrollHeight + list.scrollTop;
    previousScrollHeightRef.current = null;
  }, [messages.length]);

  useLayoutEffect(() => {
    const newestMessageId = messages.at(-1)?.id ?? null;
    if (!newestMessageId) {
      return;
    }

    if (
      shouldPinToBottomRef.current &&
      previousScrollHeightRef.current === null
    ) {
      scrollToBottom('auto');
    }
  }, [messages]);

  useEffect(() => {
    const list = listRef.current;
    if (!list || !('ResizeObserver' in window)) {
      return;
    }

    const observer = new ResizeObserver(() => {
      if (
        shouldPinToBottomRef.current &&
        previousScrollHeightRef.current === null
      ) {
        scrollToBottom('auto');
      }
    });

    observer.observe(list);
    return () => observer.disconnect();
  }, []);

  async function handleScroll() {
    const list = listRef.current;
    if (list) {
      shouldPinToBottomRef.current =
        list.scrollHeight - list.scrollTop - list.clientHeight < 120;
    }

    if (
      !list ||
      !hasMoreMessages ||
      isLoadingOlderMessages ||
      !onLoadOlderMessages
    ) {
      return;
    }

    if (list.scrollTop > 80) {
      return;
    }

    previousScrollHeightRef.current = list.scrollHeight;
    await onLoadOlderMessages();
  }

  return (
    <div
      ref={listRef}
      className="flex flex-1 flex-col gap-3 overflow-y-auto pb-2 pt-1"
      onScroll={() => void handleScroll()}
    >
      {isLoadingOlderMessages && (
        <div className="flex justify-center py-1">
          <Spinner />
        </div>
      )}
      {messages.map((message) => {
        const isAssistant = message.role === 'ASSISTANT';
        const attachments = message.attachments ?? [];

        return (
          <div
            key={message.id}
            className={cn(
              'flex',
              isAssistant ? 'justify-start' : 'justify-end',
            )}
          >
            <div
              className={cn(
                'max-w-[86%] rounded-[22px] border px-4 py-3 text-sm leading-6 shadow-soft',
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
                        'max-w-full rounded-full border px-3 py-1 text-xs',
                        isAssistant
                          ? 'border-border/70 bg-background/60 text-muted-foreground'
                          : 'border-white/20 bg-white/10',
                      )}
                      title={attachment.file.originalName}
                    >
                      <span className="block max-w-full overflow-hidden text-ellipsis whitespace-nowrap">
                        {attachment.file.originalName}
                      </span>
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
