import ArticleView from '@/components/ArticleView';
import posts from '@/content/posts.json';
export async function generateStaticParams(){return posts.map(a=>({slug:a.slug}));}
export default async function Page({params}:{params:Promise<{slug:string}>}){return <ArticleView initialSlug={(await params).slug}/>}
