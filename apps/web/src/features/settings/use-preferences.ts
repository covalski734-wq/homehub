import type { PreferencesDto, PreferencesUpdate } from '@homehub/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { applyLanguage, language } from '@/i18n';
import { toast } from 'sonner';
import { api, errorMessage } from '@/lib/api';
import { roots } from '@/lib/query-keys';

const KEY = roots.preferences;

/** Colour tones are a CSS switch on <html> (see index.css), so no component has to re-render. */
function applyColors(on: boolean) {
  if (on) delete document.documentElement.dataset.colors;
  else document.documentElement.dataset.colors = 'off';
}

export function usePreferences() {
  return useQuery({
    queryKey: KEY,
    queryFn: () => api.get<PreferencesDto>('/preferences'),
    staleTime: Infinity,
  });
}

/**
 * Applies the signed-in user's preferences: colours at once, the language by reloading when the
 * server choice differs from the cached one (e.g. it was changed on another device).
 */
export function usePreferencesSync() {
  const { data } = usePreferences();
  useEffect(() => {
    if (!data) return;
    applyColors(data.colorLabels);
    if (data.language !== language()) applyLanguage(data.language);
  }, [data]);
}

export function useUpdatePreferences() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: PreferencesUpdate) => api.patch<PreferencesDto>('/preferences', input),
    // Colours switch at once; the language waits for the server, since applying it reloads the page.
    onMutate: async ({ colorLabels }) => {
      // A refetch in flight would overwrite the optimistic colours with the old value.
      await client.cancelQueries({ queryKey: KEY });
      const previous = client.getQueryData<PreferencesDto>(KEY);
      if (previous && colorLabels !== undefined)
        client.setQueryData<PreferencesDto>(KEY, { ...previous, colorLabels });
      return previous;
    },
    onError: (error, _input, previous) => {
      if (previous) client.setQueryData(KEY, previous);
      toast.error(errorMessage(error));
    },
    onSuccess: (saved) => client.setQueryData(KEY, saved),
  });
}
