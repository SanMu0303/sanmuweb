import rawArticles from '@/content/articles.json';
import rawWatchlist from '@/content/watchlist.json';
import type {Article,WatchItem} from './types';
// Replace this adapter with server-side API/Supabase reads later.
const articles=rawArticles as Article[];
export async function listArticles(){return [...articles].sort((a,b)=>Number(b.pinned)-Number(a.pinned)||b.publishedAt.localeCompare(a.publishedAt));}
export async function getArticle(slug:string){return articles.find(a=>a.slug===slug);}
export async function listWatchlist(){return rawWatchlist as WatchItem[];}
export function summaryOf({sections,...summary}:Article){return summary;}
