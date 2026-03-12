import type { ChatMessage } from '@/lib/api';
import { cn } from '@/lib/cn';

export function ChatMessageList({
  messages,
}: {
  messages: ChatMessage[];
}) {
  return (
    <div className="flex flex-1 flex-col gap-3 overflow-y-auto pb-4">
      {messages.map((message) => {
        const isAssistant = message.role === 'ASSISTANT';

        return (
          <div
            key={message.id}
            className={cn('flex', isAssistant ? 'justify-start' : 'justify-end')}
          >
            <div
              className={cn(
                'max-w-[86%] rounded-[26px] px-4 py-3 text-sm leading-6 shadow-soft',
                isAssistant ? 'bg-white/90 text-foreground' : 'bg-primary text-primary-foreground',
              )}
            >
              <div className="whitespace-pre-wrap">{message.content}</div>
              {message.attachments.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {message.attachments.map((attachment) => (
                    <div
                      key={attachment.file.id}
                      className={cn(
                        'rounded-full px-3 py-1 text-xs',
                        isAssistant ? 'bg-muted text-muted-foreground' : 'bg-white/15',
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
    </div>
  );
}
