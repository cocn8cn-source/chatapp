import { useQuery } from '@tanstack/react-query';
import { signedUrl } from './upload';

/** Short-lived URL for a private object; RLS decides whether the caller may get one. */
export function useSignedUrl(path: string | null, enabled = true) {
  return useQuery({
    queryKey: ['signed', path], queryFn: () => signedUrl(path!), enabled: !!path && enabled,
    staleTime: 50 * 60_000, gcTime: 55 * 60_000, retry: 1,
  });
}
