import { ProviderStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { presentProviders } from '../providers/provider-presentation';

export async function listActiveProviders() {
  const providers = await prisma.provider.findMany({
    where: { status: ProviderStatus.ACTIVE },
    orderBy: { name: 'asc' },
  });

  return presentProviders(providers);
}
