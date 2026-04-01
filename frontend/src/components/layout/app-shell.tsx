import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export function AppShell({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className="h-[100dvh] overflow-hidden bg-background text-foreground">
      <div className="mx-auto flex h-[100dvh] w-full max-w-md flex-col px-4 pb-4 pt-3">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(217,136,58,0.18),transparent_35%),linear-gradient(180deg,rgba(255,255,255,0.3),transparent_30%)]" />
        <main className={cn('relative z-10 flex min-h-0 flex-1 flex-col gap-4', className)}>
          {children}
        </main>
      </div>
    </div>
  );
}
