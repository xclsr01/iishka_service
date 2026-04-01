import { useEffect, useRef } from 'react';
import type { ChatMessage } from '@/lib/api';
import { cn } from '@/lib/cn';

export function ChatMessageList({
  messages,
  scrollToBottomSignal,
}: {
  messages: ChatMessage[];
  scrollToBottomSignal?: number;
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

        return (
          <div
            key={message.id}
            className={cn('flex', isAssistant ? 'justify-start' : 'justify-end')}
          >
            <div
              className={cn(
                'max-w-[86%] rounded-[22px] border px-4 py-3 text-sm leading-6 shadow-soft',
                isAssistant
                  ? 'border-border/70 bg-muted/70 text-foreground'
                  : 'border-primary/35 bg-primary text-primary-foreground',
              )}
            >
              <div className="whitespace-pre-wrap">{message.content}</div>
              {message.attachments.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {message.attachments.map((attachment) => (
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
