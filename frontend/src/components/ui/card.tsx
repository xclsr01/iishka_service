import * as React from 'react';
import { cn } from '@/lib/cn';

export function Card({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-[24px] border border-border/80 bg-card p-5 text-card-foreground shadow-soft backdrop-blur-xl',
        className,
      )}
      {...props}
    />
  );
}
