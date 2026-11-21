import { handleProviderRecommendations } from '@/lib/provider-recommendation-handler';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) { return handleProviderRecommendations(request); }
