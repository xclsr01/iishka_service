import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export function Badge({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'inline-flex items-center rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground',
        className,
      )}
      {...props}
    />
  );
}
