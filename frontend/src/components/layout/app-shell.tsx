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
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute inset-x-0 top-0 h-40 bg-[radial-gradient(circle_at_top,rgba(87,225,255,0.25),transparent_60%)]" />
          <div className="absolute right-[-15%] top-[18%] h-48 w-48 rounded-full bg-[radial-gradient(circle,rgba(255,191,71,0.16),transparent_65%)] blur-2xl" />
          <div className="absolute left-[-20%] bottom-[8%] h-56 w-56 rounded-full bg-[radial-gradient(circle,rgba(116,82,255,0.18),transparent_62%)] blur-3xl" />
        </div>
        <main className={cn('relative z-10 flex min-h-0 flex-1 flex-col gap-4', className)}>
          {children}
        </main>
      </div>
    </div>
  );
}
