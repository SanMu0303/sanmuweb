import ArticleView from '@/components/ArticleView';
import {listArticles} from '@/lib/repository';
export async function generateStaticParams(){return (await listArticles()).map(a=>({slug:a.slug}));}
export default async function Page({params}:{params:Promise<{slug:string}>}){return <ArticleView initialSlug={(await params).slug}/>}
