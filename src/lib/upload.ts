import type { SupabaseClient } from '@supabase/supabase-js';
import { PHOTOS_BUCKET } from '@/lib/types';

/**
 * Upload an image to the public `photos` bucket and return its public URL.
 * Path: <folder>/<timestamp>-<sanitized name>
 */
export async function uploadPhoto(
  supabase: SupabaseClient,
  folder: 'servants' | 'services' | 'classes' | 'persons',
  file: File | Blob,
  name?: string
): Promise<string> {
  const rawName = name ?? (file instanceof File ? file.name : 'photo.webp');
  const path = `${folder}/${Date.now()}-${rawName.replace(/[^a-zA-Z0-9.]/g, '_')}`;
  const { error } = await supabase.storage.from(PHOTOS_BUCKET).upload(path, file, {
    contentType: file.type || undefined,
  });
  if (error) throw error;
  return supabase.storage.from(PHOTOS_BUCKET).getPublicUrl(path).data.publicUrl;
}
