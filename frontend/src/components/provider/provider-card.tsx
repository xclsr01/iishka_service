import { Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { Provider } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

const toneByKey: Record<Provider['key'], string> = {
  OPENAI: 'from-[#e59a4a] to-[#efcf7a]',
  ANTHROPIC: 'from-[#7a9e88] to-[#dde6cc]',
  GEMINI: 'from-[#5d87b8] to-[#d9e6ff]',
};

export function ProviderCard({ provider }: { provider: Provider }) {
  return (
    <Card className="min-w-[280px] snap-start overflow-hidden p-0">
      <div className={`h-2 bg-gradient-to-r ${toneByKey[provider.key]}`} />
      <div className="space-y-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-display text-2xl font-bold">{provider.name}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{provider.summary}</p>
          </div>
          <div className="space-y-2 text-right">
            <Badge className="bg-white/80 text-foreground">{provider.defaultModel}</Badge>
            {!provider.isAvailable && (
              <Badge className="bg-destructive/10 text-destructive">Unavailable</Badge>
            )}
          </div>
        </div>

        <div className="rounded-3xl bg-white/70 p-4 text-sm text-muted-foreground">
          <p>{provider.description}</p>
          {!provider.isAvailable && provider.availabilityMessage && (
            <p className="mt-3 text-destructive">{provider.availabilityMessage}</p>
          )}
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Sparkles className="h-4 w-4" />
            File uploads enabled
          </div>
          {provider.isAvailable ? (
            <Button asChild>
              <Link to={`/providers/${provider.id}`}>Enter chat</Link>
            </Button>
          ) : (
            <Button type="button" disabled>
              Unavailable
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}
