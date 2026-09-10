import type {Post,PostFilters} from '../lib/posts';
export function normalizePost(a:unknown):Post;
export function projectPost(a:unknown,isAdmin?:boolean):Post;
export function filterPosts(posts:Post[],filters?:Partial<PostFilters>):Post[];
export function orderPosts(posts:Post[],chronological?:boolean):Post[];
export const CONTENT_TYPES:string[];
export const MARKETS:string[];
export const STAGES:string[];

export function toArticleDocument(p:Post):import('../lib/types').Article;
