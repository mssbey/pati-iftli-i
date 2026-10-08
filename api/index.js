// Vercel sunucusuz fonksiyonu: vercel.json tüm /api/* isteklerini buraya yönlendirir.
import { handleApi } from '../server/api.js';

export default async function handler(req, res) {
  await handleApi(req, res, new URL(req.url, 'http://localhost'));
}
