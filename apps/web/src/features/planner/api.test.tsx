import { DEFAULT_DASHBOARD_LAYOUT, type DashboardLayout } from '@homehub/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api';
import { plannerKeys, useSaveDashboardLayout } from './api';

function setup() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  client.setQueryData(plannerKeys.layout, DEFAULT_DASHBOARD_LAYOUT);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useSaveDashboardLayout(), { wrapper });
  return { client, result };
}

const hidden: DashboardLayout = {
  charts: DEFAULT_DASHBOARD_LAYOUT.charts.map((c) => ({ ...c, visible: false })),
};

describe('useSaveDashboardLayout', () => {
  afterEach(() => vi.restoreAllMocks());

  it('shows the new layout at once and keeps the saved one', async () => {
    let respond = (_layout: DashboardLayout) => {};
    vi.spyOn(api, 'put').mockReturnValue(
      new Promise((resolve) => {
        respond = resolve;
      }),
    );
    const { client, result } = setup();
    act(() => result.current.mutate(hidden));
    // Still waiting for the server, the cache already has the new layout.
    await waitFor(() => expect(client.getQueryData(plannerKeys.layout)).toEqual(hidden));
    expect(result.current.isPending).toBe(true);
    act(() => respond(hidden));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(client.getQueryData(plannerKeys.layout)).toEqual(hidden);
  });

  it('puts the previous layout back when saving fails', async () => {
    vi.spyOn(api, 'put').mockRejectedValue(new Error('offline'));
    const { client, result } = setup();
    act(() => result.current.mutate(hidden));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(client.getQueryData(plannerKeys.layout)).toEqual(DEFAULT_DASHBOARD_LAYOUT);
  });
});
