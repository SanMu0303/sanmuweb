"use client";
import {useEffect,useState} from 'react';
import Link from 'next/link';
import type {Post} from '@/lib/posts';
import {request} from '@/lib/live';
import PostCard from './PostCard';
export default function ArticleView({initialSlug}:{initialSlug?:string}){const [post,setPost]=useState<Post|null>(null);const [error,setError]=useState('');const [version,setVersion]=useState(0);useEffect(()=>{let active=true;const slug=initialSlug||new URLSearchParams(location.search).get('slug');if(!slug){setError('没有指定研究记录');return;}setError('');request<Post>('/api/posts/'+encodeURIComponent(slug)).then(p=>{if(active){setPost(p);document.title=p.title+' · 趋势交易观察室'}}).catch(e=>{if(active)setError(e.message)});return()=>{active=false}},[initialSlug,version]);if(error)return <div className="empty" role="alert"><p>{error}</p><button className="button" onClick={()=>setVersion(v=>v+1)}>重新读取</button><p><Link href="/">返回研究日志</Link></p></div>;if(!post)return <div className="empty" role="status">正在读取研究记录…</div>;return <div className="research-detail"><Link className="breadcrumb" href="/">← 返回研究日志</Link>{post.status==='draft'&&<div className="notice">草稿 · 仅管理员可见</div>}<PostCard post={post} full/></div>}
