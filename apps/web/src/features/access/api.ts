import type {
  AccessTokenDto,
  OAuthDecisionDto,
  OAuthDecisionInput,
  OAuthRequestDto,
  PersonalTokenCreatedDto,
  PersonalTokenCreateInput,
} from '@homehub/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { roots } from '@/lib/query-keys';

const P = '/access';

export const accessKeys = {
  root: roots.access,
  tokens: [...roots.access, 'tokens'] as const,
  request: (id: string) => [...roots.access, 'request', id] as const,
};

/** Personal tokens and connected apps of the workspace. */
export function useAccessTokens() {
  return useQuery({
    queryKey: accessKeys.tokens,
    queryFn: () => api.get<AccessTokenDto[]>(`${P}/tokens`),
  });
}

export function useCreatePersonalToken() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: PersonalTokenCreateInput) =>
      api.post<PersonalTokenCreatedDto>(`${P}/tokens`, input),
    onSuccess: () => client.invalidateQueries({ queryKey: accessKeys.tokens }),
  });
}

export function useRevokeAccessToken() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`${P}/tokens/${id}`),
    onSuccess: () => client.invalidateQueries({ queryKey: accessKeys.tokens }),
  });
}

/** The consent page's request: asked once, an expired or unknown one answers 404. */
export function useOAuthRequest(id: string) {
  return useQuery({
    queryKey: accessKeys.request(id),
    queryFn: () => api.get<OAuthRequestDto>(`${P}/oauth/requests/${encodeURIComponent(id)}`),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
}

/** Approve or decline; the browser then goes to the app's redirect address. */
export function useOAuthDecision(id: string) {
  return useMutation({
    mutationFn: (input: OAuthDecisionInput) =>
      api.post<OAuthDecisionDto>(`${P}/oauth/requests/${encodeURIComponent(id)}`, input),
  });
}
