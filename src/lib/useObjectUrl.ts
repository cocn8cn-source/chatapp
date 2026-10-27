import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export type ObjectBucket = 'avatars' | 'chat-media' | 'group-photos';

/** Short-lived URL for a private object. RLS decides whether the caller may get one. */
export async function getSignedObjectUrl(bucket: ObjectBucket, path: string, expires = 3600): Promise<string> {
  if (!supabase) throw new Error('Supabase is not configured');
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expires);
  if (error) throw error;
  return data.signedUrl;
}

export function useObjectUrl(bucket: ObjectBucket, path: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: ['object-url', bucket, path],
    queryFn: () => getSignedObjectUrl(bucket, path!),
    enabled: !!path && enabled,
    staleTime: 50 * 60_000,
    gcTime: 55 * 60_000,
    retry: 1,
  });
}
