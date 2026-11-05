import { createClient } from "@supabase/supabase-js";

export function createCvStorage({ url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY, bucket = process.env.CV_BUCKET || "jobfest-cv", client } = {}) {
  if (!client && (!url || !key)) throw new Error("Completează SUPABASE_URL și SUPABASE_SECRET_KEY în mediul backendului.");
  if (key?.startsWith("sb_publishable_")) throw new Error("SUPABASE_SECRET_KEY trebuie să fie cheia serverului, nu cheia publică.");
  if (url && new URL(url).protocol !== "https:") throw new Error("SUPABASE_URL trebuie să folosească HTTPS.");
  const supabase = client || createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (input, options = {}) => fetch(input, { ...options, signal: AbortSignal.any([AbortSignal.timeout(30000), ...(options.signal ? [options.signal] : [])]) }) } });
  const files = supabase.storage.from(bucket);
  return {
    async initialize() {
      let result = await supabase.storage.getBucket(bucket);
      if (result.error && Number(result.error.statusCode) === 404) {
        const created = await supabase.storage.createBucket(bucket, { public: false, fileSizeLimit: 5 * 1024 * 1024, allowedMimeTypes: ["application/pdf"] });
        if (created.error && ![400, 409].includes(Number(created.error.statusCode))) throw new Error("Bucketul privat pentru CV-uri nu a putut fi creat.");
        result = await supabase.storage.getBucket(bucket);
      }
      if (result.error || !result.data) throw new Error("Bucketul pentru CV-uri nu este accesibil cu cheia serverului.");
      if (result.data.public) throw new Error("Bucketul pentru CV-uri trebuie să fie privat.");
    },
    async upload(path, cv) {
      const { error } = await files.upload(path, cv.content, { contentType: "application/pdf", upsert: false, cacheControl: "0" });
      if (error) throw new Error("CV-ul nu a putut fi încărcat în stocarea privată.");
    },
    async download(path) {
      const { data, error } = await files.download(path);
      if (error || !data) throw new Error("CV-ul nu a putut fi descărcat din stocarea privată.");
      return Buffer.from(await data.arrayBuffer());
    },
    async remove(path) {
      const { error } = await files.remove([path]);
      if (error) throw new Error("Fișierul temporar nu a putut fi curățat.");
    }
  };
}
