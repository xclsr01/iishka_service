import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

type ErrorBoundaryState = {
  hasError: boolean;
};

export class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    hasError: false,
  };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return {
      hasError: true,
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('frontend_render_failed', {
      message: error.message,
      stack: error.stack,
      componentStack: info.componentStack,
    });
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <AppShell className="items-center justify-center">
        <Card className="max-w-sm space-y-4 text-center">
          <h1 className="font-display text-2xl font-bold text-white">App view failed</h1>
          <p className="text-sm text-muted-foreground">
            The interface hit a rendering issue. Reload the Mini App and try again.
          </p>
          <Button type="button" className="w-full" onClick={() => window.location.reload()}>
            Reload
          </Button>
        </Card>
      </AppShell>
    );
  }
}
