/**
 * Supabase Storage driver for file uploads.
 *
 * Why this exists: the default `local` upload driver writes to the server's disk
 * (`/uploads`), which is ephemeral on Render's free/standard web services — files
 * vanish on every deploy/restart. Pointing UPLOAD_STORAGE_DRIVER=supabase persists
 * uploads to a Supabase Storage bucket and serves them from Supabase's CDN.
 *
 * Required env when UPLOAD_STORAGE_DRIVER=supabase:
 *   SUPABASE_URL                 (falls back to NEXT_PUBLIC_SUPABASE_URL)
 *   SUPABASE_SERVICE_ROLE_KEY    service-role key — server-side only, bypasses RLS
 * Optional:
 *   SUPABASE_STORAGE_BUCKET      bucket name (default: "uploads")
 *   SUPABASE_STORAGE_PATH_PREFIX path prefix inside the bucket (default: none)
 *
 * The service-role key must never be exposed to clients. It is only read here,
 * server-side.
 */

const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

const getSupabaseUrl = () =>
    String(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();

const getServiceRoleKey = () =>
    String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

const getBucket = () =>
    String(process.env.SUPABASE_STORAGE_BUCKET || 'uploads').trim() || 'uploads';

const getPathPrefix = () =>
    String(process.env.SUPABASE_STORAGE_PATH_PREFIX || '')
        .trim()
        .replace(/^\/+|\/+$/g, '');

/**
 * Whether the Supabase Storage driver has everything it needs to run.
 * Returns false (rather than throwing) so callers can warn + fall back.
 */
const isSupabaseStorageConfigured = () =>
    Boolean(getSupabaseUrl() && getServiceRoleKey());

let cachedClient = null;

const getClient = () => {
    if (cachedClient) return cachedClient;
    const url = getSupabaseUrl();
    const key = getServiceRoleKey();
    if (!url || !key) {
        throw new Error(
            'Supabase Storage is not configured (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required).',
        );
    }
    cachedClient = createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false },
    });
    return cachedClient;
};

const joinObjectPath = (...parts) =>
    parts
        .map((part) => String(part || '').replace(/^\/+|\/+$/g, ''))
        .filter(Boolean)
        .join('/');

/**
 * Upload a local file to Supabase Storage and return its public URL.
 *
 * @param {object} args
 * @param {string} args.localPath  absolute path to the file on local disk
 * @param {string} args.filename   object name to store (should be unique)
 * @param {string} args.mimetype   content type to serve the object with
 * @param {string} [args.folder]   optional sub-folder within the bucket/prefix
 * @returns {Promise<{ url: string, bucket: string, path: string }>}
 */
const uploadToSupabaseStorage = async ({ localPath, filename, mimetype, folder = '' }) => {
    const bucket = getBucket();
    const objectPath = joinObjectPath(getPathPrefix(), folder, filename);
    const fileBuffer = await fs.promises.readFile(localPath);

    const supabase = getClient();
    const { error } = await supabase.storage.from(bucket).upload(objectPath, fileBuffer, {
        contentType: mimetype || 'application/octet-stream',
        upsert: true,
    });

    if (error) {
        throw new Error(`Supabase Storage upload failed: ${error.message}`);
    }

    const { data } = supabase.storage.from(bucket).getPublicUrl(objectPath);
    if (!data?.publicUrl) {
        throw new Error('Supabase Storage upload succeeded but no public URL was returned.');
    }

    return { url: data.publicUrl, bucket, path: objectPath };
};

module.exports = {
    isSupabaseStorageConfigured,
    uploadToSupabaseStorage,
    getBucket,
};
